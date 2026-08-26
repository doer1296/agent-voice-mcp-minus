import { TTSEngine } from "./interface.js";
import type { CloudTTSConfig } from "./cloud/types.js";
export interface EngineOptions {
    engine?: string;
    modelPath?: string;
    configPath?: string;
    cloud?: CloudTTSConfig;
}
export declare function createTTSEngine(options?: EngineOptions): TTSEngine;
//# sourceMappingURL=factory.d.ts.map