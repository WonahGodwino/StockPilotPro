import { prisma } from '@/lib/prisma'

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
}

function formatPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

// ============================================================
// TYPES
// ============================================================

type AssistantGrounding = {
  tenantId: string
  tenantInfo: {
    name: string
    businessType: string
    lifecycleStage: string
  }
  inventoryRiskItems: Array<{
    productId: string
    productName: string
    urgency: 'P1' | 'P2' | 'P3'
    currentStock: number
    daysToStockout: number | null
    suggestedReorderQty: number
    avgDailyDemand: number
    costPrice?: number
  }>
  profitability: {
    netProfit: number
    netMarginPct: number
    grossProfit: number
    grossMarginPct: number
    profitableProductCount: number
    lossMakingProductCount: number
  }
  expenseInsights: {
    expenseGrowthRate: number
    topExpenseCategories: Array<{ category: string; amount: number; pctOfTotal: number }>
    costToRevenueRatio: number
  }
  salesInsights: {
    salesTrend: 'increasing' | 'stable' | 'decreasing'
    transactionCount: number
    totalSales: number
    avgOrderValue: number
    topSellingProducts: Array<{ name: string; revenue: number }>
  }
  businessIntelligence?: {
    inventoryHealth: {
      inventoryTurnover: number
      daysOfInventory: number
      cashTiedInInventory: number
      totalStockValue: number
      slowMovingStockValue: number
      healthScore: number
    }
  }
  deltas: {
    revenuePct: number
    marginPct: number
    profitPct: number
  }
  current: {
    revenue: number
    margin: number
    profit: number
  }
  prior: {
    revenue: number
    margin: number
    profit: number
  }
  shortHorizonDeltas: {
    revenuePct: number
  }
  dataQuality: {
    completeness: number
    hasEnoughData: boolean
  }
  coverageScore: number
  freshnessHours: number | null
  productComparisons: Array<{
    productName: string
    marginPct: number
    currentProfit: number
    inventoryTurnover: number
  }>
  branchComparisons: Array<{
    branchName: string
    currentRevenue: number
    grossMarginPct: number
    revenueDeltaPct: number
    marginDeltaPct: number
  }>
}

type AssistantBrief = {
  summary: string
  comparativeInsights: string[]
  actions: string[]
  risks: string[]
  followUpQuestions: string[]
}

type HybridResponse = {
  finalResponse: string
  confidenceScore: number
  sources: {
    deterministic: { used: boolean; confidence: number; keyInsights: string[] }
    llm: { used: boolean; confidence: number; keyInsights: string[] }
    autonomous: { used: boolean; alerts: string[]; recommendations: string[] }
  }
  fusionMethod: 'llm_enhanced' | 'deterministic_fallback' | 'hybrid_balanced' | 'critical_override'
}

type ConfidenceScore = {
  overall: number
  dataQuality: number
  relevance: number
  actionability: number
  specificity: number
}

// ============================================================
// CONFIDENCE SCORING ENGINE
// ============================================================

