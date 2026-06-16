import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { logAudit } from '@/lib/audit'
import { buildAssistantGrounding } from '@/lib/enterprise-ai-assistant'
import { identifyLikelyRootCausesFromPrompt } from '@/lib/enterprise-ai-causal'
import { previewSimulationScenario, type SimulationType } from '@/lib/enterprise-ai-simulator'

const methodSchema = z.enum(['granger', 'did', 'synthetic']).optional()

const postSchema = z.object({
  simulationType: z.enum(['price_change', 'marketing_spend', 'inventory_change', 'staffing_change', 'expansion']),
  parameters: z.record(z.number()).optional(),
  confidenceLevel: z.number().min(0.5).max(0.99).optional(),
  name: z.string().max(120).optional(),
})

function resolvePrompt(searchParams: URLSearchParams): string {
  const prompt = searchParams.get('prompt')?.trim()
  if (prompt) return prompt

  const effect = (searchParams.get('effect') || searchParams.get('metric') || 'revenue').trim().toLowerCase()
  const cause = (searchParams.get('cause') || 'business drivers').trim().toLowerCase()
  return `Assess the causal drivers for ${effect}. Focus on whether ${cause} materially explains the trend.`
}

function mapMethodName(method: string | null | undefined): 'granger' | 'difference_in_differences' | 'synthetic_control' | null {
  if (method === 'granger') return 'granger'
  if (method === 'did') return 'difference_in_differences'
  if (method === 'synthetic') return 'synthetic_control'
  return null
}

function buildInterpretation(args: { pValue?: number; confidence: number; signal: string }): string {
  if (args.pValue !== undefined) {
    return args.pValue < 0.05
      ? `Statistically significant signal detected for ${args.signal} (p=${args.pValue.toFixed(3)}).`
      : `Signal observed for ${args.signal}, but it is not statistically significant at the 5% threshold (p=${args.pValue.toFixed(3)}).`
  }
  return `Directional signal detected for ${args.signal} with confidence ${Math.round(args.confidence * 100)}%.`
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const url = new URL(req.url)
    const requestedMethod = methodSchema.parse(url.searchParams.get('type') || undefined)
    const prompt = resolvePrompt(url.searchParams)
    const grounding = await buildAssistantGrounding(access.tenantId)
    const causal = await identifyLikelyRootCausesFromPrompt(prompt, grounding)
    const mappedMethod = mapMethodName(requestedMethod)
    const selectedMethod = mappedMethod
      ? causal.methods.find((method) => method.method === mappedMethod) || null
      : causal.methods[0] || null

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_CAUSAL_DIAGNOSTIC_GET',
      entity: 'EnterpriseAiCausalDiagnostic',
      newValues: {
        promptPreview: prompt.slice(0, 120),
        requestedMethod: requestedMethod || null,
      },
      req,
    })

    return NextResponse.json({
      data: {
        problem: causal.problem,
        confidenceScore: causal.confidenceScore,
        topCauses: causal.rootCauses.slice(0, 5),
        contributingFactors: causal.contributingFactors,
        interventions: causal.recommendedInterventions,
        methods: causal.methods,
        selectedMethod,
        significant: selectedMethod?.pValue !== undefined ? selectedMethod.pValue < 0.05 : selectedMethod ? selectedMethod.confidence >= 0.7 : false,
        interpretation: selectedMethod
          ? buildInterpretation({
              pValue: selectedMethod.pValue,
              confidence: selectedMethod.confidence,
              signal: selectedMethod.signal,
            })
          : 'No econometric method produced a strong enough signal for this query.',
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI CAUSAL GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = postSchema.parse(body)
    const grounding = await buildAssistantGrounding(access.tenantId)
    const simulation = await previewSimulationScenario({
      grounding,
      scenarioType: payload.simulationType as SimulationType,
      parameters: payload.parameters,
      confidence: payload.confidenceLevel,
      name: payload.name,
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_CAUSAL_SIMULATION_POST',
      entity: 'EnterpriseAiSimulationPreview',
      newValues: {
        simulationType: payload.simulationType,
        parameters: payload.parameters || {},
      },
      req,
    })

    return NextResponse.json({
      data: {
        scenario: simulation.scenario.name,
        pointEstimate: simulation.projectedProfit,
        projectedRevenue: simulation.projectedRevenue,
        projectedMargin: simulation.projectedMargin,
        confidenceInterval: [simulation.confidenceInterval.profitLow, simulation.confidenceInterval.profitHigh],
        percentile10: simulation.percentile10,
        percentile90: simulation.percentile90,
        calibrationScore: simulation.calibration?.calibrationScore || 0,
        historicalAccuracy: simulation.calibration?.historicalAccuracy || 0,
        recommendation: simulation.recommendation,
        interpretation: `Expected profit is ${simulation.projectedProfit.toFixed(2)} with a calibrated interval from ${simulation.confidenceInterval.profitLow.toFixed(2)} to ${simulation.confidenceInterval.profitHigh.toFixed(2)}.`,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI CAUSAL POST]', err)
    return apiError('Internal server error', 500)
  }
}