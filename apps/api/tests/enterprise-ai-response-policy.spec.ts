import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const assistantPath = path.join(__dirname, '../src/lib/enterprise-ai-assistant.ts')
const assistantSource = fs.readFileSync(assistantPath, 'utf8')

console.log('enterprise-ai-response-policy.spec: starting test suite')

assert.match(
  assistantSource,
  /response:\s*formatBriefAsText\(finalBrief, responseGrounding\.tenantInfo\.name\)/,
  'Final assistant response should be rendered from the post-policy brief so text and structured output stay consistent',
)

assert.match(
  assistantSource,
  /if \(brief\.businessGuidance\)/,
  'Rendered assistant text should include business guidance emitted by the response policy layer',
)

assert.match(
  assistantSource,
  /if \(brief\.factBasis && brief\.factBasis\.length > 0\)/,
  'Rendered assistant text should include fact-basis lines from the post-policy brief',
)

console.log('enterprise-ai-response-policy.spec: all assertions passed')