import { prisma } from '@/lib/prisma'
import {
  average,
  clamp,
  fDistributionSurvival,
  ordinaryLeastSquares,
  pearsonCorrelation,
  quantile,
  round2,
  standardDeviation,
} from './enterprise-ai-statistics'

type Grounding = {
  tenantId: string
  salesInsights: { salesTrend: 'increasing' | 'stable' | 'decreasing'; transactionCount: number }
  profitability: { netMarginPct: number; lossMakingProductCount: number }
  expenseInsights: { expenseGrowthRate: number; costToRevenueRatio: number }
  inventoryRiskItems: Array<{ urgency: 'P1' | 'P2' | 'P3'; daysToStockout: number | null }>
  deltas: { revenuePct: number; marginPct: number }
  dataQuality: { recency: string }
  coverageScore: number
}

export type CausalMetric = 'revenue_decline' | 'margin_erosion' | 'inventory_spike' | 'expense_growth'

export type CausalMethod = {
  method: 'granger' | 'difference_in_differences' | 'synthetic_control'
  title: string
  signal: string
  confidence: number
  pValue?: number
  lagDays?: number
  effectSize?: number
  treatedUnit?: string
  controlUnits?: string[]
}

export type RootCauseAnalysis = {
  problem: CausalMetric
  rootCauses: Array<{ cause: string; contribution: number; evidence: string[] }>
  contributingFactors: string[]
  recommendedInterventions: Array<{ action: string; expectedImpact: number; confidence: number }>
  methods: CausalMethod[]
  confidenceScore: number
}

type TimeSeriesBundle = {
  days: number
  since: Date
  revenueSeries: number[]
  expenseSeries: number[]
  transactionSeries: number[]
  marginSeries: number[]
  revenueByUnit: Map<string, number[]>
  expenseByUnit: Map<string, number[]>
  branchNames: Map<string, string>
}

