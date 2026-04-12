import { prisma } from '@/lib/prisma'

// ============================================================
// TYPES
// ============================================================

type LocationContext = {
  country: string
  state: string | null
  city: string | null
  currency: string
  purchasingPowerMultiplier: number
  typicalLeadTimeDays: number
  commonSuppliers: string[]
}

type ProductPurchaseRecommendation = {
  productId: string
  productName: string
  category: string | null
  currentStock: number
  suggestedReorderQty: number
  unitCostPrice: number
  suggestedSellingPrice: number
  currentSellingPrice: number
  priceChangePercent: number
  estimatedMarginPct: number
  totalCost: number
  estimatedRevenue: number
  estimatedProfit: number
  priority: 'P1' | 'P2' | 'P3'
  reason: string
  bestSupplierSuggestion: string
  leadTimeEstimate: number
}

type DataQualityIssue = {
  id: string
  type: 'service_misclassified' | 'inventory_misconfigured' | 'pricing_anomaly' | 'missing_category'
  severity: 'critical' | 'warning' | 'info'
  description: string
  suggestedFix: string
  impact: string
}

type PredictiveAlert = {
  type: 'cash_exhaustion' | 'inventory_obsolescence' | 'stockout_risk' | 'margin_erosion'
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  currentValue: number
  projectedValue: number
  timeframeDays: number
  confidence: number
  recommendedAction: string
}

type GroundingInventoryRiskItem = {
  productId: string
  productName: string
  category: string | null
  currentStock: number
  soldUnits30: number
  avgDailyDemand: number
  daysToStockout: number | null
  suggestedReorderQty: number
  urgency: 'P1' | 'P2' | 'P3'
  stockValue: number
  costPrice?: number
  sellingPrice?: number
  daysOfInventory: number
}

type AssistantGrounding = {
  tenantId: string
  tenantInfo: { name: string }
  current: { revenue: number; margin: number }
  prior: { margin: number }
  deltas: { marginPct: number }
  inventoryRiskItems: GroundingInventoryRiskItem[]
  expenseInsights: { totalExpenses: number }
  profitability: { netProfit: number }
  productComparisons: Array<{ productName: string; marginPct: number }>
  businessIntelligence?: {
    inventoryHealth?: {
      cashTiedInInventory?: number
      slowMovingStockValue?: number
      daysOfInventory?: number
      inventoryTurnover?: number
    }
  }
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (typeof value === 'object') {
    const withToNumber = value as { toNumber?: () => number }
    if (typeof withToNumber.toNumber === 'function') {
      const parsed = withToNumber.toNumber()
      return Number.isFinite(parsed) ? parsed : 0
    }
  }

  return 0
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatCurrency(value: number): string {
  return `$${round2(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${round2(value / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${round2(value / 1_000_000)}M`
  if (abs >= 1_000) return `${round2(value / 1_000)}K`
  return round2(value).toString()
}

function normalizeCountryKey(country: string | null | undefined): string {
  const value = (country || '').trim().toUpperCase()
  const aliases: Record<string, string> = {
    'UNITED STATES': 'US',
    'UNITED STATES OF AMERICA': 'US',
    'USA': 'US',
    'NIGERIA': 'NG',
    'NGA': 'NG',
    'UNITED KINGDOM': 'GB',
    'UK': 'GB',
    'CANADA': 'CA',
    'AUSTRALIA': 'AU',
    'INDIA': 'IN',
    'KENYA': 'KE',
    'SOUTH AFRICA': 'ZA',
    'UAE': 'AE',
  }
  return aliases[value] || value || 'US'
}

// ============================================================
// LOCATION-AWARE PRICING ENGINE
// ============================================================

async function getLocationContext(tenantId: string): Promise<LocationContext> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { country: true, state: true, address: true, baseCurrency: true },
  })

  // Calculate purchasing power multiplier based on country
  const purchasingPowerMap: Record<string, number> = {
    'US': 1.0, 'USA': 1.0, 'United States': 1.0,
    'NG': 0.35, 'Nigeria': 0.35, 'NGA': 0.35,
    'GB': 0.85, 'UK': 0.85, 'United Kingdom': 0.85,
    'CA': 0.92, 'Canada': 0.92,
    'AU': 0.88, 'Australia': 0.88,
    'IN': 0.28, 'India': 0.28,
    'KE': 0.32, 'Kenya': 0.32,
    'ZA': 0.45, 'South Africa': 0.45,
    'AE': 0.95, 'UAE': 0.95,
  }
  
  const countryCode = normalizeCountryKey(tenant?.country)
  const purchasingPowerMultiplier = purchasingPowerMap[countryCode] || 0.7
  
  // Typical lead times by region
  const leadTimeMap: Record<string, number> = {
    'US': 3, 'USA': 3, 'United States': 3,
    'NG': 14, 'Nigeria': 14, 'NGA': 14,
    'GB': 4, 'UK': 4, 'United Kingdom': 4,
    'IN': 7, 'India': 7,
    'KE': 10, 'Kenya': 10,
    'ZA': 8, 'South Africa': 8,
  }
  
  return {
    country: tenant?.country || 'Unknown',
    state: tenant?.state || null,
    city: null,
    currency: tenant?.baseCurrency || 'USD',
    purchasingPowerMultiplier,
    typicalLeadTimeDays: leadTimeMap[countryCode] || 7,
    commonSuppliers: getLocalSuppliers(countryCode),
  }
}

