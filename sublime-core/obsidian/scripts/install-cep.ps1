param(
    [string]$ExtensionPath = (Join-Path $env:APPDATA "Adobe\CEP\extensions\obsidian"),
    [string]$ExtensionBundleId = "",
    [string]$ExtensionMenu = ""
)

$ErrorActionPreference = "Stop"

$obsidianRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $obsidianRoot "CSXS\manifest.xml"
$installId = [guid]::NewGuid().ToString("N")
$ExtensionPath = [System.IO.Path]::GetFullPath($ExtensionPath)
$obsidianRoot = [System.IO.Path]::GetFullPath($obsidianRoot)
$sourceRoot = $obsidianRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$targetRoot = $ExtensionPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$separator = [System.IO.Path]::DirectorySeparatorChar
$sourcePrefix = $sourceRoot + $separator
$targetPrefix = $targetRoot + $separator
$driveRoot = [System.IO.Path]::GetPathRoot($ExtensionPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)

if ($targetRoot -eq $driveRoot -or
    $targetRoot.Equals($sourceRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $targetRoot.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    $sourceRoot.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ExtensionPath must be a non-root directory outside the OBSIDIAN source tree."
}

$stagingPath = "$ExtensionPath-staging-$installId"
$backupPath = "$ExtensionPath-backup-$installId"
$failedPath = "$ExtensionPath-failed-$installId"

function Assert-PathUnderRoot([string]$root, [string]$candidate, [string]$description) {
    $resolvedRoot = [System.IO.Path]::GetFullPath($root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)
    $rootPrefix = $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedCandidate.Equals($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $resolvedCandidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$description escapes its extension root: $resolvedCandidate"
    }
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Source CEP manifest not found: $manifestPath"
}

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$mainPath = [string]$manifest.SelectSingleNode("//*[local-name()='MainPath']").InnerText
$scriptPath = [string]$manifest.SelectSingleNode("//*[local-name()='ScriptPath']").InnerText

if ([string]::IsNullOrWhiteSpace($mainPath) -or [string]::IsNullOrWhiteSpace($scriptPath)) {
    throw "Manifest must define both MainPath and ScriptPath."
}
if ($ExtensionBundleId -and $ExtensionBundleId -notmatch '^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$') {
    throw "ExtensionBundleId must contain only letters, digits, dots, underscores, and hyphens."
}

function Resolve-ManifestPath([string]$root, [string]$relativePath) {
    $relativePath = $relativePath -replace '/', '\'
    $relativePath = $relativePath -replace '^\.\\', ''
    return Join-Path $root $relativePath
}

$sourceMain = Resolve-ManifestPath $obsidianRoot $mainPath
$sourceHost = Resolve-ManifestPath $obsidianRoot $scriptPath
Assert-PathUnderRoot $obsidianRoot $sourceMain "Manifest MainPath"
Assert-PathUnderRoot $obsidianRoot $sourceHost "Manifest ScriptPath"

if (-not (Test-Path -LiteralPath $sourceMain -PathType Leaf)) {
    throw "Manifest MainPath does not exist in source: $sourceMain"
}
if (-not (Test-Path -LiteralPath $sourceHost -PathType Leaf)) {
    throw "Manifest ScriptPath does not exist in source: $sourceHost"
}

$parent = Split-Path -Parent $ExtensionPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null

if (Test-Path -LiteralPath $stagingPath) {
    throw "Unique staging directory already exists; refusing to remove it: $stagingPath"
}
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
Get-ChildItem -LiteralPath $obsidianRoot -Force | Copy-Item -Destination $stagingPath -Recurse -Force

$stagedManifest = Join-Path $stagingPath "CSXS\manifest.xml"
[xml]$stagedXml = Get-Content -LiteralPath $stagedManifest -Raw
if ($ExtensionBundleId) {
    $stagedXml.DocumentElement.SetAttribute("ExtensionBundleId", $ExtensionBundleId)
    $isolatedExtensionId = "$ExtensionBundleId.panel"
    foreach ($extensionNode in $stagedXml.SelectNodes("//*[local-name()='Extension'][@Id]")) {
        $extensionNode.SetAttribute("Id", $isolatedExtensionId)
    }
}
if ($ExtensionMenu) {
    $menuNode = $stagedXml.SelectSingleNode("//*[local-name()='Menu']")
    if (-not $menuNode) {
        throw "Staging verification failed: manifest menu node is missing."
    }
    $menuNode.InnerText = $ExtensionMenu
}
if ($ExtensionBundleId -or $ExtensionMenu) {
    $stagedXml.Save($stagedManifest)
}
$stagedMain = Resolve-ManifestPath $stagingPath ([string]$stagedXml.SelectSingleNode("//*[local-name()='MainPath']").InnerText)
$stagedHost = Resolve-ManifestPath $stagingPath ([string]$stagedXml.SelectSingleNode("//*[local-name()='ScriptPath']").InnerText)
Assert-PathUnderRoot $stagingPath $stagedMain "Staged manifest MainPath"
Assert-PathUnderRoot $stagingPath $stagedHost "Staged manifest ScriptPath"

if (-not (Test-Path -LiteralPath $stagedMain -PathType Leaf)) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: active MainPath is missing: $stagedMain"
}
if (-not (Test-Path -LiteralPath $stagedHost -PathType Leaf)) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: active ScriptPath is missing: $stagedHost"
}

