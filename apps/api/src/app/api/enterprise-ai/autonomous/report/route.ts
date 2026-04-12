import { NextRequest, NextResponse } from 'next/server'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { buildAssistantGrounding } from '@/lib/enterprise-ai-assistant'
import { generateAutonomousReport } from '../../../../../lib/enterprise-ai-autonomous'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['AI_NATURAL_LANGUAGE_ASSISTANT'])
    
    // Build current grounding data
    const grounding = await buildAssistantGrounding(access.tenantId)
    
    // Generate autonomous report
    const report = await generateAutonomousReport(grounding)
    
    return NextResponse.json({
      data: {
        predictiveAlerts: report.predictiveAlerts,
        dataQualityIssues: report.dataQualityIssues,
        purchaseRecommendations: {
          items: report.purchaseRecommendations.recommendations,
          totalCost: report.purchaseRecommendations.totalEstimatedCost,
          totalProfit: report.purchaseRecommendations.totalEstimatedProfit,
          summary: report.purchaseRecommendations.summary,
        },
        formattedResponse: report.formattedResponse,
      },
    })
    
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[AUTONOMOUS REPORT ERROR]', err)
    return apiError('Internal server error', 500)
  }
}