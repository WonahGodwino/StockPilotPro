import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'

const adjustSchema = z.object({
  type: z.enum(['REDEEM', 'ADJUST']),
  points: z.number().int(),
  note: z.string().max(255).optional(),
})

type RouteContext = { params: { id: string } }

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'create:sales')
    const tenantId = user.tenantId
    if (!tenantId) return apiError('No tenant context', 400)

    const customer = await prisma.customer.findFirst({
      where: { id: params.id, tenantId, archived: false },
    })
    if (!customer) return apiError('Customer not found', 404)

    const body = await req.json()
    const data = adjustSchema.parse(body)

    if (data.type === 'REDEEM' && data.points > 0) {
      // Redeeming means deducting — points argument must be positive (we flip it)
      if (customer.loyaltyPoints < data.points) {
        return apiError('Insufficient loyalty points', 422)
      }
    }

    const delta = data.type === 'REDEEM' ? -Math.abs(data.points) : data.points
    const balanceBefore = customer.loyaltyPoints
    const balanceAfter = balanceBefore + delta

    if (balanceAfter < 0) return apiError('Resulting balance would be negative', 422)

    const [updated] = await prisma.$transaction([
      prisma.customer.update({
        where: { id: params.id },
        data: { loyaltyPoints: balanceAfter },
        select: { id: true, loyaltyPoints: true },
      }),
      prisma.loyaltyLedger.create({
        data: {
          tenantId,
          customerId: params.id,
          type: data.type,
          points: delta,
          balanceBefore,
          balanceAfter,
          note: data.note || null,
          createdByUserId: user.userId,
        },
      }),
    ])

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[LOYALTY POST]', err)
    return apiError('Internal server error', 500)
  }
}
