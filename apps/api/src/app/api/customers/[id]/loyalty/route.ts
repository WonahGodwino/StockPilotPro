import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'

type CustomerDelegate = {
  findFirst: (args?: Record<string, unknown>) => Promise<unknown>
  update: (args: Record<string, unknown>) => Promise<unknown>
}

type LoyaltyLedgerDelegate = {
  create: (args: Record<string, unknown>) => Promise<unknown>
}

const customer = (prisma as unknown as { customer: CustomerDelegate }).customer
const loyaltyLedger = (prisma as unknown as { loyaltyLedger: LoyaltyLedgerDelegate }).loyaltyLedger

function isAuthError(err: unknown): boolean {
  const message = (err as Error)?.message || ''
  return (
    message.includes('No token provided') ||
    message.includes('jwt') ||
    message.includes('token')
  )
}

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

    const foundCustomer = await customer.findFirst({
      where: { id: params.id, tenantId, archived: false },
    })
    if (!foundCustomer) return apiError('Customer not found', 404)

    const body = await req.json()
    const data = adjustSchema.parse(body)

    if (data.type === 'REDEEM' && data.points > 0) {
      // Redeeming means deducting — points argument must be positive (we flip it)
      if ((foundCustomer as { loyaltyPoints: number }).loyaltyPoints < data.points) {
        return apiError('Insufficient loyalty points', 422)
      }
    }

    const delta = data.type === 'REDEEM' ? -Math.abs(data.points) : data.points
    const balanceBefore = (foundCustomer as { loyaltyPoints: number }).loyaltyPoints
    const balanceAfter = balanceBefore + delta

    if (balanceAfter < 0) return apiError('Resulting balance would be negative', 422)

    const updated = await prisma.$transaction(async () => {
      const updatedCustomer = await customer.update({
        where: { id: params.id },
        data: { loyaltyPoints: balanceAfter },
        select: { id: true, loyaltyPoints: true },
      })

      await loyaltyLedger.create({
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
      })

      return updatedCustomer
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (isAuthError(err)) return apiError('Unauthorized', 401)
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[LOYALTY POST]', err)
    return apiError('Internal server error', 500)
  }
}
