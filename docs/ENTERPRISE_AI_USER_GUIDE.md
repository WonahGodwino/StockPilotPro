# Enterprise AI User Guide

Last updated: April 8, 2026
Audience: BUSINESS_ADMIN and SUPER_ADMIN users

Companion documents:
- docs/ENTERPRISE_AI_BRANCH_ONBOARDING.md
- docs/ENTERPRISE_AI_QUICKSTART.md
- docs/ENTERPRISE_AI_TRAINING_DECK.md
- docs/ENTERPRISE_AI_ASSISTANT_QUALITY_CRITERIA.md
- docs/ENTERPRISE_AI_MODEL_INTEGRATION.md
- docs/ENTERPRISE_AI_SCHEDULER.md

## 1. Purpose
This guide explains how to use StockPilot Enterprise AI effectively in daily operations and how to maximize business value from recommendations, alerts, simulations, and action tracking.

Primary outcomes:
- Grow revenue with faster, better decisions.
- Protect margin by detecting cost pressure early.
- Reduce avoidable expenses and stock risk.
- Improve execution discipline through tracked actions.

## 2. What Enterprise AI Does
Enterprise AI currently provides:
- Branch performance insights with ranked branch metrics.
- Demand and reorder recommendations with confidence and risk scoring.
- Cashflow and expense-risk recommendations with external signal awareness.
- Enterprise Assistant responses grounded in tenant data and comparison periods.
- Adaptive risk alerts (P1, P2, P3) with dedupe and fatigue controls.
- Action Tracker workflow to assign owners, due dates, and impact.

## 3. Access and Role Expectations
Allowed roles:
- SUPER_ADMIN
- BUSINESS_ADMIN

Not allowed:
- SALESPERSON (for enterprise control features)

Recommended operating model:
- BUSINESS_ADMIN handles daily decision execution.
- SUPER_ADMIN handles governance, escalations, and cross-tenant standards.

## 4. Daily Workflow (High Impact)
Use this sequence each workday.

1. Open Enterprise AI Console.
2. Review P1 and P2 alerts first.
3. Check Branch Performance Insights for margin leaders and laggards.
4. Use Enterprise Assistant for focused decision support.
5. Convert top recommendations into Action Tracker items.
6. Assign owner, due date, and expected impact score.
7. End of day: update progress notes and realized impact where possible.

## 5. How to Ask Better Assistant Questions
Bad prompts are generic. Good prompts are scoped and decision-focused.

Use this prompt template:
- Decision: what decision you need now.
- Scope: branch/product/category and time window.
- Constraint: budget, stock, supplier, or staffing limits.
- Output format: ask for actions, risks, and expected impact.

Example template:
"For [branch/category], compare last 7 days vs prior 7 days. Recommend top 3 actions to improve net margin this week, with risks and expected impact."

Good prompt examples:
- "Which two branches should reduce discounting this week to recover margin fastest?"
- "For beverages category, what restock action prevents stockout in the next 14 days with minimal tied cash?"
- "Given expense growth this month, list immediate controls that reduce cost without harming top-selling products."
- "Compare current 30-day net trend vs previous 30 days and suggest interventions by branch owner."

## 6. Alert Priorities and Response SLA
Use a strict response discipline.

- P1: critical risk, immediate response.
- P2: significant pressure, same-day response.
- P3: early warning, monitor and schedule preventive action.

Recommended SLAs:
- P1: triage within 30 minutes.
- P2: triage within 4 hours.
- P3: triage within 1 business day.

## 7. Alert Fatigue Policy Tuning
Use the Alert Fatigue Policy panel in Enterprise AI Console.

Controls:
- Minimum priority to notify.
- Quiet hours start and end (UTC).
- Suppress-after-read hours.
- Dedupe windows for P1/P2/P3.

Suggested baseline:
- Minimum priority: P2 for mature operations, P3 for early rollout.
- Quiet hours: only if an on-call process exists for P1.
- Suppress-after-read: 12 to 24 hours.
- Dedupe windows: P1 1-2h, P2 4-8h, P3 12-24h.

Rollout tip:
- Change one policy variable at a time, observe for 7 days, then adjust.

## 8. Action Tracker Best Practices
Execution quality matters more than recommendation volume.

Rules:
- Every high-priority recommendation should become a tracked action.
- Every action must have one owner and one due date.
- Keep progress notes factual and short.
- Record realized impact when available.

Status guidance:
- TODO: accepted but not started.
- IN_PROGRESS: owner is actively executing.
- BLOCKED: waiting on dependency.
- DONE: completed and validated.
- CANCELLED: no longer relevant.

## 9. Weekly Optimization Cadence
Run this weekly review for continuous improvement.

1. Review top 10 actions by expected impact.
2. Check overdue actions and remove blockers.
3. Compare accepted vs rejected recommendations by type.
4. Review outcome quality metrics and positive outcome rate.
5. Adjust alert policy only if noise or misses are measurable.
6. Capture top lessons and standardize playbooks by branch.

## 10. KPIs to Track
Minimum KPI set:
- Recommendation adoption rate.
- Action completion rate.
- Time-to-decision for P1 and P2 alerts.
- Positive outcome rate.
- Net outcome score trend.
- Overdue action count.

Business interpretation:
- High adoption + low outcomes means poor recommendation quality or weak execution.
- Low adoption + high alert volume means alert fatigue and prioritization issues.
- High overdue rate means ownership or capacity problems.

## 11. Common Mistakes to Avoid
- Asking broad prompts without scope, time, or constraints.
- Ignoring P2 alerts for multiple days.
- Creating actions without owners or due dates.
- Changing alert settings too often without measurement.
- Treating assistant output as final without operator validation.

## 12. Troubleshooting Quick Checks
If AI output seems weak:
1. Confirm recent sales, expense, and product data are current.
2. Use specific prompts with period comparison request.
3. Validate tenant alert policy is not over-suppressing useful alerts.
4. Trigger fresh recommendations and compare with prior outputs.

If alerts are too noisy:
1. Raise minimum priority to P2.
2. Increase P3 dedupe hours.
3. Add quiet hours if your operating model supports it.
4. Keep P1 tight so critical incidents are never muted.

## 13. 30-Day Adoption Plan
Week 1:
- Train admins on prompt quality and alert triage.
- Start with conservative policy settings.

Week 2:
- Enforce Action Tracker usage for P1/P2 recommendations.
- Measure completion and overdue rates.

Week 3:
- Tune dedupe and suppress-after-read from observed noise.
- Standardize 5-10 reusable prompt templates.

Week 4:
- Review KPI trends.
- Publish branch-level wins and repeatable playbooks.

## 14. Summary
To maximize Enterprise AI value:
- Prioritize alert discipline.
- Use scoped prompts.
- Convert insight into owned actions.
- Measure outcomes weekly.
- Tune policy with evidence, not assumptions.
