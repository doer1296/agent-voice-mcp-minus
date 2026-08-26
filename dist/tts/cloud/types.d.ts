export type CloudProviderType = "openai" | "volcano" | "custom";
export interface OpenAIConfig {
    provider: "openai";
    baseUrl?: string;
    apiKey: string;
    model?: string;
    voice?: string;
    timeout?: number;
}
export interface VolcanoConfig {
    provider: "volcano";
    token: string;
    appId: string;
    voice?: string;
    cluster?: string;
    timeout?: number;
}
export interface CustomHTTPConfig {
    provider: "custom";
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyTemplate: string;
    responseType?: "binary" | "json";
    responseAudioField?: string;
    timeout?: number;
}
export type CloudTTSConfig = OpenAIConfig | VolcanoConfig | CustomHTTPConfig;
export interface CloudTTSParams {
    text: string;
    voice?: string;
    rate?: number;
    volume?: number;
}
export interface CloudTTSProvider {
    readonly type: CloudProviderType;
    synthesize(params: CloudTTSParams): Promise<Buffer>;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=types.d.ts.map