type GrangerSignal = {
  cause: string
  contribution: number
  evidence: string[]
  method: CausalMethod
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildSeries(args: {
  since: Date
  days: number
  rows: Array<{ date: Date; value: number }>
}): number[] {
  const bucket = new Map<string, number>()
  for (const row of args.rows) {
    const key = dayKey(row.date)
    bucket.set(key, (bucket.get(key) || 0) + row.value)
  }

  const series: number[] = []
  for (let index = 0; index < args.days; index += 1) {
    const date = new Date(args.since.getTime() + index * 24 * 60 * 60 * 1000)
    series.push(bucket.get(dayKey(date)) || 0)
  }
  return series
}

function buildUnitSeries(args: {
  since: Date
  days: number
  rows: Array<{ unitId: string | null; date: Date; value: number }>
}): Map<string, number[]> {
  const bucket = new Map<string, Map<string, number>>()

  for (const row of args.rows) {
    if (!row.unitId) continue
    const unitBucket = bucket.get(row.unitId) || new Map<string, number>()
    const key = dayKey(row.date)
    unitBucket.set(key, (unitBucket.get(key) || 0) + row.value)
    bucket.set(row.unitId, unitBucket)
  }

  return new Map(
    [...bucket.entries()].map(([unitId, values]) => {
      const series: number[] = []
      for (let index = 0; index < args.days; index += 1) {
        const date = new Date(args.since.getTime() + index * 24 * 60 * 60 * 1000)
        series.push(values.get(dayKey(date)) || 0)
      }
      return [unitId, series]
    }),
  )
}

function detectMetricFromPrompt(prompt: string): CausalMetric {
  const lower = prompt.toLowerCase()
  if (lower.includes('margin')) return 'margin_erosion'
  if (lower.includes('inventory') || lower.includes('stock')) return 'inventory_spike'
  if (lower.includes('expense') || lower.includes('cost')) return 'expense_growth'
  return 'revenue_decline'
}

function identifyHeuristicRootCauses(metric: CausalMetric, grounding: Grounding): Omit<RootCauseAnalysis, 'methods' | 'confidenceScore'> {
  const rootCauses: RootCauseAnalysis['rootCauses'] = []
  const interventions: RootCauseAnalysis['recommendedInterventions'] = []
  const contributingFactors: string[] = []

  if (metric === 'revenue_decline') {
    if (grounding.salesInsights.salesTrend === 'decreasing') {
      rootCauses.push({
        cause: 'Demand softening and conversion pressure',
        contribution: 0.42,
        evidence: [`Revenue delta ${round2(grounding.deltas.revenuePct)}%`, 'Sales trend flagged as decreasing'],
      })
      interventions.push({ action: 'Run targeted recovery campaign on top categories', expectedImpact: 8, confidence: 0.68 })
    }
    if (grounding.salesInsights.transactionCount < 20) {
      rootCauses.push({
        cause: 'Low transaction velocity',
        contribution: 0.28,
        evidence: [`Only ${grounding.salesInsights.transactionCount} transactions in analysis window`],
      })
      interventions.push({ action: 'Increase acquisition and repeat-order nudges', expectedImpact: 5, confidence: 0.63 })
    }
  }

  if (metric === 'margin_erosion') {
    if (grounding.profitability.netMarginPct < 10) {
      rootCauses.push({
        cause: 'Thin operating margin',
        contribution: 0.38,
        evidence: [`Net margin at ${round2(grounding.profitability.netMarginPct)}%`],
      })
    }
    if (grounding.expenseInsights.expenseGrowthRate > 12) {
      rootCauses.push({
        cause: 'Expense growth outpacing revenue quality',
        contribution: 0.34,
        evidence: [`Expense growth ${round2(grounding.expenseInsights.expenseGrowthRate)}%`],
      })
      interventions.push({ action: 'Apply spend guardrails on top expense categories', expectedImpact: 6, confidence: 0.71 })
    }
    if (grounding.profitability.lossMakingProductCount > 0) {
      contributingFactors.push('Loss-making SKUs are diluting blended margin')
      interventions.push({ action: 'Re-price or phase out bottom-margin products', expectedImpact: 4, confidence: 0.66 })
    }
  }

  if (metric === 'inventory_spike') {
    const p1Count = grounding.inventoryRiskItems.filter((item) => item.urgency === 'P1').length
    const longAging = grounding.inventoryRiskItems.filter((item) => (item.daysToStockout || 0) > 60).length
    rootCauses.push({
      cause: 'Imbalance between reorder cadence and actual demand',
      contribution: 0.36,
      evidence: [`P1 risk count ${p1Count}`, `${longAging} items show long cover days`],
    })
    interventions.push({ action: 'Re-tune reorder points and lot sizes by SKU velocity', expectedImpact: 7, confidence: 0.7 })
  }

  if (metric === 'expense_growth') {
    rootCauses.push({
      cause: 'Operating cost inflation without matching efficiency gains',
      contribution: 0.4,
      evidence: [`Cost-to-revenue ratio ${round2(grounding.expenseInsights.costToRevenueRatio)}%`],
    })
    interventions.push({ action: 'Set weekly variance checks and contract renegotiation targets', expectedImpact: 5, confidence: 0.69 })
  }

  if (grounding.dataQuality.recency !== 'fresh' || grounding.coverageScore < 0.5) {
    contributingFactors.push('Data freshness/coverage may reduce causal confidence')
  }

  if (rootCauses.length === 0) {
    rootCauses.push({
      cause: 'Mixed multi-factor pressure across demand, costs, and execution',
      contribution: 0.3,
      evidence: ['No single dominant signal exceeded threshold'],
    })
  }

  const normalized = rootCauses.reduce((sum, item) => sum + item.contribution, 0)
  return {
    problem: metric,
    rootCauses: normalized > 0
      ? rootCauses.map((item) => ({ ...item, contribution: round2(item.contribution / normalized) }))
      : rootCauses,
    contributingFactors,
    recommendedInterventions: interventions.slice(0, 3),
  }
}

async function fetchTimeSeriesBundle(tenantId: string, days: number): Promise<TimeSeriesBundle> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [sales, expenses, subsidiaries] = await Promise.all([
    prisma.sale.findMany({
      where: {
        tenantId,
        archived: false,
        createdAt: { gte: since },
      },
      select: {
        subsidiaryId: true,
        createdAt: true,
        totalAmount: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        tenantId,
        archived: false,
        date: { gte: since },
      },
      select: {
        subsidiaryId: true,
        date: true,
        amount: true,
      },
    }),
    prisma.subsidiary.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
  ])

  const revenueSeries = buildSeries({
    since,
    days,
    rows: sales.map((row) => ({ date: row.createdAt, value: Number(row.totalAmount || 0) })),
  })
  const transactionSeries = buildSeries({
    since,
    days,
    rows: sales.map((row) => ({ date: row.createdAt, value: 1 })),
  })
  const expenseSeries = buildSeries({
    since,
    days,
    rows: expenses.map((row) => ({ date: row.date, value: Number(row.amount || 0) })),
  })
  const marginSeries = revenueSeries.map((revenue, index) => {
    if (revenue <= 0) return 0
    return ((revenue - expenseSeries[index]) / revenue) * 100
  })

  const revenueByUnit = buildUnitSeries({
    since,
    days,
    rows: sales.map((row) => ({ unitId: row.subsidiaryId, date: row.createdAt, value: Number(row.totalAmount || 0) })),
  })
  const expenseByUnit = buildUnitSeries({
    since,
    days,
    rows: expenses.map((row) => ({ unitId: row.subsidiaryId, date: row.date, value: Number(row.amount || 0) })),
  })

  return {
    days,
    since,
    revenueSeries,
    expenseSeries,
    transactionSeries,
    marginSeries,
    revenueByUnit,
    expenseByUnit,
    branchNames: new Map(subsidiaries.map((row) => [row.id, row.name])),
  }
}

