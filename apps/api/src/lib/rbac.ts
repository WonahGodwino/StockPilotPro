import { UserRole } from '@prisma/client'
import { JWTPayload } from './jwt'

export type Permission =
  | 'manage:tenants'
  | 'manage:plans'
  | 'manage:subscriptions'
  | 'manage:users'
  | 'manage:subsidiaries'
  | 'manage:products'
  | 'create:sales'
  | 'view:sales'
  | 'manage:expenses'
  | 'view:reports'
  | 'view:analytics'
  | 'view:profit_loss'

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    'manage:tenants',
    'manage:plans',
    'manage:subscriptions',
    'manage:users',
    'manage:subsidiaries',
    'manage:products',
    'create:sales',
    'view:sales',
    'manage:expenses',
    'view:reports',
    'view:analytics',
    'view:profit_loss',
  ],
  AGENT: [],
  BUSINESS_ADMIN: [
    'manage:users',
    'manage:subsidiaries',
    'manage:products',
    'create:sales',
    'view:sales',
    'manage:expenses',
    'view:reports',
    'view:analytics',
    'view:profit_loss',
  ],
  SALESPERSON: [
    'manage:products',
    'create:sales',
    'view:sales',
    'manage:expenses',
  ],
}

export function hasPermission(user: JWTPayload, permission: Permission): boolean {
  const role = user.role as UserRole
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function requirePermission(user: JWTPayload, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw new Error(`Forbidden: requires '${permission}'`)
  }
}

export function isSuperAdmin(user: JWTPayload): boolean {
  return user.role === UserRole.SUPER_ADMIN
}

export function isBusinessAdmin(user: JWTPayload): boolean {
  return user.role === UserRole.BUSINESS_ADMIN
}

export function isSalesperson(user: JWTPayload): boolean {
  return user.role === UserRole.SALESPERSON
}

export function isAgent(user: JWTPayload): boolean {
  return user.role === 'AGENT'
}

// Ensure a user can only access data belonging to their tenant
export function assertTenantAccess(user: JWTPayload, tenantId: string): void {
  if (isSuperAdmin(user)) return
  if (user.tenantId !== tenantId) {
    throw new Error('Forbidden: tenant mismatch')
  }
}

// Ensure a salesperson can only access their own subsidiary
export function assertSubsidiaryAccess(user: JWTPayload, subsidiaryId: string): void {
  if (isSuperAdmin(user) || isBusinessAdmin(user)) return
  if (user.subsidiaryId !== subsidiaryId) {
    throw new Error('Forbidden: subsidiary mismatch')
  }
}