function getLocalSuppliers(country: string): string[] {
  const suppliers: Record<string, string[]> = {
    'US': ['Amazon Business', 'Costco Wholesale', 'Walmart Business', 'Grainger', 'McMaster-Carr'],
    'NG': ['Konga Business', 'Jumia Global', 'Alibaba Express NG', 'Shoprite Nigeria', 'Pricepally'],
    'GB': ['Amazon UK', 'Costco UK', 'Booker Wholesale', 'Makro UK', 'Bestway'],
    'CA': ['Amazon Canada', 'Costco Canada', 'Walmart Canada', 'Loblaw', 'Sobeys'],
    'IN': ['Amazon India', 'Flipkart Wholesale', 'Udaan', 'JioMart', 'Metro Cash & Carry'],
    'KE': ['Jumia Kenya', 'Naivas', 'Carrefour Kenya', 'Khetias', 'Tuskys'],
    'ZA': ['Takealot', 'Makro SA', 'Game SA', 'Checkers', 'Pick n Pay'],
  }
  return suppliers[normalizeCountryKey(country)] || ['Local distributors', 'Online marketplaces', 'Direct manufacturers']
}

// ============================================================
// 1. AUTONOMOUS PURCHASE ORDER RECOMMENDATIONS (No DB write)
// ============================================================