function buildLaggedRegression(target: number[], predictors: number[][], lagDays: number) {
  const design: number[][] = []
  const outcome: number[] = []

  for (let index = lagDays; index < target.length; index += 1) {
    const row = [1]

    for (const predictor of predictors) {
      for (let lag = 1; lag <= lagDays; lag += 1) {
        row.push(predictor[index - lag])
      }
    }

    if (row.every((value) => Number.isFinite(value)) && Number.isFinite(target[index])) {
      design.push(row)
      outcome.push(target[index])
    }
  }

  return { design, outcome }
}

function runGrangerTests(metric: CausalMetric, bundle: TimeSeriesBundle): GrangerSignal[] {
  const targetSeries = metric === 'revenue_decline'
    ? bundle.revenueSeries
    : metric === 'margin_erosion'
      ? bundle.marginSeries
      : metric === 'expense_growth'
        ? bundle.expenseSeries
        : bundle.transactionSeries.map((value) => value * -1)

  const candidates = [
    { key: 'expense_pressure', label: 'Expense pressure', series: bundle.expenseSeries },
    { key: 'transaction_velocity', label: 'Transaction velocity', series: bundle.transactionSeries },
    { key: 'revenue_momentum', label: 'Revenue momentum', series: bundle.revenueSeries },
  ]

  const signals = candidates
    .map((candidate): GrangerSignal | null => {
      let best: {
        lagDays: number
        pValue: number
        fStatistic: number
        improvement: number
        coefficientSignal: number
      } | null = null

      for (let lagDays = 1; lagDays <= Math.min(14, Math.floor(targetSeries.length / 4)); lagDays += 1) {
        const restrictedData = buildLaggedRegression(targetSeries, [targetSeries], lagDays)
        const unrestrictedData = buildLaggedRegression(targetSeries, [targetSeries, candidate.series], lagDays)
        if (restrictedData.design.length < 20 || unrestrictedData.design.length < 20) continue

        const restricted = ordinaryLeastSquares(restrictedData.design, restrictedData.outcome)
        const unrestricted = ordinaryLeastSquares(unrestrictedData.design, unrestrictedData.outcome)
        if (!restricted || !unrestricted) continue

        const n = unrestrictedData.outcome.length
        const df1 = lagDays
        const unrestrictedParameterCount = unrestricted.coefficients.length
        const df2 = n - unrestrictedParameterCount
        if (df2 <= 2) continue

        const rssImprovement = Math.max(0, restricted.rss - unrestricted.rss)
        const fStatistic = (rssImprovement / df1) / Math.max(unrestricted.rss / df2, 1e-9)
        const pValue = fDistributionSurvival(fStatistic, df1, df2)
        const improvement = restricted.rss > 0 ? rssImprovement / restricted.rss : 0
        const coefficientSignal = unrestricted.coefficients
          .slice(1 + lagDays)
          .reduce((sum, value) => sum + value, 0)

        if (!best || pValue < best.pValue) {
          best = { lagDays, pValue, fStatistic, improvement, coefficientSignal }
        }
      }

      if (!best) return null
      const contribution = clamp(best.improvement * 2.2 + (1 - best.pValue) * 0.25, 0, 0.9)
      const direction = best.coefficientSignal >= 0 ? 'positive' : 'negative'

      return {
        cause: `${candidate.label}${best.lagDays > 0 ? ` (Granger lag ${best.lagDays}d)` : ''}`,
        contribution: round2(contribution),
        evidence: [
          `Granger F-stat ${round2(best.fStatistic)}`,
          `p-value ${round2(best.pValue)}`,
          `Explains ${round2(best.improvement * 100)}% incremental variance with ${direction} direction`,
        ],
        method: {
          method: 'granger',
          title: `Granger causality: ${candidate.label}`,
          signal: `${candidate.label} leads ${metric.replace(/_/g, ' ')}`,
          confidence: round2(clamp((1 - best.pValue) * (0.55 + best.improvement), 0, 1)),
          pValue: round2(best.pValue),
          lagDays: best.lagDays,
          effectSize: round2(best.improvement),
        },
      } satisfies GrangerSignal
    })
    .filter((signal): signal is GrangerSignal => signal !== null)

  return signals
    .filter((signal) => signal.method.pValue !== undefined && signal.method.pValue <= 0.2)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 3)
}

