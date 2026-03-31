import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertTenantAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  logo: z.string().optional(),
  isActive: z.boolean().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    assertTenantAccess(user, params.id)

    const tenant = await prisma.tenant.findUnique({
      where: { id: params.id },
      include: {
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

    const tenant = await prisma.tenant.update({
      where: { id: params.id },
      data: { ...data, updatedBy: user.userId },
    })

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
        isActive: before.isActive,
      },
      newValues: {
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        address: tenant.address,
        isActive: tenant.isActive,
      },
      req,
    })

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
