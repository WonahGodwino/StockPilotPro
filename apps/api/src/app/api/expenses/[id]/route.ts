import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isBusinessAdmin, isSalesperson } from '@/lib/rbac'
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

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  date: z.string().datetime().optional(),
  currency: z.string().length(3).transform((v) => v.toUpperCase()).optional(),
  fxRate: z.number().positive().optional(),
  subsidiaryId: z.string().nullable().optional(),
  notes: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)

    const expense = await prisma.expense.findUnique({ where: { id: params.id } })
    if (!expense) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && expense.tenantId !== user.tenantId) return apiError('Forbidden', 403)
    if (isSalesperson(user) && expense.subsidiaryId !== user.subsidiaryId) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = updateSchema.parse(body)

    let resolvedSubsidiaryId: string | null | undefined
    if (Object.prototype.hasOwnProperty.call(data, 'subsidiaryId')) {
      if (isSalesperson(user)) {
        if (!user.subsidiaryId) return apiError('Salesperson account must be linked to a subsidiary', 400)
        if (data.subsidiaryId && data.subsidiaryId !== user.subsidiaryId) return apiError('Forbidden', 403)
        resolvedSubsidiaryId = user.subsidiaryId
      } else {
        resolvedSubsidiaryId = data.subsidiaryId ?? null
      }

      if (resolvedSubsidiaryId) {
        const subsidiary = await prisma.subsidiary.findFirst({
          where: {
            id: resolvedSubsidiaryId,
            tenantId: expense.tenantId,
            archived: false,
            isActive: true,
          },
          select: { id: true },
        })
        if (!subsidiary) return apiError('Invalid subsidiary selected', 422)
      }
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: expense.tenantId },
      select: { baseCurrency: true },
    })
    const baseCurrency = tenant?.baseCurrency || 'USD'

    const nextCurrency = data.currency ?? expense.currency
    let nextFxRate = Number(data.fxRate ?? expense.fxRate)
    if (nextCurrency === baseCurrency) {
      nextFxRate = 1
    } else if (nextFxRate === 1) {
      const savedRate = await resolveSavedFxRate(expense.tenantId, baseCurrency, nextCurrency)
      if (!savedRate) {
        return apiError(
          `No saved exchange rate found for ${baseCurrency}/${nextCurrency}. Load or enter a valid FX rate before saving.`,
          422
        )
      }
      nextFxRate = savedRate
    }

    const updated = await prisma.expense.update({
      where: { id: params.id },
      data: {
        ...data,
        fxRate: nextFxRate,
        ...(Object.prototype.hasOwnProperty.call(data, 'subsidiaryId') ? { subsidiaryId: resolvedSubsidiaryId ?? null } : {}),
        ...(data.date ? { date: new Date(data.date) } : {}),
        updatedBy: user.userId,
      },
    })

    await logAudit({
      tenantId: expense.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'expense',
      entityId: updated.id,
      oldValues: {
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        date: expense.date,
        currency: expense.currency,
        fxRate: expense.fxRate,
      },
      newValues: {
        title: updated.title,
        amount: updated.amount,
        category: updated.category,
        date: updated.date,
        currency: updated.currency,
        fxRate: updated.fxRate,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as { code?: string }).code === 'P2003') return apiError('Invalid subsidiary selected', 422)
    console.error('[EXPENSE PUT]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isBusinessAdmin(user) && !isSuperAdmin(user)) return apiError('Forbidden', 403)

    const expense = await prisma.expense.findUnique({ where: { id: params.id } })
    if (!expense) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && expense.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    if (isSuperAdmin(user)) {
      // Hard delete for SUPER_ADMIN
      await prisma.expense.delete({ where: { id: params.id } })

      await logAudit({
        tenantId: expense.tenantId,
        userId: user.userId,
        action: 'DELETE',
        entity: 'expense',
        entityId: expense.id,
        oldValues: {
          title: expense.title,
          amount: expense.amount,
          archived: expense.archived,
        },
        newValues: { deleted: true },
        req,
      })

      return NextResponse.json({ message: 'Expense deleted' })
    } else {
      // Soft delete for BUSINESS_ADMIN
      await prisma.expense.update({
        where: { id: params.id },
        data: { archived: true, updatedBy: user.userId },
      })

      await logAudit({
        tenantId: expense.tenantId,
        userId: user.userId,
        action: 'DELETE',
        entity: 'expense',
        entityId: expense.id,
        oldValues: {
          title: expense.title,
          amount: expense.amount,
          archived: expense.archived,
        },
        newValues: { archived: true },
        req,
      })

      return NextResponse.json({ message: 'Expense archived' })
    }
  } catch (err) {
    console.error('[EXPENSE DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
