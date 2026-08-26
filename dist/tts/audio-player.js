import { spawn, execSync } from "child_process";
import os from "os";
function findLinuxPlayer() {
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
            return "aplay";
        }
    }
}
export function getAudioPlayer() {
    switch (os.platform()) {
        case "darwin":
            return { command: "afplay", args: [] };
        case "win32":
            return { command: "powershell", args: ["-c"] };
        case "linux":
            return { command: findLinuxPlayer(), args: [] };
        default:
            throw new Error(`Unsupported platform for audio playback: ${os.platform()}`);
    }
}
export function playAudioFile(filePath, onProcess) {
    return new Promise((resolve, reject) => {
        const { command, args } = getAudioPlayer();
        let finalArgs;
        if (command === "powershell") {
            finalArgs = [
                ...args,
                `(New-Object Media.SoundPlayer '${filePath}').PlaySync();`,
            ];
        }
        else {
            finalArgs = [...args, filePath];
        }
        const player = spawn(command, finalArgs, { stdio: "ignore" });
        onProcess(player);
        player.on("close", (code) => {
            if (code === 0 || code === null) {
                resolve();
            }
            else {
                reject(new Error(`${command} exited with code ${code}`));
            }
        });
        player.on("error", (err) => {
            reject(err);
        });
    });
}
//# sourceMappingURL=audio-player.js.map