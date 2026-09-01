// 云端 TTS Provider 共享的 PCM 音频工具：火山与 MiMo 两条管线复用。
// 采样格式统一为 16bit 单声道小端（火山 pcm 与 MiMo pcm16 输出一致）。
export function pcmToWav(pcm, sampleRate) {
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
export function silenceBytes(ms, sampleRate) {
    if (!ms || ms <= 0) {
        return Buffer.alloc(0);
    }
    const frames = Math.round((ms / 1000) * sampleRate);
    return Buffer.alloc(frames * 2);
}
export function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
// 长文案停顿控制（客户端实现，火山侧实测 SSML <break> 会截断音频后引入）。
// 按句切分 -> 并行合成 -> 段间插入静音。返回 null 表示无需分段。
export function splitForPauses(text, opts) {
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
//# sourceMappingURL=pcm-utils.js.map
