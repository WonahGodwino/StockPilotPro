import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { isAllowedStatusTransition } from '@/lib/subscription'

const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'SUSPENDED']).optional(),
  expiryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const before = await prisma.subscription.findUnique({ where: { id: params.id } })
    if (!before) return apiError('Subscription not found', 404)

    const body = await req.json()
    const data = updateSchema.parse(body)

    if (data.status && data.status !== before.status) {
      if (!isAllowedStatusTransition(before.status, data.status)) {
        return apiError(
          `Invalid status transition from ${before.status} to ${data.status}`,
          422
        )
      }
    }

    const updated = await prisma.subscription.update({
      where: { id: params.id },
      data: {
        ...data,
        ...(data.expiryDate ? { expiryDate: new Date(data.expiryDate) } : {}),
        updatedBy: user.userId,
      },
      include: { plan: true },
    })

    await logAudit({
      tenantId: updated.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: updated.id,
      oldValues: {
        status: before.status,
        expiryDate: before.expiryDate,
        notes: before.notes,
      },
      newValues: {
        status: updated.status,
        expiryDate: updated.expiryDate,
        notes: updated.notes,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[SUBSCRIPTION PUT]', err)
    return apiError('Internal server error', 500)
  }
}
