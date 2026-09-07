import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const tenants = await p.tenant.findMany({ select: { id: true, name: true, slug: true } })
console.log(JSON.stringify(tenants, null, 2))
await p.$disconnect()
