import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'

function isMissingAnonymousLearningTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const maybeError = error as { code?: string; meta?: { table?: string } }
  if (maybeError.code !== 'P2021') return false

  const tableName = String(maybeError.meta?.table || '')
  return /AnonymousLearning/i.test(tableName)
}

type AnonymizedInsight = {
  insightType: string
  businessType: string
  region: string | null
  metricKey: string
  metricValue: any
}

export class CognitiveLearningEngine {
  private static instance: CognitiveLearningEngine
  
  static getInstance(): CognitiveLearningEngine {
    if (!CognitiveLearningEngine.instance) {
      CognitiveLearningEngine.instance = new CognitiveLearningEngine()
    }
    return CognitiveLearningEngine.instance
  }
  
  async contributeInsight(
    tenantId: string,
    businessType: string,
    insight: Omit<AnonymizedInsight, 'confidence'>
  ): Promise<void> {
    const anonymized = {
      insightType: insight.insightType,
      businessType: insight.businessType,
      region: insight.region ? insight.region.split(',')[0].trim() : null,
      metricKey: insight.metricKey,
      metricValue: this.anonymizeValue(insight.metricValue),
    }
    
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.anonymousLearning.findUnique({
          where: {
            insightType_businessType_metricKey: {
              insightType: anonymized.insightType,
              businessType: anonymized.businessType,
              metricKey: anonymized.metricKey,
            },
          },
        })
        
        if (existing) {
          const newSampleCount = existing.sampleCount + 1
          const newValue = this.weightedAverage(
            existing.metricValue,
            anonymized.metricValue,
            existing.sampleCount,
            1
          )
          await tx.anonymousLearning.update({
            where: { id: existing.id },
            data: {
              metricValue: newValue,
              sampleCount: newSampleCount,
              confidenceScore: Math.min(0.95, existing.confidenceScore + 0.01),
              updatedAt: new Date(),
            },
          })
        } else {
          await tx.anonymousLearning.create({
            data: {
              insightType: anonymized.insightType,
              businessType: anonymized.businessType,
              region: anonymized.region,
              metricKey: anonymized.metricKey,
              metricValue: anonymized.metricValue,
              sampleCount: 1,
              confidenceScore: 0.5,
            },
          })
        }
      })
    } catch (error) {
      if (isMissingAnonymousLearningTableError(error)) {
        // Fail open until migration is applied; AI assistant should keep working.
        console.warn('[CognitiveLearningEngine] AnonymousLearning table missing; skipping insight contribution.')
        return
      }
      throw error
    }
  }
  
  async getBenchmark(
    businessType: string,
    metricKey: string,
    region?: string
  ): Promise<{ value: any; confidence: number; sampleCount: number } | null> {
    try {
      const insight = await prisma.anonymousLearning.findFirst({
        where: {
          businessType,
          metricKey,
          ...(region ? { region: region.split(',')[0].trim() } : {}),
          validTo: { gte: new Date() },
        },
        orderBy: { confidenceScore: 'desc' },
      })
      if (!insight) return null
      return {
        value: insight.metricValue,
        confidence: insight.confidenceScore,
        sampleCount: insight.sampleCount,
      }
    } catch (error) {
      if (isMissingAnonymousLearningTableError(error)) {
        console.warn('[CognitiveLearningEngine] AnonymousLearning table missing; benchmark unavailable.')
        return null
      }
      throw error
    }
  }
  
  private anonymizeValue(value: any): any {
    if (typeof value === 'number') return Math.round(value * 100) / 100
    if (Array.isArray(value)) return value.slice(0, 10)
    if (typeof value === 'object') {
      const result: any = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v
      }
      return result
    }
    return value
  }
  
  private weightedAverage(current: any, newValue: any, currentWeight: number, newWeight: number): any {
    if (typeof current === 'number' && typeof newValue === 'number') {
      return (current * currentWeight + newValue * newWeight) / (currentWeight + newWeight)
    }
    if (typeof current === 'object' && typeof newValue === 'object') {
      const result: any = {}
      const allKeys = new Set([...Object.keys(current), ...Object.keys(newValue)])
      for (const key of allKeys) {
        if (current[key] !== undefined && newValue[key] !== undefined) {
          result[key] = this.weightedAverage(current[key], newValue[key], currentWeight, newWeight)
        } else if (current[key] !== undefined) {
          result[key] = current[key]
        } else {
          result[key] = newValue[key]
        }
      }
      return result
    }
    return newValue
  }
}

