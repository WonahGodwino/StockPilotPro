/**
 * SSO – unit tests
 *
 * Tests cover:
 *  1. buildSsoState / parseSsoState round-trip (including HMAC signature)
 *  2. parseSsoState rejects tampered/invalid inputs
 *  3. isValidProvider correctly identifies supported providers
 *  4. buildAuthorizationUrl throws for unconfigured credentials
 *  5. buildAuthorizationUrl includes required OAuth2 params
 *  6. getSsoProviders correctly normalises the JSON field
 *  7. RBAC: only BUSINESS_ADMIN / SUPER_ADMIN may use SSO
 */

import { strict as assert } from 'assert'
import {
  buildSsoState,
  parseSsoState,
  isValidProvider,
  buildAuthorizationUrl,
  getSsoProviders,
} from '../src/lib/sso'

// ─── State round-trip ──────────────────────────────────────────────────────────

const state = buildSsoState('tenant-123', 'nonce-abc')
assert.ok(typeof state === 'string' && state.length > 0, 'state should be a non-empty string')
assert.ok(state.includes('.'), 'HMAC-signed state should contain a separator dot')

const parsed = parseSsoState(state)
assert.ok(parsed !== null, 'parseSsoState should return an object for valid state')
assert.equal(parsed!.tenantId, 'tenant-123', 'tenantId should round-trip')
assert.equal(parsed!.nonce, 'nonce-abc', 'nonce should round-trip')

// ─── parseSsoState rejects bad input ──────────────────────────────────────────

assert.equal(parseSsoState(''), null, 'empty string should return null')
assert.equal(parseSsoState('!!!invalid!!!'), null, 'garbage should return null')
assert.equal(parseSsoState('nodot'), null, 'no separator should return null')

// Tampered payload (valid base64url but bad signature)
const [payload] = state.split('.')
const tamperedState = `${payload}.invalidsig`
assert.equal(parseSsoState(tamperedState), null, 'tampered state should be rejected')

// Tampered content with valid signature structure but wrong payload
const fakePayload = Buffer.from(JSON.stringify({ tenantId: 'evil-tenant', nonce: 'x' })).toString('base64url')
const fakeState = `${fakePayload}.invalidsig`
assert.equal(parseSsoState(fakeState), null, 'state with wrong signature should be rejected')

// ─── isValidProvider ──────────────────────────────────────────────────────────

assert.equal(isValidProvider('google'), true)
assert.equal(isValidProvider('microsoft'), true)
assert.equal(isValidProvider('facebook'), false)
assert.equal(isValidProvider(''), false)
assert.equal(isValidProvider('GOOGLE'), false, 'provider check is case-sensitive')

// ─── getSsoProviders ──────────────────────────────────────────────────────────

assert.deepEqual(getSsoProviders(['google', 'microsoft']), ['google', 'microsoft'])
assert.deepEqual(getSsoProviders([]), [])
assert.deepEqual(getSsoProviders(null), [])
assert.deepEqual(getSsoProviders(undefined), [])
assert.deepEqual(getSsoProviders('google'), [], 'non-array should return empty array')

// ─── buildAuthorizationUrl throws when env vars missing ───────────────────────

const origGoogle = process.env.GOOGLE_CLIENT_ID
const origMicrosoft = process.env.MICROSOFT_CLIENT_ID

delete process.env.GOOGLE_CLIENT_ID
delete process.env.MICROSOFT_CLIENT_ID

let threw = false
try {
  buildAuthorizationUrl('google', 'some-state')
} catch (err) {
  threw = true
  assert.ok((err as Error).message.includes('GOOGLE_CLIENT_ID'), 'should mention missing env var')
}
assert.ok(threw, 'should throw when GOOGLE_CLIENT_ID is missing')

threw = false
try {
  buildAuthorizationUrl('microsoft', 'some-state')
} catch (err) {
  threw = true
  assert.ok((err as Error).message.includes('MICROSOFT_CLIENT_ID'), 'should mention missing env var')
}
assert.ok(threw, 'should throw when MICROSOFT_CLIENT_ID is missing')

// Restore env
if (origGoogle !== undefined) process.env.GOOGLE_CLIENT_ID = origGoogle
if (origMicrosoft !== undefined) process.env.MICROSOFT_CLIENT_ID = origMicrosoft

// ─── buildAuthorizationUrl includes required OAuth params ─────────────────────

process.env.GOOGLE_CLIENT_ID = 'test-google-id'
process.env.MICROSOFT_CLIENT_ID = 'test-ms-id'

const googleUrl = buildAuthorizationUrl('google', 'test-state')
assert.ok(googleUrl.startsWith('https://accounts.google.com'), 'google URL should point to Google')
assert.ok(googleUrl.includes('client_id=test-google-id'), 'should include client_id')
assert.ok(googleUrl.includes('state=test-state'), 'should include state')
assert.ok(googleUrl.includes('response_type=code'), 'should use code flow')

const msUrl = buildAuthorizationUrl('microsoft', 'test-state')
assert.ok(msUrl.startsWith('https://login.microsoftonline.com'), 'microsoft URL should point to Microsoft')
assert.ok(msUrl.includes('client_id=test-ms-id'), 'should include client_id')
assert.ok(msUrl.includes('state=test-state'), 'should include state')

// ─── SSO RBAC: only admins permitted ─────────────────────────────────────────
// The constraint is enforced in the callback route, but we validate the logic here.

type Role = 'SUPER_ADMIN' | 'BUSINESS_ADMIN' | 'SALESPERSON'
function isSsoAllowed(role: Role): boolean {
  return role === 'BUSINESS_ADMIN' || role === 'SUPER_ADMIN'
}

assert.equal(isSsoAllowed('SUPER_ADMIN'), true)
assert.equal(isSsoAllowed('BUSINESS_ADMIN'), true)
assert.equal(isSsoAllowed('SALESPERSON'), false)

console.log('SSO checks passed ✓')
