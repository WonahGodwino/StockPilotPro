import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

type TrustedCustomerDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<unknown>
  update: (args: Record<string, unknown>) => Promise<unknown>
  delete: (args: Record<string, unknown>) => Promise<unknown>
}

const trustedCustomer = (prisma as unknown as { trustedCustomer: TrustedCustomerDelegate }).trustedCustomer

const updateTrustedCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.string().trim().max(1000).optional().or(z.literal('')),
  websiteUrl: z.string().trim().max(1000).optional().or(z.literal('')),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
})

function normalizeOptional(value?: string): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function OPTIONS() {
  return handleOptions()
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const existing = await trustedCustomer.findUnique({ where: { id: params.id } })
    if (!existing) return apiError('Trusted customer not found', 404)

    const body = await req.json()
    const payload = updateTrustedCustomerSchema.parse(body)

    const customer = await trustedCustomer.update({
      where: { id: params.id },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.logoUrl !== undefined ? { logoUrl: normalizeOptional(payload.logoUrl) } : {}),
        ...(payload.websiteUrl !== undefined ? { websiteUrl: normalizeOptional(payload.websiteUrl) } : {}),
        ...(payload.displayOrder !== undefined ? { displayOrder: payload.displayOrder } : {}),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        updatedBy: user.userId,
      },
    })

    return NextResponse.json({ data: customer })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[TRUSTED CUSTOMERS PUT]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const existing = await trustedCustomer.findUnique({ where: { id: params.id } })
    if (!existing) return apiError('Trusted customer not found', 404)

    await trustedCustomer.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[TRUSTED CUSTOMERS DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
