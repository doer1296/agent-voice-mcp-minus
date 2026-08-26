# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0-plus] - 2026-08-26

Enhanced fork of [agent-voice-mcp 1.2.0](https://github.com/al96169/agent-voice-mcp). 本版本基于原版增强，聚焦火山引擎豆包语音（seed-tts）实战调优。

### Added
- **火山 v3 流式接口适配**：`/api/v3/tts/unidirectional` + `X-Api-Key` 鉴权（替代旧版 /api/v1/tts；流式成功码 `0` / `20000000` 兼容）
- **情绪声学映射**：`emotion` + `emotionIntensity` → `post_process.pitch` + 语速/音量偏移的客户端映射（seed-tts-1.0 服务端不支持 emotion 参数，实测传入被静默忽略，故用声学组合表达六种情绪）
- **长文案停顿控制**：≥40 字多句文案按句切分（超长句内部再按逗号细切）→ 并行合成 → 段间插入静音（句界 400ms / 逗号 200ms）。实测句界停顿 ~1s 且并行合成总时延反而低于整段单次请求
- **播报前文本清洗**：去代码块/行内代码/加粗/标题/链接/URL/列表标记 + 200 字句读处截断，杜绝「井号、反引号」被读出
- **SAPI 本地兜底**：云端失败（断网/超时/key 失效/额度耗尽）自动切换 Windows 本地语音（`fallbackEngine: "windows-sapi"`），播报不中断；兜底播报前同样先响提示音
- **场景化提示音**：`beep:` 前缀提示音系统（`beep:single` 单音警示为默认，另有 info/success/error/warning/milestone 多音阶模式可选）
- **蓝牙前导静音**：`leadingSilence`（默认 1500ms）在语音前插入静音，防止蓝牙耳机连接杂音吞掉首字
- **PCM→WAV 客户端封装**：流式 PCM 拼接后统一封装合法 RIFF/WAVE（兼容 Media.SoundPlayer）
- **配置模板**：`config.example.json`，支持 `${ENV_VAR}` 环境变量引用（如 `${VOLCANO_API_KEY}`），避免 API Key 明文落盘

### Changed
- 提示音默认配置为 `beep:single`（多音阶模式听感机械，保留可切换）
- MCP serverInfo 更名为 `agent-voice-plus` / 版本 `1.3.0`（注册名 `agent-voice` 不变，不影响客户端配置）

### Fixed
- 流式 WAV data 子块长度 `0xFFFFFFFF` 占位导致 Media.SoundPlayer 拒绝播放的问题（客户端修正 chunk 长度）
- 云端失败降级时提示音回调（`onBeforePlay`）作用域丢失导致兜底播报无提示音的问题

### Notes（实测结论，README 有详细数据）
- 24kHz 为该音色真实带宽上限（32/44.1/48kHz 均为插值上采样，>12kHz 无内容）；API 仅单声道
- SSML `<break>` 在 seed-tts-1.0 + v3 流式接口会截断音频（勿开启 ssml 参数），停顿用上述客户端方案
- `cache_config` 对短播报无收益（实测无字节级缓存命中，时延持平），默认不开启

## [1.2.0] - 2026-06-25

### Changed
- 启动 MCP 服务时通过 VoiceQueue 入队播报，自动附带提示音（此前直接调用引擎，绕过提示音）
- 精简 speak 和 stop 工具回调返回值，仅返回 "OK"，减少 Agent Token 消耗
- 参数容错优化：scene/emotion 非法值自动回退首个枚举值；rate/volume 超范围自动钳制到合法区间

## [1.1.0] - 2026-06-13

### Added
- 多角色支持：可配置不同的 TTS 角色（如"助手"、"用户"、"系统"），每个角色包含完整的 TTS 参数（音色、语速、音量、情感、场景、提示音）
- 角色目标范围：通过 `target` 字段描述角色适用范围（如"给Trae使用"），Agent 可自行判断并选择角色
- `speak` 工具新增 `role` 参数，支持按名称或目标范围匹配角色
- 角色匹配规则：精确匹配 name → 模糊匹配 target → 回退到第一个角色
- 角色级提示音：每个角色可独立配置 `notificationSound`
- 角色级场景配置：角色场景配置优先级高于全局场景配置
- `get_roles` 工具：Agent 可动态查询当前配置中的可用角色列表（name/target/voice），无需依赖静态文档

## [1.0.6] - 2026-06-10

### Fixed
- 修复 npm 包中提示音 WAV 文件路径错误（`getAssetsDir` 从 `../../assets` 改为 `../assets`，正确指向 `dist/assets/`）
- 蜂鸣回退从 `stdout` 写入改为 `stderr`，避免污染 MCP JSON-RPC 协议通信

## [1.0.3] - 2026-06-06

### Added
- Edge TTS 引擎（微软免费在线 TTS），支持 SSML 情感风格（cheerful/sad/angry/calm/excited）
- 数百种音色可选，无需 API Key
- 9 个 Edge TTS 测试用例，未安装 edge-tts 时自动跳过
- `pretest` 脚本，npm test 前自动构建
- `.nvmrc` 锁定 Node 24 版本
- README 新增引擎对比表、引擎选择建议、Edge TTS 使用指南

## [1.0.2] - 2026-05-21

### Fixed
- 云端/Piper 引擎音频播放改为跨平台适配（macOS afplay / Windows PowerShell SAPI / Linux aplay）

## [1.0.1] - 2026-05-21

### Changed
- 版本号升至 1.0.1，修正版本发布流程

## [1.0.0] - 2026-05-21

### Changed
- 正式发布 v1.0.0 稳定版
- README 新增 npx 一键安装配置方式
- README 新增本地项目文件运行配置方式
- README 新增第 4 点"强制规则"，确保 Agent 使用语音播报
- Node.js 版本要求统一为 >= 18

## [0.0.5] - 2024-05-21

### Added
- 完善打包流程，支持npm包发布
- 创建GitHub Actions CI/CD流水线，自动化构建和测试
- 添加版本发布准备配置
- 添加安装使用文档

### Changed
- 更新package.json元数据，支持npm发布
- 升级TypeScript配置以优化打包产物

## [0.0.4] - 2024
### Added
- 支持云端TTS服务（豆包、OpenAI、Volcano等）
- 解绑Trae，构建通用型MCP服务

## [0.0.3] - 2024
### Added
- 支持切换本机TTS服务的不同音色
- 支持情感参数配置

## [0.0.2] - 2024
### Added
- 支持配置TTS的语速、音量和播报场景

## [0.0.1] - 2024
### Added
- MVP版本，实现基本TTS语音播报功能
- 支持macOS本地say命令
