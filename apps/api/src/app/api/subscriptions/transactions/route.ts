import { NextRequest, NextResponse } from 'next/server'
import { SubscriptionPaymentMethod, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { appendLifecycleEvent, deriveTransactionStatus, detectChangeType } from '@/lib/subscription-transactions'
import { getAgentTenantIds, isAgent, isTenantAssignedToAgent } from '@/lib/agent-access'

const createSchema = z.object({
  tenantId: z.string().optional(),
  requestedPlanId: z.string(),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
  paymentMethod: z.enum(['PAYSTACK', 'TRANSFER', 'MANUAL']),
  amount: z.number().positive().optional(),
  currency: z.string().min(3).max(3).transform((v) => v.toUpperCase()).optional(),
  notes: z.string().max(1000).optional(),
  transferProofUrl: z.string().max(4000).optional(),
  transferProofOriginalName: z.string().max(255).optional(),
  transferProofSize: z.number().int().nonnegative().optional(),
  transferProofContentType: z.string().max(120).optional(),
  transferProofUploadedByUserId: z.string().optional(),
  transferProofUploadedAt: z.string().datetime().optional(),
  transferProofNote: z.string().max(1000).optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const url = new URL(req.url)

    const requestedTenantId = url.searchParams.get('tenantId') || undefined

    let tenantId: string | undefined
    if (isSuperAdmin(user)) {
      tenantId = requestedTenantId
    } else if (isAgent(user)) {
      if (requestedTenantId) {
        const allowed = await isTenantAssignedToAgent(user.userId, requestedTenantId)
        if (!allowed) return apiError('Forbidden', 403)
        tenantId = requestedTenantId
      }
    } else {
      tenantId = user.tenantId || undefined
    }

    if (!tenantId && !isSuperAdmin(user) && !isAgent(user)) return apiError('Forbidden', 403)

    const status = url.searchParams.get('status') || undefined
    const paymentMethod = url.searchParams.get('paymentMethod') || undefined
    const changeType = url.searchParams.get('changeType') || undefined
    const format = url.searchParams.get('format') || 'json'

    const createdFromRaw = url.searchParams.get('createdFrom')
    const createdToRaw = url.searchParams.get('createdTo')
    const createdAt = createdFromRaw || createdToRaw
      ? {
          ...(createdFromRaw ? { gte: new Date(createdFromRaw) } : {}),
          ...(createdToRaw ? { lte: new Date(createdToRaw) } : {}),
        }
      : undefined

    const agentTenantIds = isAgent(user) && !tenantId ? await getAgentTenantIds(user.userId) : []

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(isAgent(user) && !tenantId ? { tenantId: { in: agentTenantIds } } : {}),
      ...(status ? { status: status as never } : {}),
      ...(paymentMethod ? { paymentMethod: paymentMethod as never } : {}),
      ...(changeType ? { changeType: changeType as never } : {}),
      ...(createdAt ? { createdAt } : {}),
    } as never

    const data = await prisma.subscriptionTransaction.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        subscription: { include: { plan: true } },
        requestedPlan: true,
        currentPlan: true,
        initiatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        activatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    if (format === 'csv') {
      const header = [
        'id',
        'tenantId',
        'tenantName',
        'requestedPlan',
        'changeType',
        'paymentMethod',
        'status',
        'amount',
        'currency',
        'paystackReference',
        'transferProofUrl',
        'transferProofOriginalName',
        'transferProofSize',
        'transferProofContentType',
        'transferProofUploadedByUserId',
        'transferProofUploadedAt',
        'initiatedByUserId',
        'verifiedByUserId',
        'activatedByUserId',
        'createdAt',
      ]

      const escapeCell = (value: unknown) => {
        const text = String(value ?? '')
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          return `"${text.replace(/"/g, '""')}"`
        }
        return text
      }

      const rows = data.map((row) => [
        row.id,
        row.tenantId,
        row.tenant?.name || '',
        row.requestedPlan?.name || row.requestedPlanId,
        row.changeType,
        row.paymentMethod,
        row.status,
        Number(row.amount),
        row.currency,
        row.paystackReference || '',
        row.transferProofUrl || '',
        row.transferProofOriginalName || '',
        row.transferProofSize ?? '',
        row.transferProofContentType || '',
        row.transferProofUploadedByUserId || '',
        row.transferProofUploadedAt ? row.transferProofUploadedAt.toISOString() : '',
        row.initiatedByUserId || '',
        row.verifiedByUserId || '',
        row.activatedByUserId || '',
        row.createdAt.toISOString(),
      ])

      const csv = [header, ...rows].map((line) => line.map(escapeCell).join(',')).join('\n')

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="subscription-transactions.csv"',
        },
      })
    }

    return NextResponse.json({ data })
  } catch (err) {
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[SUBSCRIPTION TRANSACTIONS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (user.role === UserRole.SALESPERSON) return apiError('Forbidden', 403)
    const agentUser = isAgent(user)

    const body = await req.json()
    const parsed = createSchema.parse(body)

    const superAdmin = isSuperAdmin(user)
    if (!superAdmin && !agentUser && parsed.tenantId) {
      return apiError('You can only initiate transactions for your own business or organization', 403)
    }

    const tenantId = superAdmin
      ? parsed.tenantId
      : agentUser
        ? parsed.tenantId
        : user.tenantId

    if (!tenantId) return apiError('Tenant is required', 422)
    if (agentUser) {
      const allowed = await isTenantAssignedToAgent(user.userId, tenantId)
      if (!allowed) return apiError('You can only initiate transactions for businesses assigned to you', 403)
    } else if (!superAdmin && tenantId !== user.tenantId) {
      return apiError('You can only initiate transactions for your own business or organization', 403)
    }

    const [tenant, requestedPlan] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.plan.findUnique({ where: { id: parsed.requestedPlanId } }),
    ])

    if (!tenant) return apiError('Tenant not found', 404)
    if (!requestedPlan || !requestedPlan.isActive) return apiError('Requested plan not found or inactive', 404)

    const activeSubscription = await prisma.subscription.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    })

    const billingCycle = parsed.billingCycle || requestedPlan.billingCycle
    const amount = parsed.amount ?? Number(requestedPlan.price)
    const status = deriveTransactionStatus(parsed.paymentMethod as SubscriptionPaymentMethod)
    const changeType = detectChangeType({
      currentPlanId: activeSubscription?.planId,
      requestedPlanId: requestedPlan.id,
    })

    const now = new Date()
    const proofUploader = parsed.transferProofUploadedByUserId || user.userId
    if (parsed.transferProofUploadedByUserId && parsed.transferProofUploadedByUserId !== user.userId && !superAdmin) {
      return apiError('Invalid transfer proof uploader metadata', 403)
    }
    const initialEvents = appendLifecycleEvent([], {
      type: 'INITIATED',
      at: now.toISOString(),
      byUserId: user.userId,
      metadata: {
        paymentMethod: parsed.paymentMethod,
        changeType,
      },
    })

    const created = await prisma.subscriptionTransaction.create({
      data: {
        tenantId,
        subscriptionId: activeSubscription?.id,
        currentPlanId: activeSubscription?.planId,
        requestedPlanId: requestedPlan.id,
        changeType,
        paymentMethod: parsed.paymentMethod,
        billingCycle,
        amount,
        currency: parsed.currency || requestedPlan.priceCurrency,
        status,
        transferProofUrl: parsed.transferProofUrl,
        transferProofOriginalName: parsed.transferProofOriginalName,
        transferProofSize: parsed.transferProofSize,
        transferProofContentType: parsed.transferProofContentType,
        transferProofUploadedByUserId: parsed.transferProofUrl ? proofUploader : undefined,
        transferProofUploadedAt: parsed.transferProofUrl ? (parsed.transferProofUploadedAt ? new Date(parsed.transferProofUploadedAt) : now) : undefined,
        transferProofNote: parsed.transferProofNote,
        initiatedByUserId: user.userId,
        modifiedByUserId: user.userId,
        modifiedAt: now,
        notes: parsed.notes,
        lifecycleEvents: initialEvents,
      },
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        requestedPlan: true,
        currentPlan: true,
      },
    })

    await logAudit({
      tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'subscription_transaction',
      entityId: created.id,
      newValues: {
        paymentMethod: created.paymentMethod,
        status: created.status,
        changeType: created.changeType,
        requestedPlanId: created.requestedPlanId,
        initiatedByUserId: created.initiatedByUserId,
      },
      req,
    })

    if (created.paymentMethod === 'TRANSFER') {
      const superAdmins = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', isActive: true, archived: false, tenantId: { not: null } },
        select: { tenantId: true },
      })

      await Promise.all(
        Array.from(new Set(superAdmins.map((u) => u.tenantId).filter(Boolean))).map((superTenantId) =>
          prisma.notification.create({
            data: {
              tenantId: superTenantId!,
              type: 'SYSTEM',
              title: 'Transfer payment pending verification',
              message: `Tenant ${tenant.name} submitted transfer proof for ${requestedPlan.name}.`,
            },
          })
        )
      )
    }

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('token')) return apiError('Unauthorized', 401)
    console.error('[SUBSCRIPTION TRANSACTIONS POST]', err)
    return apiError('Internal server error', 500)
  }
}
