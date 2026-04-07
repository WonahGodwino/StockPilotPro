import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertTenantAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { isAgent, isTenantAssignedToAgent } from '@/lib/agent-access'
import { fetchLiveFxRate } from '@/lib/fx'

async function resolveSavedFxRate(tenantId: string, fromCurrency: string, toCurrency: string): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: {
      tenantId,
      fromCurrency,
      toCurrency,
    },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })

  if (direct?.rate) {
    const rate = Number(direct.rate)
    if (Number.isFinite(rate) && rate > 0) return rate
  }

  const inverse = await prisma.currencyRate.findFirst({
    where: {
      tenantId,
      fromCurrency: toCurrency,
      toCurrency: fromCurrency,
    },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })

  if (inverse?.rate) {
    const rate = Number(inverse.rate)
    if (Number.isFinite(rate) && rate > 0) return 1 / rate
  }

  return null
}

async function resolveSavedOrLiveFxRate(
  tenantId: string,
  fromCurrency: string,
  toCurrency: string,
  userId: string
): Promise<number | null> {
  const saved = await resolveSavedFxRate(tenantId, fromCurrency, toCurrency)
  if (saved) return saved

  try {
    const live = await fetchLiveFxRate(fromCurrency, toCurrency)
    if (!Number.isFinite(live) || live <= 0) return null

    await prisma.currencyRate.create({
      data: {
        tenantId,
        fromCurrency,
        toCurrency,
        rate: live,
        date: new Date(),
        createdBy: userId,
      },
    })

    return live
  } catch {
    return null
  }
}

async function rebaseTenantProductPrices(tenantId: string, multiplier: number): Promise<number> {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      archived: false,
    },
    select: {
      id: true,
      costPrice: true,
      sellingPrice: true,
    },
  })

  if (products.length === 0) return 0

  for (const product of products) {
    const nextCost = Math.round(Number(product.costPrice) * multiplier * 100) / 100
    const nextSelling = Math.round(Number(product.sellingPrice) * multiplier * 100) / 100

    try {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          costPrice: nextCost,
          sellingPrice: nextSelling,
        },
      })
    } catch (err) {
      console.warn('[TENANT REBASE PRODUCT] skipped', product.id, err)
      continue
    }
  }

  return products.length
}

async function rebaseTenantTransactionFxRates(
  tenantId: string,
  oldBaseCurrency: string,
  newBaseCurrency: string,
  baseRebaseMultiplier: number
): Promise<{ rebasedSales: number; rebasedExpenses: number }> {
  if (!Number.isFinite(baseRebaseMultiplier) || baseRebaseMultiplier <= 0) {
    return { rebasedSales: 0, rebasedExpenses: 0 }
  }

  const sales = await prisma.sale.findMany({
    where: { tenantId },
    select: { id: true, currency: true, fxRate: true },
  })

  const expenses = await prisma.expense.findMany({
    where: { tenantId },
    select: { id: true, currency: true, fxRate: true },
  })

  let rebasedSales = 0
  let rebasedExpenses = 0

  for (const sale of sales) {
    const nextRate = await computeRebasedFxRate(
      tenantId,
      sale.currency,
      Number(sale.fxRate),
      oldBaseCurrency,
      newBaseCurrency,
      baseRebaseMultiplier
    )
    if (nextRate === null) continue

    try {
      await prisma.sale.update({
        where: { id: sale.id },
        data: { fxRate: nextRate },
      })
      rebasedSales += 1
    } catch (err) {
      console.warn('[TENANT REBASE SALE] skipped', sale.id, err)
      continue
    }
  }

  for (const expense of expenses) {
    const nextRate = await computeRebasedFxRate(
      tenantId,
      expense.currency,
      Number(expense.fxRate),
      oldBaseCurrency,
      newBaseCurrency,
      baseRebaseMultiplier
    )
    if (nextRate === null) continue

    try {
      await prisma.expense.update({
        where: { id: expense.id },
        data: { fxRate: nextRate },
      })
      rebasedExpenses += 1
    } catch (err) {
      console.warn('[TENANT REBASE EXPENSE] skipped', expense.id, err)
      continue
    }
  }

  return { rebasedSales, rebasedExpenses }
}

