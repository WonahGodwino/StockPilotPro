import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isBusinessAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  category: z.string().optional(),
  date: z.string().datetime().optional(),
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

    const body = await req.json()
    const data = updateSchema.parse(body)

    const updated = await prisma.expense.update({
      where: { id: params.id },
      data: {
        ...data,
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
      },
      newValues: {
        title: updated.title,
        amount: updated.amount,
        category: updated.category,
        date: updated.date,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
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
  } catch (err) {
    console.error('[EXPENSE DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
