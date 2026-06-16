import { prisma } from '@/lib/prisma'
import { average, clamp, inverseNormalQuantile, quantile, round2, standardDeviation } from './enterprise-ai-statistics'

export type SimulationType = 'price_change' | 'marketing_spend' | 'inventory_change' | 'staffing_change' | 'expansion'

type Grounding = {
  tenantId: string
  tenantInfo: { businessType: string }
  current: { revenue: number; expense: number; profit: number; margin: number }
  inventoryRiskItems: Array<{ urgency: 'P1' | 'P2' | 'P3'; stockValue: number }>
  expenseInsights: { expenseGrowthRate: number }
  coverageScore: number
}

export type SimulationScenario = {
  name: string
  type: SimulationType
  parameters: Record<string, number>
  confidence: number
}

export type SimulationResult = {
  scenario: SimulationScenario
  projectedRevenue: number
  projectedProfit: number
  projectedMargin: number
  projectedCashFlow: number
  roi: number
  paybackDays: number
  risks: string[]
  upsides: string[]
  recommendation: 'strong_yes' | 'yes' | 'caution' | 'no' | 'strong_no'
  confidenceInterval: {
    revenueLow: number
    revenueHigh: number
    profitLow: number
    profitHigh: number
  }
  percentile10: number
  percentile90: number
  calibration?: {
    sampleSize: number
    projectionMultiplier: number
    confidenceMultiplier: number
    averageSuccessScore: number
    posteriorBiasMean: number
    posteriorVariance: number
    calibrationScore: number
    historicalAccuracy: number
  }
}

export type SimulationComparison = {
  results: SimulationResult[]
  best: SimulationResult | null
  worst: SimulationResult | null
  sensitivity: Record<string, number>
  calibrationSummary?: {
    sampleSize: number
    averageSuccessScore: number
    calibrationScore: number
    historicalAccuracy: number
  }
}

type CalibrationProfile = {
  sampleSize: number
  projectionMultiplier: number
  confidenceMultiplier: number
  averageSuccessScore: number
  posteriorBiasMean: number
  posteriorVariance: number
  calibrationScore: number
  historicalAccuracy: number
  errorP10: number
  errorP90: number
}

function recommendationTypesForScenario(type: SimulationType): string[] {
  switch (type) {
    case 'price_change':
      return ['PRICING_MARGIN_ADVISOR']
    case 'marketing_spend':
      return ['DEMAND_FORECAST', 'BRANCH_PERFORMANCE']
    case 'inventory_change':
      return ['REORDER_ADVISOR']
    case 'staffing_change':
      return ['EXPENSE_RISK_ALERT', 'CASHFLOW_FORECAST']
    case 'expansion':
      return ['BRANCH_PERFORMANCE', 'CASHFLOW_FORECAST']
    default:
      return ['NL_ASSISTANT']
  }
}

