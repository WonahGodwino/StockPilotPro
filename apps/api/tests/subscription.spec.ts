import { strict as assert } from 'assert'
import { isAllowedStatusTransition, SUBSCRIPTION_TRANSITIONS } from '../src/lib/subscription'

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

function assertTransition(from: string, to: string) {
  if (!isAllowedStatusTransition(from, to)) {
    throw new Error(`Invalid status transition from ${from} to ${to}`)
  }
}

// Verify the transition table is defined for all expected statuses
assert.ok(SUBSCRIPTION_TRANSITIONS['ACTIVE'], 'ACTIVE transitions defined')
assert.ok(SUBSCRIPTION_TRANSITIONS['SUSPENDED'], 'SUSPENDED transitions defined')
assert.ok(Array.isArray(SUBSCRIPTION_TRANSITIONS['EXPIRED']), 'EXPIRED transitions defined')

// Valid transitions
assert.equal(isAllowedStatusTransition('ACTIVE', 'SUSPENDED'), true, 'ACTIVE → SUSPENDED allowed')
assert.equal(isAllowedStatusTransition('ACTIVE', 'EXPIRED'), true, 'ACTIVE → EXPIRED allowed')
assert.equal(isAllowedStatusTransition('SUSPENDED', 'EXPIRED'), true, 'SUSPENDED → EXPIRED allowed')
assert.equal(isAllowedStatusTransition('SUSPENDED', 'ACTIVE'), true, 'SUSPENDED → ACTIVE allowed (reactivation)')

// Invalid transitions
assert.equal(isAllowedStatusTransition('EXPIRED', 'ACTIVE'), false, 'EXPIRED → ACTIVE blocked')
assert.equal(isAllowedStatusTransition('EXPIRED', 'SUSPENDED'), false, 'EXPIRED → SUSPENDED blocked')

// assertTransition throws on invalid
assertTransition('ACTIVE', 'SUSPENDED')
assertTransition('SUSPENDED', 'EXPIRED')
mustThrow(() => assertTransition('EXPIRED', 'ACTIVE'), 'Invalid status transition from EXPIRED to ACTIVE')
mustThrow(() => assertTransition('EXPIRED', 'SUSPENDED'), 'Invalid status transition from EXPIRED to SUSPENDED')

// Expiry date blocking: login should reject a subscription whose expiryDate is in the past
function checkSubscriptionAccess(status: string, expiryDate: Date): boolean {
  const now = new Date()
  return status === 'ACTIVE' && expiryDate >= now
}

const future = new Date(Date.now() + 86400 * 1000)
const past = new Date(Date.now() - 86400 * 1000)

assert.equal(checkSubscriptionAccess('ACTIVE', future), true, 'ACTIVE + future expiry = access granted')
assert.equal(checkSubscriptionAccess('ACTIVE', past), false, 'ACTIVE + past expiry = access denied')
assert.equal(checkSubscriptionAccess('SUSPENDED', future), false, 'SUSPENDED = access denied')
assert.equal(checkSubscriptionAccess('EXPIRED', future), false, 'EXPIRED = access denied')

console.log('Subscription transition and expiry checks passed')
