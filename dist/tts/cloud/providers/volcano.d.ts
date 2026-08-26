import { CloudTTSProvider, CloudTTSParams, VolcanoConfig } from "../types.js";
export declare class VolcanoProvider implements CloudTTSProvider {
    readonly type: "volcano";
    private config;
    constructor(config: VolcanoConfig);
    synthesize(params: CloudTTSParams): Promise<Buffer>;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=volcano.d.ts.map