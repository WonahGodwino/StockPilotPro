import assert from 'node:assert/strict'
import { spawn, type ChildProcess, execSync } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'

const PORT = 3312
const BASE_URL = `http://127.0.0.1:${PORT}`
const REQUEST_TIMEOUT_MS = 3000

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
  if (!secret) throw new Error('JWT_SECRET is not configured for workflow HTTP integration tests')
  return jwt.sign(payload, secret, { expiresIn: '10m' })
}

async function waitForServerReady(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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

  throw new Error('Timed out waiting for workflow HTTP server to become ready')
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

  const plan = await prisma.plan.upsert({
    where: { id: 'plan_test_enterprise_ai_workflows' },
    update: {
      name: 'Test Enterprise AI Workflows',
      maxSubsidiaries: 999999,
      features: {
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
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
      id: 'plan_test_enterprise_ai_workflows',
      name: 'Test Enterprise AI Workflows',
      description: 'Fixture plan for enterprise-ai-workflows-http.spec',
      price: 1999,
      maxSubsidiaries: 999999,
      extraSubsidiaryPrice: 0,
      features: {
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
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

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'integration-enterprise-ai-workflows' },
    update: { name: 'Integration Enterprise AI Workflows', archived: false, isActive: true },
    create: {
      slug: 'integration-enterprise-ai-workflows',
      name: 'Integration Enterprise AI Workflows',
      email: 'integration-enterprise-ai-workflows@example.com',
      isActive: true,
      archived: false,
    },
  })

  await prisma.subscription.upsert({
    where: { id: 'sub_test_enterprise_ai_workflows' },
    update: {
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 1999,
    },
    create: {
      id: 'sub_test_enterprise_ai_workflows',
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 1999,
    },
  })

  const primarySubsidiary = await prisma.subsidiary.upsert({
    where: { id: 'subsid_test_enterprise_ai_workflows_main' },
    update: {
      tenantId: tenant.id,
      name: 'Workflow Main Branch',
      archived: false,
      isActive: true,
    },
    create: {
      id: 'subsid_test_enterprise_ai_workflows_main',
      tenantId: tenant.id,
      name: 'Workflow Main Branch',
      isActive: true,
      archived: false,
    },
  })

  const priceTestProduct = await prisma.product.upsert({
    where: { id: 'product_test_enterprise_ai_workflows_price' },
    update: {
      tenantId: tenant.id,
      subsidiaryId: primarySubsidiary.id,
      name: 'Workflow Price Test Product',
      category: 'Integration',
      type: 'GOODS',
      unit: 'pcs',
      quantity: 45,
      costPrice: 60,
      sellingPrice: 100,
      lowStockThreshold: 8,
      status: 'ACTIVE',
      archived: false,
    },
    create: {
      id: 'product_test_enterprise_ai_workflows_price',
      tenantId: tenant.id,
      subsidiaryId: primarySubsidiary.id,
      name: 'Workflow Price Test Product',
      category: 'Integration',
      type: 'GOODS',
      unit: 'pcs',
      quantity: 45,
      costPrice: 60,
      sellingPrice: 100,
      lowStockThreshold: 8,
      status: 'ACTIVE',
      archived: false,
    },
  })

  return { tenantId: tenant.id, priceTestProductId: priceTestProduct.id }
}

async function run() {
  const nextBin = require.resolve('next/dist/bin/next')
  let childError: Error | null = null

  console.log('enterprise-ai-workflows-http.spec: building Next app for black-box test')
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

    console.log('enterprise-ai-workflows-http.spec: waiting for server readiness')
    await waitForServerReady(child)
    console.log('enterprise-ai-workflows-http.spec: server is ready')

    const fixture = await ensureEnterpriseFixtures()
    const adminToken = makeToken({
      userId: 'integration-workflow-admin',
      email: 'integration-workflow-admin@test.local',
      role: 'BUSINESS_ADMIN',
      tenantId: fixture.tenantId,
      subsidiaryId: null,
    })

    const approvalWorkflowName = `Integration Alert Approval Workflow ${Date.now()}`
    const createApprovalWorkflow = await postJson('/api/enterprise-ai/workflows', {
      action: 'create',
      parameters: {
        name: approvalWorkflowName,
        trigger: 'alert_notify_requires_approval',
        description: 'Integration workflow for approval-execution-rollback coverage',
        requiresApproval: true,
        maxCost: 100,
        priority: 150,
        steps: [
          { id: 'validate', type: 'condition', name: 'Validate input', onFailure: 'abort' },
          { id: 'review', type: 'human_approval', name: 'Request approval', onFailure: 'escalate' },
          { id: 'execute', type: 'api_call', name: 'Create alert notification', onFailure: 'abort' },
          { id: 'rollback', type: 'rollback', name: 'Undo alert notification', onFailure: 'escalate' },
          { id: 'audit', type: 'audit', name: 'Record audit trail', onFailure: 'continue' },
        ],
        rollbackSteps: [
          { id: 'undo-alert', type: 'rollback', name: 'Delete alert notification', onFailure: 'continue' },
        ],
      },
    }, adminToken)
    assert.equal(createApprovalWorkflow.status, 201, 'Approval workflow should be created')
    const createApprovalBody = await createApprovalWorkflow.json() as { data: { id: string } }
    const approvalWorkflowId = createApprovalBody.data.id

    const triggerApprovalWorkflow = await postJson('/api/enterprise-ai/workflows', {
      action: 'trigger',
      workflowId: approvalWorkflowId,
      parameters: {
        title: 'Integration approval alert',
        message: 'Approval path should create and then roll back this notification.',
      },
    }, adminToken)
    assert.equal(triggerApprovalWorkflow.status, 201, 'Approval workflow trigger should be created')
    const triggerApprovalBody = await triggerApprovalWorkflow.json() as { data: { id: string; status: string; approvalStatus: string } }
    assert.equal(triggerApprovalBody.data.status, 'pending_approval', 'Approval workflow should wait for approval')
    assert.equal(triggerApprovalBody.data.approvalStatus, 'pending', 'Approval workflow should be pending reviewer decision')
    const approvalExecutionId = triggerApprovalBody.data.id

    const pendingDashboard = await getJson('/api/enterprise-ai/workflows?limit=20', adminToken)
    assert.equal(pendingDashboard.status, 200, 'Workflow dashboard should load')
    const pendingDashboardBody = await pendingDashboard.json() as { data: { pendingApprovals: Array<{ id: string }> } }
    assert.ok(pendingDashboardBody.data.pendingApprovals.some((item) => item.id === approvalExecutionId), 'Pending dashboard should include triggered approval workflow')

    const approveExecution = await patchJson('/api/enterprise-ai/workflows', {
      executionId: approvalExecutionId,
      approved: true,
      notes: 'Approve workflow during integration test',
    }, adminToken)
    assert.equal(approveExecution.status, 200, 'Approved workflow should execute successfully')
    const approvedBody = await approveExecution.json() as {
      data: {
        id: string
        status: string
        approvalStatus: string
        result: {
          operation?: string
          notificationId?: string
          actualImpact?: number
          measuredAt?: string
          rollbackReady?: boolean
        }
      }
    }
    assert.equal(approvedBody.data.id, approvalExecutionId)
    assert.equal(approvedBody.data.status, 'executed', 'Approved workflow should transition to executed')
    assert.equal(approvedBody.data.approvalStatus, 'approved', 'Approved workflow should record approval state')
    assert.equal(approvedBody.data.result.operation, 'send_alert', 'Alert workflow should resolve to send_alert operation')
    assert.equal(typeof approvedBody.data.result.actualImpact, 'number', 'Executed workflow should record actual impact')
    assert.ok(Boolean(approvedBody.data.result.measuredAt), 'Executed workflow should record measurement timestamp')
    assert.equal(approvedBody.data.result.rollbackReady, true, 'Executed workflow should expose rollback readiness')
    assert.ok(Boolean(approvedBody.data.result.notificationId), 'Executed workflow should expose created notification id')

    const notificationId = String(approvedBody.data.result.notificationId)
    const createdNotification = await prisma.notification.findUnique({ where: { id: notificationId } })
    assert.ok(createdNotification, 'Executed workflow should create a notification')

    const rollbackExecution = await patchJson('/api/enterprise-ai/workflows', {
      action: 'rollback',
      executionId: approvalExecutionId,
      notes: 'Rollback during integration test',
    }, adminToken)
    assert.equal(rollbackExecution.status, 200, 'Workflow rollback should succeed')
    const rollbackBody = await rollbackExecution.json() as { data: { status: string; result: { rolledBackAt?: string } } }
    assert.equal(rollbackBody.data.status, 'rolled_back', 'Rolled back workflow should transition to rolled_back')
    assert.ok(Boolean(rollbackBody.data.result.rolledBackAt), 'Rolled back workflow should record rollback timestamp')

    const deletedNotification = await prisma.notification.findUnique({ where: { id: notificationId } })
    assert.equal(deletedNotification, null, 'Rollback should remove the created notification')

    const autoWorkflowName = `Integration Alert Auto Workflow ${Date.now()}`
    const createAutoWorkflow = await postJson('/api/enterprise-ai/workflows', {
      action: 'create',
      parameters: {
        name: autoWorkflowName,
        trigger: 'alert_notify_auto_execute',
        description: 'Integration workflow for immediate execution coverage',
        requiresApproval: false,
        maxCost: 50,
        priority: 90,
        steps: [
          { id: 'validate', type: 'condition', name: 'Validate input', onFailure: 'abort' },
          { id: 'execute', type: 'api_call', name: 'Create alert notification', onFailure: 'abort' },
          { id: 'audit', type: 'audit', name: 'Record audit trail', onFailure: 'continue' },
        ],
      },
    }, adminToken)
    assert.equal(createAutoWorkflow.status, 201, 'Auto workflow should be created')
    const createAutoBody = await createAutoWorkflow.json() as { data: { id: string } }

    const triggerAutoWorkflow = await postJson('/api/enterprise-ai/workflows', {
      action: 'trigger',
      workflowId: createAutoBody.data.id,
      parameters: {
        title: 'Integration auto alert',
        message: 'Auto-execute workflow should complete immediately.',
      },
    }, adminToken)
    assert.equal(triggerAutoWorkflow.status, 201, 'Auto workflow trigger should succeed')
    const triggerAutoBody = await triggerAutoWorkflow.json() as { data: { status: string; approvalStatus: string; result: { operation?: string; notificationId?: string; measuredAt?: string } } }
    assert.equal(triggerAutoBody.data.status, 'executed', 'Non-approval workflow should execute immediately')
    assert.equal(triggerAutoBody.data.approvalStatus, 'not_required', 'Non-approval workflow should remain not_required')
    assert.equal(triggerAutoBody.data.result.operation, 'send_alert', 'Immediate execution workflow should resolve to send_alert')
    assert.ok(Boolean(triggerAutoBody.data.result.measuredAt), 'Immediate execution workflow should include measurement timestamp')
    assert.ok(Boolean(triggerAutoBody.data.result.notificationId), 'Immediate execution workflow should create a notification')

    const priceWorkflowName = `Integration Price Workflow ${Date.now()}`
    const createPriceWorkflow = await postJson('/api/enterprise-ai/workflows', {
      action: 'create',
      parameters: {
        name: priceWorkflowName,
        trigger: 'pricing_adjustment_requires_approval',
        description: 'Integration workflow for real product price mutation coverage',
        requiresApproval: true,
        maxCost: 500,
        priority: 220,
        steps: [
          { id: 'validate', type: 'condition', name: 'Validate pricing request', onFailure: 'abort' },
          { id: 'review', type: 'human_approval', name: 'Approve price change', onFailure: 'escalate' },
          { id: 'execute', type: 'api_call', name: 'Update product price', onFailure: 'abort' },
          { id: 'rollback', type: 'rollback', name: 'Restore previous price', onFailure: 'escalate' },
          { id: 'audit', type: 'audit', name: 'Record pricing audit', onFailure: 'continue' },
        ],
        rollbackSteps: [
          { id: 'restore-price', type: 'rollback', name: 'Restore prior selling price', onFailure: 'continue' },
        ],
      },
    }, adminToken)
    assert.equal(createPriceWorkflow.status, 201, 'Price adjustment workflow should be created')
    const createPriceBody = await createPriceWorkflow.json() as { data: { id: string } }

    const triggerPriceWorkflow = await postJson('/api/enterprise-ai/workflows', {
      action: 'trigger',
      workflowId: createPriceBody.data.id,
      parameters: {
        productId: fixture.priceTestProductId,
        targetPrice: 115,
        actionText: 'Raise the product price based on branch-level margin pressure.',
      },
    }, adminToken)
    assert.equal(triggerPriceWorkflow.status, 201, 'Price workflow trigger should be created')
    const triggerPriceBody = await triggerPriceWorkflow.json() as { data: { id: string; status: string; approvalStatus: string } }
    assert.equal(triggerPriceBody.data.status, 'pending_approval', 'Price workflow should require approval')

    const approvePriceWorkflow = await patchJson('/api/enterprise-ai/workflows', {
      executionId: triggerPriceBody.data.id,
      approved: true,
      notes: 'Approve price update during integration test',
    }, adminToken)
    assert.equal(approvePriceWorkflow.status, 200, 'Approved price workflow should execute')
    const approvePriceBody = await approvePriceWorkflow.json() as {
      data: {
        status: string
        approvalStatus: string
        result: {
          operation?: string
          productId?: string
          previousPrice?: number
          newPrice?: number
          actualImpact?: number
          rollbackReady?: boolean
        }
      }
    }
    assert.equal(approvePriceBody.data.status, 'executed', 'Price workflow should execute after approval')
    assert.equal(approvePriceBody.data.approvalStatus, 'approved', 'Price workflow should record approval state')
    assert.equal(approvePriceBody.data.result.operation, 'adjust_price', 'Price workflow should resolve to adjust_price')
    assert.equal(approvePriceBody.data.result.productId, fixture.priceTestProductId, 'Price workflow should target the seeded product')
    assert.equal(approvePriceBody.data.result.previousPrice, 100, 'Price workflow should capture previous price')
    assert.equal(approvePriceBody.data.result.newPrice, 115, 'Price workflow should capture new price')
    assert.equal(approvePriceBody.data.result.rollbackReady, true, 'Price workflow should expose rollback readiness')

    const updatedProduct = await prisma.product.findUnique({ where: { id: fixture.priceTestProductId } })
    assert.equal(Number(updatedProduct?.sellingPrice || 0), 115, 'Price workflow should mutate the product selling price')

    const rollbackPriceWorkflow = await patchJson('/api/enterprise-ai/workflows', {
      action: 'rollback',
      executionId: triggerPriceBody.data.id,
      notes: 'Rollback price update during integration test',
    }, adminToken)
    assert.equal(rollbackPriceWorkflow.status, 200, 'Price workflow rollback should succeed')
    const rollbackPriceBody = await rollbackPriceWorkflow.json() as { data: { status: string; result: { rolledBackAt?: string } } }
    assert.equal(rollbackPriceBody.data.status, 'rolled_back', 'Rolled-back price workflow should transition to rolled_back')
    assert.ok(Boolean(rollbackPriceBody.data.result.rolledBackAt), 'Price workflow rollback should record rollback time')

    const restoredProduct = await prisma.product.findUnique({ where: { id: fixture.priceTestProductId } })
    assert.equal(Number(restoredProduct?.sellingPrice || 0), 100, 'Price workflow rollback should restore the original selling price')

    console.log('enterprise-ai-workflows-http.spec: all assertions passed')
  } catch (err) {
    if (serverLogs.trim()) {
      console.error('enterprise-ai-workflows-http.spec: captured server logs')
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
    console.error('enterprise-ai-workflows-http.spec failed', err.message)
    console.error(err.stack)
  } else {
    console.error('enterprise-ai-workflows-http.spec failed', err)
  }
  process.exit(1)
})