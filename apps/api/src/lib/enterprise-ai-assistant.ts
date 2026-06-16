import { prisma } from '@/lib/prisma'
import { cognitiveEngine, detectAndStoreBusinessType } from './enterprise-ai-cognitive'
import { generateAutonomousReport as generateAutonomousReportModule } from './enterprise-ai-autonomous'
import { generateHybridResponse } from './enterprise-ai-hybrid'
import { generateStrategicSimulationReport } from './enterprise-ai-simulator'
import { identifyLikelyRootCausesFromPrompt } from './enterprise-ai-causal'
import { buildRecommendationExplanation } from './enterprise-ai-explainability'
import { generateStrategicInsights } from './enterprise-ai-strategic-advisor'
import { getMarketIntelligence } from './enterprise-ai-market-intel'
import { buildExecutionPlan, deriveExecutableActionsFromBrief } from './enterprise-ai-autonomous-executor'
import { loadExternalGroundingSnapshot, type ExternalGroundingSnapshot } from './enterprise-ai-external-data'
import { logAudit } from '@/lib/audit'
import { AsyncLocalStorage } from 'node:async_hooks'

// ============================================================
// GLOBAL STATE & CIRCUIT BREAKER
// ============================================================

let llmConsecutiveFailures = 0
let llmCooldownUntil = 0

// ============================================================
// ADVANCED TYPES
// ============================================================

type AssistantTurn = {
  prompt: string
  response: string
  createdAt: string
}

type TenantInfo = {
  id: string
  name: string
  baseCurrency: string
  businessType: 'RETAIL' | 'WHOLESALE' | 'MANUFACTURING' | 'DISTRIBUTION' | 'SERVICE' | 'HOSPITALITY' | 'UNKNOWN'
  country: string | null
  state: string | null
  hasMultipleBranches: boolean
  activeBranchCount: number
  lifecycleStage: 'startup' | 'growth' | 'mature' | 'declining'
  estimatedMonthlyRunway: number | null
}

type BranchComparison = {
  subsidiaryId: string
  branchName: string
  currentRevenue: number
  priorRevenue: number
  revenueDeltaPct: number
  currentExpense: number
  priorExpense: number
  expenseDeltaPct: number
  currentMargin: number
  priorMargin: number
  marginDeltaPct: number
  grossMarginPct: number
  contributionMargin: number
  efficiencyScore: number
  rank: number
}

type ProductComparison = {
  productId: string
  productName: string
  category: string | null
  currentRevenue: number
  priorRevenue: number
  revenueDeltaPct: number
  currentUnits: number
  priorUnits: number
  unitsDeltaPct: number
  currentProfit: number
  priorProfit: number
  profitDeltaPct: number
  marginPct: number
  isProfitable: boolean
  profitRank: number
  inventoryTurnover: number
  daysOfInventory: number
  velocityScore: number
  lifecycleStage: 'introduction' | 'growth' | 'maturity' | 'decline'
  priceElasticity: number | null
}

type InventoryRiskItem = {
  productId: string
  productName: string
  category: string | null
  subsidiaryId: string | null
  currentStock: number
  lowStockThreshold: number
  soldUnits30: number
  avgDailyDemand: number
  daysToStockout: number | null
  suggestedReorderQty: number
  urgency: 'P1' | 'P2' | 'P3'
  riskScore: number
  stockValue: number
  turnoverRate: number
  costPrice?: number
  originalUnitCost?: number | null
  originalPurchaseDate?: string | null
  provenanceEstimated?: boolean
  daysOfInventory: number
  reorderPoint: number
  economicOrderQty: number
  stockoutProbability: number
  recommendedAction: 'order_immediately' | 'order_soon' | 'monitor' | 'reduce_stock'
}

type ProfitabilityAnalysis = {
  totalRevenue: number
  totalCost: number
  grossProfit: number
  grossMarginPct: number
  netProfit: number
  netMarginPct: number
  topProfitableProducts: Array<{ name: string; category: string | null; profit: number; margin: number; contributionPct: number }>
  topLossMakingProducts: Array<{ name: string; category: string | null; loss: number; margin: number }>
  profitableProductCount: number
  lossMakingProductCount: number
  breakEvenProducts: number
  avgMarginByCategory: Record<string, number>
  topCategoriesByProfit: Array<{ category: string; profit: number; margin: number; revenue: number }>
  topCategoriesByLoss: Array<{ category: string; loss: number; margin: number }>
  profitDrivers: string[]
  profitRisks: string[]
  breakEvenRevenue: number
  profitMarginForecast: {
    next30Days: number
    next90Days: number
    confidence: number
  }
}

type SalesInsight = {
  totalSales: number
  transactionCount: number
  avgOrderValue: number
  topSellingProducts: Array<{ name: string; category: string | null; revenue: number; units: number; contributionPct: number }>
  topSellingCategories: Array<{ category: string; revenue: number; percentage: number }>
  slowMovingProducts: Array<{
    name: string
    category: string | null
    unitsSold: number
    daysOnShelf: number
    stockValue: number
    originalUnitCost?: number | null
    originalPurchaseDate?: string | null
    provenanceEstimated?: boolean
  }>
  salesTrend: 'increasing' | 'stable' | 'decreasing'
  trendStrength: number
  peakHours: string[]
  bestSellingDay: string
  salesForecast: {
    next7Days: number
    next30Days: number
    next90Days: number
    confidence: number
    upperBound: number
    lowerBound: number
  }
  anomalies: Array<{
    date: string
    expectedRevenue: number
    actualRevenue: number
    deviation: number
    severity: 'low' | 'medium' | 'high'
  }>
}

type ExpenseInsight = {
  totalExpenses: number
  topExpenseCategories: Array<{ category: string; amount: number; pctOfTotal: number; trend: 'rising' | 'stable' | 'falling' }>
  expenseGrowthRate: number
  unusualExpenses: Array<{ title: string; amount: number; date: string; category: string; isAnomaly: boolean }>
  costToRevenueRatio: number
  recommendedSavings: Array<{ category: string; potentialSavings: number; action: string; priority: 'P1' | 'P2' | 'P3' }>
  expenseEfficiencyScore: number
  expenseForecast: {
    next30Days: number
    next90Days: number
    confidence: number
  }
}

type IncomeBreakdown = {
  totalIncome: number
  salesIncome: number
  subscriptionIncome: number
  hasSubscriptionIncomeSource: boolean
  streamMix: {
    salesPct: number
    subscriptionPct: number
  }
}

type BusinessIntelligence = {
  profitability: ProfitabilityAnalysis
  sales: SalesInsight
  expenses: ExpenseInsight
  inventoryHealth: {
    totalStockValue: number
    slowMovingStockValue: number
    overstockValue: number
    stockoutRiskCount: number
    inventoryTurnover: number
    daysOfInventory: number
    recommendedActions: string[]
    healthScore: number
    cashTiedInInventory: number
    optimalInventoryLevel: number
  }
  recommendations: Array<{
    priority: 'P1' | 'P2' | 'P3'
    category: 'pricing' | 'inventory' | 'expense' | 'sales' | 'operations' | 'cashflow'
    title: string
    description: string
    expectedImpact: string
    effort: 'low' | 'medium' | 'high'
    roi: string
    actionItems: string[]
    timeframe: 'immediate' | 'this_week' | 'this_month'
    successMetric: string
  }>
  executiveSummary: string
  topOpportunity: string
  biggestRisk: string
  cashFlowInsight: {
    currentRunway: number | null
    burnRate: number
    recommendedAction: string
  }
  competitivePosition: {
    pricePositioning: 'premium' | 'mid' | 'budget'
    marketShareEstimate: number | null
    keyAdvantages: string[]
  }
  industryBenchmarks?: {
    grossMarginPct: number
    costToRevenueRatio: number
    inventoryTurnover: number
    profitabilityIndex: number
  }
}

type AssistantGrounding = {
  tenantId: string
  groundingSource: 'internal' | 'external'
  tenantInfo: TenantInfo
  incomeBreakdown: IncomeBreakdown
  periodLabel: string
  current: {
    revenue: number
    expense: number
    net: number
    profit: number
    margin: number
  }
  prior: {
    revenue: number
    expense: number
    net: number
    profit: number
    margin: number
  }
  deltas: {
    revenuePct: number
    expensePct: number
    netPct: number
    profitPct: number
    marginPct: number
  }
  shortHorizonDeltas: {
    revenuePct: number
    expensePct: number
    netPct: number
  }
  inventoryRiskItems: InventoryRiskItem[]
  branchComparisons: BranchComparison[]
  productComparisons: ProductComparison[]
  profitability: ProfitabilityAnalysis
  salesInsights: SalesInsight
  expenseInsights: ExpenseInsight
  businessIntelligence: BusinessIntelligence
  history: AssistantTurn[]
  coverageScore: number
  freshnessHours: number | null
  confidenceThresholds: {
    minTransactions: number
    minCoverageScore: number
    minCompleteness: number
    maxFreshnessHours: number
    autoApproveConfidence: number
  }
  dataQuality: {
    completeness: number
    recency: string
    hasEnoughData: boolean
    reliabilityScore: number
  }
  anomalies: Array<{
    type: 'sales_spike' | 'sales_drop' | 'expense_spike' | 'inventory_anomaly'
    severity: 'low' | 'medium' | 'high'
    description: string
    recommendedAction: string
  }>
}

type AssistantReliability = {
  groundingQualityScore: number
  coverageScore: number
  dataFreshnessHours: number | null
  usedFallback: boolean
  fallbackReason: 'NO_EXTERNAL_RESPONSE' | 'INVALID_EXTERNAL_OUTPUT' | 'INVALID_SCHEMA' | null
  llmAttempts: number
  confidenceLevel: 'high' | 'medium' | 'low'
  recommendationConfidence: Record<string, number>
}

type PromptIntent = 'RESTOCK' | 'PROFITABILITY' | 'SALES' | 'EXPENSES' | 'BRANCH' | 'CASHFLOW' | 'FORECAST' | 'GENERAL'

type AssistantTaskType = 'status' | 'diagnosis' | 'prioritize' | 'decision' | 'forecast' | 'follow_up'

type ResponseDetailLevel = 'brief' | 'deep'

type AssistantResponsePolicy = {
  responseMode: 'clarify' | 'brief' | 'deep'
  taskType: AssistantTaskType
  detailLevel: ResponseDetailLevel
  allowScenario: boolean
  allowCausal: boolean
  allowStrategic: boolean
  allowExecution: boolean
  lowSignal: boolean
  singleBranchComparisonsNotMeaningful: boolean
  needsClarification: boolean
  audience: string
}

type CurrencyFormattingContext = {
  baseCurrency: string
  previousCurrency: string | null
  currentToPreviousRate: number | null
}

const currencyFormattingContext = new AsyncLocalStorage<CurrencyFormattingContext>()

const CONFIDENCE_THRESHOLDS = {
  minTransactions: 10,
  minCoverageScore: 0.5,
  minCompleteness: 0.6,
  maxFreshnessHours: 72,
  autoApproveConfidence: 80,
} as const

const INDUSTRY_BENCHMARKS: Partial<Record<TenantInfo['businessType'], {
  grossMarginPct: number
  costToRevenueRatio: number
  inventoryTurnover: number
}>> = {
  RETAIL: { grossMarginPct: 28, costToRevenueRatio: 34, inventoryTurnover: 4.5 },
  WHOLESALE: { grossMarginPct: 18, costToRevenueRatio: 22, inventoryTurnover: 5.2 },
  DISTRIBUTION: { grossMarginPct: 16, costToRevenueRatio: 24, inventoryTurnover: 5.8 },
  MANUFACTURING: { grossMarginPct: 32, costToRevenueRatio: 42, inventoryTurnover: 3.4 },
  SERVICE: { grossMarginPct: 45, costToRevenueRatio: 48, inventoryTurnover: 0.2 },
  HOSPITALITY: { grossMarginPct: 36, costToRevenueRatio: 52, inventoryTurnover: 8.5 },
}

const MONTHLY_SEASONALITY: number[] = [
  0.92,
  0.94,
  0.98,
  1.02,
  1.05,
  1.08,
  1.06,
  1.03,
  1.01,
  1.04,
  1.09,
  1.18,
]

export type AssistantBrief = {
  summary: string
  comparativeInsights: string[]
  actions: string[]
  risks: string[]
  followUpQuestions: string[]
  responseMode?: 'clarify' | 'brief' | 'deep'
  clarificationPrompt?: string
  businessGuidance?: {
    operatingMode: 'clarification_needed' | 'insufficient_evidence' | 'monitor_only' | 'manual_intervention' | 'decision_ready'
    confidenceLabel: string
    why: string
    primaryRecommendation: string
    expectedImpact: string
    nextReview: string
    audience: string
  }
  groundingNotes?: string[]
  factBasis?: string[]
  financialMetrics?: {
    revenue: number
    profit: number
    margin: number
    expenseRatio: number
    inventoryTurnover: number
    cashRunway: number | null
  }
  quickWins?: string[]
  predictions?: Array<{
    metric: string
    currentValue: number
    predictedValue: number
    timeframe: string
    confidence: number
  }>
  alerts?: Array<{
    severity: 'critical' | 'warning' | 'info'
    message: string
    actionRequired: string
  }>
  scenarioAnalysis?: {
    bestScenario: string | null
    worstScenario: string | null
    profitSpread: number
    roiSpread: number
    calibrationSampleSize?: number
    averageSuccessScore?: number
    calibrationScore?: number
    historicalAccuracy?: number
    profitConfidenceInterval?: {
      low: number
      high: number
    }
  }
  causalAnalysis?: {
    problem: string
    topCauses: Array<{ cause: string; contribution: number }>
    interventions: string[]
    methods?: Array<{
      method: 'granger' | 'difference_in_differences' | 'synthetic_control'
      title: string
      confidence: number
      pValue?: number
      effectSize?: number
    }>
    confidenceScore?: number
  }
  strategicInsights?: Array<{
    level: 'tactical' | 'operational' | 'strategic' | 'visionary'
    insight: string
    estimatedROI: number
    timeHorizon: 'immediate' | 'quarter' | 'year' | '3_years'
  }>
  explanation?: {
    summary: string
    confidence: number
    keyFactors: Array<{ factor: string; contribution: number; direction: 'positive' | 'negative' }>
    limitations: string[]
  }
  executionPlan?: {
    autoExecutableCount: number
    approvalRequiredCount: number
    highPriorityHumanActions?: string[]
    workflowCoverageScore?: number
    workflowStages?: Array<{
      actionType: string
      stageCount: number
      matchedRules: number
      requiresHumanDecision: boolean
      executionId?: string
      approvalStatus?: string
      rollbackReady?: boolean
    }>
    topActionDecision?: 'auto_execute' | 'pending_approval'
  }
  requiresApproval?: boolean
  estimatedCost?: number
}

// ============================================================
// ADVANCED UTILITY FUNCTIONS
// ============================================================

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function pctDelta(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100
  return ((current - prior) / Math.abs(prior)) * 100
}

function getSeasonalityFactor(targetDate: Date, businessType: TenantInfo['businessType']): number {
  const monthFactor = MONTHLY_SEASONALITY[targetDate.getUTCMonth()] || 1
  if (businessType === 'SERVICE') return clamp(monthFactor * 0.98, 0.85, 1.2)
  if (businessType === 'HOSPITALITY') return clamp(monthFactor * 1.05, 0.85, 1.3)
  return clamp(monthFactor, 0.85, 1.25)
}

function resolveIndustryBenchmark(businessType: TenantInfo['businessType']) {
  return INDUSTRY_BENCHMARKS[businessType]
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(2))
}

async function getSavedFxRateToBase(tenantId: string, fromCurrency: string, baseCurrency: string): Promise<number | null> {
  if (fromCurrency === baseCurrency) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency, toCurrency: baseCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (direct?.rate) {
    const value = Number(direct.rate)
    if (Number.isFinite(value) && value > 0) return value
  }

  const inverse = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency: baseCurrency, toCurrency: fromCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (inverse?.rate) {
    const value = Number(inverse.rate)
    if (Number.isFinite(value) && value > 0) return 1 / value
  }

  return null
}

function billingCycleDays(billingCycle: string | null | undefined): number {
  return billingCycle === 'YEARLY' ? 365 : 30
}

function overlapDays(startA: Date, endA: Date, startB: Date, endB: Date): number {
  const overlapStart = Math.max(startA.getTime(), startB.getTime())
  const overlapEnd = Math.min(endA.getTime(), endB.getTime())
  if (overlapEnd <= overlapStart) return 0
  return (overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)
}

async function convertToBaseCurrency(
  tenantId: string,
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
): Promise<number> {
  const from = normalizeCurrencyCode(fromCurrency) || baseCurrency
  if (from === baseCurrency) return amount
  const rate = await getSavedFxRateToBase(tenantId, from, baseCurrency)
  if (rate && Number.isFinite(rate) && rate > 0) return amount * rate
  return 0
}

async function convertToBaseCurrencyWithCache(
  tenantId: string,
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  rateCache: Map<string, number | null>,
): Promise<number> {
  const from = normalizeCurrencyCode(fromCurrency) || baseCurrency
  if (from === baseCurrency) return amount

  const cacheKey = `${tenantId}:${from}:${baseCurrency}`
  if (rateCache.has(cacheKey)) {
    const cached = rateCache.get(cacheKey)
    if (cached && Number.isFinite(cached) && cached > 0) return amount * cached
    return 0
  }

  const rate = await getSavedFxRateToBase(tenantId, from, baseCurrency)
  rateCache.set(cacheKey, rate)
  if (rate && Number.isFinite(rate) && rate > 0) return amount * rate
  return 0
}

async function toBaseAmount(
  tenantId: string,
  amountRaw: unknown,
  currencyRaw: unknown,
  fxRateRaw: unknown,
  baseCurrency: string,
  rateCache: Map<string, number | null>,
): Promise<number> {
  const amount = toNumber(amountRaw)
  if (!Number.isFinite(amount) || amount === 0) return 0

  const currency = normalizeCurrencyCode(currencyRaw) || baseCurrency
  if (currency === baseCurrency) return amount

  const fxRate = Number(fxRateRaw)
  if (Number.isFinite(fxRate) && fxRate > 0 && fxRate !== 1) {
    // sale/expense fxRate is recorded as base->transaction; convert back by division.
    return amount / fxRate
  }

  return convertToBaseCurrencyWithCache(tenantId, amount, currency, baseCurrency, rateCache)
}

async function sumSalesToBaseCurrency(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  baseCurrency: string,
): Promise<number> {
  const rows = await prisma.sale.findMany({
    where: { tenantId, archived: false, createdAt: { gte: startDate, lt: endDate } },
    select: { totalAmount: true, currency: true, fxRate: true },
  })
  const rateCache = new Map<string, number | null>()
  const converted = await Promise.all(
    rows.map((row) => toBaseAmount(tenantId, row.totalAmount, row.currency, row.fxRate, baseCurrency, rateCache)),
  )
  return converted.reduce((sum, value) => sum + value, 0)
}

async function sumExpensesToBaseCurrency(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  baseCurrency: string,
): Promise<number> {
  const rows = await prisma.expense.findMany({
    where: { tenantId, archived: false, date: { gte: startDate, lt: endDate } },
    select: { amount: true, currency: true, fxRate: true },
  })
  const rateCache = new Map<string, number | null>()
  const converted = await Promise.all(
    rows.map((row) => toBaseAmount(tenantId, row.amount, row.currency, row.fxRate, baseCurrency, rateCache)),
  )
  return converted.reduce((sum, value) => sum + value, 0)
}

async function isPlatformTenant(tenantId: string): Promise<boolean> {
  const superAdmin = await prisma.user.findFirst({
    where: { tenantId, role: 'SUPER_ADMIN' },
    select: { id: true },
  })
  return Boolean(superAdmin)
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return /^(1|true|yes|on)$/i.test(value.trim())
}

async function shouldUseCrossTenantSubscriptionScope(tenantId: string): Promise<boolean> {
  // Keep strict tenant isolation by default. Cross-tenant scope must be explicitly enabled.
  if (!isTruthyEnv(process.env.ENTERPRISE_AI_ALLOW_CROSS_TENANT_SUBSCRIPTION_SCOPE)) {
    return false
  }
  return isPlatformTenant(tenantId)
}

async function getSubscriptionIncomeForPeriod(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  baseCurrency: string,
  opts: { crossTenantScope: boolean },
): Promise<number> {
  if (!opts.crossTenantScope) {
    return 0
  }

  const subscriptionWhere = opts.crossTenantScope
    ? { status: 'ACTIVE' as const, tenantId: { not: tenantId }, startDate: { lt: endDate }, expiryDate: { gt: startDate } }
    : { status: 'ACTIVE' as const, tenantId, startDate: { lt: endDate }, expiryDate: { gt: startDate } }

  const subscriptions = await prisma.subscription.findMany({
    where: subscriptionWhere,
    select: {
      amount: true,
      billingCurrency: true,
      startDate: true,
      expiryDate: true,
      plan: { select: { billingCycle: true } },
    },
  })

  const recurringRecognized = await Promise.all(
    subscriptions.map(async (sub) => {
      const amount = toNumber(sub.amount)
      if (amount <= 0) return 0
      const cycleDays = billingCycleDays(sub.plan?.billingCycle)
      const overlap = overlapDays(sub.startDate, sub.expiryDate, startDate, endDate)
      if (overlap <= 0) return 0
      const recognized = amount * (overlap / cycleDays)
      return convertToBaseCurrency(tenantId, recognized, sub.billingCurrency || baseCurrency, baseCurrency)
    }),
  )

  const txns = await prisma.subscriptionTransaction.findMany({
    where: {
      status: { in: ['ACTIVE', 'VERIFIED'] },
      createdAt: { gte: startDate, lt: endDate },
      ...(opts.crossTenantScope ? { tenantId: { not: tenantId } } : { tenantId }),
    },
    select: { amount: true, currency: true, subscriptionId: true },
  })

  const standaloneTransactions = txns.filter((txn) => !txn.subscriptionId)
  const standaloneConverted = await Promise.all(
    standaloneTransactions.map((txn) =>
      convertToBaseCurrency(tenantId, toNumber(txn.amount), txn.currency, baseCurrency),
    ),
  )

  return recurringRecognized.reduce((sum, value) => sum + value, 0) + standaloneConverted.reduce((sum, value) => sum + value, 0)
}

async function computeIncomeBreakdown(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  baseCurrency: string,
  opts: { crossTenantScope: boolean },
): Promise<IncomeBreakdown> {
  const salesIncome = await sumSalesToBaseCurrency(tenantId, startDate, endDate, baseCurrency)
  const subscriptionIncome = await getSubscriptionIncomeForPeriod(tenantId, startDate, endDate, baseCurrency, opts)
  const totalIncome = salesIncome + subscriptionIncome

  const [activeSubscription, verifiedSubscriptionTxn] = opts.crossTenantScope
    ? await Promise.all([
        prisma.subscription.findFirst({
          where: { tenantId: { not: tenantId }, status: 'ACTIVE' },
          select: { id: true },
        }),
        prisma.subscriptionTransaction.findFirst({
          where: {
            status: { in: ['ACTIVE', 'VERIFIED'] },
            tenantId: { not: tenantId },
          },
          select: { id: true },
        }),
      ])
    : [null, null]

  const hasSubscriptionIncomeSource = opts.crossTenantScope && Boolean(activeSubscription || verifiedSubscriptionTxn || subscriptionIncome > 0)

  return {
    totalIncome: round2(totalIncome),
    salesIncome: round2(salesIncome),
    subscriptionIncome: round2(subscriptionIncome),
    hasSubscriptionIncomeSource,
    streamMix: {
      salesPct: totalIncome > 0 ? round2((salesIncome / totalIncome) * 100) : 0,
      subscriptionPct: totalIncome > 0 ? round2((subscriptionIncome / totalIncome) * 100) : 0,
    },
  }
}

function shouldShowSubscriptionStream(incomeBreakdown: IncomeBreakdown): boolean {
  return incomeBreakdown.subscriptionIncome > 0
}

function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function parseRecheckCurrencyContext(prompt: string): {
  currentBaseCurrency: string | null
  previousResponseCurrency: string | null
} {
  const currentMatch = prompt.match(/CURRENCY_CONTEXT_CURRENT_BASE:\s*([A-Z]{3})/i)
  const previousMatch = prompt.match(/CURRENCY_CONTEXT_PREVIOUS_RESPONSE:\s*([A-Z]{3})/i)
  return {
    currentBaseCurrency: normalizeCurrencyCode(currentMatch?.[1]),
    previousResponseCurrency: normalizeCurrencyCode(previousMatch?.[1]),
  }
}

async function resolveCurrentToPreviousFxRate(tenantId: string, currentBaseCurrency: string, previousCurrency: string): Promise<number | null> {
  if (currentBaseCurrency === previousCurrency) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: {
      tenantId,
      fromCurrency: currentBaseCurrency,
      toCurrency: previousCurrency,
    },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (direct?.rate) {
    const value = Number(direct.rate)
    if (Number.isFinite(value) && value > 0) return value
  }

  const inverse = await prisma.currencyRate.findFirst({
    where: {
      tenantId,
      fromCurrency: previousCurrency,
      toCurrency: currentBaseCurrency,
    },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (inverse?.rate) {
    const value = Number(inverse.rate)
    if (Number.isFinite(value) && value > 0) return 1 / value
  }

  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Polynomial approximation for erf to avoid relying on runtime Math.erf support.
function approxErf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const poly = (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t
  const y = 1 - poly * Math.exp(-ax * ax)
  return sign * y
}

function formatCurrency(value: number): string {
  const ctx = currencyFormattingContext.getStore()
  const baseCurrency = normalizeCurrencyCode(ctx?.baseCurrency) || 'USD'
  const normalizedValue = Number.isFinite(value) ? value : 0
  const useMinorUnits = Math.abs(normalizedValue) > 0 && Math.abs(normalizedValue) < 1

  let baseLabel = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: baseCurrency,
    minimumFractionDigits: useMinorUnits ? 2 : 0,
    maximumFractionDigits: useMinorUnits ? 2 : 0,
  }).format(normalizedValue)

  if (!ctx?.previousCurrency || ctx.previousCurrency === baseCurrency) {
    return baseLabel
  }

  if (!ctx.currentToPreviousRate || !Number.isFinite(ctx.currentToPreviousRate) || ctx.currentToPreviousRate <= 0) {
    return baseLabel
  }

  const previousValue = normalizedValue * ctx.currentToPreviousRate
  const usePreviousMinorUnits = Math.abs(previousValue) > 0 && Math.abs(previousValue) < 1
  const previousLabel = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: ctx.previousCurrency,
    minimumFractionDigits: usePreviousMinorUnits ? 2 : 0,
    maximumFractionDigits: usePreviousMinorUnits ? 2 : 0,
  }).format(previousValue)

  return `${baseLabel} (${previousLabel})`
}

function formatPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  const time = parsed.getTime()
  if (!Number.isFinite(time)) return null
  return parsed.toISOString().slice(0, 10)
}

function calculateDaysOnShelf(value: Date | string | null | undefined, fallbackDays = 30): number {
  if (!value) return fallbackDays
  const parsed = value instanceof Date ? value : new Date(value)
  const time = parsed.getTime()
  if (!Number.isFinite(time)) return fallbackDays
  return Math.max(1, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)))
}

function resolveProductProvenance(args: {
  earliestReceipt?: {
    purchaseDate: Date | string
    unitCost?: number | string | null
    isEstimated?: boolean
  } | null
  purchaseDate?: Date | string | null
  createdAt?: Date | string | null
  costPrice?: number | string | null
}): {
  originalPurchaseDate: string | null
  originalUnitCost: number | null
  provenanceEstimated: boolean
} {
  const receipt = args.earliestReceipt
  if (receipt?.purchaseDate) {
    return {
      originalPurchaseDate: formatIsoDate(receipt.purchaseDate),
      originalUnitCost: toNumber(receipt.unitCost),
      provenanceEstimated: Boolean(receipt.isEstimated),
    }
  }

  if (args.purchaseDate) {
    return {
      originalPurchaseDate: formatIsoDate(args.purchaseDate),
      originalUnitCost: toNumber(args.costPrice),
      provenanceEstimated: false,
    }
  }

  if (args.createdAt) {
    return {
      originalPurchaseDate: formatIsoDate(args.createdAt),
      originalUnitCost: toNumber(args.costPrice),
      provenanceEstimated: true,
    }
  }

  return {
    originalPurchaseDate: null,
    originalUnitCost: Number.isFinite(toNumber(args.costPrice)) ? toNumber(args.costPrice) : null,
    provenanceEstimated: false,
  }
}

function formatCompactNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
  return value.toString()
}

// ============================================================
// ANOMALY DETECTION ENGINE
// ============================================================

function detectAnomalies(
  salesData: Array<{ date: Date; amount: number }>,
  expenseData: Array<{ date: Date; amount: number; category: string }>,
  inventoryData: InventoryRiskItem[]
): AssistantGrounding['anomalies'] {
  const anomalies: AssistantGrounding['anomalies'] = []
  
  // Detect sales spikes/drops using moving average
  if (salesData.length >= 7) {
    const dailySales = new Map<string, number>()
    for (const sale of salesData) {
      const dateKey = sale.date.toISOString().slice(0, 10)
      dailySales.set(dateKey, (dailySales.get(dateKey) || 0) + sale.amount)
    }
    
    const salesValues = Array.from(dailySales.values())
    const avgSales = salesValues.reduce((a, b) => a + b, 0) / salesValues.length
    const stdDev = Math.sqrt(salesValues.reduce((a, b) => a + Math.pow(b - avgSales, 2), 0) / salesValues.length)
    const threshold = avgSales + 2 * stdDev
    
    for (const [date, amount] of dailySales) {
      if (amount > threshold && amount > avgSales * 1.5) {
        anomalies.push({
          type: 'sales_spike',
          severity: amount > threshold * 1.5 ? 'high' : 'medium',
          description: `Unusual sales spike of ${formatCurrency(amount)} on ${date}`,
          recommendedAction: 'Verify if this is seasonal or a one-time event. Consider increasing stock.',
        })
      } else if (amount < avgSales * 0.5 && salesValues.length > 10) {
        anomalies.push({
          type: 'sales_drop',
          severity: amount < avgSales * 0.3 ? 'high' : 'medium',
          description: `Unusual sales drop of ${formatCurrency(amount)} on ${date} (${formatPercent((amount - avgSales) / avgSales * 100)} below average)`,
          recommendedAction: 'Investigate potential issues: marketing, competition, or operational problems.',
        })
      }
    }
  }
  
  // Detect expense anomalies
  const expenseByCategory = new Map<string, number[]>()
  for (const expense of expenseData) {
    if (!expenseByCategory.has(expense.category)) {
      expenseByCategory.set(expense.category, [])
    }
    expenseByCategory.get(expense.category)!.push(expense.amount)
  }
  
  for (const [category, amounts] of expenseByCategory) {
    if (amounts.length >= 5) {
      const avgExpense = amounts.reduce((a, b) => a + b, 0) / amounts.length
      const stdDevExpense = Math.sqrt(amounts.reduce((a, b) => a + Math.pow(b - avgExpense, 2), 0) / amounts.length)
      const thresholdExpense = avgExpense + 2 * stdDevExpense
      
      for (const expense of expenseData) {
        if (expense.category === category && expense.amount > thresholdExpense && expense.amount > avgExpense * 1.5) {
          anomalies.push({
            type: 'expense_spike',
            severity: expense.amount > thresholdExpense * 1.5 ? 'high' : 'medium',
            description: `Unusual ${category} expense of ${formatCurrency(expense.amount)} on ${expense.date.toISOString().slice(0, 10)}`,
            recommendedAction: `Review this ${category} expense - verify if legitimate and necessary.`,
          })
        }
      }
    }
  }
  
  // Detect inventory anomalies
  const highRiskItems = inventoryData.filter(i => i.riskScore > 0.7)
  if (highRiskItems.length > 0) {
    anomalies.push({
      type: 'inventory_anomaly',
      severity: highRiskItems.some(i => i.urgency === 'P1') ? 'high' : 'medium',
      description: `${highRiskItems.length} products at critical stockout risk: ${highRiskItems.slice(0, 3).map(i => i.productName).join(', ')}`,
      recommendedAction: 'Immediate reorder required for P1 items.',
    })
  }
  
  return anomalies
}

