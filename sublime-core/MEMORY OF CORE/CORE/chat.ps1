$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$memoryPath = Join-Path $scriptDir "MEMORY.md"

if (-not (Test-Path $memoryPath)) {
    Write-Host "CORE memory not found: $memoryPath" -ForegroundColor Red
    exit 1
}

Write-Host "CORE online. Type /exit to stop." -ForegroundColor Cyan

while ($true) {
    $message = Read-Host "You"

    if ($message -eq "/exit") {
        break
    }

    if ([string]::IsNullOrWhiteSpace($message)) {
        continue
    }

    # Reload memory before every message so saved edits are picked up.
    $memory = Get-Content $memoryPath -Raw
    $prompt = @"
Use the following CORE MEMORY as the source of truth. Do not use conflicting old facts.

=== CORE MEMORY ===
$memory
=== END CORE MEMORY ===

USER MESSAGE:
$message

Answer the user using the memory above.
"@

    try {
        $body = @{ model = "core"; prompt = $prompt; stream = $false } | ConvertTo-Json -Depth 5
        $response = Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -ContentType "application/json" -Body $body
        Write-Host "`nCORE: $($response.response)`n" -ForegroundColor Green
    }
    catch {
        Write-Host "Could not reach Ollama. Make sure Ollama is running." -ForegroundColor Red
        Write-Host $_.Exception.Message
    }
}
