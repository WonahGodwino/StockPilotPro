import { strict as assert } from 'assert'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret'
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret'

type Role = 'SUPER_ADMIN' | 'BUSINESS_ADMIN' | 'SALESPERSON' | 'AGENT'

type TokenArgs = {
  role?: Role
  tenantId?: string | null
  subsidiaryId?: string | null
  userId?: string
}

function makeToken(args: TokenArgs = {}): string {
  const payload = {
    userId: args.userId || 'u1',
    email: 'tester@stockpilot.dev',
    role: args.role || 'BUSINESS_ADMIN',
    tenantId: args.tenantId === undefined ? 't1' : args.tenantId,
    subsidiaryId: args.subsidiaryId === undefined ? 's1' : args.subsidiaryId,
  }
  return jwt.sign(payload, process.env.JWT_SECRET as string)
}

function req(method: string, url: string, token?: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const prismaAny = prisma as any

type Restorer = () => void
const restorers: Restorer[] = []

function stub(path: string[], value: unknown) {
  let obj: any = prismaAny
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    if (!obj[key]) obj[key] = {}
    obj = obj[key]
  }
  const leaf = path[path.length - 1]
  const prev = obj[leaf]
  obj[leaf] = value
  restorers.push(() => {
    obj[leaf] = prev
  })
}

function restoreAll() {
  while (restorers.length) {
    const fn = restorers.pop()!
    fn()
  }
}

const customersRoute = require('../src/app/api/customers/route') as {
  GET: (request: NextRequest) => Promise<Response>
  POST: (request: NextRequest) => Promise<Response>
}
const customerDetailRoute = require('../src/app/api/customers/[id]/route') as {
  GET: (request: NextRequest, context: { params: { id: string } }) => Promise<Response>
}
const loyaltyRoute = require('../src/app/api/customers/[id]/loyalty/route') as {
  POST: (request: NextRequest, context: { params: { id: string } }) => Promise<Response>
}
const salesRoute = require('../src/app/api/sales/route') as {
  POST: (request: NextRequest) => Promise<Response>
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

async function testCustomerAuthAndValidation() {
  // Unauthorized should return 401 (not 500)
  {
    const response = await customersRoute.GET(req('GET', 'http://localhost:3000/api/customers'))
    assert.equal(response.status, 401)
  }

  // AGENT role should be forbidden on customer create
  {
    const token = makeToken({ role: 'AGENT', tenantId: 't1' })
    const response = await customersRoute.POST(
      req('POST', 'http://localhost:3000/api/customers', token, { name: 'Alice' }),
    )
    assert.equal(response.status, 403)
  }

  // Invalid email should fail schema validation
  {
    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1' })
    const response = await customersRoute.POST(
      req('POST', 'http://localhost:3000/api/customers', token, { name: 'Alice', email: 'bad-email' }),
    )
    assert.equal(response.status, 422)
  }

  // SUPER_ADMIN tenant scoping should honor tenantId query parameter
  {
    let capturedTenantId: string | null = null
    stub(['customer', 'findMany'], async (args: any) => {
      capturedTenantId = args.where.tenantId
      return []
    })
    stub(['customer', 'count'], async () => 0)

    const token = makeToken({ role: 'SUPER_ADMIN', tenantId: null, subsidiaryId: null })
    const response = await customersRoute.GET(
      req('GET', 'http://localhost:3000/api/customers?tenantId=t-scope', token),
    )
    assert.equal(response.status, 200)
    assert.equal(capturedTenantId, 't-scope')
    restoreAll()
  }
}

async function testLoyaltyBalanceFloorRules() {
  // Redeem above balance should be blocked
  {
    stub(['customer', 'findFirst'], async () => ({ id: 'c1', loyaltyPoints: 10, tenantId: 't1', archived: false }))
    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1' })
    const response = await loyaltyRoute.POST(
      req('POST', 'http://localhost:3000/api/customers/c1/loyalty', token, {
        type: 'REDEEM',
        points: 20,
      }),
      { params: { id: 'c1' } },
    )
    assert.equal(response.status, 422)
    const payload = await readJson(response)
    assert.equal(payload.error, 'Insufficient loyalty points')
    restoreAll()
  }

  // ADJUST negative beyond floor should be blocked
  {
    stub(['customer', 'findFirst'], async () => ({ id: 'c1', loyaltyPoints: 5, tenantId: 't1', archived: false }))
    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1' })
    const response = await loyaltyRoute.POST(
      req('POST', 'http://localhost:3000/api/customers/c1/loyalty', token, {
        type: 'ADJUST',
        points: -9,
      }),
      { params: { id: 'c1' } },
    )
    assert.equal(response.status, 422)
    const payload = await readJson(response)
    assert.equal(payload.error, 'Resulting balance would be negative')
    restoreAll()
  }

  // Valid redeem should write ledger with negative delta and new balance
  {
    const updates: any[] = []
    const ledgers: any[] = []

    stub(['customer', 'findFirst'], async () => ({ id: 'c1', loyaltyPoints: 12, tenantId: 't1', archived: false }))
    stub(['customer', 'update'], async (args: any) => {
      updates.push(args)
      return { id: 'c1', loyaltyPoints: 7 }
    })
    stub(['loyaltyLedger', 'create'], async (args: any) => {
      ledgers.push(args)
      return { id: 'l1' }
    })
    stub(['$transaction'], async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as () => Promise<unknown>)()
      }
      return Promise.all(arg as Array<Promise<unknown>>)
    })

    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1' })
    const response = await loyaltyRoute.POST(
      req('POST', 'http://localhost:3000/api/customers/c1/loyalty', token, {
        type: 'REDEEM',
        points: 5,
        note: 'Cashback promo redemption',
      }),
      { params: { id: 'c1' } },
    )
    assert.equal(response.status, 200)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].data.loyaltyPoints, 7)
    assert.equal(ledgers.length, 1)
    assert.equal(ledgers[0].data.points, -5)
    assert.equal(ledgers[0].data.balanceBefore, 12)
    assert.equal(ledgers[0].data.balanceAfter, 7)
    restoreAll()
  }
}

