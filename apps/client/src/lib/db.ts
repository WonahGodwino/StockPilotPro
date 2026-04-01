import Dexie, { type Table } from 'dexie'
import type { Product, Expense, CartItem, Sale, SaleCheckoutPayload } from '@/types'

export interface ExpensePayload {
  title: string
  amount: number
  category: string
  date: string
  notes?: string
  subsidiaryId: string
  syncRef?: string
}

// Offline-pending record wrapper
export interface PendingRecord<T> {
  id?: number
  localId: string
  type: 'sale' | 'expense'
  data: T
  synced: boolean
  createdAt: string
}

export interface SyncRun {
  id?: number
  at: string
  syncedCount: number
  failedCount: number
  pendingBefore: number
  status: 'success' | 'partial' | 'failed' | 'noop'
  error?: string
}

export class StockPilotDB extends Dexie {
  products!: Table<Product>
  sales!: Table<Sale>
  expenses!: Table<Expense>
  pendingRecords!: Table<PendingRecord<SaleCheckoutPayload | ExpensePayload>>
  syncRuns!: Table<SyncRun>
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

    this.version(2).stores({
      products: 'id, tenantId, subsidiaryId, barcode, status, name',
      sales: 'id, tenantId, subsidiaryId, userId, createdAt',
      expenses: 'id, tenantId, subsidiaryId, userId, date',
      pendingRecords: '++id, localId, type, synced',
      syncRuns: '++id, at, status',
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

export async function addPendingSale(data: SaleCheckoutPayload) {
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const payload: SaleCheckoutPayload = { ...data, syncRef: data.syncRef || localId }
  await db.pendingRecords.add({
    localId,
    type: 'sale',
    data: payload,
    synced: false,
    createdAt: new Date().toISOString(),
  })
  return localId
}

export async function addPendingExpense(data: ExpensePayload) {
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const payload: ExpensePayload = { ...data, syncRef: data.syncRef || localId }
  await db.pendingRecords.add({
    localId,
    type: 'expense',
    data: payload,
    synced: false,
    createdAt: new Date().toISOString(),
  })
  return localId
}

export async function getPendingRecords() {
  return db.pendingRecords.where('synced').equals(0).toArray()
}

export async function getPendingRecordCount() {
  return db.pendingRecords.where('synced').equals(0).count()
}

export async function markSynced(id: number) {
  await db.pendingRecords.update(id, { synced: true })
}

export async function pruneSyncedPendingRecords(maxAgeDays = 7) {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
  const oldSynced = await db.pendingRecords
    .where('synced')
    .equals(1)
    .filter((r) => r.createdAt < cutoff)
    .toArray()

  if (oldSynced.length === 0) return 0
  const ids = oldSynced.map((r) => r.id).filter((id): id is number => id !== undefined)
  if (ids.length === 0) return 0

  await db.pendingRecords.bulkDelete(ids)
  return ids.length
}

export async function clearCart() {
  await db.cart.clear()
}

export async function addSyncRun(run: SyncRun) {
  await db.syncRuns.add(run)
}

export async function getRecentSyncRuns(limit = 20): Promise<SyncRun[]> {
  return db.syncRuns.orderBy('id').reverse().limit(limit).toArray()
}

export async function pruneSyncRuns(maxItems = 100) {
  const count = await db.syncRuns.count()
  if (count <= maxItems) return 0

  const toDelete = count - maxItems
  const oldest = await db.syncRuns.orderBy('id').limit(toDelete).toArray()
  const ids = oldest.map((r) => r.id).filter((id): id is number => id !== undefined)
  if (ids.length === 0) return 0

  await db.syncRuns.bulkDelete(ids)
  return ids.length
}