function bootstrapDifferenceInDifferences(args: {
  treatedPre: number[]
  treatedPost: number[]
  controlPre: number[]
  controlPost: number[]
  iterations: number
}): { pValue: number; ciLow: number; ciHigh: number; stdDev: number } {
  const sample = (values: number[]) => values.map(() => values[Math.floor(Math.random() * values.length)] || 0)
  const effects: number[] = []

  for (let index = 0; index < args.iterations; index += 1) {
    const treatedPre = sample(args.treatedPre)
    const treatedPost = sample(args.treatedPost)
    const controlPre = sample(args.controlPre)
    const controlPost = sample(args.controlPost)
    const effect = (average(treatedPost) - average(treatedPre)) - (average(controlPost) - average(controlPre))
    effects.push(effect)
  }

  const positiveShare = effects.filter((value) => value >= 0).length / Math.max(1, effects.length)
  const pValue = round2(Math.min(1, 2 * Math.min(positiveShare, 1 - positiveShare)))
  return {
    pValue,
    ciLow: round2(quantile(effects, 0.025)),
    ciHigh: round2(quantile(effects, 0.975)),
    stdDev: round2(standardDeviation(effects, true)),
  }
}

function selectTargetSeries(metric: CausalMetric, revenueSeries: number[], expenseSeries: number[]): number[] {
  if (metric === 'expense_growth') return expenseSeries
  if (metric === 'margin_erosion') {
    return revenueSeries.map((revenue, index) => {
      if (revenue <= 0) return 0
      return ((revenue - expenseSeries[index]) / revenue) * 100
    })
  }
  if (metric === 'inventory_spike') return revenueSeries.map((value) => value * -1)
  return revenueSeries
}

