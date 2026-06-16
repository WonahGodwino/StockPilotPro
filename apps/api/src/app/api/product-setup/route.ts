import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})

const createBrandSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})

export async function OPTIONS() {
  return handleOptions()
}

// GET categories and brands for current tenant
export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!user.tenantId) return apiError('Tenant context required', 400)

    const type = new URL(req.url).searchParams.get('type') || 'categories'

    if (type === 'brands') {
      const brands = await prisma.productBrand.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      return NextResponse.json({ data: brands })
    }

    const categories = await prisma.productCategory.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
    return NextResponse.json({ data: categories })
  } catch (err) {
    console.error('[PRODUCT_SETUP GET]', err)
    return apiError('Internal server error', 500)
  }
}

// POST new category or brand
export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!user.tenantId) return apiError('Tenant context required', 400)

    const body = await req.json()
    const type = body.type || 'category'

    if (type === 'brand') {
      const data = createBrandSchema.parse(body)
      const brand = await prisma.productBrand.create({
        data: {
          tenantId: user.tenantId,
          name: data.name,
        },
      })
      return NextResponse.json({ data: brand }, { status: 201 })
    }

    const data = createCategorySchema.parse(body)
    const category = await prisma.productCategory.create({
      data: {
        tenantId: user.tenantId,
        name: data.name,
      },
    })
    return NextResponse.json({ data: category }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as { code?: string }).code === 'P2002') return apiError('A category or brand with this name already exists for your business', 409)
    console.error('[PRODUCT_SETUP POST]', err)
    return apiError('Internal server error', 500)
  }
}