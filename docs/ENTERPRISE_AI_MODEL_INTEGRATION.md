# Enterprise AI External Model Integration (Production)

## Goal
Run the Enterprise Assistant with a production-grade external model provider while maintaining tenant-safe grounding, fallback behavior, and operational reliability.

## Recommended Models

### Primary Recommendation
- Provider: OpenAI API or Azure OpenAI
- Model class: GPT-4.1 family for highest reasoning quality on business analysis
- Cost-sensitive option: GPT-4o-mini class for high throughput

### Suggested Production Setup
- Primary model: high-quality model for complex assistant responses
- Fallback model: lower-cost model for resilience during outages or throttling
- Keep deterministic local fallback enabled in application code (already present)

## Current App Support
The backend currently supports:
- openai-compatible provider mode
- azure-openai provider mode
- timeout and retry controls
- model fallback in openai-compatible mode
- circuit-breaker cooldown after repeated failures

## Environment Configuration

### OpenAI-Compatible
Set in apps/api/.env:

- ENTERPRISE_AI_EXTERNAL_LLM_ENABLED=true
- ENTERPRISE_AI_LLM_PROVIDER=openai-compatible
- ENTERPRISE_AI_LLM_API_KEY=<provider-api-key>
- ENTERPRISE_AI_LLM_BASE_URL=https://api.openai.com/v1
- ENTERPRISE_AI_LLM_MODEL=gpt-4o-mini
- ENTERPRISE_AI_LLM_MODEL_FALLBACK=gpt-4o-mini
- ENTERPRISE_AI_LLM_TIMEOUT_MS=20000
- ENTERPRISE_AI_LLM_MAX_RETRIES=2

### Azure OpenAI
Set in apps/api/.env:

- ENTERPRISE_AI_EXTERNAL_LLM_ENABLED=true
- ENTERPRISE_AI_LLM_PROVIDER=azure-openai
- ENTERPRISE_AI_LLM_API_KEY=<azure-api-key>
- ENTERPRISE_AI_AZURE_ENDPOINT=https://<resource-name>.openai.azure.com
- ENTERPRISE_AI_AZURE_DEPLOYMENT=<deployment-name>
- ENTERPRISE_AI_AZURE_API_VERSION=2024-06-01
- ENTERPRISE_AI_LLM_TIMEOUT_MS=20000
- ENTERPRISE_AI_LLM_MAX_RETRIES=2

Note:
- In Azure mode, the deployment name is the model target.
- Keep ENTERPRISE_AI_LLM_MODEL for documentation consistency, but deployment controls execution.

## Integration Process (Production)

1. Provision provider account and billing
- Create OpenAI or Azure OpenAI account.
- Enable production billing limits and quota alerts.

2. Create model deployment
- OpenAI-compatible: choose model in API usage policy.
- Azure OpenAI: create deployment in your resource and record deployment name.

3. Store secrets securely
- Use environment secret manager (not committed files).
- Rotate API keys on a fixed schedule.

4. Configure backend environment
- Apply variables listed above.
- Restart API service.

5. Validate behavior
- Call Enterprise Assistant endpoint with known tenant prompts.
- Confirm provider path is used and response schema is valid.
- Confirm deterministic fallback still works if provider is disabled.

6. Roll out safely
- Start with limited tenant allowlist.
- Monitor latency, error rate, and fallback rate.
- Expand gradually after stability threshold is met.

## Required Operational Controls

- Latency SLO: set target p95 response latency for assistant endpoint
- Error budget: set external model failure threshold before alerting
- Fallback ratio tracking: monitor percentage of deterministic fallback usage
- Cost controls: monthly and daily budget alarms per environment
- Security: block sensitive prompt classes and redact sensitive output

## Recommended Next Technical Steps

1. Add provider health metrics
- assistant_external_provider_latency_ms
- assistant_external_provider_error_count
- assistant_external_provider_fallback_count

2. Add tenant-level model policy
- per-tenant model tier assignment
- per-tenant max token and timeout limits

3. Add prompt/output governance layer
- strict redaction pass before storing assistant output
- policy tags in output metadata for audit

4. Add model evaluation harness
- fixed prompt set with golden expected business-answer structure
- regression checks before model/deployment changes
