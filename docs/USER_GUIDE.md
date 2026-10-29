# 用户使用手册（USER GUIDE）

本手册面向使用者，介绍安装、配置、使用与排障。项目结构见 [STRUCTURE.md](STRUCTURE.md)。

---

## 1. 适用环境与前置条件

- **系统**：Windows 10 / 11。
- **软件**：已安装并**登录** TRAE CN 与 WorkBuddy（脚本复用本地登录态，不会代替你登录）。
- **Node.js**：≥ 18（用于运行 `engine/daily_checkin.js`；`install_task.ps1` 与独立运行需要它）。
- **DSH**：已安装 DeepSeek Harness（仅在“用插件定时”时需要；只用 Windows 计划任务可不依赖 DSH）。

---

## 2. 首次准备（重要）

### 2.1 确认应用登录
分别打开 TRAE CN 与 WorkBuddy，确认已登录账号后关闭。脚本会复用其本地登录态。

### 2.2 生成启动快捷方式（引擎用它以“带调试端口”的方式拉起应用）
```powershell
powershell -ExecutionPolicy Bypass -File engine\create_launch_shortcuts.ps1
```
- 默认按 `%LOCALAPPDATA%\Programs\Trae CN\Trae CN.exe` 和 `D:\WorkBuddy\WorkBuddy.exe` 生成 `engine\launch_trae.lnk / launch_wb.lnk`。
- 路径不同可传参：
  ```powershell
  ... create_launch_shortcuts.ps1 -TraeExe "C:\...\Trae CN.exe" -WorkBuddyExe "C:\...\WorkBuddy.exe"
  ```
- 之后 `engine/checkin.config.json` 里 `apps[].image / port / launchShortcut` 需与实际一致。

### 2.3 可选：把每日时间设成你想要的
编辑 `engine/checkin.config.json` 的 `time`（如 `"08:00"`）。或安装后用 `/checkin time 08:30` 修改插件时间。

---

## 3. 安装

### 方式 A：DSH 图形界面
DSH 侧边栏 **插件 → 添加插件 → 本地路径**，选择本仓库目录，安装并启用，随后**重启 DSH**。

### 方式 B：DSH CLI（需先完全退出 DSH 桌面应用）
```powershell
& "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "file:<本仓库绝对路径>"
```
安装后重新打开 DSH。

### 方式 C：仅用 Windows 计划任务（不装插件）
不需要 DSH，直接：
```powershell
powershell -ExecutionPolicy Bypass -File engine\install_task.ps1
```

安装成功后，插件会在**下次 DSH 启动**时挂载。可在 DSH 聊天输入 `/checkin status` 验证；或在 `engine/plugin-loaded.txt` 看到加载记录（含宿主进程号与排程时间）。

---

## 4. 日常使用

### 4.1 自动定时
- 插件版：DSH 运行时，每天到点自动执行。
- 计划任务版：DSH 关闭时，由 Windows 计划任务兜底执行。
- 二者同时触发时由单实例锁去重，不会双开。

### 4.2 聊天命令 `/checkin`（插件版）
| 命令 | 作用 |
|---|---|
| `/checkin` 或 `/checkin run` | 立即执行一次签到，返回结果摘要 |
| `/checkin status` | 查看启用时间、下次运行倒计时、最近日志 |
| `/checkin config` | 查看当前配置 |
| `/checkin time 08:30` | 修改插件运行时间并立即重新排程（同时写 config.json） |

> `/checkin time` 只影响插件与其配置文件；Windows 计划任务的时间需重建：`engine\install_task.ps1`。

### 4.3 手动运行引擎（不经 DSH）
```powershell
node engine\daily_checkin.js            # 正常执行
node engine\daily_checkin.js --dry-run  # 只预演，不启动/关闭任何软件
node engine\daily_checkin.js --force    # 已打开的应用不等待，立即关闭重开
node engine\daily_checkin.js --no-close # 只签到，不关闭
```
结果写入 `engine/checkin.log`。

---

## 5. 配置详解（engine/checkin.config.json）

```jsonc
{
  "time": "08:00",                 // 每天运行时间
  "timeZone": "Asia/Shanghai",     // 时区
  "closeAfterCheckin": true,        // 签到后是否关闭（对脚本自己启动的软件）
  "busy": {
    "cpuCores": 0.35,               // 判定“正在跑任务”的 CPU 阈值（占多少核，采样 8 秒）
    "writeMB": 25,                  // 或磁盘写入阈值（MB / 8 秒）
    "warmupSec": 120                // 启动后多少秒内视为“热身”，不做忙闲判断
  },
  "maxWaitHours": 8,                // 忙时最多等待多少小时后放弃
  "apps": [
    {
      "name": "TRAE CN",
      "enabled": true,
      "image": "Trae CN.exe",
      "port": 9333,                  // 该应用 CDP 调试端口
      "launchShortcut": "launch_trae.lnk", // 相对 engine/ 的快捷方式
      "pageMatch": "workbench",      // 用于挑选正确的页面目标
      "kind": "trae",
      "runningPolicy": "closeWhenIdle"
    },
    { "name": "WorkBuddy", "image": "WorkBuddy.exe", "port": 9334,
      "launchShortcut": "launch_wb.lnk", "pageMatch": "index\\.html|WorkBuddy",
      "kind": "workbuddy", "runningPolicy": "closeWhenIdle", "enabled": true }
  ]
}
```

