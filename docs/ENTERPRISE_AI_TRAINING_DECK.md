# Enterprise AI Training Deck (Facilitator Script)

Last updated: April 8, 2026
Audience: Operations leaders, branch managers, admins
Format: 45-60 minutes + Q&A

## Slide 1 - Title
StockPilot Enterprise AI: From Insight to Measurable Business Impact

Speaker notes:
- Explain the objective: better decisions, faster execution, measurable outcomes.

## Slide 2 - Why This Matters
- Margin pressure rises quickly when signals are ignored.
- Most losses come from slow execution, not lack of data.
- Enterprise AI closes the loop: detect -> prioritize -> act -> measure.

Speaker notes:
- Emphasize this is an execution system, not just analytics.

## Slide 3 - What Enterprise AI Includes
- Branch Performance Insights
- Demand/Reorder guidance
- Cashflow and expense-risk alerts
- Enterprise Assistant
- Action Tracker board
- Alert fatigue controls

## Slide 4 - Roles and Responsibility
- BUSINESS_ADMIN: daily execution owner
- SUPER_ADMIN: governance and escalation owner
- SALESPERSON: excluded from enterprise control operations

## Slide 5 - The Daily Loop
1. Triage P1/P2 alerts.
2. Review branch rankings.
3. Ask assistant for scoped actions.
4. Create action items with owner and due date.
5. Update progress and impact.

## Slide 6 - Alert Priority Playbook
- P1: immediate intervention
- P2: same-day intervention
- P3: planned preventive work

SLA recommendation:
- P1: 30 minutes
- P2: 4 hours
- P3: 1 business day

## Slide 7 - Prompt Engineering for Managers
Prompt formula:
Decision + Scope + Time + Constraint + Output format

Examples:
- "Compare last 7 days vs prior 7 days for Branch A and Branch B; give 3 actions to recover net margin."
- "For beverages, recommend restock plan for next 14 days with lowest cash exposure."

## Slide 8 - Converting Insights to Actions
Action creation checklist:
- One owner
- One due date
- Expected impact
- Clear progress note standard

Speaker notes:
- No owner means no execution.

## Slide 9 - Alert Fatigue Tuning
Controls:
- Minimum priority
- Quiet hours (UTC)
- Suppress-after-read
- Dedupe windows by P1/P2/P3

Rule:
- Change one variable at a time and evaluate for 7 days.

## Slide 10 - KPI Dashboard Expectations
Track weekly:
- Adoption rate
- Completion rate
- Positive outcome rate
- Net outcome score trend
- Overdue actions
- Time-to-decision for P1/P2

## Slide 11 - Common Failure Modes
- Generic prompts
- Alert blindness from poor policy settings
- High action backlog and overdue owners
- No weekly review ritual

## Slide 12 - 30-Day Rollout Plan
Week 1: access + prompt training + baseline policy
Week 2: mandatory action tracking for P1/P2
Week 3: policy tuning from observed noise
Week 4: KPI review and branch playbook standardization

## Slide 13 - Governance and Safety
- Keep tenant context strict.
- Treat AI outputs as decision support, not auto-execution.
- Use rollback for alert policy revisions when needed.

## Slide 14 - Live Demo Script
1. Open Enterprise AI Console.
2. Show alert triage.
3. Ask one scoped assistant prompt.
4. Create a tracked action from recommendation.
5. Update status and impact note.
6. Open policy history and show rollback action.

## Slide 15 - Success Criteria
In 30 days, target:
- Faster P1/P2 response
- Lower overdue action count
- Improved positive outcome rate
- Fewer noisy alerts without missing critical events

## Slide 16 - Q&A and Commitments
- What will each team change this week?
- Which KPI will each manager own?
- When is weekly review scheduled?

## Appendix A - Facilitator Checklist
Before session:
- Confirm enterprise access and test data.
- Prepare 3 real prompts from operations context.
- Identify one recent incident to replay in demo.

After session:
- Publish agreed prompt templates.
- Confirm weekly review owner.
- Record baseline KPIs and review date.

## Appendix B - Quick References
- User guide: docs/ENTERPRISE_AI_USER_GUIDE.md
- One-page quickstart: docs/ENTERPRISE_AI_QUICKSTART.md
- Model integration guide: docs/ENTERPRISE_AI_MODEL_INTEGRATION.md
- Scheduler runbook: docs/ENTERPRISE_AI_SCHEDULER.md
