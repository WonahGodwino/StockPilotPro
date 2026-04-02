import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { appendLifecycleEvent } from '@/lib/subscription-transactions'

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const tx = await prisma.subscriptionTransaction.findUnique({
      where: { id: params.id },
      include: { tenant: true },
    })

    if (!tx) return apiError('Transaction not found', 404)
    if (!isSuperAdmin(user) && tx.tenantId !== user.tenantId) return apiError('Forbidden', 403)
    if (tx.paymentMethod !== 'PAYSTACK') return apiError('Transaction is not a Paystack transaction', 422)

    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) return apiError('PAYSTACK_SECRET_KEY is not configured', 500)

    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || `${new URL(req.url).origin}/settings?paystack=callback`

    const initializeResponse = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: tx.tenant.email,
        amount: Math.round(Number(tx.amount) * 100),
        currency: tx.currency,
        callback_url: callbackUrl,
        metadata: {
          transactionId: tx.id,
          tenantId: tx.tenantId,
          requestedPlanId: tx.requestedPlanId,
          initiatedByUserId: tx.initiatedByUserId,
        },
      }),
    })

    const payload = await initializeResponse.json()
    if (!initializeResponse.ok || !payload?.status || !payload?.data?.reference) {
      return apiError(payload?.message || 'Failed to initialize Paystack payment', 502)
    }

    const now = new Date()
    const updated = await prisma.subscriptionTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'PENDING_PAYMENT',
        paystackReference: payload.data.reference,
        paystackAccessCode: payload.data.access_code || null,
        paymentProviderResponse: payload,
        modifiedByUserId: user.userId,
        modifiedAt: now,
        lifecycleEvents: appendLifecycleEvent(tx.lifecycleEvents, {
          type: 'PAYSTACK_INITIALIZED',
          at: now.toISOString(),
          byUserId: user.userId,
          metadata: {
            reference: payload.data.reference,
            authorizationUrl: payload.data.authorization_url,
          },
        }),
      },
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        requestedPlan: true,
      },
    })

    return NextResponse.json({
      data: updated,
      payment: {
        reference: payload.data.reference,
        authorizationUrl: payload.data.authorization_url,
        accessCode: payload.data.access_code,
      },
    })
  } catch (err) {
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[PAYSTACK INIT]', err)
    return apiError('Internal server error', 500)
  }
}
