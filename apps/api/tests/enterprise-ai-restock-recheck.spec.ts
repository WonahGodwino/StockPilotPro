import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const assistantPath = path.join(__dirname, '../src/lib/enterprise-ai-assistant.ts')
const assistantSource = fs.readFileSync(assistantPath, 'utf8')

const detectPromptIntentSourceMatch = assistantSource.match(
  /export function detectPromptIntent\(prompt: string\): PromptIntent \{[\s\S]*?\n\}/,
)
assert.ok(detectPromptIntentSourceMatch, 'Unable to locate detectPromptIntent in assistant source')

const detectPromptIntentTsSource = `${detectPromptIntentSourceMatch[0].replace('export function', 'function')}\nmodule.exports = { detectPromptIntent }`
const transpiled = ts.transpileModule(detectPromptIntentTsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
})

const sandbox: { module: { exports: Record<string, unknown> }; exports: Record<string, unknown> } = {
  module: { exports: {} },
  exports: {},
}
vm.runInNewContext(transpiled.outputText, sandbox)

const detectPromptIntent = sandbox.module.exports.detectPromptIntent as (prompt: string) => string
assert.equal(typeof detectPromptIntent, 'function', 'detectPromptIntent extraction failed')

console.log('enterprise-ai-restock-recheck.spec: starting test suite')

console.log('enterprise-ai-restock-recheck.spec: testing RESTOCK intent detection')
const restockPrompts = [
  'I need to restock inventory this week',
  'What products should we reorder now?',
  'Do we have low stock risk today?',
  'Any stockout warnings in the store?',
]
for (const prompt of restockPrompts) {
  assert.equal(detectPromptIntent(prompt), 'RESTOCK', `Expected RESTOCK for prompt: "${prompt}"`)
}
console.log('enterprise-ai-restock-recheck.spec: RESTOCK intent detection ✓')

console.log('enterprise-ai-restock-recheck.spec: testing non-RESTOCK intent mapping')
const mappingCases: Array<{ prompt: string; expected: string }> = [
  { prompt: 'Show me profitability by product', expected: 'PROFITABILITY' },
  { prompt: 'Show me top selling products', expected: 'SALES' },
  { prompt: 'Break down our expense category changes', expected: 'EXPENSES' },
  { prompt: 'Predict future demand for next month', expected: 'FORECAST' },
  { prompt: 'Hello assistant', expected: 'GENERAL' },
]
for (const c of mappingCases) {
  assert.equal(detectPromptIntent(c.prompt), c.expected, `Prompt mismatch: "${c.prompt}"`)
}
console.log('enterprise-ai-restock-recheck.spec: non-RESTOCK intent mapping ✓')

console.log('enterprise-ai-restock-recheck.spec: testing RECHECK keyword coverage in deterministic brief')
const recheckKeywords = [
  "lowerQuestion.includes('recheck')",
  "lowerQuestion.includes('follow-up')",
  "lowerQuestion.includes('previous')",
  "lowerQuestion.includes('update on')",
  "lowerQuestion.includes('status check')",
  "lowerQuestion.includes('reassess')",
  "lowerQuestion.includes('original prompt')",
]
for (const keywordGuard of recheckKeywords) {
  assert.equal(
    assistantSource.includes(keywordGuard),
    true,
    `Missing RECHECK keyword guard in deterministic brief: ${keywordGuard}`,
  )
}
console.log('enterprise-ai-restock-recheck.spec: RECHECK keyword coverage ✓')

console.log('enterprise-ai-restock-recheck.spec: testing RECHECK 4-part narrative markers')
const recheckSections = [
  'WHAT HAS IMPROVED',
  'WHAT IS STILL UNRESOLVED',
  'WHAT GOT WORSE OR REMAINS HIGH RISK',
  'UPDATED PRIORITY ACTIONS (Next 7 Days)',
]
for (const section of recheckSections) {
  assert.equal(
    assistantSource.includes(section),
    true,
    `Missing RECHECK narrative section marker: ${section}`,
  )
}
console.log('enterprise-ai-restock-recheck.spec: RECHECK narrative markers ✓')

console.log('enterprise-ai-restock-recheck.spec: testing RESTOCK urgency tier action markers')
const restockTierMarkers = ['P1 - URGENT:', 'P2 -', 'P3 -']
for (const marker of restockTierMarkers) {
  assert.equal(
    assistantSource.includes(marker),
    true,
    `Missing RESTOCK urgency tier marker: ${marker}`,
  )
}
console.log('enterprise-ai-restock-recheck.spec: RESTOCK urgency tier markers ✓')

console.log('enterprise-ai-restock-recheck.spec: all assertions passed')
