import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { logAudit } from '@/lib/audit'
import { generateEnterpriseAssistantResponse } from '@/lib/enterprise-ai-assistant'
import { resolveEnterpriseAiDataProviderContext } from '@/lib/enterprise-ai-external-data'
import { isUnsafeAssistantPrompt } from '@/lib/enterprise-ai-policy'
import { detectAndStoreBusinessType } from '@/lib/enterprise-ai-cognitive'

const assistantQuerySchema = z.object({
  prompt: z.string().min(1).max(2000),
  conversationId: z.string().max(120).optional(),
  includeActionItems: z.boolean().optional().default(true),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  
  try {
    const user = authenticate(req)
    const body = await req.json()
    const { prompt, conversationId, includeActionItems } = assistantQuerySchema.parse(body)
    
    const access = await requireEnterpriseAiAccess(user, ['AI_NATURAL_LANGUAGE_ASSISTANT'])
    
    if (isUnsafeAssistantPrompt(prompt)) {
      return NextResponse.json({
        data: {
          response: 'I cannot process requests containing potentially unsafe content. Please ask a business question.',
          actionItems: [],
          intent: 'UNSAFE',
        },
      })
    }
    
    // Detect business type asynchronously; do not block assistant response.
    detectAndStoreBusinessType(access.tenantId).catch(console.error)
    
    const assistantResult = await generateEnterpriseAssistantResponse({
      tenantId: access.tenantId,
      prompt,
      conversationId,
      userId: access.userId,
      userRole: user.role,
    })
    const providerContext = await resolveEnterpriseAiDataProviderContext(access.tenantId)
    const actualGroundingSource = assistantResult.grounding.groundingSource
    
    const isRestockIntent = assistantResult.brief.actions.some(
      (a) => a.toLowerCase().includes('reorder') || a.toLowerCase().includes('restock')
    )
    
    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId: access.tenantId,
        metricKey: 'assistant_response_latency_ms',
        metricValue: Date.now() - startTime,
        dimensions: {
          provider: assistantResult.provider,
          groundingSource: actualGroundingSource,
          configuredGroundingSource: providerContext.source,
          externalGroundingReady: providerContext.externalGroundingReady,
          intent: isRestockIntent ? 'RESTOCK' : 'GENERAL',
        },
      },
    }).catch(() => {})
    
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_ASSISTANT_QUERY',
      entity: 'AssistantQuery',
      newValues: {
        promptPreview: prompt.slice(0, 100),
        provider: assistantResult.provider,
        groundingSource: actualGroundingSource,
        configuredGroundingSource: providerContext.source,
        externalGroundingReady: providerContext.externalGroundingReady,
      },
      req,
    })
    
    return NextResponse.json({
      data: {
        response: assistantResult.response,
        currencyCode: assistantResult.grounding.tenantInfo.baseCurrency,
        actionItems: includeActionItems
          ? assistantResult.brief.actions.map((a) => ({ text: a, priority: 'P2' as const }))
          : [],
        intent: isRestockIntent ? 'RESTOCK' : 'GENERAL',
        provider: assistantResult.provider,
        brief: assistantResult.brief,
        groundingSource: actualGroundingSource,
        externalData: providerContext.externalConnection
          ? {
              providerType: providerContext.externalConnection.providerType,
              status: providerContext.externalConnection.status,
              validationState: providerContext.externalConnection.validationState,
              groundingEnabled: providerContext.externalConnection.groundingEnabled,
              externalGroundingReady: providerContext.externalGroundingReady,
              contractIssues: providerContext.externalConnection.contractIssues,
            }
          : null,
        reliability: assistantResult.reliability,
      },
    })
    
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[ASSISTANT ERROR]', err)
    return apiError('Internal server error', 500)
  }
}