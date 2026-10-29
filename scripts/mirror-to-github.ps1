# SPDX-License-Identifier: MulanPSL-2.0
# Copyright (c) 2026 zhuhuaikuan
<#
本机镜像脚本：把 Gitee 仓库镜像到 GitHub 仓库（主分支 master -> 目标 main，另同步所有标签与其它分支）。
不删除目标 main（安全覆盖推送）。

前提：本机 git 可访问 Gitee（SSH/HTTPS）与 GitHub（SSH 或 HTTPS+PAT）。

示例：
  powershell -ExecutionPolicy Bypass -File scripts\mirror-to-github.ps1 `
    -GitHubRepo "git@github.com:zhuhuaikuan/dsh-checkin-plugin.git"

参数：
  -GiteeRepo    源仓库（默认 SSH 地址）
  -GitHubRepo   目标仓库（必填）
  -TargetBranch 目标主分支（默认 main）
  -WorkDir      本地裸仓库缓存（默认 %TEMP%\dsh-checkin-mirror.git）
#>
param(
  [string]$GiteeRepo = 'git@gitee.com:zhuhuaikuan/dsh-checkin-plugin.git',
  [Parameter(Mandatory = $true)][string]$GitHubRepo,
  [string]$TargetBranch = 'main',
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

# 主分支
$null = & $git -C $WorkDir show-ref --verify --quiet refs/heads/master
$srcBr = if ($LASTEXITCODE -eq 0) { 'master' } else { 'main' }
Write-Host "push $srcBr -> $TargetBranch"
& $git -C $WorkDir push --force $GitHubRepo "refs/heads/${srcBr}:refs/heads/${TargetBranch}"
if ($LASTEXITCODE -ne 0) { throw "push main failed ($LASTEXITCODE)" }

# 其它分支
$branches = & $git -C $WorkDir for-each-ref --format='%(refname:short)' refs/heads
foreach ($b in $branches) {
  if ($b -ne 'master' -and $b -ne 'main') {
    Write-Host "push branch $b"
    & $git -C $WorkDir push --force $GitHubRepo "refs/heads/${b}:refs/heads/${b}"
  }
}
# 标签
Write-Host "push tags"
& $git -C $WorkDir push --force $GitHubRepo --tags
Write-Host "mirror done: $(Get-Date -Format o)"
