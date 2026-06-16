import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const externalDataPath = path.join(__dirname, '../src/lib/enterprise-ai-external-data.ts')
const source = fs.readFileSync(externalDataPath, 'utf8')

console.log('enterprise-ai-external-data-security.spec: starting test suite')

assert.match(
  source,
  /ENTERPRISE_AI_EXTERNAL_DATA_SECRET_KEY/,
  'External data credential handling should require a dedicated secret key',
)

assert.doesNotMatch(
  source,
  /\|\| process\.env\.JWT_SECRET/,
  'External data credential handling should not fall back to JWT_SECRET',
)

assert.doesNotMatch(
  source,
  /stockpilotpro-external-data-dev-key/,
  'External data credential handling should not fall back to a hardcoded development key',
)

assert.match(
  source,
  /readOnlyValidatedBy: 'session-default' \| 'privilege-restricted'/,
  'External data discovery should record whether read-only validation came from session defaults or privilege restrictions',
)

assert.match(
  source,
  /Phase 1 requires PostgreSQL credentials with default_transaction_read_only=on or a reporting user that has no write privileges on the target schema\./,
  'External data discovery should allow privilege-restricted reporting users when managed PostgreSQL sessions do not surface default_transaction_read_only=on',
)

console.log('enterprise-ai-external-data-security.spec: all assertions passed')