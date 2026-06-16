import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const assistantPath = path.join(__dirname, '../src/lib/enterprise-ai-assistant.ts')
const assistantSource = fs.readFileSync(assistantPath, 'utf8')

const recommendationsRoutePath = path.join(__dirname, '../src/app/api/enterprise-ai/recommendations/route.ts')
const recommendationsRouteSource = fs.readFileSync(recommendationsRoutePath, 'utf8')

const assistantRoutePath = path.join(__dirname, '../src/app/api/enterprise-ai/assistant/route.ts')
const assistantRouteSource = fs.readFileSync(assistantRoutePath, 'utf8')

console.log('enterprise-ai-grounding-source.spec: starting test suite')

console.log('enterprise-ai-grounding-source.spec: verifying assistant external branch exists')
assert.equal(
  /const externalSnapshot = await loadExternalGroundingSnapshot\([\s\S]*?if \(externalSnapshot\) \{[\s\S]*?source: 'external'/.test(assistantSource),
  true,
  'Assistant grounding loader should produce external grounding when a snapshot is available',
)

console.log('enterprise-ai-grounding-source.spec: verifying assistant internal fallback exists')
assert.equal(
  /return \{[\s\S]*?source: 'internal'/.test(assistantSource),
  true,
  'Assistant grounding loader should preserve internal fallback path',
)

console.log('enterprise-ai-grounding-source.spec: verifying recommendation payload uses actual assistant grounding source')
assert.equal(
  recommendationsRouteSource.includes("groundingSource: assistant.grounding.groundingSource"),
  true,
  'Recommendation payload should expose the actual assistant grounding source',
)

console.log('enterprise-ai-grounding-source.spec: verifying direct assistant route uses actual grounding source')
assert.equal(
  assistantRouteSource.includes('const actualGroundingSource = assistantResult.grounding.groundingSource'),
  true,
  'Assistant route should derive grounding source from the actual assistant grounding result',
)

console.log('enterprise-ai-grounding-source.spec: all assertions passed')