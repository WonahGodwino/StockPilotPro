import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'

type CustomerDelegate = {
  findFirst: (args?: Record<string, unknown>) => Promise<unknown>
  update: (args: Record<string, unknown>) => Promise<unknown>
}

type SaleDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<unknown[]>
}

type LoyaltyLedgerDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<unknown[]>
}

const customer = (prisma as unknown as { customer: CustomerDelegate }).customer
const sale = (prisma as unknown as { sale: SaleDelegate }).sale
const loyaltyLedger = (prisma as unknown as { loyaltyLedger: LoyaltyLedgerDelegate }).loyaltyLedger

function isAuthError(err: unknown): boolean {
  const message = (err as Error)?.message || ''
  return (
    message.includes('No token provided') ||
    message.includes('jwt') ||
    message.includes('token')
  )
}

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
})

type RouteContext = { params: { id: string } }

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'view:sales')
    const tenantId = user.tenantId
    if (!tenantId) return apiError('No tenant context', 400)

    const foundCustomer = await customer.findFirst({
      where: { id: params.id, tenantId, archived: false },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        notes: true,
        loyaltyPoints: true,
        totalSpend: true,
        visitCount: true,
        lastVisitedAt: true,
        createdAt: true,
      },
    })
    if (!foundCustomer) return apiError('Customer not found', 404)

    // Purchase history (last 20 sales)
    const sales = await sale.findMany({
      where: { customerId: params.id, tenantId, archived: false },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        receiptNumber: true,
        totalAmount: true,
        currency: true,
        paymentMethod: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            product: { select: { name: true } },
          },
        },
      },
    })

    // Loyalty ledger (last 30 entries)
    const ledger = await loyaltyLedger.findMany({
      where: { customerId: params.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        type: true,
        points: true,
        balanceBefore: true,
        balanceAfter: true,
        note: true,
        saleId: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ data: { ...foundCustomer, purchaseHistory: sales, loyaltyLedger: ledger } })
  } catch (err) {
    if (isAuthError(err)) return apiError('Unauthorized', 401)
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[CUSTOMER GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'create:sales')
    const tenantId = user.tenantId
    if (!tenantId) return apiError('No tenant context', 400)

    const existing = await customer.findFirst({ where: { id: params.id, tenantId } })
    if (!existing) return apiError('Customer not found', 404)

    const body = await req.json()
    const patch = updateCustomerSchema.parse(body)

    const updated = await customer.update({
      where: { id: params.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone || null } : {}),
        ...(patch.email !== undefined ? { email: patch.email || null } : {}),
        ...(patch.address !== undefined ? { address: patch.address || null } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
        updatedBy: user.userId,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        loyaltyPoints: true,
        totalSpend: true,
        visitCount: true,
        lastVisitedAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (isAuthError(err)) return apiError('Unauthorized', 401)
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[CUSTOMER PATCH]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'create:sales')
    const tenantId = user.tenantId
    if (!tenantId) return apiError('No tenant context', 400)

    const existing = await customer.findFirst({ where: { id: params.id, tenantId } })
    if (!existing) return apiError('Customer not found', 404)

    // Soft delete
    await customer.update({
      where: { id: params.id },
      data: { archived: true, updatedBy: user.userId },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (isAuthError(err)) return apiError('Unauthorized', 401)
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[CUSTOMER DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
