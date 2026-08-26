import { TTSEngine, TTSOptions } from "./interface.js";
export declare class MacOSSayEngine implements TTSEngine {
    private currentProcess;
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    stop(): void;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=macos-say.d.ts.map