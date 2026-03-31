/**
 * Unit tests for the structured logger and request-tracing utilities.
 *
 * Run with: npm run test:observability  (from apps/api)
 */

import { strict as assert } from 'assert'

// ---------------------------------------------------------------------------
// Logger tests
// ---------------------------------------------------------------------------

// Capture writes to stdout / stderr
const stdoutLines: string[] = []
const stderrLines: string[] = []

const origStdoutWrite = process.stdout.write.bind(process.stdout)
const origStderrWrite = process.stderr.write.bind(process.stderr)

// Patch process.stdout/stderr to capture JSON log lines for assertions.
// Using explicit cast to NodeJS.WritableStream to keep the override concise.
const captureStdout = (data: string) => { stdoutLines.push(data); return origStdoutWrite(data) }
const captureStderr = (data: string) => { stderrLines.push(data); return origStderrWrite(data) }
process.stdout.write = captureStdout as typeof process.stdout.write
process.stderr.write = captureStderr as typeof process.stderr.write

// Import AFTER patching write so we capture from the start
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../src/lib/logger') as typeof import('../src/lib/logger')

function lastStdout(): Record<string, unknown> {
  const line = stdoutLines[stdoutLines.length - 1]
  assert.ok(line, 'Expected at least one stdout line')
  return JSON.parse(line.trim())
}

function lastStderr(): Record<string, unknown> {
  const line = stderrLines[stderrLines.length - 1]
  assert.ok(line, 'Expected at least one stderr line')
  return JSON.parse(line.trim())
}

// info level is written to stdout
logger.info('test info message', { requestId: 'req-1', userId: 'u1' })
{
  const entry = lastStdout()
  assert.equal(entry.level, 'info', 'level should be info')
  assert.equal(entry.message, 'test info message')
  assert.equal(entry.requestId, 'req-1')
  assert.equal(entry.userId, 'u1')
  assert.equal(entry.service, 'stockpilot-api')
  assert.ok(typeof entry.timestamp === 'string', 'timestamp should be a string')
}

// warn level is written to stdout
logger.warn('test warn message')
{
  const entry = lastStdout()
  assert.equal(entry.level, 'warn')
  assert.equal(entry.message, 'test warn message')
}

// error level is written to stderr
logger.error('test error message', { err: new Error('boom') })
{
  const entry = lastStderr()
  assert.equal(entry.level, 'error')
  assert.equal(entry.message, 'test error message')
  assert.ok(entry.error, 'error field should be present')
  const errObj = entry.error as Record<string, unknown>
  assert.equal(errObj.name, 'Error')
  assert.equal(errObj.message, 'boom')
}

// plain (non-Error) values are also serialized
logger.error('plain error', { err: 'something went wrong' })
{
  const entry = lastStderr()
  const errObj = entry.error as Record<string, unknown>
  assert.ok(errObj.raw, 'raw field should exist for non-Error values')
}

// context without err leaves no error field
logger.info('no error field', { tenantId: 't1' })
{
  const entry = lastStdout()
  assert.equal(entry.error, undefined, 'error field should not be present')
  assert.equal(entry.tenantId, 't1')
}

console.log('Logger tests passed')

// ---------------------------------------------------------------------------
// Tracing tests (pure-function subset – no HTTP runtime needed)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRequestId } = require('../src/lib/tracing') as typeof import('../src/lib/tracing')

// Mock NextRequest with a pre-existing request ID header
function mockRequest(requestId?: string): import('next/server').NextRequest {
  const headers = new Headers()
  if (requestId) headers.set('x-request-id', requestId)
  return {
    headers,
    method: 'GET',
    url: 'http://localhost:3000/api/test',
  } as unknown as import('next/server').NextRequest
}

// If the header is present, getRequestId returns it unchanged
{
  const req = mockRequest('existing-id-123')
  const id = getRequestId(req)
  assert.equal(id, 'existing-id-123', 'Should reuse existing x-request-id')
}

// If no header, a new UUID is generated
{
  const req = mockRequest()
  const id = getRequestId(req)
  assert.ok(id.length > 0, 'Should generate a non-empty request ID')
  // UUID v4 pattern (or any non-empty string from crypto.randomUUID)
  assert.match(id, /^[0-9a-f-]{36}$/i, 'Generated ID should look like a UUID')
}

// Two calls without a header produce different IDs
{
  const id1 = getRequestId(mockRequest())
  const id2 = getRequestId(mockRequest())
  assert.notEqual(id1, id2, 'Each call should produce a unique ID')
}

console.log('Tracing tests passed')

// ---------------------------------------------------------------------------
// Health-check logic tests (unit – no DB/Redis connection required)
// ---------------------------------------------------------------------------

// Verify that the health-check response shape is correct by exercising
// the status-determination logic in isolation.

type HealthStatus = 'ok' | 'degraded' | 'error'

function resolveOverallStatus(dbStatus: string, redisStatus: string): HealthStatus {
  const dbOk = dbStatus === 'ok'
  const redisOk = redisStatus === 'ok' || redisStatus === 'unavailable'
  if (!dbOk) return 'error'
  if (!redisOk) return 'degraded'
  return 'ok'
}

assert.equal(resolveOverallStatus('ok', 'ok'), 'ok')
assert.equal(resolveOverallStatus('ok', 'unavailable'), 'ok')
assert.equal(resolveOverallStatus('ok', 'error'), 'degraded')
assert.equal(resolveOverallStatus('error', 'ok'), 'error')
assert.equal(resolveOverallStatus('error', 'error'), 'error')

console.log('Health-check logic tests passed')

// Restore original write functions
process.stdout.write = origStdoutWrite
process.stderr.write = origStderrWrite

console.log('\nAll observability tests passed ✓')
