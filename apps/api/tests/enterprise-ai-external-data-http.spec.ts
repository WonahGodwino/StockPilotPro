import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'

const PORT = 3314
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
  if (!secret) throw new Error('JWT_SECRET is not configured for external-data HTTP integration tests')
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

  throw new Error('Timed out waiting for external-data HTTP server to become ready')
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

async function deleteJson(path: string, token: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
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
    where: { id: 'plan_test_enterprise_ai_external_data' },
    update: {
      name: 'Test Enterprise AI External Data',
      maxSubsidiaries: 999999,
      features: {
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
        ENTERPRISE_AI_EXTERNAL_DATA: true,
        AI_NATURAL_LANGUAGE_ASSISTANT: true,
      },
      isActive: true,
    },
    create: {
      id: 'plan_test_enterprise_ai_external_data',
      name: 'Test Enterprise AI External Data',
      description: 'Fixture plan for enterprise-ai-external-data-http.spec',
      price: 2499,
      maxSubsidiaries: 999999,
      extraSubsidiaryPrice: 0,
      features: {
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
        ENTERPRISE_AI_EXTERNAL_DATA: true,
        AI_NATURAL_LANGUAGE_ASSISTANT: true,
      },
      isActive: true,
    },
  })

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'integration-enterprise-ai-external-data' },
    update: { name: 'Integration Enterprise AI External Data', archived: false, isActive: true },
    create: {
      slug: 'integration-enterprise-ai-external-data',
      name: 'Integration Enterprise AI External Data',
      email: 'integration-enterprise-ai-external-data@example.com',
      isActive: true,
      archived: false,
    },
  })

  await prisma.subscription.upsert({
    where: { id: 'sub_test_enterprise_ai_external_data' },
    update: {
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 2499,
    },
    create: {
      id: 'sub_test_enterprise_ai_external_data',
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      startDate: now,
      expiryDate: nextYear,
      amount: 2499,
    },
  })

  await prisma.enterpriseAiExternalDataConnection.deleteMany({
    where: { tenantId: tenant.id },
  })

  return { tenant }
}

