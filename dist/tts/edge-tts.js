import { spawn, execSync } from "child_process";
import { unlinkSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { playAudioFile } from "./audio-player.js";
function findEdgeTtsPath() {
    const home = process.env.HOME;
    if (home) {
        const pythonVersions = ["3.12", "3.11", "3.10", "3.9"];
        for (const ver of pythonVersions) {
            const candidate = path.join(home, "Library/Python", ver, "bin/edge-tts");
            if (existsSync(candidate))
                return candidate;
        }
    }
    try {
        return execSync("which edge-tts", { encoding: "utf-8" }).trim();
    }
    catch {
        return "edge-tts";
    }
}
const EDGE_TTS_PATH = findEdgeTtsPath();
const EMOTION_STYLE_MAP = {
    happy: "cheerful",
    sad: "sad",
    angry: "angry",
    calm: "calm",
    excited: "excited",
};
export class EdgeTTSEngine {
    currentProcess = null;
    tempFiles = [];
    async speak(text, options, onBeforePlay) {
        await this.stop();
        // Play notification before starting speech (for sync engines)
        if (onBeforePlay) {
            await onBeforePlay();
        }
        const audioFile = path.join(tmpdir(), `agent-voice-edge-${Date.now()}.mp3`);
        this.tempFiles.push(audioFile);
        const resolvedVoice = options?.voice || "zh-CN-XiaoxiaoNeural";
        const rate = options?.rate ?? 200;
        const ratePercent = Math.round(((rate - 200) / 200) * 100);
        const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
        const volume = options?.volume !== undefined
            ? Math.round((options.volume - 1) * 100)
            : 0;
        const volumeStr = volume >= 0 ? `+${volume}%` : `${volume}%`;
        let finalArgs;
        if (options?.emotion && options.emotion !== "neutral") {
            const style = EMOTION_STYLE_MAP[options.emotion];
            if (style) {
                const styleDegree = options.emotionIntensity ?? 1.0;
                const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"><voice name="${resolvedVoice}"><mstts:express-as style="${style}" styledegree="${styleDegree}"><prosody rate="${rateStr}" volume="${volumeStr}">${text}</prosody></mstts:express-as></voice></speak>`;
                // Write SSML to temp file to avoid argument-length issues
                const ssmlFile = path.join(tmpdir(), `agent-voice-edge-ssml-${Date.now()}.txt`);
                this.tempFiles.push(ssmlFile);
                writeFileSync(ssmlFile, ssml, "utf-8");
                finalArgs = ["-f", ssmlFile, "--write-media", audioFile];
                return this.runEdgeTts(audioFile, finalArgs);
            }
        }
        finalArgs = [
            "-t", text,
            "--voice=" + resolvedVoice,
            "--rate=" + rateStr,
            "--volume=" + volumeStr,
            "--write-media", audioFile,
        ];
        return this.runEdgeTts(audioFile, finalArgs);
    }
    runEdgeTts(audioFile, args) {
        return new Promise((resolve, reject) => {
            const proc = spawn(EDGE_TTS_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
            this.currentProcess = proc;
            let stderr = "";
            proc.stderr?.on("data", (data) => {
                stderr += data.toString();
            });
            proc.on("close", (code) => {
                this.currentProcess = null;
                if (code !== 0 && code !== null) {
                    reject(new Error(`edge-tts exited with code ${code}: ${stderr}`));
                    return;
                }
                if (!existsSync(audioFile)) {
                    reject(new Error("edge-tts did not produce output file"));
                    return;
                }
                playAudioFile(audioFile, (player) => {
                    this.currentProcess = player;
                }).then(() => {
                    this.currentProcess = null;
                    this.cleanupTempFiles();
                    resolve();
                }).catch((err) => {
                    this.currentProcess = null;
                    this.cleanupTempFiles();
                    reject(err);
                });
            });
            proc.on("error", (err) => {
                this.currentProcess = null;
                this.cleanupTempFiles();
                reject(err);
            });
        });
    }
    stop() {
        if (this.currentProcess) {
            this.currentProcess.kill("SIGTERM");
            this.currentProcess = null;
        }
        this.cleanupTempFiles();
    }
    cleanupTempFiles() {
        for (const file of this.tempFiles) {
            try {
                if (existsSync(file)) {
                    unlinkSync(file);
                }
            }
            catch {
                // ignore cleanup errors
            }
        }
        this.tempFiles = [];
    }
    async getVoices() {
        return new Promise((resolve, reject) => {
            const proc = spawn(EDGE_TTS_PATH, ["--list-voices"]);
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
                    reject(new Error(`edge-tts --list-voices exited with code ${code}: ${stderr}`));
                    return;
                }
                try {
                    const voices = JSON.parse(stdout);
                    resolve(voices.map((v) => v.ShortName));
                }
                catch {
                    const lines = stdout.split("\n").filter(Boolean);
                    resolve(lines);
                }
            });
            proc.on("error", reject);
        });
    }
}
//# sourceMappingURL=edge-tts.js.map