function findTreatedAndControl(metric: CausalMetric, bundle: TimeSeriesBundle): null | {
  treatedUnit: string
  controlUnit: string
  treatedSeries: number[]
  controlSeries: number[]
} {
  const unitEntries = [...bundle.revenueByUnit.entries()]
    .map(([unitId, revenueSeries]) => {
      const expenseSeries = bundle.expenseByUnit.get(unitId) || Array(bundle.days).fill(0)
      return {
        unitId,
        series: selectTargetSeries(metric, revenueSeries, expenseSeries),
      }
    })
    .filter((entry) => entry.series.some((value) => value !== 0))

  if (unitEntries.length < 2) return null

  const splitIndex = Math.floor(bundle.days / 2)
  const scored = unitEntries.map((entry) => {
    const pre = entry.series.slice(0, splitIndex)
    const post = entry.series.slice(splitIndex)
    const change = average(post) - average(pre)
    return { ...entry, preMean: average(pre), change }
  })

  const treated = [...scored].sort((left, right) => Math.abs(right.change) - Math.abs(left.change))[0]
  const controls = scored.filter((entry) => entry.unitId !== treated.unitId)
  const control = controls.sort((left, right) => {
    const leftDistance = Math.abs(left.preMean - treated.preMean) + Math.abs(left.change)
    const rightDistance = Math.abs(right.preMean - treated.preMean) + Math.abs(right.change)
    return leftDistance - rightDistance
  })[0]

  if (!treated || !control) return null
  return {
    treatedUnit: treated.unitId,
    controlUnit: control.unitId,
    treatedSeries: treated.series,
    controlSeries: control.series,
  }
}

function runDifferenceInDifferences(metric: CausalMetric, bundle: TimeSeriesBundle): CausalMethod | null {
  const selected = findTreatedAndControl(metric, bundle)
  if (!selected) return null

  const splitIndex = Math.floor(bundle.days / 2)
  const treatedPre = selected.treatedSeries.slice(0, splitIndex)
  const treatedPost = selected.treatedSeries.slice(splitIndex)
  const controlPre = selected.controlSeries.slice(0, splitIndex)
  const controlPost = selected.controlSeries.slice(splitIndex)
  if (treatedPre.length < 14 || treatedPost.length < 14 || controlPre.length < 14 || controlPost.length < 14) return null

  const effect = (average(treatedPost) - average(treatedPre)) - (average(controlPost) - average(controlPre))
  const bootstrap = bootstrapDifferenceInDifferences({ treatedPre, treatedPost, controlPre, controlPost, iterations: 250 })
  const significant = bootstrap.ciLow > 0 || bootstrap.ciHigh < 0
  if (!significant) return null

  const treatedName = bundle.branchNames.get(selected.treatedUnit) || selected.treatedUnit
  const controlName = bundle.branchNames.get(selected.controlUnit) || selected.controlUnit
  return {
    method: 'difference_in_differences',
    title: `Difference-in-differences: ${treatedName} vs ${controlName}`,
    signal: `${treatedName} shows a structural post-period shift against ${controlName}`,
    confidence: round2(clamp((1 - bootstrap.pValue) * 0.75 + Math.min(0.25, Math.abs(effect) / (Math.abs(average(treatedPre)) + 1)), 0, 1)),
    pValue: bootstrap.pValue,
    effectSize: round2(effect),
    treatedUnit: treatedName,
    controlUnits: [controlName],
  }
}