async function main() {
  const { tenant } = await ensureEnterpriseFixtures()
  const token = makeToken({
    userId: 'user_test_enterprise_ai_external_data',
    email: 'enterprise-ai-external-data@example.com',
    role: 'BUSINESS_ADMIN',
    tenantId: tenant.id,
    subsidiaryId: null,
  })

  const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })

  server.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServerReady(server)

    const initialStatusRes = await getJson('/api/enterprise-ai/external-data', token)
    assert.equal(initialStatusRes.status, 200)
    const initialStatus = await initialStatusRes.json()
    assert.equal(initialStatus.data, null)

    await prisma.enterpriseAiExternalDataConnection.create({
      data: {
        tenantId: tenant.id,
        providerType: 'postgresql',
        connectionName: 'Fixture External Data',
        host: 'db.example.local',
        port: 5432,
        databaseName: 'tenant_reporting',
        schemaName: 'public',
        sslRequired: true,
        status: 'CONNECTED',
        validationState: 'DRAFT',
        encryptedCredentials: '{"fixture":true}',
        mappingConfig: {
          products: {
            table: 'products',
            columns: {
              id: 'id',
              name: 'name',
              category: 'category',
              costPrice: 'cost_price',
              sellingPrice: 'selling_price',
              currentStock: 'current_stock',
              branchId: 'branch_id',
            },
          },
        },
        schemaSnapshot: {
          tableCount: 1,
          tables: [
            {
              name: 'products',
              columns: [
                { name: 'id', dataType: 'uuid', nullable: false },
                { name: 'name', dataType: 'text', nullable: false },
                { name: 'category', dataType: 'text', nullable: true },
                { name: 'cost_price', dataType: 'numeric', nullable: false },
                { name: 'selling_price', dataType: 'numeric', nullable: false },
                { name: 'current_stock', dataType: 'numeric', nullable: false },
                { name: 'branch_id', dataType: 'uuid', nullable: true },
              ],
            },
          ],
        },
        lastHealthStatus: 'HEALTHY',
        lastHealthAt: new Date(),
        groundingEnabled: false,
        isActive: true,
        createdBy: 'user_test_enterprise_ai_external_data',
        updatedBy: 'user_test_enterprise_ai_external_data',
      },
    })

    const statusRes = await getJson('/api/enterprise-ai/external-data', token)
    assert.equal(statusRes.status, 200)
    const statusPayload = await statusRes.json()
    assert.equal(statusPayload.data.providerType, 'postgresql')
    assert.equal(statusPayload.data.host, 'db.example.local')
    assert.equal(statusPayload.data.hasStoredCredentials, true)
    assert.equal(statusPayload.data.encryptedCredentials, undefined)
    assert.equal(statusPayload.data.contractIssues.length, 1)
    assert.equal(statusPayload.data.contractIssues[0].entity, 'products')
    assert.deepEqual(statusPayload.data.contractIssues[0].missingMappings, ['lowStockThreshold'])

    const contextRes = await getJson('/api/enterprise-ai/context', token)
    assert.equal(contextRes.status, 200)
    const contextPayload = await contextRes.json()
    assert.equal(contextPayload.data.providerContext.source, 'internal')
    assert.equal(contextPayload.data.externalData.providerType, 'postgresql')
    assert.equal(contextPayload.data.providerContext.externalGroundingReady, false)

    await prisma.enterpriseAiExternalDataConnection.updateMany({
      where: { tenantId: tenant.id, isActive: true },
      data: {
        status: 'VALIDATED',
        validationState: 'VALIDATED',
        groundingEnabled: true,
      },
    })

    const invalidValidatedContextRes = await getJson('/api/enterprise-ai/context', token)
    assert.equal(invalidValidatedContextRes.status, 200)
    const invalidValidatedContextPayload = await invalidValidatedContextRes.json()
    assert.equal(invalidValidatedContextPayload.data.providerContext.source, 'internal')
    assert.equal(invalidValidatedContextPayload.data.providerContext.externalGroundingReady, false)
    assert.equal(invalidValidatedContextPayload.data.externalData.contractIssues.length, 1)

    await prisma.enterpriseAiExternalDataConnection.updateMany({
      where: { tenantId: tenant.id, isActive: true },
      data: {
        mappingConfig: {
          sales: { table: 'sales', columns: { id: 'id', date: 'created_at', totalAmount: 'total_amount', currency: 'currency', branchId: 'branch_id' } },
          saleItems: { table: 'sale_items', columns: { saleId: 'sale_id', productId: 'product_id', quantity: 'quantity', subtotal: 'subtotal' } },
          expenses: { table: 'expenses', columns: { date: 'expense_date', amount: 'amount', category: 'category', title: 'title', branchId: 'branch_id' } },
          products: { table: 'products', columns: { id: 'id', name: 'name', category: 'category', costPrice: 'cost_price', sellingPrice: 'selling_price', currentStock: 'current_stock', lowStockThreshold: 'low_stock_threshold', branchId: 'branch_id' } },
          inventory: { table: 'inventory', columns: { productId: 'product_id', quantity: 'quantity', branchId: 'branch_id' } },
          branches: { table: 'branches', columns: { id: 'id', name: 'name' } },
        },
        schemaSnapshot: {
          tableCount: 6,
          tables: [
            { name: 'sales', columns: [{ name: 'id' }, { name: 'created_at' }, { name: 'total_amount' }, { name: 'currency' }, { name: 'branch_id' }] },
            { name: 'sale_items', columns: [{ name: 'sale_id' }, { name: 'product_id' }, { name: 'quantity' }, { name: 'subtotal' }] },
            { name: 'expenses', columns: [{ name: 'expense_date' }, { name: 'amount' }, { name: 'category' }, { name: 'title' }, { name: 'branch_id' }] },
            { name: 'products', columns: [{ name: 'id' }, { name: 'name' }, { name: 'category' }, { name: 'cost_price' }, { name: 'selling_price' }, { name: 'current_stock' }, { name: 'low_stock_threshold' }, { name: 'branch_id' }] },
            { name: 'inventory', columns: [{ name: 'product_id' }, { name: 'quantity' }, { name: 'branch_id' }] },
            { name: 'branches', columns: [{ name: 'id' }, { name: 'name' }] },
          ],
        },
      },
    })

    const validatedContextRes = await getJson('/api/enterprise-ai/context', token)
    assert.equal(validatedContextRes.status, 200)
    const validatedContextPayload = await validatedContextRes.json()
    assert.equal(validatedContextPayload.data.providerContext.source, 'external')
    assert.equal(validatedContextPayload.data.providerContext.externalGroundingReady, true)
    assert.deepEqual(validatedContextPayload.data.externalData.contractIssues, [])

    const deleteRes = await deleteJson('/api/enterprise-ai/external-data', token)
    assert.equal(deleteRes.status, 200)
    const deletePayload = await deleteRes.json()
    assert.equal(deletePayload.data.status, 'DISABLED')
    assert.equal(deletePayload.data.isActive, false)

    const finalStatusRes = await getJson('/api/enterprise-ai/external-data', token)
    assert.equal(finalStatusRes.status, 200)
    const finalStatus = await finalStatusRes.json()
    assert.equal(finalStatus.data, null)

    console.log('enterprise-ai-external-data-http.spec: ok')
  } finally {
    server.kill('SIGTERM')
    await prisma.enterpriseAiExternalDataConnection.deleteMany({
      where: { tenantId: tenant.id },
    })
    await prisma.subscription.deleteMany({ where: { id: 'sub_test_enterprise_ai_external_data' } })
    await prisma.tenant.deleteMany({ where: { id: tenant.id } })
    await prisma.plan.deleteMany({ where: { id: 'plan_test_enterprise_ai_external_data' } })
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
