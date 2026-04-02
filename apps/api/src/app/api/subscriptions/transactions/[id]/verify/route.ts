import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import {
  activateSubscriptionFromTransaction,
  appendLifecycleEvent,
  notifyTenantSubscriptionEvent,
} from '@/lib/subscription-transactions'
import { logAudit } from '@/lib/audit'

const verifySchema = z.object({
  reference: z.string().optional(),
  approveTransfer: z.boolean().optional(),
  rejectTransfer: z.boolean().optional(),
  note: z.string().max(1000).optional(),
})

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const body = await req.json().catch(() => ({}))
    const input = verifySchema.parse(body)

    const tx = await prisma.subscriptionTransaction.findUnique({
      where: { id: params.id },
      include: {
        tenant: true,
        requestedPlan: true,
      },
    })

    if (!tx) return apiError('Transaction not found', 404)
    if (!isSuperAdmin(user) && tx.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    const now = new Date()

    if (tx.paymentMethod === 'TRANSFER') {
      if (!isSuperAdmin(user)) return apiError('Only super admin can verify transfer payments', 403)

      if (input.rejectTransfer) {
        const rejected = await prisma.subscriptionTransaction.update({
          where: { id: tx.id },
          data: {
            status: 'REJECTED',
            verifiedByUserId: user.userId,
            verifiedAt: now,
            modifiedByUserId: user.userId,
            modifiedAt: now,
            notes: input.note || tx.notes,
            lifecycleEvents: appendLifecycleEvent(tx.lifecycleEvents, {
              type: 'REJECTED',
              at: now.toISOString(),
              byUserId: user.userId,
              note: input.note,
            }),
          },
        })

        await notifyTenantSubscriptionEvent({
          tenantId: tx.tenantId,
          title: 'Subscription request rejected',
          message: `Your ${tx.requestedPlan.name} subscription request was rejected. ${input.note || ''}`.trim(),
        })

        return NextResponse.json({ data: rejected })
      }

      if (!input.approveTransfer) {
        return apiError('Set approveTransfer=true to verify this transfer payment', 422)
      }

      const verified = await prisma.subscriptionTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'VERIFIED',
          verifiedByUserId: user.userId,
          verifiedAt: now,
          modifiedByUserId: user.userId,
          modifiedAt: now,
          notes: input.note || tx.notes,
          lifecycleEvents: appendLifecycleEvent(tx.lifecycleEvents, {
            type: 'VERIFIED',
            at: now.toISOString(),
            byUserId: user.userId,
            note: input.note,
          }),
        },
      })

      const activated = await activateSubscriptionFromTransaction({
        transactionId: tx.id,
        actorUserId: user.userId,
      })

      await logAudit({
        tenantId: tx.tenantId,
        userId: user.userId,
        action: 'UPDATE',
        entity: 'subscription_transaction',
        entityId: tx.id,
        oldValues: { status: tx.status },
        newValues: { status: 'ACTIVE', verifiedAt: verified.verifiedAt, activatedAt: activated.transaction.activatedAt },
        req,
      })

      await notifyTenantSubscriptionEvent({
        tenantId: tx.tenantId,
        title: 'Subscription activated',
        message: `Your ${tx.requestedPlan.name} subscription has been activated by super admin.`,
      })

      return NextResponse.json({ data: activated.transaction, subscription: activated.subscription })
    }

    if (tx.paymentMethod === 'MANUAL') {
      if (!isSuperAdmin(user)) return apiError('Only super admin can verify manual payments', 403)

      const verified = await prisma.subscriptionTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'VERIFIED',
          verifiedByUserId: user.userId,
          verifiedAt: now,
          modifiedByUserId: user.userId,
          modifiedAt: now,
          notes: input.note || tx.notes,
          lifecycleEvents: appendLifecycleEvent(tx.lifecycleEvents, {
            type: 'VERIFIED',
            at: now.toISOString(),
            byUserId: user.userId,
            note: input.note,
          }),
        },
      })

      const activated = await activateSubscriptionFromTransaction({
        transactionId: tx.id,
        actorUserId: user.userId,
      })

      await logAudit({
        tenantId: tx.tenantId,
        userId: user.userId,
        action: 'UPDATE',
        entity: 'subscription_transaction',
        entityId: tx.id,
        oldValues: { status: tx.status },
        newValues: { status: 'ACTIVE', verifiedAt: verified.verifiedAt, activatedAt: activated.transaction.activatedAt },
        req,
      })

      return NextResponse.json({ data: activated.transaction, subscription: activated.subscription })
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) return apiError('PAYSTACK_SECRET_KEY is not configured', 500)

    const reference = input.reference || tx.paystackReference
    if (!reference) return apiError('Payment reference is required', 422)

    const verifyRes = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    })

    const verifyPayload = await verifyRes.json()
    const isPaid = verifyRes.ok && verifyPayload?.status && verifyPayload?.data?.status === 'success'

    if (!isPaid) {
      return apiError(verifyPayload?.message || 'Payment has not been confirmed', 422)
    }

    await prisma.subscriptionTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'VERIFIED',
        paystackReference: reference,
        paymentProviderResponse: verifyPayload,
        verifiedByUserId: user.userId,
        verifiedAt: now,
        modifiedByUserId: user.userId,
        modifiedAt: now,
        lifecycleEvents: appendLifecycleEvent(tx.lifecycleEvents, {
          type: 'PAYSTACK_VERIFIED',
          at: now.toISOString(),
          byUserId: user.userId,
          metadata: {
            reference,
            gatewayStatus: verifyPayload?.data?.status,
            paidAt: verifyPayload?.data?.paid_at,
          },
        }),
      },
    })

    const activated = await activateSubscriptionFromTransaction({
      transactionId: tx.id,
      actorUserId: user.userId,
    })

    await logAudit({
      tenantId: tx.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'subscription_transaction',
      entityId: tx.id,
      oldValues: { status: tx.status },
      newValues: { status: 'ACTIVE', paystackReference: reference, activatedAt: activated.transaction.activatedAt },
      req,
    })

    await notifyTenantSubscriptionEvent({
      tenantId: tx.tenantId,
      title: 'Subscription activated',
      message: `Your ${tx.requestedPlan.name} subscription payment was verified and activated.`,
    })

    return NextResponse.json({ data: activated.transaction, subscription: activated.subscription })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[SUBSCRIPTION TRANSACTION VERIFY]', err)
    return apiError('Internal server error', 500)
  }
}
