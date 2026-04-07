# StockPilot Pro — Enterprise AI Package Requirements

## Document Purpose

Define production requirements for an Enterprise subscription package that delivers practical AI capabilities for business growth and management.

This package is tenant-gated and unavailable to non-Enterprise tenants.

---

## Package Definition

### Package Name
- Enterprise Package

### Commercial Positioning
- Premium add-on package for advanced, AI-driven decision support.
- Includes unlimited number of branches.
- Includes unlimited salesperson accounts.

### Enterprise Benefits (Customer-Facing)
- Unlimited branches: expand to any number of locations without package ceiling friction.
- Unlimited salespersons: onboard full field and in-store sales teams without seat limits.
- Demand forecast and reorder advisor: reduce stockouts, prevent overstock, and improve working capital.
- Pricing and margin advisor: optimize price points with clearer margin impact before changes.
- Cash-flow forecast and expense risk alerts: improve planning confidence and catch budget drift earlier.
- Anomaly detection: surface suspicious discounts, duplicates, and shrinkage before losses compound.
- Branch performance copilot: identify underperforming branches and prioritize high-impact fixes quickly.
- Natural-language AI assistant: get operational insights and action lists from plain-language questions.

### Entitlement Rule
- Only tenants with an active Enterprise package entitlement can access Enterprise AI services.
- Non-Enterprise tenants must receive upgrade prompts and cannot call Enterprise AI endpoints.

---

## Business Outcomes

### Growth Outcomes
- Increase sales through better demand planning and product mix recommendations.
- Improve margin through pricing and discount guidance.
- Increase customer retention via churn-risk detection and targeted interventions.

### Management Outcomes
- Reduce stockouts and overstock.
- Improve cash-flow predictability.
- Detect anomalies (possible leakage/fraud/operational errors) early.
- Prioritize branch-level actions for managers.

---

## AI Capability Set (Practical and Realistic)

### 1) Demand Forecast and Reorder Advisor
- Forecast demand per product per branch using platform sales history and seasonality.
- Recommend reorder quantity, reorder point, and suggested order timing.
- Output must include confidence level and key drivers (top reasons behind recommendation).

### 2) Pricing and Margin Advisor
- Recommend price adjustments using local demand, purchase cost trends, and competitor/public market signals where available.
- Provide safe adjustment ranges, not forced auto-pricing.
- Explain expected margin impact before applying any change.

### 3) Cash-Flow Forecast and Expense Risk Alerts
- Forecast expected inflows/outflows from recent sales and recurring expense patterns.
- Flag expense categories showing unusual growth or volatility.
- Suggest low-risk cost-control actions with projected effect.

### 4) Anomaly Detection (Sales, Expenses, Inventory)
- Detect suspicious events such as duplicate expenses, abnormal discounts, sudden shrinkage, and outlier transaction values.
- Produce risk scores and recommended verification actions.
- Route alerts to authorized roles only.

### 5) Branch Performance Copilot
- Compare branches on standardized metrics (revenue, margin, stock health, expense efficiency).
- Identify underperforming branches and prescribe concrete actions.
- Support unlimited branches for Enterprise tenants.

### 6) Natural-Language AI Assistant
- Let authorized users ask business questions in plain language.
- Example outputs: root-cause summaries, trend breakdowns, and action checklists.
- Responses must include data provenance (platform data vs public data).

---

## Data Requirements

### Tenant Local Context (Highest Priority)
- Sales history by product, branch, period.
- Product catalog, stock movement, cost/selling prices, low-stock thresholds.
- Expense records by category and branch.
- Branch metadata and branch-level performance patterns.
- Subscription/plan context and enabled features.

### Platform Data (Cross-Tenant, Privacy-Preserving)
- Aggregated and anonymized benchmarks by segment/region/business type.
- Model-level priors derived from pooled trends without exposing tenant-identifiable data.

### Public Data (Contextual Signals)
- Macroeconomic indicators (inflation, FX, commodity proxies) where relevant.
- Public holidays and seasonal calendars.
- Publicly available market signals that can influence demand.

### Data Governance Rules
- Tenant isolation is mandatory for all non-aggregated data operations.
- Cross-tenant learning must use anonymized and aggregated features only.
- Every recommendation must include traceable source tags.

---

## Subscription Gating Requirements

### Entitlement Model
- Introduce a package entitlement state: `ENTERPRISE_AI_ENABLED`.
- Entitlement is derived from active subscription package and status.

### Enforcement Points
- Backend: middleware guard on all Enterprise AI API routes.
- Frontend: menu, pages, and actions hidden/disabled for non-entitled tenants.
- Sync jobs: Enterprise pipelines run only for entitled tenants.

### Failure Behavior
- Unauthorized package access returns `403` with upgrade metadata.
- Frontend displays clear upgrade CTA and package benefit summary.

### Unlimited Branches Requirement
- Enterprise package must bypass standard branch cap (`maxBranches`) and allow unlimited branches.
- Existing non-Enterprise branch limits remain enforced.

---

## Product and UX Requirements

### AI Insights Surfaces
- Dashboard cards: high-impact risks and opportunities first.
- Recommendations queue: prioritized by expected business impact.
- Explainability panel: why suggestion exists, confidence, and expected impact.

### Human-in-the-Loop Controls
- Recommendations are actionable but not silently auto-applied by default.
- Users can accept, reject, snooze, or mark not relevant.
- Capture feedback to improve model relevance for each tenant.

### Alert Quality Requirements
- Use relevance thresholds to reduce noisy alerts.
- Deduplicate repeated alerts for the same root cause.

---

## Technical Requirements

### API and Service Boundaries
- New Enterprise AI route group under `/api/enterprise-ai/*`.
- Tenant-scoped query and aggregation services.
- Model orchestration service with pluggable providers.

### Storage and Auditability
- Store recommendations with fields: `inputSnapshot`, `modelVersion`, `confidence`, `sourceTags`, `decisionStatus`.
- Log user actions on recommendations in audit trail.

### Evaluation and Quality
- Measure precision/recall for anomaly alerts.
- Measure forecast error and recommendation adoption rate.
- Support controlled rollout toggles per tenant.

---

## Security and Compliance Requirements

- No tenant-identifiable data leakage across tenant boundaries.
- Role-based access to Enterprise AI actions and sensitive explanations.
- Prompt and output filtering for sensitive data.
- Full audit logs for recommendation generation and user decisions.

---

## Acceptance Criteria

- Enterprise tenants can access all Enterprise AI pages and APIs.
- Non-Enterprise tenants are blocked with clear upgrade flow.
- Unlimited branches is enforceable for Enterprise tenants.
- AI recommendations use tenant local context plus public/platform signals.
- Recommendations are practical, explainable, and traceable.
- All Enterprise AI actions are audited and tenant-scoped.

---

## Success Metrics

- Stockout rate reduction.
- Inventory carrying cost reduction.
- Gross margin improvement.
- Expense anomaly detection hit rate.
- Recommendation adoption rate.
- Branch-level performance variance reduction.
