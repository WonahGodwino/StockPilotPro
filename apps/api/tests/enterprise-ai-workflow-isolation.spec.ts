import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const executorPath = path.join(__dirname, '../src/lib/enterprise-ai-autonomous-executor.ts')
const routePath = path.join(__dirname, '../src/app/api/enterprise-ai/workflows/route.ts')

const executorSource = fs.readFileSync(executorPath, 'utf8')
const routeSource = fs.readFileSync(routePath, 'utf8')

console.log('enterprise-ai-workflow-isolation.spec: starting test suite')

assert.match(
  executorSource,
  /condition:\s*toJsonValue\(\{\s*type: input\.trigger,\s*source: 'workflow_management',\s*tenantId: input\.tenantId\s*\}\)/,
  'Workflow creation should stamp tenantId into rule condition metadata',
)

assert.match(
  executorSource,
  /workflowRuleTenantFilter\(context\.tenantId\)/,
  'Execution planning should filter workflow rules by tenantId',
)

assert.match(
  executorSource,
  /workflowRuleTenantFilter\(args\.tenantId\)/,
  'Workflow trigger and dashboard paths should filter rules by tenantId',
)

assert.match(
  executorSource,
  /const rawRule = await prisma\.autonomousRule\.findUnique\([\s\S]*condition: true,[\s\S]*createdBy: true,[\s\S]*\)/,
  'Workflow execution runtime should load condition metadata needed for tenant validation and backfill',
)

assert.match(
  executorSource,
  /export async function backfillLegacyWorkflowRulesForTenant\(tenantId: string\)/,
  'Workflow executor should expose a legacy rule backfill path',
)

assert.match(
  routeSource,
  /backfillLegacyWorkflowRulesForTenant\(access\.tenantId\)[\s\S]*path: \['tenantId'\],\s*equals: access\.tenantId/,
  'Workflow toggle route should backfill legacy tenant scope before verifying ownership',
)

console.log('enterprise-ai-workflow-isolation.spec: all assertions passed')