$hostHash = (Get-FileHash -LiteralPath $sourceHost -Algorithm SHA256).Hash
$mainHash = (Get-FileHash -LiteralPath $sourceMain -Algorithm SHA256).Hash
$stagedHostHash = (Get-FileHash -LiteralPath $stagedHost -Algorithm SHA256).Hash
$stagedMainHash = (Get-FileHash -LiteralPath $stagedMain -Algorithm SHA256).Hash
if ($hostHash -ne $stagedHostHash) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: source and staged host scripts differ."
}
if ($mainHash -ne $stagedMainHash) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
    throw "Staging verification failed: source and staged MainPath files differ."
}

$hadExistingInstall = Test-Path -LiteralPath $ExtensionPath
if ($hadExistingInstall -and -not (Test-Path -LiteralPath $ExtensionPath -PathType Container)) {
    throw "ExtensionPath exists but is not a directory: $ExtensionPath"
}
if ($hadExistingInstall) {
    Move-Item -LiteralPath $ExtensionPath -Destination $backupPath
    if (-not (Test-Path -LiteralPath $backupPath -PathType Container)) {
        throw "Backup move could not be verified; the existing extension was not replaced."
    }
    Write-Output "Existing extension preserved at: $backupPath"
}

try {
    Move-Item -LiteralPath $stagingPath -Destination $ExtensionPath

    $installedManifest = Join-Path $ExtensionPath "CSXS\manifest.xml"
    [xml]$installedXml = Get-Content -LiteralPath $installedManifest -Raw
    $installedMain = Resolve-ManifestPath $ExtensionPath ([string]$installedXml.SelectSingleNode("//*[local-name()='MainPath']").InnerText)
    $installedHost = Resolve-ManifestPath $ExtensionPath ([string]$installedXml.SelectSingleNode("//*[local-name()='ScriptPath']").InnerText)
    Assert-PathUnderRoot $ExtensionPath $installedMain "Installed manifest MainPath"
    Assert-PathUnderRoot $ExtensionPath $installedHost "Installed manifest ScriptPath"

    if (-not (Test-Path -LiteralPath $installedMain -PathType Leaf)) {
        throw "Install verification failed: active MainPath is missing: $installedMain"
    }
    if (-not (Test-Path -LiteralPath $installedHost -PathType Leaf)) {
        throw "Install verification failed: active ScriptPath is missing: $installedHost"
    }
    if ($ExtensionBundleId) {
        $installedBundleId = [string]$installedXml.DocumentElement.GetAttribute("ExtensionBundleId")
        $installedExtensionIds = @($installedXml.SelectNodes("//*[local-name()='Extension'][@Id]") | ForEach-Object { [string]$_.GetAttribute("Id") })
        if ($installedBundleId -ne $ExtensionBundleId -or
            $installedExtensionIds.Count -eq 0 -or
            @($installedExtensionIds | Where-Object { $_ -ne "$ExtensionBundleId.panel" }).Count -gt 0) {
            throw "Install verification failed: isolated extension identifiers do not match the requested bundle ID."
        }
    }
    if ($ExtensionMenu) {
        $installedMenu = [string]$installedXml.SelectSingleNode("//*[local-name()='Menu']").InnerText
        if ($installedMenu -ne $ExtensionMenu) {
            throw "Install verification failed: isolated extension menu label does not match the requested value."
        }
    }

    $installedHostHash = (Get-FileHash -LiteralPath $installedHost -Algorithm SHA256).Hash
    $installedMainHash = (Get-FileHash -LiteralPath $installedMain -Algorithm SHA256).Hash
    if ($hostHash -ne $installedHostHash) {
        throw "Install verification failed: source and installed host scripts differ."
    }
    if ($mainHash -ne $installedMainHash) {
        throw "Install verification failed: source and installed MainPath files differ."
    }
} catch {
    $installFailure = $_.Exception.Message
    if (Test-Path -LiteralPath $ExtensionPath) {
        Move-Item -LiteralPath $ExtensionPath -Destination $failedPath
        Write-Output "Unverified staged install preserved at: $failedPath"
    }
    if ($hadExistingInstall -and (Test-Path -LiteralPath $backupPath -PathType Container)) {
        Move-Item -LiteralPath $backupPath -Destination $ExtensionPath
        throw "Install verification failed; previous extension was restored. $installFailure"
    }
    throw "Install verification failed; no prior extension existed to restore. $installFailure"
}

Write-Output "OBSIDIAN CEP files installed and verified."
Write-Output "Manifest MainPath: $mainPath"
Write-Output "Manifest ScriptPath: $scriptPath"
if ($ExtensionBundleId) {
    Write-Output "Installed isolated extension ID: $ExtensionBundleId.panel"
}
Write-Output "Installed host SHA256: $installedHostHash"
Write-Output "Supported Glow presets and removal are available; validate them in After Effects before production use."
