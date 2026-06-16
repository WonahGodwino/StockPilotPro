import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const pagePath = path.join(__dirname, '../../client/src/pages/EnterpriseAI.tsx')
const source = fs.readFileSync(pagePath, 'utf8')

console.log('enterprise-ai-page-load-behavior.spec: starting test suite')

const mountEffectMatch = source.match(/useEffect\(\(\) => \{[\s\S]*?if \(canAccess\) \{([\s\S]*?)\}\s*\}, \[canAccess\]\)/)
assert.ok(mountEffectMatch, 'Enterprise AI page should contain a canAccess mount effect')

const mountEffectBody = mountEffectMatch?.[1] || ''
assert.doesNotMatch(
  mountEffectBody,
  /loadCausalDiagnostics\(\)/,
  'Enterprise AI page should not auto-run causal diagnostics on initial load',
)

assert.doesNotMatch(
  mountEffectBody,
  /loadSimulationPreview\(\)/,
  'Enterprise AI page should not auto-run simulation previews on initial load',
)

console.log('enterprise-ai-page-load-behavior.spec: all assertions passed')