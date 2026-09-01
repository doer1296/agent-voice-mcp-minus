import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { OpenAIProvider } from "./providers/openai.js";
import { VolcanoProvider } from "./providers/volcano.js";
import { MiMoProvider } from "./providers/mimo.js";
import { CustomHTTPProvider } from "./providers/custom.js";
import { playAudioFile } from "../audio-player.js";
// 配置分区（C1.3）：cloud.{volcano,mimo} 分区与旧扁平键共存。
// 分区键优先于扁平键，旧配置（扁平 cloud.apiKey）不改一字仍工作（向后兼容）。
function mergeCloudPartition(cloud) {
    let provider = cloud.provider;
    if (!provider) {
        // 未显式指定 provider：按存在的分区探测；仅扁平键（无任何分区）则默认 volcano
        if (cloud.mimo && !cloud.volcano) {
            provider = "mimo";
        }
        else {
            provider = "volcano";
        }
    }
    const partition = cloud[provider];
    if (!partition || typeof partition !== "object") {
        return { ...cloud, provider };
    }
    return { ...cloud, provider, ...partition };
}
function createProvider(config) {
    const merged = mergeCloudPartition(config);
    switch (merged.provider) {
        case "openai":
            return new OpenAIProvider(merged);
        case "volcano":
            return new VolcanoProvider(merged);
        case "mimo":
            return new MiMoProvider(merged);
        case "custom":
            return new CustomHTTPProvider(merged);
        default:
            throw new Error(`Unknown cloud TTS provider: ${merged.provider}`);
    }
}
export class CloudTTSEngine {
    provider;
    currentProcess = null;
    tempFile = null;
    constructor(config) {
        this.provider = createProvider(config);
    }
    get providerType() {
        return this.provider.type;
    }
    async speak(text, options, onBeforePlay) {
        await this.stop();
        try {
            const audioBuffer = await this.provider.synthesize({
                text,
                voice: options?.voice,
                rate: options?.rate,
                volume: options?.volume,
                emotion: options?.emotion,
                emotionIntensity: options?.emotionIntensity,
                scene: options?.scene,
            });
            const ext = ".wav";
            const tempFile = path.join(tmpdir(), `agent-voice-cloud-${Date.now()}${ext}`);
            this.tempFile = tempFile;
            writeFileSync(tempFile, audioBuffer);
            // Play notification sound after synthesis, before local playback
            if (onBeforePlay) {
                await onBeforePlay();
            }
            await this.playAudio(tempFile);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Cloud TTS request failed";
            throw new Error(message);
        }
    }
    async playAudio(filePath) {
        try {
            await playAudioFile(filePath, (proc) => {
                this.currentProcess = proc;
            });
        }
        finally {
            this.currentProcess = null;
            this.cleanupTempFile();
        }
    }
    stop() {
        if (this.currentProcess) {
            this.currentProcess.kill("SIGTERM");
            this.currentProcess = null;
        }
        this.cleanupTempFile();
    }
    cleanupTempFile() {
        if (this.tempFile) {
            try {
                unlinkSync(this.tempFile);
            }
            catch {
                // ignore cleanup errors
            }
            this.tempFile = null;
        }
    }
    async getVoices() {
        return this.provider.getVoices();
    }
}
//# sourceMappingURL=engine.js.map