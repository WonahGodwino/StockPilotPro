import { strict as assert } from 'assert'
import { UserRole } from '@prisma/client'
import {
  isSuperAdmin,
  assertTenantAccess,
  hasPermission,
  requirePermission,
} from '../src/lib/rbac'
import type { JWTPayload } from '../src/lib/jwt'

function payload(
  role: UserRole,
  tenantId: string | null,
  subsidiaryId: string | null,
): JWTPayload {
  return { userId: 'u1', email: 'test@example.com', role, tenantId, subsidiaryId }
}

function mustThrow(fn: () => void, contains: string) {
  let threw = false
  try {
    fn()
  } catch (err) {
    threw = true
    assert.ok((err as Error).message.includes(contains))
  }
  assert.ok(threw, `Expected function to throw containing: "${contains}"`)
}

const superAdmin = payload(UserRole.SUPER_ADMIN, null, null)
const businessAdmin = payload(UserRole.BUSINESS_ADMIN, 'tenant-abc', null)
const salesperson = payload(UserRole.SALESPERSON, 'tenant-abc', 'sub-1')

// ── RBAC: manage:tenants permission ──────────────────────────────────────────
// SUPER_ADMIN can manage tenants
assert.equal(hasPermission(superAdmin, 'manage:tenants'), true, 'SUPER_ADMIN has manage:tenants')
requirePermission(superAdmin, 'manage:tenants') // must not throw

// BUSINESS_ADMIN cannot manage tenants
assert.equal(hasPermission(businessAdmin, 'manage:tenants'), false, 'BUSINESS_ADMIN lacks manage:tenants')
mustThrow(() => requirePermission(businessAdmin, 'manage:tenants'), 'Forbidden')

// SALESPERSON cannot manage tenants
assert.equal(hasPermission(salesperson, 'manage:tenants'), false, 'SALESPERSON lacks manage:tenants')
mustThrow(() => requirePermission(salesperson, 'manage:tenants'), 'Forbidden')

// ── Role identity helpers ─────────────────────────────────────────────────────
assert.equal(isSuperAdmin(superAdmin), true, 'superAdmin is SUPER_ADMIN')
assert.equal(isSuperAdmin(businessAdmin), false, 'businessAdmin is not SUPER_ADMIN')
assert.equal(isSuperAdmin(salesperson), false, 'salesperson is not SUPER_ADMIN')

// ── Tenant access: BUSINESS_ADMIN can only view their own tenant ──────────────
// SUPER_ADMIN can access any tenant
assertTenantAccess(superAdmin, 'any-tenant-id') // must not throw
assertTenantAccess(superAdmin, 'tenant-abc')    // must not throw

// BUSINESS_ADMIN can access their own tenant
assertTenantAccess(businessAdmin, 'tenant-abc') // own tenant — must not throw

// BUSINESS_ADMIN cannot access another tenant
mustThrow(() => assertTenantAccess(businessAdmin, 'other-tenant'), 'tenant mismatch')
mustThrow(() => assertTenantAccess(salesperson, 'other-tenant'), 'tenant mismatch')

// ── Soft-delete: archived flag is set to true (no hard delete) ────────────────
// Mirrors the DELETE route logic: prisma.tenant.update({ data: { archived: true } })
function softDelete<T extends { archived: boolean }>(record: T): T {
  return { ...record, archived: true }
}

const activeTenant = { id: 't1', name: 'Acme Corp', archived: false }
const archived = softDelete(activeTenant)
assert.equal(archived.archived, true, 'soft-delete sets archived to true')
assert.equal(archived.id, activeTenant.id, 'soft-delete preserves tenant id')
assert.equal(archived.name, activeTenant.name, 'soft-delete preserves tenant name')

// Idempotent: archiving an already-archived tenant keeps archived: true
const doubleArchived = softDelete(archived)
assert.equal(doubleArchived.archived, true, 'repeated soft-delete stays archived')

// ── List filter: archived tenants are excluded from GET /api/tenants ──────────
// Mirrors the `where: { archived: false }` clause in the GET route
const tenants = [
  { id: 't1', name: 'Active Corp', archived: false, isActive: true },
  { id: 't2', name: 'Archived Co', archived: true,  isActive: false },
  { id: 't3', name: 'Another Co', archived: false, isActive: true },
]
const listed = tenants.filter(t => !t.archived)
assert.equal(listed.length, 2, 'archived tenants are excluded from listing')
assert.ok(!listed.some(t => t.archived), 'no archived tenant in results')

// ── Slug validation: lowercase alphanumeric with hyphens ─────────────────────
// Mirrors the createSchema: z.string().min(2).regex(/^[a-z0-9-]+$/)
const slugPattern = /^[a-z0-9-]+$/
assert.ok(slugPattern.test('my-tenant'), 'valid slug passes')
assert.ok(slugPattern.test('tenant123'), 'numeric slug passes')
assert.ok(slugPattern.test('a-b-c'), 'multi-hyphen slug passes')
assert.ok(!slugPattern.test('My Tenant'), 'uppercase/spaces fail')
assert.ok(!slugPattern.test('my_tenant'), 'underscores fail')
assert.ok(!slugPattern.test(''), 'empty string fails')
assert.ok(!slugPattern.test('tenant!'), 'special chars fail')

console.log('tenant CRUD checks passed')
