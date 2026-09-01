import { existsSync, readFileSync } from "fs";
import path from "path";
import os from "os";
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".agent-voice", "config.json");
const DEFAULT_CONFIG = {
    voice: undefined,
    rate: 200,
    volume: 1.0,
};
let cachedConfig = null;
function resolveEnvVars(obj) {
    if (typeof obj === "string") {
        return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? `\${${name}}`);
    }
    if (Array.isArray(obj)) {
        return obj.map(resolveEnvVars);
    }
    if (obj !== null && typeof obj === "object") {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = resolveEnvVars(value);
        }
        return result;
    }
    return obj;
}
// 未设置的环境变量会保留 ${VAR} 字面量，若不剥离会被下游当作「已配置的 Key」
// （首次调用才发现 401 才降级）。这里统一清理为 undefined，让调用方走「未配置」分支。
function stripUnresolvedEnvLiterals(obj) {
    if (typeof obj === "string") {
        return /\$\{[^}]+\}/.test(obj) ? undefined : obj;
    }
    if (Array.isArray(obj)) {
        return obj;
    }
    if (obj !== null && typeof obj === "object") {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = stripUnresolvedEnvLiterals(value);
        }
        return result;
    }
    return obj;
}
export function loadConfig(configPath) {
    const resolvedPath = configPath || DEFAULT_CONFIG_PATH;
    if (!configPath && cachedConfig)
        return cachedConfig;
    let fileConfig = {};
    if (existsSync(resolvedPath)) {
        try {
            fileConfig = JSON.parse(readFileSync(resolvedPath, "utf-8"));
            fileConfig = stripUnresolvedEnvLiterals(resolveEnvVars(fileConfig));
            if (fileConfig.cloud?.apiKey === undefined && existsSync(resolvedPath)) {
                // 占位符未被环境变量替换：提示后按未配置处理（不会发起注定 401 的请求）
                console.error(`agent-voice: cloud.apiKey 引用了未设置的环境变量（${resolvedPath}），按未配置处理`);
            }
        }
        catch {
            console.error(`Failed to parse config file: ${resolvedPath}, using defaults`);
        }
    }
    cachedConfig = { ...DEFAULT_CONFIG, ...fileConfig };
    return cachedConfig;
}
export function getConfigPath(customPath) {
    return customPath || DEFAULT_CONFIG_PATH;
}
/**
 * 根据 role 参数匹配角色配置。
 * 匹配规则（按优先级）：
 * 1. 通过 name 精确匹配
 * 2. 通过 target 字段模糊匹配（roleParam 包含在 target 中，或 target 包含在 roleParam 中）
 * 3. 未匹配到时返回第一个角色作为默认
 * 4. 无角色配置时返回 undefined
 */
export function resolveRole(roles, roleParam) {
    if (!roles || roles.length === 0)
        return undefined;
    if (!roleParam)
        return roles[0];
    // 1. 精确匹配 name
    const nameMatch = roles.find(r => r.name === roleParam);
    if (nameMatch)
        return nameMatch;
    // 2. 模糊匹配 target（双向包含）
    const targetMatch = roles.find(r => {
        if (!r.target)
            return false;
        return r.target.includes(roleParam) || roleParam.includes(r.target);
    });
    if (targetMatch)
        return targetMatch;
    // 3. 未匹配到，使用第一个角色
    return roles[0];
}
export function resolveOptions(config, scene, override, role) {
    // 基础值：角色配置 > 全局配置
    const result = {
        voice: role?.voice ?? config.voice,
        rate: role?.rate ?? config.rate,
        volume: role?.volume ?? config.volume,
        emotion: role?.emotion,
        emotionIntensity: role?.emotionIntensity,
    };
    // 场景配置：角色场景 > 全局场景
    if (scene) {
        // 先应用全局场景配置
        if (config.scenes) {
            const globalScene = config.scenes[scene];
            if (globalScene) {
                if (globalScene.voice !== undefined)
                    result.voice = globalScene.voice;
                if (globalScene.rate !== undefined)
                    result.rate = globalScene.rate;
                if (globalScene.volume !== undefined)
                    result.volume = globalScene.volume;
                if (globalScene.emotion !== undefined)
                    result.emotion = globalScene.emotion;
                if (globalScene.emotionIntensity !== undefined)
                    result.emotionIntensity = globalScene.emotionIntensity;
            }
        }
        // 再应用角色场景配置（覆盖全局场景）
        if (role?.scenes) {
            const roleScene = role.scenes[scene];
            if (roleScene) {
                if (roleScene.voice !== undefined)
                    result.voice = roleScene.voice;
                if (roleScene.rate !== undefined)
                    result.rate = roleScene.rate;
                if (roleScene.volume !== undefined)
                    result.volume = roleScene.volume;
                if (roleScene.emotion !== undefined)
                    result.emotion = roleScene.emotion;
                if (roleScene.emotionIntensity !== undefined)
                    result.emotionIntensity = roleScene.emotionIntensity;
            }
        }
    }
    // 调用时参数覆盖（最高优先级）
    if (override?.voice !== undefined)
        result.voice = override.voice;
    if (override?.rate !== undefined)
        result.rate = override.rate;
    if (override?.volume !== undefined)
        result.volume = override.volume;
    if (override?.emotion !== undefined)
        result.emotion = override.emotion;
    if (override?.emotionIntensity !== undefined)
        result.emotionIntensity = override.emotionIntensity;
    return result;
}
//# sourceMappingURL=config.js.map