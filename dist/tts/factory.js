import { MacOSSayEngine } from "./macos-say.js";
import { WindowsSAPIEngine } from "./windows-sapi.js";
import { LinuxEspeakEngine } from "./linux-espeak.js";
import { PiperTTSEngine } from "./piper-tts.js";
import { EdgeTTSEngine } from "./edge-tts.js";
import { CloudTTSEngine } from "./cloud/engine.js";
import os from "os";
let cachedEngine = null;
// 配置实时生效（B1）：cloud 配置变更后允许重建引擎
export function resetEngineCache() {
    cachedEngine = null;
}
export function createTTSEngine(options) {
    if (cachedEngine) {
        return cachedEngine;
    }
    const platform = os.platform();
    let engineType = options?.engine || platform;
    // 引擎候选链 auto（B2）：云端 Key 已配置 → cloud；缺失/未配置 → 本地平台引擎。
    // 避免红线 1「默认引擎写死厂商，无 Key 启动即报错」：auto 下无 Key 也能正常出声。
    if (engineType === "auto") {
        // 分区配置（C1.3）：扁平 cloud.apiKey 或 cloud.{volcano,mimo}.apiKey 任一存在即视为已配置
        const c = options?.cloud || {};
        const hasCloudKey = Boolean(c.apiKey || c.volcano?.apiKey || c.mimo?.apiKey);
        if (hasCloudKey) {
            engineType = "cloud";
        }
        else {
            engineType = platform;
            console.error("agent-voice: engine=auto 且云端 apiKey 未配置，使用本地引擎（如需云端请在 config.json 配置 cloud.apiKey）");
        }
    }
    if (engineType === "piper") {
        cachedEngine = new PiperTTSEngine(options?.modelPath, options?.configPath);
        return cachedEngine;
    }
    if (engineType === "edge-tts") {
        cachedEngine = new EdgeTTSEngine();
        return cachedEngine;
    }
    if (engineType === "cloud") {
        if (!options?.cloud) {
            throw new Error('Cloud TTS engine requires "cloud" configuration');
        }
        cachedEngine = new CloudTTSEngine(options.cloud);
        return cachedEngine;
    }
    switch (platform) {
        case "darwin":
            cachedEngine = new MacOSSayEngine();
            break;
        case "win32":
            cachedEngine = new WindowsSAPIEngine();
            break;
        case "linux":
            cachedEngine = new LinuxEspeakEngine();
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}. Supported: darwin (macOS say), win32 (PowerShell SAPI), linux (espeak-ng). You can also use engine: "piper", "edge-tts", or "cloud" on all platforms.`);
    }
    return cachedEngine;
}
//# sourceMappingURL=factory.js.map