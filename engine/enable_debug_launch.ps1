param([switch]$Revert)
# Add --remote-debugging-port to the TRAE CN / WorkBuddy launch shortcuts so that
# apps the USER opens also expose a local debug port. Then the check-in script can
# attach and check in WITHOUT closing the app (runningPolicy = keepOpen).
# This is optional and opt-in (it exposes a localhost debug port on this machine).
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File enable_debug_launch.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File enable_debug_launch.ps1 -Revert
$ErrorActionPreference = 'Stop'
$apps = @(
  @{ Name = 'TRAE CN';   Exe = (Join-Path $env:LOCALAPPDATA 'Programs\Trae CN\Trae CN.exe'); Port = 9333 },
  @{ Name = 'WorkBuddy'; Exe = 'D:\WorkBuddy\WorkBuddy.exe';                                  Port = 9334 }
)
$searchDirs = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:USERPROFILE\Desktop",
  "$env:PUBLIC\Desktop",
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
) | Where-Object { Test-Path $_ }

$ws = New-Object -ComObject WScript.Shell
$changed = 0
foreach ($a in $apps) {
  foreach ($d in $searchDirs) {
    Get-ChildItem $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
      $lnk = $ws.CreateShortcut($_.FullName)
      if ($lnk.TargetPath -and ($lnk.TargetPath -ieq $a.Exe)) {
        $args = [string]$lnk.Arguments
        $dbg = "--remote-debugging-port=$($a.Port)"
        if ($Revert) {
          $args = ($args -replace [regex]::Escape($dbg), '' -replace [regex]::Escape('--remote-allow-origins=*'), '')
          $args = ($args -replace '\s+', ' ').Trim()
        } else {
          if ($args -notmatch [regex]::Escape($dbg)) {
            $args = ("$args $dbg --remote-allow-origins=*" -replace '\s+', ' ').Trim()
          }
        }
        if ($args -ne [string]$lnk.Arguments) {
          $lnk.Arguments = $args
          $lnk.Save()
          $changed++
          $verb = if ($Revert) { 'Reverted' } else { 'Updated' }
          Write-Host ("{0}: {1}" -f $verb, $_.FullName)
          Write-Host ("        args = {0}" -f $args)
        }
      }
    }
  }
}
Write-Host ("Done. Changed {0} shortcut(s)." -f $changed)
if (-not $Revert) {
  Write-Host "Note: local debug ports 9333/9334 were added to launch shortcuts."
  Write-Host "If a pinned taskbar icon does not take effect, unpin and re-pin it."
  Write-Host "Revert: powershell -NoProfile -ExecutionPolicy Bypass -File enable_debug_launch.ps1 -Revert"
}
