import Dexie, { type Table } from 'dexie'
import type { Product, Sale, Expense, CartItem } from '@/types'

// Offline-pending record wrapper
export interface PendingRecord<T> {
  id?: number
  localId: string
  type: 'sale' | 'expense'
  data: T
  synced: boolean
  createdAt: string
}

export class StockPilotDB extends Dexie {
  products!: Table<Product>
  sales!: Table<Sale>
  expenses!: Table<Expense>
  pendingRecords!: Table<PendingRecord<Sale | Expense>>
  cart!: Table<CartItem & { id: number }>

  constructor() {
    super('StockPilotProDB')
    this.version(1).stores({
      products: 'id, tenantId, subsidiaryId, barcode, status, name',
      sales: 'id, tenantId, subsidiaryId, userId, createdAt',
      expenses: 'id, tenantId, subsidiaryId, userId, date',
      pendingRecords: '++id, localId, type, synced',
      cart: '++id',
    })
  }
}

export const db = new StockPilotDB()

// ── Helper functions ─────────────────────────────────────────────────────────

export async function cacheProducts(products: Product[]) {
  await db.products.bulkPut(products)
}

export async function getCachedProducts(subsidiaryId?: string): Promise<Product[]> {
  if (subsidiaryId) {
    return db.products.where('subsidiaryId').equals(subsidiaryId).toArray()
  }
  return db.products.toArray()
}

export async function searchCachedProducts(query: string): Promise<Product[]> {
  return db.products
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.barcode === query)
    .toArray()
}

export async function getProductByBarcode(barcode: string): Promise<Product | undefined> {
  return db.products.where('barcode').equals(barcode).first()
}

export async function addPendingSale(data: Omit<Sale, 'id' | 'createdAt' | 'updatedAt'>) {
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await db.pendingRecords.add({
    localId,
    type: 'sale',
    data: data as Sale,
    synced: false,
    createdAt: new Date().toISOString(),
  })
  return localId
}

export async function getPendingRecords() {
  return db.pendingRecords.where('synced').equals(0).toArray()
}

export async function markSynced(id: number) {
  await db.pendingRecords.update(id, { synced: true })
}

export async function clearCart() {
  await db.cart.clear()
}
