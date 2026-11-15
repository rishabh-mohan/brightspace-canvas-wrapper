# Builds dist/brightspace-canvas-wrapper-<version>.zip for addons.mozilla.org (or the Chrome Web Store).
# Paths inside the zip use forward slashes, which Mozilla's validator requires.
#   powershell -File tools\package.ps1
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$ext = Join-Path $root 'extension'
$version = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
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
