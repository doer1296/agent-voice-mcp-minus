import { TTSEngine, TTSOptions } from "./interface.js";
export declare class PiperTTSEngine implements TTSEngine {
    private currentProcess;
    private tempFile;
    private defaultModel;
    private defaultConfig;
    constructor(modelPath?: string, configPath?: string);
    private resolveModel;
    private resolveConfig;
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    stop(): void;
    private cleanupTempFile;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=piper-tts.d.ts.map