import api from './api'
import { addSyncRun, getPendingRecords, getRecentSyncRuns, markSynced, pruneSyncedPendingRecords, pruneSyncRuns } from './db'
import toast from 'react-hot-toast'

export type SyncStatus = {
  isSyncing: boolean
  lastSyncAt: number | null
  lastSyncedCount: number
  lastFailedCount: number
  lastError: string | null
}

export type SyncHistoryEntry = {
  at: number
  syncedCount: number
  failedCount: number
  pendingBefore: number
  status: 'success' | 'partial' | 'failed' | 'noop'
  error?: string
}

let isSyncing = false
let listenerInitialized = false
let syncIntervalId: ReturnType<typeof setInterval> | null = null
let syncStatus: SyncStatus = {
  isSyncing: false,
  lastSyncAt: null,
  lastSyncedCount: 0,
  lastFailedCount: 0,
  lastError: null,
}
let syncHistory: SyncHistoryEntry[] = []

function pushSyncHistory(entry: SyncHistoryEntry) {
  syncHistory = [entry, ...syncHistory].slice(0, 20)
  void addSyncRun({
    at: new Date(entry.at).toISOString(),
    syncedCount: entry.syncedCount,
    failedCount: entry.failedCount,
    pendingBefore: entry.pendingBefore,
    status: entry.status,
    error: entry.error,
  }).then(() => pruneSyncRuns(100)).catch(() => undefined)
}

let historyHydrated = false
async function hydrateSyncHistory() {
  if (historyHydrated) return
  historyHydrated = true
  try {
    const rows = await getRecentSyncRuns(20)
    syncHistory = rows.map((r) => ({
      at: new Date(r.at).getTime(),
      syncedCount: r.syncedCount,
      failedCount: r.failedCount,
      pendingBefore: r.pendingBefore,
      status: r.status,
      error: r.error,
    }))
    emitSyncStatus()
  } catch {
    // Ignore hydration errors; sync still works without persisted history.
  }
}

function emitSyncStatus() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('stockpilot:sync-status', { detail: { ...syncStatus } }))
}

export function getSyncStatusSnapshot(): SyncStatus {
  return { ...syncStatus }
}

export function getSyncHistorySnapshot(): SyncHistoryEntry[] {
  return [...syncHistory]
}

function onOnline() {
  toast.success('Back online - syncing...')
  void syncPendingRecords()
}

function onOffline() {
  toast.error('You are offline. Changes will sync when reconnected.')
}

export async function syncPendingRecords() {
  if (isSyncing || !navigator.onLine) return
  isSyncing = true
  syncStatus = { ...syncStatus, isSyncing: true, lastError: null }
  emitSyncStatus()

  try {
    const pending = await getPendingRecords()
    if (pending.length === 0) {
      syncStatus = {
        ...syncStatus,
        isSyncing: false,
        lastSyncAt: Date.now(),
        lastSyncedCount: 0,
        lastFailedCount: 0,
      }
      pushSyncHistory({
        at: Date.now(),
        syncedCount: 0,
        failedCount: 0,
        pendingBefore: 0,
        status: 'noop',
      })
      emitSyncStatus()
      return
    }

    let synced = 0
    let failed = 0
    for (const record of pending) {
      try {
        if (record.type === 'sale') {
          await api.post('/sales', record.data)
        } else if (record.type === 'expense') {
          await api.post('/expenses', record.data)
        }
        if (record.id !== undefined) {
          await markSynced(record.id)
        }
        synced++
      } catch (err) {
        failed++
        console.error(`Failed to sync record ${record.localId}:`, err)
      }
    }

    if (synced > 0) {
      toast.success(`Synced ${synced} offline record(s)`)
    }

    // Keep IndexedDB queue compact in long-running production use.
    await pruneSyncedPendingRecords(7)

    syncStatus = {
      ...syncStatus,
      isSyncing: false,
      lastSyncAt: Date.now(),
      lastSyncedCount: synced,
      lastFailedCount: failed,
      lastError: failed > 0 ? `${failed} record(s) failed to sync` : null,
    }
    pushSyncHistory({
      at: Date.now(),
      syncedCount: synced,
      failedCount: failed,
      pendingBefore: pending.length,
      status: failed === 0 ? 'success' : synced > 0 ? 'partial' : 'failed',
      error: failed > 0 ? `${failed} record(s) failed to sync` : undefined,
    })
    emitSyncStatus()
  } catch (err) {
    syncStatus = {
      ...syncStatus,
      isSyncing: false,
      lastSyncAt: Date.now(),
      lastError: (err as Error)?.message || 'Sync failed',
    }
    pushSyncHistory({
      at: Date.now(),
      syncedCount: 0,
      failedCount: 0,
      pendingBefore: 0,
      status: 'failed',
      error: (err as Error)?.message || 'Sync failed',
    })
    emitSyncStatus()
    throw err
  } finally {
    isSyncing = false
  }
}

export function initSyncListener() {
  if (listenerInitialized) {
    return () => undefined
  }

  listenerInitialized = true
  void hydrateSyncHistory()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  // Periodic sync attempt every 30 seconds (if online)
  syncIntervalId = setInterval(() => {
    if (navigator.onLine) {
      void syncPendingRecords()
    }
  }, 30_000)

  // Try once at startup so queued records flush quickly after login/app mount.
  if (navigator.onLine) {
    void syncPendingRecords()
  }

  return () => {
    if (!listenerInitialized) return
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    if (syncIntervalId) {
      clearInterval(syncIntervalId)
      syncIntervalId = null
    }
    listenerInitialized = false
  }
}