export async function generatePurchaseRecommendations(
  grounding: AssistantGrounding
): Promise<{
  recommendations: ProductPurchaseRecommendation[]
  totalEstimatedCost: number
  totalEstimatedProfit: number
  summary: string
}> {
  const location = await getLocationContext(grounding.tenantId)
  const p1Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')
  const p2Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P2')
  
  const recommendations: ProductPurchaseRecommendation[] = []
  
  // Process P1 items (critical)
  for (const item of p1Items) {
    // Calculate location-adjusted pricing
    const baseCostPrice = item.costPrice || 10
    const locationAdjustedCost = baseCostPrice * location.purchasingPowerMultiplier
    const marketMarkup = 1.4 // 40% markup for retail
    
    const suggestedSellingPrice = round2(locationAdjustedCost * marketMarkup)
    const currentSellingPrice = item.costPrice ? item.costPrice * 1.5 : suggestedSellingPrice
    const priceChangePercent = ((suggestedSellingPrice - currentSellingPrice) / currentSellingPrice) * 100
    const estimatedMarginPct = ((suggestedSellingPrice - locationAdjustedCost) / suggestedSellingPrice) * 100
    
    recommendations.push({
      productId: item.productId,
      productName: item.productName,
      category: item.category,
      currentStock: item.currentStock,
      suggestedReorderQty: item.suggestedReorderQty,
      unitCostPrice: round2(locationAdjustedCost),
      suggestedSellingPrice,
      currentSellingPrice: round2(currentSellingPrice),
      priceChangePercent: round2(priceChangePercent),
      estimatedMarginPct: round2(estimatedMarginPct),
      totalCost: round2(item.suggestedReorderQty * locationAdjustedCost),
      estimatedRevenue: round2(item.suggestedReorderQty * suggestedSellingPrice),
      estimatedProfit: round2(item.suggestedReorderQty * (suggestedSellingPrice - locationAdjustedCost)),
      priority: 'P1',
      reason: `Stockout in ${item.daysToStockout?.toFixed(0)} days. ${location.country} market price adjusted.`,
      bestSupplierSuggestion: location.commonSuppliers[0],
      leadTimeEstimate: location.typicalLeadTimeDays,
    })
  }
  
  // Process P2 items (important)
  for (const item of p2Items.slice(0, 10)) {
    const baseCostPrice = item.costPrice || 10
    const locationAdjustedCost = baseCostPrice * location.purchasingPowerMultiplier
    const marketMarkup = 1.35 // 35% markup
    
    const suggestedSellingPrice = round2(locationAdjustedCost * marketMarkup)
    const currentSellingPrice = item.costPrice ? item.costPrice * 1.5 : suggestedSellingPrice
    
    recommendations.push({
      productId: item.productId,
      productName: item.productName,
      category: item.category,
      currentStock: item.currentStock,
      suggestedReorderQty: item.suggestedReorderQty,
      unitCostPrice: round2(locationAdjustedCost),
      suggestedSellingPrice,
      currentSellingPrice: round2(currentSellingPrice),
      priceChangePercent: round2(((suggestedSellingPrice - currentSellingPrice) / currentSellingPrice) * 100),
      estimatedMarginPct: round2(((suggestedSellingPrice - locationAdjustedCost) / suggestedSellingPrice) * 100),
      totalCost: round2(item.suggestedReorderQty * locationAdjustedCost),
      estimatedRevenue: round2(item.suggestedReorderQty * suggestedSellingPrice),
      estimatedProfit: round2(item.suggestedReorderQty * (suggestedSellingPrice - locationAdjustedCost)),
      priority: 'P2',
      reason: `Restock within ${item.daysToStockout?.toFixed(0)} days. ${location.country} pricing applied.`,
      bestSupplierSuggestion: location.commonSuppliers[1] || location.commonSuppliers[0],
      leadTimeEstimate: location.typicalLeadTimeDays,
    })
  }
  
  const totalEstimatedCost = recommendations.reduce((sum, r) => sum + r.totalCost, 0)
  const totalEstimatedProfit = recommendations.reduce((sum, r) => sum + r.estimatedProfit, 0)
  
  let summary = `📦 PURCHASE ORDER RECOMMENDATIONS for ${grounding.tenantInfo.name} (${location.country})\n`
  summary += `═══════════════════════════════════════════════════════════════\n\n`
  summary += `📍 Location Context: ${location.country}${location.state ? `, ${location.state}` : ''}\n`
  summary += `💰 Currency: ${location.currency} | Purchasing Power: ${(location.purchasingPowerMultiplier * 100).toFixed(0)}% of US\n`
  summary += `🚚 Typical Lead Time: ${location.typicalLeadTimeDays} days\n`
  summary += `🏪 Recommended Suppliers: ${location.commonSuppliers.slice(0, 3).join(', ')}\n\n`
  summary += `📋 RECOMMENDED ORDERS:\n`
  
  for (const rec of recommendations) {
    summary += `\n${rec.priority === 'P1' ? '🔴' : '🟡'} ${rec.productName} (${rec.category || 'uncategorized'})\n`
    summary += `   ├─ Current Stock: ${rec.currentStock} units\n`
    summary += `   ├─ Reorder Qty: ${rec.suggestedReorderQty} units\n`
    summary += `   ├─ Unit Cost: ${formatCurrency(rec.unitCostPrice)} (${location.country} adjusted)\n`
    summary += `   ├─ Suggested Selling: ${formatCurrency(rec.suggestedSellingPrice)} (${rec.priceChangePercent > 0 ? '+' : ''}${rec.priceChangePercent}% vs current)\n`
    summary += `   ├─ Expected Margin: ${rec.estimatedMarginPct.toFixed(0)}%\n`
    summary += `   ├─ Total Cost: ${formatCurrency(rec.totalCost)}\n`
    summary += `   ├─ Est. Revenue: ${formatCurrency(rec.estimatedRevenue)}\n`
    summary += `   ├─ Est. Profit: ${formatCurrency(rec.estimatedProfit)}\n`
    summary += `   ├─ Best Supplier: ${rec.bestSupplierSuggestion}\n`
    summary += `   └─ Lead Time: ${rec.leadTimeEstimate} days\n`
  }
  
  summary += `\n📊 SUMMARY:\n`
  summary += `   ├─ Total Order Cost: ${formatCurrency(totalEstimatedCost)}\n`
  summary += `   ├─ Expected Revenue: ${formatCurrency(totalEstimatedProfit + totalEstimatedCost)}\n`
  summary += `   └─ Expected Profit: ${formatCurrency(totalEstimatedProfit)}\n`
  
  return { recommendations, totalEstimatedCost, totalEstimatedProfit, summary }
}

