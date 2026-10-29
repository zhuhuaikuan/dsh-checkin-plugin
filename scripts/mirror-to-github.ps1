# SPDX-License-Identifier: MulanPSL-2.0
# Copyright (c) 2026 zhuhuaikuan
<#
本机镜像脚本：把 Gitee 仓库完整镜像（分支+标签）推送到 GitHub 仓库。
适合没有使用 GitHub Actions、想在本机/服务器定时同步的场景。

前提：本机 git 可访问 Gitee（SSH 或 HTTPS）与 GitHub（SSH 或 HTTPS/PAT）。

示例：
  powershell -ExecutionPolicy Bypass -File scripts\mirror-to-github.ps1 `
    -GitHubRepo "git@github.com:<you>/dsh-checkin-plugin.git"

参数：
  -GiteeRepo   源仓库（默认 SSH 地址）
  -GitHubRepo  目标仓库（必填：SSH 地址或含 PAT 的 HTTPS 地址）
  -WorkDir     本地裸仓库缓存目录（默认 %TEMP%\dsh-checkin-mirror.git）
#>
param(
  [string]$GiteeRepo = 'git@gitee.com:zhuhuaikuan/dsh-checkin-plugin.git',
  [Parameter(Mandatory = $true)][string]$GitHubRepo,
  [string]$WorkDir = ''
)
$ErrorActionPreference = 'Stop'
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) { throw 'git not found in PATH' }
$git = $gitCmd.Source
if (-not $WorkDir) { $WorkDir = Join-Path $env:TEMP 'dsh-checkin-mirror.git' }

if (-not (Test-Path $WorkDir)) {
  Write-Host "init mirror clone: $WorkDir"
  & $git clone --mirror $GiteeRepo $WorkDir
} else {
  Write-Host "update mirror clone: $WorkDir"
  & $git -C $WorkDir remote set-url origin $GiteeRepo
  & $git -C $WorkDir fetch --prune origin "+refs/*:refs/*"
}
Write-Host "push --mirror -> $GitHubRepo"
& $git -C $WorkDir push --mirror $GitHubRepo
if ($LASTEXITCODE -ne 0) { throw "push failed ($LASTEXITCODE)" }
Write-Host "mirror done: $(Get-Date -Format o)"
