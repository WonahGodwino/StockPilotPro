import { strict as assert } from 'assert'
import {
  isRecommendationTypeAllowedForRole,
  resolveMetricsTenantScope,
  resolveSignalTenantScope,
} from '../src/lib/enterprise-ai-route-policy'

function mustThrow(fn: () => void, contains: string) {
  let threw = false
  try {
    fn()
  } catch (err) {
    threw = true
    assert.ok((err as Error).message.includes(contains))
  }
  assert.ok(threw, `Expected throw containing: ${contains}`)
}

// Endpoint policy: recommendation visibility/generation by role
assert.equal(isRecommendationTypeAllowedForRole('SUPER_ADMIN', 'ANOMALY_DETECTION'), true)
assert.equal(isRecommendationTypeAllowedForRole('BUSINESS_ADMIN', 'ANOMALY_DETECTION'), false)
assert.equal(isRecommendationTypeAllowedForRole('BUSINESS_ADMIN', 'DEMAND_FORECAST'), true)
assert.equal(isRecommendationTypeAllowedForRole('SALESPERSON', 'DEMAND_FORECAST'), false)

// Endpoint policy: metrics tenant scoping
assert.equal(resolveMetricsTenantScope('SUPER_ADMIN', 'tenant-b', 'tenant-a'), 'tenant-b')
assert.equal(resolveMetricsTenantScope('SUPER_ADMIN', undefined, 'tenant-a'), 'tenant-a')
assert.equal(resolveMetricsTenantScope('BUSINESS_ADMIN', 'tenant-b', 'tenant-a'), 'tenant-a')

// Endpoint policy: signal ingestion tenant isolation
assert.equal(
  resolveSignalTenantScope({
    role: 'SUPER_ADMIN',
    signalClass: 'PUBLIC',
    accessTenantId: 'tenant-a',
  }),
  null,
)

mustThrow(
  () => resolveSignalTenantScope({
    role: 'BUSINESS_ADMIN',
    signalClass: 'PLATFORM',
    accessTenantId: 'tenant-a',
  }),
  'Only SUPER_ADMIN can ingest public/platform signals',
)

assert.equal(
  resolveSignalTenantScope({
    role: 'BUSINESS_ADMIN',
    signalClass: 'TENANT',
    payloadTenantId: 'tenant-a',
    accessTenantId: 'tenant-a',
  }),
  'tenant-a',
)

mustThrow(
  () => resolveSignalTenantScope({
    role: 'BUSINESS_ADMIN',
    signalClass: 'TENANT',
    payloadTenantId: 'tenant-b',
    accessTenantId: 'tenant-a',
  }),
  'tenant mismatch',
)

console.log('enterprise-ai-endpoints.spec: all assertions passed')
