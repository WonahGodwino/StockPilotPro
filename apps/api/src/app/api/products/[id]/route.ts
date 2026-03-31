import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isBusinessAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(['GOODS', 'SERVICE']).optional(),
  unit: z.string().optional(),
  quantity: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  barcode: z.string().optional(),
  lowStockThreshold: z.number().min(0).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)

    const product = await prisma.product.findUnique({
      where: { id: params.id },
      include: {
        saleItems: {
          select: { quantity: true, unitPrice: true, subtotal: true },
          orderBy: { saleId: 'desc' },
          take: 10,
        },
      },
    })

    if (!product) return apiError('Product not found', 404)
    if (!isSuperAdmin(user) && product.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    return NextResponse.json({ data: product })
  } catch (err) {
    console.error('[PRODUCT GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)

    const product = await prisma.product.findUnique({ where: { id: params.id } })
    if (!product) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && product.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = updateSchema.parse(body)

    const updated = await prisma.product.update({
      where: { id: params.id },
      data: { ...data, updatedBy: user.userId },
    })

    await logAudit({
      tenantId: updated.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'product',
      entityId: updated.id,
      oldValues: {
        name: product.name,
        quantity: product.quantity,
        costPrice: product.costPrice,
        sellingPrice: product.sellingPrice,
        status: product.status,
      },
      newValues: {
        name: updated.name,
        quantity: updated.quantity,
        costPrice: updated.costPrice,
        sellingPrice: updated.sellingPrice,
        status: updated.status,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[PRODUCT PUT]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isBusinessAdmin(user) && !isSuperAdmin(user)) return apiError('Forbidden', 403)

    const product = await prisma.product.findUnique({ where: { id: params.id } })
    if (!product) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && product.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    await prisma.product.update({
      where: { id: params.id },
      data: { archived: true, status: 'ARCHIVED', updatedBy: user.userId },
    })

    await logAudit({
      tenantId: product.tenantId,
      userId: user.userId,
      action: 'DELETE',
      entity: 'product',
      entityId: product.id,
      oldValues: {
        name: product.name,
        status: product.status,
        archived: product.archived,
      },
      newValues: { status: 'ARCHIVED', archived: true },
      req,
    })

    return NextResponse.json({ message: 'Product archived' })
  } catch (err) {
    console.error('[PRODUCT DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
