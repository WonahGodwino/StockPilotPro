import { useEffect, useState } from 'react'
import api from '@/lib/api'

type BackupDrillRow = {
  id: string
  status: 'SUCCESS' | 'FAILED' | string
  triggerType: string
  dbConnectivityOk: boolean
  backupVerificationOk: boolean
  restoreDrillOk: boolean
  backupArtifactAgeHours: number | null
  startedAt: string
  completedAt: string | null
  errorMessage: string | null
  checkPayload?: unknown
}

type BackupDrillSummary = {
  totalRuns: number
  successRate30Days: number
  lastRun: BackupDrillRow | null
  lastSuccessfulRun: BackupDrillRow | null
  nextRecommendedRunAt: string
  recommendedCadenceHours: number
  isOverdue: boolean
}

function getRestoreTarget(row: BackupDrillRow): string {
  const payload = row.checkPayload as { restore?: { targetHost?: string | null; targetDatabase?: string | null } } | undefined
  const targetHost = payload?.restore?.targetHost
  const targetDatabase = payload?.restore?.targetDatabase
  if (!targetHost || !targetDatabase) return 'n/a'
  return `${targetHost}/${targetDatabase}`
}

function getTriggerLabel(triggerType: string): string {
  if (!triggerType) return 'UNKNOWN'
  if (triggerType === 'AUTOMATED') return 'AUTO'
  return triggerType
}

export default function SystemMaintenancePage() {
  const [summary, setSummary] = useState<BackupDrillSummary | null>(null)
  const [rows, setRows] = useState<BackupDrillRow[]>([])
  const [loading, setLoading] = useState(true)
  const [runningBackupDrill, setRunningBackupDrill] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  const fetchReport = () => {
    setLoading(true)
    api.get('/ops/backup-drills?limit=30')
      .then((response) => {
        setSummary(response.data?.data?.summary || null)
        setRows(response.data?.data?.rows || [])
        setWarning(null)
      })
      .catch((err) => {
        console.error('Failed to load backup/restore report', err)
        setSummary(null)
        setRows([])
        setWarning('Backup report is unavailable')
      })
      .finally(() => setLoading(false))
  }

  const runBackupDrill = async () => {
    setRunningBackupDrill(true)
    try {
      await api.post('/ops/backup-drills/run')
      fetchReport()
    } catch (err) {
      console.error('Failed to run backup drill', err)
    } finally {
      setRunningBackupDrill(false)
    }
  }

  useEffect(() => {
    fetchReport()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div>
          <div className="h-7 bg-gray-200 rounded w-64 mb-2" />
          <div className="h-4 bg-gray-100 rounded w-80" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-6 h-24 bg-gray-100 rounded" />
          ))}
        </div>
        <div className="card p-6 h-72 bg-gray-100 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Maintenance</h1>
          <p className="text-sm text-gray-500 mt-1">Backup and restore reliability report for manual drills and automated jobs</p>
        </div>
        <button
          type="button"
          onClick={() => { void runBackupDrill() }}
          disabled={runningBackupDrill}
          className={`px-3 py-1 rounded-lg text-sm font-medium ${runningBackupDrill ? 'bg-indigo-300 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
        >
          {runningBackupDrill ? 'Running...' : 'Run Drill'}
        </button>
      </div>

      {warning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {warning}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-white p-3 border border-indigo-100">
          <p className="text-xs text-gray-500">Runs Tracked</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{summary?.totalRuns ?? 0}</p>
        </div>
        <div className="rounded-lg bg-white p-3 border border-indigo-100">
          <p className="text-xs text-gray-500">30-Day Success Rate</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{summary?.successRate30Days ?? 0}%</p>
        </div>
        <div className="rounded-lg bg-white p-3 border border-indigo-100">
          <p className="text-xs text-gray-500">Last Run</p>
          <p className="text-sm font-semibold text-gray-900 mt-1">{summary?.lastRun ? new Date(summary.lastRun.startedAt).toLocaleString() : 'No run yet'}</p>
        </div>
        <div className="rounded-lg bg-white p-3 border border-indigo-100">
          <p className="text-xs text-gray-500">Next Recommended</p>
          <p className={`text-sm font-semibold mt-1 ${summary?.isOverdue ? 'text-danger-700' : 'text-gray-900'}`}>
            {summary?.nextRecommendedRunAt ? new Date(summary.nextRecommendedRunAt).toLocaleString() : 'Run now'}
          </p>
        </div>
      </div>

      <div className="card p-6 border border-indigo-200 bg-indigo-50/40">
        <h3 className="text-sm font-semibold text-indigo-700 uppercase">Backup and Restore Report</h3>
        <p className="text-xs text-indigo-700 mt-1">Recent execution history with restore destination and error traces</p>

        {rows.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-indigo-100">
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Started</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Trigger</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Status</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">DB</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Backup</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Restore</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Restore Target</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Backup Age (h)</th>
                  <th className="text-left py-2 font-medium text-gray-500">Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-indigo-50">
                    <td className="py-2 pr-3 text-gray-700">{new Date(row.startedAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-gray-700">{getTriggerLabel(row.triggerType)}</td>
                    <td className={`py-2 pr-3 font-semibold ${row.status === 'SUCCESS' ? 'text-success-700' : 'text-danger-700'}`}>{row.status}</td>
                    <td className={`py-2 pr-3 ${row.dbConnectivityOk ? 'text-success-700' : 'text-danger-700'}`}>{row.dbConnectivityOk ? 'OK' : 'Fail'}</td>
                    <td className={`py-2 pr-3 ${row.backupVerificationOk ? 'text-success-700' : 'text-danger-700'}`}>{row.backupVerificationOk ? 'OK' : 'Fail'}</td>
                    <td className={`py-2 pr-3 ${row.restoreDrillOk ? 'text-success-700' : 'text-danger-700'}`}>{row.restoreDrillOk ? 'OK' : 'Fail'}</td>
                    <td className="py-2 pr-3 text-gray-700">{getRestoreTarget(row)}</td>
                    <td className="py-2 pr-3 text-gray-700">{row.backupArtifactAgeHours ?? 'n/a'}</td>
                    <td className="py-2 text-gray-700 max-w-[24rem] truncate" title={row.errorMessage || ''}>{row.errorMessage || 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-indigo-200 bg-white px-4 py-3 text-sm text-gray-600">No maintenance events recorded yet.</div>
        )}
      </div>
    </div>
  )
}
