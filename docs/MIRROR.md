# 镜像同步（Gitee → GitHub）

本仓库主库在 Gitee。下面提供两种把代码镜像到 GitHub 的方式，按你的偏好二选一。

## 方案 A：GitHub Actions 定时拉取（推荐，无需本机）

原理：在 **GitHub 侧**建一个仓库，加入工作流 `.github/workflows/mirror-from-gitee.yml`，由 GitHub Actions 定时 `git clone --mirror` Gitee 仓库并 `git push --mirror` 到当前 GitHub 仓库。

步骤：
1. 在 GitHub 新建一个仓库（如 `zhuhuaikuan/dsh-checkin-plugin`，可先为空）。
2. 把本仓库的 `.github/workflows/mirror-from-gitee.yml` 放到该 GitHub 仓库（首次可把整个项目导入一次）。
3. 若 **Gitee 仓库是私有的**：GitHub 仓库 Settings → Secrets and variables → Actions → 新建 `GITEE_TOKEN`（Gitee 私人令牌，勾选 read 仓库权限即可）。
4. 打开该 GitHub 仓库的 Actions → 选择 “Mirror from Gitee” → Run workflow；或等待每天 20:00 UTC（≈ 次日 04:00 北京）自动运行。

说明：
- 使用内置 `GITHUB_TOKEN`，无需额外 PAT（工作流已声明 `permissions: contents: write`）。
- 源仓库地址在 workflow 的 `GITEE_REPO` 变量，可自行修改。

## 方案 B：本机/服务器脚本定时推送

原理：在本机用 `scripts/mirror-to-github.ps1`，从一个本地裸仓库缓存 `fetch` Gitee 再 `push --mirror` 到 GitHub。适合没有 Actions、且本机能同时访问两端的场景（本机需要能访问 GitHub）。

示例：
```powershell
powershell -ExecutionPolicy Bypass -File scripts\mirror-to-github.ps1 `
  -GitHubRepo "git@github.com:<you>/dsh-checkin-plugin.git"
```

做成定时任务（每天 04:30）：
```powershell
schtasks /Create /TN "dsh-checkin-mirror" /SC DAILY /ST 04:30 /TR ^
 "powershell -NoProfile -ExecutionPolicy Bypass -File \"<repo>\scripts\mirror-to-github.ps1\" -GitHubRepo \"git@github.com:<you>/dsh-checkin-plugin.git\"" /F
```

## 注意
- **GitHub Actions 只能在 GitHub 上跑**，Gitee 上无法执行 GitHub Actions。
- 私有仓库需要凭据：方案 A 用 `GITEE_TOKEN`；方案 B 需要本机对 GitHub 的 SSH key 或 HTTPS PAT。
- 首次镜像会把分支与标签（含 `v0.1.0`）一并推送过去。
