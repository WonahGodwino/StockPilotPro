import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleOptions } from '@/lib/auth'

export async function OPTIONS() {
  return handleOptions()
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value)
  }
  return response
}

/**
 * GET /api/storefront/products
 * Public endpoint — returns active products for a tenant's online store
 * Query: ?tenant=<slug> or ?tenantId=<id>, ?category, ?search, ?page, ?limit
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantSlug = searchParams.get('tenant')
    const tenantIdParam = searchParams.get('tenantId')
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    // Resolve tenant
    let tenantId: string | undefined
    if (tenantSlug) {
      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true, isActive: true },
      })
      if (!tenant || !tenant.isActive) {
        return withCors(NextResponse.json({ error: 'Store not found' }, { status: 404 }))
      }
      tenantId = tenant.id
    } else if (tenantIdParam) {
      tenantId = tenantIdParam
    } else {
      return withCors(NextResponse.json({ error: 'tenant or tenantId query parameter required' }, { status: 400 }))
    }

    const where = {
      tenantId,
      archived: false,
      status: 'ACTIVE' as const,
      ...(category ? { category: { equals: category, mode: 'insensitive' as const } } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          category: true,
          type: true,
          unit: true,
          quantity: true,
          costPrice: true,
          sellingPrice: true,
          barcode: true,
          salesUnits: true,
          keepingUnit: true,
          sellingUnit: true,
          keepingToSellingRate: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ])

    return withCors(NextResponse.json({
      data: products.map((p) => ({
        ...p,
        quantity: Number(p.quantity),
        costPrice: Number(p.costPrice),
        sellingPrice: Number(p.sellingPrice),
        keepingToSellingRate: p.keepingToSellingRate ? Number(p.keepingToSellingRate) : null,
      })),
      total,
      page,
      limit,
    }))
  } catch (err) {
    console.error('[STOREFRONT PRODUCTS]', err)
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }))
  }
}
