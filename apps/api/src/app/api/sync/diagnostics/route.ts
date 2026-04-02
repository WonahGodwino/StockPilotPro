import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, hasPermission } from '@/lib/rbac'

type SyncPoint = {
  createdAt: Date
  subsidiaryId: string
}

function parseDateRange(searchParams: URLSearchParams) {
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const hours = Number(searchParams.get('hours') || 24)

  if (from && to) {
    return {
      from: new Date(from),
      to: new Date(to),
    }
  }

  const end = new Date()
  const start = new Date(end.getTime() - Math.max(1, hours) * 60 * 60 * 1000)
  return { from: start, to: end }
}

function toIsoDay(value: Date | string): string {
  const d = new Date(value)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)
}

function csvEscape(value: string | number | null): string {
  if (value === null) return ''
  const raw = String(value)
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

function toCsv(rows: Array<Record<string, string | number | null>>) {
  if (rows.length === 0) return 'section,key,value\n'
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? null)).join(','))
  }
  return lines.join('\n')
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:reports')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const format = (searchParams.get('format') || 'json').toLowerCase()

    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account. Provide tenantId.', 400)
    }

    const { from, to } = parseDateRange(searchParams)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return apiError('Invalid date range', 400)
    }

    const rangeFilter = { gte: from, lte: to }

    const [syncedSalesCount, syncedExpenseCount, totalSalesCount, totalExpenseCount, latestSale, latestExpense, subsidiaries, salesPoints, expensePoints] = await Promise.all([
      prisma.sale.count({ where: { tenantId, archived: false, syncRef: { not: null }, createdAt: rangeFilter } }),
      prisma.expense.count({ where: { tenantId, archived: false, syncRef: { not: null }, createdAt: rangeFilter } }),
      prisma.sale.count({ where: { tenantId, archived: false, createdAt: rangeFilter } }),
      prisma.expense.count({ where: { tenantId, archived: false, createdAt: rangeFilter } }),
      prisma.sale.findFirst({
        where: { tenantId, archived: false, syncRef: { not: null }, createdAt: rangeFilter },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.expense.findFirst({
        where: { tenantId, archived: false, syncRef: { not: null }, createdAt: rangeFilter },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.subsidiary.findMany({
        where: { tenantId, archived: false },
        select: { id: true, name: true },
      }),
      prisma.sale.findMany({
        where: { tenantId, archived: false, syncRef: { not: null }, createdAt: rangeFilter },
        select: { createdAt: true, subsidiaryId: true },
      }),
      prisma.expense.findMany({
        where: { tenantId, archived: false, syncRef: { not: null }, createdAt: rangeFilter },
        select: { createdAt: true, subsidiaryId: true },
      }),
    ])

    const syncedTotal = syncedSalesCount + syncedExpenseCount
    const totalRecords = totalSalesCount + totalExpenseCount
    const offlineSyncRate = totalRecords > 0 ? Number(((syncedTotal / totalRecords) * 100).toFixed(2)) : 0

    const latestSyncedAt = [latestSale?.createdAt, latestExpense?.createdAt]
      .filter(Boolean)
      .map((v) => new Date(v as Date).getTime())
      .sort((a, b) => b - a)[0]

    const salesBySubsidiary = new Map<string, number>()
    const expensesBySubsidiary = new Map<string, number>()

    for (const point of salesPoints) {
      salesBySubsidiary.set(point.subsidiaryId, (salesBySubsidiary.get(point.subsidiaryId) || 0) + 1)
    }
    for (const point of expensePoints) {
      expensesBySubsidiary.set(point.subsidiaryId, (expensesBySubsidiary.get(point.subsidiaryId) || 0) + 1)
    }

    const bySubsidiary = subsidiaries.map((s) => {
      const syncedSales = salesBySubsidiary.get(s.id) || 0
      const syncedExpenses = expensesBySubsidiary.get(s.id) || 0
      return {
        subsidiaryId: s.id,
        subsidiaryName: s.name,
        syncedSales,
        syncedExpenses,
        totalSynced: syncedSales + syncedExpenses,
      }
    }).sort((a, b) => b.totalSynced - a.totalSynced)

    const dayRollup = new Map<string, { syncedSales: number; syncedExpenses: number }>()
    for (const point of salesPoints) {
      const day = toIsoDay(point.createdAt)
      const existing = dayRollup.get(day) || { syncedSales: 0, syncedExpenses: 0 }
      existing.syncedSales += 1
      dayRollup.set(day, existing)
    }
    for (const point of expensePoints) {
      const day = toIsoDay(point.createdAt)
      const existing = dayRollup.get(day) || { syncedSales: 0, syncedExpenses: 0 }
      existing.syncedExpenses += 1
      dayRollup.set(day, existing)
    }

    const daily = Array.from(dayRollup.entries())
      .map(([day, v]) => ({ day, syncedSales: v.syncedSales, syncedExpenses: v.syncedExpenses, totalSynced: v.syncedSales + v.syncedExpenses }))
      .sort((a, b) => a.day.localeCompare(b.day))

    const payload = {
      data: {
        tenantId,
        from: from.toISOString(),
        to: to.toISOString(),
        summary: {
          syncedSales: syncedSalesCount,
          syncedExpenses: syncedExpenseCount,
          totalSynced: syncedTotal,
          totalSales: totalSalesCount,
          totalExpenses: totalExpenseCount,
          offlineSyncRate,
          latestSyncedAt: latestSyncedAt ? new Date(latestSyncedAt).toISOString() : null,
          pendingQueueRecords: null,
          pendingQueueNote: 'Pending queue exists on client devices and is not visible server-side.',
        },
        bySubsidiary,
        daily,
      },
    }

    if (format === 'csv') {
      const rows: Array<Record<string, string | number | null>> = []
      rows.push({ section: 'summary', key: 'tenantId', value: tenantId })
      rows.push({ section: 'summary', key: 'from', value: from.toISOString() })
      rows.push({ section: 'summary', key: 'to', value: to.toISOString() })
      rows.push({ section: 'summary', key: 'syncedSales', value: syncedSalesCount })
      rows.push({ section: 'summary', key: 'syncedExpenses', value: syncedExpenseCount })
      rows.push({ section: 'summary', key: 'totalSynced', value: syncedTotal })
      rows.push({ section: 'summary', key: 'totalSales', value: totalSalesCount })
      rows.push({ section: 'summary', key: 'totalExpenses', value: totalExpenseCount })
      rows.push({ section: 'summary', key: 'offlineSyncRate', value: offlineSyncRate })
      rows.push({ section: 'summary', key: 'latestSyncedAt', value: latestSyncedAt ? new Date(latestSyncedAt).toISOString() : null })
      rows.push({ section: 'summary', key: 'pendingQueueRecords', value: null })
      rows.push({ section: 'summary', key: 'pendingQueueNote', value: 'Pending queue exists on client devices and is not visible server-side.' })

      for (const item of bySubsidiary) {
        rows.push({ section: 'by_subsidiary', key: `${item.subsidiaryName} (${item.subsidiaryId}) syncedSales`, value: item.syncedSales })
        rows.push({ section: 'by_subsidiary', key: `${item.subsidiaryName} (${item.subsidiaryId}) syncedExpenses`, value: item.syncedExpenses })
        rows.push({ section: 'by_subsidiary', key: `${item.subsidiaryName} (${item.subsidiaryId}) totalSynced`, value: item.totalSynced })
      }

      for (const item of daily) {
        rows.push({ section: 'daily', key: `${item.day} syncedSales`, value: item.syncedSales })
        rows.push({ section: 'daily', key: `${item.day} syncedExpenses`, value: item.syncedExpenses })
        rows.push({ section: 'daily', key: `${item.day} totalSynced`, value: item.totalSynced })
      }

      const csv = toCsv(rows)
      const fileName = `sync-diagnostics-${tenantId}-${toIsoDay(from)}-to-${toIsoDay(to)}.csv`
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (err) {
    if ((err as Error).message === 'No token provided' || (err as Error).message === 'Unauthorized') {
      return apiError('Unauthorized', 401)
    }
    console.error('[SYNC DIAGNOSTICS GET]', err)
    return apiError('Internal server error', 500)
  }
}
