$apiUrl = $env:BACKUP_JOB_API_URL
if (-not $apiUrl) { $apiUrl = 'http://localhost:3000/api/ops/backup/run' }

$secret = $env:BACKUP_JOB_SECRET
if (-not $secret) {
    Write-Error 'BACKUP_JOB_SECRET is not set in environment.'
    exit 1
}

try {
    $response = Invoke-RestMethod -Uri $apiUrl -Method POST -Headers @{ 'x-backup-job-secret' = $secret } -ContentType 'application/json' -TimeoutSec 120
    if ($response.data.success) { Write-Host "Backup OK: $($response.data.filePath) ($($response.data.sizeBytes) bytes, $($response.data.durationMs)ms)" }
    else { Write-Error "Backup FAILED: $($response.data.error)"; exit 1 }
} catch { Write-Error "Backup request failed: $_"; exit 1 }
