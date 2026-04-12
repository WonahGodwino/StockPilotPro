import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const PORT = 3311
const BASE_URL = `http://127.0.0.1:${PORT}`
const REQUEST_TIMEOUT_MS = 3000

type LoginResult = {
  accessToken: string
  user: {
    tenantId: string | null
  }
}

const prisma = new PrismaClient()

function makeToken(payload: {
  userId: string
  email: string
  role: string
  tenantId: string | null
  subsidiaryId: string | null
}): string {
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken')
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not configured for HTTP integration tests')
  return jwt.sign(payload, secret, { expiresIn: '10m' })
}

async function waitForServerReady(child: ChildProcess): Promise<void> {
  const attempts = 30
  for (let i = 0; i < attempts; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next API server exited before ready with code ${child.exitCode}`)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: controller.signal })
      if (res.status === 200 || res.status === 503) return
    } catch {
      // server not ready yet
    } finally {
      clearTimeout(timeout)
    }
    await wait(1000)
  }
  throw new Error('Timed out waiting for Next API server to become ready')
}

async function postJson(path: string, body: unknown, token?: string, extraHeaders?: Record<string, string>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function getJson(path: string, token: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function patchJson(path: string, body: unknown, token?: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureEnterpriseFixtures() {
  const now = new Date()
  const nextYear = new Date(now)
  nextYear.setFullYear(now.getFullYear() + 1)

  const enterprisePlan = await prisma.plan.upsert({
    where: { id: 'plan_test_enterprise_ai' },
    update: {
      name: 'Test Enterprise AI',
      maxSubsidiaries: 999999,
      features: {
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
        UNLIMITED_BRANCHES: true,
        AI_DEMAND_FORECAST: true,
        AI_REORDER_ADVISOR: true,
        AI_PRICING_MARGIN_ADVISOR: true,
        AI_CASHFLOW_FORECAST: true,
        AI_EXPENSE_RISK_ALERTS: true,
        AI_ANOMALY_DETECTION: true,
        AI_BRANCH_PERFORMANCE_COPILOT: true,
        AI_NATURAL_LANGUAGE_ASSISTANT: true,
      },
      isActive: true,
    },
    create: {
      id: 'plan_test_enterprise_ai',
      name: 'Test Enterprise AI',
      description: 'Fixture plan for enterprise-ai-http.spec',
      price: 1999,
      maxSubsidiaries: 999999,
      extraSubsidiaryPrice: 0,
      features: {
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
        UNLIMITED_BRANCHES: true,
        AI_DEMAND_FORECAST: true,
        AI_REORDER_ADVISOR: true,
        AI_PRICING_MARGIN_ADVISOR: true,
        AI_CASHFLOW_FORECAST: true,
        AI_EXPENSE_RISK_ALERTS: true,
        AI_ANOMALY_DETECTION: true,
        AI_BRANCH_PERFORMANCE_COPILOT: true,
        AI_NATURAL_LANGUAGE_ASSISTANT: true,
      },
      isActive: true,
    },
  })

  const growthPlan = await prisma.plan.upsert({
    where: { id: 'plan_test_growth_ai' },
    update: { name: 'Test Growth AI', maxSubsidiaries: 5, features: { reports: true }, isActive: true },
    create: {
      id: 'plan_test_growth_ai',
      name: 'Test Growth AI',
      description: 'Fixture non-enterprise plan for enterprise-ai-http.spec',
      price: 299,
      maxSubsidiaries: 5,
      extraSubsidiaryPrice: 29,
      features: { reports: true },
      isActive: true,
    },
  })

  const enterpriseTenant = await prisma.tenant.upsert({
    where: { slug: 'integration-enterprise-ai' },
    update: { name: 'Integration Enterprise AI', archived: false, isActive: true },
    create: {
      slug: 'integration-enterprise-ai',
      name: 'Integration Enterprise AI',
      email: 'integration-enterprise-ai@example.com',
      isActive: true,
      archived: false,
    },
  })

  const nonEnterpriseTenant = await prisma.tenant.upsert({
    where: { slug: 'integration-growth-ai' },
    update: { name: 'Integration Growth AI', archived: false, isActive: true },
    create: {
      slug: 'integration-growth-ai',
      name: 'Integration Growth AI',
      email: 'integration-growth-ai@example.com',
      isActive: true,
      archived: false,
    },
  })

  await prisma.subscription.upsert({
    where: { id: 'sub_test_enterprise_ai' },
    update: {
      tenantId: enterpriseTenant.id,
      planId: enterprisePlan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 1999,
    },
    create: {
      id: 'sub_test_enterprise_ai',
      tenantId: enterpriseTenant.id,
      planId: enterprisePlan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 1999,
    },
  })

  await prisma.subscription.upsert({
    where: { id: 'sub_test_growth_ai' },
    update: {
      tenantId: nonEnterpriseTenant.id,
      planId: growthPlan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 299,
    },
    create: {
      id: 'sub_test_growth_ai',
      tenantId: nonEnterpriseTenant.id,
      planId: growthPlan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 299,
    },
  })

  return {
    enterpriseTenantId: enterpriseTenant.id,
    nonEnterpriseTenantId: nonEnterpriseTenant.id,
  }
}

async function run() {
  const nextBin = require.resolve('next/dist/bin/next')
  let childError: Error | null = null
  process.env.ENTERPRISE_AI_JOB_SECRET = process.env.ENTERPRISE_AI_JOB_SECRET || 'integration-enterprise-job-secret'
  console.log('enterprise-ai-http.spec: building Next app for black-box test')
  execSync('npm run build', { cwd: process.cwd(), stdio: 'ignore' })

  const child: ChildProcess = spawn(process.execPath, [nextBin, 'start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    shell: false,
    stdio: 'pipe',
  })

  let serverLogs = ''
  child.stdout?.on('data', (buf: Buffer) => {
    serverLogs += buf.toString()
  })
  child.stderr?.on('data', (buf: Buffer) => {
    serverLogs += buf.toString()
  })

  child.on('error', (err) => {
    childError = err as Error
  })

  const cleanup = () => {
    if (!child.killed) child.kill('SIGTERM')
    if (process.platform === 'win32' && child.pid) {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
      } catch {
        // process may already be terminated
      }
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    if (childError) throw childError
    console.log('enterprise-ai-http.spec: waiting for server readiness')
    await waitForServerReady(child)
    console.log('enterprise-ai-http.spec: server is ready')

    console.log('enterprise-ai-http.spec: preparing fixtures')
    const fixture = await ensureEnterpriseFixtures()
    console.log('enterprise-ai-http.spec: fixtures prepared')

    const superAdminToken = makeToken({
      userId: 'integration-super-admin',
      email: 'integration-super-admin@test.local',
      role: 'SUPER_ADMIN',
      tenantId: fixture.enterpriseTenantId,
      subsidiaryId: null,
    })

    const nonEnterpriseBusinessToken = makeToken({
      userId: 'integration-growth-admin',
      email: 'integration-growth-admin@test.local',
      role: 'BUSINESS_ADMIN',
      tenantId: fixture.nonEnterpriseTenantId,
      subsidiaryId: null,
    })

    const salesUserToken = makeToken({
      userId: 'integration-sales-user',
      email: 'integration-sales@test.local',
      role: 'SALESPERSON',
      tenantId: fixture.enterpriseTenantId,
      subsidiaryId: null,
    })

    // Non-enterprise tenant should be blocked
    console.log('enterprise-ai-http.spec: checking non-enterprise access block')
    const blocked = await getJson('/api/enterprise-ai/context', nonEnterpriseBusinessToken)
    assert.equal(blocked.status, 403, 'Non-enterprise business admin should be blocked from enterprise-ai context')

    // Enterprise authorized role should access
    console.log('enterprise-ai-http.spec: checking enterprise access allow')
    const allowed = await getJson('/api/enterprise-ai/context', superAdminToken)
    assert.equal(allowed.status, 200, 'Enterprise super admin should access enterprise-ai context')

    // Role boundary: salesperson cannot access
    console.log('enterprise-ai-http.spec: checking salesperson role block')
    const salesBlocked = await getJson('/api/enterprise-ai/context', salesUserToken)
    assert.equal(salesBlocked.status, 403, 'Salesperson should be blocked from enterprise-ai context')

    const simulationBlocked = await postJson('/api/enterprise-ai/simulations', {
      simulationType: 'EXPENSE_CAP',
      expenseCap: { capPercent: 10 },
    }, salesUserToken)
    assert.equal(simulationBlocked.status, 403, 'Salesperson should be blocked from enterprise-ai simulations')

    // Cross-tenant isolation: BUSINESS_ADMIN token scoped to enterprise tenant must ignore tenantId query override
    const forgedEnterpriseBusinessAdminToken = makeToken({
      userId: 'integration-enterprise-ba',
      email: 'enterprise.ba@test.local',
      role: 'BUSINESS_ADMIN',
      tenantId: fixture.enterpriseTenantId,
      subsidiaryId: null,
    })

    const scopedMetrics = await getJson(`/api/enterprise-ai/metrics?tenantId=${encodeURIComponent(String(fixture.nonEnterpriseTenantId))}`, forgedEnterpriseBusinessAdminToken)
    assert.equal(scopedMetrics.status, 200, 'Enterprise business admin token should access metrics')
    const scopedMetricsBody = await scopedMetrics.json() as { data: { tenantId: string } }
    assert.equal(scopedMetricsBody.data.tenantId, fixture.enterpriseTenantId, 'Metrics tenant scope must remain caller tenant for non-superadmin')

    const simulationAllowed = await postJson('/api/enterprise-ai/simulations', {
      simulationType: 'EXPENSE_CAP',
      horizonDays: 30,
      expenseCap: { capPercent: 12 },
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(simulationAllowed.status, 200, 'Enterprise business admin should run deterministic simulations')

    const actionRecommendation = await postJson('/api/enterprise-ai/recommendations', {
      recommendationType: 'BRANCH_PERFORMANCE',
      horizonDays: 30,
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(actionRecommendation.status, 201, 'Enterprise business admin should generate recommendation for action tracking')
    const actionRecommendationBody = await actionRecommendation.json() as { data: { id: string } }
    const trackedRecommendationId = actionRecommendationBody.data.id

    const actionCreateBlocked = await postJson('/api/enterprise-ai/actions', {
      recommendationId: trackedRecommendationId,
      expectedImpactScore: 32,
    }, salesUserToken)
    assert.equal(actionCreateBlocked.status, 403, 'Salesperson should be blocked from action tracker creation')

    const actionCreateAllowed = await postJson('/api/enterprise-ai/actions', {
      recommendationId: trackedRecommendationId,
      ownerUserId: 'integration-enterprise-ba',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      expectedImpactScore: 32,
      impactNotes: 'Protect branch margin over next week',
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(actionCreateAllowed.status, 201, 'Enterprise business admin should create action tracker')

    const actionUpdateAllowed = await patchJson(`/api/enterprise-ai/actions/${trackedRecommendationId}`, {
      status: 'IN_PROGRESS',
      progressNote: 'Manager started execution',
      realizedImpactScore: 11,
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(actionUpdateAllowed.status, 200, 'Enterprise business admin should update action tracker lifecycle')

    const actionListAllowed = await getJson('/api/enterprise-ai/actions?status=IN_PROGRESS&limit=20', forgedEnterpriseBusinessAdminToken)
    assert.equal(actionListAllowed.status, 200, 'Enterprise business admin should list action tracker items')
    const actionListBody = await actionListAllowed.json() as { data: { total: number; items: Array<{ recommendationId: string }> } }
    assert.ok(actionListBody.data.total >= 1, 'Action tracker list should return at least one item')
    assert.ok(actionListBody.data.items.some((item) => item.recommendationId === trackedRecommendationId), 'Tracked recommendation should appear in action list')

    const alertPolicyBlocked = await getJson('/api/enterprise-ai/alerts/policy', salesUserToken)
    assert.equal(alertPolicyBlocked.status, 403, 'Salesperson should be blocked from alert policy endpoint')

    const alertPolicyRead = await getJson('/api/enterprise-ai/alerts/policy', forgedEnterpriseBusinessAdminToken)
    assert.equal(alertPolicyRead.status, 200, 'Enterprise business admin should read alert policy')

    const alertPolicyUpdate = await patchJson('/api/enterprise-ai/alerts/policy', {
      minPriorityToNotify: 'P2',
      quietHoursStartUtc: 22,
      quietHoursEndUtc: 6,
      suppressAfterAckHours: 12,
      dedupeHoursByPriority: {
        P1: 1,
        P2: 4,
        P3: 12,
      },
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(alertPolicyUpdate.status, 200, 'Enterprise business admin should update alert policy')
    const alertPolicyUpdateBody = await alertPolicyUpdate.json() as { data: { policy: { minPriorityToNotify: string }; signalId: string | null; revisions: Array<{ id: string }> } }
    assert.equal(alertPolicyUpdateBody.data.policy.minPriorityToNotify, 'P2', 'Updated policy should be persisted')
    assert.ok((alertPolicyUpdateBody.data.revisions || []).length >= 1, 'Policy revisions should be returned')

    const alertPolicySecondUpdate = await patchJson('/api/enterprise-ai/alerts/policy', {
      minPriorityToNotify: 'P1',
      dedupeHoursByPriority: {
        P1: 2,
        P2: 6,
        P3: 16,
      },
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(alertPolicySecondUpdate.status, 200, 'Enterprise business admin should perform second policy update')
    const alertPolicySecondUpdateBody = await alertPolicySecondUpdate.json() as { data: { policy: { minPriorityToNotify: string }; revisions: Array<{ id: string }> } }
    assert.equal(alertPolicySecondUpdateBody.data.policy.minPriorityToNotify, 'P1', 'Second update should be active')

    const rollbackTarget = alertPolicySecondUpdateBody.data.revisions[1]?.id || alertPolicyUpdateBody.data.signalId
    assert.ok(Boolean(rollbackTarget), 'Rollback target should be available')

    const alertPolicyRollback = await patchJson('/api/enterprise-ai/alerts/policy', {
      restoreSignalId: rollbackTarget,
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(alertPolicyRollback.status, 200, 'Enterprise business admin should restore policy from history')
    const alertPolicyRollbackBody = await alertPolicyRollback.json() as { data: { policy: { minPriorityToNotify: string } } }
    assert.equal(alertPolicyRollbackBody.data.policy.minPriorityToNotify, 'P2', 'Rollback should restore previously selected revision')

    const schedulerUnauthorized = await postJson('/api/enterprise-ai/jobs/refresh', { dryRun: true }, undefined)
    assert.equal(schedulerUnauthorized.status, 401, 'Scheduler endpoint should require internal secret')

    const schedulerAuthorized = await postJson(
      '/api/enterprise-ai/jobs/refresh',
      { tenantLimit: 2, dryRun: true },
      undefined,
      { 'x-enterprise-job-secret': String(process.env.ENTERPRISE_AI_JOB_SECRET) },
    )
    assert.equal(schedulerAuthorized.status, 200, 'Scheduler endpoint should accept valid internal secret')

    // Sensitive anomaly visibility boundary
    const anomalyBlocked = await postJson('/api/enterprise-ai/recommendations', {
      recommendationType: 'ANOMALY_DETECTION',
    }, forgedEnterpriseBusinessAdminToken)
    assert.equal(anomalyBlocked.status, 403, 'Anomaly generation should be restricted to SUPER_ADMIN')

    console.log('enterprise-ai-http.spec: all assertions passed')
  } catch (err) {
    if (serverLogs.trim()) {
      console.error('enterprise-ai-http.spec: captured server logs')
      console.error(serverLogs)
    }
    throw err
  } finally {
    cleanup()
    await wait(1200)
    await prisma.$disconnect()
  }
}

run().catch((err) => {
  if (err instanceof Error) {
    console.error('enterprise-ai-http.spec failed', err.message)
    console.error(err.stack)
  } else {
    console.error('enterprise-ai-http.spec failed', err)
  }
  process.exit(1)
})
