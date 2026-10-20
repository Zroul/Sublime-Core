param(
    [string]$ExtensionPath = (Join-Path $env:APPDATA "Adobe\CEP\extensions\obsidian")
)

$ErrorActionPreference = "Stop"

$obsidianRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $obsidianRoot "CSXS\manifest.xml"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagingPath = "$ExtensionPath-staging-$timestamp"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Source CEP manifest not found: $manifestPath"
}

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$mainPath = [string]$manifest.SelectSingleNode("//*[local-name()='MainPath']").InnerText
$scriptPath = [string]$manifest.SelectSingleNode("//*[local-name()='ScriptPath']").InnerText

if ([string]::IsNullOrWhiteSpace($mainPath) -or [string]::IsNullOrWhiteSpace($scriptPath)) {
    throw "Manifest must define both MainPath and ScriptPath."
}

function Resolve-ManifestPath([string]$root, [string]$relativePath) {
    $relativePath = $relativePath -replace '/', '\'
    $relativePath = $relativePath -replace '^\.\\', ''
    return Join-Path $root $relativePath
}

$sourceMain = Resolve-ManifestPath $obsidianRoot $mainPath
$sourceHost = Resolve-ManifestPath $obsidianRoot $scriptPath

if (-not (Test-Path -LiteralPath $sourceMain -PathType Leaf)) {
    throw "Manifest MainPath does not exist in source: $sourceMain"
}
if (-not (Test-Path -LiteralPath $sourceHost -PathType Leaf)) {
    throw "Manifest ScriptPath does not exist in source: $sourceHost"
}

$parent = Split-Path -Parent $ExtensionPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null

if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
Get-ChildItem -LiteralPath $obsidianRoot -Force | Copy-Item -Destination $stagingPath -Recurse -Force

$stagedManifest = Join-Path $stagingPath "CSXS\manifest.xml"
[xml]$stagedXml = Get-Content -LiteralPath $stagedManifest -Raw
$stagedMain = Resolve-ManifestPath $stagingPath ([string]$stagedXml.SelectSingleNode("//*[local-name()='MainPath']").InnerText)
$stagedHost = Resolve-ManifestPath $stagingPath ([string]$stagedXml.SelectSingleNode("//*[local-name()='ScriptPath']").InnerText)

if (-not (Test-Path -LiteralPath $stagedMain -PathType Leaf)) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: active MainPath is missing: $stagedMain"
}
if (-not (Test-Path -LiteralPath $stagedHost -PathType Leaf)) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: active ScriptPath is missing: $stagedHost"
}

$hostHash = (Get-FileHash -LiteralPath $sourceHost -Algorithm SHA256).Hash
$stagedHostHash = (Get-FileHash -LiteralPath $stagedHost -Algorithm SHA256).Hash
if ($hostHash -ne $stagedHostHash) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: source and staged host scripts differ."
}

if (Test-Path -LiteralPath $ExtensionPath) {
    $backupPath = "$ExtensionPath-backup-$timestamp"
    Copy-Item -LiteralPath $ExtensionPath -Destination $backupPath -Recurse
    if (-not (Test-Path -LiteralPath $backupPath)) {
        Remove-Item -LiteralPath $stagingPath -Recurse -Force
        throw "Backup verification failed; installed extension was not changed."
    }
    Write-Output "Backup created: $backupPath"
    Remove-Item -LiteralPath $ExtensionPath -Recurse -Force
}

Move-Item -LiteralPath $stagingPath -Destination $ExtensionPath

$installedManifest = Join-Path $ExtensionPath "CSXS\manifest.xml"
[xml]$installedXml = Get-Content -LiteralPath $installedManifest -Raw
$installedMain = Resolve-ManifestPath $ExtensionPath ([string]$installedXml.SelectSingleNode("//*[local-name()='MainPath']").InnerText)
$installedHost = Resolve-ManifestPath $ExtensionPath ([string]$installedXml.SelectSingleNode("//*[local-name()='ScriptPath']").InnerText)

if (-not (Test-Path -LiteralPath $installedMain -PathType Leaf)) {
    throw "Install verification failed: active MainPath is missing: $installedMain"
}
if (-not (Test-Path -LiteralPath $installedHost -PathType Leaf)) {
    throw "Install verification failed: active ScriptPath is missing: $installedHost"
}

$installedHostHash = (Get-FileHash -LiteralPath $installedHost -Algorithm SHA256).Hash
if ($hostHash -ne $installedHostHash) {
    throw "Install verification failed: source and installed host scripts differ."
}

Write-Output "OBSIDIAN CEP files installed and verified."
Write-Output "Manifest MainPath: $mainPath"
Write-Output "Manifest ScriptPath: $scriptPath"
Write-Output "Installed host SHA256: $installedHostHash"
Write-Output "Glow edits remain disabled in the host while the crash is investigated."