async function testSaleLinkedAccrualEdgeCases() {
  const basePayload = {
    subsidiaryId: 's1',
    items: [{ productId: 'p1', quantity: 1, unitPrice: 10.75, costPrice: 4, discount: 0 }],
    discount: 0,
    paymentMethod: 'CASH',
    amountPaid: 10.75,
    currency: 'USD',
    fxRate: 1,
  }

  // Invalid customerId should be rejected explicitly
  {
    stub(['subsidiary', 'findFirst'], async () => ({ id: 's1' }))
    stub(['sale', 'findFirst'], async () => null)
    stub(['product', 'findMany'], async () => [{ id: 'p1', type: 'GOODS', quantity: 99, name: 'Widget' }])
    stub(['customer', 'findFirst'], async () => null)

    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1', subsidiaryId: null })
    const response = await salesRoute.POST(
      req('POST', 'http://localhost:3000/api/sales', token, { ...basePayload, customerId: 'missing' }),
    )
    assert.equal(response.status, 422)
    const payload = await readJson(response)
    assert.equal(payload.error, 'Customer not found')
    restoreAll()
  }

  // Positive sale amount should earn floor(total) points and create ledger
  {
    const customerUpdates: any[] = []
    const ledgerEntries: any[] = []

    stub(['subsidiary', 'findFirst'], async () => ({ id: 's1' }))
    stub(['sale', 'findFirst'], async () => null)
    stub(['product', 'findMany'], async (args: any) => {
      if (args?.where?.id) {
        return [{ id: 'p1', type: 'GOODS', quantity: 99, name: 'Widget', status: 'ACTIVE' }]
      }
      return []
    })
    stub(['notification', 'findFirst'], async () => ({ id: 'n1' }))
    stub(['notification', 'create'], async () => ({ id: 'n1' }))
    stub(['auditLog', 'create'], async () => ({ id: 'a1' }))
    stub(['customer', 'findFirst'], async (args: any) => {
      if (args?.select?.id) return { id: 'c1' }
      return { loyaltyPoints: 4 }
    })

    const tx = {
      sale: {
        count: async () => 0,
        create: async (_args: any) => ({ id: 'sale-1', receiptNumber: 'RCP-20260412-00001', items: [], user: { firstName: 'A', lastName: 'B' } }),
      },
      product: { update: async () => ({}) },
      customer: {
        findFirst: async () => ({ loyaltyPoints: 4 }),
        update: async (args: any) => {
          customerUpdates.push(args)
          return { id: 'c1' }
        },
      },
      loyaltyLedger: {
        create: async (args: any) => {
          ledgerEntries.push(args)
          return { id: 'l1' }
        },
      },
    }
    stub(['$transaction'], async (cb: (client: any) => Promise<unknown>) => cb(tx))

    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1', subsidiaryId: null })
    const response = await salesRoute.POST(
      req('POST', 'http://localhost:3000/api/sales', token, { ...basePayload, customerId: 'c1' }),
    )
    assert.equal(response.status, 201)
    assert.equal(customerUpdates.length, 1)
    assert.equal(customerUpdates[0].data.loyaltyPoints, 14) // floor(10.75) = 10
    assert.equal(ledgerEntries.length, 1)
    assert.equal(ledgerEntries[0].data.points, 10)
    restoreAll()
  }

  // Zero-value sale should increment visit/spend but not create loyalty ledger
  {
    const customerUpdates: any[] = []
    const ledgerEntries: any[] = []

    stub(['subsidiary', 'findFirst'], async () => ({ id: 's1' }))
    stub(['sale', 'findFirst'], async () => null)
    stub(['product', 'findMany'], async (args: any) => {
      if (args?.where?.id) {
        return [{ id: 'p1', type: 'GOODS', quantity: 99, name: 'Widget', status: 'ACTIVE' }]
      }
      return []
    })
    stub(['notification', 'findFirst'], async () => ({ id: 'n1' }))
    stub(['notification', 'create'], async () => ({ id: 'n1' }))
    stub(['auditLog', 'create'], async () => ({ id: 'a1' }))
    stub(['customer', 'findFirst'], async (args: any) => {
      if (args?.select?.id) return { id: 'c1' }
      return { loyaltyPoints: 50 }
    })

    const tx = {
      sale: {
        count: async () => 0,
        create: async (_args: any) => ({ id: 'sale-2', receiptNumber: 'RCP-20260412-00002', items: [], user: { firstName: 'A', lastName: 'B' } }),
      },
      product: { update: async () => ({}) },
      customer: {
        findFirst: async () => ({ loyaltyPoints: 50 }),
        update: async (args: any) => {
          customerUpdates.push(args)
          return { id: 'c1' }
        },
      },
      loyaltyLedger: {
        create: async (args: any) => {
          ledgerEntries.push(args)
          return { id: 'l2' }
        },
      },
    }
    stub(['$transaction'], async (cb: (client: any) => Promise<unknown>) => cb(tx))

    const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1', subsidiaryId: null })
    const response = await salesRoute.POST(
      req('POST', 'http://localhost:3000/api/sales', token, {
        ...basePayload,
        amountPaid: 0,
        items: [{ productId: 'p1', quantity: 1, unitPrice: 0, costPrice: 0, discount: 0 }],
        customerId: 'c1',
      }),
    )
    assert.equal(response.status, 201)
    assert.equal(customerUpdates.length, 1)
    assert.equal(customerUpdates[0].data.loyaltyPoints, undefined)
    assert.equal(ledgerEntries.length, 0)
    restoreAll()
  }
}

