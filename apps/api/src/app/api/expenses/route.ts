import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertSubsidiaryAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createSchema = z.object({
  title: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().min(1),
  date: z.string().datetime(),
  notes: z.string().optional(),
  subsidiaryId: z.string(),
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
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where = {
      archived: false,
      tenantId: isSuperAdmin(user) ? undefined : user.tenantId!,
      ...(subsidiaryId
        ? { subsidiaryId }
        : user.role === 'SALESPERSON' && user.subsidiaryId
        ? { subsidiaryId: user.subsidiaryId }
        : {}),
      ...(category ? { category } : {}),
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
  try {
    const user = authenticate(req)
    const body = await req.json()
    const data = createSchema.parse(body)

    assertSubsidiaryAccess(user, data.subsidiaryId)

    const expense = await prisma.expense.create({
      data: {
        ...data,
        date: new Date(data.date),
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
        subsidiaryId: expense.subsidiaryId,
      },
      req,
    })

    return NextResponse.json({ data: expense }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[EXPENSES POST]', err)
    return apiError('Internal server error', 500)
  }
}
