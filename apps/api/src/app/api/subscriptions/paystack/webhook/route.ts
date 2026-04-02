import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  activateSubscriptionFromTransaction,
  appendLifecycleEvent,
  notifyTenantSubscriptionEvent,
} from '@/lib/subscription-transactions'

function verifyPaystackSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const digest = crypto.createHmac('sha512', secret).update(body).digest('hex')
  return digest === signature
}

export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-paystack-signature')

    if (!verifyPaystackSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody) as {
      event?: string
      data?: {
        reference?: string
        status?: string
        paid_at?: string
        amount?: number
        currency?: string
      }
    }

    if (payload.event !== 'charge.success' || !payload.data?.reference) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const tx = await prisma.subscriptionTransaction.findUnique({
      where: { paystackReference: payload.data.reference },
      include: { requestedPlan: true },
    })

    if (!tx) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'transaction-not-found' })
    }

    if (tx.status === 'ACTIVE') {
      return NextResponse.json({ ok: true, alreadyProcessed: true })
    }

    if (tx.paymentMethod !== 'PAYSTACK') {
      return NextResponse.json({ ok: true, ignored: true, reason: 'not-paystack-method' })
    }

    const now = new Date()
    await prisma.subscriptionTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'VERIFIED',
        paymentProviderResponse: payload as unknown as object,
        verifiedAt: now,
        lifecycleEvents: appendLifecycleEvent(tx.lifecycleEvents, {
          type: 'PAYSTACK_VERIFIED',
          at: now.toISOString(),
          metadata: {
            reference: payload.data.reference,
            gatewayStatus: payload.data.status,
            paidAt: payload.data.paid_at,
            amount: payload.data.amount,
            currency: payload.data.currency,
          },
        }),
      },
    })

    const activated = await activateSubscriptionFromTransaction({
      transactionId: tx.id,
      actorUserId: null,
    })

    await notifyTenantSubscriptionEvent({
      tenantId: tx.tenantId,
      title: 'Subscription activated',
      message: `Your ${tx.requestedPlan.name} subscription payment was verified by webhook and activated.`,
    })

    return NextResponse.json({ ok: true, transactionId: tx.id, status: activated.transaction.status })
  } catch (err) {
    console.error('[PAYSTACK WEBHOOK]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
