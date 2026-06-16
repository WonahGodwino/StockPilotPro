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

const assistantLibraryRoute = require('../src/app/api/enterprise-ai/assistant-library/route') as {
  GET: (request: NextRequest) => Promise<Response>
  POST: (request: NextRequest) => Promise<Response>
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

function stubEnterpriseAccess() {
  stub(['subscription', 'updateMany'], async () => ({ count: 0 }))
  stub(['subscription', 'findFirst'], async () => ({
    id: 'sub-1',
    tenantId: 't1',
    planId: 'plan-1',
    status: 'ACTIVE',
    expiryDate: new Date('2099-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-04-14T00:00:00.000Z'),
    plan: {
      id: 'plan-1',
      name: 'Enterprise',
      features: ['ENTERPRISE_AI_ENABLED', 'AI_NATURAL_LANGUAGE_ASSISTANT'],
    },
  }))
}

async function testPostPersistsGroundingProvenance() {
  stubEnterpriseAccess()

  let capturedCreateArgs: any = null
  const auditWrites: any[] = []

  stub(['enterpriseAiRecommendation', 'create'], async (args: any) => {
    capturedCreateArgs = args
    return {
      id: 'saved-1',
      createdAt: new Date('2026-04-14T12:00:00.000Z'),
      outputPayload: args.data.outputPayload,
    }
  })
  stub(['auditLog', 'create'], async (args: any) => {
    auditWrites.push(args)
    return { id: 'audit-1' }
  })

  const token = makeToken({ tenantId: 't1', userId: 'user-1' })
  const response = await assistantLibraryRoute.POST(req('POST', 'http://localhost:3000/api/enterprise-ai/assistant-library', token, {
    prompt: 'Which branch needs discount controls?',
    response: 'Use internal fallback until the external contract is complete.',
    provider: 'openai',
    groundingSource: 'internal',
    externalData: {
      externalGroundingReady: false,
      contractIssues: [
        {
          entity: 'sales',
          missingMappings: ['branchName'],
          missingSchemaColumns: ['sales.branch_name'],
        },
      ],
    },
    conversationId: 'conv-1',
  }))

  assert.equal(response.status, 201)
  const payload = await readJson(response)
  assert.equal(payload.data.groundingSource, 'internal')
  assert.equal(payload.data.externalData.externalGroundingReady, false)
  assert.equal(payload.data.externalData.contractIssues.length, 1)
  assert.equal(capturedCreateArgs.data.outputPayload.groundingSource, 'internal')
  assert.equal(capturedCreateArgs.data.outputPayload.externalData.contractIssues[0].entity, 'sales')
  assert.equal(auditWrites.length, 1)
  assert.equal(auditWrites[0].data.action, 'ENTERPRISE_AI_ASSISTANT_SAVE')

  restoreAll()
}

async function testGetReturnsSavedGroundingProvenance() {
  stubEnterpriseAccess()

  stub(['enterpriseAiRecommendation', 'findMany'], async () => ([
    {
      id: 'saved-1',
      createdAt: new Date('2026-04-14T12:00:00.000Z'),
      outputPayload: {
        prompt: 'Check warehouse risk',
        response: 'Fallback stayed internal because product mappings are incomplete.',
        provider: 'anthropic',
        groundingSource: 'internal',
        externalData: {
          externalGroundingReady: false,
          contractIssues: [
            {
              entity: 'products',
              missingMappings: ['sku'],
              missingSchemaColumns: [],
            },
          ],
        },
        savedForLater: true,
      },
    },
    {
      id: 'skip-1',
      createdAt: new Date('2026-04-14T12:01:00.000Z'),
      outputPayload: {
        prompt: 'Ignore me',
        response: 'Not saved',
        savedForLater: false,
      },
    },
  ]))

  const token = makeToken({ tenantId: 't1' })
  const response = await assistantLibraryRoute.GET(req('GET', 'http://localhost:3000/api/enterprise-ai/assistant-library?limit=25', token))

  assert.equal(response.status, 200)
  const payload = await readJson(response)
  assert.equal(payload.data.length, 1)
  assert.equal(payload.data[0].provider, 'anthropic')
  assert.equal(payload.data[0].groundingSource, 'internal')
  assert.equal(payload.data[0].externalData.externalGroundingReady, false)
  assert.equal(payload.data[0].externalData.contractIssues[0].entity, 'products')

  restoreAll()
}

async function main() {
  console.log('enterprise-ai-assistant-library.spec: starting test suite')
  try {
    await testPostPersistsGroundingProvenance()
    await testGetReturnsSavedGroundingProvenance()
    console.log('enterprise-ai-assistant-library.spec: all assertions passed')
  } finally {
    restoreAll()
  }
}

main().catch((err) => {
  console.error('enterprise-ai-assistant-library.spec: failure')
  console.error(err)
  process.exit(1)
})