async function getCalibrationProfile(tenantId: string, type: SimulationType): Promise<CalibrationProfile> {
  const recommendationTypes = recommendationTypesForScenario(type)
  const outcomes = await prisma.recommendationOutcome.findMany({
    where: {
      tenantId,
      recommendationType: { in: recommendationTypes },
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      predictedImpact: true,
      actualImpact: true,
      successScore: true,
    },
  })

  if (outcomes.length === 0) {
    return {
      sampleSize: 0,
      projectionMultiplier: 1,
      confidenceMultiplier: 0.9,
      averageSuccessScore: 0.5,
      posteriorBiasMean: 0,
      posteriorVariance: 0.18,
      calibrationScore: 0.3,
      historicalAccuracy: 0,
      errorP10: -0.35,
      errorP90: 0.35,
    }
  }

  const errorRatios = outcomes
    .filter((row) => Number.isFinite(row.predictedImpact) && Math.abs(row.predictedImpact) > 0.0001 && Number.isFinite(row.actualImpact))
    .map((row) => (row.actualImpact - row.predictedImpact) / Math.abs(row.predictedImpact))
    .filter((ratio) => Number.isFinite(ratio) && Math.abs(ratio) < 3)

  const successScores = outcomes
    .map((row) => row.successScore)
    .filter((value) => Number.isFinite(value))

  if (errorRatios.length === 0) {
    return {
      sampleSize: outcomes.length,
      projectionMultiplier: 1,
      confidenceMultiplier: 0.92,
      averageSuccessScore: round2(clamp(average(successScores), 0, 1)),
      posteriorBiasMean: 0,
      posteriorVariance: 0.16,
      calibrationScore: 0.35,
      historicalAccuracy: 0,
      errorP10: -0.3,
      errorP90: 0.3,
    }
  }

  const priorMean = 0
  const priorVariance = 0.18
  const sampleMean = average(errorRatios)
  const sampleVariance = Math.max(0.01, standardDeviation(errorRatios, true) ** 2)
  const sampleSize = errorRatios.length

  const posteriorVariance = 1 / (1 / priorVariance + sampleSize / sampleVariance)
  const posteriorMean = posteriorVariance * ((priorMean / priorVariance) + (sampleSize * sampleMean) / sampleVariance)

  const averageSuccessScore = clamp(successScores.length > 0 ? average(successScores) : 0.5, 0, 1)
  const historicalAccuracy = clamp(1 - average(errorRatios.map((ratio) => Math.abs(ratio))), 0, 1)
  const calibrationScore = clamp(1 / (1 + posteriorVariance * 10), 0, 1)
  const projectionMultiplier = clamp(1 + posteriorMean, 0.6, 1.4)
  const confidenceMultiplier = clamp(0.72 + calibrationScore * 0.22 + averageSuccessScore * 0.12, 0.65, 1.08)

  return {
    sampleSize: outcomes.length,
    projectionMultiplier,
    confidenceMultiplier,
    averageSuccessScore: round2(averageSuccessScore),
    posteriorBiasMean: round2(posteriorMean),
    posteriorVariance: round2(posteriorVariance),
    calibrationScore: round2(calibrationScore),
    historicalAccuracy: round2(historicalAccuracy),
    errorP10: round2(quantile(errorRatios, 0.1)),
    errorP90: round2(quantile(errorRatios, 0.9)),
  }
}

function calibrateFromBaseline(baseline: number, projected: number, multiplier: number): number {
  const delta = projected - baseline
  return baseline + delta * multiplier
}

function buildBaseScenarios(question: string, grounding: Grounding): SimulationScenario[] {
  const lower = question.toLowerCase()
  const scenarios: SimulationScenario[] = []

  if (lower.includes('price')) {
    scenarios.push({
      name: 'Price Increase +5%',
      type: 'price_change',
      parameters: { priceChangePct: 5 },
      confidence: clamp(grounding.coverageScore * 0.92, 0.35, 0.95),
    })
    scenarios.push({
      name: 'Price Decrease -5%',
      type: 'price_change',
      parameters: { priceChangePct: -5 },
      confidence: clamp(grounding.coverageScore * 0.9, 0.3, 0.92),
    })
  }

  if (lower.includes('market') || lower.includes('ad') || lower.includes('marketing')) {
    scenarios.push({
      name: 'Marketing Spend +20%',
      type: 'marketing_spend',
      parameters: { spendChangePct: 20 },
      confidence: clamp(grounding.coverageScore * 0.8, 0.3, 0.88),
    })
  }

  if (lower.includes('inventory') || grounding.inventoryRiskItems.some((item) => item.urgency === 'P1')) {
    scenarios.push({
      name: 'Reorder Risk Inventory',
      type: 'inventory_change',
      parameters: { p1CoveragePct: 100 },
      confidence: clamp(grounding.coverageScore * 0.94, 0.4, 0.96),
    })
  }

  if (lower.includes('staff') || lower.includes('headcount')) {
    scenarios.push({
      name: 'Staffing Cost +10%',
      type: 'staffing_change',
      parameters: { staffingCostPct: 10 },
      confidence: clamp(grounding.coverageScore * 0.75, 0.3, 0.85),
    })
  }

  if (lower.includes('expand') || lower.includes('branch') || lower.includes('new market')) {
    scenarios.push({
      name: 'Expansion Pilot',
      type: 'expansion',
      parameters: { revenueLiftPct: 12, expenseLiftPct: 7 },
      confidence: clamp(grounding.coverageScore * 0.7, 0.25, 0.82),
    })
  }

  if (scenarios.length === 0) {
    scenarios.push({
      name: 'Balanced Optimization',
      type: 'marketing_spend',
      parameters: { spendChangePct: 10 },
      confidence: clamp(grounding.coverageScore * 0.78, 0.3, 0.86),
    })
  }

  return scenarios.slice(0, 5)
}

