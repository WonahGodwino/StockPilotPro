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
 * GET /api/storefront/info?slug=<tenant-slug>
 * Public endpoint — returns basic store info and the first active subsidiary ID
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = searchParams.get('slug')

    if (!slug) {
      return withCors(NextResponse.json({ error: 'slug query parameter required' }, { status: 400 }))
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        baseCurrency: true,
        isActive: true,
        subsidiaries: {
          where: { isActive: true, archived: false },
          select: { id: true, name: true },
          take: 1,
        },
      },
    })

    if (!tenant || !tenant.isActive) {
      return withCors(NextResponse.json({ error: 'Store not found' }, { status: 404 }))
    }

    return withCors(NextResponse.json({
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logo: tenant.logo,
        baseCurrency: tenant.baseCurrency,
        subsidiaryId: tenant.subsidiaries[0]?.id || null,
      },
    }))
  } catch (err) {
    console.error('[STOREFRONT INFO]', err)
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }))
  }
}
