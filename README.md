# dsh-checkin-plugin

> DeepSeek Harness (DSH) 插件：每天定时为 **TRAE CN** 与 **WorkBuddy** 自动完成每日签到；签到后按策略自动关闭软件。附带可在聊天中直接使用的 `/checkin` 命令，支持自定义时间与分支策略。

- 许可证：木兰宽松许可证第 2 版（MulanPSL-2.0），见 [LICENSE](LICENSE)
- 适用平台：Windows 10/11（依赖 Electron 应用的远程调试端口，锁屏下亦可工作）

## 特性

- **每天定时签到**：默认 08:00，可在 `engine/checkin.config.json` 或聊天命令里改。
- **聊天内交互**：在 DSH 聊天框输入 `/checkin`（`run/status/config/time HH:MM`）。
- **无需截图**：通过 Electron 的 CDP 在应用内执行签到，不受分辨率/缩放/遮挡影响，锁屏也能跑。
- **分支策略可控**：软件已打开时可选 `closeWhenIdle`(默认)/`skip`/`forceClose`/`keepOpen`。
- **边界处理**：已签到自动跳过、启动失败有超时、多实例单例锁、复用本地登录态。
- **双保险**：DSH 插件 + 可选 Windows 计划任务（DSH 关闭时兜底），二者有锁不会双开。

## 目录结构（概览）

```
dsh-checkin-plugin/
├── package.json          # 插件包清单（dsh.bundle.patch 等）
├── cordis.patch.yml      # bundle patch：把插件插入 profile（默认配置）
├── src/index.js          # 插件入口：每日排程 + /checkin 命令
├── engine/               # 签到引擎（被插件复用，也可独立运行）
│   ├── daily_checkin.js
│   ├── checkin.config.json
│   ├── install_task.ps1
│   ├── enable_debug_launch.ps1
│   └── create_launch_shortcuts.ps1
├── docs/
│   ├── STRUCTURE.md      # 详细项目结构说明
│   └── USER_GUIDE.md     # 用户使用手册
├── README.md / README.en.md
└── LICENSE
```

详细说明见 [docs/STRUCTURE.md](docs/STRUCTURE.md)，完整使用手册见 [docs/USER_GUIDE.md](docs/USER_GUIDE.md)。

## 快速开始

1. **准备 Node.js**（≥18）用于引擎脚本；并确保 TRAE CN / WorkBuddy 已登录。
2. **生成启动快捷方式**（引擎会用它们以带调试端口方式拉起应用）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File engine\create_launch_shortcuts.ps1
   ```
3. **安装插件到 DSH profile**（先完全退出 DSH，或用插件界面“添加插件”）：
   ```powershell
   & "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "file:<本仓库绝对路径>"
   ```
   或 DSH 侧边栏 **插件 → 添加插件 → 本地路径**，重启 DSH 生效。
4. **使用**：每天 08:00 自动执行；或聊天输入 `/checkin status` / `/checkin run`。
5. （可选）**Windows 计划任务兜底**（DSH 未运行时也能签到）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File engine\install_task.ps1
   ```

## 配置

主要配置在 `engine/checkin.config.json`：

| 字段 | 说明 |
|---|---|
| `time` / `timeZone` | 每天触发时间与时区（默认 `08:00` / `Asia/Shanghai`） |
| `apps[].runningPolicy` | 应用已打开时：`closeWhenIdle`(默认，空闲关闭重开签到) / `skip`(不动) / `forceClose`(立即关闭重开) / `keepOpen`(带调试端口时签到但不关闭) |
| `busy.cpuCores` / `busy.writeMB` / `busy.warmupSec` | “正在跑任务”的忙/闲判定阈值 |
| `maxWaitHours` | 忙时最多等待小时数 |
| `closeAfterCheckin` | 签到后是否关闭应用 |

## 聊天命令 `/checkin`

| 命令 | 作用 |
|---|---|
| `/checkin` 或 `/checkin run` | 立即执行一次签到 |
| `/checkin status` | 查看启用时间、下次运行倒计时、最近日志 |
| `/checkin config` | 查看当前配置 |
| `/checkin time 08:30` | 修改插件运行时间并重新排程 |

## 免责声明

本插件通过自动化软件界面/接口完成每日签到，请自行确认符合相关平台的使用规则。因平台改版导致的失效需相应调整。
