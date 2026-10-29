# SPDX-License-Identifier: MulanPSL-2.0
# Copyright (c) 2026 zhuhuaikuan

param(
  [string]$TaskName = 'Trae-WorkBuddy-DailyCheckin',
  [string]$NodeExe = ''
)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$cfgPath = Join-Path $dir 'checkin.config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json

$timeStr = if ($cfg.time) { [string]$cfg.time } else { '08:00' }
$parts = $timeStr.Split(':')
$h = [int]$parts[0]
$m = if ($parts.Count -gt 1) { [int]$parts[1] } else { 0 }
$s = if ($parts.Count -gt 2) { [int]$parts[2] } else { 0 }
$at = (Get-Date).Date.AddHours($h).AddMinutes($m).AddSeconds($s)
Write-Host ("Config time = '{0}' -> daily at {1}" -f $timeStr, $at.ToString('HH:mm:ss'))

if (-not $NodeExe) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $NodeExe = $cmd.Source }
}
if (-not $NodeExe) {
  $local = Join-Path $dir 'node\node.exe'
  if (Test-Path $local) { $NodeExe = $local }
}
if (-not $NodeExe -or -not (Test-Path $NodeExe)) { throw 'node.exe not found. Install Node.js or pass -NodeExe <path>' }

$script = Join-Path $dir 'daily_checkin.js'
if (-not (Test-Path $script)) { throw "script not found: $script" }

$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $NodeExe -Argument ('"{0}"' -f $script) -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Daily auto check-in for TRAE CN and WorkBuddy' -Force | Out-Null

$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ("Registered '{0}' State={1} daily at {2} ({3})" -f $TaskName, $t.State, $at.ToString('HH:mm:ss'), $me)