function calculateConfidenceScores(
  grounding: AssistantGrounding,
  llmResponse: AssistantBrief | null,
  deterministicResponse: AssistantBrief
): ConfidenceScore {
  // Data Quality Score (0-100)
  let dataQualityScore = 70
  if (grounding.dataQuality.completeness > 0.7) dataQualityScore += 15
  else if (grounding.dataQuality.completeness < 0.3) dataQualityScore -= 20
  if (grounding.salesInsights.transactionCount > 100) dataQualityScore += 10
  if (grounding.salesInsights.transactionCount < 10) dataQualityScore -= 15
  if (grounding.freshnessHours && grounding.freshnessHours < 24) dataQualityScore += 5
  if (grounding.freshnessHours && grounding.freshnessHours > 168) dataQualityScore -= 10
  dataQualityScore = clamp(dataQualityScore, 0, 100)
  
  // Relevance Score
  let relevanceScore = 75
  const hasInventoryData = grounding.inventoryRiskItems.length > 0
  const hasSalesData = grounding.salesInsights.transactionCount > 0
  const hasProfitData = grounding.profitability.profitableProductCount > 0
  
  if (!hasInventoryData && !hasSalesData && !hasProfitData) relevanceScore -= 40
  if (hasInventoryData) relevanceScore += 10
  if (hasSalesData) relevanceScore += 10
  if (hasProfitData) relevanceScore += 10
  relevanceScore = clamp(relevanceScore, 0, 100)
  
  // Actionability Score
  let actionabilityScore = 65
  const hasP1Actions = deterministicResponse.actions.some(a => a.includes('P1'))
  const hasP2Actions = deterministicResponse.actions.some(a => a.includes('P2'))
  const hasQuantities = deterministicResponse.actions.some(a => /\d+/.test(a))
  const hasSpecificProducts = deterministicResponse.actions.some(a => /[A-Z][a-z]+/.test(a))
  
  if (hasP1Actions) actionabilityScore += 15
  if (hasP2Actions) actionabilityScore += 10
  if (hasQuantities) actionabilityScore += 10
  if (hasSpecificProducts) actionabilityScore += 10
  actionabilityScore = clamp(actionabilityScore, 0, 100)
  
  // Specificity Score
  let specificityScore = 60
  const hasNumbers = (deterministicResponse.summary.match(/\d+/g) || []).length
  const hasPercentages = deterministicResponse.summary.includes('%')
  const hasCurrency = deterministicResponse.summary.includes('$')
  
  if (hasNumbers > 5) specificityScore += 15
  if (hasPercentages) specificityScore += 10
  if (hasCurrency) specificityScore += 10
  specificityScore = clamp(specificityScore, 0, 100)
  
  // Overall confidence is weighted average
  const overall = (dataQualityScore * 0.3 + relevanceScore * 0.25 + actionabilityScore * 0.25 + specificityScore * 0.2)
  
  return {
    overall: round2(overall),
    dataQuality: round2(dataQualityScore),
    relevance: round2(relevanceScore),
    actionability: round2(actionabilityScore),
    specificity: round2(specificityScore),
  }
}

// ============================================================
// RESPONSE BUILDERS
// ============================================================

function buildCriticalOverrideResponse(
  deterministic: AssistantBrief,
  autonomous: any,
  grounding: AssistantGrounding
): string {
  const lines = [
    `🚨 ${grounding.tenantInfo.name.toUpperCase()} - CRITICAL ALERT`,
    '═'.repeat(60),
    '',
    '⚠️ IMMEDIATE ACTION REQUIRED',
    '─'.repeat(40),
    deterministic.summary,
    '',
    '🔴 CRITICAL ISSUES DETECTED:',
  ]
  
  // Add P1 items
  const p1Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')
  for (const item of p1Items) {
    lines.push(`  • ${item.productName}: Only ${item.currentStock} units left (${item.daysToStockout?.toFixed(0)} days)`)
    lines.push(`    → Action: Order ${item.suggestedReorderQty} units IMMEDIATELY`)
  }
  
  // Add net loss warning
  if (grounding.profitability.netMarginPct < 0) {
    lines.push(`  • BUSINESS OPERATING AT LOSS: ${formatCurrency(Math.abs(grounding.profitability.netProfit))} lost`)
    lines.push(`    → Action: Immediate cost and pricing review required`)
  }
  
  // Add expense spike
  if (grounding.expenseInsights.expenseGrowthRate > 50) {
    lines.push(`  • EXPENSE SPIKE: ${grounding.expenseInsights.expenseGrowthRate.toFixed(0)}% increase`)
    lines.push(`    → Action: Audit ${grounding.expenseInsights.topExpenseCategories[0]?.category} expenses`)
  }
  
  // Add autonomous alerts
  for (const alert of autonomous.predictiveAlerts?.slice(0, 2) || []) {
    if (alert.severity === 'critical') {
      lines.push(`  • ${alert.title}`)
      lines.push(`    → Action: ${alert.recommendedAction}`)
    }
  }
  
  lines.push(
    '',
    '✅ RECOMMENDED ACTIONS (Prioritized)',
    '─'.repeat(40),
    ...deterministic.actions.slice(0, 5).map(a => `  • ${a}`),
    '',
    '⚠️ RISKS IF IGNORED',
    '─'.repeat(40),
    ...deterministic.risks.slice(0, 3).map(r => `  • ${r}`),
  )
  
  return lines.join('\n')
}

