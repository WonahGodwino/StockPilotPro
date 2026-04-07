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

async function postJson(path: string, body: unknown, token?: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
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
