import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)

    const sale = await prisma.sale.findUnique({
      where: { id: params.id },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true, type: true } } },
        },
        user: { select: { firstName: true, lastName: true } },
        subsidiary: { select: { name: true, address: true } },
        tenant: { select: { name: true, logo: true } },
      },
    })

    if (!sale) return apiError('Sale not found', 404)
    if (!isSuperAdmin(user) && sale.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    return NextResponse.json({ data: sale })
  } catch (err) {
    console.error('[SALE GET]', err)
    return apiError('Internal server error', 500)
  }
}
