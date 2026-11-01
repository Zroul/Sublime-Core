$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$chatScript = Join-Path $scriptDir "chat.ps1"

if (-not (Test-Path $chatScript)) {
    Write-Host "CORE chat script not found: $chatScript" -ForegroundColor Red
    exit 1
}

& $chatScript