function buildSyntheticWeights(treatedPre: number[], controls: Array<{ unitId: string; series: number[] }>): Record<string, number> {
  const scored = controls.map((control) => {
    const rmse = Math.sqrt(average(treatedPre.map((value, index) => (value - (control.series[index] || 0)) ** 2)))
    const correlation = pearsonCorrelation(treatedPre, control.series)
    const score = 1 / Math.max(0.01, rmse) * clamp((correlation + 1) / 2, 0.1, 1)
    return { unitId: control.unitId, score }
  })

  const totalScore = scored.reduce((sum, item) => sum + item.score, 0)
  if (totalScore <= 0) {
    return Object.fromEntries(scored.map((item) => [item.unitId, round2(1 / Math.max(1, scored.length))]))
  }

  return Object.fromEntries(scored.map((item) => [item.unitId, item.score / totalScore]))
}

function syntheticSeries(controls: Array<{ unitId: string; series: number[] }>, weights: Record<string, number>): number[] {
  if (!controls.length) return []
  return controls[0].series.map((_, index) => controls.reduce((sum, control) => sum + (control.series[index] || 0) * (weights[control.unitId] || 0), 0))
}

function runSyntheticControl(metric: CausalMetric, bundle: TimeSeriesBundle): CausalMethod | null {
  const unitEntries = [...bundle.revenueByUnit.entries()]
    .map(([unitId, revenueSeries]) => {
      const expenseSeries = bundle.expenseByUnit.get(unitId) || Array(bundle.days).fill(0)
      return {
        unitId,
        series: selectTargetSeries(metric, revenueSeries, expenseSeries),
      }
    })
    .filter((entry) => entry.series.some((value) => value !== 0))

  if (unitEntries.length < 3) return null
  const splitIndex = Math.floor(bundle.days * 0.7)
  const scored = unitEntries.map((entry) => ({
    ...entry,
    shock: Math.abs(average(entry.series.slice(splitIndex)) - average(entry.series.slice(0, splitIndex))),
  }))
  const treated = [...scored].sort((left, right) => right.shock - left.shock)[0]
  const controls = scored.filter((entry) => entry.unitId !== treated.unitId)
  if (!treated || controls.length < 2) return null

  const weights = buildSyntheticWeights(treated.series.slice(0, splitIndex), controls.map((entry) => ({ unitId: entry.unitId, series: entry.series.slice(0, splitIndex) })))
  const synthetic = syntheticSeries(controls, weights)
  const treatedPost = average(treated.series.slice(splitIndex))
  const syntheticPost = average(synthetic.slice(splitIndex))
  const effect = treatedPost - syntheticPost

  const placeboEffects = controls.map((placebo) => {
    const placeboControls = scored.filter((entry) => entry.unitId !== placebo.unitId)
    const placeboWeights = buildSyntheticWeights(placebo.series.slice(0, splitIndex), placeboControls.map((entry) => ({ unitId: entry.unitId, series: entry.series.slice(0, splitIndex) })))
    const placeboSynthetic = syntheticSeries(placeboControls, placeboWeights)
    return average(placebo.series.slice(splitIndex)) - average(placeboSynthetic.slice(splitIndex))
  })
  const pValue = placeboEffects.length > 0
    ? round2(placeboEffects.filter((value) => Math.abs(value) >= Math.abs(effect)).length / placeboEffects.length)
    : 1
  if (pValue > 0.2) return null

  const treatedName = bundle.branchNames.get(treated.unitId) || treated.unitId
  const topControls = Object.entries(weights)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([unitId]) => bundle.branchNames.get(unitId) || unitId)

  return {
    method: 'synthetic_control',
    title: `Synthetic control gap: ${treatedName}`,
    signal: `${treatedName} deviates from its synthetic branch baseline`,
    confidence: round2(clamp((1 - pValue) * 0.8 + Math.min(0.2, Math.abs(effect) / (Math.abs(syntheticPost) + 1)), 0, 1)),
    pValue,
    effectSize: round2(effect),
    treatedUnit: treatedName,
    controlUnits: topControls,
  }
}

