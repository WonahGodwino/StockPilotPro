# Enterprise AI Scheduler Runbook

## Purpose
The Enterprise AI scheduler refreshes stale snapshots, precomputes high-value recommendations for high-volume tenants, and invalidates stale assistant contexts.

Route:
- `POST /api/enterprise-ai/jobs/refresh`

Required header:
- `x-enterprise-job-secret: <ENTERPRISE_AI_JOB_SECRET>`

## Request Body
All fields are optional.

```json
{
  "tenantLimit": 20,
  "staleMinutes": 45,
  "staleContextHours": 48,
  "precomputeMinTxCount": 120,
  "dryRun": false
}
```

## Environment Variables
- `ENTERPRISE_AI_JOB_SECRET`: Shared secret for the internal job route.
- `ENTERPRISE_AI_JOB_TENANT_LIMIT`: Default max tenants per batch.
- `ENTERPRISE_AI_JOB_STALE_MINUTES`: Snapshot staleness threshold.
- `ENTERPRISE_AI_STALE_CONTEXT_HOURS`: Assistant context invalidation threshold.
- `ENTERPRISE_AI_PRECOMPUTE_MIN_TX_COUNT`: Minimum 30-day transaction count before precompute.

## Observability
Scheduler writes these metrics:
- `enterprise_ai_refresh_job_run`
- `enterprise_ai_refresh_job_duration_ms`
- `enterprise_ai_refresh_precomputed_count`
- `enterprise_ai_refresh_stale_invalidated_count`
- `enterprise_ai_refresh_job_batch_duration_ms`

Each tenant run is also audited with action `ENTERPRISE_AI_REFRESH_JOB_RUN`.

## Retry Strategy
- Tenant runs are isolated; one tenant failure does not stop the batch.
- Retries should be handled by the orchestrator (for example, GitHub Actions cron, Cloud Scheduler, or a queue worker):
  - First retry: +2 minutes
  - Second retry: +10 minutes
  - Third retry: +30 minutes

## Dead-Letter Handling
- After 3 failed retries, push the failed payload and response to a dead-letter queue/topic (`enterprise-ai-refresh-dlq`).
- Alert operations and include:
  - request payload
  - failed tenant IDs
  - error messages
  - timestamp and environment
- Re-run with `dryRun: true` first to confirm safety before replaying from DLQ.

## Example Trigger (PowerShell)
```powershell
$headers = @{ "x-enterprise-job-secret" = $env:ENTERPRISE_AI_JOB_SECRET; "Content-Type" = "application/json" }
$body = '{"tenantLimit":20,"dryRun":false}'
Invoke-RestMethod -Method Post -Uri "https://api.example.com/api/enterprise-ai/jobs/refresh" -Headers $headers -Body $body
```