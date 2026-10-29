# dsh-checkin-plugin

DeepSeek Harness (DSH) plugin: automatically completes the daily check-in for **TRAE CN** and **WorkBuddy** at a configurable time, then closes the apps according to policy. Ships a `/checkin` chat command and configurable time / branch policies.

- License: Mulan PSL v2 (see [LICENSE](LICENSE))
- Platform: Windows 10/11 (uses Electron remote-debugging ports; works while locked)

## Features

- Scheduled daily check-in (default 08:00).
- Chat slash command `/checkin [run|status|config|time HH:MM]`.
- No screenshots: drives the apps over the Chrome DevTools Protocol (CDP).
- Branch policy when an app is already open: `closeWhenIdle` / `skip` / `forceClose` / `keepOpen`.
- Handles already-signed-in, launch failure, multi-instance (single-instance lock), saved login.
- Optional Windows scheduled task as a fallback when DSH is closed.

## Layout

```
package.json  cordis.patch.yml  src/index.js
engine/  (daily_checkin.js, checkin.config.json, *.ps1)
docs/    (STRUCTURE.md, USER_GUIDE.md)
README.md  README.en.md  LICENSE
```

Detailed structure: [docs/STRUCTURE.md](docs/STRUCTURE.md). Full manual: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Quick start

1. Install Node.js (>=18); make sure TRAE CN / WorkBuddy are logged in.
2. Generate launch shortcuts: `powershell -ExecutionPolicy Bypass -File engine\create_launch_shortcuts.ps1`
3. Add the plugin to your DSH profile (or via DSH UI: Plugins -> Add plugin -> local path), then restart DSH.
4. Daily at 08:00 it runs; or use `/checkin status` / `/checkin run` in chat.
5. Optional fallback: `powershell -ExecutionPolicy Bypass -File engine\install_task.ps1`

## Configuration

See `engine/checkin.config.json`: `time`, `timeZone`, `apps[].runningPolicy`, `busy.*`, `maxWaitHours`, `closeAfterCheckin`.
