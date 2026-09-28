$memory = Get-Content "C:\CORE\MEMORY.md" -Raw

while ($true) {
    $message = Read-Host "You"

    if ($message -eq "/exit") {
        break
    }

    $prompt = @"
MEMORY:
$memory

USER:
$message
"@

    ollama run core $prompt
}