async function simulateScenario(grounding: Grounding, scenario: SimulationScenario): Promise<SimulationResult> {
  const baseRevenue = Math.max(0, grounding.current.revenue)
  const baseProfit = grounding.current.profit
  const baseExpense = Math.max(0, grounding.current.expense)

  let projectedRevenue = baseRevenue
  let projectedExpense = baseExpense
  const risks: string[] = []
  const upsides: string[] = []

  switch (scenario.type) {
    case 'price_change': {
      const priceChangePct = (scenario.parameters.priceChangePct || 0) / 100
      const elasticity = grounding.tenantInfo.businessType === 'SERVICE' ? 0.6 : 1.1
      const demandChangePct = -priceChangePct * elasticity
      projectedRevenue = baseRevenue * (1 + priceChangePct) * (1 + demandChangePct)
      projectedExpense = baseExpense * (1 + demandChangePct * 0.35)
      if (priceChangePct > 0) risks.push('Volume could decline more than expected under high price sensitivity')
      if (priceChangePct < 0) risks.push('Lower unit margin may offset volume gains if conversion does not improve')
      upsides.push('Pricing adjustment can improve revenue quality and margin discipline')
      break
    }
    case 'marketing_spend': {
      const spendChangePct = (scenario.parameters.spendChangePct || 0) / 100
      const spendIncrease = baseExpense * 0.08 * spendChangePct
      const revenueLift = spendChangePct * 0.6
      projectedRevenue = baseRevenue * (1 + revenueLift)
      projectedExpense = baseExpense + spendIncrease
      risks.push('Campaign quality and targeting uncertainty can reduce realized ROI')
      upsides.push('Can accelerate customer acquisition and recapture declining demand')
      break
    }
    case 'inventory_change': {
      const p1Count = grounding.inventoryRiskItems.filter((item) => item.urgency === 'P1').length
      const stockValueAtRisk = grounding.inventoryRiskItems
        .filter((item) => item.urgency === 'P1' || item.urgency === 'P2')
        .reduce((sum, item) => sum + (item.stockValue || 0), 0)
      projectedRevenue = baseRevenue * (1 + clamp(p1Count * 0.015, 0.01, 0.09))
      projectedExpense = baseExpense + stockValueAtRisk * 0.08
      risks.push('Over-ordering can increase carrying cost if demand weakens')
      upsides.push('Reduces stockout-driven lost sales and stabilizes service levels')
      break
    }
    case 'staffing_change': {
      const staffingCostPct = (scenario.parameters.staffingCostPct || 0) / 100
      projectedRevenue = baseRevenue * (1 + staffingCostPct * 0.45)
      projectedExpense = baseExpense * (1 + staffingCostPct * 0.7)
      risks.push('Ramp-up lag can delay productivity gains')
      upsides.push('Higher execution capacity can unlock throughput and customer quality')
      break
    }
    case 'expansion': {
      const revenueLiftPct = (scenario.parameters.revenueLiftPct || 0) / 100
      const expenseLiftPct = (scenario.parameters.expenseLiftPct || 0) / 100
      projectedRevenue = baseRevenue * (1 + revenueLiftPct)
      projectedExpense = baseExpense * (1 + expenseLiftPct)
      risks.push('Expansion complexity may strain working capital and management attention')
      upsides.push('Creates long-term growth option value and market share capture potential')
      break
    }
    default:
      break
  }

  const calibration = await getCalibrationProfile(grounding.tenantId, scenario.type)
  const revenueMultiplierLow = clamp(1 + calibration.errorP10, 0.45, 1.55)
  const revenueMultiplierHigh = clamp(1 + calibration.errorP90, 0.45, 1.75)
  projectedRevenue = calibrateFromBaseline(baseRevenue, projectedRevenue, calibration.projectionMultiplier)

  const rawProjectedProfit = projectedRevenue - projectedExpense
  const projectedProfit = calibrateFromBaseline(baseProfit, rawProjectedProfit, calibration.projectionMultiplier)
  const projectedMargin = projectedRevenue > 0 ? (projectedProfit / projectedRevenue) * 100 : 0
  const projectedCashFlow = projectedProfit - baseProfit
  const invested = Math.max(1, projectedExpense - baseExpense)
  const roi = (projectedProfit - baseProfit) / invested
  const annualizedCashDelta = Math.max(1, Math.abs(projectedCashFlow) * 12)
  const paybackDays = projectedCashFlow > 0 ? round2((invested / annualizedCashDelta) * 365) : 999
  const calibratedConfidence = clamp(scenario.confidence * calibration.confidenceMultiplier, 0.2, 0.99)

  const zScore = inverseNormalQuantile(0.95)
  const revenueStdError = Math.sqrt(Math.max(0.0001, calibration.posteriorVariance)) * Math.max(1, Math.abs(projectedRevenue - baseRevenue))
  const profitStdError = Math.sqrt(Math.max(0.0001, calibration.posteriorVariance)) * Math.max(1, Math.abs(projectedProfit - baseProfit))
  const confidenceInterval = {
    revenueLow: round2(Math.max(0, projectedRevenue - zScore * revenueStdError)),
    revenueHigh: round2(projectedRevenue + zScore * revenueStdError),
    profitLow: round2(projectedProfit - zScore * profitStdError),
    profitHigh: round2(projectedProfit + zScore * profitStdError),
  }

  const profitLow = calibrateFromBaseline(baseProfit, rawProjectedProfit, revenueMultiplierLow)
  const profitHigh = calibrateFromBaseline(baseProfit, rawProjectedProfit, revenueMultiplierHigh)
  const percentile10 = round2(Math.min(profitLow, profitHigh))
  const percentile90 = round2(Math.max(profitLow, profitHigh))

  const recommendation =
    roi > 0.6 && calibratedConfidence > 0.7 ? 'strong_yes' :
    roi > 0.2 && calibratedConfidence > 0.6 ? 'yes' :
    roi > 0 ? 'caution' :
    roi > -0.2 ? 'no' : 'strong_no'

  return {
    scenario: {
      ...scenario,
      confidence: round2(calibratedConfidence),
    },
    projectedRevenue: round2(projectedRevenue),
    projectedProfit: round2(projectedProfit),
    projectedMargin: round2(projectedMargin),
    projectedCashFlow: round2(projectedCashFlow),
    roi: round2(roi),
    paybackDays,
    risks,
    upsides,
    recommendation,
    confidenceInterval,
    percentile10,
    percentile90,
    calibration: {
      sampleSize: calibration.sampleSize,
      projectionMultiplier: round2(calibration.projectionMultiplier),
      confidenceMultiplier: round2(calibration.confidenceMultiplier),
      averageSuccessScore: calibration.averageSuccessScore,
      posteriorBiasMean: calibration.posteriorBiasMean,
      posteriorVariance: calibration.posteriorVariance,
      calibrationScore: calibration.calibrationScore,
      historicalAccuracy: calibration.historicalAccuracy,
    },
  }
}

