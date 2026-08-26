import { playNotificationSound } from "./tts/notification-sound.js";
const NOTIFICATION_GAP_MS = 2000;
// 播报前清洗：去除代码块/URL/Markdown 标记，避免合成时读出「井号、反引号」（移植自 voice-reader）
export function cleanSpeechText(text) {
    return String(text ?? "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();
}
// 超长截断：优先在句读处收口，避免半句突兀截断
export function truncateForSpeech(text, maxLen) {
    if (!maxLen || text.length <= maxLen) {
        return text;
    }
    const head = text.slice(0, maxLen);
    const lastStop = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"), head.lastIndexOf("；"), head.lastIndexOf("，"), head.lastIndexOf(","));
    return lastStop > maxLen / 2 ? head.slice(0, lastStop + 1) : head;
}
export class VoiceQueue {
    queue = [];
    maxSize;
    engine;
    processing = false;
    notificationSound;
    fallbackEngine = null;
    hasPlayedNotification = false;
    prevEnqueuedAt = 0;
    doneResolve = null;
    donePromise = null;
    constructor(engine, maxSize = 2, notificationSound, fallbackEngine = null) {
        this.engine = engine;
        this.maxSize = maxSize;
        this.notificationSound = notificationSound;
        this.fallbackEngine = fallbackEngine;
    }
    enqueue(text, options, notificationSound) {
        while (this.queue.length >= this.maxSize) {
            this.queue.shift();
        }
        this.queue.push({ text, options, enqueuedAt: Date.now(), notificationSound });
        this.processQueue();
    }
    stop() {
        this.queue = [];
        this.engine.stop();
    }
    async processQueue() {
        if (this.processing)
            return;
        this.processing = true;
        this.hasPlayedNotification = false;
        while (this.queue.length > 0) {
            const item = this.queue.shift();
            // If the gap between this item's enqueue time and the previous item's
            // enqueue time exceeds NOTIFICATION_GAP_MS, treat it as a new batch
            if (this.hasPlayedNotification &&
                this.prevEnqueuedAt > 0 &&
                item.enqueuedAt - this.prevEnqueuedAt > NOTIFICATION_GAP_MS) {
                this.hasPlayedNotification = false;
            }
            this.prevEnqueuedAt = item.enqueuedAt;
            let onBeforePlay;
            try {
                if (!this.hasPlayedNotification && this.notificationSound !== false) {
                    const sound = item.notificationSound ?? this.notificationSound;
                    this.hasPlayedNotification = true;
                    onBeforePlay = () => playNotificationSound(sound);
                }
                await this.engine.speak(item.text, item.options, onBeforePlay);
            }
            catch (err) {
                console.error("Voice play failed:", err instanceof Error ? err.message : err);
                // 云端失败（断网/额度耗尽/key 失效/未配置）时回退本地 SAPI，保证播报不中断
                if (this.fallbackEngine) {
                    try {
                        const sapiOptions = {
                            rate: item.options?.rate,
                            volume: item.options?.volume,
                        };
                        console.error("agent-voice: falling back to local SAPI engine");
                        await this.fallbackEngine.speak(item.text, sapiOptions, onBeforePlay);
                    }
                    catch (err2) {
                        console.error("Fallback engine failed:", err2 instanceof Error ? err2.message : err2);
                    }
                }
            }
        }
        this.processing = false;
        if (this.queue.length > 0) {
            this.processQueue();
        }
        else if (this.doneResolve) {
            this.doneResolve();
            this.doneResolve = null;
            this.donePromise = null;
        }
    }
    /** 返回一个 Promise，队列中所有语音播放完成后 resolve */
    waitForDone() {
        if (!this.processing && this.queue.length === 0) {
            return Promise.resolve();
        }
        if (!this.donePromise) {
            this.donePromise = new Promise((resolve) => {
                this.doneResolve = resolve;
            });
        }
        return this.donePromise;
    }
}
//# sourceMappingURL=voice-queue.js.map
