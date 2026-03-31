import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertSubsidiaryAccess } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['GOODS', 'SERVICE']).default('GOODS'),
  unit: z.string().default('pcs'),
  quantity: z.number().min(0).default(0),
  costPrice: z.number().min(0),
  sellingPrice: z.number().min(0),
  barcode: z.string().optional(),
  lowStockThreshold: z.number().min(0).default(10),
  status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).default('ACTIVE'),
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
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const search = searchParams.get('search')
    const barcode = searchParams.get('barcode')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    // Salesperson: only ACTIVE and DRAFT; ARCHIVED hidden
    const allowedStatuses = user.role === 'SALESPERSON'
      ? ['ACTIVE', 'DRAFT']
      : status ? [status] : undefined

    const where = {
      archived: false,
      tenantId: isSuperAdmin(user) ? undefined : user.tenantId!,
      ...(subsidiaryId ? { subsidiaryId } : user.subsidiaryId ? { subsidiaryId: user.subsidiaryId } : {}),
      ...(allowedStatuses ? { status: { in: allowedStatuses as ('ACTIVE' | 'DRAFT' | 'ARCHIVED')[] } } : {}),
      ...(type ? { type: type as 'GOODS' | 'SERVICE' } : {}),
      ...(barcode ? { barcode } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ])

    return NextResponse.json({ data: products, total, page, limit })
  } catch (err) {
    console.error('[PRODUCTS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)

    const body = await req.json()
    const data = createSchema.parse(body)

    assertSubsidiaryAccess(user, data.subsidiaryId)

    const product = await prisma.product.create({
      data: {
        ...data,
        tenantId: user.tenantId!,
        createdBy: user.userId,
      },
    })

    await logAudit({
      tenantId: product.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'product',
      entityId: product.id,
      newValues: {
        name: product.name,
        type: product.type,
        quantity: product.quantity,
        sellingPrice: product.sellingPrice,
        status: product.status,
        subsidiaryId: product.subsidiaryId,
      },
      req,
    })

    return NextResponse.json({ data: product }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[PRODUCTS POST]', err)
    return apiError('Internal server error', 500)
  }
}
