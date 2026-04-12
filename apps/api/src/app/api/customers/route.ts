import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { requirePermission, isSuperAdmin } from '@/lib/rbac'

const createCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'view:sales')

    const { searchParams } = new URL(req.url)
    const tenantId = isSuperAdmin(user)
      ? searchParams.get('tenantId') || user.tenantId!
      : user.tenantId!
    if (!tenantId) return apiError('No tenant context', 400)

    const q = searchParams.get('q')?.trim() || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))

    const where = {
      tenantId,
      archived: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
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
          createdAt: true,
        },
      }),
      prisma.customer.count({ where }),
    ])

    return NextResponse.json({ data, total, page, limit })
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[CUSTOMERS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'create:sales')
    const tenantId = user.tenantId
    if (!tenantId) return apiError('No tenant context', 400)

    const body = await req.json()
    const data = createCustomerSchema.parse(body)

    const customer = await prisma.customer.create({
      data: {
        tenantId,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        notes: data.notes || null,
        createdBy: user.userId,
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
        createdAt: true,
      },
    })

    return NextResponse.json({ data: customer }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[CUSTOMERS POST]', err)
    return apiError('Internal server error', 500)
  }
}
