# Changelog

本项目遵循语义化版本。

## [0.1.0] - 2026-10-29

### Added
- 首个版本：DeepSeek Harness (DSH) 插件，每天定时为 **TRAE CN** 与 **WorkBuddy** 自动签到。
- 通过 Electron 远程调试协议（CDP）在应用内完成签到（锁屏可用、无需截图）。
- 聊天命令 `/checkin`：`run` / `status` / `config` / `time HH:MM`。
- 已打开应用的分支策略：`closeWhenIdle`（默认）/ `skip` / `forceClose` / `keepOpen`。
- 边界处理：已签到跳过、启动失败超时、多实例单实例锁、复用本地登录态。
- 独立签到引擎 `engine/daily_checkin.js`，可脱离 DSH 手动运行。
- Windows 计划任务兜底安装脚本 `engine/install_task.ps1`。
- 文档：`README.md`、`README.en.md`、`docs/STRUCTURE.md`、`docs/USER_GUIDE.md`。

### Notes
- 许可证：木兰宽松许可证第 2 版（MulanPSL-2.0）。
- 仅支持 Windows 10/11。
