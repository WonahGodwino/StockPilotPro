# Enterprise AI Assistant Quality Criteria

Last updated: April 8, 2026
Scope: Response quality for Enterprise Assistant prompts, with priority focus on inventory/restock intent.

## 1. Mandatory Intent Alignment
A response must directly answer the user intent.

Pass examples:
- Restock prompt returns product-level reorder actions.
- Expense-risk prompt returns cost-control actions and risk rationale.

Fail examples:
- Restock prompt returns generic margin commentary.
- Inventory prompt returns no product names or reorder quantities.

## 2. Restock/Stockout Prompt Acceptance Criteria
When prompt intent is restock/stockout/reorder/inventory, response MUST include:
1. Product-level candidates (at least one when risk exists).
2. Suggested reorder quantity per product.
3. Stock or stockout-risk context (current stock and/or days-to-stockout).
4. Priority/urgency signal (P1/P2/P3 or equivalent).
5. Action wording that can be executed immediately.

Response SHOULD include:
- Branch context where available.
- Forecast window reference (e.g., 7 days).
- Assumptions/risks (lead time, data freshness).

## 3. Reliability/Observability Criteria
For assistant responses, system SHOULD emit metrics:
- assistant_grounding_quality_score
- assistant_response_latency_ms
- assistant_external_provider_latency_ms (when external model is used)
- assistant_external_provider_fallback_count
- assistant_external_provider_error_count

Quality guard:
- If external output is structurally valid but not intent-relevant for restock prompts, fallback path must be used.

## 4. Response Helpfulness Scoring Rubric
Use 0-10 scoring on each dimension:
- Relevance: answers the exact business question.
- Actionability: includes executable steps with quantities/priorities.
- Specificity: product/branch/time-window specificity.
- Trust: internal consistency and sensible assumptions.

Minimum acceptable production score:
- Relevance >= 7
- Actionability >= 7
- Specificity >= 6
- Trust >= 6

## 5. Regression Test Cases (Checklist)

### A. Restock intent positive case
Prompt:
- "What should we restock in the next 7 days to avoid stockouts?"
Expected:
- Contains restock/reorder actions with product-level quantities.
- Does not degrade into generic margin-only recommendations.

### B. Non-restock intent safety
Prompt:
- "Which branch actions can improve margin this week?"
Expected:
- Returns branch/margin actions.
- No forced inventory-only output.

### C. External model irrelevance fallback
Condition:
- External response parsed but lacks inventory relevance for restock prompt.
Expected:
- Deterministic fallback is used.
- Fallback reason captured as INVALID_EXTERNAL_OUTPUT.

### D. Data sparse condition
Prompt:
- Restock query with low sales/low inventory signal.
Expected:
- Response states limited confidence and monitoring guidance.
- Avoids fabricated product claims.

## 6. Release Gate Recommendation
Before shipping assistant changes:
1. Run endpoint and HTTP integration suites.
2. Run prompt QA set with at least 10 fixed enterprise prompts (including restock).
3. Verify scoring rubric thresholds.
4. Verify metrics emission for reliability panel.

## 7. Operational Review Cadence
Weekly:
- Review top failed prompts by relevance/actionability.
- Review fallback rate and quality drift.
- Update prompt templates and intent rules as needed.
