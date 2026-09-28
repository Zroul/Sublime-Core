$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$memoryPath = Join-Path $scriptDir "MEMORY.md"

if (-not (Test-Path $memoryPath)) {
    Write-Host "CORE memory not found: $memoryPath" -ForegroundColor Red
    exit 1
}

$memory = Get-Content $memoryPath -Raw

Write-Host "CORE online. Type /exit to stop." -ForegroundColor Cyan

while ($true) {
    $message = Read-Host "You"

    if ($message -eq "/exit") {
        break
    }

    if ([string]::IsNullOrWhiteSpace($message)) {
        continue
    }

    $prompt = @"
Use the following project memory as authoritative context for this conversation.

=== CORE MEMORY ===
$memory
=== END CORE MEMORY ===

USER:
$message
"@

    ollama run core $prompt
}
