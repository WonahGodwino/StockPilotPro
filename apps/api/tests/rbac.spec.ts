import { strict as assert } from 'assert'
import { UserRole } from '@prisma/client'
import {
  assertSubsidiaryAccess,
  assertTenantAccess,
  hasPermission,
  requirePermission,
} from '../src/lib/rbac'
import type { JWTPayload } from '../src/lib/jwt'

function payload(role: UserRole, tenantId: string | null, subsidiaryId: string | null): JWTPayload {
  return {
    userId: 'u1',
    email: 'test@example.com',
    role,
    tenantId,
    subsidiaryId,
  }
}

function mustThrow(fn: () => void, contains: string) {
  let threw = false
  try {
    fn()
  } catch (err) {
    threw = true
    assert.ok((err as Error).message.includes(contains))
  }
  assert.ok(threw, `Expected function to throw: ${contains}`)
}

const superAdmin = payload(UserRole.SUPER_ADMIN, null, null)
const admin = payload(UserRole.BUSINESS_ADMIN, 't1', null)
const salesperson = payload(UserRole.SALESPERSON, 't1', 's1')

// Permission matrix checks
assert.equal(hasPermission(superAdmin, 'manage:tenants'), true)
assert.equal(hasPermission(admin, 'manage:tenants'), false)
assert.equal(hasPermission(salesperson, 'view:reports'), false)
assert.equal(hasPermission(admin, 'manage:users'), true)
assert.equal(hasPermission(salesperson, 'create:sales'), true)

// requirePermission behavior
requirePermission(admin, 'manage:users')
mustThrow(() => requirePermission(salesperson, 'manage:users'), 'Forbidden')

// Tenant scope checks
assertTenantAccess(superAdmin, 'any-tenant')
assertTenantAccess(admin, 't1')
mustThrow(() => assertTenantAccess(admin, 't2'), 'tenant mismatch')

// Subsidiary scope checks
assertSubsidiaryAccess(superAdmin, 'any-sub')
assertSubsidiaryAccess(admin, 'any-sub')
assertSubsidiaryAccess(salesperson, 's1')
mustThrow(() => assertSubsidiaryAccess(salesperson, 's2'), 'subsidiary mismatch')

// Sales view permission checks
assert.equal(hasPermission(superAdmin, 'view:sales'), true)
assert.equal(hasPermission(admin, 'view:sales'), true)
assert.equal(hasPermission(salesperson, 'view:sales'), true)

// Salesperson cannot access admin-only permissions
mustThrow(() => requirePermission(salesperson, 'view:reports'), 'Forbidden')
mustThrow(() => requirePermission(salesperson, 'manage:users'), 'Forbidden')

console.log('RBAC checks passed')