### `runningPolicy`（应用“已被打开”时的处理）
| 值 | 行为 |
|---|---|
| `closeWhenIdle`（默认） | 空闲则关闭→重开→签到→关闭；有任务在跑则每 10 分钟检查直到空闲 |
| `skip` | 不关闭也不签到（完全不动） |
| `forceClose` | 立即关闭→重开→签到（会打断正在跑的任务） |
| `keepOpen` | **带调试端口时签到但不关闭**（真正的“已打开也签到、且不退出”） |

> `keepOpen` 需要该应用的启动快捷方式带调试端口。若你想让“自己打开的应用”也满足，可运行一次：
> ```powershell
> powershell -ExecutionPolicy Bypass -File engine\enable_debug_launch.ps1
> ```
> 这会给 Start Menu/桌面/任务栏的启动快捷方式加上 `--remote-debugging-port`（本机将暴露一个本地调试端口，请知情后使用）。撤销加 `-Revert`。

### 环境变量覆盖（调试/临时）
`CHECKIN_BUSY_CPU`、`CHECKIN_BUSY_WRITE_MB`、`CHECKIN_WARMUP_SEC`、`CHECKIN_MAX_WAIT_HOURS`、`CHECKIN_POLICY`（覆盖所有 app 的 runningPolicy）、`CHECKIN_CONFIG`（指定配置文件路径）。

---

## 6. Windows 计划任务（兜底）

```powershell
powershell -ExecutionPolicy Bypass -File engine\install_task.ps1
# 需要指定 node 时： -NodeExe "C:\Program Files\nodejs\node.exe"
```
- 任务名 `Trae-WorkBuddy-DailyCheckin`；时间读自 `checkin.config.json`；仅登录用户会话运行；错过会尽快补跑；单次最长 8 小时。
- 手动触发一次：`Start-ScheduledTask -TaskName 'Trae-WorkBuddy-DailyCheckin'`

---

## 7. 日志与排障

| 现象 | 排查 |
|---|---|
| `/checkin` 命令不出现 | 插件未挂载或为旧版。**重启 DSH**；查看 `engine/plugin-loaded.txt` 是否有本次启动的记录；看 `engine/plugin-error.txt`。 |
| 重启 DSH 失败/插件报错 | 多为清单/JSON 编码问题。确保 `package.json`、`cordis.patch.yml` 为 **UTF-8 无 BOM**；可用备份回滚（见第 9 节）。 |
| 提示找不到 node / 脚本 | 未安装 Node.js 或路径不对；`install_task.ps1 -NodeExe <node路径>`；或插件 `cordis.patch.yml` 里显式配置 `scriptPath/configPath/nodePath`。 |
| 应用没被正确拉起 | 未生成快捷方式或路径不对：重跑 `engine\create_launch_shortcuts.ps1` 并核对 `checkin.config.json` 的 `image/port/launchShortcut`。 |
| 一直等待/不关闭 | 被判定为“正在跑任务”（CPU/磁盘达到阈值）。可调低 `busy.cpuCores`/`busy.writeMB` 更激进，或等其空闲。 |
| 已签到但仍然… | 已签到会跳过（正常）。日志里有 `already checked in`。 |
| 想看执行细节 | `engine/checkin.log`；插件触发时也会写入。 |

> 锁屏说明：CDP 方式不依赖屏幕绘制，通常锁屏也能完成；但若系统休眠/应用被完全挂起则可能失败。

---

## 8. 更新
- 覆盖更新仓库文件后，若为插件方式：**重启 DSH** 生效；若为计划任务：无需操作。
- 修改了 `time` 后要同步计划任务：重跑 `engine\install_task.ps1`。

---

## 9. 卸载 / 回滚

- **停用插件**：DSH **插件** 页面停用/移除 `dsh-checkin-plugin`；或把 profile 的 `cordis.patch.yml` 中 `id: dsh-checkin` 置 `disabled: true`。
- **CLI 卸载**：`dsh plugin --profile desktop remove dsh-checkin-plugin`。
- **删除计划任务**：`Unregister-ScheduledTask -TaskName 'Trae-WorkBuddy-DailyCheckin' -Confirm:$false`
- 手动安装过（编辑 profile）的，可用同目录的 `package.json.bak_checkin` / `cordis.patch.yml.bak_checkin` 还原并删除 `node_modules\dsh-checkin-plugin` 联接。

---

## 10. FAQ
- **会不会重复签到？** 不会。签到前会查询状态，已签到则跳过；且单实例锁避免并发。
- **会不会重复打开/关闭？** 只在需要时（未运行才启动；脚本启动的才关闭）。
- **能多账号吗？** 当前用应用本身登录的账号；多账号需各自登录后运行，或扩展配置。
- **支持 macOS/Linux？** 当前引擎是 Windows 专用（任务计划、快捷方式、CIM 采样均 Windows 实现）。
