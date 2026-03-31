import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createSchema = z.object({
  tenantId: z.string(),
  planId: z.string(),
  startDate: z.string().datetime(),
  expiryDate: z.string().datetime(),
  amount: z.number().positive(),
  notes: z.string().optional(),
})

const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'SUSPENDED']).optional(),
  expiryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)

    const tenantId = isSuperAdmin(user)
      ? new URL(req.url).searchParams.get('tenantId') || undefined
      : user.tenantId!

    const subscriptions = await prisma.subscription.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
      include: {
        plan: true,
        tenant: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: subscriptions })
  } catch (err) {
    console.error('[SUBSCRIPTIONS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createSchema.parse(body)

    const subscription = await prisma.subscription.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        expiryDate: new Date(data.expiryDate),
        status: 'ACTIVE',
        createdBy: user.userId,
      },
      include: { plan: true },
    })

    await logAudit({
      tenantId: subscription.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'subscription',
      entityId: subscription.id,
      newValues: {
        planId: subscription.planId,
        status: subscription.status,
        startDate: subscription.startDate,
        expiryDate: subscription.expiryDate,
        amount: subscription.amount,
      },
      req,
    })

    return NextResponse.json({ data: subscription }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[SUBSCRIPTIONS POST]', err)
    return apiError('Internal server error', 500)
  }
}
