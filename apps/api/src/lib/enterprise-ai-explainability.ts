import type { SimulationResult } from './enterprise-ai-simulator'

type AssistantBriefLike = {
  summary: string
  actions: string[]
  risks: string[]
}

type Grounding = {
  coverageScore: number
  salesInsights: { transactionCount: number; salesTrend: string }
  profitability: { netMarginPct: number; lossMakingProductCount: number }
  expenseInsights: { expenseGrowthRate: number }
  inventoryRiskItems: Array<{ productName: string; urgency: 'P1' | 'P2' | 'P3' }>
  dataQuality: { recency: string }
}

export type Explanation = {
  summary: string
  keyFactors: Array<{ factor: string; contribution: number; direction: 'positive' | 'negative' }>
  alternatives: Array<{ action: string; expectedOutcome: number; tradeoffs: string[] }>
  confidence: number
  limitations: string[]
  suggestedNextQuestions: string[]
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(2))
}

export function buildRecommendationExplanation(
  recommendation: AssistantBriefLike,
  grounding: Grounding,
  simulationResults: SimulationResult[] = [],
): Explanation {
  const keyFactors: Explanation['keyFactors'] = []

  if (grounding.inventoryRiskItems.length > 0) {
    keyFactors.push({
      factor: `Inventory risk signals on ${grounding.inventoryRiskItems[0].productName}`,
      contribution: 0.35,
      direction: 'negative',
    })
  }

  if (grounding.profitability.netMarginPct < 10) {
    keyFactors.push({
      factor: `Thin net margin (${grounding.profitability.netMarginPct.toFixed(1)}%)`,
      contribution: 0.3,
      direction: 'negative',
    })
  }

  if (grounding.expenseInsights.expenseGrowthRate > 12) {
    keyFactors.push({
      factor: `Expense growth pressure (${grounding.expenseInsights.expenseGrowthRate.toFixed(0)}%)`,
      contribution: 0.2,
      direction: 'negative',
    })
  }

  if (grounding.salesInsights.salesTrend === 'increasing') {
    keyFactors.push({
      factor: 'Positive demand momentum',
      contribution: 0.15,
      direction: 'positive',
    })
  }

  if (keyFactors.length === 0) {
    keyFactors.push({
      factor: 'Balanced baseline with no dominant risk signal',
      contribution: 0.2,
      direction: 'positive',
    })
  }

  const totalContribution = keyFactors.reduce((sum, f) => sum + f.contribution, 0)
  const normalizedFactors = totalContribution > 0
    ? keyFactors.map((factor) => ({ ...factor, contribution: round2(factor.contribution / totalContribution) }))
    : keyFactors

  const alternatives = simulationResults.slice(0, 3).map((sim) => ({
    action: sim.scenario.name,
    expectedOutcome: sim.projectedProfit,
    tradeoffs: sim.risks,
  }))

  const confidencePenalty = grounding.dataQuality.recency === 'outdated' ? 0.2 : grounding.dataQuality.recency === 'stale' ? 0.1 : 0
  const confidence = round2(Math.max(0.1, Math.min(0.99, grounding.coverageScore - confidencePenalty)))

  return {
    summary: recommendation.summary ||
      `Recommendation is based on ${normalizedFactors.map((f) => f.factor).join(', ')} and current tenant risk posture.`,
    keyFactors: normalizedFactors,
    alternatives,
    confidence,
    limitations: [
      'Based primarily on recent historical business data and rule-driven heuristics',
      'External shocks and sudden market changes are not fully captured in deterministic paths',
      'Confidence depends on data freshness and coverage quality',
    ],
    suggestedNextQuestions: [
      'Show downside scenario if demand falls by 10%',
      'What intervention has the fastest payback period?',
      'How sensitive is this recommendation to expense growth?',
    ],
  }
}
