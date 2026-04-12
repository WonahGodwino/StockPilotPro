# Enterprise AI Quickstart (1-Page)

Last updated: April 8, 2026
Audience: BUSINESS_ADMIN, SUPER_ADMIN
Time to value: 15-30 minutes

## Goal
Use Enterprise AI daily to increase profit, control expenses, and improve execution speed.

## 5-Minute Setup
1. Open Enterprise AI Console.
2. Confirm role access (BUSINESS_ADMIN or SUPER_ADMIN).
3. Check Alert Fatigue Policy:
- Minimum priority: start with P2.
- Quiet hours: optional, UTC only.
- Dedupe: P1 2h, P2 8h, P3 24h baseline.
4. Refresh insights.

## Daily Operating Loop
1. Triage alerts by priority:
- P1: handle immediately.
- P2: handle same day.
- P3: monitor and schedule preventive action.
2. Review Branch Performance Insights.
3. Ask Enterprise Assistant for focused actions.
4. Convert top recommendations into Action Tracker items.
5. Assign owner and due date.
6. Update progress and realized impact before close of day.

## Best Prompt Pattern
Use this structure:
- Decision + Scope + Time + Constraint + Output format

Template:
"For [branch/category], compare last [7/30] days vs prior period. Give top 3 actions to improve net margin this week, with risks and expected impact."

## Ready-to-Use Prompts
- "Which two branches should reduce discounting this week to recover margin fastest?"
- "What reorder actions reduce stockout risk in the next 14 days with low cash lock-in?"
- "Given current expense trend, list cost controls that protect top-product sales."
- "Rank action items for this week by expected margin recovery and urgency."

## Action Tracker Discipline
Every high-priority recommendation must include:
- Single owner
- Due date
- Expected impact score
- Progress note

Use statuses correctly:
- TODO, IN_PROGRESS, BLOCKED, DONE, CANCELLED

## Weekly Review (30 Minutes)
1. Overdue actions and blockers
2. Adoption vs outcomes by recommendation type
3. Positive outcome rate trend
4. Alert noise vs missed incidents
5. One policy adjustment only if data supports it

## KPI Starter Pack
- Recommendation adoption rate
- Action completion rate
- Time-to-decision (P1/P2)
- Positive outcome rate
- Overdue action count

## Common Mistakes
- Generic prompts without scope
- Ignoring P2 alerts for days
- Actions without owners/due dates
- Frequent alert-policy changes without measuring impact

## Escalation Rules
- If P1 repeats after action: escalate to SUPER_ADMIN and trigger immediate review.
- If alert noise is high for 7 days: raise min priority and extend P3 dedupe.
- If outcomes are weak for 2+ weeks: review prompt quality and action execution.

## Where to Go Next
- Full user guide: docs/ENTERPRISE_AI_USER_GUIDE.md
- Model integration and ops: docs/ENTERPRISE_AI_MODEL_INTEGRATION.md
- Scheduler operations: docs/ENTERPRISE_AI_SCHEDULER.md