// ============================================================
// PREDICTIVE FORECASTING ENGINE
// ============================================================

function forecastSales(salesHistory: number[], days: number, seasonalFactor = 1): { forecast: number; upperBound: number; lowerBound: number; confidence: number } {
  if (salesHistory.length < 7) {
    return { forecast: 0, upperBound: 0, lowerBound: 0, confidence: 0.3 }
  }
  
  // Simple exponential smoothing
  const alpha = 0.3
  let smoothed = salesHistory[0]
  for (let i = 1; i < salesHistory.length; i++) {
    smoothed = alpha * salesHistory[i] + (1 - alpha) * smoothed
  }
  
  const dailyForecast = smoothed * clamp(seasonalFactor, 0.8, 1.3)
  const forecastTotal = dailyForecast * days
  
  // Calculate confidence based on data consistency
  const mean = salesHistory.reduce((a, b) => a + b, 0) / salesHistory.length
  if (!Number.isFinite(mean) || mean <= 0) {
    return {
      forecast: round2(Math.max(0, forecastTotal)),
      upperBound: round2(Math.max(0, forecastTotal * 1.2)),
      lowerBound: round2(Math.max(0, forecastTotal * 0.8)),
      confidence: 0.3,
    }
  }
  const variance = salesHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / salesHistory.length
  const cv = Math.sqrt(variance) / mean // Coefficient of variation
  const confidence = clamp(1 - cv, 0.3, 0.95)
  
  const marginOfError = forecastTotal * (1 - confidence)
  
  return {
    forecast: round2(forecastTotal),
    upperBound: round2(forecastTotal + marginOfError),
    lowerBound: round2(Math.max(0, forecastTotal - marginOfError)),
    confidence: round2(confidence),
  }
}

function detectLifecycleStage(productMetrics: { revenueGrowth: number; margin: number; inventoryTurnover: number }): ProductComparison['lifecycleStage'] {
  if (productMetrics.revenueGrowth > 30 && productMetrics.margin > 20) return 'growth'
  if (productMetrics.revenueGrowth > 10 && productMetrics.inventoryTurnover > 4) return 'maturity'
  if (productMetrics.revenueGrowth < -10 || productMetrics.margin < 5) return 'decline'
  return 'introduction'
}

function mapCognitiveBusinessTypeToTenantType(primaryType: string): TenantInfo['businessType'] {
  switch (primaryType) {
    case 'RETAIL':
    case 'WHOLESALE':
    case 'MANUFACTURING':
    case 'DISTRIBUTION':
    case 'SERVICE':
    case 'HOSPITALITY':
      return primaryType
    default:
      return 'UNKNOWN'
  }
}

// ============================================================
// TENANT DETECTION & BUSINESS PROFILING (Enhanced)
// ============================================================

async function detectTenantInfo(tenantId: string): Promise<TenantInfo> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      country: true,
      state: true,
      createdAt: true,
    },
  })

  const branchCount = await prisma.subsidiary.count({
    where: { tenantId, archived: false },
  })

  const products = await prisma.product.findMany({
    where: { tenantId, archived: false },
    select: { type: true, name: true },
    take: 100,
  })

  const hasGoods = products.some(p => p.type === 'GOODS')
  const hasServices = products.some(p => p.type === 'SERVICE')
  const productCount = products.length

  let businessType: TenantInfo['businessType'] = 'UNKNOWN'
  
  if (hasGoods && productCount > 100) {
    businessType = 'DISTRIBUTION'
  } else if (hasGoods && productCount > 20) {
    businessType = 'RETAIL'
  } else if (hasGoods && productCount <= 20 && productCount > 0) {
    businessType = 'HOSPITALITY'
  } else if (!hasGoods && hasServices) {
    businessType = 'SERVICE'
  } else if (hasGoods && hasServices) {
    businessType = 'RETAIL'
  }

  // Refine business type using persisted cognitive mapping when confidence is strong.
  try {
    const detected = await detectAndStoreBusinessType(tenantId)
    const mappedType = mapCognitiveBusinessTypeToTenantType(detected.primaryType)
    if (mappedType !== 'UNKNOWN' && detected.confidence >= 0.65) {
      businessType = mappedType
    }
  } catch {
    // Non-blocking: fallback to heuristic business type above.
  }

  // Determine lifecycle stage based on age and growth
  const ageInMonths = tenant?.createdAt ? (Date.now() - tenant.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000) : 12
  let lifecycleStage: TenantInfo['lifecycleStage'] = 'startup'
  if (ageInMonths > 36) lifecycleStage = 'mature'
  else if (ageInMonths > 12) lifecycleStage = 'growth'
  else if (ageInMonths < 6) lifecycleStage = 'startup'
  
  // Estimate runway (simplified)
  const recentExpenses = await prisma.expense.aggregate({
    where: { tenantId, archived: false, date: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    _sum: { amount: true },
  })
  const monthlyBurn = toNumber(recentExpenses._sum.amount)
  const cashBalance = 0 // Would need a cash table; default to unknown
  const estimatedRunway = cashBalance > 0 && monthlyBurn > 0 ? cashBalance / monthlyBurn : null

  return {
    id: tenant?.id || tenantId,
    name: tenant?.name || 'Business',
    baseCurrency: normalizeCurrencyCode(tenant?.baseCurrency) || 'USD',
    businessType,
    country: tenant?.country || null,
    state: tenant?.state || null,
    hasMultipleBranches: branchCount > 1,
    activeBranchCount: branchCount,
    lifecycleStage,
    estimatedMonthlyRunway: estimatedRunway,
  }
}

// ============================================================
// INTENT DETECTION (Advanced)
// ============================================================

export function detectPromptIntent(prompt: string): PromptIntent {
  const lower = prompt.toLowerCase()
  
  if (/(restock|reorder|inventory|stockout|stock out|shortage|replenish|low stock|stock level|inventory value|stock value)/i.test(lower)) {
    return 'RESTOCK'
  }
  
  if (/(profit|margin|profitable|loss|profitability|gross profit|net profit|earnings|roi|profit margin)/i.test(lower)) {
    return 'PROFITABILITY'
  }
  
  if (/(sales|revenue|selling|top selling|best seller|revenue trend|sales performance|best product|worst product)/i.test(lower)) {
    return 'SALES'
  }
  
  if (/(expense|cost|spending|overhead|budget|cost saving|reduce cost|savings|expense category)/i.test(lower)) {
    return 'EXPENSES'
  }
  
  if (/(branch|store|location|subsidiary|performance|compare branches)/i.test(lower)) {
    return 'BRANCH'
  }
  
  if (/(cash|cashflow|liquidity|runway|burn rate)/i.test(lower)) {
    return 'CASHFLOW'
  }
  
  if (/(forecast|predict|future|next month|upcoming|trend)/i.test(lower)) {
    return 'FORECAST'
  }
  
  return 'GENERAL'
}

export function detectAssistantTaskType(prompt: string): AssistantTaskType {
  const lower = prompt.toLowerCase().trim()

  if (/(recheck|follow up|follow-up|what changed|since last|still unresolved|did we|progress on)/i.test(lower)) {
    return 'follow_up'
  }
  if (/(forecast|predict|projection|outlook|next month|next quarter|what will|upcoming)/i.test(lower)) {
    return 'forecast'
  }
  if (/(why|root cause|diagnos|explain|what is driving|what caused|reason for)/i.test(lower)) {
    return 'diagnosis'
  }
  if (/(which should|which branch|which product|priority|priorities|what should we do|what do i do|next 7 days|this week|immediate support|action plan)/i.test(lower)) {
    return 'prioritize'
  }
  if (/(what if|scenario|simulate|decision|should we|should i|approve|invest|expand|raise price|cut price)/i.test(lower)) {
    return 'decision'
  }
  return 'status'
}

export function detectResponseDetailLevel(prompt: string): ResponseDetailLevel {
  const lower = prompt.toLowerCase()
  if (/(deep dive|detailed|detail|breakdown|full analysis|show all|explain fully|step by step|with evidence)/i.test(lower)) {
    return 'deep'
  }
  return 'brief'
}

export function shouldRequestClarification(prompt: string, intent: PromptIntent): boolean {
  const lower = prompt.toLowerCase().trim()
  const wordCount = lower.split(/\s+/).filter(Boolean).length
  if (wordCount <= 3) return true
  if (intent !== 'GENERAL') return false

  return /(help|improve|advice|insight|business status|performance|what matters|what should i know)/i.test(lower)
    && !/(sales|revenue|profit|margin|expense|branch|inventory|stock|cash|forecast)/i.test(lower)
}

export function shouldIncludeAdvancedInsights(args: {
  intent: PromptIntent
  taskType: AssistantTaskType
  detailLevel: ResponseDetailLevel
  coverageScore: number
  hasEnoughData: boolean
  activeBranchCount: number
}): Pick<AssistantResponsePolicy, 'allowScenario' | 'allowCausal' | 'allowStrategic' | 'allowExecution'> {
  const lowSignal = args.coverageScore < 0.55 || !args.hasEnoughData
  const branchComparisonLimited = args.intent === 'BRANCH' && args.activeBranchCount <= 1
  const deep = args.detailLevel === 'deep'

  return {
    allowScenario: deep && !lowSignal && !branchComparisonLimited && (args.taskType === 'decision' || args.taskType === 'forecast'),
    allowCausal: deep && !lowSignal && !branchComparisonLimited && (args.taskType === 'diagnosis' || args.taskType === 'decision'),
    allowStrategic: deep && !lowSignal && (args.intent === 'GENERAL' || args.intent === 'PROFITABILITY' || args.intent === 'SALES' || args.intent === 'EXPENSES') && args.taskType !== 'status',
    allowExecution: args.intent === 'RESTOCK' || args.taskType === 'decision' || args.taskType === 'follow_up',
  }
}

function buildAssistantAudience(userRole?: string): string {
  if (userRole === 'SUPER_ADMIN') return 'Executive / platform owner'
  if (userRole === 'BUSINESS_ADMIN') return 'Business admin / decision owner'
  if (userRole === 'SALESPERSON') return 'Sales and frontline operator'
  if (userRole === 'AGENT') return 'Operations agent'
  return 'Business operator'
}

function buildResponsePolicy(args: {
  prompt: string
  intent: PromptIntent
  grounding: AssistantGrounding
  userRole?: string
}): AssistantResponsePolicy {
  const taskType = detectAssistantTaskType(args.prompt)
  const detailLevel = detectResponseDetailLevel(args.prompt)
  const needsClarification = shouldRequestClarification(args.prompt, args.intent)
  const lowSignal = args.grounding.coverageScore < 0.55 || !args.grounding.dataQuality.hasEnoughData
  const singleBranchComparisonsNotMeaningful = args.intent === 'BRANCH' && args.grounding.tenantInfo.activeBranchCount <= 1
  const advanced = shouldIncludeAdvancedInsights({
    intent: args.intent,
    taskType,
    detailLevel,
    coverageScore: args.grounding.coverageScore,
    hasEnoughData: args.grounding.dataQuality.hasEnoughData,
    activeBranchCount: args.grounding.tenantInfo.activeBranchCount,
  })

  return {
    responseMode: needsClarification ? 'clarify' : detailLevel,
    taskType,
    detailLevel,
    allowScenario: advanced.allowScenario,
    allowCausal: advanced.allowCausal,
    allowStrategic: advanced.allowStrategic,
    allowExecution: advanced.allowExecution,
    lowSignal,
    singleBranchComparisonsNotMeaningful,
    needsClarification,
    audience: buildAssistantAudience(args.userRole),
  }
}

function buildClarificationBrief(args: {
  prompt: string
  intent: PromptIntent
  grounding: AssistantGrounding
  policy: AssistantResponsePolicy
}): AssistantBrief {
  const baseFact = args.intent === 'GENERAL'
    ? `Current coverage is ${Math.round(args.grounding.coverageScore * 100)}% with ${args.grounding.dataQuality.recency} data.`
    : `Grounded on ${args.grounding.periodLabel.toLowerCase()} tenant data with ${Math.round(args.grounding.coverageScore * 100)}% coverage.`

  const suggestions = args.intent === 'GENERAL'
    ? [
        'Summarize this week\'s sales priorities',
        'Show branch risks for this week',
        'Explain what is driving margin pressure',
      ]
    : args.intent === 'BRANCH'
      ? [
          'Give me a single-branch weekly KPI summary',
          'Show the top branch risks with financial impact',
          'Create a 7-day branch action plan',
        ]
      : [
          'Summarize current status only',
          'Explain the root causes',
          'Recommend actions for the next 7 days',
        ]

  return {
    summary: 'I can answer this better if you narrow the business task first.',
    comparativeInsights: [baseFact, `Audience: ${args.policy.audience}`],
    actions: ['Choose one of the follow-up prompts below so I can return a focused operator-grade answer.'],
    risks: ['A broad prompt increases the chance of mixing status, diagnosis, and recommendations in one reply.'],
    followUpQuestions: suggestions,
    responseMode: 'clarify',
    clarificationPrompt: args.prompt,
    businessGuidance: {
      operatingMode: 'clarification_needed',
      confidenceLabel: 'Clarification needed',
      why: 'The prompt is too broad to determine whether you want status, diagnosis, or action guidance.',
      primaryRecommendation: 'Select a narrower prompt path before acting on the output.',
      expectedImpact: 'Higher relevance and less filler in the next response.',
      nextReview: 'Ask one focused follow-up now.',
      audience: args.policy.audience,
    },
    groundingNotes: ['The assistant is pausing to avoid a broad, mixed-quality response.'],
    factBasis: [baseFact],
  }
}

function limitList(values: string[], maxItems: number): string[] {
  return values.filter((value) => typeof value === 'string' && value.trim()).slice(0, maxItems)
}

function sanitizeFactLines(values: string[]): string[] {
  return values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
}

function removeMatchingLines(values: string[], pattern: RegExp): string[] {
  return values.filter((value) => !pattern.test(value))
}

function applySingleBranchOperationalRewrite(brief: AssistantBrief, grounding: AssistantGrounding): AssistantBrief {
  const branchSnapshot = getBranchAttributedSnapshot(grounding.branchComparisons)
  const onlyBranchName = grounding.branchComparisons[0]?.branchName || 'Head Office'
  const hasSignal = branchSnapshot.revenueCurrent > 0 || branchSnapshot.expenseCurrent > 0

  return {
    ...brief,
    summary: hasSignal
      ? `🏢 ${grounding.tenantInfo.name} Weekly Branch Status: only one active branch is configured, so comparative ranking is not applicable. ${onlyBranchName} generated ${formatCurrency(branchSnapshot.revenueCurrent)} in branch-attributed revenue this period with ${branchSnapshot.marginPctCurrent.toFixed(1)}% margin.`
      : `🏢 ${grounding.tenantInfo.name} Weekly Branch Status: only one active branch is configured, so comparative branch ranking is not applicable yet.`,
    comparativeInsights: sanitizeFactLines([
      `Only ${grounding.tenantInfo.activeBranchCount} active branch is configured.`,
      `Branch in scope: ${onlyBranchName}.`,
      `Branch-attributed revenue: ${formatCurrency(branchSnapshot.revenueCurrent)}.`,
      `Branch-attributed margin: ${formatCurrency(branchSnapshot.marginCurrent)} (${branchSnapshot.marginPctCurrent.toFixed(1)}%).`,
      `Coverage score: ${Math.round(grounding.coverageScore * 100)}% with ${grounding.dataQuality.recency} data.`,
    ]),
    actions: sanitizeFactLines([
      `P3 - Maintain weekly revenue and margin checkpoint for ${onlyBranchName}.`,
      'P3 - Keep branch tagging discipline consistent so future comparisons remain reliable.',
      'P2 - Ask for a single-branch 7-day action plan if you want branch-specific operational tasks.',
    ]),
    risks: sanitizeFactLines([
      'Comparative branch ranking is unavailable with a single active branch.',
      `Coverage score: ${Math.round(grounding.coverageScore * 100)}%.`,
      `Recency: ${grounding.dataQuality.recency}.`,
    ]),
    followUpQuestions: [
      `Do you want a 7-day action plan for ${onlyBranchName}?`,
      `Do you want anomaly-only monitoring for ${onlyBranchName}?`,
      'Should I switch to a company-wide summary instead of branch comparison?',
    ],
    scenarioAnalysis: undefined,
    causalAnalysis: undefined,
    strategicInsights: undefined,
    executionPlan: undefined,
  }
}

function buildFactBasis(args: {
  intent: PromptIntent
  grounding: AssistantGrounding
  responseGrounding: AssistantGrounding
}): string[] {
  const facts: string[] = []
  facts.push(`Grounding source: ${args.responseGrounding.groundingSource}.`)
  facts.push(`Coverage score: ${Math.round(args.grounding.coverageScore * 100)}% with ${args.grounding.dataQuality.recency} data.`)

  if (args.intent === 'BRANCH') {
    facts.push(`Active branches configured: ${args.grounding.tenantInfo.activeBranchCount}.`)
    facts.push(`Branch-attributed revenue in scope: ${formatCurrency(args.responseGrounding.current.revenue)}.`)
    facts.push(`Branch-attributed margin in scope: ${formatCurrency(args.responseGrounding.current.profit)} (${args.responseGrounding.current.margin.toFixed(1)}%).`)
  } else if (args.intent === 'SALES' || args.intent === 'GENERAL') {
    facts.push(`Current revenue: ${formatCurrency(args.responseGrounding.current.revenue)} (${formatPercent(args.responseGrounding.deltas.revenuePct)} vs prior).`)
    facts.push(`Transactions observed: ${args.grounding.salesInsights.transactionCount}.`)
  } else if (args.intent === 'PROFITABILITY') {
    facts.push(`Net profit: ${formatCurrency(args.grounding.profitability.netProfit)} (${args.grounding.profitability.netMarginPct.toFixed(1)}% margin).`)
    facts.push(`Loss-making products: ${args.grounding.profitability.lossMakingProductCount}.`)
  } else if (args.intent === 'EXPENSES') {
    facts.push(`Expense growth: ${formatPercent(args.grounding.expenseInsights.expenseGrowthRate)} vs prior.`)
    facts.push(`Cost-to-revenue ratio: ${args.grounding.expenseInsights.costToRevenueRatio.toFixed(1)}%.`)
  } else if (args.intent === 'RESTOCK') {
    facts.push(`P1 stockout risks: ${args.grounding.inventoryRiskItems.filter((item) => item.urgency === 'P1').length}.`)
    facts.push(`Inventory turnover: ${(args.grounding.businessIntelligence?.inventoryHealth?.inventoryTurnover || 0).toFixed(1)}x.`)
  }

  if (args.grounding.history.length > 0) {
    facts.push(`Conversation context includes ${args.grounding.history.length} prior assistant turn(s).`)
  }

  return sanitizeFactLines(facts)
}

function buildGroundingNotes(args: {
  grounding: AssistantGrounding
  policy: AssistantResponsePolicy
}): string[] {
  const notes = [
    args.grounding.groundingSource === 'external'
      ? 'Response is grounded on the validated external connector snapshot for this tenant.'
      : 'Response is grounded on internal tenant analytics data.',
    args.policy.lowSignal
      ? 'Low-signal safeguards are active, so speculative sections are suppressed.'
      : 'Sufficient signal is available for focused business guidance.',
  ]

  if (args.grounding.history.length > 0) {
    notes.push('Prior conversation context was considered when shaping the follow-up path.')
  }

  return sanitizeFactLines(notes)
}

function buildBusinessGuidance(args: {
  brief: AssistantBrief
  grounding: AssistantGrounding
  policy: AssistantResponsePolicy
  reliability: AssistantReliability
}): NonNullable<AssistantBrief['businessGuidance']> {
  const operatingMode: NonNullable<AssistantBrief['businessGuidance']>['operatingMode'] = args.policy.needsClarification
    ? 'clarification_needed'
    : args.policy.lowSignal
      ? 'insufficient_evidence'
      : args.reliability.confidenceLevel === 'high' && (args.policy.taskType === 'decision' || args.policy.taskType === 'prioritize')
        ? 'decision_ready'
        : args.reliability.confidenceLevel === 'low'
          ? 'monitor_only'
          : 'manual_intervention'

  const confidenceLabel = operatingMode === 'clarification_needed'
    ? 'Clarification needed'
    : operatingMode === 'insufficient_evidence'
      ? 'Use for monitoring only'
      : operatingMode === 'decision_ready'
        ? 'Decision-ready for manual action'
        : operatingMode === 'manual_intervention'
          ? 'Good for manual review'
          : 'Monitoring only'

  const primaryRecommendation = args.brief.actions[0] || args.brief.summary
  const expectedImpact = args.brief.financialMetrics
    ? `Revenue ${formatCurrency(args.brief.financialMetrics.revenue)} | Profit ${formatCurrency(args.brief.financialMetrics.profit)} | Margin ${args.brief.financialMetrics.margin.toFixed(1)}%`
    : `Coverage ${Math.round(args.grounding.coverageScore * 100)}% with ${args.grounding.dataQuality.recency} data`
  const nextReview = args.policy.taskType === 'prioritize' || args.policy.taskType === 'status'
    ? 'Review again in 7 days or after a material KPI change.'
    : args.policy.taskType === 'forecast'
      ? 'Re-run after the next reporting period or major assumption change.'
      : 'Review again after the next operational update.'

  return {
    operatingMode,
    confidenceLabel,
    why: args.policy.lowSignal
      ? 'Coverage or data completeness is not strong enough for aggressive recommendations.'
      : `Grounding quality is ${Math.round(args.reliability.groundingQualityScore * 100)}% with ${args.reliability.confidenceLevel} confidence.`,
    primaryRecommendation,
    expectedImpact,
    nextReview,
    audience: args.policy.audience,
  }
}

function applyContradictionFilters(args: {
  brief: AssistantBrief
  grounding: AssistantGrounding
  responseGrounding: AssistantGrounding
  intent: PromptIntent
  policy: AssistantResponsePolicy
}): AssistantBrief {
  const brief = { ...args.brief }
  const stableContext = `${brief.summary} ${brief.risks.join(' ')}`.toLowerCase()

  if (
    brief.causalAnalysis
    && (args.intent === 'BRANCH' || args.responseGrounding.deltas.revenuePct >= 0 || /no immediate|stable|not applicable/.test(stableContext))
    && brief.causalAnalysis.problem === 'revenue_decline'
  ) {
    const conflictingCause = brief.causalAnalysis.topCauses.some((cause) => /declin|low transaction velocity|demand softening/i.test(cause.cause))
    if (conflictingCause) {
      brief.causalAnalysis = undefined
    }
  }

  if (
    brief.scenarioAnalysis
    && (
      (brief.scenarioAnalysis.bestScenario === brief.scenarioAnalysis.worstScenario && brief.scenarioAnalysis.profitSpread === 0)
      || ((brief.scenarioAnalysis.calibrationScore || 0) < 0.35 && (brief.scenarioAnalysis.historicalAccuracy || 0) <= 0)
      || args.policy.lowSignal
    )
  ) {
    brief.scenarioAnalysis = undefined
    brief.comparativeInsights = removeMatchingLines(brief.comparativeInsights, /^Scenario best-case:/i)
  }

  if (args.policy.lowSignal || args.policy.taskType === 'status') {
    brief.actions = brief.actions.filter((item) => !/STRATEGIC:/i.test(item))
    if (brief.strategicInsights?.length === 1 && /stable|measurement cadence/i.test(brief.strategicInsights[0]?.insight || '')) {
      brief.strategicInsights = undefined
    }
  }

  if (!args.policy.allowExecution && (!brief.executionPlan?.highPriorityHumanActions || brief.executionPlan.highPriorityHumanActions.length === 0)) {
    brief.executionPlan = undefined
  }

  return brief
}

function applyResponsePolicyToBrief(args: {
  brief: AssistantBrief
  prompt: string
  intent: PromptIntent
  grounding: AssistantGrounding
  responseGrounding: AssistantGrounding
  reliability: AssistantReliability
  policy: AssistantResponsePolicy
}): AssistantBrief {
  let nextBrief = { ...args.brief }

  if (args.policy.needsClarification) {
    nextBrief = buildClarificationBrief({
      prompt: args.prompt,
      intent: args.intent,
      grounding: args.grounding,
      policy: args.policy,
    })
  }

  if (args.policy.singleBranchComparisonsNotMeaningful && args.intent === 'BRANCH') {
    nextBrief = applySingleBranchOperationalRewrite(nextBrief, args.grounding)
  }

  if (!args.policy.allowScenario) nextBrief.scenarioAnalysis = undefined
  if (!args.policy.allowCausal) nextBrief.causalAnalysis = undefined
  if (!args.policy.allowStrategic) {
    nextBrief.strategicInsights = undefined
    nextBrief.actions = nextBrief.actions.filter((item) => !/STRATEGIC:/i.test(item))
  }
  if (!args.policy.allowExecution && (!nextBrief.executionPlan?.highPriorityHumanActions || nextBrief.executionPlan.highPriorityHumanActions.length === 0)) {
    nextBrief.executionPlan = undefined
  }

  nextBrief = applyContradictionFilters({
    brief: nextBrief,
    grounding: args.grounding,
    responseGrounding: args.responseGrounding,
    intent: args.intent,
    policy: args.policy,
  })

  const listLimit = args.policy.detailLevel === 'deep' ? 6 : 4
  const riskLimit = args.policy.detailLevel === 'deep' ? 5 : 3
  nextBrief.comparativeInsights = limitList(nextBrief.comparativeInsights, listLimit)
  nextBrief.actions = limitList(nextBrief.actions, listLimit)
  nextBrief.risks = limitList(nextBrief.risks, riskLimit)
  nextBrief.followUpQuestions = limitList(nextBrief.followUpQuestions, 3)
  nextBrief.quickWins = nextBrief.quickWins ? limitList(nextBrief.quickWins, 3) : undefined
  nextBrief.responseMode = args.policy.responseMode
  nextBrief.groundingNotes = buildGroundingNotes({ grounding: args.responseGrounding, policy: args.policy })
  nextBrief.factBasis = buildFactBasis({
    intent: args.intent,
    grounding: args.grounding,
    responseGrounding: args.responseGrounding,
  })
  nextBrief.businessGuidance = buildBusinessGuidance({
    brief: nextBrief,
    grounding: args.responseGrounding,
    policy: args.policy,
    reliability: args.reliability,
  })

  return nextBrief
}

// ============================================================
// BRANCH PERFORMANCE PRIORITIES (Enhanced)
// ============================================================

function getBranchPerformancePriorities(branchComparisons: BranchComparison[]): Array<{
  branchName: string
  priority: 'P1' | 'P2' | 'P3'
  issue: string
  action: string
  metric: string
  impact: string
  roi: string
}> {
  const priorities: Array<{
    branchName: string
    priority: 'P1' | 'P2' | 'P3'
    issue: string
    action: string
    metric: string
    impact: string
    roi: string
  }> = []
  
  // Calculate efficiency scores and rank branches
  const branchesWithEfficiency = branchComparisons.map(branch => ({
    ...branch,
    efficiencyScore: branch.currentMargin / Math.max(1, branch.currentRevenue) * 100,
  }))
  
  const sortedByEfficiency = [...branchesWithEfficiency].sort((a, b) => b.efficiencyScore - a.efficiencyScore)
  branchesWithEfficiency.forEach((branch, idx) => { branch.rank = idx + 1 })
  
  for (const branch of branchesWithEfficiency) {
    if (branch.currentMargin < 0) {
      priorities.push({
        branchName: branch.branchName,
        priority: 'P1',
        issue: `Negative margin of ${formatCurrency(branch.currentMargin)}`,
        action: `Immediate expense audit and price review at ${branch.branchName}`,
        metric: `Margin: ${formatCurrency(branch.currentMargin)}`,
        impact: `Fixing could save ${formatCurrency(Math.abs(branch.currentMargin))} monthly`,
        roi: 'Immediate',
      })
    } 
    else if (branch.revenueDeltaPct < -30) {
      priorities.push({
        branchName: branch.branchName,
        priority: 'P1',
        issue: `Revenue crashed ${branch.revenueDeltaPct.toFixed(0)}% vs prior period`,
        action: `Emergency sales audit at ${branch.branchName} - check staffing, marketing, competition`,
        metric: `Revenue: ${formatCurrency(branch.currentRevenue)} (↓${Math.abs(branch.revenueDeltaPct).toFixed(0)}%)`,
        impact: `Recovering to prior levels adds ${formatCurrency(branch.priorRevenue - branch.currentRevenue)}`,
        roi: 'High',
      })
    }
    else if (branch.marginDeltaPct < -20) {
      priorities.push({
        branchName: branch.branchName,
        priority: 'P2',
        issue: `Margin collapsed ${branch.marginDeltaPct.toFixed(0)}%`,
        action: `Review discount policies and cost structure at ${branch.branchName}`,
        metric: `Margin: ${branch.grossMarginPct.toFixed(0)}% (↓${Math.abs(branch.marginDeltaPct).toFixed(0)}%)`,
        impact: `Each 1% margin recovery adds ${formatCurrency(branch.currentRevenue * 0.01)}`,
        roi: 'Medium',
      })
    }
    else if (branch.revenueDeltaPct < -15) {
      priorities.push({
        branchName: branch.branchName,
        priority: 'P2',
        issue: `Revenue declined ${branch.revenueDeltaPct.toFixed(0)}%`,
        action: `Analyze sales performance and customer traffic at ${branch.branchName}`,
        metric: `Revenue: ${formatCurrency(branch.currentRevenue)} (↓${Math.abs(branch.revenueDeltaPct).toFixed(0)}%)`,
        impact: `Stabilizing prevents further ${formatCurrency(branch.currentRevenue * 0.1)} loss`,
        roi: 'Medium',
      })
    }
    else if (branch.revenueDeltaPct < -5 || branch.grossMarginPct < 20) {
      priorities.push({
        branchName: branch.branchName,
        priority: 'P3',
        issue: branch.revenueDeltaPct < -5 ? `Revenue down ${branch.revenueDeltaPct.toFixed(0)}%` : `Low margin (${branch.grossMarginPct.toFixed(0)}%)`,
        action: `Monitor ${branch.branchName} performance weekly for trend changes`,
        metric: branch.revenueDeltaPct < -5 ? `Revenue: ${formatCurrency(branch.currentRevenue)}` : `Margin: ${branch.grossMarginPct.toFixed(0)}%`,
        impact: `Early intervention prevents larger issues`,
        roi: 'Low',
      })
    }
  }
  
  const priorityOrder = { P1: 0, P2: 1, P3: 2 }
  return priorities.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}