function buildLLMEnhancedResponse(
  llm: AssistantBrief,
  deterministic: AssistantBrief,
  autonomous: any,
  grounding: AssistantGrounding
): string {
  const lines = [
    `📊 ${grounding.tenantInfo.name.toUpperCase()} - AI ENHANCED ANALYSIS`,
    '═'.repeat(60),
    '',
    llm.summary,
    '',
    '🔍 KEY INSIGHTS',
    '─'.repeat(40),
    ...llm.comparativeInsights.map(i => `  • ${i}`),
  ]
  
  // Add autonomous insights that LLM might have missed
  if (autonomous.predictiveAlerts && autonomous.predictiveAlerts.length > 0) {
    lines.push('', '🔮 PREDICTIVE INSIGHTS (AI-Generated)', '─'.repeat(40))
    for (const alert of autonomous.predictiveAlerts.slice(0, 2)) {
      lines.push(`  • ${alert.title}`)
      lines.push(`    → ${alert.description?.substring(0, 100) || ''}...`)
    }
  }
  
  if (autonomous.dataQualityIssues && autonomous.dataQualityIssues.length > 0) {
    lines.push('', '🔧 DATA QUALITY SUGGESTIONS', '─'.repeat(40))
    for (const issue of autonomous.dataQualityIssues.slice(0, 2)) {
      lines.push(`  • ${issue.description?.substring(0, 80) || ''}...`)
      lines.push(`    → Fix: ${issue.suggestedFix?.substring(0, 80) || ''}`)
    }
  }
  
  lines.push(
    '',
    '✅ RECOMMENDED ACTIONS',
    '─'.repeat(40),
    ...llm.actions.slice(0, 5).map(a => `  • ${a}`),
  )
  
  // Add deterministic precision actions if LLM missed them
  const llmActionSet = new Set(llm.actions.map(a => a.toLowerCase()))
  const missingActions = deterministic.actions.filter(a => !llmActionSet.has(a.toLowerCase()))
  if (missingActions.length > 0) {
    lines.push('', '⚡ ADDITIONAL PRECISION ACTIONS', '─'.repeat(40))
    for (const action of missingActions.slice(0, 2)) {
      lines.push(`  • ${action}`)
    }
  }
  
  return lines.join('\n')
}

function buildDeterministicEnhancedResponse(
  deterministic: AssistantBrief,
  autonomous: any,
  grounding: AssistantGrounding
): string {
  const lines = [
    `📊 ${grounding.tenantInfo.name.toUpperCase()} - DATA-DRIVEN ANALYSIS`,
    '═'.repeat(60),
    '',
    deterministic.summary,
    '',
    '🔍 KEY INSIGHTS',
    '─'.repeat(40),
    ...deterministic.comparativeInsights.map(i => `  • ${i}`),
  ]
  
  if (autonomous.predictiveAlerts && autonomous.predictiveAlerts.length > 0) {
    lines.push('', '🔮 PREDICTIVE ALERTS', '─'.repeat(40))
    for (const alert of autonomous.predictiveAlerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵'
      lines.push(`  ${icon} ${alert.title}`)
      lines.push(`     ${alert.recommendedAction}`)
    }
  }
  
  if (autonomous.purchaseRecommendations && autonomous.purchaseRecommendations.length > 0) {
    lines.push('', '📦 SMART PURCHASE RECOMMENDATIONS', '─'.repeat(40))
    for (const rec of autonomous.purchaseRecommendations.slice(0, 3)) {
      lines.push(`  • ${rec.productName}: Order ${rec.suggestedReorderQty} units at ${formatCurrency(rec.unitCostPrice)}/unit`)
      lines.push(`    → Est. Profit: ${formatCurrency(rec.estimatedProfit)} | Supplier: ${rec.bestSupplierSuggestion}`)
    }
  }
  
  lines.push(
    '',
    '✅ RECOMMENDED ACTIONS',
    '─'.repeat(40),
    ...deterministic.actions.slice(0, 5).map(a => `  • ${a}`),
  )
  
  return lines.join('\n')
}

