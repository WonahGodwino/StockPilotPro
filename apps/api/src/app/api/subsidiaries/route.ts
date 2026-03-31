import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isBusinessAdmin } from '@/lib/rbac'

const createSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  tenantId: z.string().optional(), // SUPER_ADMIN can specify, others use their own
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)

    const tenantId = isSuperAdmin(user)
      ? new URL(req.url).searchParams.get('tenantId') || undefined
      : user.tenantId!

    if (!tenantId && !isSuperAdmin(user)) return apiError('Forbidden', 403)

    const subsidiaries = await prisma.subsidiary.findMany({
      where: { archived: false, ...(tenantId ? { tenantId } : {}) },
      include: {
        _count: { select: { users: true, products: true, sales: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: subsidiaries })
  } catch (err) {
    console.error('[SUBSIDIARIES GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user) && !isBusinessAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createSchema.parse(body)

    const tenantId = isSuperAdmin(user) ? (data.tenantId || user.tenantId!) : user.tenantId!
    if (!tenantId) return apiError('tenantId is required', 400)

    // Check subscription subsidiary limit
    if (!isSuperAdmin(user)) {
      const subscription = await prisma.subscription.findFirst({
        where: { tenantId, status: 'ACTIVE' },
        include: { plan: true },
      })

      if (!subscription) return apiError('No active subscription', 403)

      const count = await prisma.subsidiary.count({ where: { tenantId, archived: false } })
      if (count >= subscription.plan.maxSubsidiaries) {
        return apiError(`Subsidiary limit reached (${subscription.plan.maxSubsidiaries}). Upgrade your plan.`, 403)
      }
    }

    const subsidiary = await prisma.subsidiary.create({
      data: {
        name: data.name,
        address: data.address,
        phone: data.phone,
        email: data.email,
        tenantId,
        createdBy: user.userId,
      },
    })

    return NextResponse.json({ data: subsidiary }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[SUBSIDIARIES POST]', err)
    return apiError('Internal server error', 500)
  }
}
