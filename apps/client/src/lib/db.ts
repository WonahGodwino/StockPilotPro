import Dexie, { type Table } from 'dexie'
import type { Product, Expense, CartItem, Sale, SaleCheckoutPayload, AuthUser, Subsidiary, Notification, CurrencyRate } from '@/types'

const PENDING_RECORDS_CHANGED_EVENT = 'stockpilot:pending-records-changed'

function emitPendingRecordsChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PENDING_RECORDS_CHANGED_EVENT))
}

export function subscribePendingRecordsChanged(listener: EventListener) {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(PENDING_RECORDS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(PENDING_RECORDS_CHANGED_EVENT, listener)
}

export interface ExpensePayload {
  title: string
  amount: number
  category: string
  date: string
  currency: string
  fxRate: number
  notes?: string
  subsidiaryId?: string | null
  syncRef?: string
  transactionRef?: string
}

export interface TrustedCustomerPayload {
  name: string
  logoUrl?: string
  websiteUrl?: string
  displayOrder: number
  isActive: boolean
}

export interface TrustedCustomerPendingPayload {
  operation: 'create' | 'update' | 'delete'
  trustedCustomerId: string
  payload?: TrustedCustomerPayload
}

// Offline-pending record wrapper
export interface PendingRecord<T> {
  id?: number
  localId: string
  type: 'sale' | 'expense' | 'trustedCustomer'
  data: T
  synced: 0 | 1
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
  notifications!: Table<Notification>
  currencyRates!: Table<CurrencyRate>
  users!: Table<AuthUser>
  subsidiaries!: Table<Subsidiary>
  pendingRecords!: Table<PendingRecord<SaleCheckoutPayload | ExpensePayload | TrustedCustomerPendingPayload>>
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

    this.version(3).stores({
      products: 'id, tenantId, subsidiaryId, barcode, status, name',
      sales: 'id, tenantId, subsidiaryId, userId, createdAt',
      expenses: 'id, tenantId, subsidiaryId, userId, date',
      notifications: 'id, tenantId, isRead, createdAt, type',
      currencyRates: 'id, tenantId, fromCurrency, toCurrency, date',
      users: 'id, tenantId, subsidiaryId, role, email',
      subsidiaries: 'id, tenantId, isActive, name',
      pendingRecords: '++id, localId, type, synced',
      syncRuns: '++id, at, status',
      cart: '++id',
    })

    this.version(4).stores({
      products: 'id, tenantId, subsidiaryId, barcode, status, name',
      sales: 'id, tenantId, subsidiaryId, userId, createdAt',
      expenses: 'id, tenantId, subsidiaryId, userId, date',
      notifications: 'id, tenantId, isRead, createdAt, type',
      currencyRates: 'id, tenantId, fromCurrency, toCurrency, date',
      users: 'id, tenantId, subsidiaryId, role, email',
      subsidiaries: 'id, tenantId, isActive, name',
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

export async function replaceCachedProductsForTenant(tenantId: string, products: Product[]) {
  await db.transaction('rw', db.products, async () => {
    await db.products.where('tenantId').equals(tenantId).delete()
    if (products.length > 0) {
      await db.products.bulkPut(products)
    }
  })
}

export async function getCachedProductsForTenant(tenantId: string, subsidiaryId?: string): Promise<Product[]> {
  if (subsidiaryId) {
    return db.products
      .where('tenantId')
      .equals(tenantId)
      .and((p) => p.subsidiaryId === subsidiaryId)
      .toArray()
  }
  return db.products.where('tenantId').equals(tenantId).toArray()
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
  const dedupeRef = data.transactionRef || data.syncRef || localId
  const payload: SaleCheckoutPayload = {
    ...data,
    syncRef: data.syncRef || localId,
    transactionRef: dedupeRef,
  }
  await db.pendingRecords.add({
    localId,
    type: 'sale',
    data: payload,
    synced: 0,
    createdAt: new Date().toISOString(),
  })
  emitPendingRecordsChanged()
  return localId
}

export async function getPendingSaleRecords() {
  const pending = await getPendingRecords()
  return pending.filter((record): record is PendingRecord<SaleCheckoutPayload> => record.type === 'sale')
}

export async function addPendingExpense(data: ExpensePayload) {
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const dedupeRef = data.transactionRef || data.syncRef || localId
  const payload: ExpensePayload = {
    ...data,
    syncRef: data.syncRef || localId,
    transactionRef: dedupeRef,
  }
  await db.pendingRecords.add({
    localId,
    type: 'expense',
    data: payload,
    synced: 0,
    createdAt: new Date().toISOString(),
  })
  emitPendingRecordsChanged()
  return localId
}

export async function addPendingTrustedCustomerOperation(data: TrustedCustomerPendingPayload) {
  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await db.pendingRecords.add({
    localId,
    type: 'trustedCustomer',
    data,
    synced: 0,
    createdAt: new Date().toISOString(),
  })
  emitPendingRecordsChanged()
  return localId
}

export async function getPendingRecords() {
  return db.pendingRecords.where('synced').equals(0).toArray()
}

export async function getPendingExpenseRecords() {
  const pending = await getPendingRecords()
  return pending.filter((record): record is PendingRecord<ExpensePayload> => record.type === 'expense')
}

export async function updatePendingExpense(localId: string, data: ExpensePayload) {
  const pending = await db.pendingRecords.where('localId').equals(localId).first()
  if (!pending || pending.type !== 'expense' || pending.synced !== 0 || pending.id === undefined) return false

  const existing = pending.data as ExpensePayload
  const payload: ExpensePayload = {
    ...existing,
    ...data,
    syncRef: existing.syncRef || data.syncRef || localId,
    transactionRef: existing.transactionRef || data.transactionRef || existing.syncRef || data.syncRef || localId,
  }

  await db.pendingRecords.update(pending.id, {
    data: payload,
    createdAt: new Date().toISOString(),
  })
  emitPendingRecordsChanged()
  return true
}

export async function getCachedExpensesForTenant(tenantId: string) {
  return db.expenses.where('tenantId').equals(tenantId).toArray()
}

export async function getCachedSalesForTenant(tenantId: string) {
  return db.sales.where('tenantId').equals(tenantId).toArray()
}

export async function getCachedUsersForTenant(tenantId: string | null, role?: string, subsidiaryId?: string) {
  const base = tenantId === null
    ? await db.users.filter((user) => user.tenantId === null).toArray()
    : await db.users.where('tenantId').equals(tenantId).toArray()

  return base.filter((user) => {
    if (role && user.role !== role) return false
    if (subsidiaryId && user.subsidiaryId !== subsidiaryId) return false
    return true
  })
}

export async function replaceCachedUsersForTenant(tenantId: string | null, users: AuthUser[]) {
  await db.transaction('rw', db.users, async () => {
    if (tenantId === null) {
      const existing = await db.users.filter((user) => user.tenantId === null).toArray()
      const ids = existing.map((user) => user.id)
      if (ids.length > 0) {
        await db.users.bulkDelete(ids)
      }
    } else {
      await db.users.where('tenantId').equals(tenantId).delete()
    }

    if (users.length > 0) {
      await db.users.bulkPut(users)
    }
  })
}

export async function getCachedSubsidiariesForTenant(tenantId: string) {
  return db.subsidiaries.where('tenantId').equals(tenantId).toArray()
}

export async function replaceCachedSubsidiariesForTenant(tenantId: string, subsidiaries: Subsidiary[]) {
  await db.transaction('rw', db.subsidiaries, async () => {
    await db.subsidiaries.where('tenantId').equals(tenantId).delete()
    if (subsidiaries.length > 0) {
      await db.subsidiaries.bulkPut(subsidiaries)
    }
  })
}

export async function replaceCachedSalesForTenant(tenantId: string, sales: Sale[]) {
  await db.transaction('rw', db.sales, async () => {
    await db.sales.where('tenantId').equals(tenantId).delete()
    if (sales.length > 0) {
      await db.sales.bulkPut(sales)
    }
  })
}

export async function replaceCachedExpensesForTenant(tenantId: string, expenses: Expense[]) {
  await db.transaction('rw', db.expenses, async () => {
    await db.expenses.where('tenantId').equals(tenantId).delete()
    if (expenses.length > 0) {
      await db.expenses.bulkPut(expenses)
    }
  })
}

export async function getCachedNotificationsForTenant(tenantId: string) {
  return db.notifications.where('tenantId').equals(tenantId).reverse().sortBy('createdAt')
}

export async function replaceCachedNotificationsForTenant(tenantId: string, notifications: Notification[]) {
  await db.transaction('rw', db.notifications, async () => {
    await db.notifications.where('tenantId').equals(tenantId).delete()
    if (notifications.length > 0) {
      await db.notifications.bulkPut(notifications)
    }
  })
}

export async function updateCachedNotificationReadState(notificationId: string, isRead: boolean) {
  await db.notifications.update(notificationId, { isRead })
}

export async function getCachedCurrencyRatesForTenant(tenantId: string) {
  return db.currencyRates.where('tenantId').equals(tenantId).reverse().sortBy('date')
}

export async function replaceCachedCurrencyRatesForTenant(tenantId: string, rates: CurrencyRate[]) {
  await db.transaction('rw', db.currencyRates, async () => {
    await db.currencyRates.where('tenantId').equals(tenantId).delete()
    if (rates.length > 0) {
      await db.currencyRates.bulkPut(rates)
    }
  })
}

export async function getPendingRecordCount() {
  return db.pendingRecords.where('synced').equals(0).count()
}

export async function markSynced(id: number) {
  await db.pendingRecords.update(id, { synced: 1 })
  emitPendingRecordsChanged()
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
  emitPendingRecordsChanged()
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
