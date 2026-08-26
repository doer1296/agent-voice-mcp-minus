export type EmotionType = "neutral" | "happy" | "sad" | "angry" | "calm" | "excited";
export interface TTSOptions {
    voice?: string;
    rate?: number;
    volume?: number;
    emotion?: EmotionType;
    emotionIntensity?: number;
}
export interface TTSEngine {
    speak(text: string, options?: TTSOptions, onBeforePlay?: () => Promise<void>): Promise<void>;
    stop(): void;
    getVoices(): Promise<string[]>;
}
//# sourceMappingURL=interface.d.ts.map