# ClawBench — Windows PowerShell installer
# Usage: irm https://github.com/xulongzhe/clawbench/releases/latest/download/install.ps1 | iex

$ErrorActionPreference = "Stop"
$Repo = "xulongzhe/clawbench"
$Binary = "clawbench"
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\.local\bin" }

# Detect latest release
Write-Host "Detecting latest release..."
$Latest = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest").tag_name
if (-not $Latest) { Write-Error "Failed to detect latest version"; exit 1 }
Write-Host "Latest version: $Latest"

# Download
$AssetName = "$Binary-windows-amd64.zip"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Latest/$AssetName"
$TempDir = Join-Path $env:TEMP "clawbench-install"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

Write-Host "Downloading $AssetName..."
$ZipPath = Join-Path $TempDir $AssetName
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath

# Extract
Write-Host "Extracting..."
Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

# Install
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$ExePath = Join-Path $InstallDir "$Binary.exe"
Copy-Item -Path (Join-Path $TempDir "$Binary.exe") -Destination $ExePath -Force

# Cleanup
Remove-Item -Path $TempDir -Recurse -Force

# PATH hint
Write-Host ""
Write-Host "Installed: $ExePath"
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host ""
    Write-Host "Add to PATH:"
    Write-Host '  [Environment]::SetEnvironmentVariable("Path", "'$InstallDir';" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")'
}
Write-Host ""
Write-Host "Run: $ExePath"
