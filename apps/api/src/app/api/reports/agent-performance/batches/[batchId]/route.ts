import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

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

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '')
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, context: { params: { batchId: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const batchId = decodeURIComponent((context.params?.batchId || '').trim())
    if (!batchId) return apiError('batchId is required', 422)

    const format = (new URL(req.url).searchParams.get('format') || 'json').toLowerCase()

    const platformTenant = user.tenantId
      ? await prisma.tenant.findUnique({
          where: { id: user.tenantId },
          select: { id: true, baseCurrency: true },
        })
      : null
    const baseCurrency = platformTenant?.baseCurrency || 'USD'

    const rows = await prisma.agentCommissionRemittance.findMany({
      where: { batchId, status: 'PAID' },
      select: {
        batchId: true,
        cycleStartAt: true,
        cycleEndAt: true,
        paidAt: true,
        reportFileName: true,
        source: true,
        subscriptionTransaction: {
          select: {
            id: true,
            amount: true,
            currency: true,
            initiatedAt: true,
            changeType: true,
            tenant: {
              select: {
                id: true,
                name: true,
                acquisitionAgent: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    })

    if (!rows.length) return apiError('No paid remittance records found for this batch', 404)

    const rateCache = new Map<string, number>()
    const records = [] as Array<{
      transactionId: string
      initiatedAt: Date
      paidAt: Date | null
      agentId: string
      agentName: string
      agentEmail: string
      tenantId: string
      tenantName: string
      changeType: string
      amountBase: number
      amountOriginal: number
      currency: string
      source: string | null
      reportFileName: string | null
      cycleStartAt: Date | null
      cycleEndAt: Date | null
    }>

    for (const row of rows) {
      const tx = row.subscriptionTransaction
      const agent = tx.tenant.acquisitionAgent
      if (!agent) continue

      const currency = tx.currency || 'USD'
      let rate = rateCache.get(currency)
      if (rate === undefined) {
        rate = platformTenant?.id ? await getTransactionToBaseRate(platformTenant.id, baseCurrency, currency) : 1
        rateCache.set(currency, rate)
      }

      const amountOriginal = Number(tx.amount)
      const amountBase = currency === baseCurrency ? amountOriginal : amountOriginal / rate

      records.push({
        transactionId: tx.id,
        initiatedAt: tx.initiatedAt,
        paidAt: row.paidAt,
        agentId: agent.id,
        agentName: `${agent.firstName} ${agent.lastName}`.trim(),
        agentEmail: agent.email,
        tenantId: tx.tenant.id,
        tenantName: tx.tenant.name,
        changeType: tx.changeType,
        amountBase,
        amountOriginal,
        currency,
        source: row.source,
        reportFileName: row.reportFileName,
        cycleStartAt: row.cycleStartAt,
        cycleEndAt: row.cycleEndAt,
      })
    }

    const totalAmountBase = records.reduce((sum, record) => sum + record.amountBase, 0)
    const cycleStartAt = records.map((record) => record.cycleStartAt).find((value) => Boolean(value)) || null
    const cycleEndAt = records.map((record) => record.cycleEndAt).find((value) => Boolean(value)) || null

    if (format === 'csv') {
      const header = [
        'Batch ID',
        'Cycle From',
        'Cycle To',
        'Transaction ID',
        'Initiated At',
        'Paid At',
        'Agent Name',
        'Agent ID',
        'Agent Email',
        'Tenant Name',
        'Tenant ID',
        'Change Type',
        `Amount (${baseCurrency})`,
        'Original Amount',
        'Original Currency',
        'Source',
        'Report File',
      ]

      const lines = records.map((record) => [
        batchId,
        cycleStartAt ? cycleStartAt.toISOString() : '',
        cycleEndAt ? cycleEndAt.toISOString() : '',
        record.transactionId,
        record.initiatedAt.toISOString(),
        record.paidAt ? record.paidAt.toISOString() : '',
        record.agentName,
        record.agentId,
        record.agentEmail,
        record.tenantName,
        record.tenantId,
        record.changeType,
        record.amountBase,
        record.amountOriginal,
        record.currency,
        record.source || '',
        record.reportFileName || '',
      ])

      const csv = [header, ...lines].map((line) => line.map(escapeCsvCell).join(',')).join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="agent-remittance-${batchId}.csv"`,
        },
      })
    }

    return NextResponse.json({
      data: {
        batchId,
        baseCurrency,
        cycleStartAt,
        cycleEndAt,
        totals: {
          paidRecords: records.length,
          totalAmountBase,
        },
        records,
      },
    })
  } catch (err) {
    console.error('[AGENT PERFORMANCE BATCH GET]', err)
    return apiError('Internal server error', 500)
  }
}
