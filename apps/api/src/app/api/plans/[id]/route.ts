import { NextRequest, NextResponse } from 'next/server'
import { Prisma, BillingCycle } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const benefitsSchema = z.array(z.string().min(1))

const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  priceCurrency: z.string().length(3).transform((v) => v.toUpperCase()).optional(),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  maxSubsidiaries: z.number().int().min(1).optional(),
  extraSubsidiaryPrice: z.number().min(0).optional(),
  features: benefitsSchema.optional(),
  benefits: benefitsSchema.optional(),
  isActive: z.boolean().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const plan = await prisma.plan.findUnique({ where: { id: params.id } })
    if (!plan) return apiError('Plan not found', 404)

    return NextResponse.json({ data: plan })
  } catch (err) {
    console.error('[PLANS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = updatePlanSchema.parse(body)
    const benefits = data.benefits ?? data.features

    const before = await prisma.plan.findUnique({ where: { id: params.id } })
    if (!before) return apiError('Plan not found', 404)

    const updateData: Prisma.PlanUpdateInput = {
      name: data.name,
      description: data.description,
      price: data.price,
      priceCurrency: data.priceCurrency,
      billingCycle: data.billingCycle,
      maxSubsidiaries: data.maxSubsidiaries,
      extraSubsidiaryPrice: data.extraSubsidiaryPrice,
      isActive: data.isActive,
      updatedBy: user.userId,
    }
    if (benefits !== undefined) {
      updateData.features = benefits as Prisma.InputJsonValue
    }

    const plan = await prisma.plan.update({
      where: { id: params.id },
      data: updateData,
    })

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'plan',
      entityId: plan.id,
      oldValues: {
        name: before.name,
        price: before.price,
        priceCurrency: before.priceCurrency,
        billingCycle: before.billingCycle,
        maxSubsidiaries: before.maxSubsidiaries,
        isActive: before.isActive,
      },
      newValues: {
        name: plan.name,
        price: plan.price,
        priceCurrency: plan.priceCurrency,
        billingCycle: plan.billingCycle,
        maxSubsidiaries: plan.maxSubsidiaries,
        isActive: plan.isActive,
      },
      req,
    })

    return NextResponse.json({ data: plan })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[PLANS PUT]', err)
    return apiError('Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const plan = await prisma.plan.findUnique({ where: { id: params.id } })
    if (!plan) return apiError('Plan not found', 404)

    // Soft-delete: mark as inactive rather than hard delete to preserve subscription history
    const updated = await prisma.plan.update({
      where: { id: params.id },
      data: { isActive: false, updatedBy: user.userId },
    })

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'DELETE',
      entity: 'plan',
      entityId: plan.id,
      oldValues: {
        name: plan.name,
        price: plan.price,
        priceCurrency: plan.priceCurrency,
        billingCycle: plan.billingCycle,
        maxSubsidiaries: plan.maxSubsidiaries,
        isActive: plan.isActive,
      },
      newValues: { isActive: false },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PLANS DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
