import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { isAgent } from '@/lib/agent-access'
import { isEnterprisePlan } from '@/lib/subscription-enforcement'

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
  logo: z.string().optional(),
  acquisitionAgentId: z.string().optional(),
  registrationPlanId: z.string().optional(),
  initialBranches: z.array(z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  })).optional(),
  admin: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    phone: z.string().optional(),
  }).optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (isAgent(user)) {
      const assignedTenants = await prisma.tenant.findMany({
        where: {
          archived: false,
          acquisitionAgentId: user.userId,
        },
        include: {
          acquisitionAgent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: { select: { users: true, subsidiaries: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({ data: assignedTenants, total: assignedTenants.length, page: 1, limit: assignedTenants.length || 20 })
    }

    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const isActive = searchParams.get('isActive')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where = {
      archived: false,
      ...(isActive !== null ? { isActive: isActive === 'true' } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    }

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        include: {
          acquisitionAgent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: { plan: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: { select: { users: true, subsidiaries: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tenant.count({ where }),
    ])

    return NextResponse.json({ data: tenants, total, page, limit })
  } catch (err) {
    console.error('[TENANTS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const superAdmin = isSuperAdmin(user)
    const agentUser = isAgent(user)
    if (!superAdmin && !agentUser) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createSchema.parse(body)

    const existing = await prisma.tenant.findFirst({
      where: { OR: [{ slug: data.slug }, { email: data.email }] },
      select: { id: true },
    })
    if (existing) return apiError('Tenant with this slug or email already exists', 409)

    if (data.admin) {
      const existingAdminUser = await prisma.user.findUnique({
        where: { email: data.admin.email },
        select: { id: true },
      })
      if (existingAdminUser) {
        return apiError('Admin email already exists', 409)
      }
    }

    if (superAdmin && data.acquisitionAgentId) {
      const agent = await prisma.user.findUnique({
        where: { id: data.acquisitionAgentId },
        select: { id: true, role: true, archived: true, isActive: true },
      })
      if (!agent || agent.archived || !agent.isActive || String(agent.role) !== 'AGENT') {
        return apiError('Selected acquisition agent is invalid', 422)
      }
    }

    if (agentUser && data.acquisitionAgentId && data.acquisitionAgentId !== user.userId) {
      return apiError('Agents can only register tenants under their own account', 403)
    }

    const acquisitionAgentId = superAdmin
      ? data.acquisitionAgentId
      : user.userId

    const initialBranches = data.initialBranches || []
    if (initialBranches.length > 0 && !data.registrationPlanId) {
      return apiError('registrationPlanId is required when onboarding branches', 422)
    }

    let registrationPlan: { id: string; maxSubsidiaries: number; name: string; features: unknown } | null = null
    if (data.registrationPlanId) {
      registrationPlan = await prisma.plan.findFirst({
        where: { id: data.registrationPlanId, isActive: true },
        select: { id: true, maxSubsidiaries: true, name: true, features: true },
      })

      if (!registrationPlan) {
        return apiError('Selected registration plan is invalid or inactive', 422)
      }

      if (!isEnterprisePlan(registrationPlan) && initialBranches.length > registrationPlan.maxSubsidiaries) {
        return apiError(`Branch limit exceeded for selected plan (${registrationPlan.maxSubsidiaries})`, 422)
      }
    }

    const tenant = await prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          email: data.email,
          phone: data.phone,
          address: data.address,
          country: data.country,
          state: data.state,
          lga: data.lga,
          logo: data.logo,
          acquisitionAgentId,
          createdBy: user.userId,
        },
      })

      if (data.admin) {
        const hashedPassword = await bcrypt.hash(data.admin.password, 12)
        await tx.user.create({
          data: {
            tenantId: createdTenant.id,
            subsidiaryId: null,
            email: data.admin.email,
            password: hashedPassword,
            firstName: data.admin.firstName,
            lastName: data.admin.lastName,
            role: 'BUSINESS_ADMIN',
            phone: data.admin.phone,
            isActive: true,
            createdBy: user.userId,
          },
        })
      }

      if (initialBranches.length > 0) {
        await tx.subsidiary.createMany({
          data: initialBranches.map((branch) => ({
            tenantId: createdTenant.id,
            name: branch.name,
            address: branch.address,
            phone: branch.phone,
            email: branch.email,
            createdBy: user.userId,
          })),
        })
      }

      return createdTenant
    })

    await logAudit({
      tenantId: tenant.id,
      userId: user.userId,
      action: 'CREATE',
      entity: 'tenant',
      entityId: tenant.id,
      newValues: {
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        isActive: tenant.isActive,
        acquisitionAgentId: acquisitionAgentId || null,
      },
      req,
    })

    return NextResponse.json({ data: tenant }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[TENANTS POST]', err)
    return apiError('Internal server error', 500)
  }
}