// ============================================================
// PROFITABILITY ANALYSIS (Enhanced with Forecasting)
// ============================================================

async function analyzeProfitability(tenantId: string, startDate: Date, endDate: Date, additionalIncome = 0): Promise<ProfitabilityAnalysis> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } })
  const baseCurrency = normalizeCurrencyCode(tenant?.baseCurrency) || 'USD'

  const sales = await prisma.sale.findMany({
    where: {
      tenantId,
      archived: false,
      createdAt: { gte: startDate, lt: endDate },
    },
    include: {
      items: {
        include: {
          product: {
            select: { 
              costPrice: true, 
              name: true, 
              id: true,
              category: true,
            },
          },
        },
      },
    },
  })

  let totalRevenue = 0
  let totalCost = 0
  const productProfit: Record<string, { revenue: number; cost: number; name: string; category: string | null; margin: number }> = {}
  const categoryProfit: Record<string, { revenue: number; cost: number }> = {}
  const rateCache = new Map<string, number | null>()

  for (const sale of sales) {
    totalRevenue += await toBaseAmount(tenantId, sale.totalAmount, sale.currency, sale.fxRate, baseCurrency, rateCache)
    
    for (const item of sale.items) {
      const revenueAmount = toNumber(item.subtotal)
      const costUnit = toNumber(item.costPrice)
      const qty = toNumber(item.quantity)
      const revenue = await toBaseAmount(tenantId, revenueAmount, sale.currency, sale.fxRate, baseCurrency, rateCache)
      const cost = await convertToBaseCurrencyWithCache(
        tenantId,
        costUnit * qty,
        sale.currency,
        baseCurrency,
        rateCache,
      )
      const productId = item.productId
      const productName = item.product.name
      const category = item.product.category || null
      
      totalCost += cost
      
      if (!productProfit[productId]) {
        productProfit[productId] = { revenue: 0, cost: 0, name: productName, category, margin: 0 }
      }
      productProfit[productId].revenue += revenue
      productProfit[productId].cost += cost
      
      if (category) {
        if (!categoryProfit[category]) {
          categoryProfit[category] = { revenue: 0, cost: 0 }
        }
        categoryProfit[category].revenue += revenue
        categoryProfit[category].cost += cost
      }
    }
  }

  const grossProfit = totalRevenue - totalCost
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

  const totalExpenses = await sumExpensesToBaseCurrency(tenantId, startDate, endDate, baseCurrency)
  const netProfit = grossProfit - totalExpenses
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  // Calculate break-even revenue
  const fixedCosts = totalExpenses * 0.7 // Estimate fixed costs as 70% of expenses
  const variableCostRatio = 1 - grossMarginPct / 100
  const breakEvenRevenue = fixedCosts / (1 - variableCostRatio)

  const productMetrics = Object.entries(productProfit).map(([id, data]) => {
    const profit = data.revenue - data.cost
    const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0
    const contributionPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
    return {
      id,
      name: data.name,
      category: data.category,
      revenue: data.revenue,
      cost: data.cost,
      profit,
      margin,
      contributionPct,
    }
  })

  const sortedByProfit = [...productMetrics].sort((a, b) => b.profit - a.profit)
  const sortedByMargin = [...productMetrics].sort((a, b) => a.margin - b.margin)

  const profitableCount = productMetrics.filter(p => p.profit > 0).length
  const lossMakingCount = productMetrics.filter(p => p.profit < 0).length
  const breakEvenCount = productMetrics.filter(p => p.profit === 0).length

  const categoryMetrics = Object.entries(categoryProfit).map(([category, data]) => {
    const profit = data.revenue - data.cost
    const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0
    return { category, revenue: data.revenue, cost: data.cost, profit, margin }
  })

  const sortedCategoriesByProfit = [...categoryMetrics].sort((a, b) => b.profit - a.profit)
  const sortedCategoriesByLoss = [...categoryMetrics].sort((a, b) => a.profit - b.profit)

  const avgMarginByCategory: Record<string, number> = {}
  for (const cat of categoryMetrics) {
    avgMarginByCategory[cat.category] = round2(cat.margin)
  }

  const profitDrivers: string[] = []
  const profitRisks: string[] = []
  
  if (sortedByProfit[0]?.profit > 0) {
    profitDrivers.push(`${sortedByProfit[0].name} (${formatCurrency(sortedByProfit[0].profit)} profit, ${sortedByProfit[0].margin.toFixed(0)}% margin)`)
  }
  if (sortedCategoriesByProfit[0]?.profit > 0) {
    profitDrivers.push(`${sortedCategoriesByProfit[0].category} category (${formatCurrency(sortedCategoriesByProfit[0].profit)} profit)`)
  }
  
  if (sortedByMargin[0]?.profit < 0) {
    profitRisks.push(`${sortedByMargin[0].name} losing ${formatCurrency(Math.abs(sortedByMargin[0].profit))}`)
  }
  if (lossMakingCount > productMetrics.length * 0.3) {
    profitRisks.push(`${lossMakingCount} products (${Math.round(lossMakingCount / productMetrics.length * 100)}%) are unprofitable`)
  }
  if (netMarginPct < 10 && netMarginPct > 0) {
    profitRisks.push(`Thin net margin of ${netMarginPct.toFixed(0)}% leaves little room for errors`)
  }
  if (netMarginPct < 0) {
    profitRisks.push(`🚨 CRITICAL: Business is operating at a net loss of ${formatCurrency(Math.abs(netProfit))}`)
  }

  // Profit margin forecast
  const historicalMargins = [grossMarginPct, grossMarginPct * 0.95, grossMarginPct * 0.98] // Simplified
  const marginForecast = forecastSales(historicalMargins, 30)
  
  return {
    totalRevenue: round2(totalRevenue + additionalIncome),
    totalCost: round2(totalCost),
    grossProfit: round2(grossProfit + additionalIncome),
    grossMarginPct: round2((totalRevenue + additionalIncome) > 0 ? ((grossProfit + additionalIncome) / (totalRevenue + additionalIncome)) * 100 : 0),
    netProfit: round2(netProfit + additionalIncome),
    netMarginPct: round2((totalRevenue + additionalIncome) > 0 ? ((netProfit + additionalIncome) / (totalRevenue + additionalIncome)) * 100 : 0),
    topProfitableProducts: sortedByProfit.slice(0, 5).map(p => ({ 
      name: p.name, 
      category: p.category, 
      profit: round2(p.profit), 
      margin: round2(p.margin),
      contributionPct: round2(p.contributionPct)
    })),
    topLossMakingProducts: sortedByMargin.slice(0, 5).filter(p => p.profit < 0).map(p => ({ 
      name: p.name, 
      category: p.category, 
      loss: round2(Math.abs(p.profit)), 
      margin: round2(p.margin) 
    })),
    profitableProductCount: profitableCount,
    lossMakingProductCount: lossMakingCount,
    breakEvenProducts: breakEvenCount,
    avgMarginByCategory,
    topCategoriesByProfit: sortedCategoriesByProfit.slice(0, 5).map(c => ({ 
      category: c.category, 
      profit: round2(c.profit), 
      margin: round2(c.margin),
      revenue: round2(c.revenue)
    })),
    topCategoriesByLoss: sortedCategoriesByLoss.slice(0, 5).filter(c => c.profit < 0).map(c => ({ 
      category: c.category, 
      loss: round2(Math.abs(c.profit)), 
      margin: round2(c.margin) 
    })),
    profitDrivers,
    profitRisks,
    breakEvenRevenue: round2(breakEvenRevenue),
    profitMarginForecast: {
      next30Days: round2(marginForecast.forecast),
      next90Days: round2(marginForecast.forecast * 0.98),
      confidence: marginForecast.confidence,
    },
  }
}

// ============================================================
// SALES INSIGHTS (Enhanced with Anomaly Detection & Forecasting)
// ============================================================

async function analyzeSalesInsights(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  additionalIncome = 0,
  seasonalFactor = 1,
): Promise<SalesInsight> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } })
  const baseCurrency = normalizeCurrencyCode(tenant?.baseCurrency) || 'USD'
  const rateCache = new Map<string, number | null>()

  const [sales, saleItems] = await Promise.all([
    prisma.sale.findMany({
      where: {
        tenantId,
        archived: false,
        createdAt: { gte: startDate, lt: endDate },
      },
      select: { id: true, totalAmount: true, currency: true, fxRate: true, createdAt: true },
    }),
    prisma.saleItem.findMany({
      where: {
        sale: {
          tenantId,
          archived: false,
          createdAt: { gte: startDate, lt: endDate },
        },
      },
      select: {
        productId: true,
        subtotal: true,
        quantity: true,
        sale: { select: { currency: true, fxRate: true } },
      },
    })
  ])

  const salesInBase = await Promise.all(
    sales.map((s) => toBaseAmount(tenantId, s.totalAmount, s.currency, s.fxRate, baseCurrency, rateCache)),
  )
  const totalSales = salesInBase.reduce((sum, value) => sum + value, 0)
  const totalIncome = totalSales + additionalIncome
  const transactionCount = sales.length
  const avgOrderValue = transactionCount > 0 ? totalSales / transactionCount : 0

  const productAccumulator = new Map<string, { revenue: number; units: number }>()
  for (const row of saleItems) {
    const revenue = await toBaseAmount(tenantId, row.subtotal, row.sale.currency, row.sale.fxRate, baseCurrency, rateCache)
    const current = productAccumulator.get(row.productId) || { revenue: 0, units: 0 }
    current.revenue += revenue
    current.units += toNumber(row.quantity)
    productAccumulator.set(row.productId, current)
  }

  const productIds = Array.from(productAccumulator.keys())
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, category: true },
  })
  const productMap = new Map(products.map(p => [p.id, { name: p.name, category: p.category }]))

  const productSales = Array.from(productAccumulator.entries())
    .map(([productId, stats]) => ({ productId, revenue: stats.revenue, units: stats.units }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  const topSellingProducts = productSales.slice(0, 5).map(ps => ({
    name: productMap.get(ps.productId)?.name || ps.productId,
    category: productMap.get(ps.productId)?.category || null,
    revenue: round2(ps.revenue),
    units: round2(ps.units),
    contributionPct: totalIncome > 0 ? (ps.revenue / totalIncome) * 100 : 0,
  }))

  const categorySales = new Map<string, number>()
  for (const item of productSales) {
    const category = productMap.get(item.productId)?.category
    if (category) {
      const revenue = item.revenue
      categorySales.set(category, (categorySales.get(category) || 0) + revenue)
    }
  }
  
  const totalRevenue = Array.from(categorySales.values()).reduce((a, b) => a + b, 0)
  const topSellingCategories = Array.from(categorySales.entries())
    .map(([category, revenue]) => ({ 
      category, 
      revenue: round2(revenue), 
      percentage: round2((revenue / totalRevenue) * 100) 
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const now = new Date()
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  
  const [last7Total, prev7Total] = await Promise.all([
    sumSalesToBaseCurrency(tenantId, last7Start, now, baseCurrency),
    sumSalesToBaseCurrency(tenantId, prev7Start, last7Start, baseCurrency),
  ])
  const trendPct = prev7Total > 0 ? (last7Total - prev7Total) / prev7Total : 0
  
  let salesTrend: 'increasing' | 'stable' | 'decreasing' = 'stable'
  let trendStrength = 0
  if (trendPct > 0.1) {
    salesTrend = 'increasing'
    trendStrength = Math.min(1, trendPct)
  } else if (trendPct < -0.1) {
    salesTrend = 'decreasing'
    trendStrength = Math.min(1, Math.abs(trendPct))
  }

  // Build sales history for forecasting
  const dailySalesMap = new Map<string, number>()
  for (let i = 0; i < sales.length; i += 1) {
    const sale = sales[i]
    const dateKey = sale.createdAt.toISOString().slice(0, 10)
    dailySalesMap.set(dateKey, (dailySalesMap.get(dateKey) || 0) + (salesInBase[i] || 0))
  }
  const salesHistory = Array.from(dailySalesMap.values())
  
  const forecast7 = forecastSales(salesHistory, 7, seasonalFactor)
  const forecast30 = forecastSales(salesHistory, 30, seasonalFactor)
  const forecast90 = forecastSales(salesHistory, 90, seasonalFactor)

  // Detect anomalies
  const salesByDate = sales.map((s, idx) => ({ date: s.createdAt, amount: salesInBase[idx] || 0 }))
  const anomalies = detectAnomalies(salesByDate, [], []).filter(a => a.type === 'sales_spike' || a.type === 'sales_drop')
    .map(a => ({
      date: a.description.match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'unknown',
      expectedRevenue: 0,
      actualRevenue: 0,
      deviation: 0,
      severity: a.severity,
    }))

  const productsWithStock = await prisma.product.findMany({
    where: { tenantId, archived: false, quantity: { gt: 0 } },
    select: {
      id: true,
      name: true,
      category: true,
      quantity: true,
      costPrice: true,
      purchaseDate: true,
      createdAt: true,
      productReceipts: {
        select: {
          purchaseDate: true,
          unitCost: true,
          isEstimated: true,
        },
        orderBy: { purchaseDate: 'asc' },
        take: 1,
      },
    },
    take: 50,
  })

  const stockedProductIds = productsWithStock.map((p) => p.id)
  const soldUnitsRows = stockedProductIds.length
    ? await prisma.saleItem.groupBy({
        by: ['productId'],
        where: {
          productId: { in: stockedProductIds },
          sale: { tenantId, archived: false, createdAt: { gte: startDate } },
        },
        _sum: { quantity: true },
      })
    : []
  const soldUnitsByProductId = new Map(soldUnitsRows.map((row) => [row.productId, toNumber(row._sum.quantity)]))

  const slowMoving = productsWithStock.map((product) => {
    const unitsSold = soldUnitsByProductId.get(product.id) || 0
    const provenance = resolveProductProvenance({
      earliestReceipt: product.productReceipts[0],
      purchaseDate: product.purchaseDate,
      createdAt: product.createdAt,
      costPrice: product.costPrice,
    })
    const daysOnShelf = calculateDaysOnShelf(provenance.originalPurchaseDate, calculateDaysOnShelf(product.createdAt, 30))
    const stockValue = toNumber(product.quantity) * toNumber(product.costPrice)
    return {
      name: product.name,
      category: product.category,
      unitsSold,
      daysOnShelf,
      turnover: unitsSold / daysOnShelf,
      stockValue,
      originalUnitCost: provenance.originalUnitCost,
      originalPurchaseDate: provenance.originalPurchaseDate,
      provenanceEstimated: provenance.provenanceEstimated,
    }
  })

  const slowMovingProducts = slowMoving
    .filter(p => p.unitsSold < 5 && p.daysOnShelf > 30)
    .sort((a, b) => a.turnover - b.turnover)
    .slice(0, 5)
    .map(p => ({
      name: p.name,
      category: p.category,
      unitsSold: p.unitsSold,
      daysOnShelf: p.daysOnShelf,
      stockValue: round2(p.stockValue),
      originalUnitCost: p.originalUnitCost,
      originalPurchaseDate: p.originalPurchaseDate,
      provenanceEstimated: p.provenanceEstimated,
    }))

  return {
    totalSales: round2(totalIncome),
    transactionCount,
    avgOrderValue: round2(avgOrderValue),
    topSellingProducts,
    topSellingCategories,
    slowMovingProducts,
    salesTrend,
    trendStrength,
    peakHours: [],
    bestSellingDay: '',
    salesForecast: {
      next7Days: round2(forecast7.forecast),
      next30Days: round2(forecast30.forecast),
      next90Days: round2(forecast90.forecast),
      confidence: forecast30.confidence,
      upperBound: forecast30.upperBound,
      lowerBound: forecast30.lowerBound,
    },
    anomalies,
  }
}

// ============================================================
// EXPENSE INSIGHTS (Enhanced with Forecasting)
// ============================================================

async function analyzeExpenseInsights(tenantId: string, startDate: Date, endDate: Date, revenueOverride?: number): Promise<ExpenseInsight> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } })
  const baseCurrency = normalizeCurrencyCode(tenant?.baseCurrency) || 'USD'
  const rateCache = new Map<string, number | null>()

  const expenses = await prisma.expense.findMany({
    where: {
      tenantId,
      archived: false,
      date: { gte: startDate, lt: endDate },
    },
    select: { amount: true, category: true, title: true, date: true, currency: true, fxRate: true },
  })

  const convertedExpenses = await Promise.all(
    expenses.map((e) => toBaseAmount(tenantId, e.amount, e.currency, e.fxRate, baseCurrency, rateCache)),
  )
  const totalExpenses = convertedExpenses.reduce((sum, amount) => sum + amount, 0)
  
  const categoryMap = new Map<string, number>()
  for (let i = 0; i < expenses.length; i += 1) {
    const expense = expenses[i]
    const category = expense.category || 'Other'
    categoryMap.set(category, (categoryMap.get(category) || 0) + (convertedExpenses[i] || 0))
  }

  const priorStart = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  const priorExpensesAll = await prisma.expense.findMany({
    where: { tenantId, archived: false, date: { gte: priorStart, lt: startDate } },
    select: { amount: true, category: true, currency: true, fxRate: true },
  })

  const priorConverted = await Promise.all(
    priorExpensesAll.map((expense) => toBaseAmount(tenantId, expense.amount, expense.currency, expense.fxRate, baseCurrency, rateCache)),
  )
  const priorCategoryMap = new Map<string, number>()
  for (let i = 0; i < priorExpensesAll.length; i += 1) {
    const expense = priorExpensesAll[i]
    const category = expense.category || 'Other'
    priorCategoryMap.set(category, (priorCategoryMap.get(category) || 0) + (priorConverted[i] || 0))
  }

  const topExpenseCategories = Array.from(categoryMap.entries())
    .map(([category, amount]) => {
      const priorAmount = priorCategoryMap.get(category) || 0
      const trend = priorAmount > 0 ? ((amount - priorAmount) / priorAmount) : 0
      let trendStatus: 'rising' | 'stable' | 'falling' = 'stable'
      if (trend > 0.1) trendStatus = 'rising'
      else if (trend < -0.1) trendStatus = 'falling'
      
      return { 
        category, 
        amount: round2(amount), 
        pctOfTotal: round2((amount / totalExpenses) * 100),
        trend: trendStatus
      }
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  const periodDays = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
  const priorStartPeriod = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000)
  
  const priorTotal = await sumExpensesToBaseCurrency(tenantId, priorStartPeriod, startDate, baseCurrency)
  const expenseGrowthRate = priorTotal > 0 ? ((totalExpenses - priorTotal) / priorTotal) * 100 : 0

  const amounts = convertedExpenses
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
  const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length
  const stdDev = Math.sqrt(variance)
  const threshold = mean + 2 * stdDev

  const unusualExpenses = expenses
    .map((expense, idx) => ({ expense, convertedAmount: convertedExpenses[idx] || 0 }))
    .filter((x) => x.convertedAmount > threshold && x.convertedAmount > 1000)
    .slice(0, 5)
    .map((x) => ({
      title: x.expense.title,
      amount: round2(x.convertedAmount),
      date: x.expense.date.toISOString().slice(0, 10),
      category: x.expense.category || 'Other',
      isAnomaly: true,
    }))

  const revenue = revenueOverride !== undefined
    ? revenueOverride
    : await sumSalesToBaseCurrency(tenantId, startDate, endDate, baseCurrency)
  const costToRevenueRatio = revenue > 0 ? (totalExpenses / revenue) * 100 : 0
  const expenseEfficiencyScore = clamp(100 - costToRevenueRatio, 0, 100)

  const recommendedSavings: Array<{ category: string; potentialSavings: number; action: string; priority: 'P1' | 'P2' | 'P3' }> = []
  const highExpenseCategories = topExpenseCategories.filter(c => c.pctOfTotal > 20)
  for (const category of highExpenseCategories) {
    const savings = category.amount * 0.15
    recommendedSavings.push({
      category: category.category,
      potentialSavings: round2(savings),
      action: `Review ${category.category} expenses for potential 15% reduction through vendor negotiation`,
      priority: savings > 5000 ? 'P2' : 'P3',
    })
  }
  
  if (expenseGrowthRate > 20) {
    recommendedSavings.push({
      category: 'Overall Spending',
      potentialSavings: round2(totalExpenses * 0.1),
      action: `Conduct full expense audit - spending grew ${expenseGrowthRate.toFixed(0)}% vs prior period`,
      priority: 'P1',
    })
  }

  // Expense forecast
  const expenseHistory = amounts.slice(-30)
  const expenseForecast30 = forecastSales(expenseHistory, 30)
  const expenseForecast90 = forecastSales(expenseHistory, 90)

  return {
    totalExpenses: round2(totalExpenses),
    topExpenseCategories,
    expenseGrowthRate: round2(expenseGrowthRate),
    unusualExpenses,
    costToRevenueRatio: round2(costToRevenueRatio),
    recommendedSavings,
    expenseEfficiencyScore: round2(expenseEfficiencyScore),
    expenseForecast: {
      next30Days: round2(expenseForecast30.forecast),
      next90Days: round2(expenseForecast90.forecast),
      confidence: expenseForecast30.confidence,
    },
  }
}

// ============================================================
// INVENTORY RISK ITEMS (Enhanced with Stockout Probability)
// ============================================================

async function getInventoryRiskItems(tenantId: string, currentStart: Date): Promise<InventoryRiskItem[]> {
  const [products, soldUnits30Rows] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, archived: false },
      select: {
        id: true,
        name: true,
        category: true,
        subsidiaryId: true,
        quantity: true,
        lowStockThreshold: true,
        costPrice: true,
        purchaseDate: true,
        createdAt: true,
        productReceipts: {
          select: {
            purchaseDate: true,
            unitCost: true,
            isEstimated: true,
          },
          orderBy: { purchaseDate: 'asc' },
          take: 1,
        },
      },
      take: 500,
    }),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          tenantId,
          archived: false,
          createdAt: { gte: currentStart },
        },
      },
      _sum: { quantity: true },
    }),
  ])

  const soldByProduct = new Map(soldUnits30Rows.map((row) => [row.productId, toNumber(row._sum.quantity)]))

  const riskItems = products
    .map((product) => {
      const provenance = resolveProductProvenance({
        earliestReceipt: product.productReceipts[0],
        purchaseDate: product.purchaseDate,
        createdAt: product.createdAt,
        costPrice: product.costPrice,
      })
      const currentStock = toNumber(product.quantity)
      const lowStockThreshold = toNumber(product.lowStockThreshold) || 10
      const soldUnits30 = toNumber(soldByProduct.get(product.id)) || 0
      const avgDailyDemand = soldUnits30 / 30
      const daysOfInventory = avgDailyDemand > 0 ? currentStock / avgDailyDemand : 999
      
      let daysToStockout: number | null = null
      if (avgDailyDemand > 0) {
        daysToStockout = currentStock / avgDailyDemand
      } else if (currentStock < lowStockThreshold) {
        daysToStockout = 0.5
      }
      
      const safetyStock = avgDailyDemand * 3
      const reorderPoint = Math.ceil(avgDailyDemand * 7 + safetyStock)
      const holdingCostPerUnit = toNumber(product.costPrice) * 0.2
      const eoqRaw = holdingCostPerUnit > 0
        ? Math.sqrt((2 * soldUnits30 * 50) / holdingCostPerUnit)
        : 0
      const economicOrderQty = Number.isFinite(eoqRaw) && eoqRaw > 0
        ? Math.ceil(eoqRaw)
        : Math.ceil(avgDailyDemand * 14)
      const targetStock = Math.ceil(Math.max(avgDailyDemand * 14, lowStockThreshold * 1.5))
      const suggestedReorderQty = Math.max(0, targetStock - currentStock)
      const stockValue = currentStock * toNumber(product.costPrice)
      const turnoverRate = soldUnits30 > 0 ? (soldUnits30 / 30) / Math.max(1, currentStock) : 0

      // Calculate stockout probability (simplified Poisson)
      let stockoutProbability = 0
      if (avgDailyDemand > 0 && daysToStockout !== null) {
        const leadTimeDemand = avgDailyDemand * 7 // Assume 7-day lead time
        const zScore = (currentStock - leadTimeDemand) / Math.sqrt(leadTimeDemand)
        stockoutProbability = clamp(1 - 0.5 * (1 + approxErf(zScore / Math.sqrt(2))), 0, 1)
      } else if (currentStock < lowStockThreshold) {
        stockoutProbability = 0.7
      }

      let riskScore = 0
      
      if (currentStock <= lowStockThreshold) {
        riskScore += 0.4
      } else if (currentStock <= lowStockThreshold * 2) {
        riskScore += 0.2
      }
      
      if (daysToStockout !== null) {
        if (daysToStockout <= 2) riskScore += 0.4
        else if (daysToStockout <= 5) riskScore += 0.3
        else if (daysToStockout <= 7) riskScore += 0.2
        else if (daysToStockout <= 14) riskScore += 0.1
      } else if (currentStock < lowStockThreshold) {
        riskScore += 0.3
      }
      
      if (soldUnits30 > 50) riskScore += 0.2
      else if (soldUnits30 > 20) riskScore += 0.1
      
      riskScore = clamp(riskScore, 0, 1)
      
      let urgency: 'P1' | 'P2' | 'P3' = 'P3'
      let recommendedAction: InventoryRiskItem['recommendedAction'] = 'monitor'
      
      if (riskScore >= 0.7 || (daysToStockout !== null && daysToStockout <= 2)) {
        urgency = 'P1'
        recommendedAction = 'order_immediately'
      } else if (riskScore >= 0.4 || (daysToStockout !== null && daysToStockout <= 7)) {
        urgency = 'P2'
        recommendedAction = 'order_soon'
      } else if (daysOfInventory > 90) {
        recommendedAction = 'reduce_stock'
      }

      return {
        productId: product.id,
        productName: product.name,
        category: product.category,
        subsidiaryId: product.subsidiaryId,
        currentStock,
        lowStockThreshold,
        soldUnits30,
        avgDailyDemand: round2(avgDailyDemand),
        daysToStockout: daysToStockout !== null ? round2(daysToStockout) : null,
        suggestedReorderQty,
        urgency,
        riskScore: round2(riskScore),
        stockValue: round2(stockValue),
        turnoverRate: round2(turnoverRate),
        costPrice: toNumber(product.costPrice),
        originalUnitCost: provenance.originalUnitCost,
        originalPurchaseDate: provenance.originalPurchaseDate,
        provenanceEstimated: provenance.provenanceEstimated,
        daysOfInventory: round2(daysOfInventory),
        reorderPoint: round2(reorderPoint),
        economicOrderQty: round2(economicOrderQty),
        stockoutProbability: round2(stockoutProbability),
        recommendedAction,
      }
    })
    .filter((item) => 
      item.riskScore > 0.2 ||
      item.suggestedReorderQty > 0 ||
      item.currentStock <= item.lowStockThreshold * 1.5 ||
      item.daysOfInventory > 90
    )
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20)

  return riskItems
}

// ============================================================
// PRODUCT COMPARISONS (Enhanced with Lifecycle)
// ============================================================

async function getProductComparisons(tenantId: string, currentStart: Date, priorStart: Date): Promise<ProductComparison[]> {
  const [currentRows, priorRows, products] = await Promise.all([
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          tenantId,
          archived: false,
          createdAt: { gte: currentStart },
        },
      },
      _sum: { subtotal: true, quantity: true },
    }),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          tenantId,
          archived: false,
          createdAt: { gte: priorStart, lt: currentStart },
        },
      },
      _sum: { subtotal: true, quantity: true },
    }),
    prisma.product.findMany({
      where: { tenantId, archived: false },
      select: { id: true, name: true, category: true, costPrice: true, sellingPrice: true, quantity: true },
    }),
  ])

  const productMap = new Map(products.map(p => [p.id, { 
    name: p.name, 
    category: p.category, 
    costPrice: toNumber(p.costPrice), 
    sellingPrice: toNumber(p.sellingPrice),
    currentStock: toNumber(p.quantity)
  }]))
  const productIds = [...new Set([...currentRows, ...priorRows].map((row) => row.productId))]

  const comparisons = productIds.map((productId) => {
    const current = currentRows.find((row) => row.productId === productId)
    const prior = priorRows.find((row) => row.productId === productId)
    const product = productMap.get(productId)
    const currentRevenue = toNumber(current?._sum.subtotal)
    const priorRevenue = toNumber(prior?._sum.subtotal)
    const currentUnits = toNumber(current?._sum.quantity)
    const priorUnits = toNumber(prior?._sum.quantity)
    
    const currentCost = product ? currentUnits * product.costPrice : 0
    const priorCost = product ? priorUnits * product.costPrice : 0
    const currentProfit = currentRevenue - currentCost
    const priorProfit = priorRevenue - priorCost
    const marginPct = currentRevenue > 0 ? (currentProfit / currentRevenue) * 100 : 0
    
    const inventoryTurnover = product && product.currentStock > 0 ? currentUnits / product.currentStock : 0
    const daysOfInventory = inventoryTurnover > 0 ? 30 / inventoryTurnover : 999
    
    const revenueGrowth = priorRevenue > 0 ? ((currentRevenue - priorRevenue) / priorRevenue) * 100 : 0
    const lifecycleStage = detectLifecycleStage({
      revenueGrowth,
      margin: marginPct,
      inventoryTurnover,
    })
    
    const velocityScore = (currentUnits / 30) / Math.max(1, product?.currentStock || 1)

    return {
      productId,
      productName: product?.name || productId,
      category: product?.category || null,
      currentRevenue: round2(currentRevenue),
      priorRevenue: round2(priorRevenue),
      revenueDeltaPct: round2(revenueGrowth),
      currentUnits: round2(currentUnits),
      priorUnits: round2(priorUnits),
      unitsDeltaPct: round2(pctDelta(currentUnits, priorUnits)),
      currentProfit: round2(currentProfit),
      priorProfit: round2(priorProfit),
      profitDeltaPct: round2(pctDelta(currentProfit, priorProfit)),
      marginPct: round2(marginPct),
      isProfitable: currentProfit > 0,
      profitRank: 0,
      inventoryTurnover: round2(inventoryTurnover),
      daysOfInventory: round2(daysOfInventory),
      velocityScore: round2(velocityScore),
      lifecycleStage,
      priceElasticity: null,
    }
  })

  const sortedByProfit = [...comparisons].sort((a, b) => b.currentProfit - a.currentProfit)
  comparisons.forEach((c, idx) => { c.profitRank = idx + 1 })

  return sortedByProfit.slice(0, 20)
}