// ============================================================
// 2. DATA QUALITY AUTO-FIX SUGGESTIONS
// ============================================================

export async function detectDataQualityIssues(
  grounding: AssistantGrounding
): Promise<DataQualityIssue[]> {
  const issues: DataQualityIssue[] = []
  
  // Check for services misclassified as goods
  const products = await prisma.product.findMany({
    where: { tenantId: grounding.tenantId, archived: false },
    select: { id: true, name: true, type: true, category: true, quantity: true },
    take: 100,
  })
  
  for (const product of products) {
    // Service detection keywords
    const serviceKeywords = ['support', 'consulting', 'hour', 'service', 'maintenance', 'subscription', 'license', 'training', 'setup', 'installation', 'warranty']
    const isLikelyService = serviceKeywords.some(kw => product.name.toLowerCase().includes(kw))
    
    if (isLikelyService && product.type === 'GOODS') {
      issues.push({
        id: product.id,
        type: 'service_misclassified',
        severity: 'critical',
        description: `"${product.name}" is classified as GOODS but appears to be a SERVICE`,
        suggestedFix: `Change product type from GOODS to SERVICE. Set quantity to 0 or remove stock tracking.`,
        impact: `Currently showing ${product.quantity} units in inventory for a service - skews turnover and stock metrics.`,
      })
    }
    
    // Check for missing categories
    if (!product.category || product.category === 'Uncategorized' || product.category === '') {
      issues.push({
        id: product.id,
        type: 'missing_category',
        severity: 'warning',
        description: `"${product.name}" has no category assigned`,
        suggestedFix: `Assign to appropriate category based on product name: suggest "${suggestCategory(product.name)}"`,
        impact: `Without categories, profitability analysis by category is incomplete.`,
      })
    }
  }
  
  // Check for pricing anomalies
  const productsWithPricing = await prisma.product.findMany({
    where: { tenantId: grounding.tenantId, archived: false },
    select: { id: true, name: true, costPrice: true, sellingPrice: true },
    take: 50,
  })
  
  for (const product of productsWithPricing) {
    const cost = toNumber(product.costPrice)
    const price = toNumber(product.sellingPrice)
    
    if (cost > 0 && price <= cost) {
      issues.push({
        id: product.id,
        type: 'pricing_anomaly',
        severity: 'warning',
        description: `"${product.name}" sells at or below cost (Cost: ${formatCurrency(cost)}, Price: ${formatCurrency(price)})`,
        suggestedFix: `Increase selling price to at least ${formatCurrency(cost * 1.2)} (20% margin) or review cost price`,
        impact: `Each sale loses ${formatCurrency(Math.abs(price - cost))} - negative margin product.`,
      })
    }
    
    if (price > cost * 5 && cost > 0) {
      issues.push({
        id: product.id,
        type: 'pricing_anomaly',
        severity: 'info',
        description: `"${product.name}" has unusually high margin (${((price - cost) / price * 100).toFixed(0)}%)`,
        suggestedFix: `Verify pricing is competitive - consider if volume could increase with lower price`,
        impact: `High margin but potentially missing volume opportunities.`,
      })
    }
  }
  
  // Check for inventory with no sales
  const slowestItems = grounding.inventoryRiskItems.filter(i => i.soldUnits30 === 0 && i.currentStock > 0)
  for (const item of slowestItems.slice(0, 5)) {
    issues.push({
      id: item.productId,
      type: 'inventory_misconfigured',
      severity: 'warning',
      description: `"${item.productName}" has ${item.currentStock} units in stock but ZERO sales in 30 days`,
      suggestedFix: `Review if this product is still needed. Consider clearance sale or return to supplier.`,
      impact: `Ties up ${formatCurrency(item.stockValue)} in non-moving inventory.`,
    })
  }
  
  return issues
}

