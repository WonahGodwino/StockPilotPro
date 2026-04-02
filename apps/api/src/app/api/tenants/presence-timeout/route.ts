import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { hasPermission, isSuperAdmin } from '@/lib/rbac'

const updateSchema = z.object({
  minutes: z.number().int().min(1).max(30),
})

function resolveTenantId(user: ReturnType<typeof authenticate>, searchParams: URLSearchParams) {
  const requestedTenantId = searchParams.get('tenantId') || undefined
  return isSuperAdmin(user)
    ? requestedTenantId || user.tenantId || undefined
    : user.tenantId || undefined
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'manage:users')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const tenantId = resolveTenantId(user, searchParams)
    if (!tenantId) return apiError('No tenant context for this account. Provide tenantId.', 400)

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, presenceTimeoutMinutes: true },
    })
    if (!tenant) return apiError('Tenant not found', 404)

    return NextResponse.json({ data: tenant })
  } catch (err) {
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[TENANT PRESENCE TIMEOUT GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'manage:users')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const tenantId = resolveTenantId(user, searchParams)
    if (!tenantId) return apiError('No tenant context for this account. Provide tenantId.', 400)

    const body = await req.json()
    const data = updateSchema.parse(body)

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { presenceTimeoutMinutes: data.minutes, updatedBy: user.userId },
      select: { id: true, presenceTimeoutMinutes: true },
    })

    return NextResponse.json({ data: tenant })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[TENANT PRESENCE TIMEOUT PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
