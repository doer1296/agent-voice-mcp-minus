import type { EmotionType } from "./tts/interface.js";
import type { CloudTTSConfig } from "./tts/cloud/types.js";
export interface SceneConfig {
    voice?: string;
    rate?: number;
    volume?: number;
    emotion?: EmotionType;
    emotionIntensity?: number;
}
export type TTSEngineType = "say" | "piper" | "edge-tts" | "cloud";
export interface RoleConfig {
    /** 角色名称，如"助手"、"用户"、"系统" */
    name: string;
    /** 角色目标范围描述，如"给Trae使用"、"给Claude使用"，Agent据此自动选择角色 */
    target?: string;
    voice?: string;
    rate?: number;
    volume?: number;
    emotion?: EmotionType;
    emotionIntensity?: number;
    notificationSound?: string | false;
    scenes?: {
        task_start?: SceneConfig;
        task_complete?: SceneConfig;
        task_error?: SceneConfig;
        need_interaction?: SceneConfig;
        milestone?: SceneConfig;
    };
}
export interface AgentVoiceConfig {
    engine?: TTSEngineType;
    voice?: string;
    rate?: number;
    volume?: number;
    modelPath?: string;
    configPath?: string;
    notificationSound?: string | false;
    cloud?: CloudTTSConfig;
    scenes?: {
        task_start?: SceneConfig;
        task_complete?: SceneConfig;
        task_error?: SceneConfig;
        need_interaction?: SceneConfig;
        milestone?: SceneConfig;
    };
    /** 多角色配置（v1.1.0），支持为不同Agent/场景配置不同的TTS参数 */
    roles?: RoleConfig[];
}
export declare function loadConfig(configPath?: string): AgentVoiceConfig;
export declare function getConfigPath(customPath?: string): string;
interface ResolvedOptions {
    voice?: string;
    rate?: number;
    volume?: number;
    emotion?: EmotionType;
    emotionIntensity?: number;
}
/**
 * 根据 role 参数匹配角色配置。
 * 匹配规则（按优先级）：
 * 1. 通过 name 精确匹配
 * 2. 通过 target 字段模糊匹配（roleParam 包含在 target 中，或 target 包含在 roleParam 中）
 * 3. 未匹配到时返回第一个角色作为默认
 * 4. 无角色配置时返回 undefined
 */
export declare function resolveRole(roles: RoleConfig[] | undefined, roleParam?: string): RoleConfig | undefined;
export declare function resolveOptions(config: AgentVoiceConfig, scene?: string, override?: ResolvedOptions, role?: RoleConfig): ResolvedOptions;
export {};
//# sourceMappingURL=config.d.ts.map