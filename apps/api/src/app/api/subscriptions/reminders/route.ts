import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { sendEmail } from '@/lib/mailer'
import { logAudit } from '@/lib/audit'

type WindowType = 'current_month' | 'next_month' | 'two_months'
type ChannelType = 'app' | 'email' | 'both'

const postSchema = z.object({
  subscriptionId: z.string().optional(),
  channel: z.enum(['app', 'email', 'both']).default('both'),
  mode: z.enum(['manual', 'auto']).default('manual'),
})

function getWindowBounds(windowType: WindowType): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  if (windowType === 'current_month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(end.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (windowType === 'next_month') {
    start.setMonth(start.getMonth() + 1, 1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(end.getMonth() + 2, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  // two_months window from today forward
  start.setHours(0, 0, 0, 0)
  end.setMonth(end.getMonth() + 2)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function daysUntil(date: Date): number {
  const now = new Date()
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function reminderKey(subscriptionId: string, daysLeft: number): string {
  return `[SUB_REMINDER:${subscriptionId}:${daysLeft}]`
}

async function sendReminderForSubscription(subscription: {
  id: string
  tenantId: string
  expiryDate: Date
  amount: unknown
  tenant: { name: string; email: string }
  plan: { name: string }
}, adminEmails: string[], channel: ChannelType) {
  const daysLeft = daysUntil(subscription.expiryDate)
  if (daysLeft < 0) return { sentApp: false, sentEmail: false, skipped: true }

  const key = reminderKey(subscription.id, daysLeft)
  const title = 'Subscription Renewal Reminder'
  const message = `${key} Your ${subscription.plan.name} subscription for ${subscription.tenant.name} expires in ${daysLeft} day(s). Renew now to avoid service disruption.`

  let sentApp = false
  let sentEmail = false

  if (channel === 'app' || channel === 'both') {
    const existing = await prisma.notification.findFirst({
      where: {
        tenantId: subscription.tenantId,
        type: 'SUBSCRIPTION_EXPIRING',
        message: { contains: key },
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      select: { id: true },
    })

    if (!existing) {
      await prisma.notification.create({
        data: {
          tenantId: subscription.tenantId,
          type: 'SUBSCRIPTION_EXPIRING',
          title,
          message,
        },
      })
      sentApp = true
    }
  }

  if ((channel === 'email' || channel === 'both') && adminEmails.length > 0) {
    const amount = Number(subscription.amount)
    const billingCurrency = (subscription as { billingCurrency?: string }).billingCurrency || 'USD'
    const subject = `StockPilot Subscription expires in ${daysLeft} day(s)`
    const text = [
      `Hello,`,
      '',
      `Your ${subscription.plan.name} subscription for ${subscription.tenant.name} expires on ${subscription.expiryDate.toDateString()}.`,
      `Current amount: ${amount.toFixed(2)} ${billingCurrency}.`,
      '',
      `Please renew now to avoid service disruption.`,
      '',
      `StockPilot Pro`,
    ].join('\n')

    const emailResult = await sendEmail({
      to: adminEmails,
      subject,
      text,
    })

    sentEmail = emailResult.sent
  }

  return { sentApp, sentEmail, skipped: false }
}

async function logReminderDelivery(input: {
  actorUserId: string
  tenantId: string
  subscriptionId: string
  mode: 'manual' | 'auto'
  channel: ChannelType
  recipients: string[]
  daysLeft: number
  sentApp: boolean
  sentEmail: boolean
}) {
  const status = input.channel === 'both'
    ? (input.sentApp && input.sentEmail ? 'SUCCESS' : input.sentApp || input.sentEmail ? 'PARTIAL' : 'FAILED')
    : input.channel === 'app'
      ? (input.sentApp ? 'SUCCESS' : 'FAILED')
      : (input.sentEmail ? 'SUCCESS' : 'FAILED')

  await logAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: 'NOTIFY',
    entity: 'subscription_reminder',
    entityId: input.subscriptionId,
    newValues: {
      mode: input.mode,
      channel: input.channel,
      status,
      recipients: input.recipients,
      daysLeft: input.daysLeft,
      sentApp: input.sentApp,
      sentEmail: input.sentEmail,
      sentAt: new Date().toISOString(),
    },
  })
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const url = new URL(req.url)
    const windowParam = (url.searchParams.get('window') || 'two_months') as WindowType
    const normalizedWindow: WindowType = ['current_month', 'next_month', 'two_months'].includes(windowParam)
      ? windowParam
      : 'two_months'

    const { start, end } = getWindowBounds(normalizedWindow)

    const subscriptions = await prisma.subscription.findMany({
      where: {
        tenantId: { not: user.tenantId! },
        status: 'ACTIVE',
        expiryDate: { gte: start, lte: end },
      },
      include: {
        plan: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true, email: true } },
      },
      orderBy: { expiryDate: 'asc' },
    })

    const tenantIds = Array.from(new Set(subscriptions.map((s) => s.tenantId)))
    const admins = tenantIds.length
      ? await prisma.user.findMany({
          where: {
            tenantId: { in: tenantIds },
            role: 'BUSINESS_ADMIN',
            isActive: true,
            archived: false,
          },
          select: { tenantId: true, email: true, firstName: true, lastName: true },
        })
      : []

    const groupedAdmins = new Map<string, { email: string; name: string }[]>()
    for (const admin of admins) {
      const list = groupedAdmins.get(admin.tenantId || '') || []
      list.push({ email: admin.email, name: `${admin.firstName} ${admin.lastName}`.trim() })
      groupedAdmins.set(admin.tenantId || '', list)
    }

    const data = subscriptions.map((s) => {
      const adminList = groupedAdmins.get(s.tenantId) || []
      const emails = Array.from(new Set([s.tenant.email, ...adminList.map((a) => a.email)].filter(Boolean)))
      return {
        id: s.id,
        tenantId: s.tenantId,
        tenantName: s.tenant.name,
        tenantEmail: s.tenant.email,
        planId: s.planId,
        planName: s.plan.name,
        expiryDate: s.expiryDate,
        amount: Number(s.amount),
        billingCurrency: (s as { billingCurrency?: string }).billingCurrency || 'USD',
        daysLeft: daysUntil(s.expiryDate),
        adminEmails: emails,
      }
    })

    return NextResponse.json({ data, window: normalizedWindow })
  } catch (err) {
    console.error('[SUBSCRIPTION REMINDERS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const input = postSchema.parse(body)

    let targets: Array<{
      id: string
      tenantId: string
      expiryDate: Date
      amount: unknown
      tenant: { name: string; email: string }
      plan: { name: string }
    }> = []

    if (input.subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: input.subscriptionId },
        include: {
          tenant: { select: { name: true, email: true } },
          plan: { select: { name: true } },
        },
      })
      if (!sub) return apiError('Subscription not found', 404)
      targets = [sub]
    } else {
      const { start, end } = getWindowBounds('two_months')
      targets = await prisma.subscription.findMany({
        where: {
          tenantId: { not: user.tenantId! },
          status: 'ACTIVE',
          expiryDate: { gte: start, lte: end },
        },
        include: {
          tenant: { select: { name: true, email: true } },
          plan: { select: { name: true } },
        },
      })
    }

    const tenantIds = Array.from(new Set(targets.map((s) => s.tenantId)))
    const admins = tenantIds.length
      ? await prisma.user.findMany({
          where: {
            tenantId: { in: tenantIds },
            role: 'BUSINESS_ADMIN',
            isActive: true,
            archived: false,
          },
          select: { tenantId: true, email: true },
        })
      : []

    const adminsByTenant = new Map<string, string[]>()
    for (const a of admins) {
      const key = a.tenantId || ''
      const list = adminsByTenant.get(key) || []
      list.push(a.email)
      adminsByTenant.set(key, list)
    }

    // automatic reminders should start in the 2-month window, but trigger milestones to avoid spam
    const autoMilestones = new Set([60, 45, 30, 14, 7, 3, 1])

    let processed = 0
    let sentAppCount = 0
    let sentEmailCount = 0

    for (const subscription of targets) {
      const daysLeft = daysUntil(subscription.expiryDate)
      if (daysLeft < 0) continue
      if (input.mode === 'auto' && !autoMilestones.has(daysLeft)) continue

      const recipients = Array.from(new Set([
        subscription.tenant.email,
        ...(adminsByTenant.get(subscription.tenantId) || []),
      ].filter(Boolean)))

      const result = await sendReminderForSubscription(subscription, recipients, input.channel)
      if (result.skipped) continue

      await logReminderDelivery({
        actorUserId: user.userId,
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        mode: input.mode,
        channel: input.channel,
        recipients,
        daysLeft,
        sentApp: result.sentApp,
        sentEmail: result.sentEmail,
      })

      processed += 1
      if (result.sentApp) sentAppCount += 1
      if (result.sentEmail) sentEmailCount += 1
    }

    return NextResponse.json({
      data: {
        processed,
        sentAppCount,
        sentEmailCount,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[SUBSCRIPTION REMINDERS POST]', err)
    return apiError('Internal server error', 500)
  }
}
