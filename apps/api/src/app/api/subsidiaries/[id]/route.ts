import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isBusinessAdmin } from '@/lib/rbac'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)

    const subsidiary = await prisma.subsidiary.findUnique({
      where: { id: params.id },
      include: {
        users: { where: { archived: false }, select: { id: true, firstName: true, lastName: true, role: true } },
        _count: { select: { products: true, sales: true, expenses: true } },
      },
    })

    if (!subsidiary) return apiError('Subsidiary not found', 404)
    if (!isSuperAdmin(user) && subsidiary.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    return NextResponse.json({ data: subsidiary })
  } catch (err) {
    console.error('[SUBSIDIARY GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user) && !isBusinessAdmin(user)) return apiError('Forbidden', 403)

    const subsidiary = await prisma.subsidiary.findUnique({ where: { id: params.id } })
    if (!subsidiary) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && subsidiary.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = updateSchema.parse(body)

    const updated = await prisma.subsidiary.update({
      where: { id: params.id },
      data: { ...data, updatedBy: user.userId },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[SUBSIDIARY PUT]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user) && !isBusinessAdmin(user)) return apiError('Forbidden', 403)

    const subsidiary = await prisma.subsidiary.findUnique({ where: { id: params.id } })
    if (!subsidiary) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && subsidiary.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    await prisma.subsidiary.update({
      where: { id: params.id },
      data: { archived: true, updatedBy: user.userId },
    })

    return NextResponse.json({ message: 'Subsidiary archived' })
  } catch (err) {
    console.error('[SUBSIDIARY DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