export async function generateStrategicSimulationReport(question: string, grounding: Grounding): Promise<SimulationComparison> {
  const scenarios = buildBaseScenarios(question, grounding)
  const results = await Promise.all(scenarios.map((scenario) => simulateScenario(grounding, scenario)))

  const best = results.length > 0
    ? results.reduce((left, right) => (left.projectedProfit > right.projectedProfit ? left : right))
    : null
  const worst = results.length > 0
    ? results.reduce((left, right) => (left.projectedProfit < right.projectedProfit ? left : right))
    : null

  const sensitivity: Record<string, number> = {
    revenueSpread: round2((best?.projectedRevenue || 0) - (worst?.projectedRevenue || 0)),
    profitSpread: round2((best?.projectedProfit || 0) - (worst?.projectedProfit || 0)),
    roiSpread: round2((best?.roi || 0) - (worst?.roi || 0)),
  }

  const calibrationResults = results
    .map((result) => result.calibration)
    .filter((calibration): calibration is NonNullable<SimulationResult['calibration']> => !!calibration)

  const calibrationSummary = calibrationResults.length > 0
    ? {
        sampleSize: Math.max(...calibrationResults.map((calibration) => calibration.sampleSize), 0),
        averageSuccessScore: round2(average(calibrationResults.map((calibration) => calibration.averageSuccessScore))),
        calibrationScore: round2(average(calibrationResults.map((calibration) => calibration.calibrationScore))),
        historicalAccuracy: round2(average(calibrationResults.map((calibration) => calibration.historicalAccuracy))),
      }
    : undefined

  return { results, best, worst, sensitivity, calibrationSummary }
}

export async function previewSimulationScenario(args: {
  grounding: Grounding
  scenarioType: SimulationType
  parameters?: Record<string, number>
  confidence?: number
  name?: string
}): Promise<SimulationResult> {
  const scenario: SimulationScenario = {
    name: args.name || args.scenarioType.replace(/_/g, ' '),
    type: args.scenarioType,
    parameters: args.parameters || {},
    confidence: clamp(args.confidence ?? args.grounding.coverageScore, 0.2, 0.99),
  }

  return simulateScenario(args.grounding, scenario)
}