// ============================================================
// BUSINESS INTELLIGENCE GENERATION (Enhanced)
// ============================================================

async function generateBusinessIntelligence(
  tenantId: string,
  profitability: ProfitabilityAnalysis,
  salesInsights: SalesInsight,
  expenseInsights: ExpenseInsight,
  inventoryRiskItems: InventoryRiskItem[],
  revenueDeltaPct: number,
  tenantInfo: TenantInfo,
): Promise<BusinessIntelligence> {
  const recommendations: BusinessIntelligence['recommendations'] = []

  // Pricing recommendations
  if (profitability.lossMakingProductCount > 0) {
    const lossProducts = profitability.topLossMakingProducts.slice(0, 3)
    recommendations.push({
      priority: 'P2',
      category: 'pricing',
      title: 'Address Loss-Making Products',
      description: `${profitability.lossMakingProductCount} products (${Math.round(profitability.lossMakingProductCount / Math.max(1, profitability.profitableProductCount + profitability.lossMakingProductCount) * 100)}% of product line) are selling at a loss. ${lossProducts.map(p => p.name).join(', ')} need immediate review.`,
      expectedImpact: `Turning around loss-making products could increase profit by ${formatCurrency(lossProducts.reduce((sum, p) => sum + p.loss, 0))}`,
      effort: 'medium',
      roi: 'high',
      actionItems: lossProducts.map(p => `Review pricing for ${p.name} (${p.category || 'uncategorized'}, current margin: ${p.margin}%)`),
      timeframe: 'this_week',
      successMetric: `Increase margin to >10% for these products`,
    })
  }

  // Inventory recommendations
  const highRiskItems = inventoryRiskItems.filter(i => i.urgency === 'P1')
  if (highRiskItems.length > 0) {
    recommendations.push({
      priority: 'P1',
      category: 'inventory',
      title: 'Critical Stockout Risks',
      description: `${highRiskItems.length} products at risk of stockout within 2 days. Stockout probability: ${highRiskItems.map(i => `${i.productName}: ${(i.stockoutProbability * 100).toFixed(0)}%`).join(', ')}.`,
      expectedImpact: `Prevent lost sales of ${formatCurrency(highRiskItems.reduce((sum, i) => sum + (i.avgDailyDemand * 7 * (i.costPrice || 10) * 2), 0))} over next week`,
      effort: 'low',
      roi: 'immediate',
      actionItems: highRiskItems.map(i => `Reorder ${i.suggestedReorderQty} units of ${i.productName} (${i.category || 'uncategorized'})`),
      timeframe: 'immediate',
      successMetric: `Reduce stockout probability to <10%`,
    })
  }

  // Expense recommendations
  if (expenseInsights.expenseGrowthRate > 15) {
    recommendations.push({
      priority: 'P2',
      category: 'expense',
      title: 'Rapid Expense Growth Detected',
      description: `Expenses grew ${expenseInsights.expenseGrowthRate.toFixed(1)}% vs prior period, outpacing revenue growth of ${revenueDeltaPct > 0 ? '+' : ''}${revenueDeltaPct.toFixed(1)}%.`,
      expectedImpact: `Potential savings of ${formatCurrency(expenseInsights.totalExpenses * 0.1)} with expense controls`,
      effort: 'medium',
      roi: 'high',
      actionItems: expenseInsights.recommendedSavings.slice(0, 2).map(s => s.action),
      timeframe: 'this_week',
      successMetric: `Reduce expense growth rate to <5%`,
    })
  }

  // Sales recommendations
  if (salesInsights.salesTrend === 'decreasing') {
    recommendations.push({
      priority: 'P2',
      category: 'sales',
      title: 'Declining Sales Trend',
      description: `Sales decreased ${Math.abs(salesInsights.trendStrength * 100).toFixed(0)}% over the last 7 days. ${salesInsights.topSellingProducts[0]?.name || 'Top products'} still performing.`,
      expectedImpact: `Reverse decline and recover ${formatCurrency(salesInsights.totalSales * 0.1)} in lost revenue`,
      effort: 'medium',
      roi: 'medium',
      actionItems: [
        'Review pricing competitiveness against market',
        'Increase marketing spend on top products',
        `Run promotion on ${salesInsights.slowMovingProducts.slice(0, 2).map(p => p.name).join(', ')} to clear inventory`,
      ],
      timeframe: 'this_week',
      successMetric: `Return to positive sales growth within 14 days`,
    })
  }

  // Cash flow recommendation
  if (tenantInfo.estimatedMonthlyRunway && tenantInfo.estimatedMonthlyRunway < 3) {
    recommendations.unshift({
      priority: 'P1',
      category: 'cashflow',
      title: '🚨 CRITICAL: Cash Runway Warning',
      description: `Estimated cash runway is ${tenantInfo.estimatedMonthlyRunway.toFixed(1)} months. Immediate action required to preserve cash.`,
      expectedImpact: `Extend runway by 2-3 months through cost controls`,
      effort: 'high',
      roi: 'critical',
      actionItems: [
        'Freeze non-essential hiring and spending',
        'Accelerate accounts receivable collection',
        'Negotiate extended payment terms with suppliers',
        'Review all subscription and recurring costs',
      ],
      timeframe: 'immediate',
      successMetric: `Extend runway to >6 months`,
    })
  }

  // Net loss recommendation
  if (profitability.netProfit < 0) {
    recommendations.unshift({
      priority: 'P1',
      category: 'operations',
      title: '🚨 BUSINESS IS OPERATING AT A LOSS',
      description: `Current net loss of ${formatCurrency(Math.abs(profitability.netProfit))} (${Math.abs(profitability.netMarginPct).toFixed(0)}% negative margin). Immediate action required. Break-even revenue target: ${formatCurrency(profitability.breakEvenRevenue)}.`,
      expectedImpact: `Return to profitability and save ${formatCurrency(Math.abs(profitability.netProfit))} monthly`,
      effort: 'high',
      roi: 'critical',
      actionItems: [
        'Immediate expense freeze and audit',
        'Review all product pricing, especially loss-making items',
        'Identify and cut non-essential expenses',
        'Increase sales focus on high-margin products',
      ],
      timeframe: 'immediate',
      successMetric: `Achieve positive net margin within 30 days`,
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'P3',
      category: 'operations',
      title: 'Optimize Product Mix',
      description: `Focus on ${profitability.topProfitableProducts.slice(0, 3).map(p => p.name).join(', ')} which have ${profitability.topProfitableProducts[0]?.margin || 0}% margins and drive ${profitability.topProfitableProducts[0]?.contributionPct?.toFixed(0) || 0}% of profit.`,
      expectedImpact: `Increase overall margin by 2-5%`,
      effort: 'low',
      roi: 'medium',
      actionItems: [
        'Increase shelf space and marketing for high-margin products',
        'Consider bundling slow movers with best sellers',
        'Review supplier pricing for top products',
      ],
      timeframe: 'this_month',
      successMetric: `Increase overall margin by 2 percentage points`,
    })
  }

  const totalStockValue = inventoryRiskItems.reduce((sum, i) => sum + i.stockValue, 0)
  const slowMovingStockValue = inventoryRiskItems.filter(i => i.turnoverRate < 0.5).reduce((sum, i) => sum + i.stockValue, 0)
  const avgTurnover = inventoryRiskItems.reduce((sum, i) => sum + i.turnoverRate, 0) / Math.max(1, inventoryRiskItems.length)
  const daysOfInventory = avgTurnover > 0 ? 30 / avgTurnover : 60
  
  // Calculate health score
  let healthScore = 50
  if (profitability.netProfit > 0) healthScore += 20
  if (profitability.netMarginPct > 15) healthScore += 10
  if (salesInsights.salesTrend === 'increasing') healthScore += 15
  if (expenseInsights.costToRevenueRatio < 40) healthScore += 10
  if (highRiskItems.length === 0) healthScore += 10
  if (profitability.lossMakingProductCount === 0) healthScore += 10
  if (tenantInfo.lifecycleStage === 'growth') healthScore += 5
  if (tenantInfo.lifecycleStage === 'mature') healthScore += 10
  healthScore = clamp(healthScore, 0, 100)

  // Determine top opportunity and biggest risk
  let topOpportunity = ''
  let biggestRisk = ''
  
  if (profitability.topProfitableProducts.length > 0) {
    topOpportunity = `Increase focus on ${profitability.topProfitableProducts[0].name} (${profitability.topProfitableProducts[0].margin.toFixed(0)}% margin)`
  }
  if (salesInsights.salesTrend === 'increasing') {
    topOpportunity = `Capitalize on ${salesInsights.trendStrength > 0.2 ? 'strong' : 'moderate'} sales growth momentum`
  }
  if (expenseInsights.recommendedSavings.length > 0) {
    topOpportunity = `Reduce ${expenseInsights.topExpenseCategories[0]?.category} expenses by ${formatCurrency(expenseInsights.recommendedSavings[0]?.potentialSavings || 0)}`
  }
  
  if (profitability.netProfit < 0) {
    biggestRisk = `Business is losing ${formatCurrency(Math.abs(profitability.netProfit))} - cash flow at risk`
  } else if (highRiskItems.length > 0) {
    biggestRisk = `${highRiskItems.length} products will stockout within 2 days (${highRiskItems.map(i => `${i.productName}: ${(i.stockoutProbability * 100).toFixed(0)}% risk`).join(', ')})`
  } else if (profitability.lossMakingProductCount > 10) {
    biggestRisk = `${profitability.lossMakingProductCount} loss-making products eroding margins`
  } else if (expenseInsights.expenseGrowthRate > 20) {
    biggestRisk = `Rapid expense growth (${expenseInsights.expenseGrowthRate.toFixed(0)}%) threatening profitability`
  } else {
    biggestRisk = `Monitor competitive pressures and market changes`
  }

  // Cash flow insight
  const monthlyBurn = expenseInsights.totalExpenses
  const cashFlowInsight = {
    currentRunway: tenantInfo.estimatedMonthlyRunway,
    burnRate: round2(monthlyBurn),
    recommendedAction: tenantInfo.estimatedMonthlyRunway && tenantInfo.estimatedMonthlyRunway < 6 
      ? 'Reduce burn rate by 20% to extend runway' 
      : 'Maintain current spending levels',
  }

  // Competitive position (simplified)
  const pricePositioning: BusinessIntelligence['competitivePosition']['pricePositioning'] =
    profitability.grossMarginPct > 50 ? 'premium' : profitability.grossMarginPct > 25 ? 'mid' : 'budget'
  const competitivePosition = {
    pricePositioning,
    marketShareEstimate: null,
    keyAdvantages: profitability.profitDrivers.slice(0, 2),
  }

  const benchmark = resolveIndustryBenchmark(tenantInfo.businessType)
  const industryBenchmarks = benchmark
    ? {
        grossMarginPct: benchmark.grossMarginPct,
        costToRevenueRatio: benchmark.costToRevenueRatio,
        inventoryTurnover: benchmark.inventoryTurnover,
        profitabilityIndex: round2(clamp(
          (profitability.grossMarginPct / Math.max(1, benchmark.grossMarginPct)) * 40 +
            ((100 - expenseInsights.costToRevenueRatio) / Math.max(1, 100 - benchmark.costToRevenueRatio)) * 35 +
            (avgTurnover / Math.max(0.1, benchmark.inventoryTurnover)) * 25,
          0,
          200,
        )),
      }
    : undefined

  return {
    profitability,
    sales: salesInsights,
    expenses: expenseInsights,
    inventoryHealth: {
      totalStockValue: round2(totalStockValue),
      slowMovingStockValue: round2(slowMovingStockValue),
      overstockValue: round2(inventoryRiskItems.filter(i => i.daysOfInventory > 60).reduce((sum, i) => sum + i.stockValue, 0)),
      stockoutRiskCount: highRiskItems.length,
      inventoryTurnover: round2(avgTurnover),
      daysOfInventory: round2(daysOfInventory),
      recommendedActions: [
        highRiskItems.length > 0 ? `Immediate reorder for ${highRiskItems.length} P1 items` : 'Monitor inventory levels weekly',
        slowMovingStockValue > 10000 ? `Clear ${formatCurrency(slowMovingStockValue)} in slow-moving inventory` : 'Maintain current inventory strategy',
      ],
      healthScore: round2(healthScore),
      cashTiedInInventory: round2(totalStockValue),
      optimalInventoryLevel: round2(totalStockValue * 0.8),
    },
    recommendations,
    executiveSummary: `Business is ${profitability.netProfit >= 0 ? 'profitable' : 'operating at a loss'} with ${formatCurrency(Math.abs(profitability.netProfit))} ${profitability.netProfit >= 0 ? 'profit' : 'loss'}. ${salesInsights.salesTrend === 'increasing' ? 'Sales are growing' : 'Sales need attention'}. ${highRiskItems.length} stockout risks. ${profitability.lossMakingProductCount} unprofitable products. ${tenantInfo.lifecycleStage} stage business.`,
    topOpportunity,
    biggestRisk,
    cashFlowInsight,
    competitivePosition,
    industryBenchmarks,
  }
}

// ============================================================
// DATA FETCHING FUNCTIONS (Keep existing)
// ============================================================

async function getAssistantHistory(tenantId: string, conversationId?: string): Promise<AssistantTurn[]> {
  const rows = await prisma.enterpriseAiRecommendation.findMany({
    where: {
      tenantId,
      recommendationType: 'NL_ASSISTANT',
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      createdAt: true,
      outputPayload: true,
    },
  })

  const parsed = rows
    .map((row) => {
      const payload = row.outputPayload as {
        prompt?: string
        response?: string
        conversationId?: string
      } | null
      if (!payload?.prompt || !payload?.response) return null
      return {
        prompt: payload.prompt,
        response: payload.response,
        conversationId: payload.conversationId,
        createdAt: row.createdAt.toISOString(),
      }
    })
    .filter((row): row is { prompt: string; response: string; conversationId: string | undefined; createdAt: string } => row !== null)

  const scoped = conversationId
    ? parsed.filter((row) => row.conversationId === conversationId)
    : parsed

  return scoped.slice(0, 4).reverse().map((row) => ({
    prompt: row.prompt,
    response: row.response,
    createdAt: row.createdAt,
  }))
}

async function getBranchComparisons(tenantId: string, currentStart: Date, priorStart: Date): Promise<BranchComparison[]> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } })
  const baseCurrency = normalizeCurrencyCode(tenant?.baseCurrency) || 'USD'
  const rateCache = new Map<string, number | null>()

  const [branches, salesCurrentRows, salesPriorRows, expenseCurrentRows, expensePriorRows] = await Promise.all([
    prisma.subsidiary.findMany({
      where: { tenantId, archived: false },
      select: { id: true, name: true },
    }),
    prisma.sale.findMany({
      where: { tenantId, archived: false, createdAt: { gte: currentStart } },
      select: { subsidiaryId: true, totalAmount: true, currency: true, fxRate: true },
    }),
    prisma.sale.findMany({
      where: { tenantId, archived: false, createdAt: { gte: priorStart, lt: currentStart } },
      select: { subsidiaryId: true, totalAmount: true, currency: true, fxRate: true },
    }),
    prisma.expense.findMany({
      where: { tenantId, archived: false, date: { gte: currentStart } },
      select: { subsidiaryId: true, amount: true, currency: true, fxRate: true },
    }),
    prisma.expense.findMany({
      where: { tenantId, archived: false, date: { gte: priorStart, lt: currentStart } },
      select: { subsidiaryId: true, amount: true, currency: true, fxRate: true },
    }),
  ])

  const toBranchSums = async (
    rows: Array<{ subsidiaryId: string | null; totalAmount?: unknown; amount?: unknown; currency: string; fxRate: unknown }>,
  ): Promise<Map<string, number>> => {
    const map = new Map<string, number>()
    for (const row of rows) {
      if (!row.subsidiaryId) continue
      const raw = row.totalAmount ?? row.amount ?? 0
      const converted = await toBaseAmount(tenantId, raw, row.currency, row.fxRate, baseCurrency, rateCache)
      map.set(row.subsidiaryId, (map.get(row.subsidiaryId) || 0) + converted)
    }
    return map
  }

  const [salesCurrent, salesPrior, expenseCurrent, expensePrior] = await Promise.all([
    toBranchSums(salesCurrentRows),
    toBranchSums(salesPriorRows),
    toBranchSums(expenseCurrentRows),
    toBranchSums(expensePriorRows),
  ])

  const branchMap = new Map(branches.map((b) => [b.id, b.name]))
  const allIds = new Set<string>([
    ...Array.from(salesCurrent.keys()),
    ...Array.from(salesPrior.keys()),
    ...Array.from(expenseCurrent.keys()),
    ...Array.from(expensePrior.keys()),
  ])

  const comparisons: BranchComparison[] = []
  for (const subsidiaryId of allIds) {
    const currentRevenue = toNumber(salesCurrent.get(subsidiaryId) || 0)
    const priorRevenue = toNumber(salesPrior.get(subsidiaryId) || 0)
    const currentExpense = toNumber(expenseCurrent.get(subsidiaryId) || 0)
    const priorExpense = toNumber(expensePrior.get(subsidiaryId) || 0)
    const currentMargin = currentRevenue - currentExpense
    const priorMargin = priorRevenue - priorExpense
    const grossMarginPct = currentRevenue > 0 ? ((currentRevenue - currentExpense) / currentRevenue) * 100 : 0
    const efficiencyScore = currentMargin / Math.max(1, currentRevenue) * 100

    comparisons.push({
      subsidiaryId,
      branchName: branchMap.get(subsidiaryId) || subsidiaryId,
      currentRevenue: round2(currentRevenue),
      priorRevenue: round2(priorRevenue),
      revenueDeltaPct: round2(pctDelta(currentRevenue, priorRevenue)),
      currentExpense: round2(currentExpense),
      priorExpense: round2(priorExpense),
      expenseDeltaPct: round2(pctDelta(currentExpense, priorExpense)),
      currentMargin: round2(currentMargin),
      priorMargin: round2(priorMargin),
      marginDeltaPct: round2(pctDelta(currentMargin, priorMargin)),
      grossMarginPct: round2(grossMarginPct),
      contributionMargin: round2(currentMargin / Math.max(1, currentRevenue) * 100),
      efficiencyScore: round2(efficiencyScore),
      rank: 0,
    })
  }

  const sortedByEfficiency = [...comparisons].sort((a, b) => b.efficiencyScore - a.efficiencyScore)
  sortedByEfficiency.forEach((branch, idx) => { branch.rank = idx + 1 })

  return sortedByEfficiency
}

function getBranchAttributedSnapshot(branchComparisons: BranchComparison[]): {
  revenueCurrent: number
  revenuePrior: number
  expenseCurrent: number
  expensePrior: number
  marginCurrent: number
  marginPrior: number
  marginPctCurrent: number
  marginPctPrior: number
  revenueDeltaPct: number
} {
  const revenueCurrent = round2(branchComparisons.reduce((sum, b) => sum + toNumber(b.currentRevenue), 0))
  const revenuePrior = round2(branchComparisons.reduce((sum, b) => sum + toNumber(b.priorRevenue), 0))
  const expenseCurrent = round2(branchComparisons.reduce((sum, b) => sum + toNumber(b.currentExpense), 0))
  const expensePrior = round2(branchComparisons.reduce((sum, b) => sum + toNumber(b.priorExpense), 0))
  const marginCurrent = round2(revenueCurrent - expenseCurrent)
  const marginPrior = round2(revenuePrior - expensePrior)
  const marginPctCurrent = round2(revenueCurrent > 0 ? (marginCurrent / revenueCurrent) * 100 : 0)
  const marginPctPrior = round2(revenuePrior > 0 ? (marginPrior / revenuePrior) * 100 : 0)
  const revenueDeltaPct = round2(pctDelta(revenueCurrent, revenuePrior))

  return {
    revenueCurrent,
    revenuePrior,
    expenseCurrent,
    expensePrior,
    marginCurrent,
    marginPrior,
    marginPctCurrent,
    marginPctPrior,
    revenueDeltaPct,
  }
}

// ============================================================
// MARKET CONTEXT
// ============================================================

async function getMarketContextForTenant(tenantId: string): Promise<string | null> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { country: true, state: true, name: true },
    })

    if (!tenant?.country) return null

    return `
## Location Context
- Country: ${tenant.country}
- Region: ${tenant.state || 'Not specified'}
- Business: ${tenant.name || 'Business'}
    `.trim()
  } catch (error) {
    return null
  }
}

// ============================================================
// PROMPT BUILDING (WITH TENANT NAME)
// ============================================================

function buildSystemPrompt(tenantName?: string, baseCurrency?: string, previousResponseCurrency?: string | null): string {
  const businessIdentifier = tenantName ? ` for ${tenantName}` : ''
  const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || 'USD'
  const normalizedPreviousCurrency = normalizeCurrencyCode(previousResponseCurrency)
  const recheckCurrencyDirective = normalizedPreviousCurrency && normalizedPreviousCurrency !== normalizedBaseCurrency
    ? `For rechecks where previous responses used ${normalizedPreviousCurrency}, present money in ${normalizedBaseCurrency} and include previous-currency value in brackets, e.g. ${normalizedBaseCurrency} 100 (${normalizedPreviousCurrency} 70). Use only tenant saved exchange rates for any conversion; never infer or use live/market rates.`
    : `Present all monetary values strictly in ${normalizedBaseCurrency}. Use only tenant saved exchange rates for any conversion; never infer or use live/market rates.`
  
  return [
    `You are an advanced enterprise business intelligence AI assistant${businessIdentifier}.`,
    `You are analyzing data for ${tenantName || 'this business'}.`,
    'Provide actionable insights across sales, profitability, inventory, expenses, and operations.',
    `${tenantName ? `IMPORTANT: Refer to this business by its name "${tenantName}" in your responses.` : 'Refer to the business by its name in your responses.'}`,
    'Use the provided tenant data and market context.',
    'Be specific with numbers, percentages, and concrete recommendations.',
    'Prioritize recommendations as P1 (urgent), P2 (important), or P3 (monitor).',
    'Return strict JSON only with keys: summary (string), comparativeInsights (string[]), actions (string[]), risks (string[]), followUpQuestions (string[]).',
    'For restock questions, ALWAYS include specific product names, quantities, and P1/P2/P3 priorities.',
    'Include category information when available.',
    recheckCurrencyDirective,
    `IMPORTANT: Always refer to the business by its actual name "${tenantName}" in your responses.`,
    'Do not include markdown or code fences.',
  ].join(' ')
}

async function buildUserPrompt(
  question: string,
  grounding: AssistantGrounding,
  currencyContext?: { previousResponseCurrency: string | null; currentToPreviousRate: number | null }
): Promise<string> {
  const intent = detectPromptIntent(question)
  const marketContext = await getMarketContextForTenant(grounding.tenantId)
  const branchPriorities = getBranchPerformancePriorities(grounding.branchComparisons)
  const branchSnapshot = getBranchAttributedSnapshot(grounding.branchComparisons)

  const nonBranchIncomeLine = shouldShowSubscriptionStream(grounding.incomeBreakdown)
    ? `Income Streams (30d): Total ${formatCurrency(grounding.incomeBreakdown.totalIncome)} | Sales ${formatCurrency(grounding.incomeBreakdown.salesIncome)} (${grounding.incomeBreakdown.streamMix.salesPct.toFixed(1)}%) | Subscription ${formatCurrency(grounding.incomeBreakdown.subscriptionIncome)} (${grounding.incomeBreakdown.streamMix.subscriptionPct.toFixed(1)}%)`
    : `Income Streams (30d): Total ${formatCurrency(grounding.incomeBreakdown.totalIncome)} | Sales ${formatCurrency(grounding.incomeBreakdown.salesIncome)} (100.0%)`

  const incomeStreamsLine = intent === 'BRANCH'
    ? `Income Streams (30d, branch-attributed): Total ${formatCurrency(branchSnapshot.revenueCurrent)} | Sales ${formatCurrency(branchSnapshot.revenueCurrent)} (100.0%)`
    : nonBranchIncomeLine
  
  // Build tenant context section
  const tenantContext = [
    '=== BUSINESS PROFILE ===',
    `Business Name: ${grounding.tenantInfo.name}`,
    `Base Currency: ${grounding.tenantInfo.baseCurrency}`,
    incomeStreamsLine,
    `Business Type: ${grounding.tenantInfo.businessType}`,
    `Lifecycle Stage: ${grounding.tenantInfo.lifecycleStage}`,
    `Location: ${grounding.tenantInfo.country || 'Not specified'}${grounding.tenantInfo.state ? `, ${grounding.tenantInfo.state}` : ''}`,
    `Branches: ${grounding.tenantInfo.activeBranchCount} active ${grounding.tenantInfo.hasMultipleBranches ? 'branches' : 'branch'}`,
    grounding.tenantInfo.estimatedMonthlyRunway ? `Estimated Runway: ${grounding.tenantInfo.estimatedMonthlyRunway.toFixed(1)} months` : '',
    '',
  ].join('\n')

  const sections = [
    tenantContext,
    '=== CURRENCY POLICY ===',
    `Use ${grounding.tenantInfo.baseCurrency} for all monetary values in your response.`,
    'For conversions, use tenant saved exchange rates only. If no saved rate is available, state that conversion is unavailable rather than estimating.',
    currencyContext?.previousResponseCurrency && currencyContext.previousResponseCurrency !== grounding.tenantInfo.baseCurrency
      ? `Previous response currency: ${currencyContext.previousResponseCurrency}. Include the previous-currency amount in brackets after each critical money figure.`
      : '',
    currencyContext?.previousResponseCurrency && currencyContext.previousResponseCurrency !== grounding.tenantInfo.baseCurrency && currencyContext.currentToPreviousRate
      ? `Reference conversion (current to previous): 1 ${grounding.tenantInfo.baseCurrency} ~= ${currencyContext.currentToPreviousRate.toFixed(4)} ${currencyContext.previousResponseCurrency}.`
      : '',
    '',
    `Business question: ${question}`,
    `Analysis window: ${grounding.periodLabel}`,
    '',
    '=== FINANCIAL SUMMARY ===',
    `Revenue: ${formatCurrency(intent === 'BRANCH' ? branchSnapshot.revenueCurrent : grounding.current.revenue)} (${formatPercent(intent === 'BRANCH' ? branchSnapshot.revenueDeltaPct : grounding.deltas.revenuePct)} vs prior)`,
    `Profit: ${formatCurrency(intent === 'BRANCH' ? branchSnapshot.marginCurrent : grounding.current.profit)} (${formatPercent(intent === 'BRANCH' ? pctDelta(branchSnapshot.marginCurrent, branchSnapshot.marginPrior) : grounding.deltas.profitPct)} vs prior)`,
    `Margin: ${(intent === 'BRANCH' ? branchSnapshot.marginPctCurrent : grounding.current.margin).toFixed(1)}% (${formatPercent(intent === 'BRANCH' ? pctDelta(branchSnapshot.marginPctCurrent, branchSnapshot.marginPctPrior) : grounding.deltas.marginPct)} vs prior)`,
    `Expense Ratio: ${(intent === 'BRANCH' ? (branchSnapshot.revenueCurrent > 0 ? (branchSnapshot.expenseCurrent / branchSnapshot.revenueCurrent) * 100 : 0) : grounding.expenseInsights.costToRevenueRatio).toFixed(1)}% of revenue`,
    `Break-Even Revenue: ${formatCurrency(grounding.profitability.breakEvenRevenue)}`,
    '',
  ]

  if (intent === 'PROFITABILITY' || intent === 'GENERAL') {
    sections.push(
      '=== PROFITABILITY ANALYSIS ===',
      `Gross Profit: ${formatCurrency(grounding.profitability.grossProfit)} (${grounding.profitability.grossMarginPct.toFixed(1)}% margin)`,
      `Net Profit: ${formatCurrency(grounding.profitability.netProfit)} (${grounding.profitability.netMarginPct.toFixed(1)}% margin)`,
      `Profitable products: ${grounding.profitability.profitableProductCount}`,
      `Loss-making products: ${grounding.profitability.lossMakingProductCount}`,
      `Top profitable products: ${JSON.stringify(grounding.profitability.topProfitableProducts.slice(0, 3))}`,
      `Top loss-making products: ${JSON.stringify(grounding.profitability.topLossMakingProducts.slice(0, 3))}`,
      `Top categories by profit: ${JSON.stringify(grounding.profitability.topCategoriesByProfit.slice(0, 3))}`,
      `Margin by category: ${JSON.stringify(grounding.profitability.avgMarginByCategory)}`,
      `Profit Drivers: ${JSON.stringify(grounding.profitability.profitDrivers.slice(0, 3))}`,
      `Profit Risks: ${JSON.stringify(grounding.profitability.profitRisks.slice(0, 3))}`,
      `Profit Margin Forecast: ${grounding.profitability.profitMarginForecast.next30Days.toFixed(1)}% in 30 days (${(grounding.profitability.profitMarginForecast.confidence * 100).toFixed(0)}% confidence)`,
      '',
    )
  }

  if (intent === 'SALES' || intent === 'GENERAL') {
    sections.push(
      '=== SALES INSIGHTS ===',
      `Total sales: ${formatCurrency(grounding.salesInsights.totalSales)}`,
      `Transactions: ${grounding.salesInsights.transactionCount}`,
      `Average order value: ${formatCurrency(grounding.salesInsights.avgOrderValue)}`,
      `Sales trend: ${grounding.salesInsights.salesTrend} (strength: ${(grounding.salesInsights.trendStrength * 100).toFixed(0)}%)`,
      `Forecast next 7 days: ${formatCurrency(grounding.salesInsights.salesForecast.next7Days)}`,
      `Forecast next 30 days: ${formatCurrency(grounding.salesInsights.salesForecast.next30Days)} (range: ${formatCurrency(grounding.salesInsights.salesForecast.lowerBound)} - ${formatCurrency(grounding.salesInsights.salesForecast.upperBound)})`,
      `Forecast confidence: ${(grounding.salesInsights.salesForecast.confidence * 100).toFixed(0)}%`,
      `Top selling products: ${JSON.stringify(grounding.salesInsights.topSellingProducts.slice(0, 5))}`,
      `Top selling categories: ${JSON.stringify(grounding.salesInsights.topSellingCategories.slice(0, 3))}`,
      `Slow moving products: ${JSON.stringify(grounding.salesInsights.slowMovingProducts.slice(0, 3).map((product) => ({
        name: product.name,
        category: product.category,
        unitsSold: product.unitsSold,
        daysOnShelf: product.daysOnShelf,
        stockValue: product.stockValue,
        originalPurchaseDate: product.originalPurchaseDate,
        originalUnitCost: product.originalUnitCost,
        provenanceEstimated: product.provenanceEstimated,
      })))}`,
      `Sales anomalies detected: ${grounding.salesInsights.anomalies.length}`,
      '',
    )
  }

  if (intent === 'EXPENSES' || intent === 'GENERAL') {
    sections.push(
      '=== EXPENSE INSIGHTS ===',
      `Total expenses: ${formatCurrency(grounding.expenseInsights.totalExpenses)}`,
      `Expense growth: ${formatPercent(grounding.expenseInsights.expenseGrowthRate)} vs prior period`,
      `Expense efficiency score: ${grounding.expenseInsights.expenseEfficiencyScore.toFixed(0)}/100`,
      `Top expense categories: ${JSON.stringify(grounding.expenseInsights.topExpenseCategories.slice(0, 3))}`,
      `Unusual expenses: ${JSON.stringify(grounding.expenseInsights.unusualExpenses.slice(0, 3))}`,
      `Recommended savings: ${JSON.stringify(grounding.expenseInsights.recommendedSavings.slice(0, 2))}`,
      `Expense forecast next 30 days: ${formatCurrency(grounding.expenseInsights.expenseForecast.next30Days)}`,
      '',
    )
  }

  if (intent === 'RESTOCK' || intent === 'GENERAL') {
    sections.push(
      '=== INVENTORY RISK ===',
      `Stockout risks: ${grounding.inventoryRiskItems.filter(i => i.urgency === 'P1').length} P1 (critical), ${grounding.inventoryRiskItems.filter(i => i.urgency === 'P2').length} P2 (important)`,
      `Inventory value: ${formatCurrency(grounding.businessIntelligence?.inventoryHealth?.totalStockValue || 0)}`,
      `Cash tied in inventory: ${formatCurrency(grounding.businessIntelligence?.inventoryHealth?.cashTiedInInventory || 0)}`,
      `Inventory turnover: ${grounding.businessIntelligence?.inventoryHealth?.inventoryTurnover?.toFixed(1) || 'N/A'}x`,
      `Days of inventory: ${grounding.businessIntelligence?.inventoryHealth?.daysOfInventory?.toFixed(0) || 'N/A'} days`,
      `Risk items: ${JSON.stringify(grounding.inventoryRiskItems.slice(0, 5).map(i => ({ 
        name: i.productName, 
        category: i.category,
        stock: i.currentStock, 
        threshold: i.lowStockThreshold, 
        daysLeft: i.daysToStockout, 
        reorderQty: i.suggestedReorderQty, 
        priority: i.urgency,
        eoq: i.economicOrderQty,
        stockoutProbability: `${(i.stockoutProbability * 100).toFixed(0)}%`,
        recommendedAction: i.recommendedAction,
        currentUnitCost: i.costPrice,
        originalUnitCost: i.originalUnitCost,
        originalPurchaseDate: i.originalPurchaseDate,
        provenanceEstimated: i.provenanceEstimated,
      })))}`,
      '',
    )
  }

  if (intent === 'CASHFLOW' || intent === 'GENERAL') {
    sections.push(
      '=== CASH FLOW INSIGHT ===',
      `Monthly Burn Rate: ${formatCurrency(grounding.businessIntelligence.cashFlowInsight.burnRate)}`,
      grounding.businessIntelligence.cashFlowInsight.currentRunway ? `Estimated Runway: ${grounding.businessIntelligence.cashFlowInsight.currentRunway.toFixed(1)} months` : 'Runway: Insufficient data',
      `Recommended Action: ${grounding.businessIntelligence.cashFlowInsight.recommendedAction}`,
      '',
    )
  }

  sections.push(
    '=== BRANCH PERFORMANCE ===',
    `Top branches: ${JSON.stringify(grounding.branchComparisons.slice(0, 3).map(b => ({ 
      name: b.branchName, 
      revenue: b.currentRevenue, 
      margin: b.grossMarginPct,
      revenueChange: b.revenueDeltaPct,
      marginChange: b.marginDeltaPct,
      efficiencyScore: b.efficiencyScore,
      rank: b.rank
    })))}`,
    '',
    '=== BRANCH PRIORITIES ===',
    branchPriorities.length > 0 
      ? JSON.stringify(branchPriorities.slice(0, 5))
      : 'No critical branch issues detected',
    '',
    '=== PRODUCT PERFORMANCE ===',
    `Product ranking: ${JSON.stringify(grounding.productComparisons.slice(0, 5).map(p => ({ 
      name: p.productName, 
      category: p.category,
      revenue: p.currentRevenue, 
      profit: p.currentProfit, 
      margin: p.marginPct, 
      profitable: p.isProfitable,
      inventoryTurnover: p.inventoryTurnover,
      daysOfInventory: p.daysOfInventory,
      lifecycleStage: p.lifecycleStage,
      velocityScore: p.velocityScore
    })))}`,
    '',
    '=== BUSINESS INTELLIGENCE RECOMMENDATIONS ===',
    `Priority actions: ${JSON.stringify(grounding.businessIntelligence.recommendations.slice(0, 3))}`,
    `Health Score: ${grounding.businessIntelligence.inventoryHealth.healthScore.toFixed(0)}/100`,
    `Top Opportunity: ${grounding.businessIntelligence.topOpportunity}`,
    `Biggest Risk: ${grounding.businessIntelligence.biggestRisk}`,
    `Competitive Position: ${grounding.businessIntelligence.competitivePosition.pricePositioning} market`,
  )

  if (marketContext) {
    sections.splice(2, 0, marketContext)
  }

  return sections.join('\n')
}

