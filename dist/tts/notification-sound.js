import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
// Built-in notification sound presets (cross-platform WAV files in assets/)
const BUILTIN_PRESETS = [
    "melodious",
    "bright",
    "ding_ding",
    "gift",
    "light",
    "short",
    "sudden",
    "sudden_2",
    "tactful",
];
// 场景化蜂鸣提示音（移植自本机 voice-reader 项目）。
// 语法："频率Hz,时长ms" 为一声音，纯数字为静默毫秒，分号串联。
// 蜂鸣先于语音播放，可提前唤醒蓝牙音频链路。
const BEEP_PATTERNS = {
    info: "800,120;80;1200,120;150",
    success: "600,100;80;800,100;80;1200,120;150",
    error: "1000,150;80;600,150;80;400,150;200",
    warning: "800,200;100;500,200;150",
    milestone: "900,80;60;900,80;60;1200,120;150",
    single: "880,150",
};
// Resolve assets/ directory relative to the compiled dist/ layout
function getAssetsDir() {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    // dist/tts/notification-sound.js -> ../assets
    return path.resolve(moduleDir, "..", "assets");
}
function beepScript(pattern) {
    return pattern
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
            if (p.includes(",")) {
                const [freq, ms] = p.split(",");
                return `[System.Console]::Beep(${freq}, ${ms})`;
            }
            const ms = Number.parseInt(p, 10);
            return Number.isNaN(ms) ? "" : `Start-Sleep -Milliseconds ${ms}`;
        })
        .filter(Boolean)
        .join("; ");
}
export async function playNotificationSound(sound) {
    if (sound === false)
        return;
    // 场景蜂鸣：beep:info / beep:success / beep:error / beep:warning / beep:milestone
    if (typeof sound === "string" && sound.startsWith("beep:")) {
        const pattern = BEEP_PATTERNS[sound.slice(5)];
        if (!pattern || os.platform() !== "win32") {
            process.stderr.write("\x07");
            return;
        }
        await playFile("powershell", ["-NoProfile", "-c", beepScript(pattern)]);
        return;
    }
    let soundPath = null;
    if (!sound) {
        sound = "melodious";
    }
    // 1. Built-in preset (cross-platform WAV)
    if (BUILTIN_PRESETS.includes(sound)) {
        const candidate = path.join(getAssetsDir(), `${sound}.wav`);
        if (existsSync(candidate)) {
            soundPath = candidate;
        }
    }
    // 2. Custom file path
    if (!soundPath && existsSync(sound)) {
        soundPath = sound;
    }
    // 3. Beep fallback (use stderr to avoid corrupting MCP stdout protocol)
    if (sound === "beep" || !soundPath) {
        process.stderr.write("\x07");
        return;
    }
    // Play the sound file
    const playerCmd = getPlayerCommand();
    if (!playerCmd) {
        process.stderr.write("\x07");
        return;
    }
    const args = playerCmd === "powershell"
        ? ["-NoProfile", "-c", `(New-Object Media.SoundPlayer '${soundPath}').PlaySync();`]
        : [soundPath];
    await playFile(playerCmd, args);
}
function getPlayerCommand() {
    switch (os.platform()) {
        case "darwin":
            return "afplay";
        case "win32":
            return "powershell";
        case "linux":
            try {
                execSync("which aplay", { stdio: "ignore" });
                return "aplay";
            }
            catch {
                try {
                    execSync("which paplay", { stdio: "ignore" });
                    return "paplay";
                }
                catch {
                    return null;
                }
            }
        default:
            return null;
    }
}
function playFile(command, args) {
    return new Promise((resolve) => {
        let proc;
        try {
            proc = spawn(command, args, { stdio: "ignore" });
        }
        catch {
            // spawn failed (e.g. binary not found in CI), resolve silently
            return resolve();
        }
        const done = () => {
            try {
                proc.kill();
            }
            catch { /* ignore */ }
            resolve();
        };
        proc.on("close", done);
        proc.on("error", () => resolve());
        // Timeout: don't wait longer than 3s for notification sound
        setTimeout(done, 3000);
    });
}
//# sourceMappingURL=notification-sound.js.map
