import { PrismaClient, UserRole, SubscriptionStatus, ProductType, ProductStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'

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
    update: {},
    create: {
      id: 'plan_enterprise',
      name: 'Enterprise',
      description: 'Unlimited growth potential',
      price: 599.99,
      maxSubsidiaries: 20,
      extraSubsidiaryPrice: 9.99,
      features: { reports: true, export: true, multiCurrency: true },
      isActive: true,
    },
  })

  console.log('✅ Plans created')

  // ── Super Admin ────────────────────────────────────────
  const superAdminPassword = await bcrypt.hash('SuperAdmin@123', 12)
  await prisma.user.upsert({
    where: { email: 'superadmin@stockpilot.pro' },
    update: {},
    create: {
      email: 'superadmin@stockpilot.pro',
      password: superAdminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  })
  console.log('✅ Super Admin created: superadmin@stockpilot.pro / SuperAdmin@123')

  // ── Demo Tenant ────────────────────────────────────────
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'demo-corp' },
    update: {},
    create: {
      name: 'Demo Corporation',
      slug: 'demo-corp',
      email: 'info@democorp.com',
      phone: '+1-555-0100',
      isActive: true,
    },
  })

  // Subscription for demo tenant
  const now = new Date()
  const nextYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
  await prisma.subscription.upsert({
    where: { id: 'sub_demo' },
    update: {},
    create: {
      id: 'sub_demo',
      tenantId: demoTenant.id,
      planId: growthPlan.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: now,
      expiryDate: nextYear,
      amount: growthPlan.price,
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

  // ── Demo Users ─────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@123', 12)
  await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      tenantId: demoTenant.id,
      subsidiaryId: headOffice.id,
      email: 'admin@demo.com',
      password: adminPassword,
      firstName: 'Business',
      lastName: 'Admin',
      role: UserRole.BUSINESS_ADMIN,
      isActive: true,
    },
  })

  const salesPassword = await bcrypt.hash('Sales@123', 12)
  await prisma.user.upsert({
    where: { email: 'sales@demo.com' },
    update: {},
    create: {
      tenantId: demoTenant.id,
      subsidiaryId: headOffice.id,
      email: 'sales@demo.com',
      password: salesPassword,
      firstName: 'John',
      lastName: 'Sales',
      role: UserRole.SALESPERSON,
      isActive: true,
    },
  })

  console.log('✅ Demo users created')
  console.log('   admin@demo.com / Admin@123')
  console.log('   sales@demo.com / Sales@123')

  // ── Demo Products ──────────────────────────────────────
  const products = [
    {
      id: 'prod_001',
      name: 'Wireless Keyboard',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 50,
      costPrice: 25.00,
      sellingPrice: 49.99,
      barcode: '8901234567001',
      lowStockThreshold: 10,
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_002',
      name: 'USB-C Hub 7-in-1',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 30,
      costPrice: 18.00,
      sellingPrice: 39.99,
      barcode: '8901234567002',
      lowStockThreshold: 5,
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_003',
      name: '27" Monitor',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 8,
      costPrice: 180.00,
      sellingPrice: 299.99,
      barcode: '8901234567003',
      lowStockThreshold: 3,
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_004',
      name: 'IT Support (per hour)',
      type: ProductType.SERVICE,
      unit: 'hr',
      quantity: 999,
      costPrice: 20.00,
      sellingPrice: 75.00,
      lowStockThreshold: 0,
      status: ProductStatus.ACTIVE,
    },
    {
      id: 'prod_005',
      name: 'Laptop Stand',
      type: ProductType.GOODS,
      unit: 'pcs',
      quantity: 3,
      costPrice: 12.00,
      sellingPrice: 24.99,
      barcode: '8901234567005',
      lowStockThreshold: 5,
      status: ProductStatus.ACTIVE,
    },
  ]

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...p,
        tenantId: demoTenant.id,
        subsidiaryId: headOffice.id,
      },
    })
  }

  console.log('✅ Demo products created')
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
