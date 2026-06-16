import type { MarketIntel } from './enterprise-ai-market-intel'

type Grounding = {
  tenantInfo: { businessType: string; name: string }
  current: { revenue: number; margin: number }
  deltas: { revenuePct: number }
  expenseInsights: { costToRevenueRatio: number; topExpenseCategories: Array<{ category: string }> }
  businessIntelligence?: { inventoryHealth?: { healthScore: number } }
}

export type StrategicInsight = {
  level: 'tactical' | 'operational' | 'strategic' | 'visionary'
  insight: string
  implications: string[]
  timeHorizon: 'immediate' | 'quarter' | 'year' | '3_years'
  competitiveAdvantage: 'cost' | 'differentiation' | 'focus' | 'network'
  requiredResources: string[]
  estimatedROI: number
  risks: string[]
}

export function generateStrategicInsights(
  grounding: Grounding,
  marketIntel: MarketIntel | null,
): StrategicInsight[] {
  const insights: StrategicInsight[] = []
  const margin = grounding.current.margin
  const revenueDelta = grounding.deltas.revenuePct
  const expenseRatio = grounding.expenseInsights.costToRevenueRatio

  if (margin < 12 && revenueDelta > 0) {
    insights.push({
      level: 'strategic',
      insight: 'Growth is positive but margin quality is thin; shift from volume-first to value-first mix.',
      implications: [
        'Prioritize high-margin categories in promotional calendar',
        'Re-price low-contribution products using tiered guardrails',
        'Introduce service/value bundles to reduce pure price competition',
      ],
      timeHorizon: 'year',
      competitiveAdvantage: 'differentiation',
      requiredResources: ['Category strategy', 'Pricing governance', 'Commercial enablement'],
      estimatedROI: 22,
      risks: ['Short-term conversion dip', 'Competitor response on price'],
    })
  }

  if (expenseRatio > 55) {
    insights.push({
      level: 'operational',
      insight: `Expense intensity is elevated (${expenseRatio.toFixed(1)}% cost-to-revenue). Launch an efficiency sprint.`,
      implications: [
        `Audit ${grounding.expenseInsights.topExpenseCategories[0]?.category || 'top cost category'} within 14 days`,
        'Enforce approval thresholds for variable expenses',
        'Track weekly unit-economics trend by branch/product cohort',
      ],
      timeHorizon: 'quarter',
      competitiveAdvantage: 'cost',
      requiredResources: ['Finance ops', 'Process analytics', 'Vendor negotiations'],
      estimatedROI: 14,
      risks: ['Over-correction can reduce service quality'],
    })
  }

  if (marketIntel && marketIntel.competitiveLandscape.marketSharePotential > 20) {
    insights.push({
      level: 'visionary',
      insight: 'Market share headroom is meaningful; consider a focused expansion thesis in your strongest segment.',
      implications: [
        'Pilot expansion in a high-demand micro-market before broad rollout',
        'Align product, pricing, and operations around one clear segment thesis',
        'Use 90-day stage gates with stop/go metrics to control risk',
      ],
      timeHorizon: '3_years',
      competitiveAdvantage: 'focus',
      requiredResources: ['Growth capital', 'Market ops', 'Execution PMO'],
      estimatedROI: 30,
      risks: ['Execution complexity', 'Demand overestimation'],
    })
  }

  if (insights.length === 0) {
    insights.push({
      level: 'tactical',
      insight: 'Current operating posture is stable; focus on disciplined execution and measurement cadence.',
      implications: [
        'Protect margin and inventory quality while scaling proven channels',
        'Run monthly pricing and demand calibration reviews',
      ],
      timeHorizon: 'immediate',
      competitiveAdvantage: 'network',
      requiredResources: ['Ops discipline', 'Performance dashboard'],
      estimatedROI: 8,
      risks: ['Opportunity cost if competitors accelerate faster'],
    })
  }

  return insights.slice(0, 4)
}
