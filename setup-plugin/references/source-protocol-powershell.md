# The one-download protocol - the PowerShell route

Read this only when the Bash tool cannot run `source-protocol.md`'s bash blocks. Everything else there holds
unchanged: the same cache, the same newest-valid pick, the same `$TMP/repo` copy and the same cleanup.

**Invoke every block here as a FILE, never as a double-quoted `-Command` string.** The Bash tool on Windows is
Git Bash, so it expands `$TMP`, `$Ver`, `$Src` - every `$Name` in the body - BEFORE pwsh sees them, and the
block fails on a ParserError that reads like a PowerShell bug (three runs across two projects, one of them
re-downloading the whole archive). A quoted heredoc keeps bash out of the body; `pwsh -Command '<single
quotes>'` works only for a one-liner with no embedded quote:

```bash
cat > "$TMP/step.ps1" <<'PS1'
<the PowerShell below, verbatim - bash never touches a quoted heredoc body>
PS1
pwsh -NoProfile -File "$TMP/step.ps1"
```

The resolve (it prints the same `RESOLVED` line as the bash block; the version falls back to the copied
`plugin.json`, since a cache entry carries no `RELEASE-SOURCE`):

```powershell
$TMP = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TMP -Force | Out-Null
$RepoUrl = 'https://github.com/envoydev/alfred-code'
$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Was = ''     # LATEST first: only `plugin update` lands a newer cache entry, and the newest entry IS the snapshot
$Key = ''     # the marketplace key the core is listed under
$Seed = if ($env:ALFRED_CODE_SEED) { $env:ALFRED_CODE_SEED } else { 'node' }
if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude plugin marketplace update envoydev *> $null
  $list = try { claude plugin list --json 2>$null | Out-String | ConvertFrom-Json } catch { $null }
  # PSObject, never `$list.installed`: over a bare array that is one $null per row - truthy, and no rows
  if ($list -and ($list.PSObject.Properties.Name -contains 'installed')) { $list = $list.installed }
  # the core installed for THIS project or the account, at each scope, this project's rows first - another plugin the catalog lists (preferred-tools) updates on its own
  $Here = (Get-Item -LiteralPath (Get-Location).Path).FullName
  $rows = @($list | Where-Object { "$($_.id)" -match '^alfred-code@envoydev$' -and $_.scope -and (-not $_.projectPath -or [System.IO.Path]::GetFullPath("$($_.projectPath)").TrimEnd('\', '/') -eq $Here.TrimEnd('\', '/')) })
  $rows = @(@($rows | Where-Object { $_.projectPath }) + @($rows | Where-Object { -not $_.projectPath }))
  foreach ($r in $rows) {
    $id = "$($r.id)"   # each row by its own id
    if ($id -like 'alfred-code@*' -and -not $Was) { $Was = $r.version; $Key = ($id -split '@')[1] }
    claude plugin update $id --scope $r.scope -y *> $null
  }
}
$Src = ''
$BestVer = $null
$Base = Join-Path $ConfigDir 'plugins/cache'
if (Test-Path -LiteralPath $Base -PathType Container) {
  foreach ($mkt in (Get-ChildItem -LiteralPath $Base -Directory -ErrorAction SilentlyContinue)) {
    $entry = Join-Path $mkt.FullName 'alfred-code'
    if (-not (Test-Path -LiteralPath $entry -PathType Container)) { continue }
    foreach ($d in (Get-ChildItem -LiteralPath $entry -Directory -ErrorAction SilentlyContinue)) {
      if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'stack/skills'))) { continue }
      if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'stack/agents'))) { continue }
      if (Test-Path -LiteralPath (Join-Path $d.FullName '.orphaned_at')) { continue }
      $v = $null
      [void][System.Version]::TryParse(($d.Name -replace '[^0-9.].*$', ''), [ref]$v)
      if (-not $Src -or ($v -and $BestVer -and $v -gt $BestVer) -or ($v -and -not $BestVer)) {
        $Src = $d.FullName; $BestVer = $v
      }
    }
  }
}
if ($Src) {
  Copy-Item -LiteralPath $Src -Destination "$TMP/repo" -Recurse                      # nothing is downloaded
  Remove-Item -LiteralPath "$TMP/repo/.git" -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Invoke-WebRequest -Uri "$RepoUrl/releases/latest/download/alfred-code.zip" -OutFile "$TMP/alfred-code.zip"
  Expand-Archive -LiteralPath "$TMP/alfred-code.zip" -DestinationPath "$TMP/repo"
}
$Ver = ((Get-Content "$TMP/repo/RELEASE-SOURCE" -ErrorAction SilentlyContinue | Where-Object { $_ -match '^version: ' }) -replace '^version: ', '').Trim()
if (-not $Ver) { $Ver = try { "$((Get-Content -Raw -LiteralPath "$TMP/repo/setup-plugin/.claude-plugin/plugin.json" | ConvertFrom-Json).version)" } catch { '' } }   # a plugin-cache entry carries no RELEASE-SOURCE
$Show = { param($v) if ($v) { $v } else { '?' } }
Write-Output "RESOLVED TMP=$TMP $(& $Show $Ver) seed=$Seed running=$(& $Show $Was) key=$(& $Show $Key)"
```

PowerShell keeps `$TMP` in a marker of its OWN, keyed on the full root (Windows path limits bound it); nothing
reads one route's marker from the other:

```powershell
$Root = (git rev-parse --show-toplevel 2>$null); if (-not $Root) { $Root = (Get-Location).Path }
$Mark = Join-Path ([System.IO.Path]::GetTempPath()) ('alfred-code-run.' + (($Root -replace '[^A-Za-z0-9]','-')) + '.path')
```
