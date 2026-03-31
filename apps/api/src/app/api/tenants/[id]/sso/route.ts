import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, isBusinessAdmin, assertTenantAccess } from '@/lib/rbac'
import { isValidProvider, getSsoProviders } from '@/lib/sso'
import { logAudit } from '@/lib/audit'

const ssoUpdateSchema = z.object({
  ssoEnabled: z.boolean(),
  ssoProviders: z
    .array(z.string())
    .refine((providers) => providers.every(isValidProvider), {
      message: 'Only "google" and "microsoft" providers are supported',
    })
    .optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

/**
 * GET /api/tenants/[id]/sso
 *
 * Returns the current SSO settings for a tenant.
 * Accessible by SUPER_ADMIN and BUSINESS_ADMIN of the same tenant.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = authenticate(req)

    if (!isSuperAdmin(user) && !isBusinessAdmin(user)) {
      return apiError('Forbidden', 403)
    }

    assertTenantAccess(user, params.id)

    const tenant = await prisma.tenant.findUnique({
      where: { id: params.id },
      select: { id: true, ssoEnabled: true, ssoProviders: true },
    })

    if (!tenant) return apiError('Tenant not found', 404)

    return NextResponse.json({ data: tenant })
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[TENANT SSO GET]', err)
    return apiError('Internal server error', 500)
  }
}

/**
 * PATCH /api/tenants/[id]/sso
 *
 * Enable or disable SSO for a tenant, and configure which providers are allowed.
 * Only SUPER_ADMIN or the BUSINESS_ADMIN of that tenant may update these settings.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = authenticate(req)

    if (!isSuperAdmin(user) && !isBusinessAdmin(user)) {
      return apiError('Forbidden', 403)
    }

    assertTenantAccess(user, params.id)

    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } })
    if (!tenant) return apiError('Tenant not found', 404)

    const body = await req.json()
    const { ssoEnabled, ssoProviders } = ssoUpdateSchema.parse(body)

    const updatedProviders =
      ssoProviders !== undefined
        ? ssoProviders
        : getSsoProviders(tenant.ssoProviders)

    // If disabling SSO, clear the providers list
    const finalProviders = ssoEnabled ? updatedProviders : []

    const updated = await prisma.tenant.update({
      where: { id: params.id },
      data: {
        ssoEnabled,
        ssoProviders: finalProviders,
        updatedBy: user.userId,
      },
      select: { id: true, ssoEnabled: true, ssoProviders: true },
    })

    await logAudit({
      tenantId: params.id,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'tenant_sso',
      entityId: params.id,
      oldValues: { ssoEnabled: tenant.ssoEnabled, ssoProviders: tenant.ssoProviders },
      newValues: { ssoEnabled, ssoProviders: finalProviders },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[TENANT SSO PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
