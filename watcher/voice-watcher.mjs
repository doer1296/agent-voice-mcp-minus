#!/usr/bin/env node
// voice-watcher.mjs — 常驻语音监听器 v6（云端豆包引擎 + SAPI 兜底）
// 轮询 pending.txt，有新内容用云端 TTS 朗读（与 agent-voice MCP 同音色、同配置、同音量）
// 说明：原 SAPI.SpVoice 本地语音响度上限低且音色差，v6 起改为云端合成，失败时自动回退 SAPI

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import net from 'net';
import os from 'os';
import path from 'path';
import { extractReadable, cleanText, PENDING, CONTROL, POLL_INTERVAL } from './lib.js';

// 单实例守卫：占用本地端口，防止登录自启与手动启动产生双实例（双实例会重复播报每条内容）
const LOCK = net.createServer();
LOCK.on('error', () => { console.error('已有 voice-watcher 实例在运行，本实例退出'); process.exit(0); });
LOCK.listen(47613, '127.0.0.1');

// 引擎与配置路径泛化：dist 为本目录的兄弟目录；配置默认 ~/.agent-voice/config.json，可用环境变量覆盖
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distModule = (rel) => pathToFileURL(path.join(PKG_ROOT, 'dist', rel)).href;
const CONFIG_PATH = process.env.AGENT_VOICE_CONFIG || path.join(os.homedir(), '.agent-voice', 'config.json');

const { CloudTTSEngine } = await import(distModule('tts/cloud/engine.js'));
const { WindowsSAPIEngine } = await import(distModule('tts/windows-sapi.js'));
const { playNotificationSound } = await import(distModule('tts/notification-sound.js'));

const TYPE_TO_SCENE = { info: 'task_start', success: 'task_complete', error: 'task_error', warning: 'need_interaction' };

console.log('Voice Reader 监听器已启动（v6 云端引擎）');
console.log(`轮询路径: ${PENDING}`);
console.log('支持类型: info / success / error / warning');

const queue = [];
let speaking = false;

function loadConfig() {
    try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); }
    catch { return {}; }
}

async function speakOne(text, type) {
    const config = loadConfig();
    const sceneKey = TYPE_TO_SCENE[type] || 'task_start';
    const scene = config.scenes?.[sceneKey] || {};
    const opts = {
        voice: scene.voice || config.cloud?.voice,
        rate: scene.rate ?? config.rate ?? 200,
        volume: scene.volume ?? config.volume ?? 1.0,
        emotion: scene.emotion,
    };
    const sound = config.sceneSounds?.[sceneKey] || 'beep:single';
    try {
        const engine = new CloudTTSEngine(config.cloud);
        await engine.speak(text, opts, () => playNotificationSound(sound));
    } catch (err) {
        console.error('云端播报失败，回退本地 SAPI:', err.message);
        try {
            await new WindowsSAPIEngine().speak(text, { rate: opts.rate, volume: 1.0 });
        } catch (e2) {
            console.error('SAPI 兜底也失败:', e2.message);
        }
    }
}

async function pump() {
    if (speaking) return;
    speaking = true;
    while (queue.length > 0) {
        const { text, type } = queue.shift();
        try { await speakOne(text, type); } catch (e) { console.error(e); }
    }
    speaking = false;
}

let lastHash = '';

setInterval(() => {
    if (existsSync(CONTROL)) return;
    const raw = extractReadable();
    if (raw && raw.text !== lastHash) {
        lastHash = raw.text;
        let cleaned = cleanText(raw.text);
        if (cleaned.length > 200) cleaned = cleaned.slice(0, 200) + ' 内容较长，已截取。';
        if (!cleaned) return;
        console.log(`[${new Date().toLocaleTimeString()}] 朗读 (${cleaned.length} 字, 类型: ${raw.type})`);
        while (queue.length >= 2) queue.shift();
        queue.push({ text: cleaned, type: raw.type });
        pump();
        try { writeFileSync(PENDING, '', 'utf8'); } catch {}
    }
}, POLL_INTERVAL);

process.stdin.resume();
