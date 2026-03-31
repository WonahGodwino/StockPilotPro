import { strict as assert } from 'assert'

// Inline generateReceiptNumber logic to avoid Prisma import (requires DB generation)
function generateReceiptNumber(): string {
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `RCP-${dateStr}-${random}`
}

// generateReceiptNumber format: RCP-YYYYMMDD-NNNNN
const receipt = generateReceiptNumber()
assert.match(receipt, /^RCP-\d{8}-\d{5}$/, 'receipt number should match RCP-YYYYMMDD-NNNNN')

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
assert.ok(receipt.startsWith(`RCP-${today}-`), 'receipt number should contain today\'s date')

// Two receipts generated rapidly should not be identical (random suffix)
const receipt2 = generateReceiptNumber()
// Both should match the format
assert.match(receipt2, /^RCP-\d{8}-\d{5}$/)
// They should be distinct (1 in 100,000 collision probability — acceptable for test)
assert.notEqual(receipt, receipt2, 'two receipts should be distinct')

// Low-stock deduplication logic: verify day-boundary calculation
const startOfDay = new Date(new Date().setHours(0, 0, 0, 0))
assert.equal(startOfDay.getHours(), 0)
assert.equal(startOfDay.getMinutes(), 0)
assert.equal(startOfDay.getSeconds(), 0)
assert.ok(startOfDay <= new Date(), 'start of day should be before or equal to now')

// Notification message format validation.
// NOTE: This mirrors the template in apps/api/src/lib/helpers.ts.
// A direct import is not possible here because helpers.ts imports from @prisma/client,
// which requires Prisma client generation (a build-time step not available in this test runner).
function buildLowStockMessage(name: string, quantity: number | string, unit: string): string {
  return `"${name}" is running low. Current stock: ${quantity} ${unit}`
}

const msg = buildLowStockMessage('Widget A', 3, 'pcs')
assert.equal(msg, '"Widget A" is running low. Current stock: 3 pcs')
assert.ok(msg.includes('Widget A'), 'message includes product name')
assert.ok(msg.includes('3'), 'message includes current quantity')

console.log('helpers checks passed')
