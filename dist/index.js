#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { createTTSEngine } from "./tts/factory.js";
import { VoiceQueue, cleanSpeechText, truncateForSpeech } from "./voice-queue.js";
import { loadConfig, resolveOptions, resolveRole } from "./config.js";
import { WindowsSAPIEngine } from "./tts/windows-sapi.js";
import os from "os";
const config = loadConfig();
const engine = createTTSEngine({
    engine: config.engine,
    modelPath: config.modelPath,
    configPath: config.configPath,
    cloud: config.cloud,
});
// 云端失败（断网/额度耗尽）时回退本地 SAPI，保证播报不中断
const fallbackEngine = config.fallbackEngine === "windows-sapi" && os.platform() === "win32"
    ? new WindowsSAPIEngine()
    : null;
const voiceQueue = new VoiceQueue(engine, 2, config.notificationSound, fallbackEngine);
const server = new McpServer({
    name: "agent-voice-plus",
    version: "1.3.0",
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
    // 参数容错：非法值使用默认/首个枚举
    const safeScene = (scene && VALID_SCENES.includes(scene))
        ? scene
        : (scene ? VALID_SCENES[0] : undefined);
    const safeEmotion = (emotion && VALID_EMOTIONS.includes(emotion))
        ? emotion
        : (emotion ? VALID_EMOTIONS[0] : undefined);
    const safeRate = rate !== undefined ? Math.max(50, Math.min(300, rate)) : undefined;
    const safeVolume = volume !== undefined ? Math.max(0, Math.min(1, volume)) : undefined;
    const role = resolveRole(config.roles, roleParam);
    const resolved = resolveOptions(config, safeScene, {
        voice,
        rate: safeRate,
        volume: safeVolume,
        emotion: safeEmotion,
        emotionIntensity,
    }, role);
    // 合成前清洗与截断（P4）：去代码块/URL/Markdown 标记，避免读出「井号、反引号」
    let speechText = config.textClean !== false
        ? cleanSpeechText(text)
        : String(text ?? "");
    speechText = truncateForSpeech(speechText, config.maxTextLength ?? 200);
    if (speechText) {
        // 场景提示音优先：sceneSounds[scene] > 角色提示音 > 全局提示音
        const sceneSound = (safeScene && config.sceneSounds?.[safeScene])
            ?? role?.notificationSound
            ?? config.notificationSound;
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
    const roles = (config.roles ?? []).map((r) => ({
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
    const resolved = resolveOptions(config);
    voiceQueue.enqueue("agent-voice 服务已启动", resolved);
}
main().catch((error) => {
    console.error("agent-voice server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map