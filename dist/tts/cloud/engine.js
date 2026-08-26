import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { OpenAIProvider } from "./providers/openai.js";
import { VolcanoProvider } from "./providers/volcano.js";
import { CustomHTTPProvider } from "./providers/custom.js";
import { playAudioFile } from "../audio-player.js";
function createProvider(config) {
    switch (config.provider) {
        case "openai":
            return new OpenAIProvider(config);
        case "volcano":
            return new VolcanoProvider(config);
        case "custom":
            return new CustomHTTPProvider(config);
        default:
            throw new Error(`Unknown cloud TTS provider: ${config.provider}`);
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