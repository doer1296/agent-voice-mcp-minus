import { CloudTTSProvider, CloudTTSParams, OpenAIConfig } from "../types.js";
export declare class OpenAIProvider implements CloudTTSProvider {
    readonly type: "openai";
    private config;
    constructor(config: OpenAIConfig);
    synthesize(params: CloudTTSParams): Promise<Buffer>;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=openai.d.ts.map