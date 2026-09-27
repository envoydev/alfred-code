#Requires -Version 5.1
<#
  fix-serena-ts-windows.ps1 - patch serena/solidlsp's TypeScript language-server launch on Windows.

  Bug (oraios/serena#311): solidlsp spawns npm's extensionless POSIX shim
  (.bin/typescript-language-server), which cmd.exe can't execute, so the TS language
  server dies at init and every serena symbol/reference tool fails for the session.
  This rewrites _create_launch_command to run `node <cli.mjs> --stdio` directly.

  TRANSIENT: a `uvx serena` upgrade re-extracts the package and wipes this - re-run after upgrades.
  After running, RESTART the serena MCP (reload your editor) or the change won't take effect.

  STANDALONE, run by hand: the frozen `scripts/os/claude-stack.ps1` used to delegate to this file # legacy-name
  during install/update (Phase 7b, R33, 2.0.0 deleted that caller along with the rest of the twin);
  `scripts/install/` never gained an equivalent auto-apply, so nothing invokes this script anymore -
  run it yourself after a serena install or upgrade on Windows.

  Usage (on the Windows machine):
    pwsh ./fix-serena-ts-windows.ps1
    # or: powershell -ExecutionPolicy Bypass -File .\fix-serena-ts-windows.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$uvRoot = Join-Path $env:LOCALAPPDATA 'uv'
if (-not (Test-Path -LiteralPath $uvRoot)) { Write-Error "uv dir not found: $uvRoot (is serena installed via uvx?)"; exit 1 }

# Find every cached/installed copy of the file (uv cache path has a content hash, so we search).
$targets = Get-ChildItem -LiteralPath $uvRoot -Recurse -Filter 'typescript_language_server.py' -ErrorAction SilentlyContinue |
  Where-Object { ($_.FullName -replace '\\', '/') -match 'solidlsp/language_servers/typescript_language_server\.py$' }
if (-not $targets) { Write-Error "No solidlsp/.../typescript_language_server.py found under $uvRoot."; exit 1 }

$expectedBody = 'return [core_path, "--stdio"]'
$patched = 0; $already = 0; $skipped = 0

foreach ($f in $targets) {
  $path = $f.FullName
  if ((Get-Content -LiteralPath $path -Raw) -match 'serena-win-fix') { Write-Host "already patched: $path"; $already++; continue }

  $lines = [System.IO.File]::ReadAllLines($path)
  $defIdx = -1
  for ($k = 0; $k -lt $lines.Count; $k++) {
    if ($lines[$k] -match '^\s*def _create_launch_command\(') { $defIdx = $k; break }
  }
  if ($defIdx -lt 0 -or ($defIdx + 1) -ge $lines.Count -or $lines[$defIdx + 1].Trim() -ne $expectedBody) {
    Write-Warning "unexpected/changed method - skipping (patch manually): $path"; $skipped++; continue
  }

  $i  = ([regex]::Match($lines[$defIdx], '^(?<i>[ \t]*)def ')).Groups['i'].Value
  $b1 = $i + '    '; $b2 = $i + '        '; $b3 = $i + '            '
  $block = @(
    "$($i)def _create_launch_command(self, core_path: str) -> list[str]:"
    "$($b1)# serena-win-fix: npm's extensionless POSIX shim can't run under cmd.exe; call node on cli.mjs."
    "$($b1)if os.name == ""nt"":"
    "$($b2)cli = os.path.normpath(os.path.join("
    "$($b3)os.path.dirname(core_path), "".."", ""typescript-language-server"", ""lib"", ""cli.mjs""))"
    "$($b2)if os.path.isfile(cli):"
    "$($b3)return [""node"", cli, ""--stdio""]"
    "$($b2)return [core_path + "".cmd"", ""--stdio""]"
    "$($b1)return [core_path, ""--stdio""]"
  )

  $out = New-Object System.Collections.Generic.List[string]
  if ($defIdx -gt 0) { $out.AddRange([string[]]($lines[0..($defIdx - 1)])) }
  $out.AddRange([string[]]$block)
  $tail = $defIdx + 2
  if ($tail -le $lines.Count - 1) { $out.AddRange([string[]]($lines[$tail..($lines.Count - 1)])) }

  Copy-Item -LiteralPath $path -Destination "$path.bak" -Force
  [System.IO.File]::WriteAllLines($path, $out)
  Write-Host "patched: $path  (backup: $path.bak)" -ForegroundColor Green
  $patched++
}

Write-Host ''
Write-Host "Done: $patched patched, $already already-patched, $skipped skipped." -ForegroundColor Cyan
if ($patched -gt 0) { Write-Host 'Now RESTART the serena MCP (reload Claude Code) - the running process still holds the old module.' -ForegroundColor Yellow }
