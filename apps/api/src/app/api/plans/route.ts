import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createPlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  maxSubsidiaries: z.number().int().min(1),
  extraSubsidiaryPrice: z.number().min(0).default(0),
  features: z.record(z.unknown()).default({}),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    authenticate(req) // any authenticated user can see plans

    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    })
    return NextResponse.json({ data: plans })
  } catch {
    // unauthenticated can also view plans
    const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { price: 'asc' } })
    return NextResponse.json({ data: plans })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createPlanSchema.parse(body)

    const createData: Prisma.PlanCreateInput = {
      name: data.name,
      description: data.description,
      price: data.price,
      maxSubsidiaries: data.maxSubsidiaries,
      extraSubsidiaryPrice: data.extraSubsidiaryPrice,
      features: data.features as Prisma.InputJsonValue,
      createdBy: user.userId,
    }

    const plan = await prisma.plan.create({
      data: createData,
    })

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'plan',
      entityId: plan.id,
      newValues: {
        name: plan.name,
        price: plan.price,
        maxSubsidiaries: plan.maxSubsidiaries,
        isActive: plan.isActive,
      },
      req,
    })

    return NextResponse.json({ data: plan }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[PLANS POST]', err)
    return apiError('Internal server error', 500)
  }
}
