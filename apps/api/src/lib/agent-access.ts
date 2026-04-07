import { prisma } from '@/lib/prisma'
import { JWTPayload } from '@/lib/jwt'

export function isAgent(user: JWTPayload): boolean {
  return user.role === 'AGENT'
}

export async function isTenantAssignedToAgent(agentUserId: string, tenantId: string): Promise<boolean> {
  const count = await prisma.tenant.count({
    where: {
      id: tenantId,
      archived: false,
      acquisitionAgentId: agentUserId,
    },
  })

  return count > 0
}

export async function getAgentTenantIds(agentUserId: string): Promise<string[]> {
  const tenants = await prisma.tenant.findMany({
    where: {
      archived: false,
      acquisitionAgentId: agentUserId,
    },
    select: { id: true },
  })

  return tenants.map((tenant) => tenant.id)
}
