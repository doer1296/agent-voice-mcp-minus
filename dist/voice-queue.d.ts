import { TTSEngine, TTSOptions } from "./tts/interface.js";
export declare class VoiceQueue {
    private queue;
    private maxSize;
    private engine;
    private processing;
    private notificationSound?;
    private hasPlayedNotification;
    private prevEnqueuedAt;
    private doneResolve;
    private donePromise;
    constructor(engine: TTSEngine, maxSize?: number, notificationSound?: string | false);
    enqueue(text: string, options?: TTSOptions, notificationSound?: string | false): void;
    stop(): void;
    private processQueue;
    /** 返回一个 Promise，队列中所有语音播放完成后 resolve */
    waitForDone(): Promise<void>;
}
//# sourceMappingURL=voice-queue.d.ts.map