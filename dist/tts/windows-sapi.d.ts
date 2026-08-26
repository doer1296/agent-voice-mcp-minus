import { TTSEngine, TTSOptions } from "./interface.js";
export declare class WindowsSAPIEngine implements TTSEngine {
    private currentProcess;
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    stop(): void;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=windows-sapi.d.ts.map