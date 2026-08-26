import { ChildProcess } from "child_process";
export declare function getAudioPlayer(): {
    command: string;
    args: string[];
};
export declare function playAudioFile(filePath: string, onProcess: (proc: ChildProcess) => void): Promise<void>;
//# sourceMappingURL=audio-player.d.ts.map