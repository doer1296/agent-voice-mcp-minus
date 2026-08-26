export class OpenAIProvider {
    type = "openai";
    config;
    constructor(config) {
        this.config = config;
    }
    async synthesize(params) {
        const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
        const model = params.voice || this.config.voice || "tts-1";
        const voice = params.voice || "alloy";
        let speed = 1.0;
        if (params.rate !== undefined) {
            speed = Math.max(0.25, Math.min(4.0, params.rate / 200));
        }
        const body = JSON.stringify({
            model,
            input: params.text,
            voice,
            speed: Math.round(speed * 100) / 100,
        });
        const controller = new AbortController();
        const timeout = this.config.timeout || 30000;
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(`${baseUrl}/audio/speech`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.config.apiKey}`,
                    "Content-Type": "application/json",
                },
                body,
                signal: controller.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                throw new Error(`OpenAI TTS HTTP ${response.status}: ${errText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async getVoices() {
        return ["tts-1", "tts-1-hd", "alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    }
}
//# sourceMappingURL=openai.js.map