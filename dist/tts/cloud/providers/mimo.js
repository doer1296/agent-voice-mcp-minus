import { pcmToWav, silenceBytes, splitForPauses } from "./pcm-utils.js";
// MiMo V2.5 TTS（小米开放平台，OpenAI 兼容端点）。
// 与火山的参数面完全不同：无数值型 rate/volume/pitch，控制面是自然语言指令
// （role:user 消息，模型按「导演指示」演绎）+ 音频标签。数值参数在客户端量化为指令。
const ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions";
const SAMPLE_RATE = 24000; // MiMo pcm16 固定 24kHz/16bit 单声道，与火山管线一致
const MODEL = "mimo-v2.5-tts";
// 预置音色白名单（官方文档）。中文音色的 Voice ID 即中文名。
// 防串用（B4）：非白名单音色（如火山 zh_female_*）回退配置音色。
const VOICE_WHITELIST = new Set([
    "mimo_default",
    "冰糖",
    "茉莉",
    "苏打",
    "白桦",
    "Mia",
    "Chloe",
    "Milo",
    "Dean",
]);
const VOICE_META = [
    { voice: "mimo_default", lang: "zh", gender: "female", note: "默认音色" },
    { voice: "冰糖", lang: "zh", gender: "female", note: "甜美女声" },
    { voice: "茉莉", lang: "zh", gender: "female", note: "温柔女声" },
    { voice: "苏打", lang: "zh", gender: "male", note: "清爽男声" },
    { voice: "白桦", lang: "zh", gender: "male", note: "沉稳男声" },
    { voice: "Mia", lang: "en", gender: "female", note: "英文女声" },
    { voice: "Chloe", lang: "en", gender: "female", note: "英文女声" },
    { voice: "Milo", lang: "en", gender: "male", note: "英文男声" },
    { voice: "Dean", lang: "en", gender: "male", note: "英文男声" },
];
// 情绪 → 自然语言指令。可被 config.cloud.mimo.emotionPrompts 逐条覆盖。
const DEFAULT_EMOTION_PROMPTS = {
    neutral: "",
    happy: "用轻快上扬、充满喜悦的语气朗读，声音明亮有活力",
    sad: "用低沉缓慢、略带哀伤的语气朗读",
    angry: "用急促有力、语气严厉的方式朗读",
    calm: "用平稳温和、从容不迫的语气朗读",
    excited: "用兴奋高涨、充满感染力的语气朗读",
};
// 情感强度 → 副词修饰（数值强度翻译为语气副词）
function intensityAdverb(k) {
    if (k === undefined || k === null) {
        return "";
    }
    if (k < 0.4) {
        return "，情绪点到为止、略带即可";
    }
    if (k > 0.7) {
        return "，情绪表达要非常明显和强烈";
    }
    return "";
}
// 语速 → 四档指令（粒度粗是模型硬限制，非精确数值控制）
function speedInstruction(rate) {
    if (rate === undefined) {
        return "";
    }
    if (rate < 170) {
        return "语速从容偏慢";
    }
    if (rate <= 230) {
        return "";
    }
    if (rate <= 260) {
        return "语速稍快";
    }
    return "语速很快";
}
// 音量 → 轻量指令（无幅度控制，播放端无增益，仅指令级效果）
function volumeInstruction(volume) {
    if (volume === undefined) {
        return "";
    }
    if (volume > 1.15) {
        return "声音明亮洪亮";
    }
    if (volume < 0.85) {
        return "轻声细语";
    }
    return "";
}
export class MiMoProvider {
    type = "mimo";
    config;
    constructor(config) {
        this.config = config;
    }
    buildStyleInstruction(params) {
        const custom = this.config.emotionPrompts || {};
        const prompts = { ...DEFAULT_EMOTION_PROMPTS, ...custom };
        const parts = [];
        const emotionKey = params.emotion && prompts[params.emotion] !== undefined ? params.emotion : "neutral";
        const emotionText = prompts[emotionKey];
        if (emotionText) {
            parts.push(`${emotionText}${intensityAdverb(params.emotionIntensity)}`);
        }
        // 场景导演指令（差异化能力）：config.cloud.mimo.scenePrompts[scene]
        const scenePrompt = params.scene && this.config.scenePrompts?.[params.scene];
        if (scenePrompt) {
            parts.push(scenePrompt);
        }
        const acoustic = [speedInstruction(params.rate), volumeInstruction(params.volume)].filter(Boolean).join("，");
        if (acoustic) {
            parts.push(acoustic);
        }
        return parts.join("；");
    }
    async synthesize(params) {
        const apiKey = this.config.apiKey;
        if (!apiKey) {
            throw new Error("MiMo TTS: missing apiKey (config.cloud.mimo.apiKey)");
        }
        let voice = params.voice || this.config.voice || "mimo_default";
        if (!VOICE_WHITELIST.has(voice)) {
            const fallback = this.config.voice || "mimo_default";
            console.error(`agent-voice: voice "${voice}" 不是 MiMo 音色，回退为 ${fallback}`);
            voice = fallback;
        }
        const instruction = this.buildStyleInstruction(params);
        const lead = this.config.leadingSilence || 0;
        const pauseControl = this.config.pauseControl ?? true;
        const timeout = this.config.timeout || 30000;
        const segs = pauseControl
            ? splitForPauses(params.text, {
                sentenceMs: this.config.pauseSentenceMs ?? 400,
                commaMs: this.config.pauseCommaMs ?? 200,
            })
            : null;
        if (segs) {
            const results = await Promise.allSettled(segs.map((seg) => this.synthOnce(seg.text, instruction, voice, apiKey, timeout)));
            if (results.every((r) => r.status === "fulfilled")) {
                const pieces = [silenceBytes(lead, SAMPLE_RATE)];
                results.forEach((r, i) => {
                    pieces.push(r.value);
                    if (i < results.length - 1) {
                        pieces.push(silenceBytes(segs[i].pauseAfterMs, SAMPLE_RATE));
                    }
                });
                return pcmToWav(Buffer.concat(pieces), SAMPLE_RATE);
            }
            // 分段合成失败：降级为整段单次合成，保证有声音可播
        }
        const pcm = await this.synthOnce(params.text, instruction, voice, apiKey, timeout);
        return pcmToWav(Buffer.concat([silenceBytes(lead, SAMPLE_RATE), pcm]), SAMPLE_RATE);
    }
    async synthOnce(text, instruction, voice, apiKey, timeout) {
        const messages = [];
        if (instruction) {
            // 调用规则（官方红线）：风格指令放 user，目标文本放 assistant
            messages.push({ role: "user", content: instruction });
        }
        messages.push({ role: "assistant", content: String(text ?? "") });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: this.config.model || MODEL,
                    messages,
                    audio: { format: "pcm16", voice },
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const errText = (await res.text().catch(() => "")).slice(0, 300);
                throw new Error(`MiMo TTS: HTTP ${res.status} ${errText}`);
            }
            const data = await res.json();
            // 红线：HTTP 200 但缺音频数据必须显式报错，不能静默失败
            const audioB64 = data?.choices?.[0]?.message?.audio?.data;
            if (!audioB64) {
                throw new Error(`MiMo TTS: HTTP 200 但响应缺少音频数据（choices[0].message.audio.data），响应片段：${JSON.stringify(data).slice(0, 200)}`);
            }
            return Buffer.from(audioB64, "base64");
        }
        catch (err) {
            if (err instanceof Error && err.message.startsWith("MiMo TTS")) {
                throw err;
            }
            throw new Error(`MiMo TTS: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async getVoices() {
        return VOICE_META;
    }
}
//# sourceMappingURL=mimo.js.map