function suggestCategory(productName: string): string {
  const name = productName.toLowerCase()
  if (name.includes('laptop') || name.includes('computer') || name.includes('monitor')) return 'Electronics'
  if (name.includes('keyboard') || name.includes('mouse')) return 'Peripherals'
  if (name.includes('support') || name.includes('consulting')) return 'Services'
  if (name.includes('software') || name.includes('license')) return 'Software'
  return 'General Merchandise'
}

// ============================================================
// 3. PREDICTIVE ALERTS (Cash Exhaustion, Inventory, etc.)
// ============================================================

export async function generatePredictiveAlerts(
  grounding: AssistantGrounding
): Promise<PredictiveAlert[]> {
  const alerts: PredictiveAlert[] = []
  
  // 1. CASH EXHAUSTION ALERT
  const cashTiedInInventory = grounding.businessIntelligence?.inventoryHealth?.cashTiedInInventory || 0
  const monthlyRevenue = grounding.current.revenue
  const monthlyExpenses = grounding.expenseInsights.totalExpenses
  const monthlyBurn = monthlyExpenses - (grounding.profitability.netProfit > 0 ? grounding.profitability.netProfit : 0)
  
  // Estimate cash runway based on inventory cash tied
  const estimatedMonthlyOperatingCost = Math.max(monthlyExpenses, monthlyRevenue * 0.7)
  let cashRunwayMonths = 0
  if (estimatedMonthlyOperatingCost > 0) {
    cashRunwayMonths = cashTiedInInventory / estimatedMonthlyOperatingCost
  }
  
  if (cashRunwayMonths < 3 && cashRunwayMonths > 0) {
    alerts.push({
      type: 'cash_exhaustion',
      severity: cashRunwayMonths < 1.5 ? 'critical' : 'warning',
      title: `💰 Cash Exhaustion Warning - ${cashRunwayMonths.toFixed(1)} months remaining`,
      description: `$${formatCompactNumber(cashTiedInInventory)} is tied up in inventory. At current burn rate of ${formatCurrency(estimatedMonthlyOperatingCost)}/month, cash will be exhausted in ${cashRunwayMonths.toFixed(1)} months.`,
      currentValue: cashTiedInInventory,
      projectedValue: 0,
      timeframeDays: Math.round(cashRunwayMonths * 30),
      confidence: 0.75,
      recommendedAction: `Clear slow-moving inventory (${formatCurrency(grounding.businessIntelligence?.inventoryHealth?.slowMovingStockValue || 0)} value) with 20-30% discounts. Negotiate extended payment terms with suppliers.`,
    })
  }
  
  // 2. INVENTORY OBSOLESCENCE ALERT
  const daysOfInventory = grounding.businessIntelligence?.inventoryHealth?.daysOfInventory || 0
  
  if (daysOfInventory > 180) {
    const obsolescenceRisk = Math.min(0.95, daysOfInventory / 1000)
    alerts.push({
      type: 'inventory_obsolescence',
      severity: daysOfInventory > 365 ? 'critical' : 'warning',
      title: `📦 Inventory Obsolescence Risk - ${daysOfInventory.toFixed(0)} days of stock`,
      description: `Current inventory would take ${daysOfInventory.toFixed(0)} days to sell at current velocity. ${(obsolescenceRisk * 100).toFixed(0)}% risk of product obsolescence or expiry.`,
      currentValue: daysOfInventory,
      projectedValue: daysOfInventory * 1.2,
      timeframeDays: 90,
      confidence: 0.8,
      recommendedAction: `Immediate 30% clearance on items with >${daysOfInventory} days of inventory. Focus on ${grounding.inventoryRiskItems.filter(i => i.daysOfInventory > 180).slice(0, 3).map(i => i.productName).join(', ')}.`,
    })
  }
  
  // 3. STOCKOUT RISK ALERT (Forward-looking)
  const p1Items = grounding.inventoryRiskItems.filter(i => i.urgency === 'P1')
  if (p1Items.length > 0) {
    const earliestStockout = Math.min(...p1Items.map(i => i.daysToStockout || 999))
    alerts.push({
      type: 'stockout_risk',
      severity: earliestStockout <= 2 ? 'critical' : 'warning',
      title: `⚠️ Stockout Risk - ${p1Items.length} products at risk in ${earliestStockout.toFixed(0)} days`,
      description: `${p1Items.map(i => i.productName).join(', ')} will run out of stock within ${earliestStockout.toFixed(0)} days. Estimated lost sales: ${formatCurrency(p1Items.reduce((sum, i) => sum + (i.avgDailyDemand * (i.sellingPrice || 10) * 7), 0))}.`,
      currentValue: earliestStockout,
      projectedValue: 0,
      timeframeDays: earliestStockout,
      confidence: 0.9,
      recommendedAction: `Place emergency orders for: ${p1Items.map(i => `${i.productName} (${i.suggestedReorderQty} units)`).join(', ')}. Use expedited shipping.`,
    })
  }
  
  // 4. MARGIN EROSION ALERT
  const marginChange = grounding.deltas.marginPct
  if (marginChange < -10) {
    alerts.push({
      type: 'margin_erosion',
      severity: marginChange < -20 ? 'critical' : 'warning',
      title: `📉 Margin Erosion Alert - Down ${Math.abs(marginChange).toFixed(0)}%`,
      description: `Gross margin has declined from ${grounding.prior.margin.toFixed(1)}% to ${grounding.current.margin.toFixed(1)}% in the last 30 days.`,
      currentValue: grounding.current.margin,
      projectedValue: grounding.current.margin * (1 + marginChange / 100),
      timeframeDays: 30,
      confidence: 0.7,
      recommendedAction: `Review cost of goods sold for ${grounding.productComparisons.filter(p => p.marginPct < 15).slice(0, 3).map(p => p.productName).join(', ')}. Renegotiate supplier pricing.`,
    })
  }
  
  return alerts
}

