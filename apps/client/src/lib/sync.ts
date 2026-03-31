import api from './api'
import { getPendingRecords, markSynced } from './db'
import toast from 'react-hot-toast'

let isSyncing = false

export async function syncPendingRecords() {
  if (isSyncing || !navigator.onLine) return
  isSyncing = true

  try {
    const pending = await getPendingRecords()
    if (pending.length === 0) return

    let synced = 0
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
        console.error(`Failed to sync record ${record.localId}:`, err)
      }
    }

    if (synced > 0) {
      toast.success(`Synced ${synced} offline record(s)`)
    }
  } finally {
    isSyncing = false
  }
}

export function initSyncListener() {
  window.addEventListener('online', () => {
    toast.success('Back online — syncing...')
    syncPendingRecords()
  })

  window.addEventListener('offline', () => {
    toast.error('You are offline. Changes will sync when reconnected.')
  })

  // Periodic sync attempt every 30 seconds (if online)
  setInterval(() => {
    if (navigator.onLine) syncPendingRecords()
  }, 30_000)
}
