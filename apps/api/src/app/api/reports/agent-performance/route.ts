import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isAgent } from '@/lib/agent-access'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

function normalizeBatchId(input?: string | null): string | null {
  const value = (input || '').trim()
  if (!value) return null
  return value.slice(0, 64)
}

function makeBatchId(prefix: 'MANUAL' | 'UPLOAD'): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const token = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}-${stamp}-${token}`
}

function parseCycleDates(from?: string | null, to?: string | null): { cycleStartAt: Date | null; cycleEndAt: Date | null } {
  if (!from || !to) return { cycleStartAt: null, cycleEndAt: null }

  const cycleStartAt = new Date(from)
  const cycleEndAt = new Date(to)
  if (Number.isNaN(cycleStartAt.getTime()) || Number.isNaN(cycleEndAt.getTime())) {
    return { cycleStartAt: null, cycleEndAt: null }
  }

  return { cycleStartAt, cycleEndAt }
}

function getDateRange(period: string, from?: string, to?: string) {
  const now = new Date()
  if (from && to) return { gte: new Date(from), lte: new Date(to) }

  switch (period) {
    case 'weekly': {
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return { gte: start, lte: new Date() }
    }
    case 'monthly': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { gte: start, lte: new Date() }
    }
    case 'quarterly': {
      const q = Math.floor(now.getMonth() / 3)
      const start = new Date(now.getFullYear(), q * 3, 1)
      return { gte: start, lte: new Date() }
    }
    case 'yearly': {
      const start = new Date(now.getFullYear(), 0, 1)
      return { gte: start, lte: new Date() }
    }
    default:
      return undefined
  }
}

async function getTransactionToBaseRate(baseTenantId: string, baseCurrency: string, transactionCurrency: string): Promise<number> {
  if (transactionCurrency === baseCurrency) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: { tenantId: baseTenantId, fromCurrency: baseCurrency, toCurrency: transactionCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (direct?.rate) return Number(direct.rate)

  const inverse = await prisma.currencyRate.findFirst({
    where: { tenantId: baseTenantId, fromCurrency: transactionCurrency, toCurrency: baseCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (inverse?.rate) return 1 / Number(inverse.rate)

  return 1
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  cells.push(current.trim())
  return cells
}

function parseCsvTransactionIds(csvContent: string): string[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (!lines.length) return []

  const headerCells = parseCsvRow(lines[0]).map((cell) => cell.toLowerCase())
  const idIndex = headerCells.findIndex((cell) => ['transactionid', 'subscriptiontransactionid', 'id'].includes(cell.replace(/[^a-z]/g, '')))
  const startIndex = idIndex >= 0 ? 1 : 0

  const ids = new Set<string>()
  for (let i = startIndex; i < lines.length; i += 1) {
    const row = parseCsvRow(lines[i])
    const candidate = (idIndex >= 0 ? row[idIndex] : row[0])?.trim()
    if (!candidate) continue
    ids.add(candidate)
  }

  return Array.from(ids)
}

async function buildSuperAdminResponse(req: NextRequest, user: ReturnType<typeof authenticate>) {
  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') || 'monthly'
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined
  const paymentStatusFilter = (searchParams.get('paymentStatus') || 'ALL').toUpperCase()
  const batchIdFilter = normalizeBatchId(searchParams.get('batchId'))
  const withoutBatchOnly = ['1', 'true', 'yes'].includes((searchParams.get('withoutBatch') || '').toLowerCase())
  const dateRange = getDateRange(period, from, to)

  const platformTenant = user.tenantId
    ? await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { id: true, baseCurrency: true },
      })
    : null
  const baseCurrency = platformTenant?.baseCurrency || 'USD'

  const transactions = await prisma.subscriptionTransaction.findMany({
    where: {
      status: { in: ['ACTIVE', 'VERIFIED'] },
      tenant: {
        archived: false,
        acquisitionAgentId: { not: null },
      },
      ...(dateRange ? { initiatedAt: dateRange } : {}),
    },
    select: {
      id: true,
      status: true,
      tenantId: true,
      changeType: true,
      amount: true,
      currency: true,
      initiatedAt: true,
      tenant: {
        select: {
          id: true,
          name: true,
          acquisitionAgent: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
      commissionRemittance: {
        select: {
          status: true,
          paidAt: true,
          reportFileName: true,
          source: true,
          batchId: true,
          cycleStartAt: true,
          cycleEndAt: true,
        },
      },
    },
    orderBy: { initiatedAt: 'desc' },
  })

  const rateCache = new Map<string, number>()
  const summaryByAgent = new Map<
    string,
    {
      agentId: string
      agentName: string
      agentEmail: string
      newSubscriptions: number
      renewals: number
      totalAmountGenerated: number
      pendingRecords: number
      paidRecords: number
      totalRecords: number
    }
  >()

  const detailedRecords: Array<{
    transactionId: string
    initiatedAt: Date
    transactionStatus: string
    paymentStatus: 'PENDING' | 'PAID'
    paidAt: Date | null
    source: string | null
    reportFileName: string | null
    batchId: string | null
    cycleStartAt: Date | null
    cycleEndAt: Date | null
    agentId: string
    agentName: string
    agentEmail: string
    tenantId: string
    tenantName: string
    changeType: string
    amountGenerated: number
    amountOriginal: number
    currency: string
  }> = []

  for (const transaction of transactions) {
    if (!transaction.tenant?.acquisitionAgent) continue

    const currency = transaction.currency || 'USD'
    let rate = rateCache.get(currency)
    if (rate === undefined) {
      rate = platformTenant?.id
        ? await getTransactionToBaseRate(platformTenant.id, baseCurrency, currency)
        : 1
      rateCache.set(currency, rate)
    }

    const amountOriginal = Number(transaction.amount)
    const amountGenerated = currency === baseCurrency ? amountOriginal : amountOriginal / rate
    const paymentStatus: 'PENDING' | 'PAID' = transaction.commissionRemittance?.status === 'PAID' ? 'PAID' : 'PENDING'

    const agent = transaction.tenant.acquisitionAgent
    const agentId = agent.id
    const existing = summaryByAgent.get(agentId) || {
      agentId,
      agentName: `${agent.firstName} ${agent.lastName}`.trim(),
      agentEmail: agent.email,
      newSubscriptions: 0,
      renewals: 0,
      totalAmountGenerated: 0,
      pendingRecords: 0,
      paidRecords: 0,
      totalRecords: 0,
    }

    if (transaction.changeType === 'NEW') existing.newSubscriptions += 1
    if (transaction.changeType === 'RENEW') existing.renewals += 1
    existing.totalAmountGenerated += amountGenerated
    existing.totalRecords += 1
    if (paymentStatus === 'PAID') existing.paidRecords += 1
    if (paymentStatus === 'PENDING') existing.pendingRecords += 1
    summaryByAgent.set(agentId, existing)

    detailedRecords.push({
      transactionId: transaction.id,
      initiatedAt: transaction.initiatedAt,
      transactionStatus: transaction.status,
      paymentStatus,
      paidAt: transaction.commissionRemittance?.paidAt || null,
      source: transaction.commissionRemittance?.source || null,
      reportFileName: transaction.commissionRemittance?.reportFileName || null,
      batchId: transaction.commissionRemittance?.batchId || null,
      cycleStartAt: transaction.commissionRemittance?.cycleStartAt || null,
      cycleEndAt: transaction.commissionRemittance?.cycleEndAt || null,
      agentId,
      agentName: `${agent.firstName} ${agent.lastName}`.trim(),
      agentEmail: agent.email,
      tenantId: transaction.tenant.id,
      tenantName: transaction.tenant.name,
      changeType: transaction.changeType,
      amountGenerated,
      amountOriginal,
      currency,
    })
  }

  const summaryRows = Array.from(summaryByAgent.values()).sort((a, b) => b.totalAmountGenerated - a.totalAmountGenerated)

  const filteredDetails = detailedRecords.filter((row) => {
    if (paymentStatusFilter === 'PAID' && row.paymentStatus !== 'PAID') return false
    if (paymentStatusFilter === 'PENDING' && row.paymentStatus !== 'PENDING') return false
    if (batchIdFilter && (row.batchId || '') !== batchIdFilter) return false
    if (withoutBatchOnly && row.batchId) return false
    return true
  })

  const availableBatchIds = Array.from(
    new Set(detailedRecords.map((row) => row.batchId).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => b.localeCompare(a))

  const batchSummaryMap = new Map<
    string,
    {
      batchId: string
      paidRecords: number
      paidAmountGenerated: number
      firstPaidAt: Date | null
      lastPaidAt: Date | null
      cycleStartAt: Date | null
      cycleEndAt: Date | null
    }
  >()

  for (const row of detailedRecords) {
    if (row.paymentStatus !== 'PAID' || !row.batchId) continue
    const current = batchSummaryMap.get(row.batchId) || {
      batchId: row.batchId,
      paidRecords: 0,
      paidAmountGenerated: 0,
      firstPaidAt: row.paidAt,
      lastPaidAt: row.paidAt,
      cycleStartAt: row.cycleStartAt,
      cycleEndAt: row.cycleEndAt,
    }

    current.paidRecords += 1
    current.paidAmountGenerated += row.amountGenerated

    if (row.paidAt && (!current.firstPaidAt || row.paidAt < current.firstPaidAt)) current.firstPaidAt = row.paidAt
    if (row.paidAt && (!current.lastPaidAt || row.paidAt > current.lastPaidAt)) current.lastPaidAt = row.paidAt
    if (row.cycleStartAt && (!current.cycleStartAt || row.cycleStartAt < current.cycleStartAt)) current.cycleStartAt = row.cycleStartAt
    if (row.cycleEndAt && (!current.cycleEndAt || row.cycleEndAt > current.cycleEndAt)) current.cycleEndAt = row.cycleEndAt

    batchSummaryMap.set(row.batchId, current)
  }

  const batchSummaries = Array.from(batchSummaryMap.values()).sort((a, b) => {
    const left = a.lastPaidAt ? a.lastPaidAt.getTime() : 0
    const right = b.lastPaidAt ? b.lastPaidAt.getTime() : 0
    return right - left
  })

  const selectedBatchSummary = batchIdFilter
    ? batchSummaries.find((summary) => summary.batchId === batchIdFilter) || null
    : null

  return {
    period,
    dateRange: {
      from: dateRange?.gte || null,
      to: dateRange?.lte || null,
    },
    baseCurrency,
    summary: {
      totals: {
        agents: summaryRows.length,
        newSubscriptions: summaryRows.reduce((sum, row) => sum + row.newSubscriptions, 0),
        renewals: summaryRows.reduce((sum, row) => sum + row.renewals, 0),
        totalAmountGenerated: summaryRows.reduce((sum, row) => sum + row.totalAmountGenerated, 0),
      },
      rows: summaryRows,
    },
    details: {
      appliedFilters: {
        paymentStatus: ['PAID', 'PENDING'].includes(paymentStatusFilter) ? paymentStatusFilter : 'ALL',
        batchId: batchIdFilter,
        withoutBatch: withoutBatchOnly,
      },
      availableBatchIds,
      batchSummaries,
      selectedBatchSummary,
      totals: {
        records: filteredDetails.length,
        pending: filteredDetails.filter((row) => row.paymentStatus === 'PENDING').length,
        paid: filteredDetails.filter((row) => row.paymentStatus === 'PAID').length,
        totalAmountGenerated: filteredDetails.reduce((sum, row) => sum + row.amountGenerated, 0),
      },
      records: filteredDetails,
    },
  }
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isAgent(user) && !isSuperAdmin(user)) return apiError('Forbidden', 403)

    if (isSuperAdmin(user)) {
      const payload = await buildSuperAdminResponse(req, user)
      return NextResponse.json({ data: payload })
    }

    const tenants = await prisma.tenant.findMany({
      where: {
        archived: false,
        acquisitionAgentId: user.userId,
      },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            subscriptionTransactions: {
              where: {
                status: {
                  in: ['PENDING_PAYMENT', 'PENDING_VERIFICATION'],
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const totalBusinesses = tenants.length
    const activeSubscriptions = tenants.filter((tenant) => tenant.subscriptions[0]?.status === 'ACTIVE').length
    const pendingRequests = tenants.reduce((sum, tenant) => sum + (tenant._count?.subscriptionTransactions || 0), 0)

    return NextResponse.json({
      data: {
        totalBusinesses,
        activeSubscriptions,
        pendingRequests,
        businesses: tenants.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          email: tenant.email,
          createdAt: tenant.createdAt,
          subscription: tenant.subscriptions[0]
            ? {
                id: tenant.subscriptions[0].id,
                status: tenant.subscriptions[0].status,
                expiryDate: tenant.subscriptions[0].expiryDate,
                planName: tenant.subscriptions[0].plan?.name,
              }
            : null,
          pendingRequests: tenant._count?.subscriptionTransactions || 0,
        })),
      },
    })
  } catch (err) {
    console.error('[AGENT PERFORMANCE GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json().catch(() => null)
    const ids = Array.isArray(body?.transactionIds)
      ? body.transactionIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : []
    const providedBatchId = normalizeBatchId(typeof body?.batchId === 'string' ? body.batchId : null)
    const batchId = providedBatchId || makeBatchId('MANUAL')
    const { cycleStartAt, cycleEndAt } = parseCycleDates(
      typeof body?.cycleFrom === 'string' ? body.cycleFrom : null,
      typeof body?.cycleTo === 'string' ? body.cycleTo : null
    )

    if (!ids.length) return apiError('transactionIds is required', 422)

    const eligible = await prisma.subscriptionTransaction.findMany({
      where: {
        id: { in: ids },
        status: { in: ['ACTIVE', 'VERIFIED'] },
        tenant: {
          archived: false,
          acquisitionAgentId: { not: null },
        },
      },
      select: { id: true },
    })

    if (!eligible.length) return apiError('No eligible records found for remittance update', 404)

    const now = new Date()
    await prisma.$transaction(
      eligible.map((row) =>
        prisma.agentCommissionRemittance.upsert({
          where: { subscriptionTransactionId: row.id },
          create: {
            subscriptionTransactionId: row.id,
            status: 'PAID',
            paidAt: now,
            paidByUserId: user.userId,
            source: 'MANUAL',
            batchId,
            cycleStartAt,
            cycleEndAt,
          },
          update: {
            status: 'PAID',
            paidAt: now,
            paidByUserId: user.userId,
            source: 'MANUAL',
            batchId,
            cycleStartAt,
            cycleEndAt,
          },
        })
      )
    )

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'AGENT_COMMISSION_MARK_PAID',
      entity: 'AgentCommissionRemittance',
      newValues: {
        batchId,
        updatedCount: eligible.length,
        skipped: ids.length - eligible.length,
      },
      req,
    })

    return NextResponse.json({
      data: {
        batchId,
        updatedCount: eligible.length,
        skipped: ids.length - eligible.length,
      },
    })
  } catch (err) {
    console.error('[AGENT PERFORMANCE PATCH]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const formData = await req.formData()
    const fileEntry = formData.get('file')
    const providedBatchId = normalizeBatchId(typeof formData.get('batchId') === 'string' ? String(formData.get('batchId')) : null)
    const batchId = providedBatchId || makeBatchId('UPLOAD')
    const { cycleStartAt, cycleEndAt } = parseCycleDates(
      typeof formData.get('cycleFrom') === 'string' ? String(formData.get('cycleFrom')) : null,
      typeof formData.get('cycleTo') === 'string' ? String(formData.get('cycleTo')) : null
    )
    if (!(fileEntry instanceof File)) return apiError('CSV file is required', 422)
    if (fileEntry.size <= 0) return apiError('Uploaded file is empty', 422)

    const csvText = await fileEntry.text()
    const transactionIds = parseCsvTransactionIds(csvText)
    if (!transactionIds.length) return apiError('No transaction IDs found in uploaded report', 422)

    const eligible = await prisma.subscriptionTransaction.findMany({
      where: {
        id: { in: transactionIds },
        status: { in: ['ACTIVE', 'VERIFIED'] },
        tenant: {
          archived: false,
          acquisitionAgentId: { not: null },
        },
      },
      select: { id: true },
    })

    if (!eligible.length) return apiError('No eligible records found in uploaded report', 404)

    const now = new Date()
    await prisma.$transaction(
      eligible.map((row) =>
        prisma.agentCommissionRemittance.upsert({
          where: { subscriptionTransactionId: row.id },
          create: {
            subscriptionTransactionId: row.id,
            status: 'PAID',
            paidAt: now,
            paidByUserId: user.userId,
            reportFileName: fileEntry.name,
            source: 'UPLOAD',
            batchId,
            cycleStartAt,
            cycleEndAt,
          },
          update: {
            status: 'PAID',
            paidAt: now,
            paidByUserId: user.userId,
            reportFileName: fileEntry.name,
            source: 'UPLOAD',
            batchId,
            cycleStartAt,
            cycleEndAt,
          },
        })
      )
    )

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'AGENT_COMMISSION_UPLOAD_MARK_PAID',
      entity: 'AgentCommissionRemittance',
      newValues: {
        fileName: fileEntry.name,
        batchId,
        updatedCount: eligible.length,
        skipped: transactionIds.length - eligible.length,
      },
      req,
    })

    return NextResponse.json({
      data: {
        fileName: fileEntry.name,
        batchId,
        parsedCount: transactionIds.length,
        updatedCount: eligible.length,
        skipped: transactionIds.length - eligible.length,
      },
    })
  } catch (err) {
    console.error('[AGENT PERFORMANCE POST]', err)
    return apiError('Internal server error', 500)
  }
}
