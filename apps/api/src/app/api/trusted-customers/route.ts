import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

type TrustedCustomerDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<unknown[]>
  create: (args: Record<string, unknown>) => Promise<unknown>
}

const trustedCustomer = (prisma as unknown as { trustedCustomer: TrustedCustomerDelegate }).trustedCustomer

const createTrustedCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: z.string().trim().max(1000).optional().or(z.literal('')),
  websiteUrl: z.string().trim().max(1000).optional().or(z.literal('')),
  displayOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

const defaultTrustedCustomers = [
  { name: 'Northfield Retail Group', displayOrder: 0 },
  { name: 'Bluecrest Distribution', displayOrder: 1 },
  { name: 'Summit Pharmacy Network', displayOrder: 2 },
  { name: 'Kivu Wholesale Hub', displayOrder: 3 },
  { name: 'Everlane Trade Partners', displayOrder: 4 },
]

function normalizeOptional(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const existingCount = await trustedCustomer.findMany({})
    if ((existingCount?.length || 0) === 0) {
      for (const item of defaultTrustedCustomers) {
        await trustedCustomer.create({
          data: {
            name: item.name,
            displayOrder: item.displayOrder,
            isActive: true,
            createdBy: user.userId,
          },
        })
      }
    }

    const customers = await trustedCustomer.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ data: customers })
  } catch (err) {
    console.error('[TRUSTED CUSTOMERS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const payload = createTrustedCustomerSchema.parse(body)

    const customer = await trustedCustomer.create({
      data: {
        name: payload.name,
        logoUrl: normalizeOptional(payload.logoUrl),
        websiteUrl: normalizeOptional(payload.websiteUrl),
        displayOrder: payload.displayOrder,
        isActive: payload.isActive,
        createdBy: user.userId,
      },
    })

    return NextResponse.json({ data: customer }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[TRUSTED CUSTOMERS POST]', err)
    return apiError('Internal server error', 500)
  }
}
