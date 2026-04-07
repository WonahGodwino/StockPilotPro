import { NextRequest, NextResponse } from 'next/server'
import { Prisma, SubscriptionTransactionStatus, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { appendLifecycleEvent } from '@/lib/subscription-transactions'
import { logAudit } from '@/lib/audit'
import { isAgent, isTenantAssignedToAgent } from '@/lib/agent-access'

const patchSchema = z.object({
  transferProofUrl: z.string().max(4000).optional(),
  transferProofNote: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(['CANCELLED', 'REJECTED']).optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const tx = await prisma.subscriptionTransaction.findUnique({
      where: { id: params.id },
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        requestedPlan: true,
        currentPlan: true,
        subscription: { include: { plan: true } },
      },
    })

    if (!tx) return apiError('Transaction not found', 404)
    if (isAgent(user)) {
      const allowed = await isTenantAssignedToAgent(user.userId, tx.tenantId)
      if (!allowed) return apiError('Forbidden', 403)
    } else if (!isSuperAdmin(user) && tx.tenantId !== user.tenantId) {
      return apiError('Forbidden', 403)
    }

    return NextResponse.json({ data: tx })
  } catch (err) {
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[SUBSCRIPTION TRANSACTION GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (user.role === UserRole.SALESPERSON) return apiError('Forbidden', 403)

    const existing = await prisma.subscriptionTransaction.findUnique({ where: { id: params.id } })
    if (!existing) return apiError('Transaction not found', 404)
    if (isAgent(user)) {
      const allowed = await isTenantAssignedToAgent(user.userId, existing.tenantId)
      if (!allowed) return apiError('Forbidden', 403)
    } else if (!isSuperAdmin(user) && existing.tenantId !== user.tenantId) {
      return apiError('Forbidden', 403)
    }

    const body = await req.json()
    const input = patchSchema.parse(body)

    const updateData: {
      transferProofUrl?: string
      transferProofNote?: string
      notes?: string
      status?: SubscriptionTransactionStatus
      modifiedByUserId: string
      modifiedAt: Date
      lifecycleEvents: Prisma.InputJsonValue
    } = {
      modifiedByUserId: user.userId,
      modifiedAt: new Date(),
      lifecycleEvents: appendLifecycleEvent(existing.lifecycleEvents, {
        type: input.transferProofUrl || input.transferProofNote ? 'TRANSFER_PROOF_SUBMITTED' : 'UPDATED',
        at: new Date().toISOString(),
        byUserId: user.userId,
      }),
    }

    if (input.transferProofUrl !== undefined) updateData.transferProofUrl = input.transferProofUrl
    if (input.transferProofNote !== undefined) updateData.transferProofNote = input.transferProofNote
    if (input.notes !== undefined) updateData.notes = input.notes

    if (input.status) {
      const canChangeStatus = isSuperAdmin(user)
      if (!canChangeStatus) return apiError('Only super admin can change transaction status', 403)
      updateData.status = input.status
      updateData.lifecycleEvents = appendLifecycleEvent(existing.lifecycleEvents, {
        type: input.status === 'REJECTED' ? 'REJECTED' : 'UPDATED',
        at: new Date().toISOString(),
        byUserId: user.userId,
        note: input.notes,
      })
    }

    const updated = await prisma.subscriptionTransaction.update({
      where: { id: params.id },
      data: updateData,
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        requestedPlan: true,
      },
    })

    await logAudit({
      tenantId: existing.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'subscription_transaction',
      entityId: existing.id,
      oldValues: {
        status: existing.status,
        transferProofUrl: existing.transferProofUrl,
        transferProofNote: existing.transferProofNote,
      },
      newValues: {
        status: updated.status,
        transferProofUrl: updated.transferProofUrl,
        transferProofNote: updated.transferProofNote,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[SUBSCRIPTION TRANSACTION PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
