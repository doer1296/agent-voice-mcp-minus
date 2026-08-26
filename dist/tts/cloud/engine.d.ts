import { TTSEngine, TTSOptions } from "../interface.js";
import { CloudTTSConfig, CloudProviderType } from "./types.js";
export declare class CloudTTSEngine implements TTSEngine {
    private provider;
    private currentProcess;
    private tempFile;
    constructor(config: CloudTTSConfig);
    get providerType(): CloudProviderType;
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    private playAudio;
    stop(): void;
    private cleanupTempFile;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=engine.d.ts.map