// ============================================================
// ENHANCED LLM PROVIDER (Keep existing)
// ============================================================

type LlmProviderV2 = 'anthropic' | 'openai' | 'google'

type LlmConfigV2 = {
  provider: LlmProviderV2
  apiKey: string
  model: string
  timeoutMs: number
  maxRetries: number
  enableWebSearch: boolean
  temperature: number
}

type LlmQueryResultV2 = {
  content: string
  provider: LlmProviderV2
  model: string
  attempts: number
  latencyMs: number
  usedWebSearch: boolean
}

function getLlmConfigV2(useCase: 'business' | 'market' | 'routine'): LlmConfigV2 | null {
  const googleKey = process.env.GOOGLE_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  // PRIORITY 1: Google Gemini
  if (googleKey && googleKey.length > 20 && googleKey !== 'AIzaSy***') {
    let model = 'gemini-2.5-flash'
    let temperature = 0.2
    
    if (useCase === 'business') {
      model = process.env.ENTERPRISE_AI_LLM_MODEL_BUSINESS || 'gemini-2.5-flash'
      temperature = 0.2
    } else if (useCase === 'market') {
      model = process.env.ENTERPRISE_AI_LLM_MODEL_MARKET || 'gemini-2.5-flash'
      temperature = 0.3
    } else {
      model = process.env.ENTERPRISE_AI_LLM_MODEL_ROUTINE || 'gemini-2.5-flash'
      temperature = 0.1
    }
    
    console.log(`[LLM Config] ✅ Using Google with model: ${model}`)
    return {
      provider: 'google',
      apiKey: googleKey,
      model: model,
      timeoutMs: Number(process.env.ENTERPRISE_AI_LLM_TIMEOUT_MS) || 30000,
      maxRetries: Number(process.env.ENTERPRISE_AI_LLM_MAX_RETRIES) || 2,
      enableWebSearch: false,
      temperature: temperature,
    }
  }

  // PRIORITY 2: OpenAI (fallback)
  if (openaiKey && openaiKey.length > 20 && openaiKey !== 'sk-proj-***') {
    const model = process.env.ENTERPRISE_AI_LLM_MODEL_ROUTINE || 'gpt-4o-mini'
    console.log(`[LLM Config] ⚠️ Using OpenAI fallback with model: ${model}`)
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: model,
      timeoutMs: Number(process.env.ENTERPRISE_AI_LLM_TIMEOUT_MS) || 30000,
      maxRetries: Number(process.env.ENTERPRISE_AI_LLM_MAX_RETRIES) || 2,
      enableWebSearch: false,
      temperature: 0.1,
    }
  }

  console.log(`[LLM Config] ❌ No valid API keys found!`)
  return null
}