function rootCauseFromMethod(metric: CausalMetric, method: CausalMethod): RootCauseAnalysis['rootCauses'][number] | null {
  if (method.method === 'granger') {
    return {
      cause: method.signal,
      contribution: round2(clamp(method.confidence, 0.18, 0.8)),
      evidence: [method.title, `p-value ${round2(method.pValue || 1)}`, `Effect size ${round2(method.effectSize || 0)}`],
    }
  }

  if (method.method === 'difference_in_differences') {
    return {
      cause: `${method.treatedUnit} shows a structural ${metric.replace(/_/g, ' ')} shift relative to ${method.controlUnits?.[0] || 'control branches'}`,
      contribution: round2(clamp(method.confidence, 0.2, 0.75)),
      evidence: [method.title, `Estimated treatment effect ${round2(method.effectSize || 0)}`, `p-value ${round2(method.pValue || 1)}`],
    }
  }

  if (method.method === 'synthetic_control') {
    return {
      cause: `${method.treatedUnit} diverged materially from its synthetic-control baseline`,
      contribution: round2(clamp(method.confidence, 0.2, 0.72)),
      evidence: [method.title, `Synthetic gap ${round2(method.effectSize || 0)}`, `Placebo p-value ${round2(method.pValue || 1)}`],
    }
  }

  return null
}

async function identifyEconometricSignals(metric: CausalMetric, grounding: Grounding): Promise<{
  rootCauses: RootCauseAnalysis['rootCauses']
  methods: CausalMethod[]
}> {
  const bundle = await fetchTimeSeriesBundle(grounding.tenantId, 120)
  if (bundle.revenueSeries.filter((value) => value > 0).length < 20 && bundle.expenseSeries.filter((value) => value > 0).length < 20) {
    return { rootCauses: [], methods: [] }
  }

  const grangerSignals = runGrangerTests(metric, bundle)
  const methods: CausalMethod[] = grangerSignals.map((signal) => signal.method)
  const rootCauses: RootCauseAnalysis['rootCauses'] = grangerSignals.map((signal) => ({
    cause: signal.cause,
    contribution: signal.contribution,
    evidence: signal.evidence,
  }))

  const did = runDifferenceInDifferences(metric, bundle)
  if (did) {
    methods.push(did)
    const rootCause = rootCauseFromMethod(metric, did)
    if (rootCause) rootCauses.push(rootCause)
  }

  const synthetic = runSyntheticControl(metric, bundle)
  if (synthetic) {
    methods.push(synthetic)
    const rootCause = rootCauseFromMethod(metric, synthetic)
    if (rootCause) rootCauses.push(rootCause)
  }

  return {
    rootCauses: rootCauses
      .sort((left, right) => right.contribution - left.contribution)
      .slice(0, 5),
    methods: methods
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5),
  }
}

export async function identifyLikelyRootCausesFromPrompt(prompt: string, grounding: Grounding): Promise<RootCauseAnalysis> {
  const metric = detectMetricFromPrompt(prompt)
  const heuristic = identifyHeuristicRootCauses(metric, grounding)
  const econometric = await identifyEconometricSignals(metric, grounding)

  const mergedRootCauses = [...econometric.rootCauses, ...heuristic.rootCauses].slice(0, 5)
  const totalContribution = mergedRootCauses.reduce((sum, item) => sum + item.contribution, 0)
  const methods = econometric.methods
  const confidenceScore = round2(clamp(
    methods.length > 0
      ? average(methods.map((method) => method.confidence)) * 0.7 + grounding.coverageScore * 0.3
      : grounding.coverageScore * 0.6,
    0,
    1,
  ))

  return {
    problem: heuristic.problem,
    rootCauses: totalContribution > 0
      ? mergedRootCauses.map((item) => ({
          ...item,
          contribution: round2(item.contribution / totalContribution),
        }))
      : mergedRootCauses,
    contributingFactors: [
      ...(methods.length > 0
        ? [`Econometric diagnostics executed: ${methods.map((method) => method.method).join(', ')}`]
        : []),
      ...heuristic.contributingFactors,
    ].slice(0, 5),
    recommendedInterventions: heuristic.recommendedInterventions,
    methods,
    confidenceScore,
  }
}