# Uses environment variables so secrets are not hardcoded in source control.
$apiUrl = $env:BACKUP_JOB_API_URL
if (-not $apiUrl) { $apiUrl = 'http://localhost:3000/api/ops/backup/run' }

$secret = $env:BACKUP_JOB_SECRET
if (-not $secret) {
    Write-Error 'BACKUP_JOB_SECRET is not set in environment.'
    exit 1
}

try {
    $response = Invoke-RestMethod `
        -Uri        $apiUrl `
        -Method     POST `
        -Headers    @{ 'x-backup-job-secret' = $secret } `
        -ContentType 'application/json' `
        -TimeoutSec  120

    if ($response.data.success) {
        $restoreInfo = ''
        if ($response.data.restore -and $response.data.restore.configured) {
            $restoreState = if ($response.data.restore.success) { 'OK' } else { 'FAILED' }
            $restoreInfo = " | restore=$restoreState target=$($response.data.restore.targetHost)/$($response.data.restore.targetDatabase)"
        }
        Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Backup OK - `
$($response.data.filePath) `
($([math]::Round($response.data.sizeBytes / 1MB, 2)) MB, $($response.data.durationMs) ms)$restoreInfo"
    } else {
        Write-Error "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Backup FAILED - $($response.data.error)"
        exit 1
    }
} catch {
    Write-Error "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Backup request failed - $_"
    exit 1
}
