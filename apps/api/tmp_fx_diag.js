const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const tenant = await p.tenant.findFirst({ where: { slug: 'demo-corp' }, select: { id: true, baseCurrency: true } });
  if (!tenant) {
    console.log('no tenant');
    return;
  }

  const products = await p.product.findMany({
    where: { tenantId: tenant.id, archived: false },
    select: { id: true, costPrice: true, sellingPrice: true },
    take: 5000,
  });
  let badProducts = 0;
  for (const row of products) {
    const c = Number(row.costPrice);
    const s = Number(row.sellingPrice);
    if (!Number.isFinite(c) || !Number.isFinite(s)) {
      badProducts += 1;
      console.log('bad product', row.id, String(row.costPrice), String(row.sellingPrice));
    }
  }

  const sales = await p.sale.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, currency: true, fxRate: true },
    take: 5000,
  });
  let badSales = 0;
  for (const row of sales) {
    const fx = Number(row.fxRate);
    if (!Number.isFinite(fx) || fx <= 0) {
      badSales += 1;
      console.log('bad sale', row.id, row.currency, String(row.fxRate));
    }
  }

  const expenses = await p.expense.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, currency: true, fxRate: true },
    take: 5000,
  });
  let badExpenses = 0;
  for (const row of expenses) {
    const fx = Number(row.fxRate);
    if (!Number.isFinite(fx) || fx <= 0) {
      badExpenses += 1;
      console.log('bad expense', row.id, row.currency, String(row.fxRate));
    }
  }

  console.log('tenant', tenant.id, 'base', tenant.baseCurrency);
  console.log('products', products.length, 'badProducts', badProducts);
  console.log('sales', sales.length, 'badSales', badSales);
  console.log('expenses', expenses.length, 'badExpenses', badExpenses);
})()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
