# SPDX-License-Identifier: MulanPSL-2.0
# Copyright (c) 2026 zhuhuaikuan

param(
  [string]$TraeExe = (Join-Path $env:LOCALAPPDATA 'Programs\Trae CN\Trae CN.exe'),
  [string]$WorkBuddyExe = 'D:\WorkBuddy\WorkBuddy.exe',
  [int]$TraePort = 9333,
  [int]$WorkBuddyPort = 9334
)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$ws = New-Object -ComObject WScript.Shell

function New-DebugShortcut($lnkPath, $target, $args, $workdir) {
  if (-not (Test-Path $target)) { Write-Warning "target not found: $target (shortcut still created)"; }
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $target
  $lnk.Arguments = $args
  $lnk.WorkingDirectory = $workdir
  $lnk.Save()
  Write-Host ("created {0} -> {1} {2}" -f $lnkPath, $target, $args)
}

New-DebugShortcut (Join-Path $dir 'launch_trae.lnk') $TraeExe "--remote-debugging-port=$TraePort --remote-allow-origins=*" (Split-Path $TraeExe)
New-DebugShortcut (Join-Path $dir 'launch_wb.lnk') $WorkBuddyExe "--remote-debugging-port=$WorkBuddyPort --remote-allow-origins=*" (Split-Path $WorkBuddyExe)
Write-Host "Done. Edit engine/checkin.config.json image/port/launchShortcut if paths/ports differ."
