import { spawn } from "child_process";
function rateToSAPI(rate) {
    const normalized = (rate - 200) / 100;
    return Math.round(Math.max(-10, Math.min(10, normalized * 10)));
}
function volumeToSAPI(volume) {
    return Math.round(Math.max(0, Math.min(1, volume)) * 100);
}
function listVoicesScript() {
    return `
      Add-Type -AssemblyName System.Speech;
      $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $s.GetInstalledVoices() | ForEach-Object {
        $info = $_.VoiceInfo;
        "$($info.Name)|$($info.Culture.Name)|$($info.Gender)"
      }
    `;
}
function parseVoiceLines(stdout) {
    return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [name, culture, gender] = line.split("|");
        return { name: name || "", culture: culture || "", gender: gender || "" };
    });
}
// 中文语音检测：Culture(zh-*) 优先，名字含 huihui 兜底
// （按名字匹配会漏判 "Microsoft Huihui Desktop" 等真实中文语音）
function pickChineseVoice(voices) {
    return (voices.find((v) => v.culture.toLowerCase().startsWith("zh-")) ??
        voices.find((v) => v.name.toLowerCase().includes("huihui")));
}
export class WindowsSAPIEngine {
    currentProcess = null;
    voicesCache = null;
    async speak(text, options, onBeforePlay) {
        await this.stop();
        const voices = await this.listVoices();
        const chinese = pickChineseVoice(voices);
        if (!chinese) {
            throw new Error("Windows SAPI: 未检测到中文语音包。请在「设置 → 时间和语言 → 语音 → 添加语音」安装中文(简体)语音包后重试。");
        }
        const escapedText = text
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, " ");
        const rate = rateToSAPI(options?.rate ?? 200);
        const volume = volumeToSAPI(options?.volume ?? 1.0);
        let psScript = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`;
        psScript += ` $s.SelectVoice('${chinese.name.replace(/'/g, "''")}');`;
        psScript += ` $s.Rate = ${rate}; $s.Volume = ${volume}; $s.Speak('${escapedText}');`;
        // Play notification before starting speech (for sync engines)
        if (onBeforePlay) {
            await onBeforePlay();
        }
        return new Promise((resolve, reject) => {
            this.currentProcess = spawn("powershell", ["-NoProfile", "-Command", psScript], {
                stdio: "ignore",
            });
            this.currentProcess.on("close", (code) => {
                this.currentProcess = null;
                if (code === 0 || code === null) {
                    resolve();
                }
                else {
                    reject(new Error(`PowerShell SAPI exited with code ${code}`));
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
    async listVoices() {
        if (this.voicesCache) {
            return this.voicesCache;
        }
        const voices = await new Promise((resolve, reject) => {
            const proc = spawn("powershell", ["-NoProfile", "-Command", listVoicesScript()]);
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
                    reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
                    return;
                }
                resolve(parseVoiceLines(stdout));
            });
            proc.on("error", reject);
        });
        this.voicesCache = voices;
        return voices;
    }
    async getVoices() {
        return (await this.listVoices()).map((v) => v.name);
    }
}
//# sourceMappingURL=windows-sapi.js.map
