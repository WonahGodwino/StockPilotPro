import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, handleOptions } from '@/lib/auth'

type TrustedCustomerDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<unknown[]>
  create: (args: Record<string, unknown>) => Promise<unknown>
}

const trustedCustomer = (prisma as unknown as { trustedCustomer: TrustedCustomerDelegate }).trustedCustomer

const defaultTrustedCustomers = [
  { name: 'Northfield Retail Group', displayOrder: 0 },
  { name: 'Bluecrest Distribution', displayOrder: 1 },
  { name: 'Summit Pharmacy Network', displayOrder: 2 },
  { name: 'Kivu Wholesale Hub', displayOrder: 3 },
  { name: 'Everlane Trade Partners', displayOrder: 4 },
]

export async function OPTIONS() {
  return handleOptions()
}

export async function GET() {
  try {
    const existing = await trustedCustomer.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 1,
    })

    if (!existing || existing.length === 0) {
      for (const item of defaultTrustedCustomers) {
        await trustedCustomer.create({
          data: {
            name: item.name,
            displayOrder: item.displayOrder,
            isActive: true,
            createdBy: 'system:bootstrap',
          },
        })
      }
    }

    const customers = await trustedCustomer.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        logoUrl: true,
        websiteUrl: true,
      },
    })

    return NextResponse.json({ data: customers })
  } catch (err) {
    console.error('[PUBLIC TRUSTED CUSTOMERS GET]', err)
    return apiError('Internal server error', 500)
  }
}
