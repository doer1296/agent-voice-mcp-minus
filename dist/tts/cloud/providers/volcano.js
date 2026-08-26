function fixWavDataSize(buffer) {
    // Seed TTS streaming 返回的 WAV，data 子块长度字段可能为 0xFFFFFFFF 占位，
    // Media.SoundPlayer 校验严格会拒绝。这里修正 data 子块长度与 RIFF 总长。
    if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
        return buffer;
    }
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        if (chunkId === "data") {
            const actual = buffer.length - dataStart;
            buffer.writeUInt32LE(actual, offset + 4);
            buffer.writeUInt32LE(buffer.length - 8, 4);
            break;
        }
        offset = dataStart + chunkSize + (chunkSize % 2);
    }
    return buffer;
}

// 文档推荐流式场景使用 pcm，但 agent-voice 的播放器（Media.SoundPlayer）只支持 WAV。
// 这里把流式拼接后的裸 PCM 数据一次性封装为合法的 RIFF/WAVE 容器（16bit 单声道小端），
// 既享受 pcm 无多头部拼接噪声的优势，又能兼容现有播放逻辑。
function pcmToWav(pcm, sampleRate) {
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // 单声道
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byteRate = sampleRate * channels * bytesPerSample
    header.writeUInt16LE(2, 32); // blockAlign
    header.writeUInt16LE(16, 34); // bitsPerSample
    header.write("data", 36, "ascii");
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcm]);
}

// 生成指定毫秒的静音（16bit 单声道，全零即静音）。
// 既用于蓝牙连接时播报前的前导静音，也用于长文案的段间停顿。
function silenceBytes(ms, sampleRate) {
    if (!ms || ms <= 0) {
        return Buffer.alloc(0);
    }
    const frames = Math.round((ms / 1000) * sampleRate);
    return Buffer.alloc(frames * 2); // 16bit 单声道，每帧 2 字节
}

// v3 unidirectional 接口没有原生 emotion 字段（实测传入后被服务端静默忽略），
// 情绪通道改用文档支持的声学参数组合表达：post_process.pitch + speech_rate / loudness_rate 偏移。
const EMOTION_PROFILE = {
    neutral: { pitch: 0, rate: 0, loudness: 0 },
    happy: { pitch: 2, rate: 3, loudness: 2 },
    sad: { pitch: -2, rate: -6, loudness: -4 },
    angry: { pitch: 1, rate: 4, loudness: 6 },
    calm: { pitch: -1, rate: -4, loudness: -2 },
    excited: { pitch: 3, rate: 8, loudness: 3 },
};

function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

// 长文案停顿控制（客户端实现）。
// SSML <break> 在 seed-tts-1.0 + v3 单向流式接口实测会截断音频（整段只剩第一句），
// 故改为：按句切分 -> 并行合成 -> 段间插入静音。返回 null 表示无需分段。
function splitForPauses(text, opts) {
    const { sentenceMs = 400, commaMs = 200, minChars = 40, maxSegs = 4 } = opts || {};
    const trimmed = String(text || "").trim();
    if (trimmed.length < minChars) {
        return null;
    }
    const segs = [];
    const splitByComma = (s, endMs) => {
        const subs = s.split(/(?<=[，、；])/).map((x) => x.trim()).filter(Boolean);
        if (subs.length < 2) {
            return false;
        }
        subs.forEach((sub, i) => {
            segs.push({ text: sub, pauseAfterMs: i < subs.length - 1 ? commaMs : endMs });
        });
        return true;
    };
    const bySentence = trimmed.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
    if (bySentence.length >= 2) {
        for (const s of bySentence) {
            // 超长句内部再按逗号细切，停顿更有层次
            if (s.length > 50 && splitByComma(s, sentenceMs)) {
                continue;
            }
            segs.push({ text: s, pauseAfterMs: sentenceMs });
        }
    }
    else if (trimmed.length >= 60 && splitByComma(trimmed, 0)) {
        // 单个超长句（无句号）：仅按逗号切分
    }
    else {
        return null;
    }
    if (segs.length > maxSegs) {
        // 句子过多时合并尾部，控制并发请求数
        const head = segs.slice(0, maxSegs - 1);
        head.push({ text: segs.slice(maxSegs - 1).map((s) => s.text).join(""), pauseAfterMs: 0 });
        segs.length = 0;
        segs.push(...head);
    }
    else {
        segs[segs.length - 1].pauseAfterMs = 0; // 末段静音由 silence_duration 负责
    }
    return segs.length >= 2 ? segs : null;
}

