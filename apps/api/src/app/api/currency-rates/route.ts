import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, hasPermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { fetchLiveFxRate } from '@/lib/fx'

const createRateSchema = z.object({
  fromCurrency: z.string().length(3).transform((v) => v.toUpperCase()),
  toCurrency: z.string().length(3).transform((v) => v.toUpperCase()),
  rate: z.number().positive(),
  date: z.string().datetime().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

// GET /api/currency-rates — list FX rates for the tenant
export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:reports')) return apiError('Forbidden', 403)

    const url = new URL(req.url)
    const fromCurrency = url.searchParams.get('fromCurrency')?.toUpperCase()
    const toCurrency = url.searchParams.get('toCurrency')?.toUpperCase()
    const live = url.searchParams.get('live') === 'true'
    const saveSnapshot = url.searchParams.get('saveSnapshot') === 'true'

    const tenantId = isSuperAdmin(user)
      ? url.searchParams.get('tenantId') || undefined
      : user.tenantId!

    if (fromCurrency && toCurrency) {
      if (fromCurrency === toCurrency) {
        return NextResponse.json({
          data: {
            fromCurrency,
            toCurrency,
            rate: 1,
            source: 'same-currency',
            fetchedAt: new Date().toISOString(),
          },
        })
      }

      if (!live) {
        const directSnapshot = tenantId
          ? await prisma.currencyRate.findFirst({
              where: { tenantId, fromCurrency, toCurrency },
              orderBy: { date: 'desc' },
            })
          : null

        if (directSnapshot) {
          return NextResponse.json({
            data: {
              fromCurrency,
              toCurrency,
              rate: Number(directSnapshot.rate),
              source: 'snapshot',
              fetchedAt: directSnapshot.date.toISOString(),
              snapshotId: directSnapshot.id,
            },
          })
        }

        const inverseSnapshot = tenantId
          ? await prisma.currencyRate.findFirst({
              where: { tenantId, fromCurrency: toCurrency, toCurrency: fromCurrency },
              orderBy: { date: 'desc' },
            })
          : null

        if (inverseSnapshot) {
          return NextResponse.json({
            data: {
              fromCurrency,
              toCurrency,
              rate: 1 / Number(inverseSnapshot.rate),
              source: 'snapshot',
              fetchedAt: inverseSnapshot.date.toISOString(),
              snapshotId: inverseSnapshot.id,
            },
          })
        }

        return apiError(`No saved exchange rate found for ${fromCurrency}/${toCurrency}`, 404)
      }

      try {
        const rate = live
          ? await fetchLiveFxRate(fromCurrency, toCurrency)
          : null

        if (rate) {
          let snapshotId: string | null = null

          if (saveSnapshot && tenantId) {
            const snapshot = await prisma.currencyRate.create({
              data: {
                tenantId,
                fromCurrency,
                toCurrency,
                rate,
                date: new Date(),
                createdBy: user.userId,
              },
            })
            snapshotId = snapshot.id
          }

          return NextResponse.json({
            data: {
              fromCurrency,
              toCurrency,
              rate,
              source: 'live',
              fetchedAt: new Date().toISOString(),
              snapshotId,
            },
          })
        }
      } catch (liveError) {
        const snapshot = tenantId
          ? await prisma.currencyRate.findFirst({
              where: { tenantId, fromCurrency, toCurrency },
              orderBy: { date: 'desc' },
            })
          : null

        if (snapshot) {
          return NextResponse.json({
            data: {
              fromCurrency,
              toCurrency,
              rate: Number(snapshot.rate),
              source: 'snapshot',
              fetchedAt: snapshot.date.toISOString(),
              snapshotId: snapshot.id,
              warning: (liveError as Error).message,
            },
          })
        }

        return apiError((liveError as Error).message || 'Unable to fetch live FX rate', 502)
      }
    }

    const rates = await prisma.currencyRate.findMany({
      where: { tenantId },
      orderBy: { date: 'desc' },
      take: 100,
    })

    return NextResponse.json({ data: rates })
  } catch (err) {
    console.error('[CURRENCY_RATES GET]', err)
    return apiError('Internal server error', 500)
  }
}

// POST /api/currency-rates — record an FX rate snapshot
export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (user.role === 'SALESPERSON') return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createRateSchema.parse(body)

    if (data.fromCurrency === data.toCurrency) {
      return apiError('fromCurrency and toCurrency must differ', 400)
    }

    const tenantId = isSuperAdmin(user)
      ? (new URL(req.url).searchParams.get('tenantId') || user.tenantId!)
      : user.tenantId!

    const rate = await prisma.currencyRate.create({
      data: {
        tenantId,
        fromCurrency: data.fromCurrency,
        toCurrency: data.toCurrency,
        rate: data.rate,
        date: data.date ? new Date(data.date) : new Date(),
        createdBy: user.userId,
      },
    })

    await logAudit({
      tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'currencyRate',
      entityId: rate.id,
      newValues: {
        fromCurrency: rate.fromCurrency,
        toCurrency: rate.toCurrency,
        rate: rate.rate,
        date: rate.date,
      },
      req,
    })

    return NextResponse.json({ data: rate }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[CURRENCY_RATES POST]', err)
    return apiError('Internal server error', 500)
  }
}
