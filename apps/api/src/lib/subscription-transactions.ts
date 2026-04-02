import { BillingCycle, Prisma, SubscriptionChangeType, SubscriptionPaymentMethod, SubscriptionTransactionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type LifecycleEventType =
  | 'INITIATED'
  | 'PAYSTACK_INITIALIZED'
  | 'PAYSTACK_VERIFIED'
  | 'TRANSFER_PROOF_SUBMITTED'
  | 'VERIFIED'
  | 'ACTIVATED'
  | 'REJECTED'
  | 'UPDATED'

export type LifecycleEvent = {
  type: LifecycleEventType
  at: string
  byUserId?: string | null
  note?: string
  metadata?: Record<string, unknown>
}

export function calculateExpiryDate(startDate: Date, billingCycle: BillingCycle): Date {
  const expiry = new Date(startDate)
  if (billingCycle === 'YEARLY') {
    expiry.setFullYear(expiry.getFullYear() + 1)
  } else {
    expiry.setMonth(expiry.getMonth() + 1)
  }
  return expiry
}

export function deriveTransactionStatus(method: SubscriptionPaymentMethod): SubscriptionTransactionStatus {
  if (method === 'PAYSTACK') return 'PENDING_PAYMENT'
  if (method === 'TRANSFER') return 'PENDING_VERIFICATION'
  return 'VERIFIED'
}

export function appendLifecycleEvent(
  existing: Prisma.JsonValue | null | undefined,
  event: LifecycleEvent
): Prisma.InputJsonValue {
  const safeExisting = Array.isArray(existing) ? existing : []
  return [...safeExisting, event] as Prisma.InputJsonValue
}

export async function activateSubscriptionFromTransaction(args: {
  transactionId: string
  actorUserId?: string | null
}) {
  const now = new Date()
  const actorUserId = args.actorUserId || null

  return prisma.$transaction(async (tx) => {
    const record = await tx.subscriptionTransaction.findUnique({
      where: { id: args.transactionId },
      include: {
        requestedPlan: true,
        subscription: true,
      },
    })

    if (!record) {
      throw new Error('Subscription transaction not found')
    }

    if (record.status === 'ACTIVE') {
      return { transaction: record, subscription: record.subscription }
    }

    await tx.subscription.updateMany({
      where: {
        tenantId: record.tenantId,
        status: 'ACTIVE',
      },
      data: {
        status: 'EXPIRED',
        updatedBy: actorUserId || undefined,
      },
    })

    const startDate = now
    const expiryDate = calculateExpiryDate(startDate, record.billingCycle)

    const activatedSubscription = await tx.subscription.create({
      data: {
        tenantId: record.tenantId,
        planId: record.requestedPlanId,
        startDate,
        expiryDate,
        amount: record.amount,
        status: 'ACTIVE',
        notes: record.notes || undefined,
        createdBy: actorUserId || undefined,
      },
    })

    const lifecycleEvents = appendLifecycleEvent(record.lifecycleEvents, {
      type: 'ACTIVATED',
      at: now.toISOString(),
      byUserId: actorUserId,
      metadata: {
        activatedSubscriptionId: activatedSubscription.id,
        startDate: activatedSubscription.startDate.toISOString(),
        expiryDate: activatedSubscription.expiryDate.toISOString(),
      },
    })

    const updatedTransaction = await tx.subscriptionTransaction.update({
      where: { id: record.id },
      data: {
        subscriptionId: activatedSubscription.id,
        status: 'ACTIVE',
        activatedByUserId: actorUserId || undefined,
        activatedAt: now,
        modifiedByUserId: actorUserId || undefined,
        modifiedAt: now,
        lifecycleEvents,
      },
      include: {
        tenant: { select: { id: true, name: true } },
        requestedPlan: true,
      },
    })

    return { transaction: updatedTransaction, subscription: activatedSubscription }
  })
}

export async function notifyTenantSubscriptionEvent(args: {
  tenantId: string
  title: string
  message: string
}) {
  await prisma.notification.create({
    data: {
      tenantId: args.tenantId,
      type: 'SYSTEM',
      title: args.title,
      message: args.message,
    },
  })
}

export function detectChangeType(input: {
  currentPlanId?: string | null
  requestedPlanId: string
}): SubscriptionChangeType {
  if (!input.currentPlanId) return 'NEW'
  return input.currentPlanId === input.requestedPlanId ? 'RENEW' : 'UPGRADE'
}
