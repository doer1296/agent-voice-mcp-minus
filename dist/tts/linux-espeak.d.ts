import { TTSEngine, TTSOptions } from "./interface.js";
export declare class LinuxEspeakEngine implements TTSEngine {
    private currentProcess;
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    stop(): void;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=linux-espeak.d.ts.map