async function queryGoogle(config: LlmConfigV2, systemPrompt: string, userPrompt: string): Promise<LlmQueryResultV2 | null> {
  const startTime = Date.now()
  
  const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.apiKey}`

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const requestBody = {
        contents: [{ parts: [{ text: combinedPrompt }] }],
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: 8192,
        },
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (response.status === 429 || response.status === 503) {
        const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 15000)
        console.log(`[Google] ${response.status} error. Waiting ${waitTime}ms before retry ${attempt}/${config.maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Google API error (attempt ${attempt}): ${response.status}`)
        continue
      }

      const data = await response.json() as any
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      
      if (!content) {
        console.error('[Google] No content in response')
        continue
      }

      console.log(`[Google] Success! Response length: ${content.length} chars`)
      
      return {
        content: content.slice(0, 12000),
        provider: 'google',
        model: config.model,
        attempts: attempt,
        latencyMs: Date.now() - startTime,
        usedWebSearch: false,
      }
    } catch (error) {
      console.error(`Google attempt ${attempt} error:`, error)
    } finally {
      clearTimeout(timeout)
    }
  }
  
  return null
}

async function queryOpenAI(config: LlmConfigV2, systemPrompt: string, userPrompt: string): Promise<LlmQueryResultV2 | null> {
  const startTime = Date.now()
  const endpoint = 'https://api.openai.com/v1/chat/completions'

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const body: any = {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: config.temperature,
        max_tokens: 8192,
      }

      if (config.enableWebSearch) {
        body.tools = [{ type: 'web_search_preview', search_context_size: 'medium' }]
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`OpenAI API error (attempt ${attempt}): ${response.status}`)
        continue
      }

      const data = await response.json() as any
      const content = data.choices?.[0]?.message?.content || ''
      if (!content) continue

      return {
        content: content.slice(0, 12000),
        provider: 'openai',
        model: config.model,
        attempts: attempt,
        latencyMs: Date.now() - startTime,
        usedWebSearch: !!(data.choices?.[0]?.message?.tool_calls?.length),
      }
    } catch (error) {
      console.error(`OpenAI attempt ${attempt} error:`, error)
    } finally {
      clearTimeout(timeout)
    }
  }
  return null
}

async function queryEnhancedLLM(
  systemPrompt: string,
  userPrompt: string,
  useCase: 'business' | 'market' | 'routine' = 'business'
): Promise<LlmQueryResultV2 | null> {
  if (Date.now() < llmCooldownUntil) {
    return null
  }

  const config = getLlmConfigV2(useCase)
  if (!config) {
    return null
  }

  let result: LlmQueryResultV2 | null = null

  switch (config.provider) {
    case 'google':
      result = await queryGoogle(config, systemPrompt, userPrompt)
      break
    case 'openai':
      result = await queryOpenAI(config, systemPrompt, userPrompt)
      break
    default:
      console.error(`[LLM] Unknown provider: ${config.provider}`)
      return null
  }

  if (!result) {
    llmConsecutiveFailures++
    if (llmConsecutiveFailures >= 3) {
      llmCooldownUntil = Date.now() + 2 * 60 * 1000
      console.log('[LLM] Circuit breaker activated for 2 minutes')
    }
  } else {
    llmConsecutiveFailures = 0
    llmCooldownUntil = 0
  }

  return result
}

// ============================================================
// RESPONSE PARSING & FORMATTING
// ============================================================

function computeGroundingQualityScore(grounding: { coverageScore: number; freshnessHours: number | null }): number {
  const freshness = grounding.freshnessHours
  const freshnessFactor = freshness === null ? 0.7
    : freshness <= 12 ? 1
    : freshness <= 24 ? 0.92
    : freshness <= 72 ? 0.78
    : 0.58

  return round2(clamp(grounding.coverageScore * 0.65 + freshnessFactor * 0.35, 0.25, 0.98))
}

function deriveConfidenceLevel(args: {
  groundingQualityScore: number
  coverageScore: number
  usedFallback: boolean
}): AssistantReliability['confidenceLevel'] {
  const baseline = args.groundingQualityScore * 0.7 + args.coverageScore * 0.3
  const adjusted = args.usedFallback ? baseline - 0.1 : baseline
  if (adjusted >= 0.8) return 'high'
  if (adjusted >= 0.6) return 'medium'
  return 'low'
}

function sanitizeBrief(input: unknown): AssistantBrief | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
  const comparativeInsights = Array.isArray(obj.comparativeInsights)
    ? obj.comparativeInsights.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : []
  const actions = Array.isArray(obj.actions)
    ? obj.actions.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : []
  const risks = Array.isArray(obj.risks)
    ? obj.risks.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : []
  const followUpQuestions = Array.isArray(obj.followUpQuestions)
    ? obj.followUpQuestions.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : []
  const requiresApproval = typeof obj.requiresApproval === 'boolean' ? obj.requiresApproval : undefined
  const estimatedCost = typeof obj.estimatedCost === 'number' && Number.isFinite(obj.estimatedCost)
    ? round2(Math.max(0, obj.estimatedCost))
    : undefined

  if (!summary || comparativeInsights.length === 0 || actions.length === 0) return null
  return { summary, comparativeInsights, actions, risks, followUpQuestions, requiresApproval, estimatedCost }
}

function tryParseJsonBrief(raw: string): AssistantBrief | null {
  const text = raw.trim()
  try {
    return sanitizeBrief(JSON.parse(text))
  } catch {
    const fenced = text.match(/\{[\s\S]*\}/)
    if (!fenced) return null
    try {
      return sanitizeBrief(JSON.parse(fenced[0]))
    } catch {
      return null
    }
  }
}

function formatBriefAsText(brief: AssistantBrief, tenantName?: string): string {
  const header = tenantName ? `📊 ${tenantName.toUpperCase()} - ADVANCED BUSINESS INTELLIGENCE` : '📊 ADVANCED BUSINESS INTELLIGENCE'
  
  const lines = [
    header,
    '═'.repeat(60),
    '',
    '📋 EXECUTIVE SUMMARY',
    '─'.repeat(40),
    brief.summary,
  ]
  
  if (brief.alerts && brief.alerts.length > 0) {
    lines.push('', '🚨 CRITICAL ALERTS', '─'.repeat(40))
    for (const alert of brief.alerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵'
      lines.push(`${icon} ${alert.message}`)
      lines.push(`   → Action: ${alert.actionRequired}`)
    }
  }

  if (brief.businessGuidance) {
    lines.push(
      '',
      '🧭 BUSINESS GUIDANCE',
      '─'.repeat(40),
      `Mode: ${brief.businessGuidance.confidenceLabel}`,
      `Audience: ${brief.businessGuidance.audience}`,
      `Primary Recommendation: ${brief.businessGuidance.primaryRecommendation}`,
      `Why: ${brief.businessGuidance.why}`,
      `Expected Impact: ${brief.businessGuidance.expectedImpact}`,
      `Next Review: ${brief.businessGuidance.nextReview}`,
    )
  }
  
  lines.push(
    '',
    '🔍 KEY INSIGHTS',
    '─'.repeat(40),
    ...brief.comparativeInsights.map((item) => `• ${item}`),
  )
  
  if (brief.predictions && brief.predictions.length > 0) {
    lines.push('', '🔮 PREDICTIONS & FORECASTS', '─'.repeat(40))
    for (const pred of brief.predictions) {
      lines.push(`• ${pred.metric}: ${formatCurrency(pred.currentValue)} → ${formatCurrency(pred.predictedValue)} in ${pred.timeframe} (${(pred.confidence * 100).toFixed(0)}% confidence)`)
    }
  }
  
  lines.push(
    '',
    '✅ RECOMMENDED ACTIONS',
    '─'.repeat(40),
    ...brief.actions.map((item) => `• ${item}`),
  )

  if (brief.quickWins && brief.quickWins.length > 0) {
    lines.push('', '⚡ QUICK WINS (24-48 hours)', '─'.repeat(40), ...brief.quickWins.map((item) => `• ${item}`))
  }

  if (brief.risks.length > 0) {
    lines.push('', '⚠️ RISKS TO MONITOR', '─'.repeat(40), ...brief.risks.map((item) => `• ${item}`))
  }

  if (brief.factBasis && brief.factBasis.length > 0) {
    lines.push('', '🧾 FACT BASIS', '─'.repeat(40), ...brief.factBasis.map((item) => `• ${item}`))
  }

  if (brief.groundingNotes && brief.groundingNotes.length > 0) {
    lines.push('', '🔐 GROUNDING NOTES', '─'.repeat(40), ...brief.groundingNotes.map((item) => `• ${item}`))
  }

  if (brief.followUpQuestions.length > 0) {
    lines.push('', '❓ FOLLOW-UP QUESTIONS', '─'.repeat(40), ...brief.followUpQuestions.map((item) => `• ${item}`))
  }

  if (brief.financialMetrics) {
    lines.push(
      '',
      '📈 FINANCIAL SNAPSHOT',
      '─'.repeat(40),
      `Revenue: ${formatCurrency(brief.financialMetrics.revenue)}`,
      `Profit: ${formatCurrency(brief.financialMetrics.profit)}`,
      `Margin: ${brief.financialMetrics.margin.toFixed(1)}%`,
      `Expense Ratio: ${brief.financialMetrics.expenseRatio.toFixed(1)}%`,
      `Inventory Turnover: ${brief.financialMetrics.inventoryTurnover.toFixed(1)}x`,
      brief.financialMetrics.cashRunway ? `Cash Runway: ${brief.financialMetrics.cashRunway.toFixed(1)} months` : '',
    )
  }

  if (brief.requiresApproval !== undefined || brief.estimatedCost !== undefined) {
    lines.push('', '🧾 EXECUTION GOVERNANCE', '─'.repeat(40))
    if (brief.requiresApproval !== undefined) {
      lines.push(`Requires Approval: ${brief.requiresApproval ? 'Yes' : 'No'}`)
    }
    if (brief.estimatedCost !== undefined) {
      lines.push(`Estimated Cost: ${formatCurrency(brief.estimatedCost)}`)
    }
  }

  return lines.join('\n')
}

// ============================================================
// ENHANCED DETERMINISTIC FALLBACK (Advanced)
// ============================================================

// Cache for previous recommendations
const previousStateCache = new Map<string, {
  timestamp: Date
  healthScore: number
  inventoryRiskCount: number
  lossMakingCount: number
  salesTrend: string
}>()

function getPreviousState(tenantId: string): {
  healthScore: number | null
  inventoryRiskCount: number | null
  lossMakingCount: number | null
  salesTrend: string | null
  hoursSince: number | null
} {
  const previous = previousStateCache.get(tenantId)
  if (!previous) {
    return { healthScore: null, inventoryRiskCount: null, lossMakingCount: null, salesTrend: null, hoursSince: null }
  }
  const hoursSince = (Date.now() - previous.timestamp.getTime()) / (1000 * 60 * 60)
  return {
    healthScore: previous.healthScore,
    inventoryRiskCount: previous.inventoryRiskCount,
    lossMakingCount: previous.lossMakingCount,
    salesTrend: previous.salesTrend,
    hoursSince,
  }
}

function storeCurrentState(tenantId: string, grounding: AssistantGrounding): void {
  previousStateCache.set(tenantId, {
    timestamp: new Date(),
    healthScore: grounding.businessIntelligence?.inventoryHealth?.healthScore || 50,
    inventoryRiskCount: grounding.inventoryRiskItems.length,
    lossMakingCount: grounding.profitability.lossMakingProductCount,
    salesTrend: grounding.salesInsights.salesTrend,
  })
  
  // Limit cache size
  if (previousStateCache.size > 100) {
    const oldestKey = previousStateCache.keys().next().value
    if (oldestKey) {
      previousStateCache.delete(oldestKey)
    }
  }
}

async function buildDeterministicBrief(question: string, grounding: AssistantGrounding): Promise<AssistantBrief> {
  const intent = detectPromptIntent(question)
  const lowerQuestion = question.toLowerCase()
  const tenantName = grounding.tenantInfo.name
  const businessType = grounding.tenantInfo.businessType
  const lifecycleStage = grounding.tenantInfo.lifecycleStage
  
  // ===== DETECT RECHECK/FOLLOW-UP REQUESTS =====
  const isRecheckRequest = lowerQuestion.includes('recheck') || 
                           lowerQuestion.includes('follow-up') || 
                           lowerQuestion.includes('previous') ||
                           lowerQuestion.includes('update on') ||
                           lowerQuestion.includes('status check') ||
                           lowerQuestion.includes('reassess') ||
                           lowerQuestion.includes('original prompt')
  
  // Extract previous action from the question (if present)
  let previousAction = ''
  let previousQuantity = 0
  let previousProductName = ''
  let previousRisks: string[] = []
  
  if (isRecheckRequest) {
    // Extract order details from the prompt
    const orderMatch = lowerQuestion.match(/order\s+(\d+)\s+units?\s+of\s+([a-z\s]+)/i)
    if (orderMatch) {
      previousQuantity = parseInt(orderMatch[1])
      previousProductName = orderMatch[2].trim()
      previousAction = `Order ${previousQuantity} units of ${previousProductName}`
    }
    
    // Look for previous risk indicators
    if (lowerQuestion.includes('inventory turnover at 0.0x')) {
      previousRisks.push('Inventory turnover at 0.0x - slow turnover')
    }
    if (lowerQuestion.includes('days of inventory: 1500')) {
      previousRisks.push('Days of inventory: 1500 days - excessive')
    }
    if (lowerQuestion.includes('no critical stockout risks')) {
      previousRisks.push('No critical stockout risks')
    }
    if (lowerQuestion.includes('unrecorded sales')) {
      previousRisks.push('Unrecorded sales may affect stockout calculations')
    }
  }
  
  // Get current state for comparison
  const currentP2Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P2')
  const currentP1Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')
  const currentTurnover = grounding.businessIntelligence?.inventoryHealth?.inventoryTurnover || 0
  const currentDaysOfInventory = grounding.businessIntelligence?.inventoryHealth?.daysOfInventory || 0
  const cashTied = grounding.businessIntelligence?.inventoryHealth?.cashTiedInInventory || 
                   grounding.businessIntelligence?.inventoryHealth?.totalStockValue || 0
  
  // Find the specific product if mentioned in previous action
  let targetProduct = null
  if (previousProductName) {
    targetProduct = grounding.inventoryRiskItems.find(i => 
      i.productName.toLowerCase().includes(previousProductName.toLowerCase()) || 
      previousProductName.toLowerCase().includes(i.productName.toLowerCase())
    )
  }
  
  // If no specific product found, use the first P2 item
  if (!targetProduct && currentP2Items.length > 0) {
    targetProduct = currentP2Items[0]
    if (targetProduct) {
      previousProductName = targetProduct.productName
      previousQuantity = targetProduct.suggestedReorderQty
    }
  }
  
  // ===== RECHECK REQUEST - FORMATTED RESPONSE =====
  if (isRecheckRequest) {
    // Determine what has improved
    const improvements: string[] = []
    const unresolved: string[] = []
    const worsened: string[] = []
    
    // Check stock status of target product
    if (targetProduct) {
      // Compare current stock with low stock threshold
      if (targetProduct.currentStock >= targetProduct.lowStockThreshold) {
        improvements.push(`Stock level for ${targetProduct.productName} is now ${targetProduct.currentStock} units (above ${targetProduct.lowStockThreshold} threshold)`)
      } else {
        unresolved.push(`Stock level for ${targetProduct.productName} is ${targetProduct.currentStock} units (still below ${targetProduct.lowStockThreshold} threshold) - order not yet placed`)
      }
      
      // Check days to stockout
      if (targetProduct.daysToStockout !== null) {
        if (targetProduct.daysToStockout > 14) {
          improvements.push(`${targetProduct.productName} has ${targetProduct.daysToStockout.toFixed(0)} days of stock remaining (improved)`)
        } else if (targetProduct.daysToStockout <= 7) {
          unresolved.push(`${targetProduct.productName} still needs reorder - only ${targetProduct.daysToStockout.toFixed(0)} days remaining`)
        }
      }
    } else if (previousProductName) {
      // Product not found in current inventory - might have been discontinued or sold out
      unresolved.push(`Previous recommendation for ${previousProductName} - product not found in current inventory`)
    }
    
    // Check inventory turnover improvement
    if (currentTurnover === 0 && previousRisks.some(r => r.includes('turnover'))) {
      unresolved.push(`Inventory turnover still at 0.0x - no improvement detected`)
    } else if (currentTurnover > 0.5) {
      improvements.push(`Inventory turnover improved to ${currentTurnover.toFixed(1)}x`)
    } else if (currentTurnover > 0) {
      improvements.push(`Inventory turnover is now ${currentTurnover.toFixed(1)}x (improving from 0.0x)`)
    }
    
    // Check days of inventory
    if (currentDaysOfInventory > 90) {
      unresolved.push(`Days of inventory still excessive at ${currentDaysOfInventory.toFixed(0)} days`)
    } else if (currentDaysOfInventory < 60 && currentDaysOfInventory > 0) {
      improvements.push(`Days of inventory reduced to ${currentDaysOfInventory.toFixed(0)} days`)
    }
    
    // Check if new P1 items emerged
    if (currentP1Items.length > 0) {
      worsened.push(`${currentP1Items.length} new CRITICAL (P1) stockout risks emerged: ${currentP1Items.map(i => i.productName).join(', ')}`)
    }
    
    // Check cash tied in inventory
    if (cashTied > 1000000) {
      unresolved.push(`Cash tied in inventory remains high at ${formatCurrency(cashTied)}`)
    }
    
    // Check if any P2 items were resolved
    if (targetProduct && targetProduct.urgency !== 'P2' && targetProduct.urgency !== 'P1') {
      improvements.push(`${targetProduct.productName} is no longer at risk (now ${targetProduct.urgency})`)
    }
    
    // Build the recheck summary with the 4-part structure
    const summary = `🔍 RECHECK RESULTS for ${tenantName}\n` +
      `═══════════════════════════════════════\n\n` +
      `📅 Comparison period: Previous recommendation vs current status\n\n` +
      `✅ WHAT HAS IMPROVED:\n${improvements.length > 0 ? improvements.map(i => `  • ${i}`).join('\n') : '  • No significant improvements detected'}\n\n` +
      `⚠️ WHAT IS STILL UNRESOLVED:\n${unresolved.length > 0 ? unresolved.map(i => `  • ${i}`).join('\n') : '  • All previous issues have been addressed'}\n\n` +
      `📉 WHAT GOT WORSE OR REMAINS HIGH RISK:\n${worsened.length > 0 ? worsened.map(i => `  • ${i}`).join('\n') : '  • No worsening detected'}\n\n` +
      `🎯 UPDATED PRIORITY ACTIONS (Next 7 Days):`
    
    const actions = []
    
    // Priority based on current risks
    for (const item of currentP1Items) {
      actions.push(`P1 - URGENT: Order ${item.suggestedReorderQty} units of ${item.productName} (stockout in ${item.daysToStockout?.toFixed(0) || 'unknown'} days)`)
    }
    
    if (targetProduct && targetProduct.currentStock <= targetProduct.lowStockThreshold) {
      actions.push(`P2 - Order ${targetProduct.suggestedReorderQty} units of ${targetProduct.productName} (still below ${targetProduct.lowStockThreshold} unit threshold)`)
    } else if (targetProduct && previousAction && !currentP1Items.includes(targetProduct as any)) {
      actions.push(`P3 - Monitor ${targetProduct.productName} - stock level is now adequate (${targetProduct.currentStock} units)`)
    }
    
    // Add general inventory recommendations
    if (currentTurnover < 0.5 && currentTurnover > 0) {
      actions.push(`P2 - Review slow-moving inventory: ${formatCurrency(cashTied)} tied up in stock (${currentDaysOfInventory.toFixed(0)} days of inventory)`)
    } else if (currentTurnover === 0) {
      actions.push(`P2 - Investigate inventory system - turnover rate is 0.0x, indicating no sales or data issue`)
    }
    
    // Add expense recommendation if expenses are growing
    if (grounding.expenseInsights.expenseGrowthRate > 15) {
      actions.push(`P2 - Audit ${grounding.expenseInsights.topExpenseCategories[0]?.category} expenses (grew ${grounding.expenseInsights.expenseGrowthRate.toFixed(0)}%)`)
    }
    
    // Add sales recommendation if sales are declining
    if (grounding.salesInsights.salesTrend === 'decreasing') {
      actions.push(`P2 - Address declining sales trend (${formatPercent(grounding.shortHorizonDeltas.revenuePct)} last 7 days)`)
    }
    
    if (actions.length === 0) {
      actions.push(`P3 - Continue monitoring - no urgent actions required`)
    }
    
    const risks = [
      targetProduct && targetProduct.currentStock <= targetProduct.lowStockThreshold ? `${targetProduct.productName} still below stock threshold (${targetProduct.currentStock}/${targetProduct.lowStockThreshold})` : 'No critical stockout risks',
      `Inventory turnover: ${currentTurnover.toFixed(1)}x - ${currentTurnover < 0.5 ? 'concerning, needs attention' : currentTurnover < 1 ? 'slow, monitor' : 'acceptable'}`,
      `Cash tied in inventory: ${formatCurrency(cashTied)}`,
      currentDaysOfInventory > 60 ? `Days of inventory: ${currentDaysOfInventory.toFixed(0)} days - excessive` : `Days of inventory: ${currentDaysOfInventory.toFixed(0)} days`,
    ]
    
    const followUpQuestions = [
      targetProduct ? `Has the purchase order for ${targetProduct.productName} been placed?` : 'Have the recommended purchase orders been placed?',
      currentTurnover === 0 ? 'Why is inventory turnover showing 0.0x? Are there sales not being recorded?' : 'What is preventing faster inventory turnover?',
      cashTied > 1000000 ? 'Should we consider a clearance sale for slow-moving items to free up cash?' : 'Are there opportunities to improve inventory efficiency?',
      'Would you like me to generate purchase orders for the P1/P2 items?',
    ]
    
    const quickWins = []
    if (currentP1Items.length > 0) {
      quickWins.push(`Place emergency order for ${currentP1Items[0].productName}`)
    } else if (targetProduct && targetProduct.currentStock <= targetProduct.lowStockThreshold) {
      quickWins.push(`Place order for ${targetProduct.productName} today`)
    }
    
    const brief: AssistantBrief = {
      summary,
      comparativeInsights: [], // Not needed for recheck format
      actions,
      risks,
      followUpQuestions,
      quickWins: quickWins.slice(0, 2),
      alerts: currentP1Items.length > 0 ? [{
        severity: 'critical',
        message: `${currentP1Items.length} new critical stockout risks detected`,
        actionRequired: 'Immediate reorder required'
      }] : (currentTurnover === 0 ? [{
        severity: 'critical',
        message: 'Inventory turnover rate is 0.0x - possible data issue',
        actionRequired: 'Verify sales data and inventory records'
      }] : []),
      financialMetrics: {
        revenue: grounding.current.revenue,
        profit: grounding.current.profit,
        margin: grounding.current.margin,
        expenseRatio: grounding.expenseInsights.costToRevenueRatio,
        inventoryTurnover: currentTurnover,
        cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
      }
    }
    
    storeCurrentState(grounding.tenantId, grounding)
    return brief
  }
  
  // ===== REGULAR RESTOCK INTENT (non-recheck) =====
  if (intent === 'RESTOCK' || lowerQuestion.includes('restock') || lowerQuestion.includes('inventory') || lowerQuestion.includes('stock')) {
    const p1Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')
    const p2Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P2')
    const p3Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P3')
    const actionableRiskItems = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1' || i.urgency === 'P2')
    
    let summary = ''
    let comparativeInsights: string[] = []
    let actions: string[] = []
    
    if (grounding.inventoryRiskItems.length === 0) {
      const turnover = grounding.businessIntelligence?.inventoryHealth?.inventoryTurnover || 0
      const daysOfInventory = grounding.businessIntelligence?.inventoryHealth?.daysOfInventory || 0
      summary = `✅ ${tenantName} - No immediate stockout risks. Inventory health: ${turnover.toFixed(1)}x turnover (${daysOfInventory.toFixed(0)} days of inventory). Total value: ${formatCurrency(grounding.businessIntelligence?.inventoryHealth?.totalStockValue || 0)}.`
      comparativeInsights = [
        `📦 ${tenantName} - All ${grounding.productComparisons.length} active products have sufficient stock levels.`,
        `🔄 Inventory turnover: ${turnover.toFixed(1)}x - ${turnover > 4 ? 'excellent' : turnover > 2 ? 'good' : 'needs improvement'}`,
        `💰 Stock value: ${formatCurrency(grounding.businessIntelligence?.inventoryHealth?.totalStockValue || 0)}`,
        `📊 Cash tied in inventory: ${formatCurrency(cashTied)}`,
      ]
      if (grounding.productComparisons.length > 0) {
        comparativeInsights.push(`🏆 Top products by sales velocity: ${grounding.productComparisons.slice(0, 3).map(p => `${p.productName} (${p.inventoryTurnover.toFixed(1)}x turnover)`).join(', ')}`)
      }
      actions = [
        `Continue monitoring top 5 products by sales velocity`,
        `Schedule EOQ review for best-sellers to optimize order quantities`,
        `Consider clearance for slow-moving inventory`,
      ]
    } else {
      const totalReorderValue = actionableRiskItems.reduce((sum, item) => {
        const unitCost = toNumber(item.costPrice)
        const normalizedUnitCost = unitCost > 0 ? unitCost : 0
        return sum + (item.suggestedReorderQty * normalizedUnitCost)
      }, 0)
      const missingCostCoverage = actionableRiskItems.some((item) => item.suggestedReorderQty > 0 && !(toNumber(item.costPrice) > 0))
      const reorderCostText = totalReorderValue > 0
        ? formatCurrency(totalReorderValue)
        : missingCostCoverage
          ? 'unavailable (missing item cost prices)'
          : formatCurrency(0)
      const p1Count = p1Items.length > 0 ? `${p1Items.length} CRITICAL (P1 - IMMEDIATE):` : ''
      const p2Count = p2Items.length > 0 ? `${p2Items.length} IMPORTANT (P2 - THIS WEEK):` : ''
      const summaryLineItems = [p1Count, p2Count].filter(Boolean).join(' + ')
      summary = `🚨 ${tenantName} INVENTORY ALERT: ${summaryLineItems || 'No urgent action required'}. Total reorder cost: ${reorderCostText}.`
      
      let belowThresholdNow: string[] = []
      let reorderListByUrgency: string[] = []
      
      if (p1Items.length > 0) {
        comparativeInsights.push(`🔴 P1 - STOCKOUT IMMINENT (24 hours):`)
        for (const item of p1Items) {
          const daysLeft = item.daysToStockout?.toFixed(1) || '0'
          const lostSalesRisk = item.avgDailyDemand * (item.costPrice || 10) * 2
          belowThresholdNow.push(`${item.productName}: ${item.currentStock}/${item.lowStockThreshold}`)
          const unitCost = toNumber(item.costPrice)
          const lineCost = unitCost > 0 ? formatCurrency(item.suggestedReorderQty * unitCost) : '(cost data missing)'
          reorderListByUrgency.push(`[P1] ${item.productName}: ${item.suggestedReorderQty} units @ ${lineCost}`)
          comparativeInsights.push(
            `  • ${item.productName} (${item.category || 'uncategorized'}): ${item.currentStock} units left (threshold: ${item.lowStockThreshold}), ` +
            `${item.avgDailyDemand.toFixed(1)} units/day → ${daysLeft} days remaining. ` +
            `⚠️ Reorder ${item.suggestedReorderQty} units NOW. Lost sales risk: ${formatCurrency(lostSalesRisk)}/day.`
          )
          actions.push(`P1 - IMMEDIATE: Create PO for ${item.suggestedReorderQty} units of ${item.productName}`)
        }
      }
      
      if (p2Items.length > 0) {
        comparativeInsights.push(`🟡 P2 - Important (This week):`)
        for (const item of p2Items.slice(0, 5)) {
          const thresholdMessage = item.currentStock <= item.lowStockThreshold
            ? `below safety threshold now at ${item.currentStock} units (threshold: ${item.lowStockThreshold})`
            : `${item.currentStock} units on hand (threshold: ${item.lowStockThreshold})`
          const coverageMessage = item.daysToStockout !== null
            ? `${item.daysToStockout.toFixed(1)} days of cover at recent demand`
            : 'demand history is limited, so threshold breach is the main signal'
          if (item.currentStock <= item.lowStockThreshold) {
            belowThresholdNow.push(`${item.productName}: ${item.currentStock}/${item.lowStockThreshold}`)
          }
          const unitCost = toNumber(item.costPrice)
          const lineCost = unitCost > 0 ? formatCurrency(item.suggestedReorderQty * unitCost) : '(cost data missing)'
          reorderListByUrgency.push(`[P2] ${item.productName}: ${item.suggestedReorderQty} units @ ${lineCost}`)
          comparativeInsights.push(
            `  • ${item.productName} (${item.category || 'uncategorized'}): ${thresholdMessage}; ${coverageMessage}. Reorder ${item.suggestedReorderQty} units this week.`
          )
          actions.push(`P2 - THIS WEEK: Order ${item.suggestedReorderQty} units of ${item.productName}`)
        }
      }
      
      if (belowThresholdNow.length > 0) {
        comparativeInsights.push('')
        comparativeInsights.push(`📋 Items Below Safety Threshold RIGHT NOW:`)
        belowThresholdNow.forEach(item => comparativeInsights.push(`  • ${item}`))
      }
      
      if (reorderListByUrgency.length > 0) {
        comparativeInsights.push('')
        comparativeInsights.push(`📦 EXACT REORDER LIST (sorted by urgency):`)
        reorderListByUrgency.forEach(item => comparativeInsights.push(`  ${item}`))
      }
      
      if (p3Items.length > 0 && p1Items.length === 0 && p2Items.length === 0) {
        comparativeInsights.push(`🟢 P3 - Monitor (2-week window):`)
        for (const item of p3Items.slice(0, 5)) {
          comparativeInsights.push(
            `  • ${item.productName}: ${item.currentStock} units, ` +
            `${item.daysToStockout?.toFixed(1)} days remaining.`
          )
        }
        actions.push(`P3 - MONITOR: Review ${p3Items.slice(0, 3).map(i => i.productName).join(', ')} in weekly stock meeting`)
      }
    }
    
    const risks = [
      p1Items.length > 0 ? `P1 items (${p1Items.map(i => i.productName).join(', ')}) will cause lost sales if not reordered today` : 'No critical stockout risks',
      p1Items.length === 0 && p2Items.length > 0 ? `P2 items (${p2Items.map(i => i.productName).join(', ')}) are below safety threshold and should be reordered this week` : '',
      `Inventory turnover: ${currentTurnover.toFixed(1)}x - ${currentTurnover < 2 ? 'slow turnover needs attention' : 'healthy'}`,
      `Cash tied in inventory: ${formatCurrency(cashTied)}`,
      currentDaysOfInventory > 60 ? `Days of inventory: ${currentDaysOfInventory.toFixed(0)} days - excessive` : '',
    ].filter(r => r)
    
    const followUpQuestions = [
      p1Items.length > 0 ? `Which suppliers have fastest lead times for ${p1Items[0]?.productName}?` : 'What are the lead times for top suppliers?',
      p1Items.length > 0 ? 'Generate purchase orders for P1 items?' : 'Should I run an EOQ analysis for best-sellers?',
      'What is the cash flow impact of these reorders?',
    ]
    
    const quickWins = p1Items.length > 0 ? [`Reorder ${p1Items[0]?.productName} immediately`] : 
                      (p2Items.length > 0 ? [`Place order for ${p2Items[0]?.productName}`] : [])
    
    const brief: AssistantBrief = { 
      summary, 
      comparativeInsights, 
      actions, 
      risks, 
      followUpQuestions, 
      quickWins,
      alerts: p1Items.length > 0 ? [{
        severity: 'critical',
        message: `${p1Items.length} products at immediate stockout risk`,
        actionRequired: 'Reorder within 24 hours'
      }] : p2Items.length > 0 ? [{
        severity: 'warning',
        message: `${p2Items.length} products are below stock threshold and need reorder planning this week`,
        actionRequired: 'Create or approve a reorder plan within 7 days'
      }] : [],
      financialMetrics: {
        revenue: grounding.current.revenue,
        profit: grounding.current.profit,
        margin: grounding.current.margin,
        expenseRatio: grounding.expenseInsights.costToRevenueRatio,
        inventoryTurnover: currentTurnover,
        cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
      }
    }
    storeCurrentState(grounding.tenantId, grounding)
    return brief
  }
  
  // ===== PROFITABILITY INTENT =====
  if (intent === 'PROFITABILITY' || lowerQuestion.includes('profit') || lowerQuestion.includes('margin') || lowerQuestion.includes('profitable')) {
    const netStatus = grounding.profitability.netProfit >= 0 ? 'profitable' : 'operating at a loss'
    const netColor = grounding.profitability.netProfit >= 0 ? '💰' : '🔴'
    
    let summary = `${netColor} ${tenantName} ${netStatus.toUpperCase()}: ${formatCurrency(Math.abs(grounding.profitability.netProfit))} ${grounding.profitability.netProfit >= 0 ? 'profit' : 'loss'} (${grounding.profitability.netMarginPct > 0 ? '+' : ''}${grounding.profitability.netMarginPct.toFixed(1)}% net margin). `
    summary += `Gross profit ${formatCurrency(grounding.profitability.grossProfit)} at ${grounding.profitability.grossMarginPct.toFixed(1)}% margin. `
    summary += `${grounding.profitability.profitableProductCount} profitable, ${grounding.profitability.lossMakingProductCount} loss-making products.`
    
    const comparativeInsights = [
      `💰 Gross Profit: ${formatCurrency(grounding.profitability.grossProfit)} (${grounding.profitability.grossMarginPct.toFixed(1)}% margin)`,
      `${netColor} Net Profit: ${formatCurrency(grounding.profitability.netProfit)} (${grounding.profitability.netMarginPct.toFixed(1)}% margin)`,
      `📈 Margin Change: ${formatPercent(grounding.deltas.marginPct)} vs previous period`,
      `🏆 Most Profitable: ${grounding.profitability.topProfitableProducts.slice(0, 3).map(p => `${p.name} (${p.category || 'uncategorized'}, ${p.margin.toFixed(0)}% margin)`).join(', ')}`,
    ]
    
    if (grounding.profitability.topLossMakingProducts.length > 0) {
      comparativeInsights.push(`⚠️ Loss-Making: ${grounding.profitability.topLossMakingProducts.slice(0, 3).map(p => p.name).join(', ')}`)
    }
    
    const actions = []
    if (grounding.profitability.lossMakingProductCount > 0) {
      actions.push(`P2 - Review pricing for ${grounding.profitability.topLossMakingProducts[0]?.name}`)
    }
    if (grounding.profitability.netMarginPct < 0) {
      actions.push(`P1 - URGENT: Business is losing ${formatCurrency(Math.abs(grounding.profitability.netProfit))} - immediate action required`)
    }
    actions.push(`P3 - Increase promotion of ${grounding.profitability.topProfitableProducts[0]?.name}`)
    
    const brief: AssistantBrief = {
      summary,
      comparativeInsights,
      actions,
      risks: grounding.profitability.profitRisks,
      followUpQuestions: ['Which products need pricing review?', 'What is break-even point?'],
      quickWins: grounding.profitability.topLossMakingProducts.length > 0 ? [`Review ${grounding.profitability.topLossMakingProducts[0]?.name} pricing`] : [],
      financialMetrics: {
        revenue: grounding.current.revenue,
        profit: grounding.current.profit,
        margin: grounding.current.margin,
        expenseRatio: grounding.expenseInsights.costToRevenueRatio,
        inventoryTurnover: currentTurnover,
        cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
      }
    }
    storeCurrentState(grounding.tenantId, grounding)
    return brief
  }
  
  // ===== SALES INTENT =====
  if (intent === 'SALES' || lowerQuestion.includes('sales') || lowerQuestion.includes('revenue')) {
    const trendIcon = grounding.salesInsights.salesTrend === 'increasing' ? '📈' : 
                      grounding.salesInsights.salesTrend === 'decreasing' ? '📉' : '➡️'
    const forecast = grounding.salesInsights.salesForecast
    const hasSalesActivity = grounding.salesInsights.transactionCount > 0 && grounding.salesInsights.totalSales > 0
    const hasSubscriptionIncome = shouldShowSubscriptionStream(grounding.incomeBreakdown)
    
    let summary = `${trendIcon} ${tenantName} Revenue Performance: ${formatCurrency(grounding.current.revenue)} in the current window. `
    if (hasSalesActivity) {
      summary += `Sales contribution is ${formatCurrency(grounding.salesInsights.totalSales)} from ${grounding.salesInsights.transactionCount} transactions. `
      summary += `Trend is ${grounding.salesInsights.salesTrend} (${formatPercent(grounding.shortHorizonDeltas.revenuePct)} last 7 days) with AOV of ${formatCurrency(grounding.salesInsights.avgOrderValue)}. `
    } else {
      summary += `No material sales transactions were recorded in this window; analysis is anchored on non-sales income streams and historical trend context. `
    }
    if (hasSubscriptionIncome) {
      summary += `Subscription/recurring income contributed ${formatCurrency(grounding.incomeBreakdown.subscriptionIncome)}. `
    }
    summary += `Forecast: ${formatCurrency(forecast.next7Days)} next 7 days (${(forecast.confidence * 100).toFixed(0)}% confidence).`
    
    const comparativeInsights = [
      `📈 Total Revenue: ${formatCurrency(grounding.current.revenue)} (${formatPercent(grounding.deltas.revenuePct)} vs prior)`,
      hasSubscriptionIncome
        ? `🧩 Income Mix: Sales ${formatCurrency(grounding.incomeBreakdown.salesIncome)} (${grounding.incomeBreakdown.streamMix.salesPct.toFixed(1)}%) | Subscription ${formatCurrency(grounding.incomeBreakdown.subscriptionIncome)} (${grounding.incomeBreakdown.streamMix.subscriptionPct.toFixed(1)}%)`
        : `🧩 Income Mix: Sales ${formatCurrency(grounding.incomeBreakdown.salesIncome)} (100.0%)`,
      `🛒 Transactions: ${grounding.salesInsights.transactionCount} | AOV: ${formatCurrency(grounding.salesInsights.avgOrderValue)}`,
    ]
    if (grounding.salesInsights.topSellingProducts.length > 0) {
      comparativeInsights.push(`⭐ Top Sellers: ${grounding.salesInsights.topSellingProducts.slice(0, 3).map(p => p.name).join(', ')}`)
    } else {
      comparativeInsights.push('⭐ Top Sellers: No sales-item signal in current window')
    }
    
    if (grounding.salesInsights.slowMovingProducts.length > 0) {
      comparativeInsights.push(`🐌 Slow-Moving: ${grounding.salesInsights.slowMovingProducts.slice(0, 3).map(p => p.name).join(', ')}`)
    }
    
    const actions = []
    if (grounding.salesInsights.salesTrend === 'decreasing' && hasSalesActivity) {
      actions.push(`P2 - Launch promotion on ${grounding.salesInsights.topSellingProducts[0]?.name} to reverse decline`)
    }
    if (grounding.salesInsights.slowMovingProducts.length > 0) {
      actions.push(`P3 - Run clearance on slow-moving products to free working capital`)
    }
    if (!hasSalesActivity && hasSubscriptionIncome) {
      actions.push('P2 - Audit subscription retention, churn, and renewal funnel to protect recurring income')
    }
    
    const brief: AssistantBrief = {
      summary,
      comparativeInsights,
      actions,
      risks: [`Sales trend: ${grounding.salesInsights.salesTrend}`, `${grounding.salesInsights.slowMovingProducts.length} slow-moving products`],
      followUpQuestions: ['What is driving the sales trend?', 'Which marketing channels perform best?'],
      financialMetrics: {
        revenue: grounding.current.revenue,
        profit: grounding.current.profit,
        margin: grounding.current.margin,
        expenseRatio: grounding.expenseInsights.costToRevenueRatio,
        inventoryTurnover: currentTurnover,
        cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
      }
    }
    storeCurrentState(grounding.tenantId, grounding)
    return brief
  }
  
  // ===== EXPENSE INTENT =====
  if (intent === 'EXPENSES' || lowerQuestion.includes('expense') || lowerQuestion.includes('cost')) {
    let summary = `${tenantName} Expense Analysis: ${formatCurrency(grounding.expenseInsights.totalExpenses)} total expenses, `
    summary += `${formatPercent(grounding.expenseInsights.expenseGrowthRate)} growth vs prior period. `
    summary += `Cost-to-revenue ratio at ${grounding.expenseInsights.costToRevenueRatio.toFixed(1)}%.`
    
    const comparativeInsights = [
      `💰 Total Expenses: ${formatCurrency(grounding.expenseInsights.totalExpenses)}`,
      `📊 Top Categories: ${grounding.expenseInsights.topExpenseCategories.slice(0, 3).map(c => `${c.category} (${c.pctOfTotal.toFixed(0)}%)`).join(', ')}`,
    ]
    
    if (grounding.expenseInsights.unusualExpenses.length > 0) {
      comparativeInsights.push(`⚠️ Unusual Expenses: ${grounding.expenseInsights.unusualExpenses.slice(0, 2).map(e => e.title).join(', ')}`)
    }
    
    const actions = grounding.expenseInsights.recommendedSavings.slice(0, 2).map(s => `${s.priority} - ${s.action}`)
    
    const brief: AssistantBrief = {
      summary,
      comparativeInsights,
      actions,
      risks: [`Expense growth: ${formatPercent(grounding.expenseInsights.expenseGrowthRate)}`, `Efficiency score: ${grounding.expenseInsights.expenseEfficiencyScore.toFixed(0)}/100`],
      followUpQuestions: ['Which expense categories have highest reduction potential?', 'Should I audit vendor contracts?'],
      financialMetrics: {
        revenue: grounding.current.revenue,
        profit: grounding.current.profit,
        margin: grounding.current.margin,
        expenseRatio: grounding.expenseInsights.costToRevenueRatio,
        inventoryTurnover: currentTurnover,
        cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
      }
    }
    storeCurrentState(grounding.tenantId, grounding)
    return brief
  }

  // ===== BRANCH INTENT =====
  if (intent === 'BRANCH' || lowerQuestion.includes('branch') || lowerQuestion.includes('subsidiary') || lowerQuestion.includes('store')) {
    const branchPriorities = getBranchPerformancePriorities(grounding.branchComparisons)
    const branchSnapshot = getBranchAttributedSnapshot(grounding.branchComparisons)
    const branchInventoryTurnover = grounding.businessIntelligence?.inventoryHealth?.inventoryTurnover || 0
    const branchCount = grounding.branchComparisons.length
    const topBranch = grounding.branchComparisons[0]
    const underperforming = grounding.branchComparisons.filter((b) => b.currentMargin < 0 || b.revenueDeltaPct < -15)
    const singleBranchConfigured = grounding.tenantInfo.activeBranchCount <= 1

    const hasBranchSignals = branchCount > 0
    const summary = hasBranchSignals
      ? `🏢 ${tenantName} Branch Performance (This Week): ${branchCount} branches analyzed. Branch-attributed revenue is ${formatCurrency(branchSnapshot.revenueCurrent)} (${formatPercent(branchSnapshot.revenueDeltaPct)} vs prior). ${branchPriorities.length} priority items identified${topBranch ? `; top branch is ${topBranch.branchName}` : ''}.`
      : singleBranchConfigured
        ? `🏢 ${tenantName} Branch Performance (This Week): Branch comparison is not applicable because only one active branch is configured.`
        : `🏢 ${tenantName} Branch Performance (This Week): No branch-level sales/expense signals were detected in the current analysis window.`

    const comparativeInsights = hasBranchSignals
      ? [
          `📍 Active branch signals: ${branchCount}`,
          `🏬 Branches analyzed: ${grounding.branchComparisons.slice(0, 5).map((b) => b.branchName).join(', ')}`,
          `💰 Branch-attributed revenue: ${formatCurrency(branchSnapshot.revenueCurrent)} (${formatPercent(branchSnapshot.revenueDeltaPct)} vs prior)`,
          `💵 Branch-attributed margin: ${formatCurrency(branchSnapshot.marginCurrent)} (${branchSnapshot.marginPctCurrent.toFixed(1)}%)`,
          `⭐ Top branch: ${topBranch?.branchName || 'N/A'} (${formatCurrency(topBranch?.currentRevenue || 0)} revenue, ${topBranch?.grossMarginPct?.toFixed(1) || '0.0'}% margin)`,
          `⚠️ Underperforming branches: ${underperforming.length}${underperforming.length > 0 ? ` (${underperforming.slice(0, 3).map((b) => b.branchName).join(', ')})` : ''}`,
          `🧭 Priority mix: P1 ${branchPriorities.filter((p) => p.priority === 'P1').length}, P2 ${branchPriorities.filter((p) => p.priority === 'P2').length}, P3 ${branchPriorities.filter((p) => p.priority === 'P3').length}`,
        ]
      : [
          `📍 Branch metrics available: 0`,
          `🧩 Branch-attributed revenue is ${formatCurrency(0)} in current window`,
          singleBranchConfigured
            ? '📝 Only one active branch is configured, so comparative branch ranking is not meaningful yet'
            : '📝 Branch priority scoring needs branch-tagged sales and expenses to rank locations',
        ]

    const actions = hasBranchSignals
      ? (branchPriorities.length > 0
        ? branchPriorities.slice(0, 5).map((p) => `${p.priority} - ${p.action}`)
        : [
            topBranch
              ? `P3 - Maintain momentum at ${topBranch.branchName}; keep weekly revenue/margin checkpoint for the next 7 days`
              : 'P3 - Maintain current weekly branch KPI checks (revenue, margin, expense ratio)',
            underperforming.length > 0
              ? `P2 - Provide targeted operational support to ${underperforming[0].branchName} this week`
              : 'P3 - Continue branch-level anomaly monitoring and data tagging discipline this week',
          ])
      : singleBranchConfigured
        ? [
            'P3 - Add another branch/store only if you need comparative branch performance analytics',
            'P2 - Track weekly branch KPIs (revenue, margin, expense ratio) for trend monitoring',
            'P3 - Re-run branch priorities once multi-branch operations are active',
          ]
        : [
            'P2 - Ensure all new sales and expenses are tagged to a branch/subsidiary this week',
            'P2 - Backfill uncategorized branch transactions for the last 30 days',
            'P3 - Run branch performance review after data tagging to generate ranked priorities',
          ]

    const risks = hasBranchSignals
      ? [
          underperforming.length > 0
            ? `${underperforming.length} branches show margin/revenue stress`
            : 'No immediate branch distress signals',
          `Data coverage score: ${Math.round(grounding.coverageScore * 100)}%`,
          `Recency: ${grounding.dataQuality.recency}`,
        ]
      : [
          'No branch-level transactional signal in current window',
          singleBranchConfigured
            ? 'Branch comparison is unavailable with a single active branch'
            : 'Branch leaderboard may be misleading until branch tagging improves',
          `Coverage score ${Math.round(grounding.coverageScore * 100)}% may limit location-level confidence`,
        ]

    const followUpQuestions = hasBranchSignals
      ? [
          'Show the top 3 branch risks with expected financial impact',
          'Which branch should receive immediate operational support this week?',
          'Do you want a branch-by-branch 7-day action plan?',
        ]
      : [
          singleBranchConfigured
            ? 'Do you want a single-branch weekly KPI summary instead of branch comparison?'
            : 'Should I produce a branch data-completeness checklist for operations this week?',
          'Do you want a list of untagged transactions to assign to branches?',
          'Should I re-run branch priorities after data attribution is completed?',
        ]

    const brief: AssistantBrief = {
      summary,
      comparativeInsights,
      actions,
      risks,
      followUpQuestions,
      quickWins: actions.slice(0, 2),
      financialMetrics: {
        revenue: branchSnapshot.revenueCurrent,
        profit: branchSnapshot.marginCurrent,
        margin: branchSnapshot.marginPctCurrent,
        expenseRatio: branchSnapshot.revenueCurrent > 0 ? round2((branchSnapshot.expenseCurrent / branchSnapshot.revenueCurrent) * 100) : 0,
        inventoryTurnover: branchInventoryTurnover,
        cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
      },
    }

    storeCurrentState(grounding.tenantId, grounding)
    return brief
  }
  
  // ===== GENERAL INTENT - Comprehensive Overview =====
  const healthScore = grounding.businessIntelligence?.inventoryHealth?.healthScore || 50
  const hasAnyData = grounding.salesInsights.transactionCount > 0 ||
    grounding.incomeBreakdown.subscriptionIncome > 0 ||
    grounding.inventoryRiskItems.length > 0

  let summary = `📊 ${tenantName} BUSINESS HEALTH: ${Math.round(healthScore)}/100 (${healthScore >= 70 ? 'Strong' : healthScore >= 50 ? 'Moderate' : 'Critical'}). ` +
    `Revenue ${formatCurrency(grounding.current.revenue)} (${formatPercent(grounding.deltas.revenuePct)}), ` +
    `${grounding.profitability.netProfit >= 0 ? 'profit' : 'loss'} ${formatCurrency(Math.abs(grounding.profitability.netProfit))} (${grounding.profitability.netMarginPct > 0 ? '+' : ''}${grounding.profitability.netMarginPct.toFixed(1)}% margin).`

  if (!hasAnyData) {
    summary = `⚠️ ${tenantName} - No recent business data detected.\n\n` +
      `No sales transactions, subscription income, or inventory activity found in the analysis period.\n\n` +
      `Please verify that:\n` +
      `• Sales are being recorded correctly\n` +
      `• Subscription payments are being captured\n` +
      `• Inventory items are set up with proper thresholds`
  }
  
  const comparativeInsights = [
    `💰 Revenue: ${formatCurrency(grounding.current.revenue)} (${formatPercent(grounding.deltas.revenuePct)} vs prior)`,
    `💵 Net Profit: ${formatCurrency(grounding.profitability.netProfit)} (${grounding.profitability.netMarginPct.toFixed(1)}% margin)`,
    `🧩 Income Streams: Sales ${formatCurrency(grounding.incomeBreakdown.salesIncome)} | Subscription ${formatCurrency(grounding.incomeBreakdown.subscriptionIncome)}`,
    `🏆 Top Product: ${grounding.productComparisons[0]?.productName || 'No sales-item signal in current window'}`,
    `⭐ Top Branch: ${grounding.branchComparisons[0]?.branchName || 'No branch sales signal in current window'}`,
    `🔄 Inventory Turnover: ${currentTurnover.toFixed(1)}x`,
    `💸 Expense Ratio: ${grounding.expenseInsights.costToRevenueRatio.toFixed(1)}%`,
    `💰 Cash in Inventory: ${formatCurrency(cashTied)}`,
  ]
  
  const actions = []
  if (grounding.inventoryRiskItems.filter(i => i.urgency === 'P1').length > 0) {
    actions.push(`P1 - IMMEDIATE: Reorder ${grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')[0]?.productName}`)
  }
  if (grounding.profitability.lossMakingProductCount > 0) {
    actions.push(`P2 - IMPORTANT: Review pricing for loss-making products`)
  }
  if (grounding.expenseInsights.expenseGrowthRate > 15) {
    actions.push(`P2 - IMPORTANT: Audit ${grounding.expenseInsights.topExpenseCategories[0]?.category} expenses`)
  }
  if (grounding.profitability.netMarginPct < 0) {
    actions.push(`P1 - URGENT: Immediate cost and pricing review required`)
  }
  actions.push(`P3 - MONITOR: Increase promotion of high-margin products`)
  
  const risks = [
    `${grounding.profitability.lossMakingProductCount} loss-making products`,
    grounding.salesInsights.salesTrend === 'decreasing' ? 'Declining sales trend' : 'Monitor competition',
    `${grounding.inventoryRiskItems.filter(i => i.urgency === 'P1').length} stockout risks`,
    `Expense ratio ${grounding.expenseInsights.costToRevenueRatio.toFixed(0)}%`,
  ]
  
  const quickWins = []
  if (grounding.inventoryRiskItems.filter(i => i.urgency === 'P1').length > 0) {
    quickWins.push(`Reorder ${grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')[0]?.productName}`)
  }
  if (grounding.profitability.topLossMakingProducts.length > 0) {
    quickWins.push(`Review ${grounding.profitability.topLossMakingProducts[0]?.name} pricing`)
  }
  
  const brief: AssistantBrief = {
    summary,
    comparativeInsights,
    actions,
    risks,
    followUpQuestions: [
      'What is driving the profit trend?',
      'Which products need pricing review?',
      'Show detailed branch performance',
    ],
    quickWins: quickWins.slice(0, 2),
    alerts: grounding.profitability.netMarginPct < 0 ? [{
      severity: 'critical',
      message: `Business is operating at a loss of ${formatCurrency(Math.abs(grounding.profitability.netProfit))}`,
      actionRequired: 'Immediate cost and pricing review'
    }] : [],
    financialMetrics: {
      revenue: grounding.current.revenue,
      profit: grounding.current.profit,
      margin: grounding.current.margin,
      expenseRatio: grounding.expenseInsights.costToRevenueRatio,
      inventoryTurnover: currentTurnover,
      cashRunway: grounding.businessIntelligence?.cashFlowInsight?.currentRunway || null,
    }
  }

  storeCurrentState(grounding.tenantId, grounding)

  if (intent === 'GENERAL') {
    try {
      const { predictiveAlerts, dataQualityIssues, purchaseRecommendations } = await generateAutonomousReportModule(grounding)

      if (predictiveAlerts.length > 0) {
        brief.alerts = [
          ...(brief.alerts || []),
          ...predictiveAlerts.map((alert) => ({
            severity: alert.severity,
            message: alert.title,
            actionRequired: alert.recommendedAction,
          })),
        ]
      }

      if (dataQualityIssues.length > 0) {
        brief.comparativeInsights.push(`🔧 Data Quality: ${dataQualityIssues.length} issues detected. Run /api/enterprise-ai/autonomous/report for details.`)
      }

      if (purchaseRecommendations.recommendations.length > 0) {
        brief.quickWins = [
          ...(brief.quickWins || []),
          ...purchaseRecommendations.recommendations
            .slice(0, 2)
            .map((r) => `Order ${r.suggestedReorderQty} ${r.productName} (${formatCurrency(r.totalCost)})`),
        ]
      }
    } catch (error) {
      console.error('[Autonomous] Failed to enrich response:', error)
    }
  }

  return brief
}

