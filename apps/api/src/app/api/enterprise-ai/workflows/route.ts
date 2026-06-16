import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { logAudit } from '@/lib/audit'
import {
  backfillLegacyWorkflowRulesForTenant,
  createWorkflowDefinition,
  listWorkflowDashboard,
  rollbackWorkflowExecution,
  reviewWorkflowExecution,
  triggerWorkflowExecution,
  type WorkflowDefinitionStep,
} from '@/lib/enterprise-ai-autonomous-executor'
import { prisma } from '@/lib/prisma'

const workflowStepSchema: z.ZodType<WorkflowDefinitionStep> = z.object({
  id: z.string().min(1),
  type: z.enum(['condition', 'human_approval', 'api_call', 'notification', 'rollback', 'audit']),
  name: z.string().min(1),
  onFailure: z.enum(['abort', 'continue', 'escalate']),
  config: z.record(z.unknown()).optional(),
  timeoutMinutes: z.number().int().min(0).optional(),
  retryCount: z.number().int().min(0).optional(),
})

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    parameters: z.object({
      name: z.string().min(1),
      trigger: z.string().min(1),
      description: z.string().max(500).optional(),
      requiresApproval: z.boolean().optional(),
      maxCost: z.number().min(0).optional(),
      priority: z.number().int().min(0).max(1000).optional(),
      auditLevel: z.enum(['full', 'summary', 'none']).optional(),
      steps: z.array(workflowStepSchema).min(1),
      rollbackSteps: z.array(workflowStepSchema).optional(),
    }),
  }),
  z.object({
    action: z.literal('trigger'),
    workflowId: z.string().min(1),
    parameters: z.record(z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('toggle'),
    workflowId: z.string().min(1),
    isActive: z.boolean(),
  }),
])

const patchSchema = z.union([
  z.object({
    executionId: z.string().min(1),
    approved: z.boolean(),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('rollback'),
    executionId: z.string().min(1),
    notes: z.string().max(500).optional(),
  }),
])

function canManageWorkflow(userRole: string): boolean {
  return userRole === 'SUPER_ADMIN' || userRole === 'BUSINESS_ADMIN'
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!canManageWorkflow(user.role)) return apiError('Forbidden', 403)
    const access = await requireEnterpriseAiAccess(user)
    const url = new URL(req.url)
    const executionId = url.searchParams.get('executionId') || undefined
    const status = url.searchParams.get('status') || undefined
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)))

    const data = await listWorkflowDashboard({
      tenantId: access.tenantId,
      executionId,
      status,
      limit,
    })

    if (executionId && !data) return apiError('Execution not found', 404)
    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI WORKFLOWS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!canManageWorkflow(user.role)) return apiError('Forbidden', 403)
    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = postSchema.parse(body)

    if (payload.action === 'create') {
      const data = await createWorkflowDefinition({
        ...payload.parameters,
        createdBy: access.userId,
        tenantId: access.tenantId,
      })

      await logAudit({
        tenantId: access.tenantId,
        userId: access.userId,
        action: 'ENTERPRISE_AI_WORKFLOW_CREATE',
        entity: 'AutonomousRule',
        entityId: data.id,
        newValues: { trigger: data.trigger, name: data.name },
        req,
      })

      return NextResponse.json({ data }, { status: 201 })
    }

    if (payload.action === 'trigger') {
      const data = await triggerWorkflowExecution({
        workflowId: payload.workflowId,
        tenantId: access.tenantId,
        userId: access.userId,
        context: payload.parameters,
      })
      return NextResponse.json({ data }, { status: 201 })
    }

    await backfillLegacyWorkflowRulesForTenant(access.tenantId)

    const existingRule = await prisma.autonomousRule.findFirst({
      where: {
        id: payload.workflowId,
        condition: {
          path: ['tenantId'],
          equals: access.tenantId,
        },
      },
      select: { id: true },
    })
    if (!existingRule) return apiError('Workflow not found', 404)

    const updated = await prisma.autonomousRule.update({
      where: { id: existingRule.id },
      data: { isActive: payload.isActive },
      select: {
        id: true,
        name: true,
        trigger: true,
        isActive: true,
        updatedAt: true,
      },
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_WORKFLOW_TOGGLE',
      entity: 'AutonomousRule',
      entityId: updated.id,
      newValues: { isActive: updated.isActive },
      req,
    })

    return NextResponse.json({ data: { ...updated, updatedAt: updated.updatedAt.toISOString() } })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI WORKFLOWS POST]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!canManageWorkflow(user.role)) return apiError('Forbidden', 403)
    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = patchSchema.parse(body)

    if ('action' in payload && payload.action === 'rollback') {
      const data = await rollbackWorkflowExecution({
        executionId: payload.executionId,
        tenantId: access.tenantId,
        userId: access.userId,
        note: payload.notes,
      })

      return NextResponse.json({ data })
    }

    const reviewPayload = payload as Extract<z.infer<typeof patchSchema>, { executionId: string; approved: boolean }>

    const data = await reviewWorkflowExecution({
      executionId: reviewPayload.executionId,
      tenantId: access.tenantId,
      userId: access.userId,
      approved: reviewPayload.approved,
      note: reviewPayload.notes,
    })

    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI WORKFLOWS PATCH]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}