export async function detectAndStoreBusinessType(tenantId: string): Promise<{
  primaryType: string
  secondaryTypes: string[]
  confidence: number
}> {
  const [tenant, products, salesAgg, expenses] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, country: true, state: true } }),
    prisma.product.findMany({ where: { tenantId, archived: false }, select: { type: true, category: true }, take: 500 }),
    prisma.sale.aggregate({ where: { tenantId, archived: false }, _count: true, _avg: { totalAmount: true } }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { tenantId, archived: false },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 20,
    }),
  ])

  const hasGoods = products.some(p => p.type === 'GOODS')
  const hasServices = products.some(p => p.type === 'SERVICE')
  const productCount = products.length
  const avgOrderValue = Number(salesAgg._avg.totalAmount || 0)

  let primaryType = 'UNKNOWN'
  let confidence = 0.5
  const secondaryTypes: string[] = []

  if (hasGoods && productCount > 100 && avgOrderValue > 500) {
    primaryType = 'WHOLESALE'
    confidence = 0.85
  } else if (hasGoods && productCount > 50 && avgOrderValue < 200) {
    primaryType = 'RETAIL'
    confidence = 0.8
  } else if (hasGoods && productCount <= 20 && productCount > 0) {
    primaryType = 'HOSPITALITY'
    confidence = 0.75
  } else if (!hasGoods && hasServices) {
    primaryType = 'SERVICE'
    confidence = 0.7
  } else if (hasGoods && hasServices && productCount > 50) {
    primaryType = 'RETAIL'
    confidence = 0.7
    secondaryTypes.push('SERVICE_INTEGRATION')
  }

  const existing = await prisma.businessTypeMapping.findUnique({ where: { tenantId } })
  
  if (existing?.verifiedBy) {
    return { primaryType: existing.primaryType, secondaryTypes: existing.secondaryTypes as string[], confidence: 1.0 }
  }
  
  if (existing) {
    await prisma.businessTypeMapping.update({
      where: { tenantId },
      data: { primaryType, secondaryTypes, confidence, updatedAt: new Date() },
    })
  } else {
    await prisma.businessTypeMapping.create({ data: { tenantId, primaryType, secondaryTypes, confidence } })
  }
  
  return { primaryType, secondaryTypes, confidence }
}

export async function initializeDefaultRules(createdBy: string): Promise<void> {
  const existing = await prisma.autonomousRule.count()
  if (existing > 0) return
  
  const rules = [
    { name: 'Critical Stockout Auto-Reorder', trigger: 'stockout_risk', condition: { type: 'stockout_risk', threshold: 1 }, action: 'auto_reorder', parameters: {}, priority: 100, requiresApproval: true, maxAutoAmount: 5000 },
    { name: 'Margin Drop Alert', trigger: 'margin_drop', condition: { type: 'margin_drop', threshold: -15 }, action: 'create_alert', parameters: { alertTitle: 'Margin Drop Detected', alertMessage: 'Business margin has dropped significantly.' }, priority: 80, requiresApproval: false, maxAutoAmount: 0 },
    { name: 'Expense Spike Detection', trigger: 'expense_spike', condition: { type: 'expense_spike', threshold: 30 }, action: 'create_alert', parameters: { alertTitle: 'Unusual Expense Growth', alertMessage: 'Expenses have grown significantly.' }, priority: 70, requiresApproval: false, maxAutoAmount: 0 },
    { name: 'Sales Decline Alert', trigger: 'sales_decline', condition: { type: 'sales_decline', threshold: 20 }, action: 'create_alert', parameters: { alertTitle: 'Sales Decline Detected', alertMessage: 'Sales are declining.' }, priority: 60, requiresApproval: false, maxAutoAmount: 0 },
  ]
  
  for (const rule of rules) {
    await prisma.autonomousRule.create({ data: { ...rule, createdBy } })
  }
}

export const cognitiveEngine = CognitiveLearningEngine.getInstance()