function buildBalancedHybridResponse(
  llm: AssistantBrief,
  deterministic: AssistantBrief,
  autonomous: any,
  grounding: AssistantGrounding
): string {
  // Combine best insights from both
  const allInsights = [...new Set([...llm.comparativeInsights, ...deterministic.comparativeInsights])]
  const allActions = [...new Set([...llm.actions, ...deterministic.actions])]
  
  const lines = [
    `🔄 ${grounding.tenantInfo.name.toUpperCase()} - HYBRID INTELLIGENCE`,
    '═'.repeat(60),
    '',
    `📋 EXECUTIVE SUMMARY`,
    '─'.repeat(40),
    llm.summary,
    '',
    `🎯 CONFIDENCE SCORE: ${Math.round(grounding.coverageScore * 100)}% - ${grounding.coverageScore > 0.7 ? 'High confidence' : 'Moderate confidence'}`,
    '',
    '🔍 COMPREHENSIVE INSIGHTS',
    '─'.repeat(40),
    ...allInsights.slice(0, 7).map(i => `  • ${i}`),
  ]
  
  if (autonomous.predictiveAlerts && autonomous.predictiveAlerts.length > 0) {
    lines.push('', '⚠️ PREDICTIVE RISK ALERTS', '─'.repeat(40))
    for (const alert of autonomous.predictiveAlerts) {
      lines.push(`  • ${alert.title} - ${alert.recommendedAction}`)
    }
  }
  
  lines.push(
    '',
    '✅ ACTION PLAN',
    '─'.repeat(40),
    ...allActions.slice(0, 6).map((a, i) => {
      const priority = a.includes('P1') ? '🔴' : a.includes('P2') ? '🟡' : '🟢'
      return `  ${priority} ${a}`
    }),
  )
  
  if (autonomous.purchaseRecommendations && autonomous.purchaseRecommendations.length > 0) {
    lines.push('', '💰 FINANCIAL SUMMARY', '─'.repeat(40))
    const totalCost = autonomous.purchaseRecommendations.reduce((s: number, r: any) => s + (r.totalCost || 0), 0)
    const totalProfit = autonomous.purchaseRecommendations.reduce((s: number, r: any) => s + (r.estimatedProfit || 0), 0)
    lines.push(`  • Total Reorder Cost: ${formatCurrency(totalCost)}`)
    lines.push(`  • Expected Profit: ${formatCurrency(totalProfit)}`)
    if (totalCost > 0) {
      lines.push(`  • ROI: ${(totalProfit / totalCost * 100).toFixed(0)}%`)
    }
  }
  
  return lines.join('\n')
}

// ============================================================
// MAIN HYBRID FUSION ENGINE
// ============================================================

export async function generateHybridResponse(
  prompt: string,
  grounding: AssistantGrounding,
  llmBrief: AssistantBrief | null,
  deterministicBrief: AssistantBrief,
  autonomousInsights: {
    predictiveAlerts: any[]
    dataQualityIssues: any[]
    purchaseRecommendations: any[]
  }
): Promise<HybridResponse> {
  const confidence = calculateConfidenceScores(grounding, llmBrief, deterministicBrief)
  
  // Determine which source to prioritize
  let fusionMethod: HybridResponse['fusionMethod'] = 'hybrid_balanced'
  let finalResponse = ''
  
  // CASE 1: Critical issues detected - override everything with deterministic precision
  const hasCriticalIssues = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1').length > 0 ||
                           grounding.profitability.netMarginPct < -10 ||
                           grounding.expenseInsights.expenseGrowthRate > 50
  
  if (hasCriticalIssues && confidence.dataQuality > 60) {
    fusionMethod = 'critical_override'
    finalResponse = buildCriticalOverrideResponse(deterministicBrief, autonomousInsights, grounding)
  }
  // CASE 2: LLM available and high confidence - use LLM enhanced with deterministic data
  else if (llmBrief && confidence.overall > 65) {
    fusionMethod = 'llm_enhanced'
    finalResponse = buildLLMEnhancedResponse(llmBrief, deterministicBrief, autonomousInsights, grounding)
  }
  // CASE 3: LLM failed or low confidence - use deterministic with autonomous enhancements
  else if (!llmBrief || confidence.overall < 50) {
    fusionMethod = 'deterministic_fallback'
    finalResponse = buildDeterministicEnhancedResponse(deterministicBrief, autonomousInsights, grounding)
  }
  // CASE 4: Balanced hybrid - combine best of both
  else {
    fusionMethod = 'hybrid_balanced'
    finalResponse = buildBalancedHybridResponse(llmBrief!, deterministicBrief, autonomousInsights, grounding)
  }
  
  return {
    finalResponse,
    confidenceScore: confidence.overall,
    sources: {
      deterministic: {
        used: true,
        confidence: confidence.actionability,
        keyInsights: deterministicBrief.comparativeInsights.slice(0, 3),
      },
      llm: {
        used: llmBrief !== null,
        confidence: llmBrief ? confidence.relevance : 0,
        keyInsights: llmBrief ? llmBrief.comparativeInsights.slice(0, 3) : [],
      },
      autonomous: {
        used: autonomousInsights.predictiveAlerts.length > 0 || autonomousInsights.dataQualityIssues.length > 0,
        alerts: autonomousInsights.predictiveAlerts.slice(0, 2).map(a => a.title),
        recommendations: autonomousInsights.purchaseRecommendations.slice(0, 2).map(r => `${r.productName}: ${r.suggestedReorderQty} units`),
      },
    },
    fusionMethod,
  }
}