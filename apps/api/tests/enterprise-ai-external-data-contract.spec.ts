import assert from 'node:assert/strict'
import {
  findExternalMappingContractIssues,
  type ExternalMappingConfig,
  type ExternalSchemaTable,
} from '../src/lib/enterprise-ai-external-data'

console.log('enterprise-ai-external-data-contract.spec: starting test suite')

const schemaTables: ExternalSchemaTable[] = [
  {
    name: 'sales',
    columns: [
      { name: 'id', dataType: 'uuid', nullable: false },
      { name: 'created_at', dataType: 'timestamp', nullable: false },
      { name: 'total_amount', dataType: 'numeric', nullable: false },
      { name: 'currency_code', dataType: 'text', nullable: true },
      { name: 'branch_id', dataType: 'uuid', nullable: true },
    ],
  },
  {
    name: 'sale_items',
    columns: [
      { name: 'sale_id', dataType: 'uuid', nullable: false },
      { name: 'product_id', dataType: 'uuid', nullable: false },
      { name: 'quantity', dataType: 'numeric', nullable: false },
      { name: 'subtotal', dataType: 'numeric', nullable: false },
    ],
  },
  {
    name: 'expenses',
    columns: [
      { name: 'expense_date', dataType: 'timestamp', nullable: false },
      { name: 'amount', dataType: 'numeric', nullable: false },
      { name: 'category', dataType: 'text', nullable: true },
      { name: 'title', dataType: 'text', nullable: true },
      { name: 'branch_id', dataType: 'uuid', nullable: true },
    ],
  },
  {
    name: 'products',
    columns: [
      { name: 'id', dataType: 'uuid', nullable: false },
      { name: 'name', dataType: 'text', nullable: false },
      { name: 'category', dataType: 'text', nullable: true },
      { name: 'cost_price', dataType: 'numeric', nullable: false },
      { name: 'selling_price', dataType: 'numeric', nullable: false },
      { name: 'current_stock', dataType: 'numeric', nullable: false },
      { name: 'low_stock_threshold', dataType: 'numeric', nullable: false },
      { name: 'branch_id', dataType: 'uuid', nullable: true },
    ],
  },
  {
    name: 'inventory',
    columns: [
      { name: 'product_id', dataType: 'uuid', nullable: false },
      { name: 'quantity', dataType: 'numeric', nullable: false },
      { name: 'branch_id', dataType: 'uuid', nullable: true },
    ],
  },
  {
    name: 'branches',
    columns: [
      { name: 'id', dataType: 'uuid', nullable: false },
      { name: 'name', dataType: 'text', nullable: false },
    ],
  },
]

const validMapping: ExternalMappingConfig = {
  sales: {
    table: 'sales',
    columns: {
      id: 'id',
      date: 'created_at',
      totalAmount: 'total_amount',
      currency: 'currency_code',
      branchId: 'branch_id',
    },
  },
  saleItems: {
    table: 'sale_items',
    columns: {
      saleId: 'sale_id',
      productId: 'product_id',
      quantity: 'quantity',
      subtotal: 'subtotal',
    },
  },
  expenses: {
    table: 'expenses',
    columns: {
      date: 'expense_date',
      amount: 'amount',
      category: 'category',
      title: 'title',
      branchId: 'branch_id',
    },
  },
  products: {
    table: 'products',
    columns: {
      id: 'id',
      name: 'name',
      category: 'category',
      costPrice: 'cost_price',
      sellingPrice: 'selling_price',
      currentStock: 'current_stock',
      lowStockThreshold: 'low_stock_threshold',
      branchId: 'branch_id',
    },
  },
  inventory: {
    table: 'inventory',
    columns: {
      productId: 'product_id',
      quantity: 'quantity',
      branchId: 'branch_id',
    },
  },
  branches: {
    table: 'branches',
    columns: {
      id: 'id',
      name: 'name',
    },
  },
}

console.log('enterprise-ai-external-data-contract.spec: validating fully mapped schema')
assert.deepEqual(findExternalMappingContractIssues(validMapping, schemaTables), [])

console.log('enterprise-ai-external-data-contract.spec: validating missing mapping fields are detected')
const missingMappedFieldIssues = findExternalMappingContractIssues({
  ...validMapping,
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
}, schemaTables)
assert.equal(missingMappedFieldIssues.length, 1)
assert.equal(missingMappedFieldIssues[0]?.entity, 'products')
assert.deepEqual(missingMappedFieldIssues[0]?.missingMappings, ['lowStockThreshold'])

console.log('enterprise-ai-external-data-contract.spec: validating schema mismatches are detected')
const schemaMismatchIssues = findExternalMappingContractIssues({
  ...validMapping,
  sales: {
    table: 'sales',
    columns: {
      id: 'id',
      date: 'created_at',
      totalAmount: 'gross_total',
      currency: 'currency_code',
      branchId: 'branch_id',
    },
  },
}, schemaTables)
assert.equal(schemaMismatchIssues.length, 1)
assert.equal(schemaMismatchIssues[0]?.entity, 'sales')
assert.deepEqual(schemaMismatchIssues[0]?.missingSchemaColumns, ['totalAmount'])

console.log('enterprise-ai-external-data-contract.spec: all assertions passed')