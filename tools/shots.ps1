# Opens wrapper pages from the dev server (node tools/dev-server.js) in headless Chrome or Edge.
# The pages are listed in tools/pages.json.
#   Check that every page renders:   powershell -File tools\shots.ps1
#   Also save screenshots:           powershell -File tools\shots.ps1 -Out C:\some\folder [-Only dash,grades] [-Theme dark]
param(
  [string]$Out = '',
  [string[]]$Only = @(),
  [string]$Theme = '',
  [int]$Port = 8765,
  [string]$Size = '1440,900'
)
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome or Edge is needed.' }
$work = Join-Path $env:TEMP 'bsx-headless'
if ($Out) { New-Item -ItemType Directory -Force $Out | Out-Null; $work = $Out }
New-Item -ItemType Directory -Force $work | Out-Null
$profileDir = Join-Path $work '.profile'
$pages = Get-Content (Join-Path $PSScriptRoot 'pages.json') -Raw | ConvertFrom-Json
$noise = Join-Path $work 'browser-messages.txt'
$failed = 0
foreach ($entry in $pages.PSObject.Properties) {
  $name = $entry.Name
  if ($Only.Count -and $Only -notcontains $name) { continue }
  $path = $entry.Value
  if ($Theme) {
    $parts = $path -split '#', 2
    $sep = '?'; if ($parts[0].Contains('?')) { $sep = '&' }
    $path = $parts[0] + $sep + "bsxtheme=$Theme"
    if ($parts.Count -gt 1) { $path += '#' + $parts[1] }
  }
  $url = "http://localhost:$Port$path"
  $common = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', "--user-data-dir=`"$profileDir`"", "--window-size=$Size", '--virtual-time-budget=9000')
  if ($Out) {
    $file = Join-Path $Out "$name.png"
    Start-Process -FilePath $chrome -ArgumentList ($common + @("--screenshot=`"$file`"", "`"$url`"")) -Wait -WindowStyle Hidden -RedirectStandardError $noise
  }
  $dom = Join-Path $work "$name.html"
  Start-Process -FilePath $chrome -ArgumentList ($common + @('--dump-dom', "`"$url`"")) -Wait -WindowStyle Hidden -RedirectStandardOutput $dom -RedirectStandardError $noise
  $status = 'no status'
  $html = Get-Content $dom -Raw -ErrorAction SilentlyContinue
  if ($html -match 'data-bsx-status="([^"]*)"') { $status = $Matches[1] }
  if (-not $Out) { Remove-Item $dom -ErrorAction SilentlyContinue }
  if ($status -ne 'ok') { $failed++ }
  '{0,-12} {1}' -f $name, $status
}
if ($failed) { "$failed page(s) did not render."; exit 1 } else { 'All pages rendered.' }
