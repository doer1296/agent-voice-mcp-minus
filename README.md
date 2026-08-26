# agent-voice-mcp-minus

> **agent-voice-mcp 增强版** · 本地 MCP 语音播报服务，为 AI 编程助手（Trae / Claude Desktop / Cursor 等）提供任务进度的语音播报能力，深度适配火山引擎豆包语音合成大模型（seed-tts）。
>
> 本项目 fork 自 [al96169/agent-voice-mcp](https://github.com/al96169/agent-voice-mcp)（作者 Antonio Liang，MIT 协议），在其基础上针对火山引擎 v3 接口与真实使用场景做了大量实测调优。**原版是本体，本项目是本体 + 实战增强**，全部增强均可通过配置开关关闭、回退到接近原版的行为。

---

## 增强特性（相对原版 1.2.0）

| 特性 | 说明 |
|------|------|
| 火山 v3 流式接口 | 适配 `/api/v3/tts/unidirectional` 新版接口（X-Api-Key 鉴权） |
| 情绪声学映射 | `emotion` → 音调/语速/音量组合的客户端映射（见[注意事项](#注意事项)第 3 条） |
| 长文案停顿控制 | 按句切分并行合成 + 段间静音，长播报有呼吸感、节奏自然 |
| 播报前文本清洗 | 自动去代码块/URL/Markdown 标记 + 截断，不会把「井号、反引号」读出来 |
| SAPI 本地兜底 | 云端失败（断网/超时/key 失效/额度耗尽）自动切换 Windows 本地语音，**播报永不中断** |
| 场景化提示音 | 播报前先响一声提示音，提前唤醒蓝牙耳机音频链路 |
| 蓝牙前导静音 | 语音前 1.5 秒静音，防止蓝牙连接杂音吞掉首字（详见[前导静音](#蓝牙前导静音重要)） |

---

## 一、安装

### 前置要求

- **Node.js ≥ 18**（[下载](https://nodejs.org/)）
- **Windows**（云端合成跨平台可用；SAPI 兜底与蜂鸣提示音为 Windows 专属，其他平台自动降级）
- **火山引擎账号**（需开通语音合成大模型服务，见[第二步](#第二步获取火山引擎凭据)）

### 第一步：配置 MCP 客户端

**方式 A · npx 直接运行（推荐，无需克隆）**

在 MCP 客户端配置中加入（Trae 为项目目录下 `.trae/mcp.json`；Claude Desktop 为 `claude_desktop_config.json`；Cursor 为 `.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "agent-voice": {
      "command": "npx",
      "args": ["-y", "github:doer1296/agent-voice-mcp-minus"]
    }
  }
}
```

**方式 B · 克隆仓库本地运行（推荐给需要改代码的用户）**

```bash
git clone https://github.com/doer1296/agent-voice-mcp-minus.git
cd agent-voice-mcp-minus
npm install
```

MCP 配置改为 node 直连（启动更快，且不受 npm 仓库影响）：

```json
{
  "mcpServers": {
    "agent-voice": {
      "command": "node",
      "args": ["D:/your/path/agent-voice-mcp-minus/dist/index.js"]
    }
  }
}
```

配置完成后重启客户端 / 新开会话，MCP 服务启动时会播报「agent-voice 服务已启动」表示就绪。

### 第二步：获取火山引擎凭据

1. 注册/登录 [火山引擎](https://www.volcengine.com/)
2. 控制台搜索「**语音技术**」→ 开通「**语音合成大模型**」服务（新用户有免费额度）
3. 在「API Key 管理」页面创建并获取 **X-Api-Key**
4. **注意：需开通与所用音色匹配的模型资源**（seed-tts-1.0 或 seed-tts-2.0，见[大模型设置](#三如何设置大模型模型选择)）

> 免费替代方案：原版内置 **Edge TTS 引擎**（微软免费在线合成，无需 API Key、数百种音色），将 `engine` 设为 `"edge-tts"` 即可使用，详见原版 README。

### 第三步：创建配置文件

将本仓库的 [`config.example.json`](config.example.json) 复制为：

```
Windows: C:\Users\<你的用户名>\.agent-voice\config.json
macOS / Linux: ~/.agent-voice/config.json
```

然后把 `apiKey` 字段替换为你的 X-Api-Key（两选一）：

- **直接明文**：`"apiKey": "你的key"`
- **环境变量引用（推荐）**：保持 `"${VOLCANO_API_KEY}"`，然后设置系统环境变量 `VOLCANO_API_KEY=你的key`（配置文件支持 `${任意环境变量名}` 语法，避免 key 明文落盘）

---

## 二、如何调用（Agent 侧使用）

MCP 服务注册了 `speak` 工具，Agent 调用即可播报：

| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | string | 要播报的文本（自动清洗 Markdown 标记，超 200 字自动截断） |
| `scene` | string? | 场景：`task_start` / `task_complete` / `task_error` / `need_interaction` / `milestone`，自动套用该场景配置的音色/语速/音量/情绪 |
| `emotion` | string? | 情绪：`neutral` / `happy` / `sad` / `angry` / `calm` / `excited` |
| `emotionIntensity` | number? | 情绪强度 0–1，默认 0.7 |
| `voice` / `rate` / `volume` | ? | 覆盖音色/语速/音量（优先级高于场景配置） |

**推荐：配合项目规则让 Agent 自动播报任务生命周期。** 在 Trae 的 `.trae/rules/project_rules.md`（或 Claude 的 CLAUDE.md）中加入：

```markdown
在每次任务中，调用 agent-voice MCP 进行语音播报：
1. 任务开始时 — scene="task_start"
2. 每个子任务完成时 — scene="milestone"
3. 任务全部完成时 — scene="task_complete"
4. 遇到错误时 — scene="task_error"
5. 需要用户确认时 — scene="need_interaction"
```

调用示例：

```
speak(text="开始执行任务：重构登录模块", scene="task_start", emotion="calm")
speak(text="任务完成，测试全部通过", scene="task_complete", emotion="happy")
```

其他工具：`stop`（停止当前播报并清空队列）、`get_voices`（列出可用音色）、`get_roles`（列出配置的角色）。

---

## 三、如何设置大模型（模型选择）

`config.json` 中 `cloud.resourceId` 决定使用的语音合成大模型：

| resourceId | 模型 | 对应音色 ID 后缀 |
|------------|------|------------------|
| `seed-tts-1.0` | 语音合成大模型 1.0 | `_moon_bigtts`（另有部分老命名） |
| `seed-tts-2.0` | 语音合成大模型 2.0 | `_uranus_bigtts` |

**⚠️ 音色与模型版本必须匹配**：`_moon_bigtts` 音色配 `seed-tts-2.0`（或反过来）会报 HTTP 403 资源未授权。更换模型时记得同步更换音色 ID，且需在火山控制台开通对应的模型服务。

选型建议：1.0 稳定、音色丰富、文档成熟；2.0 支持声音复刻等新能力。本项目全部调优实测基于 1.0。

---

## 四、如何更换音色

修改 `config.json` 的 `cloud.voice`（以及场景配置中各自的 `voice` 字段），**并确保与 `resourceId` 版本匹配**：

```
seed-tts-1.0 示例：
  zh_female_daimengchuanmei_moon_bigtts   呆萌川妹（甜美女声，本项目默认）
  zh_female_qingxinnvsheng_mars_bigtts    清新女声

seed-tts-2.0 示例：
  zh_female_vv_uranus_bigtts              温柔女声
  zh_male_*.uranus_bigtts                 男声系列
```

完整音色列表见[火山引擎音色库文档](https://www.volcengine.com/docs/6561/1257584)。

---

## 五、如何调节音量 / 语速

**音量 `volume`**（默认 `1.3`）：

- 映射关系：`loudness_rate = (volume − 1) × 100`，即 `1.0` = 原始响度，`1.3` = +30%（实测 RMS 增益约 +29%，接近线性）
- 取值范围参考 `0.5 – 2.0`；`2.0` = +100%（服务端上限）
- 全局默认在顶层 `volume`，每个场景可单独覆盖（`scenes.*.volume`）

**语速 `rate`**（默认 `200`）：

- 映射关系：`speech_rate = (rate / 200 − 1) × 100`，即 `200` = 原速，`220` = +10%，`180` = −10%
- 场景默认梯度（本项目实测推荐）：开始 190 → 交互 200 → 里程碑/报错 210 → 完成 220

---

## 六、蓝牙前导静音（重要）

`cloud.leadingSilence`（**默认 `1500`，即 1.5 秒**）：

**这是为蓝牙耳机用户设计的参数。** 蓝牙音频链路建立需要约 1–2 秒，播报开始时耳机常处于未连接状态，导致首字被连接杂音吞掉。本参数在语音数据最前面插入指定毫秒的全静音，等蓝牙链路就绪后语音才开始。

- **蓝牙耳机用户**：保持 `1500`（如仍吞字可增至 `2000`）
- **有线耳机 / 扬声器用户**：改为 `0` 即可，播报更紧凑
- 播报前的提示音本身也是音频输出，会提前唤醒蓝牙链路，与该参数协同工作

---

## 七、完整参数表

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `cloud.provider` | `volcano` | 云端引擎（另支持 openai / custom / edge-tts） |
| `cloud.apiKey` | — | 火山引擎 X-Api-Key（支持 `${ENV_VAR}`） |
| `cloud.voice` | `zh_female_daimengchuanmei_moon_bigtts` | 音色 ID（须匹配模型版本） |
| `cloud.resourceId` | `seed-tts-1.0` | 合成大模型（1.0 / 2.0） |
| `cloud.format` | `pcm` | 流式推荐 pcm（客户端自动封装 WAV） |
| `cloud.sampleRate` | `24000` | 采样率，24k 即该音色带宽上限（见注意事项 2） |
| `cloud.silenceDuration` | `400` | 句末静音（ms） |
| `cloud.leadingSilence` | `1500` | **蓝牙前导静音（ms），见第六节** |
| `cloud.pauseControl` | `true` | 长文案停顿控制开关 |
| `cloud.pauseSentenceMs` | `400` | 句界插入停顿（ms） |
| `cloud.pauseCommaMs` | `200` | 超长句内部逗号停顿（ms） |
| `rate` / `volume` | `200` / `1.3` | 全局语速 / 音量 |
| `sceneSounds.*` | `beep:single` | 五场景提示音（`single` 单音 / `info` `success` `error` `warning` `milestone` 多音阶 / `false` 关闭） |
| `textClean` | `true` | 播报前文本清洗开关 |
| `maxTextLength` | `200` | 播报文本截断长度（在句读处收口） |
| `fallbackEngine` | `windows-sapi` | 云端失败自动兜底（Windows） |
| `watcher.enabled` | `false` | 备用播报通道开关（见[下节](#备用播报通道watcher可选)） |
| `watcher.script` | 包内默认 | 自定义 watcher 脚本路径（省略则用包内 `watcher/voice-watcher.mjs`） |
| `scenes.*` | 见 example | 五场景的 voice/rate/volume/emotion |

---

## 备用播报通道（watcher，可选）

`watcher/voice-watcher.mjs` 是一个**不依赖 MCP 连接**的常驻监听器：轮询 `~/.trae-cn/work/.voice-reader/pending.txt`，发现标记内容即用与主服务相同的云端引擎播报（配置、音色、音量实时同源，云端失败同样回退 SAPI）。

**用途**：当 Agent 会话里 MCP 工具不可用时（如模型切换、MCP 服务崩溃），仍可向该文件写入标记触发播报，形成兜底通道：

```
[VOICE_READER_START:success]
要播报的文本
[VOICE_READER_END]
```

类型支持 `info` / `success` / `error` / `warning`，分别映射 task_start / task_complete / task_error / need_interaction 场景参数。

**启用方式**：`config.json` 设 `"watcher": { "enabled": true }`。主 MCP 服务启动时自动将其作为子进程拉起、退出时一并回收（TCP 单实例守卫 47613，多会话只跑一份）。也可独立运行：`node watcher/voice-watcher.mjs`。

**路径可移植**：所有路径均为相对推导或 `os.homedir()` 拼接，无写死绝对路径。环境变量可覆盖：`AGENT_VOICE_CONFIG`（配置文件路径）、`AGENT_VOICE_PENDING_DIR`（pending.txt 所在目录，默认 `~/.trae-cn/work/.voice-reader`，适配其他 MCP 客户端）。

---

## 注意事项

1. **配置在 MCP 启动时加载一次**。修改 `config.json` 后需重启客户端 / 新开会话才生效（不是每次播报都重新读取）。
2. **采样率与声道**：实测该音色真实带宽 ≤ 12kHz，请求 32/44.1/48kHz 仅为插值上采样、无音质增益（多窗口 FFT 频带分析验证）；API 仅支持单声道，播放时系统自动混音双耳。保持 `24000` 即最优。
3. **情绪是客户端实现的**：seed-tts-1.0 的 v3 接口不支持服务端 emotion 参数（实测传入被静默忽略），本项目通过音调（pitch ±12）+ 语速/音量偏移组合表达六种情绪，`emotionIntensity` 控制强度。
4. **勿开启 SSML**：SSML `<break>` 停顿标签在 1.0 + v3 流式接口实测会截断音频（只合成第一句），长文案停顿已由客户端方案实现，无需 SSML。
5. **额度与计费**：火山引擎按字符计费，任务播报文案建议简短（本项目默认截断 200 字也部分出于此）；额度耗尽自动降级本地 SAPI 语音（音色会变，属正常现象）。
6. **Windows 依赖**：提示音用 `System.Console::Beep`，语音播放用 PowerShell `Media.SoundPlayer`——Windows 自带，但若被组策略禁用 PowerShell 则相关功能降级。
7. **输出目录**：合成音频写入系统临时目录播放后自动清理，无残留。

---

## 鸣谢

- **[agent-voice-mcp](https://github.com/al96169/agent-voice-mcp)** 及原作者 **Antonio Liang** —— 本项目基于其 MIT 开源代码增强，音色角色、多引擎架构等核心设计均来自原版
- [火山引擎 · 豆包语音合成大模型](https://www.volcengine.com/product/voice)

## License

MIT（继承原项目协议，保留原作者署名）