// ============================================================
// MAIN GROUNDING BUILDING
// ============================================================

type GroundingBusinessData = {
  source: 'internal' | 'external'
  salesCurrentTotal: number
  salesPriorTotal: number
  expenseCurrent: number
  expensePrior: number
  salesCurrent7: number
  salesPrior7: number
  expenseCurrent7: number
  expensePrior7: number
  branchComparisons: BranchComparison[]
  productComparisons: ProductComparison[]
  profitability: ProfitabilityAnalysis
  salesInsights: SalesInsight
  expenseInsights: ExpenseInsight
  inventoryRiskItems: InventoryRiskItem[]
  latestDataAt: number
}

function isWithinWindow(value: string, startDate: Date, endDate: Date): boolean {
  const timestamp = new Date(value).getTime()
  return timestamp >= startDate.getTime() && timestamp < endDate.getTime()
}

function getExternalInventoryQuantityByProduct(snapshot: ExternalGroundingSnapshot): Map<string, number> {
  const inventoryByProduct = new Map<string, number>()
  for (const row of snapshot.inventory) {
    inventoryByProduct.set(row.productId, (inventoryByProduct.get(row.productId) || 0) + toNumber(row.quantity))
  }
  return inventoryByProduct
}

function sumExternalSales(snapshot: ExternalGroundingSnapshot, startDate: Date, endDate: Date): number {
  return round2(snapshot.sales
    .filter((row) => isWithinWindow(row.saleDate, startDate, endDate))
    .reduce((sum, row) => sum + toNumber(row.totalAmount), 0))
}

function sumExternalExpenses(snapshot: ExternalGroundingSnapshot, startDate: Date, endDate: Date): number {
  return round2(snapshot.expenses
    .filter((row) => isWithinWindow(row.expenseDate, startDate, endDate))
    .reduce((sum, row) => sum + toNumber(row.amount), 0))
}

function buildExternalBranchComparisons(
  snapshot: ExternalGroundingSnapshot,
  currentStart: Date,
  priorStart: Date,
): BranchComparison[] {
  const branchNames = new Map(snapshot.branches.map((branch) => [branch.branchId, branch.name]))
  const revenueCurrent = new Map<string, number>()
  const revenuePrior = new Map<string, number>()
  const expenseCurrent = new Map<string, number>()
  const expensePrior = new Map<string, number>()

  for (const sale of snapshot.sales) {
    if (!sale.branchId) continue
    if (isWithinWindow(sale.saleDate, currentStart, new Date(Number.MAX_SAFE_INTEGER))) {
      revenueCurrent.set(sale.branchId, (revenueCurrent.get(sale.branchId) || 0) + toNumber(sale.totalAmount))
    } else if (isWithinWindow(sale.saleDate, priorStart, currentStart)) {
      revenuePrior.set(sale.branchId, (revenuePrior.get(sale.branchId) || 0) + toNumber(sale.totalAmount))
    }
  }

  for (const expense of snapshot.expenses) {
    if (!expense.branchId) continue
    if (isWithinWindow(expense.expenseDate, currentStart, new Date(Number.MAX_SAFE_INTEGER))) {
      expenseCurrent.set(expense.branchId, (expenseCurrent.get(expense.branchId) || 0) + toNumber(expense.amount))
    } else if (isWithinWindow(expense.expenseDate, priorStart, currentStart)) {
      expensePrior.set(expense.branchId, (expensePrior.get(expense.branchId) || 0) + toNumber(expense.amount))
    }
  }

  const branchIds = new Set<string>([
    ...Array.from(branchNames.keys()),
    ...Array.from(revenueCurrent.keys()),
    ...Array.from(revenuePrior.keys()),
    ...Array.from(expenseCurrent.keys()),
    ...Array.from(expensePrior.keys()),
  ])

  const comparisons: BranchComparison[] = []
  for (const branchId of branchIds) {
    const currentRevenue = toNumber(revenueCurrent.get(branchId) || 0)
    const priorRevenueValue = toNumber(revenuePrior.get(branchId) || 0)
    const currentExpense = toNumber(expenseCurrent.get(branchId) || 0)
    const priorExpenseValue = toNumber(expensePrior.get(branchId) || 0)
    const currentMargin = currentRevenue - currentExpense
    const priorMargin = priorRevenueValue - priorExpenseValue
    const grossMarginPct = currentRevenue > 0 ? (currentMargin / currentRevenue) * 100 : 0
    const efficiencyScore = currentRevenue > 0 ? (currentMargin / currentRevenue) * 100 : 0

    comparisons.push({
      subsidiaryId: branchId,
      branchName: branchNames.get(branchId) || branchId,
      currentRevenue: round2(currentRevenue),
      priorRevenue: round2(priorRevenueValue),
      revenueDeltaPct: round2(pctDelta(currentRevenue, priorRevenueValue)),
      currentExpense: round2(currentExpense),
      priorExpense: round2(priorExpenseValue),
      expenseDeltaPct: round2(pctDelta(currentExpense, priorExpenseValue)),
      currentMargin: round2(currentMargin),
      priorMargin: round2(priorMargin),
      marginDeltaPct: round2(pctDelta(currentMargin, priorMargin)),
      grossMarginPct: round2(grossMarginPct),
      contributionMargin: round2(grossMarginPct),
      efficiencyScore: round2(efficiencyScore),
      rank: 0,
    })
  }

  const sorted = [...comparisons].sort((a, b) => b.efficiencyScore - a.efficiencyScore)
  sorted.forEach((branch, index) => {
    branch.rank = index + 1
  })
  return sorted
}

function buildExternalProductComparisons(
  snapshot: ExternalGroundingSnapshot,
  currentStart: Date,
  priorStart: Date,
): ProductComparison[] {
  const inventoryByProduct = getExternalInventoryQuantityByProduct(snapshot)
  const productMap = new Map(snapshot.products.map((product) => [product.productId, {
    name: product.name,
    category: product.category,
    costPrice: toNumber(product.costPrice),
    currentStock: inventoryByProduct.get(product.productId) ?? toNumber(product.currentStock),
  }]))

  const currentStats = new Map<string, { revenue: number; units: number }>()
  const priorStats = new Map<string, { revenue: number; units: number }>()

  for (const row of snapshot.saleItems) {
    const target = isWithinWindow(row.saleDate, currentStart, new Date(Number.MAX_SAFE_INTEGER))
      ? currentStats
      : isWithinWindow(row.saleDate, priorStart, currentStart)
        ? priorStats
        : null
    if (!target) continue
    const current = target.get(row.productId) || { revenue: 0, units: 0 }
    current.revenue += toNumber(row.subtotal)
    current.units += toNumber(row.quantity)
    target.set(row.productId, current)
  }

  const productIds = new Set<string>([
    ...Array.from(productMap.keys()),
    ...Array.from(currentStats.keys()),
    ...Array.from(priorStats.keys()),
  ])

  const comparisons: ProductComparison[] = []
  for (const productId of productIds) {
    const product = productMap.get(productId)
    const current = currentStats.get(productId) || { revenue: 0, units: 0 }
    const prior = priorStats.get(productId) || { revenue: 0, units: 0 }
    const currentCost = current.units * toNumber(product?.costPrice || 0)
    const priorCost = prior.units * toNumber(product?.costPrice || 0)
    const currentProfit = current.revenue - currentCost
    const priorProfit = prior.revenue - priorCost
    const marginPct = current.revenue > 0 ? (currentProfit / current.revenue) * 100 : 0
    const currentStock = Math.max(0, toNumber(product?.currentStock || 0))
    const inventoryTurnover = currentStock > 0 ? current.units / currentStock : 0
    const daysOfInventory = inventoryTurnover > 0 ? 30 / inventoryTurnover : 999
    const revenueGrowth = pctDelta(current.revenue, prior.revenue)

    comparisons.push({
      productId,
      productName: product?.name || productId,
      category: product?.category || null,
      currentRevenue: round2(current.revenue),
      priorRevenue: round2(prior.revenue),
      revenueDeltaPct: round2(revenueGrowth),
      currentUnits: round2(current.units),
      priorUnits: round2(prior.units),
      unitsDeltaPct: round2(pctDelta(current.units, prior.units)),
      currentProfit: round2(currentProfit),
      priorProfit: round2(priorProfit),
      profitDeltaPct: round2(pctDelta(currentProfit, priorProfit)),
      marginPct: round2(marginPct),
      isProfitable: currentProfit > 0,
      profitRank: 0,
      inventoryTurnover: round2(inventoryTurnover),
      daysOfInventory: round2(daysOfInventory),
      velocityScore: round2((current.units / 30) / Math.max(1, currentStock)),
      lifecycleStage: detectLifecycleStage({
        revenueGrowth,
        margin: marginPct,
        inventoryTurnover,
      }),
      priceElasticity: null,
    })
  }

  const sorted = [...comparisons].sort((a, b) => b.currentProfit - a.currentProfit)
  sorted.forEach((product, index) => {
    product.profitRank = index + 1
  })
  return sorted.slice(0, 20)
}

function buildExternalInventoryRiskItems(
  snapshot: ExternalGroundingSnapshot,
  currentStart: Date,
): InventoryRiskItem[] {
  const inventoryByProduct = getExternalInventoryQuantityByProduct(snapshot)
  const soldUnitsByProduct = new Map<string, number>()
  for (const row of snapshot.saleItems) {
    if (!isWithinWindow(row.saleDate, currentStart, new Date(Number.MAX_SAFE_INTEGER))) continue
    soldUnitsByProduct.set(row.productId, (soldUnitsByProduct.get(row.productId) || 0) + toNumber(row.quantity))
  }

  return snapshot.products
    .map((product) => {
      const daysOnShelf = calculateDaysOnShelf(product.purchaseDate, 30)
      const currentStock = inventoryByProduct.get(product.productId) ?? toNumber(product.currentStock)
      const lowStockThreshold = toNumber(product.lowStockThreshold) || 10
      const soldUnits30 = toNumber(soldUnitsByProduct.get(product.productId) || 0)
      const avgDailyDemand = soldUnits30 / 30
      const daysOfInventory = avgDailyDemand > 0 ? currentStock / avgDailyDemand : 999
      let daysToStockout: number | null = null

      if (avgDailyDemand > 0) {
        daysToStockout = currentStock / avgDailyDemand
      } else if (currentStock < lowStockThreshold) {
        daysToStockout = 0.5
      }

      const safetyStock = avgDailyDemand * 3
      const reorderPoint = Math.ceil(avgDailyDemand * 7 + safetyStock)
      const holdingCostPerUnit = toNumber(product.costPrice) * 0.2
      const eoqRaw = holdingCostPerUnit > 0
        ? Math.sqrt((2 * soldUnits30 * 50) / holdingCostPerUnit)
        : 0
      const economicOrderQty = Number.isFinite(eoqRaw) && eoqRaw > 0
        ? Math.ceil(eoqRaw)
        : Math.ceil(avgDailyDemand * 14)
      const targetStock = Math.ceil(Math.max(avgDailyDemand * 14, lowStockThreshold * 1.5))
      const suggestedReorderQty = Math.max(0, targetStock - currentStock)
      const stockValue = currentStock * toNumber(product.costPrice)
      const turnoverRate = soldUnits30 > 0 ? (soldUnits30 / 30) / Math.max(1, currentStock) : 0

      let stockoutProbability = 0
      if (avgDailyDemand > 0 && daysToStockout !== null) {
        const leadTimeDemand = avgDailyDemand * 7
        const zScore = (currentStock - leadTimeDemand) / Math.sqrt(leadTimeDemand)
        stockoutProbability = clamp(1 - 0.5 * (1 + approxErf(zScore / Math.sqrt(2))), 0, 1)
      } else if (currentStock < lowStockThreshold) {
        stockoutProbability = 0.7
      }

      let riskScore = 0
      if (currentStock <= lowStockThreshold) riskScore += 0.4
      else if (currentStock <= lowStockThreshold * 2) riskScore += 0.2

      if (daysToStockout !== null) {
        if (daysToStockout <= 2) riskScore += 0.4
        else if (daysToStockout <= 5) riskScore += 0.3
        else if (daysToStockout <= 7) riskScore += 0.2
        else if (daysToStockout <= 14) riskScore += 0.1
      } else if (currentStock < lowStockThreshold) {
        riskScore += 0.3
      }

      if (soldUnits30 > 50) riskScore += 0.2
      else if (soldUnits30 > 20) riskScore += 0.1
      riskScore = clamp(riskScore, 0, 1)

      let urgency: InventoryRiskItem['urgency'] = 'P3'
      let recommendedAction: InventoryRiskItem['recommendedAction'] = 'monitor'
      if (riskScore >= 0.7 || (daysToStockout !== null && daysToStockout <= 2)) {
        urgency = 'P1'
        recommendedAction = 'order_immediately'
      } else if (riskScore >= 0.4 || (daysToStockout !== null && daysToStockout <= 7)) {
        urgency = 'P2'
        recommendedAction = 'order_soon'
      } else if (daysOfInventory > 90) {
        recommendedAction = 'reduce_stock'
      }

      return {
        productId: product.productId,
        productName: product.name,
        category: product.category,
        subsidiaryId: product.branchId,
        currentStock: round2(currentStock),
        lowStockThreshold,
        soldUnits30: round2(soldUnits30),
        avgDailyDemand: round2(avgDailyDemand),
        daysToStockout: daysToStockout !== null ? round2(daysToStockout) : null,
        suggestedReorderQty,
        urgency,
        riskScore: round2(riskScore),
        stockValue: round2(stockValue),
        turnoverRate: round2(turnoverRate),
        costPrice: toNumber(product.costPrice),
        originalUnitCost: toNumber(product.originalCostPrice),
        originalPurchaseDate: formatIsoDate(product.purchaseDate),
        provenanceEstimated: false,
        daysOfInventory: round2(daysOfInventory),
        reorderPoint: round2(reorderPoint),
        economicOrderQty: round2(economicOrderQty),
        stockoutProbability: round2(stockoutProbability),
        recommendedAction,
      }
    })
    .filter((item) =>
      item.riskScore > 0.2
      || item.suggestedReorderQty > 0
      || item.currentStock <= item.lowStockThreshold * 1.5
      || item.daysOfInventory > 90,
    )
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20)
}

function buildExternalProfitability(
  snapshot: ExternalGroundingSnapshot,
  startDate: Date,
  endDate: Date,
  additionalIncome = 0,
): ProfitabilityAnalysis {
  const productMap = new Map(snapshot.products.map((product) => [product.productId, product]))
  const currentSaleItems = snapshot.saleItems.filter((row) => isWithinWindow(row.saleDate, startDate, endDate))
  const totalRevenue = snapshot.sales
    .filter((row) => isWithinWindow(row.saleDate, startDate, endDate))
    .reduce((sum, row) => sum + toNumber(row.totalAmount), 0)
  const totalExpenses = sumExternalExpenses(snapshot, startDate, endDate)

  let totalCost = 0
  const productProfit: Record<string, { revenue: number; cost: number; name: string; category: string | null }> = {}
  const categoryProfit: Record<string, { revenue: number; cost: number }> = {}

  for (const item of currentSaleItems) {
    const product = productMap.get(item.productId)
    const revenue = toNumber(item.subtotal)
    const cost = toNumber(item.quantity) * toNumber(product?.costPrice || 0)
    totalCost += cost

    if (!productProfit[item.productId]) {
      productProfit[item.productId] = {
        revenue: 0,
        cost: 0,
        name: product?.name || item.productId,
        category: product?.category || null,
      }
    }
    productProfit[item.productId].revenue += revenue
    productProfit[item.productId].cost += cost

    const category = product?.category
    if (category) {
      if (!categoryProfit[category]) {
        categoryProfit[category] = { revenue: 0, cost: 0 }
      }
      categoryProfit[category].revenue += revenue
      categoryProfit[category].cost += cost
    }
  }

  const grossProfit = totalRevenue - totalCost
  const netProfit = grossProfit - totalExpenses
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
  const fixedCosts = totalExpenses * 0.7
  const variableCostRatio = 1 - grossMarginPct / 100
  const breakEvenRevenue = fixedCosts / Math.max(0.01, 1 - variableCostRatio)

  const productMetrics = Object.entries(productProfit).map(([id, data]) => {
    const profit = data.revenue - data.cost
    const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0
    const contributionPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
    return { id, ...data, profit, margin, contributionPct }
  })

  const sortedByProfit = [...productMetrics].sort((a, b) => b.profit - a.profit)
  const sortedByMargin = [...productMetrics].sort((a, b) => a.margin - b.margin)
  const categoryMetrics = Object.entries(categoryProfit).map(([category, data]) => {
    const profit = data.revenue - data.cost
    const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0
    return { category, revenue: data.revenue, profit, margin }
  })
  const sortedCategoriesByProfit = [...categoryMetrics].sort((a, b) => b.profit - a.profit)
  const sortedCategoriesByLoss = [...categoryMetrics].sort((a, b) => a.profit - b.profit)

  const avgMarginByCategory: Record<string, number> = {}
  for (const category of categoryMetrics) {
    avgMarginByCategory[category.category] = round2(category.margin)
  }

  const profitDrivers: string[] = []
  const profitRisks: string[] = []
  if (sortedByProfit[0]?.profit > 0) {
    profitDrivers.push(`${sortedByProfit[0].name} (${formatCurrency(sortedByProfit[0].profit)} profit, ${sortedByProfit[0].margin.toFixed(0)}% margin)`)
  }
  if (sortedCategoriesByProfit[0]?.profit > 0) {
    profitDrivers.push(`${sortedCategoriesByProfit[0].category} category (${formatCurrency(sortedCategoriesByProfit[0].profit)} profit)`)
  }
  if (sortedByMargin[0]?.profit < 0) {
    profitRisks.push(`${sortedByMargin[0].name} losing ${formatCurrency(Math.abs(sortedByMargin[0].profit))}`)
  }
  if (productMetrics.length > 0 && productMetrics.filter((product) => product.profit < 0).length > productMetrics.length * 0.3) {
    const lossMakingCount = productMetrics.filter((product) => product.profit < 0).length
    profitRisks.push(`${lossMakingCount} products (${Math.round((lossMakingCount / productMetrics.length) * 100)}%) are unprofitable`)
  }
  if (netMarginPct < 10 && netMarginPct > 0) {
    profitRisks.push(`Thin net margin of ${netMarginPct.toFixed(0)}% leaves little room for errors`)
  }
  if (netMarginPct < 0) {
    profitRisks.push(`🚨 CRITICAL: Business is operating at a net loss of ${formatCurrency(Math.abs(netProfit))}`)
  }

  const marginForecast = forecastSales([grossMarginPct, grossMarginPct * 0.95, grossMarginPct * 0.98], 30)

  return {
    totalRevenue: round2(totalRevenue + additionalIncome),
    totalCost: round2(totalCost),
    grossProfit: round2(grossProfit + additionalIncome),
    grossMarginPct: round2((totalRevenue + additionalIncome) > 0 ? ((grossProfit + additionalIncome) / (totalRevenue + additionalIncome)) * 100 : 0),
    netProfit: round2(netProfit + additionalIncome),
    netMarginPct: round2((totalRevenue + additionalIncome) > 0 ? ((netProfit + additionalIncome) / (totalRevenue + additionalIncome)) * 100 : 0),
    topProfitableProducts: sortedByProfit.slice(0, 5).map((product) => ({
      name: product.name,
      category: product.category,
      profit: round2(product.profit),
      margin: round2(product.margin),
      contributionPct: round2(product.contributionPct),
    })),
    topLossMakingProducts: sortedByMargin.slice(0, 5).filter((product) => product.profit < 0).map((product) => ({
      name: product.name,
      category: product.category,
      loss: round2(Math.abs(product.profit)),
      margin: round2(product.margin),
    })),
    profitableProductCount: productMetrics.filter((product) => product.profit > 0).length,
    lossMakingProductCount: productMetrics.filter((product) => product.profit < 0).length,
    breakEvenProducts: productMetrics.filter((product) => product.profit === 0).length,
    avgMarginByCategory,
    topCategoriesByProfit: sortedCategoriesByProfit.slice(0, 5).map((category) => ({
      category: category.category,
      profit: round2(category.profit),
      margin: round2(category.margin),
      revenue: round2(category.revenue),
    })),
    topCategoriesByLoss: sortedCategoriesByLoss.slice(0, 5).filter((category) => category.profit < 0).map((category) => ({
      category: category.category,
      loss: round2(Math.abs(category.profit)),
      margin: round2(category.margin),
    })),
    profitDrivers,
    profitRisks,
    breakEvenRevenue: round2(breakEvenRevenue),
    profitMarginForecast: {
      next30Days: round2(marginForecast.forecast),
      next90Days: round2(marginForecast.forecast * 0.98),
      confidence: marginForecast.confidence,
    },
  }
}

