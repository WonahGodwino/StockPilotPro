import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isSalesperson } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { EXPENSE_CATEGORIES } from '@/lib/expenses'

async function resolveSavedFxRate(tenantId: string, fromCurrency: string, toCurrency: string): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency, toCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })

  if (direct?.rate) {
    const rate = Number(direct.rate)
    if (Number.isFinite(rate) && rate > 0) return rate
  }

  const inverse = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency: toCurrency, toCurrency: fromCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })

  if (inverse?.rate) {
    const rate = Number(inverse.rate)
    if (Number.isFinite(rate) && rate > 0) return 1 / rate
  }

  return null
}

const createSchema = z.object({
  title: z.string().min(1),
  amount: z.number().positive(),
  category: z.enum(EXPENSE_CATEGORIES),
  date: z.string().datetime(),
  currency: z.string().length(3).transform((v) => v.toUpperCase()).default('USD'),
  fxRate: z.number().positive().default(1),
  syncRef: z.string().min(6).max(120).optional(),
  transactionRef: z.string().min(6).max(180).optional(),
  notes: z.string().optional(),
  subsidiaryId: z.string().nullable().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const { searchParams } = new URL(req.url)

    const subsidiaryId = searchParams.get('subsidiaryId')
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account. Provide tenantId.', 400)
    }

    const subsidiaryFilter = subsidiaryId === 'main'
      ? { subsidiaryId: null }
      : subsidiaryId
      ? { subsidiaryId }
      : user.role === 'SALESPERSON' && user.subsidiaryId
      ? { subsidiaryId: user.subsidiaryId }
      : {}

    const where = {
      archived: false,
      tenantId,
      ...subsidiaryFilter,
      ...(category ? { category } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true } },
          subsidiary: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.expense.count({ where }),
    ])

    return NextResponse.json({ data: expenses, total, page, limit })
  } catch (err) {
    console.error('[EXPENSES GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  let tenantId: string | undefined
  let idempotencyRef: string | undefined
  try {
    const user = authenticate(req)
    tenantId = user.tenantId || undefined
    const body = await req.json()
    const data = createSchema.parse(body)
    const syncRef = data.syncRef?.trim() || undefined
    const transactionRef = data.transactionRef?.trim() || undefined
    idempotencyRef = transactionRef || syncRef

    const requestedSubsidiaryId = data.subsidiaryId || undefined
    let resolvedSubsidiaryId: string | undefined

    if (isSalesperson(user)) {
      if (!user.subsidiaryId) {
        return apiError('Salesperson account must be linked to a subsidiary', 400)
      }
      if (requestedSubsidiaryId && requestedSubsidiaryId !== user.subsidiaryId) {
        return apiError('Forbidden: salesperson can only record expenses under assigned subsidiary', 403)
      }
      resolvedSubsidiaryId = user.subsidiaryId
    } else {
      resolvedSubsidiaryId = requestedSubsidiaryId
    }

    if (resolvedSubsidiaryId) {
      const subsidiary = await prisma.subsidiary.findFirst({
        where: {
          id: resolvedSubsidiaryId,
          tenantId: user.tenantId!,
          archived: false,
          isActive: true,
        },
        select: { id: true },
      })
      if (!subsidiary) {
        return apiError('Invalid subsidiary selected', 422)
      }
    }

    // Strong idempotency guard: prefer transactionRef, fallback to syncRef.
    if (idempotencyRef) {
      const existing = await prisma.expense.findFirst({
        where: {
          tenantId: user.tenantId!,
          OR: [
            { transactionRef: idempotencyRef },
            { syncRef: idempotencyRef },
          ],
        },
      })
      if (existing) {
        return NextResponse.json({ data: existing })
      }
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId! },
      select: { baseCurrency: true },
    })
    const baseCurrency = tenant?.baseCurrency || 'USD'

    let normalizedFxRate = Number(data.fxRate)
    if (data.currency === baseCurrency) {
      normalizedFxRate = 1
    } else if (normalizedFxRate === 1) {
      const savedRate = await resolveSavedFxRate(user.tenantId!, baseCurrency, data.currency)
      if (!savedRate) {
        return apiError(
          `No saved exchange rate found for ${baseCurrency}/${data.currency}. Load or enter a valid FX rate before saving.`,
          422
        )
      }
      normalizedFxRate = savedRate
    }

    const expense = await prisma.expense.create({
      data: {
        ...data,
        fxRate: normalizedFxRate,
        syncRef,
        transactionRef,
        date: new Date(data.date),
        subsidiaryId: resolvedSubsidiaryId,
        tenantId: user.tenantId!,
        userId: user.userId,
        createdBy: user.userId,
      },
    })

    await logAudit({
      tenantId: expense.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'expense',
      entityId: expense.id,
      newValues: {
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        date: expense.date,
        currency: expense.currency,
        fxRate: expense.fxRate,
        syncRef: expense.syncRef,
        transactionRef: expense.transactionRef,
        subsidiaryId: expense.subsidiaryId,
      },
      req,
    })

    return NextResponse.json({ data: expense }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    if ((err as { code?: string }).code === 'P2003') return apiError('Invalid subsidiary selected', 422)
    if ((err as { code?: string }).code === 'P2002') {
      if (idempotencyRef && tenantId) {
        const existing = await prisma.expense.findFirst({
          where: {
            tenantId,
            OR: [
              { transactionRef: idempotencyRef },
              { syncRef: idempotencyRef },
            ],
          },
        })
        if (existing) return NextResponse.json({ data: existing })
      }
    }
    console.error('[EXPENSES POST]', err)
    return apiError('Internal server error', 500)
  }
}
