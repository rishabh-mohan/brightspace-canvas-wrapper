# Renders extension/icons/icon.svg to PNGs (Chrome and Edge do not accept SVG icons).
#   powershell -File tools\icons.ps1
$root = Split-Path $PSScriptRoot -Parent
$svg = Join-Path $root 'extension\icons\icon.svg'
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$work = Join-Path $env:TEMP 'bsx-icons'
New-Item -ItemType Directory -Force $work | Out-Null
foreach ($size in 16, 32, 48, 96, 128) {
  $page = Join-Path $work "icon-$size.html"
  $data = [Convert]::ToBase64String([IO.File]::ReadAllBytes($svg))
  Set-Content $page "<html><body style='margin:0;background:transparent'><img src='data:image/svg+xml;base64,$data' width='$size' height='$size' style='display:block'></body></html>" -Encoding utf8
  $out = Join-Path $root "extension\icons\icon-$size.png"
  Start-Process -FilePath $chrome -ArgumentList @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', "--user-data-dir=`"$work\.profile`"", "--window-size=$size,$size", "--screenshot=`"$out`"", "`"file:///$($page.Replace('\','/'))`"") -Wait -WindowStyle Hidden
  Write-Output $out
}
