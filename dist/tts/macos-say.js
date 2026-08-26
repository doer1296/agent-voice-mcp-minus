import { spawn } from "child_process";
const EMOTION_VOICE_OVERRIDES = {
    happy: { rateAdjust: 1.15 },
    sad: { voice: "Whisper", rateAdjust: 0.75 },
    angry: { voice: "Bad News", rateAdjust: 1.1 },
    calm: { voice: "Whisper", rateAdjust: 0.85 },
    excited: { rateAdjust: 1.25 },
};
export class MacOSSayEngine {
    currentProcess = null;
    async speak(text, options, onBeforePlay) {
        await this.stop();
        // Play notification before starting speech (for sync engines)
        if (onBeforePlay) {
            await onBeforePlay();
        }
        let resolvedOptions = { ...options };
        if (options?.emotion && options.emotion !== "neutral") {
            const mapping = EMOTION_VOICE_OVERRIDES[options.emotion];
            if (mapping) {
                const intensity = options.emotionIntensity ?? 1.0;
                if (mapping.voice && !resolvedOptions.voice) {
                    resolvedOptions.voice = mapping.voice;
                }
                if (mapping.rateAdjust) {
                    const baseRate = resolvedOptions.rate ?? 200;
                    const adjusted = baseRate * (1 + (mapping.rateAdjust - 1) * intensity);
                    resolvedOptions.rate = Math.max(50, Math.min(300, Math.round(adjusted)));
                }
            }
        }
        const args = [];
        if (resolvedOptions.voice) {
            args.push("-v", resolvedOptions.voice);
        }
        if (resolvedOptions.rate !== undefined) {
            const rate = Math.max(50, Math.min(300, Math.round(resolvedOptions.rate)));
            args.push("-r", String(rate));
        }
        if (resolvedOptions.volume !== undefined) {
            const vol = Math.max(0, Math.min(1, resolvedOptions.volume)).toFixed(2);
            text = `[[volm ${vol}]] ${text}`;
        }
        args.push(text);
        return new Promise((resolve, reject) => {
            this.currentProcess = spawn("say", args, { stdio: "ignore" });
            this.currentProcess.on("close", (code) => {
                this.currentProcess = null;
                if (code === 0 || code === null) {
                    resolve();
                }
                else {
                    reject(new Error(`say command exited with code ${code}`));
                }
            });
            this.currentProcess.on("error", (err) => {
                this.currentProcess = null;
                reject(err);
            });
        });
    }
    stop() {
        if (this.currentProcess) {
            this.currentProcess.kill("SIGTERM");
            this.currentProcess = null;
        }
    }
    async getVoices() {
        return new Promise((resolve, reject) => {
            const proc = spawn("say", ["-v", "?"]);
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (data) => {
                stdout += data.toString();
            });
            proc.stderr.on("data", (data) => {
                stderr += data.toString();
            });
            proc.on("close", (code) => {
                if (code !== 0 && code !== null) {
                    reject(new Error(`say -v ? exited with code ${code}: ${stderr}`));
                    return;
                }
                const voices = stdout
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line) => {
                    const parts = line.split(/\s+/);
                    const langIdx = parts.findIndex((p) => /^[a-z]{2}_[A-Z]{2}$/.test(p));
                    if (langIdx === -1)
                        return parts[0];
                    return parts.slice(0, langIdx).join(" ");
                })
                    .filter(Boolean);
                resolve(voices);
            });
            proc.on("error", reject);
        });
    }
}
//# sourceMappingURL=macos-say.js.map