import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    authenticate(req) // any authenticated user can search catalog

    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 25)

    if (!search || search.length < 2) {
      // Return most popular products when no search
      const popular = await prisma.productCatalog.findMany({
        orderBy: { usageCount: 'desc' },
        take: limit,
        select: {
          id: true,
          name: true,
          category: true,
          unit: true,
          purchaseUnit: true,
          keepingUnit: true,
          sellingUnit: true,
        },
      })
      return NextResponse.json({ data: popular })
    }

    const results = await prisma.productCatalog.findMany({
      where: {
        name: { contains: search, mode: 'insensitive' },
      },
      orderBy: { usageCount: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        purchaseUnit: true,
        keepingUnit: true,
        sellingUnit: true,
      },
    })

    return NextResponse.json({ data: results })
  } catch (err) {
    console.error('[PRODUCT-CATALOG GET]', err)
    return apiError('Internal server error', 500)
  }
}