async function computeRebasedFxRate(
  tenantId: string,
  transactionCurrency: string,
  currentFxRate: number,
  oldBaseCurrency: string,
  newBaseCurrency: string,
  baseRebaseMultiplier: number
): Promise<number | null> {
  // fxRate is stored as transactionCurrency/baseCurrency.
  if (transactionCurrency === newBaseCurrency) return 1

  let oldTransactionToBaseRate = currentFxRate
  if (!Number.isFinite(oldTransactionToBaseRate) || oldTransactionToBaseRate <= 0) {
    const resolved = await resolveSavedFxRate(tenantId, oldBaseCurrency, transactionCurrency)
    if (!resolved) return null
    oldTransactionToBaseRate = resolved
  }

  const nextRate = oldTransactionToBaseRate / baseRebaseMultiplier
  if (!Number.isFinite(nextRate) || nextRate <= 0) return null

  // Keep precision aligned with Decimal(18,8)
  return Math.round(nextRate * 100000000) / 100000000
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
  logo: z.string().optional(),
  isActive: z.boolean().optional(),
  baseCurrency: z.string().length(3).transform((v) => v.toUpperCase()).optional(),
  acquisitionAgentId: z.string().nullable().optional(),
})

const patchCurrencySchema = z.object({
  baseCurrency: z.string().length(3).transform((v) => v.toUpperCase()),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (isAgent(user)) {
      const allowed = await isTenantAssignedToAgent(user.userId, params.id)
      if (!allowed) return apiError('Forbidden', 403)
    } else {
      assertTenantAccess(user, params.id)
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: params.id },
      include: {
        acquisitionAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' } },
        subsidiaries: { where: { archived: false } },
        _count: { select: { users: true, products: true, sales: true } },
      },
    })

    if (!tenant) return apiError('Tenant not found', 404)
    return NextResponse.json({ data: tenant })
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[TENANT GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const before = await prisma.tenant.findUnique({ where: { id: params.id } })
    if (!before) return apiError('Tenant not found', 404)

    const body = await req.json()
    const data = updateSchema.parse(body)

    if (data.acquisitionAgentId) {
      const agent = await prisma.user.findUnique({
        where: { id: data.acquisitionAgentId },
        select: { id: true, role: true, archived: true, isActive: true },
      })
      if (!agent || agent.archived || !agent.isActive || String(agent.role) !== 'AGENT') {
        return apiError('Selected acquisition agent is invalid', 422)
      }
    }

    let rebasedProducts = 0
    let rebasedSales = 0
    let rebasedExpenses = 0
    let appliedFxRate: number | null = null

    if (data.baseCurrency && data.baseCurrency !== before.baseCurrency) {
      const fxRate = await resolveSavedOrLiveFxRate(params.id, before.baseCurrency, data.baseCurrency, user.userId)
      if (!fxRate) {
        return apiError(
          `Unable to resolve exchange rate for ${before.baseCurrency}/${data.baseCurrency}. Save it in Exchange Rate Settings before changing base currency.`,
          422
        )
      }
      appliedFxRate = fxRate
    }

    const tenant = await prisma.tenant.update({
      where: { id: params.id },
      data: { ...data, updatedBy: user.userId },
    })

    if (appliedFxRate) {
      rebasedProducts = await rebaseTenantProductPrices(params.id, appliedFxRate)
      const rebasedTransactions = await rebaseTenantTransactionFxRates(
        params.id,
        before.baseCurrency,
        tenant.baseCurrency,
        appliedFxRate
      )
      rebasedSales = rebasedTransactions.rebasedSales
      rebasedExpenses = rebasedTransactions.rebasedExpenses
    }

    try {
      await logAudit({
        tenantId: tenant.id,
        userId: user.userId,
        action: 'UPDATE',
        entity: 'tenant',
        entityId: tenant.id,
        oldValues: {
          name: before.name,
          email: before.email,
          phone: before.phone,
          address: before.address,
          country: before.country,
          state: before.state,
          lga: before.lga,
          isActive: before.isActive,
          acquisitionAgentId: before.acquisitionAgentId,
        },
        newValues: {
          name: tenant.name,
          email: tenant.email,
          phone: tenant.phone,
          address: tenant.address,
          country: tenant.country,
          state: tenant.state,
          lga: tenant.lga,
          isActive: tenant.isActive,
          acquisitionAgentId: tenant.acquisitionAgentId,
          baseCurrency: tenant.baseCurrency,
          rebasedProducts,
          rebasedSales,
          rebasedExpenses,
          appliedFxRate,
        },
        req,
      })
    } catch (err) {
      console.warn('[TENANT PUT AUDIT] failed', tenant.id, err)
    }

    return NextResponse.json({ data: tenant })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[TENANT PUT]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const existing = await prisma.tenant.findUnique({ where: { id: params.id } })
    if (!existing) return apiError('Tenant not found', 404)

    await prisma.tenant.update({
      where: { id: params.id },
      data: { archived: true, updatedBy: user.userId },
    })

    await logAudit({
      tenantId: existing.id,
      userId: user.userId,
      action: 'DELETE',
      entity: 'tenant',
      entityId: existing.id,
      oldValues: {
        name: existing.name,
        email: existing.email,
        isActive: existing.isActive,
        archived: existing.archived,
      },
      newValues: { archived: true },
      req,
    })

    return NextResponse.json({ message: 'Tenant archived successfully' })
  } catch (err) {
    console.error('[TENANT DELETE]', err)
    return apiError('Internal server error', 500)
  }
}