function buildExternalSalesInsights(
  snapshot: ExternalGroundingSnapshot,
  currentStart: Date,
  endDate: Date,
  sevenDaysAgo: Date,
  fourteenDaysAgo: Date,
  additionalIncome = 0,
  seasonalFactor = 1,
): SalesInsight {
  const currentSales = snapshot.sales.filter((row) => isWithinWindow(row.saleDate, currentStart, endDate))
  const currentSaleItems = snapshot.saleItems.filter((row) => isWithinWindow(row.saleDate, currentStart, endDate))
  const currentSalesTotal = currentSales.reduce((sum, row) => sum + toNumber(row.totalAmount), 0)
  const totalIncome = currentSalesTotal + additionalIncome
  const transactionCount = currentSales.length
  const avgOrderValue = transactionCount > 0 ? currentSalesTotal / transactionCount : 0
  const last7Total = sumExternalSales(snapshot, sevenDaysAgo, endDate)
  const prev7Total = sumExternalSales(snapshot, fourteenDaysAgo, sevenDaysAgo)
  const trendPct = prev7Total > 0 ? (last7Total - prev7Total) / prev7Total : 0

  let salesTrend: SalesInsight['salesTrend'] = 'stable'
  let trendStrength = 0
  if (trendPct > 0.1) {
    salesTrend = 'increasing'
    trendStrength = Math.min(1, trendPct)
  } else if (trendPct < -0.1) {
    salesTrend = 'decreasing'
    trendStrength = Math.min(1, Math.abs(trendPct))
  }

  const productMap = new Map(snapshot.products.map((product) => [product.productId, product]))
  const productAccumulator = new Map<string, { revenue: number; units: number }>()
  for (const row of currentSaleItems) {
    const current = productAccumulator.get(row.productId) || { revenue: 0, units: 0 }
    current.revenue += toNumber(row.subtotal)
    current.units += toNumber(row.quantity)
    productAccumulator.set(row.productId, current)
  }

  const productSales = Array.from(productAccumulator.entries())
    .map(([productId, stats]) => ({ productId, revenue: stats.revenue, units: stats.units }))
    .sort((a, b) => b.revenue - a.revenue)

  const topSellingProducts = productSales.slice(0, 5).map((product) => ({
    name: productMap.get(product.productId)?.name || product.productId,
    category: productMap.get(product.productId)?.category || null,
    revenue: round2(product.revenue),
    units: round2(product.units),
    contributionPct: totalIncome > 0 ? round2((product.revenue / totalIncome) * 100) : 0,
  }))

  const categorySales = new Map<string, number>()
  for (const item of productSales) {
    const category = productMap.get(item.productId)?.category
    if (!category) continue
    categorySales.set(category, (categorySales.get(category) || 0) + item.revenue)
  }
  const categoryTotal = Array.from(categorySales.values()).reduce((sum, value) => sum + value, 0)
  const topSellingCategories = Array.from(categorySales.entries())
    .map(([category, revenue]) => ({
      category,
      revenue: round2(revenue),
      percentage: categoryTotal > 0 ? round2((revenue / categoryTotal) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const dailySalesMap = new Map<string, number>()
  for (const sale of currentSales) {
    const key = sale.saleDate.slice(0, 10)
    dailySalesMap.set(key, (dailySalesMap.get(key) || 0) + toNumber(sale.totalAmount))
  }
  const salesHistory = Array.from(dailySalesMap.values())
  const forecast7 = forecastSales(salesHistory, 7, seasonalFactor)
  const forecast30 = forecastSales(salesHistory, 30, seasonalFactor)
  const forecast90 = forecastSales(salesHistory, 90, seasonalFactor)

  const anomalies = detectAnomalies(
    currentSales.map((sale) => ({ date: new Date(sale.saleDate), amount: toNumber(sale.totalAmount) })),
    [],
    [],
  )
    .filter((anomaly) => anomaly.type === 'sales_spike' || anomaly.type === 'sales_drop')
    .map((anomaly) => ({
      date: anomaly.description.match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'unknown',
      expectedRevenue: 0,
      actualRevenue: 0,
      deviation: 0,
      severity: anomaly.severity,
    }))

  const inventoryByProduct = getExternalInventoryQuantityByProduct(snapshot)
  const slowMovingProducts = snapshot.products
    .map((product) => {
      const unitsSold = toNumber(productAccumulator.get(product.productId)?.units || 0)
      const stockValue = (inventoryByProduct.get(product.productId) ?? toNumber(product.currentStock)) * toNumber(product.costPrice)
      return {
        name: product.name,
        category: product.category,
        unitsSold,
        daysOnShelf: calculateDaysOnShelf(product.purchaseDate, 30),
        stockValue,
        originalUnitCost: toNumber(product.originalCostPrice),
        originalPurchaseDate: formatIsoDate(product.purchaseDate),
        provenanceEstimated: false,
      }
    })
    .filter((product) => product.unitsSold < 5)
    .sort((a, b) => a.unitsSold - b.unitsSold)
    .slice(0, 5)
    .map((product) => ({
      name: product.name,
      category: product.category,
      unitsSold: round2(product.unitsSold),
      daysOnShelf: product.daysOnShelf,
      stockValue: round2(product.stockValue),
      originalUnitCost: product.originalUnitCost,
      originalPurchaseDate: product.originalPurchaseDate,
      provenanceEstimated: product.provenanceEstimated,
    }))

  return {
    totalSales: round2(totalIncome),
    transactionCount,
    avgOrderValue: round2(avgOrderValue),
    topSellingProducts,
    topSellingCategories,
    slowMovingProducts,
    salesTrend,
    trendStrength,
    peakHours: [],
    bestSellingDay: '',
    salesForecast: {
      next7Days: round2(forecast7.forecast),
      next30Days: round2(forecast30.forecast),
      next90Days: round2(forecast90.forecast),
      confidence: forecast30.confidence,
      upperBound: round2(forecast30.upperBound),
      lowerBound: round2(forecast30.lowerBound),
    },
    anomalies,
  }
}

function buildExternalExpenseInsights(
  snapshot: ExternalGroundingSnapshot,
  startDate: Date,
  endDate: Date,
  revenueOverride: number,
): ExpenseInsight {
  const currentExpenses = snapshot.expenses.filter((row) => isWithinWindow(row.expenseDate, startDate, endDate))
  const priorStart = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
  const priorExpenses = snapshot.expenses.filter((row) => isWithinWindow(row.expenseDate, priorStart, startDate))
  const totalExpenses = currentExpenses.reduce((sum, row) => sum + toNumber(row.amount), 0)
  const priorTotal = priorExpenses.reduce((sum, row) => sum + toNumber(row.amount), 0)

  const categoryMap = new Map<string, number>()
  const priorCategoryMap = new Map<string, number>()
  for (const expense of currentExpenses) {
    const category = expense.category || 'Other'
    categoryMap.set(category, (categoryMap.get(category) || 0) + toNumber(expense.amount))
  }
  for (const expense of priorExpenses) {
    const category = expense.category || 'Other'
    priorCategoryMap.set(category, (priorCategoryMap.get(category) || 0) + toNumber(expense.amount))
  }

  const topExpenseCategories = Array.from(categoryMap.entries())
    .map(([category, amount]) => {
      const priorAmount = priorCategoryMap.get(category) || 0
      const trend = priorAmount > 0 ? (amount - priorAmount) / priorAmount : 0
      let trendStatus: 'rising' | 'stable' | 'falling' = 'stable'
      if (trend > 0.1) trendStatus = 'rising'
      else if (trend < -0.1) trendStatus = 'falling'
      return {
        category,
        amount: round2(amount),
        pctOfTotal: totalExpenses > 0 ? round2((amount / totalExpenses) * 100) : 0,
        trend: trendStatus,
      }
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  const expenseGrowthRate = priorTotal > 0 ? ((totalExpenses - priorTotal) / priorTotal) * 100 : 0
  const amounts = currentExpenses.map((expense) => toNumber(expense.amount))
  const mean = amounts.length > 0 ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : 0
  const variance = amounts.length > 0
    ? amounts.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / amounts.length
    : 0
  const stdDev = Math.sqrt(variance)
  const threshold = mean + 2 * stdDev

  const unusualExpenses = currentExpenses
    .filter((expense) => toNumber(expense.amount) > threshold && toNumber(expense.amount) > 1000)
    .slice(0, 5)
    .map((expense) => ({
      title: expense.title || 'Expense',
      amount: round2(toNumber(expense.amount)),
      date: expense.expenseDate.slice(0, 10),
      category: expense.category || 'Other',
      isAnomaly: true,
    }))

  const costToRevenueRatio = revenueOverride > 0 ? (totalExpenses / revenueOverride) * 100 : 0
  const expenseEfficiencyScore = clamp(100 - costToRevenueRatio, 0, 100)
  const recommendedSavings: ExpenseInsight['recommendedSavings'] = []

  for (const category of topExpenseCategories.filter((entry) => entry.pctOfTotal > 20)) {
    const potentialSavings = category.amount * 0.15
    recommendedSavings.push({
      category: category.category,
      potentialSavings: round2(potentialSavings),
      action: `Review ${category.category} expenses for potential 15% reduction through vendor negotiation`,
      priority: potentialSavings > 5000 ? 'P2' : 'P3',
    })
  }

  if (expenseGrowthRate > 20) {
    recommendedSavings.push({
      category: 'Overall Spending',
      potentialSavings: round2(totalExpenses * 0.1),
      action: `Conduct full expense audit - spending grew ${expenseGrowthRate.toFixed(0)}% vs prior period`,
      priority: 'P1',
    })
  }

  const expenseForecast30 = forecastSales(amounts.slice(-30), 30)
  const expenseForecast90 = forecastSales(amounts.slice(-30), 90)

  return {
    totalExpenses: round2(totalExpenses),
    topExpenseCategories,
    expenseGrowthRate: round2(expenseGrowthRate),
    unusualExpenses,
    costToRevenueRatio: round2(costToRevenueRatio),
    recommendedSavings,
    expenseEfficiencyScore: round2(expenseEfficiencyScore),
    expenseForecast: {
      next30Days: round2(expenseForecast30.forecast),
      next90Days: round2(expenseForecast90.forecast),
      confidence: expenseForecast30.confidence,
    },
  }
}

async function loadGroundingBusinessData(args: {
  tenantId: string
  tenantBaseCurrency: string
  now: Date
  currentStart: Date
  priorStart: Date
  sevenDaysAgo: Date
  fourteenDaysAgo: Date
  subscriptionIncomeCurrent: number
  totalIncomeCurrent: number
  seasonalFactor: number
}): Promise<GroundingBusinessData> {
  const externalSnapshot = await loadExternalGroundingSnapshot({
    tenantId: args.tenantId,
    startDate: args.priorStart,
    endDate: args.now,
  })

  if (externalSnapshot) {
    const salesCurrentTotal = sumExternalSales(externalSnapshot, args.currentStart, args.now)
    const salesPriorTotal = sumExternalSales(externalSnapshot, args.priorStart, args.currentStart)
    const expenseCurrent = sumExternalExpenses(externalSnapshot, args.currentStart, args.now)
    const expensePrior = sumExternalExpenses(externalSnapshot, args.priorStart, args.currentStart)
    const salesCurrent7 = sumExternalSales(externalSnapshot, args.sevenDaysAgo, args.now)
    const salesPrior7 = sumExternalSales(externalSnapshot, args.fourteenDaysAgo, args.sevenDaysAgo)
    const expenseCurrent7 = sumExternalExpenses(externalSnapshot, args.sevenDaysAgo, args.now)
    const expensePrior7 = sumExternalExpenses(externalSnapshot, args.fourteenDaysAgo, args.sevenDaysAgo)
    const branchComparisons = buildExternalBranchComparisons(externalSnapshot, args.currentStart, args.priorStart)
    const productComparisons = buildExternalProductComparisons(externalSnapshot, args.currentStart, args.priorStart)
    const inventoryRiskItems = buildExternalInventoryRiskItems(externalSnapshot, args.currentStart)
    const profitability = buildExternalProfitability(
      externalSnapshot,
      args.currentStart,
      args.now,
      args.subscriptionIncomeCurrent,
    )
    const salesInsights = buildExternalSalesInsights(
      externalSnapshot,
      args.currentStart,
      args.now,
      args.sevenDaysAgo,
      args.fourteenDaysAgo,
      args.subscriptionIncomeCurrent,
      args.seasonalFactor,
    )
    const expenseInsights = buildExternalExpenseInsights(
      externalSnapshot,
      args.currentStart,
      args.now,
      args.totalIncomeCurrent,
    )

    return {
      source: 'external',
      salesCurrentTotal,
      salesPriorTotal,
      expenseCurrent,
      expensePrior,
      salesCurrent7,
      salesPrior7,
      expenseCurrent7,
      expensePrior7,
      branchComparisons,
      productComparisons,
      profitability,
      salesInsights,
      expenseInsights,
      inventoryRiskItems,
      latestDataAt: externalSnapshot.latestDataAt ? new Date(externalSnapshot.latestDataAt).getTime() : 0,
    }
  }

  const [
    salesCurrentTotal,
    salesPriorTotal,
    expenseCurrent,
    expensePrior,
    salesCurrent7,
    salesPrior7,
    expenseCurrent7,
    expensePrior7,
    branchComparisons,
    productComparisons,
    profitability,
    salesInsights,
    expenseInsights,
    inventoryRiskItems,
    latestSale,
    latestExpense,
  ] = await Promise.all([
    sumSalesToBaseCurrency(args.tenantId, args.currentStart, args.now, args.tenantBaseCurrency),
    sumSalesToBaseCurrency(args.tenantId, args.priorStart, args.currentStart, args.tenantBaseCurrency),
    sumExpensesToBaseCurrency(args.tenantId, args.currentStart, args.now, args.tenantBaseCurrency),
    sumExpensesToBaseCurrency(args.tenantId, args.priorStart, args.currentStart, args.tenantBaseCurrency),
    sumSalesToBaseCurrency(args.tenantId, args.sevenDaysAgo, args.now, args.tenantBaseCurrency),
    sumSalesToBaseCurrency(args.tenantId, args.fourteenDaysAgo, args.sevenDaysAgo, args.tenantBaseCurrency),
    sumExpensesToBaseCurrency(args.tenantId, args.sevenDaysAgo, args.now, args.tenantBaseCurrency),
    sumExpensesToBaseCurrency(args.tenantId, args.fourteenDaysAgo, args.sevenDaysAgo, args.tenantBaseCurrency),
    getBranchComparisons(args.tenantId, args.currentStart, args.priorStart),
    getProductComparisons(args.tenantId, args.currentStart, args.priorStart),
    analyzeProfitability(args.tenantId, args.currentStart, args.now, args.subscriptionIncomeCurrent),
    analyzeSalesInsights(args.tenantId, args.currentStart, args.now, args.subscriptionIncomeCurrent, args.seasonalFactor),
    analyzeExpenseInsights(args.tenantId, args.currentStart, args.now, args.totalIncomeCurrent),
    getInventoryRiskItems(args.tenantId, args.currentStart),
    prisma.sale.findFirst({
      where: { tenantId: args.tenantId, archived: false },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.expense.findFirst({
      where: { tenantId: args.tenantId, archived: false },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  ])

  return {
    source: 'internal',
    salesCurrentTotal: toNumber(salesCurrentTotal),
    salesPriorTotal: toNumber(salesPriorTotal),
    expenseCurrent: toNumber(expenseCurrent),
    expensePrior: toNumber(expensePrior),
    salesCurrent7: toNumber(salesCurrent7),
    salesPrior7: toNumber(salesPrior7),
    expenseCurrent7: toNumber(expenseCurrent7),
    expensePrior7: toNumber(expensePrior7),
    branchComparisons,
    productComparisons,
    profitability,
    salesInsights,
    expenseInsights,
    inventoryRiskItems,
    latestDataAt: Math.max(
      latestSale?.createdAt?.getTime() || 0,
      latestExpense?.date?.getTime() || 0,
    ),
  }
}

export async function buildAssistantGrounding(tenantId: string, conversationId?: string): Promise<AssistantGrounding> {
  const now = new Date()
  
  const tenantInfo = await detectTenantInfo(tenantId)
  const crossTenantScope = await shouldUseCrossTenantSubscriptionScope(tenantId)
  
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const priorStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  const incomeCurrent = await computeIncomeBreakdown(tenantId, currentStart, now, tenantInfo.baseCurrency, { crossTenantScope })
  const incomePrior = await computeIncomeBreakdown(tenantId, priorStart, currentStart, tenantInfo.baseCurrency, { crossTenantScope })
  const incomeCurrent7 = await computeIncomeBreakdown(tenantId, sevenDaysAgo, now, tenantInfo.baseCurrency, { crossTenantScope })
  const incomePrior7 = await computeIncomeBreakdown(tenantId, fourteenDaysAgo, sevenDaysAgo, tenantInfo.baseCurrency, { crossTenantScope })
  const seasonalFactor = getSeasonalityFactor(now, tenantInfo.businessType)

  const [history, businessData] = await Promise.all([
    getAssistantHistory(tenantId, conversationId),
    loadGroundingBusinessData({
      tenantId,
      tenantBaseCurrency: tenantInfo.baseCurrency,
      now,
      currentStart,
      priorStart,
      sevenDaysAgo,
      fourteenDaysAgo,
      subscriptionIncomeCurrent: incomeCurrent.subscriptionIncome,
      totalIncomeCurrent: incomeCurrent.totalIncome,
      seasonalFactor,
    }),
  ])

  const {
    source,
    salesCurrentTotal,
    salesPriorTotal,
    expenseCurrent,
    expensePrior,
    salesCurrent7,
    salesPrior7,
    expenseCurrent7,
    expensePrior7,
    branchComparisons,
    productComparisons,
    profitability,
    salesInsights,
    expenseInsights,
    inventoryRiskItems,
    latestDataAt,
  } = businessData

  const currentRevenue = incomeCurrent.totalIncome
  const priorRevenue = incomePrior.totalIncome
  const currentExpenseTotal = toNumber(expenseCurrent)
  const priorExpenseTotal = toNumber(expensePrior)
  const currentProfit = profitability.grossProfit
  const priorProfit = profitability.grossProfit * (priorRevenue / Math.max(1, currentRevenue))
  const currentMargin = profitability.grossMarginPct
  const priorMargin = currentMargin * (priorRevenue / Math.max(1, currentRevenue))

  const currentNet = currentRevenue - currentExpenseTotal
  const priorNet = priorRevenue - priorExpenseTotal
  const currentRevenue7 = incomeCurrent7.totalIncome
  const priorRevenue7 = incomePrior7.totalIncome
  const currentExpense7 = toNumber(expenseCurrent7)
  const priorExpense7 = toNumber(expensePrior7)
  const currentNet7 = currentRevenue7 - currentExpense7
  const priorNet7 = priorRevenue7 - priorExpense7

  const freshnessHours = latestDataAt > 0
    ? round2((Date.now() - latestDataAt) / (1000 * 60 * 60))
    : null

  const volumeSignal = Math.min(1, (Math.abs(currentRevenue) + Math.abs(currentExpenseTotal)) / 250000)
  const branchCoverage = Math.min(1, branchComparisons.length / 4)
  const productCoverage = Math.min(1, productComparisons.length / 10)
  const historyCoverage = Math.min(1, history.length / 3)

  const coverageScore = round2(clamp(
    branchCoverage * 0.32 + productCoverage * 0.33 + volumeSignal * 0.25 + historyCoverage * 0.1,
    0.25,
    0.98,
  ))

  // Detect anomalies for the grounding
  const salesData = salesInsights.topSellingProducts.map(p => ({ date: new Date(), amount: p.revenue }))
  const expenseData = expenseInsights.unusualExpenses.map(e => ({ date: new Date(e.date), amount: e.amount, category: e.category }))
  const anomalies = detectAnomalies(salesData, expenseData, inventoryRiskItems)

  const businessIntelligence = await generateBusinessIntelligence(
    tenantId,
    profitability,
    salesInsights,
    expenseInsights,
    inventoryRiskItems,
    round2(pctDelta(currentRevenue, priorRevenue)),
    tenantInfo,
  )

  const hasEnoughData = (salesInsights.transactionCount || 0) >= CONFIDENCE_THRESHOLDS.minTransactions
    || branchComparisons.length >= 1
    || productComparisons.length >= 3
  const completeness = round2(clamp(
    branchCoverage * 0.35 + productCoverage * 0.35 + historyCoverage * 0.1 + volumeSignal * 0.2,
    0,
    1,
  ))
  const recency = freshnessHours === null
    ? 'unknown'
    : freshnessHours <= CONFIDENCE_THRESHOLDS.maxFreshnessHours / 3
      ? 'fresh'
      : freshnessHours <= CONFIDENCE_THRESHOLDS.maxFreshnessHours
        ? 'stale'
        : 'outdated'

  return {
    tenantId,
    groundingSource: source,
    tenantInfo,
    incomeBreakdown: incomeCurrent,
    periodLabel: 'last 30 days vs previous 30 days',
    current: {
      revenue: round2(currentRevenue),
      expense: round2(currentExpenseTotal),
      net: round2(currentNet),
      profit: round2(currentProfit),
      margin: round2(currentMargin),
    },
    prior: {
      revenue: round2(priorRevenue),
      expense: round2(priorExpenseTotal),
      net: round2(priorNet),
      profit: round2(priorProfit),
      margin: round2(priorMargin),
    },
    deltas: {
      revenuePct: round2(pctDelta(currentRevenue, priorRevenue)),
      expensePct: round2(pctDelta(currentExpenseTotal, priorExpenseTotal)),
      netPct: round2(pctDelta(currentNet, priorNet)),
      profitPct: round2(pctDelta(currentProfit, priorProfit)),
      marginPct: round2(pctDelta(currentMargin, priorMargin)),
    },
    shortHorizonDeltas: {
      revenuePct: round2(pctDelta(currentRevenue7, priorRevenue7)),
      expensePct: round2(pctDelta(currentExpense7, priorExpense7)),
      netPct: round2(pctDelta(currentNet7, priorNet7)),
    },
    inventoryRiskItems,
    branchComparisons,
    productComparisons,
    profitability,
    salesInsights,
    expenseInsights,
    businessIntelligence,
    history,
    coverageScore,
    freshnessHours,
    confidenceThresholds: { ...CONFIDENCE_THRESHOLDS },
    dataQuality: {
      completeness,
      recency,
      hasEnoughData,
      reliabilityScore: round2(coverageScore * 0.6 + completeness * 0.4),
    },
    anomalies,
  }
}

function recordCognitiveInsights(grounding: AssistantGrounding): void {
  if (grounding.tenantInfo.businessType === 'UNKNOWN') return

  const region = grounding.tenantInfo.country
    ? grounding.tenantInfo.state
      ? `${grounding.tenantInfo.country}, ${grounding.tenantInfo.state}`
      : grounding.tenantInfo.country
    : null

  void cognitiveEngine.contributeInsight(grounding.tenantId, grounding.tenantInfo.businessType, {
    insightType: 'assistant_summary',
    businessType: grounding.tenantInfo.businessType,
    region,
    metricKey: 'business_health_snapshot',
    metricValue: {
      healthScore: grounding.businessIntelligence.inventoryHealth.healthScore,
      netMarginPct: grounding.profitability.netMarginPct,
      expenseRatio: grounding.expenseInsights.costToRevenueRatio,
      inventoryTurnover: grounding.businessIntelligence.inventoryHealth.inventoryTurnover,
      stockoutRiskCount: grounding.businessIntelligence.inventoryHealth.stockoutRiskCount,
    },
  }).catch((err) => {
    console.error('[Cognitive] Failed to record insights:', err)
  })
}

// ============================================================
// MAIN EXPORTED FUNCTION
// ============================================================

export async function generateEnterpriseAssistantResponse(args: {
  tenantId: string
  prompt: string
  conversationId?: string
  userId?: string
  userRole?: string
}): Promise<{
  response: string
  brief: AssistantBrief
  provider: 'external-llm' | 'deterministic-fallback' | 'hybrid'
  modelVersion: string
  grounding: AssistantGrounding
  reliability: AssistantReliability
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    select: { baseCurrency: true },
  })
  const resolvedBaseCurrency = normalizeCurrencyCode(tenant?.baseCurrency) || 'USD'

  const recheckCurrencyContext = parseRecheckCurrencyContext(args.prompt)
  const previousResponseCurrency = recheckCurrencyContext.previousResponseCurrency
  const currentToPreviousRate = previousResponseCurrency && previousResponseCurrency !== resolvedBaseCurrency
    ? await resolveCurrentToPreviousFxRate(args.tenantId, resolvedBaseCurrency, previousResponseCurrency)
    : null

  return currencyFormattingContext.run(
    {
      baseCurrency: resolvedBaseCurrency,
      previousCurrency: previousResponseCurrency,
      currentToPreviousRate,
    },
    async () => {
      const startedAt = Date.now()

      const grounding = await buildAssistantGrounding(args.tenantId, args.conversationId)
      recordCognitiveInsights(grounding)

      const systemPrompt = buildSystemPrompt(
        grounding.tenantInfo.name,
        grounding.tenantInfo.baseCurrency,
        previousResponseCurrency,
      )
      const userPrompt = await buildUserPrompt(args.prompt, grounding, {
        previousResponseCurrency,
        currentToPreviousRate,
      })
      const groundingQualityScore = computeGroundingQualityScore(grounding)
      const intent = detectPromptIntent(args.prompt)
      const responsePolicy = buildResponsePolicy({
        prompt: args.prompt,
        intent,
        grounding,
        userRole: args.userRole,
      })

      const useCase: 'business' | 'market' | 'routine' =
        intent === 'PROFITABILITY' ? 'business' :
        intent === 'SALES' ? 'business' :
        intent === 'EXPENSES' ? 'business' :
        intent === 'RESTOCK' ? 'business' : 'routine'

      const modelOutput = await queryEnhancedLLM(systemPrompt, userPrompt, useCase)
      let llmBrief: AssistantBrief | null = null
      let fallbackReason: AssistantReliability['fallbackReason'] = null

      if (modelOutput) {
        const parsed = tryParseJsonBrief(modelOutput.content)
        if (parsed && parsed.summary && parsed.actions.length > 0) {
          llmBrief = parsed
        } else {
          fallbackReason = 'INVALID_SCHEMA'
        }
      } else {
        fallbackReason = 'NO_EXTERNAL_RESPONSE'
      }

      const deterministicBrief = await buildDeterministicBrief(args.prompt, grounding)

      let autonomousReport: {
        predictiveAlerts: any[]
        dataQualityIssues: any[]
        purchaseRecommendations: any[]
      } = {
        predictiveAlerts: [],
        dataQualityIssues: [],
        purchaseRecommendations: [],
      }

      try {
        const report = await generateAutonomousReportModule(grounding)
        autonomousReport = {
          predictiveAlerts: Array.isArray(report.predictiveAlerts) ? report.predictiveAlerts : [],
          dataQualityIssues: Array.isArray(report.dataQualityIssues) ? report.dataQualityIssues : [],
          purchaseRecommendations: Array.isArray(report.purchaseRecommendations?.recommendations)
            ? report.purchaseRecommendations.recommendations
            : [],
        }
      } catch (error) {
        console.error('[Hybrid] Failed to generate autonomous report:', error)
      }

      const hybrid = await generateHybridResponse(
        args.prompt,
        grounding,
        llmBrief,
        deterministicBrief,
        {
          predictiveAlerts: autonomousReport.predictiveAlerts,
          dataQualityIssues: autonomousReport.dataQualityIssues,
          purchaseRecommendations: autonomousReport.purchaseRecommendations,
        },
      )

      let provider: 'external-llm' | 'deterministic-fallback' | 'hybrid' = 'hybrid'
      if (hybrid.fusionMethod === 'llm_enhanced') provider = 'external-llm'
      else if (hybrid.fusionMethod === 'deterministic_fallback') provider = 'deterministic-fallback'

      const reliability: AssistantReliability = {
        groundingQualityScore,
        coverageScore: grounding.coverageScore,
        dataFreshnessHours: grounding.freshnessHours,
        usedFallback: !llmBrief,
        fallbackReason,
        llmAttempts: modelOutput?.attempts || 0,
        confidenceLevel: hybrid.confidenceScore > 75 ? 'high' : hybrid.confidenceScore > 50 ? 'medium' : 'low',
        recommendationConfidence: {},
      }

      const responseGrounding: AssistantGrounding = intent === 'BRANCH'
        ? (() => {
            const branchSnapshot = getBranchAttributedSnapshot(grounding.branchComparisons)
            const branchNetDeltaPct = round2(pctDelta(branchSnapshot.marginCurrent, branchSnapshot.marginPrior))
            const branchMarginDeltaPct = round2(pctDelta(branchSnapshot.marginPctCurrent, branchSnapshot.marginPctPrior))

            return {
              ...grounding,
              incomeBreakdown: {
                totalIncome: branchSnapshot.revenueCurrent,
                salesIncome: branchSnapshot.revenueCurrent,
                subscriptionIncome: 0,
                hasSubscriptionIncomeSource: false,
                streamMix: {
                  salesPct: branchSnapshot.revenueCurrent > 0 ? 100 : 0,
                  subscriptionPct: 0,
                },
              },
              current: {
                revenue: branchSnapshot.revenueCurrent,
                expense: branchSnapshot.expenseCurrent,
                net: branchSnapshot.marginCurrent,
                profit: branchSnapshot.marginCurrent,
                margin: branchSnapshot.marginPctCurrent,
              },
              prior: {
                revenue: branchSnapshot.revenuePrior,
                expense: branchSnapshot.expensePrior,
                net: branchSnapshot.marginPrior,
                profit: branchSnapshot.marginPrior,
                margin: branchSnapshot.marginPctPrior,
              },
              deltas: {
                revenuePct: branchSnapshot.revenueDeltaPct,
                expensePct: round2(pctDelta(branchSnapshot.expenseCurrent, branchSnapshot.expensePrior)),
                netPct: branchNetDeltaPct,
                profitPct: branchNetDeltaPct,
                marginPct: branchMarginDeltaPct,
              },
            }
          })()
        : grounding

      let finalBrief: AssistantBrief = {
        ...(llmBrief || deterministicBrief),
      }
      if (finalBrief.requiresApproval === undefined) {
        finalBrief.requiresApproval = hybrid.confidenceScore < CONFIDENCE_THRESHOLDS.autoApproveConfidence
      }
      if (finalBrief.estimatedCost === undefined && intent === 'RESTOCK') {
        finalBrief.estimatedCost = round2(
          autonomousReport.purchaseRecommendations
            .slice(0, 3)
            .reduce((sum, rec) => sum + (toNumber(rec.totalCost) || 0), 0),
        )
      }

      let simulationResults: any[] = []

      try {
        if (responsePolicy.allowScenario) {
          const simulation = await generateStrategicSimulationReport(args.prompt, grounding)
          simulationResults = simulation.results
          if (simulation.results.length > 0) {
            finalBrief.scenarioAnalysis = {
              bestScenario: simulation.best?.scenario.name || null,
              worstScenario: simulation.worst?.scenario.name || null,
              profitSpread: simulation.sensitivity.profitSpread || 0,
              roiSpread: simulation.sensitivity.roiSpread || 0,
              calibrationSampleSize: simulation.calibrationSummary?.sampleSize || 0,
              averageSuccessScore: simulation.calibrationSummary?.averageSuccessScore || 0,
              calibrationScore: simulation.calibrationSummary?.calibrationScore || 0,
              historicalAccuracy: simulation.calibrationSummary?.historicalAccuracy || 0,
              profitConfidenceInterval: simulation.best
                ? {
                    low: simulation.best.confidenceInterval.profitLow,
                    high: simulation.best.confidenceInterval.profitHigh,
                  }
                : undefined,
            }

            if (simulation.best) {
              finalBrief.comparativeInsights.push(
                `Scenario best-case: ${simulation.best.scenario.name} -> projected profit ${formatCurrency(simulation.best.projectedProfit)} (ROI ${simulation.best.roi.toFixed(2)}x).`,
              )
            }
          }
        }

        if (responsePolicy.allowCausal) {
          const causal = await identifyLikelyRootCausesFromPrompt(args.prompt, grounding)
          finalBrief.causalAnalysis = {
            problem: causal.problem,
            topCauses: causal.rootCauses.slice(0, 3).map((rc) => ({ cause: rc.cause, contribution: rc.contribution })),
            interventions: causal.recommendedInterventions.slice(0, 3).map((i) => i.action),
            methods: causal.methods.slice(0, 3).map((method) => ({
              method: method.method,
              title: method.title,
              confidence: method.confidence,
              pValue: method.pValue,
              effectSize: method.effectSize,
            })),
            confidenceScore: causal.confidenceScore,
          }
        }

        let marketIntel = null
        if (responsePolicy.allowStrategic && (intent === 'GENERAL' || intent === 'PROFITABILITY' || intent === 'SALES' || intent === 'EXPENSES')) {
          marketIntel = await getMarketIntelligence(args.tenantId)
        }

        if (responsePolicy.allowStrategic) {
          const strategic = generateStrategicInsights(grounding, marketIntel)
          if (strategic.length > 0) {
            finalBrief.strategicInsights = strategic.map((s) => ({
              level: s.level,
              insight: s.insight,
              estimatedROI: s.estimatedROI,
              timeHorizon: s.timeHorizon,
            }))
            finalBrief.actions = [
              ...finalBrief.actions,
              ...strategic.slice(0, 2).map((s) => `P2 - STRATEGIC: ${s.insight}`),
            ].slice(0, 8)
          }
        }

        const explanation = buildRecommendationExplanation(finalBrief, grounding, simulationResults)
        finalBrief.explanation = {
          summary: explanation.summary,
          confidence: explanation.confidence,
          keyFactors: explanation.keyFactors,
          limitations: explanation.limitations,
        }

        const executableActions = responsePolicy.allowExecution
          ? deriveExecutableActionsFromBrief({
              actions: finalBrief.actions,
              estimatedCost: finalBrief.estimatedCost,
            })
          : []
        if (executableActions.length > 0) {
          const executionPlan = await buildExecutionPlan(executableActions, {
            confidence: hybrid.confidenceScore,
            tenantId: args.tenantId,
            userId: args.userId,
          })
          finalBrief.executionPlan = {
            autoExecutableCount: executionPlan.autoExecutableCount,
            approvalRequiredCount: executionPlan.approvalRequiredCount,
            highPriorityHumanActions: executionPlan.highPriorityHumanActions,
            workflowCoverageScore: executionPlan.workflowCoverageScore,
            workflowStages: executionPlan.actions.map((item) => ({
              actionType: item.action.type,
              stageCount: item.workflowStages.length,
              matchedRules: item.matchedRuleIds.length,
              requiresHumanDecision: item.requiresHumanDecision,
              executionId: item.workflowRecord?.executionId,
              approvalStatus: item.workflowRecord?.approvalStatus,
              rollbackReady: item.workflowRecord?.rollbackReady,
            })),
            topActionDecision: executionPlan.actions[0]?.decision,
          }

          if (executionPlan.highPriorityHumanActions.length > 0) {
            const humanPriorityActions = executionPlan.highPriorityHumanActions
              .slice(0, 2)
              .map((action) => `P1 - HIGH RECOMMENDATION (HUMAN APPROVAL): ${action}`)

            finalBrief.actions = [
              ...humanPriorityActions,
              ...finalBrief.actions,
            ].slice(0, 10)

            finalBrief.alerts = [
              ...(finalBrief.alerts || []),
              {
                severity: 'critical',
                message: 'Order/stock-transfer actions require explicit human approval before execution.',
                actionRequired: 'Review high-priority recommendations and approve or reject each action manually',
              },
            ]
          }
        }
      } catch (error) {
        console.error('[Strategic] Failed to enrich advanced insights:', error)
      }

      finalBrief = applyResponsePolicyToBrief({
        brief: finalBrief,
        prompt: args.prompt,
        intent,
        grounding,
        responseGrounding,
        reliability,
        policy: responsePolicy,
      })

      await prisma.enterpriseAiMetric.createMany({
        data: [
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_external_provider_latency_ms',
            metricValue: modelOutput?.latencyMs || 0,
            dimensions: {
              provider: modelOutput?.provider || 'none',
              model: modelOutput?.model || 'none',
              attempts: modelOutput?.attempts || 0,
              intent,
              taskType: responsePolicy.taskType,
              responseMode: responsePolicy.responseMode,
            },
          },
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_grounding_quality_score',
            metricValue: groundingQualityScore,
            dimensions: {
              provider,
              coverageScore: grounding.coverageScore,
              intent,
              taskType: responsePolicy.taskType,
            },
          },
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_response_latency_ms',
            metricValue: Date.now() - startedAt,
            dimensions: {
              provider,
              fusionMethod: hybrid.fusionMethod,
              intent,
              responseMode: responsePolicy.responseMode,
            },
          },
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_hybrid_confidence',
            metricValue: hybrid.confidenceScore,
            dimensions: {
              fusionMethod: hybrid.fusionMethod,
              hasLLM: !!llmBrief,
              hasAutonomous: autonomousReport.predictiveAlerts.length > 0,
            },
          },
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_simulation_profit_spread',
            metricValue: finalBrief.scenarioAnalysis?.profitSpread || 0,
            dimensions: {
              hasScenario: !!finalBrief.scenarioAnalysis,
              bestScenario: finalBrief.scenarioAnalysis?.bestScenario || 'none',
              worstScenario: finalBrief.scenarioAnalysis?.worstScenario || 'none',
            },
          },
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_human_approval_required_count',
            metricValue: finalBrief.executionPlan?.approvalRequiredCount || 0,
            dimensions: {
              autoExecutableCount: finalBrief.executionPlan?.autoExecutableCount || 0,
              highPriorityHumanActions: finalBrief.executionPlan?.highPriorityHumanActions?.length || 0,
            },
          },
          {
            tenantId: args.tenantId,
            metricKey: 'assistant_workflow_rule_coverage_score',
            metricValue: finalBrief.executionPlan?.workflowCoverageScore || 0,
            dimensions: {
              workflowStageCount: finalBrief.executionPlan?.workflowStages?.reduce((sum, item) => sum + item.stageCount, 0) || 0,
              actionCount: finalBrief.executionPlan?.workflowStages?.length || 0,
            },
          },
        ],
      }).catch(() => {})

      await logAudit({
        tenantId: args.tenantId,
        userId: args.userId || 'system',
        action: 'ENTERPRISE_AI_ASSISTANT_QUERY',
        entity: 'AssistantQuery',
        newValues: {
          promptPreview: args.prompt.slice(0, 100),
          provider,
          fusionMethod: hybrid.fusionMethod,
          confidenceScore: hybrid.confidenceScore,
        },
        req: {} as never,
      }).catch(() => {})

      return {
        response: formatBriefAsText(finalBrief, responseGrounding.tenantInfo.name),
        brief: finalBrief,
        provider,
        modelVersion: `hybrid-v1-${hybrid.fusionMethod}`,
        grounding: responseGrounding,
        reliability,
      }
    }
  )
}