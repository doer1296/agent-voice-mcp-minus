import { TTSEngine, TTSOptions } from "./interface.js";
export declare class EdgeTTSEngine implements TTSEngine {
    private currentProcess;
    private tempFiles;
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    private runEdgeTts;
    stop(): void;
    private cleanupTempFiles;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=edge-tts.d.ts.map