// ============================================================
// EXPORT FORMATTED RESPONSES
// ============================================================

export async function generateAutonomousReport(grounding: AssistantGrounding): Promise<{
  purchaseRecommendations: Awaited<ReturnType<typeof generatePurchaseRecommendations>>
  dataQualityIssues: DataQualityIssue[]
  predictiveAlerts: PredictiveAlert[]
  formattedResponse: string
}> {
  const [purchaseRecommendations, dataQualityIssues, predictiveAlerts] = await Promise.all([
    generatePurchaseRecommendations(grounding),
    detectDataQualityIssues(grounding),
    generatePredictiveAlerts(grounding),
  ])
  
  let formattedResponse = ''
  
  // Add Predictive Alerts section
  if (predictiveAlerts.length > 0) {
    formattedResponse += `\n🔮 PREDICTIVE ALERTS\n`
    formattedResponse += `═══════════════════════════════════════\n\n`
    for (const alert of predictiveAlerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵'
      formattedResponse += `${icon} ${alert.title}\n`
      formattedResponse += `   ${alert.description}\n`
      formattedResponse += `   → Recommended Action: ${alert.recommendedAction}\n`
      formattedResponse += `   → Confidence: ${(alert.confidence * 100).toFixed(0)}% | Timeframe: ${alert.timeframeDays} days\n\n`
    }
  }
  
  // Add Data Quality Issues section
  if (dataQualityIssues.length > 0) {
    formattedResponse += `\n🔧 DATA QUALITY SUGGESTIONS\n`
    formattedResponse += `═══════════════════════════════════════\n\n`
    for (const issue of dataQualityIssues.slice(0, 5)) {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵'
      formattedResponse += `${icon} ${issue.description}\n`
      formattedResponse += `   → Fix: ${issue.suggestedFix}\n`
      formattedResponse += `   → Impact: ${issue.impact}\n\n`
    }
  }
  
  // Add Purchase Recommendations
  if (purchaseRecommendations.recommendations.length > 0) {
    formattedResponse += purchaseRecommendations.summary
  }
  
  return {
    purchaseRecommendations,
    dataQualityIssues,
    predictiveAlerts,
    formattedResponse,
  }
}