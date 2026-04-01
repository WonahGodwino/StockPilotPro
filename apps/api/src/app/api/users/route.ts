import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['BUSINESS_ADMIN', 'SALESPERSON']),
  subsidiaryId: z.string().optional(),
  phone: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'manage:users')
    if (!user.tenantId && !isSuperAdmin(user)) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const subsidiaryId = searchParams.get('subsidiaryId')
    const role = searchParams.get('role')

    const where: Record<string, unknown> = {
      archived: false,
      ...(isSuperAdmin(user) ? {} : { tenantId: user.tenantId }),
      ...(subsidiaryId ? { subsidiaryId } : {}),
      ...(role ? { role } : {}),
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, phone: true, isActive: true, lastLoginAt: true, lastSeenAt: true,
        createdAt: true, subsidiaryId: true, tenantId: true,
        subsidiary: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: users })
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[USERS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'manage:users')
    if (!user.tenantId && !isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json()
    const data = createUserSchema.parse(body)

    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing) return apiError('Email already in use', 409)

    const hashed = await bcrypt.hash(data.password, 12)

    const newUser = await prisma.user.create({
      data: {
        ...data,
        password: hashed,
        tenantId: user.tenantId,
        createdBy: user.userId,
      },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, phone: true, isActive: true, createdAt: true,
        subsidiaryId: true, tenantId: true,
      },
    })

    await logAudit({
      tenantId: newUser.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'user',
      entityId: newUser.id,
      newValues: {
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        subsidiaryId: newUser.subsidiaryId,
      },
      req,
    })

    return NextResponse.json({ data: newUser }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[USERS POST]', err)
    return apiError('Internal server error', 500)
  }
}
