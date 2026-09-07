import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleOptions } from '@/lib/auth'

export async function OPTIONS() {
  return handleOptions()
}

/**
 * POST /api/storefront/orders/track
 * Public endpoint — track an order by email + tracking code
 * Body: { email: string, code: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json()

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and tracking code are required' }, { status: 400 })
    }

    const sale = await prisma.sale.findFirst({
      where: {
        trackingCode: code?.trim()?.toUpperCase(),
        source: 'ONLINE',
        customer: { email: email?.trim()?.toLowerCase() },
      },
      select: {
        id: true,
        receiptNumber: true,
        trackingCode: true,
        trackingStatus: true,
        totalAmount: true,
        currency: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        shippingAddress: true,
        validatedAt: true,
        validationNote: true,
        items: {
          include: { product: { select: { name: true, unit: true, imageUrl: true } } },
        },
      },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Order not found. Check your email and tracking code.' }, { status: 404 })
    }

    return NextResponse.json({ data: sale })
  } catch (err) {
    console.error('[ORDER TRACK]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
