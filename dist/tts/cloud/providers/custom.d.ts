import { CloudTTSProvider, CloudTTSParams, CustomHTTPConfig } from "../types.js";
export declare class CustomHTTPProvider implements CloudTTSProvider {
    readonly type: "custom";
    private config;
    constructor(config: CustomHTTPConfig);
    synthesize(params: CloudTTSParams): Promise<Buffer>;
    private renderTemplate;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=custom.d.ts.map