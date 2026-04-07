import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'
import { getActiveSubscriptionForTenant, getRoleSeatLimit } from '@/lib/subscription-enforcement'

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(['BUSINESS_ADMIN', 'SALESPERSON', 'AGENT']).optional(),
  subsidiaryId: z.string().nullable().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'manage:users')

    const existing = await prisma.user.findUnique({ where: { id: params.id } })
    if (!existing || existing.archived) return apiError('User not found', 404)
    if (!isSuperAdmin(user) && existing.tenantId !== user.tenantId) return apiError('Forbidden', 403)
    if (isSuperAdmin(user) && String(existing.role) !== 'AGENT') {
      return apiError('SUPER_ADMIN can only manage AGENT users', 403)
    }

    const body = await req.json()
    const data = updateUserSchema.parse(body)

    if (isSuperAdmin(user) && data.role && data.role !== 'AGENT') {
      return apiError('SUPER_ADMIN can only manage AGENT users', 403)
    }

    if (!isSuperAdmin(user) && data.role === 'AGENT') {
      return apiError('Only SUPER_ADMIN can assign AGENT role', 403)
    }

    const nextRole = (data.role ?? existing.role) as 'BUSINESS_ADMIN' | 'SALESPERSON' | 'AGENT'
    if (!isSuperAdmin(user) && existing.tenantId && (nextRole === 'BUSINESS_ADMIN' || nextRole === 'SALESPERSON')) {
      const subscription = await getActiveSubscriptionForTenant(existing.tenantId)
      if (!subscription) return apiError('No active subscription', 403)

      const limit = getRoleSeatLimit(subscription.plan, nextRole)
      if (limit !== null) {
        const currentCount = await prisma.user.count({
          where: {
            tenantId: existing.tenantId,
            role: nextRole,
            archived: false,
            NOT: { id: existing.id },
          },
        })

        if (currentCount >= limit) {
          return apiError(`Your current package allows only ${limit} ${nextRole} account(s). Upgrade required.`, 403)
        }
      }
    }

    if (data.email && data.email !== existing.email) {
      const duplicate = await prisma.user.findUnique({ where: { email: data.email } })
      if (duplicate) return apiError('Email already in use', 409)
    }

    const hashed = data.password ? await bcrypt.hash(data.password, 12) : undefined

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        email: data.email,
        password: hashed,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role as never,
        tenantId: data.role === 'AGENT' ? null : undefined,
        subsidiaryId: data.role === 'AGENT' ? null : (data.subsidiaryId === null ? null : data.subsidiaryId),
        phone: data.phone,
        isActive: data.isActive,
        updatedBy: user.userId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        subsidiaryId: true,
        tenantId: true,
      },
    })

    await logAudit({
      tenantId: existing.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'user',
      entityId: updated.id,
      oldValues: {
        email: existing.email,
        firstName: existing.firstName,
        lastName: existing.lastName,
        role: existing.role,
        subsidiaryId: existing.subsidiaryId,
        isActive: existing.isActive,
      },
      newValues: {
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
        subsidiaryId: updated.subsidiaryId,
        isActive: updated.isActive,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[USERS PUT]', err)
    return apiError('Internal server error', 500)
  }
}