// PATCH /api/tenants/[id] — BUSINESS_ADMIN updates their own tenant's base currency
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    // BUSINESS_ADMIN can only update their own tenant; SUPER_ADMIN can update any
    if (!isSuperAdmin(user) && user.tenantId !== params.id) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = patchCurrencySchema.parse(body)

    const before = await prisma.tenant.findUnique({ where: { id: params.id } })
    if (!before) return apiError('Tenant not found', 404)

    if (before.baseCurrency === data.baseCurrency) {
      return NextResponse.json({ data: before })
    }

    const fxRate = await resolveSavedOrLiveFxRate(params.id, before.baseCurrency, data.baseCurrency, user.userId)
    if (!fxRate) {
      return apiError(
        `Unable to resolve exchange rate for ${before.baseCurrency}/${data.baseCurrency}. Save it in Exchange Rate Settings before changing base currency.`,
        422
      )
    }

    const tenant = await prisma.tenant.update({
      where: { id: params.id },
      data: { baseCurrency: data.baseCurrency, updatedBy: user.userId },
    })

    const rebasedProducts = await rebaseTenantProductPrices(params.id, fxRate)
    const rebasedTransactions = await rebaseTenantTransactionFxRates(
      params.id,
      before.baseCurrency,
      tenant.baseCurrency,
      fxRate
    )

    try {
      await logAudit({
        tenantId: tenant.id,
        userId: user.userId,
        action: 'UPDATE',
        entity: 'tenant',
        entityId: tenant.id,
        oldValues: { baseCurrency: before.baseCurrency },
        newValues: {
          baseCurrency: tenant.baseCurrency,
          rebasedProducts,
          rebasedSales: rebasedTransactions.rebasedSales,
          rebasedExpenses: rebasedTransactions.rebasedExpenses,
          appliedFxRate: fxRate,
        },
        req,
      })
    } catch (err) {
      console.warn('[TENANT PATCH AUDIT] failed', tenant.id, err)
    }

    return NextResponse.json({ data: tenant })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[TENANT PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
