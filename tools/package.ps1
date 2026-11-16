# Builds the store zips in dist/:
#   brightspace-canvas-wrapper-<version>.zip         addons.mozilla.org (Firefox)
#   brightspace-canvas-wrapper-<version>-chrome.zip  Chrome Web Store (and Edge Add-ons)
# Paths inside the zips use forward slashes, which Mozilla's validator requires.
#   powershell -File tools\package.ps1
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$ext = Join-Path $root 'extension'
$manifestPath = Join-Path $ext 'manifest.json'
# Browsers and Mozilla's validator want plain UTF-8 JSON: no byte-order mark, no syntax errors.
$bytes = [IO.File]::ReadAllBytes($manifestPath)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw 'manifest.json starts with a byte-order mark; save it as UTF-8 without BOM.' }
try { $version = ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json).version } catch { throw "manifest.json is not valid JSON: $_" }
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

function Zip-Folder($folder, $zipPath) {
  if (Test-Path $zipPath) { Remove-Item $zipPath }
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    Get-ChildItem $folder -Recurse -File | ForEach-Object {
      $name = $_.FullName.Substring($folder.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name) | Out-Null
    }
  } finally { $zip.Dispose() }
  Write-Output $zipPath
}

Zip-Folder $ext (Join-Path $dist "brightspace-canvas-wrapper-$version.zip")
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$chromeDir = Join-Path $dist 'chrome'
& $node (Join-Path $PSScriptRoot 'chrome.js') $chromeDir | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Chrome build failed.' }
Zip-Folder $chromeDir (Join-Path $dist "brightspace-canvas-wrapper-$version-chrome.zip")
