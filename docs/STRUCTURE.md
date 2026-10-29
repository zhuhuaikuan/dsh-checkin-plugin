# 项目结构说明（STRUCTURE）

```
dsh-checkin-plugin/
├── package.json
├── cordis.patch.yml
├── src/
│   └── index.js
├── engine/
│   ├── daily_checkin.js
│   ├── checkin.config.json
│   ├── install_task.ps1
│   ├── enable_debug_launch.ps1
│   └── create_launch_shortcuts.ps1
├── docs/
│   ├── STRUCTURE.md
│   └── USER_GUIDE.md
├── README.md
├── README.en.md
└── LICENSE
```

## 各文件职责

| 路径 | 职责 |
|---|---|
| `package.json` | 插件包清单。`dsh.bundle.patch` 指向 `cordis.patch.yml`；`main` 指向 `src/index.js`。 |
| `cordis.patch.yml` | bundle patch：把插件以 `id: dsh-checkin` 插入 DSH profile 的插件树；`config` 为默认配置（默认从 `engine/` 读脚本与配置）。 |
| `src/index.js` | 插件入口（Cordis host 插件）。负责：①用原生 `setTimeout` 每日排程；②注册 `/checkin` 聊天命令；③到点 `spawn(node, [daily_checkin.js])` 执行签到。`apply()` 全程 try/catch，**绝不因异常导致挂载失败**。 |
| `engine/daily_checkin.js` | 真正的签到引擎（Node 脚本）。可独立运行；也被插件 spawn 调用。 |
| `engine/checkin.config.json` | 业务配置（时间、分支策略、阈值、各 App 的 exe/端口/快捷方式名）。 |
| `engine/install_task.ps1` | 读取配置里的 `time`，注册/更新 Windows 计划任务（兜底：DSH 未运行时也签到）。 |
| `engine/enable_debug_launch.ps1` | （可选）给你自己的启动快捷方式加 `--remote-debugging-port`，以支持 `keepOpen`（已打开也签到且不关闭）。 |
| `engine/create_launch_shortcuts.ps1` | 在 `engine/` 生成 `launch_trae.lnk`、`launch_wb.lnk`（带调试端口），供引擎以可控方式拉起应用。 |
| `docs/*` | 项目结构说明与本手册。 |

## 运行时与数据流

```
DSH 宿主进程 (Node-mode, 有完整 Node 权限)
  └─ 加载插件 src/index.js (apply)
       ├─ 读取 engine/checkin.config.json（time/timeZone/policy/阈值）
       ├─ setTimeout 计算到下一个 HH:MM（按 timeZone）→ 到点 spawn(node, engine/daily_checkin.js)
       └─ 注册 /checkin 命令（run/status/config/time）

engine/daily_checkin.js（由插件或计划任务启动）
  ├─ 获取单实例锁 engine/checkin.lock（防双开）
  ├─ 对每个 App：
  │    ├─ 未运行 → 用 launch_xxx.lnk（带 --remote-debugging-port）启动
  │    ├─ 已打开(无调试端口) → 按 runningPolicy：closeWhenIdle(空闲关闭重开)/skip/forceClose
  │    └─ 通过 CDP 在该 App 内执行签到
  │         ├─ TRAE：点击弹窗【签到】→ 复核【已签到】
  │         └─ WorkBuddy：调用其已鉴权接口 /billing/meter/daily-checkin
  └─ 按策略关闭脚本自己启动的应用；写 engine/checkin.log
```

## 设计要点

- **为什么用 CDP**：TRAE/WorkBuddy 均为 Electron 应用，签到入口在网页内；CDP 直接在其渲染进程执行 JS，稳定且锁屏可用，无需截图/固定坐标。
- **为什么 apply 绝不抛错**：Cordis 中访问未注入的服务可能抛错，导致插件挂载失败。因此排程用原生 `setTimeout`，所有 ctx 访问均 try/catch 包裹。
- **单实例锁**：插件与 Windows 计划任务可能同时触发，`checkin.lock` 保证同一时刻只跑一个。
- **编码**：所有 JSON/YAML/JS 必须为 **UTF-8 无 BOM**（DSH 用 `JSON.parse`，BOM 会导致解析失败）。本仓库文件均为无 BOM。
- **绝对路径**：`cordis.patch.yml` 默认使用本包内 `engine/` 相对定位，无需写死绝对路径；如需自定义可显式填写。