async function testCustomerDetailPurchaseAndLedgerRead() {
  // Ensure the detail endpoint returns both history and ledger payloads for POS targeting use-cases
  stub(['customer', 'findFirst'], async () => ({
    id: 'c1',
    name: 'Ada',
    phone: null,
    email: null,
    address: null,
    notes: null,
    loyaltyPoints: 20,
    totalSpend: 120,
    visitCount: 3,
    lastVisitedAt: null,
    createdAt: new Date().toISOString(),
  }))
  stub(['sale', 'findMany'], async () => [
    {
      id: 'sale-1',
      receiptNumber: 'RCP-1',
      totalAmount: 42,
      currency: 'USD',
      paymentMethod: 'CASH',
      createdAt: new Date().toISOString(),
      items: [{ quantity: 1, unitPrice: 42, product: { name: 'Widget' } }],
    },
  ])
  stub(['loyaltyLedger', 'findMany'], async () => [
    {
      id: 'l1',
      type: 'EARN',
      points: 10,
      balanceBefore: 10,
      balanceAfter: 20,
      note: 'Earned',
      saleId: 'sale-1',
      createdAt: new Date().toISOString(),
    },
  ])

  const token = makeToken({ role: 'BUSINESS_ADMIN', tenantId: 't1' })
  const response = await customerDetailRoute.GET(
    req('GET', 'http://localhost:3000/api/customers/c1', token),
    { params: { id: 'c1' } },
  )
  assert.equal(response.status, 200)
  const payload = await readJson(response)
  assert.equal(Array.isArray(payload.data.purchaseHistory), true)
  assert.equal(Array.isArray(payload.data.loyaltyLedger), true)
  assert.equal(payload.data.purchaseHistory.length, 1)
  assert.equal(payload.data.loyaltyLedger.length, 1)

  restoreAll()
}

async function run() {
  await testCustomerAuthAndValidation()
  await testLoyaltyBalanceFloorRules()
  await testSaleLinkedAccrualEdgeCases()
  await testCustomerDetailPurchaseAndLedgerRead()
  console.log('customer-loyalty.spec: all assertions passed')
}

run().catch((err) => {
  console.error('customer-loyalty.spec failed')
  console.error(err)
  process.exit(1)
})
