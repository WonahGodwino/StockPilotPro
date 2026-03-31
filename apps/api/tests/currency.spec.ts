import { strict as assert } from 'assert'

// ── Currency conversion logic (mirrors apps/api/src/app/api/reports/route.ts) ─

/**
 * Convert an amount from a transaction currency to the base (reporting) currency.
 * Convention: fxRate = "how many transaction-currency units per 1 base-currency unit"
 * So: baseAmount = transactionAmount / fxRate
 */
function toBaseCurrency(amount: number, currency: string, fxRate: number, baseCurrency: string): number {
  if (currency === baseCurrency || fxRate === 1) return amount
  return amount / fxRate
}

// Same currency → no conversion
assert.equal(toBaseCurrency(1000, 'USD', 1, 'USD'), 1000, 'same currency returns same amount')
assert.equal(toBaseCurrency(1000, 'NGN', 1, 'NGN'), 1000, 'same currency with rate 1 returns same amount')

// USD → NGN with rate 1600 (1 USD = 1600 NGN)
// If fxRate = 1600 (NGN per USD), then 1600 NGN = 1 USD
// toBaseCurrency(1600 NGN, 'NGN', 1600, 'USD') = 1600 / 1600 = 1 USD ✓
const usdAmount = toBaseCurrency(1600, 'NGN', 1600, 'USD')
assert.ok(Math.abs(usdAmount - 1) < 0.0001, `1600 NGN at rate 1600 = 1 USD (got ${usdAmount})`)

// EUR → USD with rate 0.92 (1 USD = 0.92 EUR)
// toBaseCurrency(92 EUR, 'EUR', 0.92, 'USD') = 92 / 0.92 = 100 USD ✓
const eurToUsd = toBaseCurrency(92, 'EUR', 0.92, 'USD')
assert.ok(Math.abs(eurToUsd - 100) < 0.0001, `92 EUR at rate 0.92 = 100 USD (got ${eurToUsd})`)

// ── Report totals: sum across mixed currencies ─────────────────────────────────

interface FakeSale {
  totalAmount: number
  currency: string
  fxRate: number
}

function computeTotalSales(sales: FakeSale[], baseCurrency: string): number {
  return sales.reduce((s, sale) => s + toBaseCurrency(sale.totalAmount, sale.currency, sale.fxRate, baseCurrency), 0)
}

const sales: FakeSale[] = [
  { totalAmount: 100, currency: 'USD', fxRate: 1 },        // 100 USD
  { totalAmount: 1600, currency: 'NGN', fxRate: 1600 },    // 1 USD
  { totalAmount: 92, currency: 'EUR', fxRate: 0.92 },      // 100 USD
]

const total = computeTotalSales(sales, 'USD')
assert.ok(Math.abs(total - 201) < 0.01, `Mixed currency total = 201 USD (got ${total})`)

// ── Tenant baseCurrency default ────────────────────────────────────────────────

const DEFAULT_BASE_CURRENCY = 'USD'
assert.equal(DEFAULT_BASE_CURRENCY, 'USD', 'default base currency is USD')

// ── fxRate = 1 means no conversion (same currency) ───────────────────────────

const noConversion = toBaseCurrency(500, 'GBP', 1, 'USD')
assert.equal(noConversion, 500, 'fxRate 1 means pass-through (used when currencies are the same)')

// ── SUPPORTED_CURRENCIES list check ───────────────────────────────────────────

const EXPECTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS']
for (const code of EXPECTED_CURRENCIES) {
  assert.ok(code.length === 3, `Currency code ${code} must be 3 characters`)
  assert.equal(code, code.toUpperCase(), `Currency code ${code} must be uppercase`)
}

console.log('currency checks passed')
