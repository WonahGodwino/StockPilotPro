# StockPilot Pro — Prioritized Milestone Board

This board is derived from [docs/GITHUB_ISSUES.md](docs/GITHUB_ISSUES.md) and ordered by delivery priority:
1. MVP first
2. Hardening second
3. Polish third

## M1 — MVP Launch
Target: core business value and production-ready baseline.

Scope from issue log:
- Auth and session lifecycle: #1, #2, #3, #4, #5
- Multi-tenant and subscriptions core: #6, #7, #8, #9, #10, #11
- Products and inventory core: #12, #13
- Sales/POS core: #16, #18
- Expenses core: #20, #21
- Reports and dashboard core: #22, #23, #24, #25
- Users and branches core: #32, #35, #36
- Infra baseline: #37, #38, #39, #40

Exit criteria:
- End-to-end flow works for login → products → POS sale → expenses → reports.
- Tenant isolation and RBAC checks pass for all API endpoints.
- Seeded demo environment starts with one command and passes smoke tests.

## M2 — Hardening & Reliability
Target: resilience, security quality, and reliability in real conditions.

Scope from issue log:
- Notifications and operational awareness: #26, #27, #28
- Offline robustness and PWA reliability: #29, #30, #31
- RBAC hardening and user admin UX: #33, #34
- Test coverage and quality gates: #41, #42, #43, #44, #45, #46
- Ops and auditability enhancements: #51, #52

Additional future upgrades included in this phase:
- Scheduled database backup and restore drill automation
- Observability baseline (structured logs, tracing, uptime alerts)

Exit criteria:
- Test suites are green in CI for unit, integration, and E2E critical paths.
- Offline sync retries and conflict handling are validated.
- Security-sensitive paths (token flow, RBAC, tenant access) are covered by tests.

## M3 — Polish & Growth
Target: usability improvements and growth-focused capabilities.

Scope from issue log:
- UI polish: #47, #48, #49, #50
- Reporting enhancements: #53

Additional future upgrades included in this phase:
- Multi-currency pricing and reporting
- SSO support (Google/Microsoft) for admin users
- Customer/loyalty module for repeat buyers

Exit criteria:
- Mobile and desktop UX scorecards are met.
- Key growth features are prioritized with measurable adoption metrics.
- Performance budget remains within acceptable limits after enhancements.

## M4 — Enterprise AI Package Acceleration
Target: ship practical AI services as a subscription-gated Enterprise package.

Scope from issue log:
- Enterprise entitlement and access control: #54, #55, #66
- Data foundation (tenant + platform + public signals): #56, #57
- Practical AI services: #58, #59, #60, #61
- Enterprise UX and actioning: #62, #63, #64
- Reliability and measurement: #65

Execution model:
- Run backend platform track and frontend experience track in parallel.
- Prioritize guardrails and tenant isolation before broad feature exposure.
- Release incrementally behind entitlement checks for Enterprise tenants only.

Exit criteria:
- Enterprise-only gating is enforced across API and UI.
- Unlimited branches is active for Enterprise tenants.
- AI recommendations are explainable, auditable, and source-attributed.
- Practical business impact metrics are visible to product and operations.

## Operating Notes
- Sensitive content is intentionally excluded from GitHub issue bodies.
- Demo credentials and secrets must remain outside issues and outside committed env files.
- Use [scripts/sync_github_issues.ps1](scripts/sync_github_issues.ps1) to create/sync issues to GitHub.
