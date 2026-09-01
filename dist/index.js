#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { createTTSEngine, resetEngineCache } from "./tts/factory.js";
import { VoiceQueue, cleanSpeechText, truncateForSpeech } from "./voice-queue.js";
import { loadConfig, reloadConfig, resolveOptions, resolveRole } from "./config.js";
import { WindowsSAPIEngine } from "./tts/windows-sapi.js";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");
const config = loadConfig();
let engine = createTTSEngine({
    engine: config.engine,
    modelPath: config.modelPath,
    configPath: config.configPath,
    cloud: config.cloud,
});
// 云端失败（断网/额度耗尽）时回退本地 SAPI，保证播报不中断
let fallbackEngine = config.fallbackEngine === "windows-sapi" && os.platform() === "win32"
    ? new WindowsSAPIEngine()
    : null;
const voiceQueue = new VoiceQueue(engine, 2, config.notificationSound, fallbackEngine);
// 配置实时生效（B1）：speak 前重读配置；引擎级配置（engine/cloud/modelPath/fallbackEngine）
// 变更时热重建引擎。签名不变时零开销（不重建）。队列串行处理，两轮播报之间换引擎是安全的。
let engineSignature = "";
function refreshEnginesIfNeeded(cfg) {
    const signature = JSON.stringify({
        engine: cfg.engine,
        modelPath: cfg.modelPath,
        configPath: cfg.configPath,
        cloud: cfg.cloud,
        fallbackEngine: cfg.fallbackEngine,
    });
    if (signature === engineSignature)
        return;
    const firstBuild = engineSignature === "";
    engineSignature = signature;
    if (firstBuild)
        return;
    try {
        resetEngineCache();
        engine = createTTSEngine({
            engine: cfg.engine,
            modelPath: cfg.modelPath,
            configPath: cfg.configPath,
            cloud: cfg.cloud,
        });
        voiceQueue.engine = engine;
        fallbackEngine = cfg.fallbackEngine === "windows-sapi" && os.platform() === "win32"
            ? new WindowsSAPIEngine()
            : null;
        voiceQueue.fallbackEngine = fallbackEngine;
        console.error("agent-voice: engine config changed, engine rebuilt");
    }
    catch (e) {
        console.error(`agent-voice: engine rebuild failed (${e.message}), keeping previous engine`);
        // 重建失败回退旧签名，下次重试
        engineSignature = "";
    }
}
// 附属监听器（pending.txt 备用播报通道）：与主服务同生命周期，由 config.watcher 开关
// script 未配置时默认使用包内 watcher/voice-watcher.mjs（与 dist/ 同级），开源场景零配置
// 单实例守卫（TCP 47613）保证多会话只跑一份；守卫被占时子进程退出，稍后重试接管
const watcherCfg = config.watcher;
let watcherChild = null;
function watcherScriptPath() {
    if (watcherCfg?.script)
        return watcherCfg.script;
    return fileURLToPath(new URL("../watcher/voice-watcher.mjs", import.meta.url));
}
function spawnWatcher() {
    if (!watcherCfg?.enabled)
        return;
    const script = watcherScriptPath();
    if (!existsSync(script)) {
        console.error(`[watcher] script not found, disabled: ${script}`);
        return;
    }
    let child;
    try {
        child = spawn(process.execPath, [script], { stdio: "ignore", windowsHide: true });
    }
    catch (e) {
        console.error(`[watcher] spawn failed: ${e.message}`);
        return;
    }
    watcherChild = child;
    let failed = false;
    child.on("error", (e) => {
        failed = true;
        console.error(`[watcher] ${e.message}`);
    });
    child.on("exit", () => {
        if (watcherChild === child)
            watcherChild = null;
        // 启动失败（脚本缺失等）不重试；守卫被其他实例占用则周期性重试接管
        if (!failed) {
            const t = setTimeout(spawnWatcher, 30000);
            t.unref();
        }
    });
}
spawnWatcher();
process.on("exit", () => {
    if (watcherChild)
        watcherChild.kill();
});
// 客户端断开（MCP 连接关闭）时回收监听器并退出——子进程句柄会把事件循环挂住，必须显式退出
process.stdin.on("end", () => {
    if (watcherChild)
        watcherChild.kill();
    process.exit(0);
});
const server = new McpServer({
    name: "agent-voice-minus",
    version: PKG_VERSION,
});
const VALID_SCENES = ["task_start", "task_complete", "task_error", "need_interaction", "milestone"];
const VALID_EMOTIONS = ["neutral", "happy", "sad", "angry", "calm", "excited"];
server.registerTool("speak", {
    description: "通过TTS语音播报文本。语音播报不阻塞Agent执行，超出队列上限(2条)的历史语音将被丢弃。",
    inputSchema: {
        text: z.string().describe("要播报的文本内容"),
        voice: z.string().optional().describe("TTS音色名称，不传则使用配置文件默认音色"),
        rate: z.number().optional().describe("语速，范围50-300词/分钟，不传则使用配置文件默认值，超范围自动钳制"),
        volume: z.number().optional().describe("音量，范围0-1，不传则使用配置文件默认值，超范围自动钳制"),
        scene: z
            .string()
            .optional()
            .describe("播报场景类型，传入后自动应用该场景在配置中的音色/语速/音量。非法值回退为 task_start"),
        emotion: z
            .string()
            .optional()
            .describe("播报情感类型，不传则使用配置文件默认值。非法值回退为 neutral"),
        emotionIntensity: z.number().min(0).max(1).optional().describe("情感强度，范围0-1，默认1.0"),
        role: z
            .string()
            .optional()
            .describe("指定播报角色名称或目标Agent名称（如'Trae'、'Claude'）。可用角色参见 get_roles 工具返回的列表。未指定时使用配置的第一个角色"),
    },
}, async ({ text, voice, rate, volume, scene, emotion, emotionIntensity, role: roleParam }) => {
    // 配置实时生效（B1）：每次播报前重读 config.json；引擎级配置变更时热重建
    const cfg = reloadConfig();
    refreshEnginesIfNeeded(cfg);
    voiceQueue.notificationSound = cfg.notificationSound;
    // 参数容错：非法值使用默认/首个枚举
    const safeScene = (scene && VALID_SCENES.includes(scene))
        ? scene
        : (scene ? VALID_SCENES[0] : undefined);
    const safeEmotion = (emotion && VALID_EMOTIONS.includes(emotion))
        ? emotion
        : (emotion ? VALID_EMOTIONS[0] : undefined);
    const safeRate = rate !== undefined ? Math.max(50, Math.min(300, rate)) : undefined;
    const safeVolume = volume !== undefined ? Math.max(0, Math.min(1, volume)) : undefined;
    const role = resolveRole(cfg.roles, roleParam);
    const resolved = resolveOptions(cfg, safeScene, {
        voice,
        rate: safeRate,
        volume: safeVolume,
        emotion: safeEmotion,
        emotionIntensity,
    }, role);
    // 合成前清洗与截断（P4）：去代码块/URL/Markdown 标记，避免读出「井号、反引号」
    let speechText = cfg.textClean !== false
        ? cleanSpeechText(text)
        : String(text ?? "");
    speechText = truncateForSpeech(speechText, cfg.maxTextLength ?? 200);
    if (speechText) {
        // 场景提示音优先：sceneSounds[scene] > 角色提示音 > 全局提示音
        const sceneSound = (safeScene && cfg.sceneSounds?.[safeScene])
            ?? role?.notificationSound
            ?? cfg.notificationSound;
        voiceQueue.enqueue(speechText, resolved, sceneSound);
    }
    return {
        content: [{ type: "text", text: "OK" }],
    };
});
server.registerTool("stop", {
    description: "停止当前正在播放的语音并清空播报队列",
    inputSchema: {},
}, async () => {
    voiceQueue.stop();
    return {
        content: [{ type: "text", text: "OK" }],
    };
});
server.registerTool("get_voices", {
    description: "获取当前TTS引擎可用的所有音色列表",
    inputSchema: {},
}, async () => {
    const voices = await engine.getVoices();
    return {
        content: [{ type: "text", text: JSON.stringify(voices, null, 2) }],
    };
});
server.registerTool("get_roles", {
    description: "获取当前配置中所有可用的播报角色列表（v1.1.0）。返回每个角色的 name、target（适用范围说明）、voice 信息，Agent 据此决定 speak 时传入哪个 role 参数。无角色配置时返回空数组。",
    inputSchema: {},
}, async () => {
    const cfg = reloadConfig();
    const roles = (cfg.roles ?? []).map((r) => ({
        name: r.name,
        target: r.target ?? null,
        voice: r.voice ?? null,
    }));
    return {
        content: [{ type: "text", text: JSON.stringify(roles, null, 2) }],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // 启动欢迎语（B3）：config.startupWelcome —— 字符串自定义文案，false 关闭，缺省原文案
    const welcome = config.startupWelcome;
    if (welcome !== false) {
        const text = typeof welcome === "string" && welcome.trim() ? welcome.trim() : "agent-voice 服务已启动";
        const resolved = resolveOptions(config);
        voiceQueue.enqueue(text, resolved);
    }
}
main().catch((error) => {
    console.error("agent-voice server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map