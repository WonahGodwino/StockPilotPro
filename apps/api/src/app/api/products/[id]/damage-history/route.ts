import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertSubsidiaryAccess } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const productId = params.id
    const { searchParams } = new URL(req.url)

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    // Get the product
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product) {
      return apiError('Product not found', 404)
    }

    // Check access
    if (!isSuperAdmin(user)) {
      assertSubsidiaryAccess(user, product.subsidiaryId)
    }

    const where = {
      productId: productId,
      tenantId: isSuperAdmin(user) ? undefined : user.tenantId!,
    }

    const [damageRecords, total] = await Promise.all([
      prisma.damageRecord.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          product: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.damageRecord.count({ where }),
    ])

    return NextResponse.json({ data: damageRecords, total, page, limit })
  } catch (err) {
    console.error('[DAMAGE GET]', err)
    return apiError('Internal server error', 500)
  }
}
