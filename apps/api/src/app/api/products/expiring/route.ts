import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const { searchParams } = new URL(req.url)
    
    // Days ahead to check for expiry (default: 30 days)
    const daysAhead = parseInt(searchParams.get('daysAhead') || '30')
    
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account', 400)
    }

    // Calculate date range
    const now = new Date()
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + daysAhead)

    // Find products expiring within the range
    const expiringProducts = await prisma.product.findMany({
      where: {
        tenantId,
        archived: false,
        status: 'ACTIVE',
        type: 'GOODS',
        expiryDate: {
          gte: now,
          lte: futureDate,
        },
      },
      include: {
        subsidiary: {
          select: { id: true, name: true },
        },
      },
      orderBy: {
        expiryDate: 'asc',
      },
    })

    // Also get already expired products
    const expiredProducts = await prisma.product.findMany({
      where: {
        tenantId,
        archived: false,
        status: 'ACTIVE',
        type: 'GOODS',
        expiryDate: {
          lt: now,
        },
      },
      include: {
        subsidiary: {
          select: { id: true, name: true },
        },
      },
      orderBy: {
        expiryDate: 'asc',
      },
      take: 10, // Limit expired products display
    })

    return NextResponse.json({
      data: {
        expiring: expiringProducts,
        expired: expiredProducts,
        expiringCount: expiringProducts.length,
        expiredCount: expiredProducts.length,
      },
    })
  } catch (err) {
    console.error('[PRODUCTS EXPIRING GET]', err)
    return apiError('Internal server error', 500)
  }
}
