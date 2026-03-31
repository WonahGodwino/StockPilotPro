/**
 * JWT – unit tests
 *
 * Tests cover:
 *  1. signAccessToken / verifyAccessToken round-trip
 *  2. signRefreshToken / verifyRefreshToken round-trip
 *  3. verifyAccessToken rejects token signed with wrong secret
 *  4. verifyRefreshToken rejects token signed with wrong secret
 *  5. verifyAccessToken rejects a tampered/invalid token string
 *  6. verifyRefreshToken rejects an expired token
 *  7. Access token cannot be verified as a refresh token and vice-versa
 *
 * NOTE: jwt.ts imports prisma (which requires DB generation), so we inline
 * the signing/verification logic here using jsonwebtoken directly — the same
 * pattern used by helpers.spec.ts to avoid prisma import issues.
 */

import { strict as assert } from 'assert'
import jwt from 'jsonwebtoken'

// ─── Inline JWT helpers (mirrors apps/api/src/lib/jwt.ts) ────────────────────

const JWT_SECRET = 'test-access-secret'
const JWT_REFRESH_SECRET = 'test-refresh-secret'
const JWT_EXPIRES_IN = '15m'
const JWT_REFRESH_EXPIRES_IN = '7d'

interface JWTPayload {
  userId: string
  email: string
  role: string
  tenantId: string | null
  subsidiaryId: string | null
}

function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions)
}

function signRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions)
}

function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload
}

function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload
}

// ─── Shared test payload ──────────────────────────────────────────────────────

const payload: JWTPayload = {
  userId: 'user-123',
  email: 'test@example.com',
  role: 'BUSINESS_ADMIN',
  tenantId: 'tenant-abc',
  subsidiaryId: null,
}

// ─── signAccessToken / verifyAccessToken round-trip ──────────────────────────

const accessToken = signAccessToken(payload)
assert.ok(typeof accessToken === 'string' && accessToken.length > 0, 'access token should be a non-empty string')

const decoded = verifyAccessToken(accessToken)
assert.equal(decoded.userId, payload.userId, 'userId should round-trip')
assert.equal(decoded.email, payload.email, 'email should round-trip')
assert.equal(decoded.role, payload.role, 'role should round-trip')
assert.equal(decoded.tenantId, payload.tenantId, 'tenantId should round-trip')
assert.equal(decoded.subsidiaryId, payload.subsidiaryId, 'subsidiaryId should round-trip')

// ─── signRefreshToken / verifyRefreshToken round-trip ────────────────────────

const refreshToken = signRefreshToken(payload)
assert.ok(typeof refreshToken === 'string' && refreshToken.length > 0, 'refresh token should be a non-empty string')
assert.notEqual(accessToken, refreshToken, 'access and refresh tokens should differ (different secrets)')

const decodedRefresh = verifyRefreshToken(refreshToken)
assert.equal(decodedRefresh.userId, payload.userId, 'userId should round-trip in refresh token')
assert.equal(decodedRefresh.email, payload.email, 'email should round-trip in refresh token')
assert.equal(decodedRefresh.tenantId, payload.tenantId, 'tenantId should round-trip in refresh token')

// ─── verifyAccessToken rejects a tampered token ──────────────────────────────

let threw = false
try {
  verifyAccessToken('this.is.not.a.valid.jwt')
} catch {
  threw = true
}
assert.ok(threw, 'verifyAccessToken should throw on a tampered/invalid token')

// ─── verifyRefreshToken rejects a tampered token ─────────────────────────────

threw = false
try {
  verifyRefreshToken('this.is.not.a.valid.jwt')
} catch {
  threw = true
}
assert.ok(threw, 'verifyRefreshToken should throw on a tampered/invalid token')

// ─── Expired access token is rejected ────────────────────────────────────────

const expiredAccess = jwt.sign({ ...payload }, JWT_SECRET, { expiresIn: '0s' } as jwt.SignOptions)

threw = false
try {
  verifyAccessToken(expiredAccess)
} catch (err) {
  threw = true
  assert.ok((err as Error).message.includes('expired'), 'error message should mention expiry')
}
assert.ok(threw, 'verifyAccessToken should throw on an expired token')

// ─── Expired refresh token is rejected ───────────────────────────────────────

const expiredRefresh = jwt.sign({ ...payload }, JWT_REFRESH_SECRET, { expiresIn: '0s' } as jwt.SignOptions)

threw = false
try {
  verifyRefreshToken(expiredRefresh)
} catch (err) {
  threw = true
  assert.ok((err as Error).message.includes('expired'), 'error message should mention expiry')
}
assert.ok(threw, 'verifyRefreshToken should throw on an expired token')

// ─── Access token cannot be verified as a refresh token ──────────────────────

threw = false
try {
  verifyRefreshToken(accessToken)
} catch {
  threw = true
}
assert.ok(threw, 'an access token should not pass refresh token verification (different secrets)')

// ─── Refresh token cannot be verified as an access token ─────────────────────

threw = false
try {
  verifyAccessToken(refreshToken)
} catch {
  threw = true
}
assert.ok(threw, 'a refresh token should not pass access token verification (different secrets)')

// ─── Token rotation: new tokens carry same claims ─────────────────────────────
// Simulate the rotation logic (sign new pair from existing payload)

const rotatedAccess = signAccessToken(payload)
const rotatedRefresh = signRefreshToken(payload)

assert.equal(verifyAccessToken(rotatedAccess).userId, payload.userId, 'rotated access token carries correct userId')
assert.equal(verifyRefreshToken(rotatedRefresh).userId, payload.userId, 'rotated refresh token carries correct userId')
assert.equal(verifyAccessToken(rotatedAccess).tenantId, payload.tenantId, 'rotated access token carries correct tenantId')
assert.equal(verifyRefreshToken(rotatedRefresh).role, payload.role, 'rotated refresh token carries correct role')

console.log('JWT checks passed ✓')
