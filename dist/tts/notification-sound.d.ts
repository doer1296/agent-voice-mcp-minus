declare const BUILTIN_PRESETS: readonly ["melodious", "bright", "ding_ding", "gift", "light", "short", "sudden", "sudden_2", "tactful"];
export type NotificationSoundPreset = (typeof BUILTIN_PRESETS)[number] | "beep" | "none";
export declare function playNotificationSound(sound?: string | false): Promise<void>;
export {};
//# sourceMappingURL=notification-sound.d.ts.map