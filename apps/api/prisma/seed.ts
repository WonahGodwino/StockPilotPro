import { PrismaClient, UserRole, SubscriptionStatus, ProductType, ProductStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// Get directory name in ES module
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env from the nearest likely project root.
const envCandidates = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env'),
]
const envPath = envCandidates.find((p) => fs.existsSync(p))

if (envPath) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  })
}

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ── Plans ──────────────────────────────────────────────
  const starterPlan = await prisma.plan.upsert({
    where: { id: 'plan_starter' },
    update: {},
    create: {
      id: 'plan_starter',
      name: 'Starter',
      description: 'Perfect for small businesses',
      price: 99.99,
      maxSubsidiaries: 1,
      extraSubsidiaryPrice: 29.99,
      features: { reports: true, export: false, multiCurrency: false },
      isActive: true,
    },
  })

  const growthPlan = await prisma.plan.upsert({
    where: { id: 'plan_growth' },
    update: {},
    create: {
      id: 'plan_growth',
      name: 'Growth',
      description: 'Scale with multiple branches',
      price: 249.99,
      maxSubsidiaries: 5,
      extraSubsidiaryPrice: 19.99,
      features: { reports: true, export: true, multiCurrency: false },
      isActive: true,
    },
  })

  const enterprisePlan = await prisma.plan.upsert({
    where: { id: 'plan_enterprise' },
    update: {
      name: 'Enterprise',
      description: 'AI-powered operations with unlimited scale',
      price: 599.99,
      maxSubsidiaries: 999999,
      extraSubsidiaryPrice: 0,
      features: {
        reports: true,
        export: true,
        multiCurrency: true,
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
        UNLIMITED_BRANCHES: true,
        UNLIMITED_SALESPERSONS: true,
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
      id: 'plan_enterprise',
      name: 'Enterprise',
      description: 'AI-powered operations with unlimited scale',
      price: 599.99,
      maxSubsidiaries: 999999,
      extraSubsidiaryPrice: 0,
      features: {
        reports: true,
        export: true,
        multiCurrency: true,
        ENTERPRISE_PACKAGE: true,
        ENTERPRISE_AI_ENABLED: true,
        UNLIMITED_BRANCHES: true,
        UNLIMITED_SALESPERSONS: true,
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

  console.log('✅ Plans created')

  // ── Common Test Password ──────────────────────────────
  const testPassword = await bcrypt.hash('Test@123', 12)

  // ── StockPilot Pro (Main Company) ───────────────────────
  const mainTenant = await prisma.tenant.upsert({
    where: { slug: 'stockpilot-pro' },
    update: {},
    create: {
      name: 'StockPilot Pro',
      slug: 'stockpilot-pro',
      email: 'admin@stockpilotpro.com',
      phone: '+1-555-0000',
      isActive: true,
    },
  })

  // ── Super Admin ────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'superadmin@stockpilot.pro' },
    update: {
      tenantId: mainTenant.id,
      password: testPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
    create: {
      tenantId: mainTenant.id,
      email: 'superadmin@stockpilot.pro',
      password: testPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  })
  console.log('✅ Super Admin created: superadmin@stockpilot.pro (tenant: StockPilot Pro)')

  const businessAgent = await prisma.user.upsert({
    where: { email: 'agent@stockpilot.pro' },
    update: {
      tenantId: null,
      subsidiaryId: null,
      password: testPassword,
      firstName: 'Business',
      lastName: 'Agent',
      role: 'AGENT' as UserRole,
      isActive: true,
    },
    create: {
      tenantId: null,
      subsidiaryId: null,
      email: 'agent@stockpilot.pro',
      password: testPassword,
      firstName: 'Business',
      lastName: 'Agent',
      role: 'AGENT' as UserRole,
      isActive: true,
    },
  })
  console.log('✅ Agent created: agent@stockpilot.pro')

  // Subscription for main tenant
  const now = new Date()
  const nextYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
  await prisma.subscription.upsert({
    where: { id: 'sub_main' },
    update: {},
    create: {
      id: 'sub_main',
      tenantId: mainTenant.id,
      planId: enterprisePlan.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: now,
      expiryDate: nextYear,
      amount: enterprisePlan.price,
    },
  })

  console.log('✅ StockPilot Pro tenant & subscription created')

  // ── Demo Tenant ────────────────────────────────────────
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'demo-corp' },
    update: { acquisitionAgentId: businessAgent.id, baseCurrency: 'NGN' },
    create: {
      name: 'Demo Corporation',
      slug: 'demo-corp',
      email: 'info@democorp.com',
      phone: '+1-555-0100',
      isActive: true,
      baseCurrency: 'NGN',
      acquisitionAgentId: businessAgent.id,
    },
  })

  // Use the already-saved NGN/USD rate if one exists; only create a default if there's none.
  // Rate convention: fromCurrency=NGN, toCurrency=USD → how many USD per 1 NGN.
  const savedRate = await prisma.currencyRate.findFirst({
    where: { tenantId: demoTenant.id, fromCurrency: 'NGN', toCurrency: 'USD' },
    orderBy: { date: 'desc' },
  })

  let NGN_PER_USD: number
  if (savedRate) {
    // 1 NGN = savedRate.rate USD  →  1 USD = 1 / savedRate.rate NGN
    NGN_PER_USD = 1 / Number(savedRate.rate)
    console.log(`   ↳ Using saved NGN/USD rate: 1 USD = ₦${NGN_PER_USD.toFixed(2)}`)
  } else {
    NGN_PER_USD = 1600
    await prisma.currencyRate.create({
      data: {
        id: 'seed_rate_ngn_usd',
        tenantId: demoTenant.id,
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        rate: 1 / NGN_PER_USD,   // 0.000625
      },
    })
    console.log(`   ↳ No saved rate found – created default: 1 USD = ₦${NGN_PER_USD}`)
  }

  // Subscription for demo tenant
  await prisma.subscription.upsert({
    where: { id: 'sub_demo' },
    update: {
      planId: enterprisePlan.id,
      status: SubscriptionStatus.ACTIVE,
      amount: enterprisePlan.price,
      expiryDate: nextYear,
    },
    create: {
      id: 'sub_demo',
      tenantId: demoTenant.id,
      planId: enterprisePlan.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: now,
      expiryDate: nextYear,
      amount: enterprisePlan.price,
    },
  })

  // ── Demo Subsidiaries ──────────────────────────────────
  const headOffice = await prisma.subsidiary.upsert({
    where: { id: 'sub_hq' },
    update: {},
    create: {
      id: 'sub_hq',
      tenantId: demoTenant.id,
      name: 'Head Office',
      address: '123 Business Ave, Lagos',
      phone: '+1-555-0101',
      isActive: true,
    },
  })

  const branchLagos = await prisma.subsidiary.upsert({
    where: { id: 'sub_branch1' },
    update: {},
    create: {
      id: 'sub_branch1',
      tenantId: demoTenant.id,
      name: 'Lagos Branch',
      address: '45 Commerce Street, Lagos',
      phone: '+1-555-0102',
      isActive: true,
    },
  })

  console.log('✅ Demo tenant & subsidiaries created')

  // ── Demo Users (all with same Test@123 password) ────────
  await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {
      tenantId: demoTenant.id,
      subsidiaryId: headOffice.id,
      password: testPassword,
      firstName: 'Business',
      lastName: 'Admin',
      role: UserRole.BUSINESS_ADMIN,
      isActive: true,
    },
    create: {
      tenantId: demoTenant.id,
      subsidiaryId: headOffice.id,
      email: 'admin@demo.com',
      password: testPassword,
      firstName: 'Business',
      lastName: 'Admin',
      role: UserRole.BUSINESS_ADMIN,
      isActive: true,
    },
  })

  await prisma.user.upsert({
    where: { email: 'sales@demo.com' },
    update: {
      tenantId: demoTenant.id,
      subsidiaryId: headOffice.id,
      password: testPassword,
      firstName: 'John',
      lastName: 'Sales',
      role: UserRole.SALESPERSON,
      isActive: true,
    },
    create: {
      tenantId: demoTenant.id,
      subsidiaryId: headOffice.id,
      email: 'sales@demo.com',
      password: testPassword,
      firstName: 'John',
      lastName: 'Sales',
      role: UserRole.SALESPERSON,
      isActive: true,
    },
  })

  await prisma.user.upsert({
    where: { email: 'sales2@demo.com' },
    update: {
      tenantId: demoTenant.id,
      subsidiaryId: branchLagos.id,
      password: testPassword,
      firstName: 'Jane',
      lastName: 'Sales',
      role: UserRole.SALESPERSON,
      isActive: true,
    },
    create: {
      tenantId: demoTenant.id,
      subsidiaryId: branchLagos.id,
      email: 'sales2@demo.com',
      password: testPassword,
      firstName: 'Jane',
      lastName: 'Sales',
      role: UserRole.SALESPERSON,
      isActive: true,
    },
  })

  console.log('✅ Demo users created (all with password: Test@123)')
  console.log('   ├ superadmin@stockpilot.pro (SUPER_ADMIN)')
  console.log('   ├ admin@demo.com (BUSINESS_ADMIN)')
  console.log('   ├ sales@demo.com (SALESPERSON)')
  console.log('   └ sales2@demo.com (SALESPERSON - Lagos Branch)')

  // ── Demo Products ──────────────────────────────────────
  const products = [
    {
      id: 'prod_001',
      name: 'Wireless Keyboard',
      category: 'Accessories',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 50,
      originalCurrency: 'USD',
      originalCostPrice: 25.00,
      originalSellingPrice: 49.99,
      costPrice: 25.00 * NGN_PER_USD,
      sellingPrice: 49.99 * NGN_PER_USD,
      barcode: '8901234567001',
      lowStockThreshold: 10,
      purchaseDate: new Date('2026-01-10T00:00:00.000Z'),
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_002',
      name: 'USB-C Hub 7-in-1',
      category: 'Accessories',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 30,
      originalCurrency: 'USD',
      originalCostPrice: 18.00,
      originalSellingPrice: 39.99,
      costPrice: 18.00 * NGN_PER_USD,
      sellingPrice: 39.99 * NGN_PER_USD,
      barcode: '8901234567002',
      lowStockThreshold: 5,
      purchaseDate: new Date('2025-12-02T00:00:00.000Z'),
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_003',
      name: '27" Monitor',
      category: 'Displays',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 8,
      originalCurrency: 'USD',
      originalCostPrice: 180.00,
      originalSellingPrice: 299.99,
      costPrice: 180.00 * NGN_PER_USD,
      sellingPrice: 299.99 * NGN_PER_USD,
      barcode: '8901234567003',
      lowStockThreshold: 3,
      purchaseDate: new Date('2025-09-15T00:00:00.000Z'),
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_004',
      name: 'IT Support (per hour)',
      category: 'Services',
      type: ProductType.SERVICE,
      unit: 'hr',
      quantity: 999,
      originalCurrency: 'USD',
      originalCostPrice: 20.00,
      originalSellingPrice: 75.00,
      costPrice: 20.00 * NGN_PER_USD,
      sellingPrice: 75.00 * NGN_PER_USD,
      lowStockThreshold: 0,
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_005',
      name: 'Laptop Stand',
      category: 'Accessories',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 3,
      originalCurrency: 'USD',
      originalCostPrice: 12.00,
      originalSellingPrice: 24.99,
      costPrice: 12.00 * NGN_PER_USD,
      sellingPrice: 24.99 * NGN_PER_USD,
      barcode: '8901234567005',
      lowStockThreshold: 5,
      purchaseDate: new Date('2026-02-20T00:00:00.000Z'),
      status: ProductStatus.ACTIVE,
    },
  ]

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {
        ...p,
        tenantId: demoTenant.id,
        subsidiaryId: headOffice.id,
      },
      create: {
        ...p,
        tenantId: demoTenant.id,
        subsidiaryId: headOffice.id,
      },
    })

    if (p.type === ProductType.GOODS && p.quantity > 0 && p.purchaseDate) {
      await prisma.productReceipt.upsert({
        where: { id: `seed_receipt_${p.id}` },
        update: {
          tenantId: demoTenant.id,
          subsidiaryId: headOffice.id,
          productId: p.id,
          quantity: p.quantity,
          unitCost: p.costPrice,
          purchaseDate: p.purchaseDate,
          source: 'INITIAL_STOCK',
          isEstimated: false,
        },
        create: {
          id: `seed_receipt_${p.id}`,
          tenantId: demoTenant.id,
          subsidiaryId: headOffice.id,
          productId: p.id,
          quantity: p.quantity,
          unitCost: p.costPrice,
          purchaseDate: p.purchaseDate,
          source: 'INITIAL_STOCK',
          isEstimated: false,
        },
      })
    }
  }

  console.log('✅ Demo products created')

  // ── Demo Damage Records ────────────────────────────────
  const salesUser = await prisma.user.findUnique({
    where: { email: 'sales@demo.com' },
  })

  if (salesUser) {
    const wirelessKeyboard = await prisma.product.findUnique({ where: { id: 'prod_001' } })
    const usbHub = await prisma.product.findUnique({ where: { id: 'prod_002' } })

    if (wirelessKeyboard) {
      await prisma.damageRecord.create({
        data: {
          tenantId: demoTenant.id,
          subsidiaryId: headOffice.id,
          productId: wirelessKeyboard.id,
          userId: salesUser.id,
          quantity: 2,
          reason: 'DAMAGED',
          description: 'Defective units with broken keys',
          cost: 2 * 25.00 * NGN_PER_USD,
          date: new Date(),
          createdBy: salesUser.id,
        },
      })
    }

    if (usbHub) {
      await prisma.damageRecord.create({
        data: {
          tenantId: demoTenant.id,
          subsidiaryId: headOffice.id,
          productId: usbHub.id,
          userId: salesUser.id,
          quantity: 1,
          reason: 'EXPIRED',
          description: 'Batch expired on 2026-03-15',
          cost: 1 * 18.00 * NGN_PER_USD,
          date: new Date(),
          createdBy: salesUser.id,
        },
      })
    }

    console.log('✅ Example damage records created')
  }

  console.log('\n🎉 Seed complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
