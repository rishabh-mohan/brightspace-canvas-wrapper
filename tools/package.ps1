# Builds dist/brightspace-canvas-wrapper-<version>.zip for addons.mozilla.org (or the Chrome Web Store).
# Paths inside the zip use forward slashes, which Mozilla's validator requires.
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
$zipPath = Join-Path $dist "brightspace-canvas-wrapper-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  Get-ChildItem $ext -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($ext.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name) | Out-Null
  }
} finally { $zip.Dispose() }
Write-Output $zipPath
