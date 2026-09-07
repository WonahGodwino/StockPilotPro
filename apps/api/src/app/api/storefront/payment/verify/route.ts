import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleOptions } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function OPTIONS() {
  return handleOptions()
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
 * POST /api/storefront/payment/verify
 * Verifies a payment with Paystack and confirms the order.
 * Body: { reference: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { reference } = await req.json()

    if (!reference || typeof reference !== 'string') {
      return withCors(NextResponse.json({ error: 'Payment reference required' }, { status: 400 }))
    }

    // Check if payment already verified
    const existing = await prisma.paymentTransaction.findUnique({
      where: { reference },
      include: { sale: { select: { id: true, orderStatus: true } } },
    })

    if (existing?.status === 'SUCCESS') {
      return withCors(NextResponse.json({
        data: { status: 'success', saleId: existing.sale?.id, orderStatus: existing.sale?.orderStatus },
      }))
    }

    // Verify with Paystack
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY
    if (!paystackSecret) {
      return withCors(NextResponse.json({ error: 'Payment gateway not configured' }, { status: 500 }))
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    })

    if (!response.ok) {
      logger.warn('Paystack verification request failed', { reference, status: response.status })
      return withCors(NextResponse.json({ error: 'Payment verification failed' }, { status: 502 }))
    }

    const result = await response.json() as {
      status: boolean
      data?: {
        status: string
        amount: number
        currency: string
        paidAt: string
        reference: string
        metadata?: Record<string, unknown>
      }
    }

    const paystackStatus = result.data?.status

    // Upsert payment transaction record
    const jsonValue = result.data as import('@prisma/client/runtime/library').InputJsonValue
    const payment = await prisma.paymentTransaction.upsert({
      where: { reference },
      update: {
        status: paystackStatus === 'success' ? 'SUCCESS' : 'FAILED',
        gatewayResponse: jsonValue,
        paidAt: result.data?.paidAt ? new Date(result.data.paidAt) : undefined,
      },
      create: {
        tenantId: '00000000-0000-0000-0000-000000000000', // Will be updated
        reference,
        amount: result.data?.amount ? result.data.amount / 100 : 0, // Paystack returns kobo
        currency: result.data?.currency || 'NGN',
        status: paystackStatus === 'success' ? 'SUCCESS' : 'FAILED',
        gateway: 'PAYSTACK',
        gatewayResponse: jsonValue,
        paidAt: result.data?.paidAt ? new Date(result.data.paidAt) : undefined,
      },
    })

    // If payment successful, update the order
    if (paystackStatus === 'success') {
      // Find and update the sale
      const sale = await prisma.sale.findFirst({
        where: {
          transactionRef: reference,
          orderStatus: 'PENDING',
          source: 'ONLINE',
        },
        select: { id: true, tenantId: true },
      })

      if (sale) {
        // Update the payment with correct tenant
        await prisma.paymentTransaction.update({
          where: { id: payment.id },
          data: { tenantId: sale.tenantId, saleId: sale.id },
        })

        await prisma.sale.update({
          where: { id: sale.id },
          data: { orderStatus: 'CONFIRMED' },
        })
      }

      return withCors(NextResponse.json({
        data: { status: 'success', reference, orderStatus: sale ? 'CONFIRMED' : 'PENDING' },
      }))
    }

    return withCors(NextResponse.json({
      data: { status: 'failed', reference },
    }))
  } catch (err) {
    logger.error('Payment verification failed', { err })
    console.error('[STOREFRONT PAYMENT]', err)
    return withCors(NextResponse.json({ error: 'Payment verification failed' }, { status: 500 }))
  }
}
