import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  logo: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const isActive = searchParams.get('isActive')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where = {
      archived: false,
      ...(isActive !== null ? { isActive: isActive === 'true' } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    }

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        include: {
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: { select: { users: true, subsidiaries: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tenant.count({ where }),
    ])

    return NextResponse.json({ data: tenants, total, page, limit })
  } catch (err) {
    console.error('[TENANTS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createSchema.parse(body)

    const existing = await prisma.tenant.findFirst({
      where: { OR: [{ slug: data.slug }, { email: data.email }] },
    })
    if (existing) return apiError('Tenant with this slug or email already exists', 409)

    const tenant = await prisma.tenant.create({
      data: { ...data, createdBy: user.userId },
    })

    await logAudit({
      tenantId: tenant.id,
      userId: user.userId,
      action: 'CREATE',
      entity: 'tenant',
      entityId: tenant.id,
      newValues: {
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        isActive: tenant.isActive,
      },
      req,
    })

    return NextResponse.json({ data: tenant }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[TENANTS POST]', err)
    return apiError('Internal server error', 500)
  }
}