export class VolcanoProvider {
    type = "volcano";
    config;
    constructor(config) {
        this.config = config;
    }
    async synthesize(params) {
        const voice = params.voice || this.config.voice || "zh_female_tianmeixiaoyuan_uranus_bigtts";
        const apiKey = this.config.apiKey || this.config.token;
        if (!apiKey) {
            throw new Error("Volcano TTS: missing apiKey (config.cloud.apiKey)");
        }
        const resourceId = this.config.resourceId || "seed-tts-2.0";
        const format = this.config.format || "wav";
        const sampleRate = this.config.sampleRate || 24000;
        const speechRate = params.rate ? Math.round((params.rate / 200 - 1) * 100) : 0;
        const loudnessRate = params.volume !== undefined ? Math.round((params.volume - 1) * 100) : 0;
        const emotionProfile = params.emotion ? EMOTION_PROFILE[params.emotion] : undefined;
        let pitch = 0;
        let finalSpeechRate = speechRate;
        let finalLoudnessRate = loudnessRate;
        if (emotionProfile) {
            const k = params.emotionIntensity ?? 0.7;
            pitch = clampInt(Math.round(emotionProfile.pitch * k), -12, 12);
            finalSpeechRate = clampInt(speechRate + Math.round(emotionProfile.rate * k), -50, 100);
            finalLoudnessRate = clampInt(loudnessRate + Math.round(emotionProfile.loudness * k), -50, 100);
        }
        const silenceDuration = this.config.silenceDuration ?? 400;
        const ctx = {
            apiKey,
            resourceId,
            voice,
            format,
            sampleRate,
            finalSpeechRate,
            finalLoudnessRate,
            pitch,
            disableMarkdownFilter: this.config.disableMarkdownFilter ?? true,
            disableEmojiFilter: this.config.disableEmojiFilter ?? true,
            timeout: this.config.timeout || 30000,
        };
        const lead = this.config.leadingSilence || 0;
        const pauseControl = this.config.pauseControl ?? true;
        const segs = pauseControl && format === "pcm"
            ? splitForPauses(params.text, {
                sentenceMs: this.config.pauseSentenceMs ?? 400,
                commaMs: this.config.pauseCommaMs ?? 200,
            })
            : null;
        if (segs) {
            // 各段相互独立，并行合成，总时延与单次请求相当
            const results = await Promise.allSettled(segs.map((seg, i) => this.synthOnce(seg.text, ctx, i === segs.length - 1 ? silenceDuration : 0)));
            if (results.every((r) => r.status === "fulfilled")) {
                const pieces = [silenceBytes(lead, sampleRate)];
                results.forEach((r, i) => {
                    pieces.push(r.value);
                    if (i < results.length - 1) {
                        pieces.push(silenceBytes(segs[i].pauseAfterMs, sampleRate));
                    }
                });
                return pcmToWav(Buffer.concat(pieces), sampleRate);
            }
            // 分段合成失败（如限流）：降级为整段单次合成，保证有声音可播
        }
        const audio = await this.synthOnce(params.text, ctx, silenceDuration);
        // pcm 为裸流数据，拼接后整体封装为 WAV；wav 则是多头部，仅修正 data 长度占位。
        if (format === "pcm") {
            // 蓝牙连接时，提前加入前导静音，避免播报开头被连接噪声吞掉。
            return pcmToWav(Buffer.concat([silenceBytes(lead, sampleRate), audio]), sampleRate);
        }
        return fixWavDataSize(audio);
    }
    async synthOnce(text, ctx, silenceDuration) {
        const bodyObj = {
            req_params: {
                text,
                speaker: ctx.voice,
                silence_duration: silenceDuration,
                disable_markdown_filter: ctx.disableMarkdownFilter,
                disable_emoji_filter: ctx.disableEmojiFilter,
                audio_params: {
                    format: ctx.format,
                    sample_rate: ctx.sampleRate,
                    speech_rate: ctx.finalSpeechRate,
                    loudness_rate: ctx.finalLoudnessRate,
                },
            },
        };
        if (ctx.pitch !== 0) {
            bodyObj.req_params.post_process = { pitch: ctx.pitch };
        }
        const body = JSON.stringify(bodyObj);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ctx.timeout);
        try {
            const response = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
                method: "POST",
                headers: {
                    "X-Api-Key": ctx.apiKey,
                    "X-Api-Resource-Id": ctx.resourceId,
                    "X-Api-Request-Id": `agent-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    "Content-Type": "application/json",
                },
                body,
                signal: controller.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                throw new Error(`Volcano TTS HTTP ${response.status}: ${errText}`);
            }
            const chunks = [];
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (!line)
                        continue;
                    const data = JSON.parse(line);
                    const SUCCESS_CODES = [0, 20000000];
                    if (!SUCCESS_CODES.includes(data.code)) {
                        throw new Error(`Volcano TTS API error: code=${data.code}, message=${data.message}`);
                    }
                    if (data.data) {
                        chunks.push(Buffer.from(data.data, "base64"));
                    }
                }
            }
            if (chunks.length === 0) {
                throw new Error("Volcano TTS response missing audio data");
            }
            return Buffer.concat(chunks);
        }
        catch (err) {
            if (err instanceof Error && err.message.startsWith("Volcano TTS")) {
                throw err;
            }
            throw new Error(`Volcano TTS: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async getVoices() {
        return [];
    }
}
//# sourceMappingURL=volcano.js.map
