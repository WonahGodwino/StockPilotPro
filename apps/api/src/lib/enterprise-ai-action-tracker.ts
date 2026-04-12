export type ActionTrackerStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'

export type ActionTrackerHistoryEvent = {
  status: ActionTrackerStatus
  changedAt: string
  changedByUserId: string
  note?: string
}

export type ActionTrackerState = {
  ownerUserId: string
  dueDate: string | null
  status: ActionTrackerStatus
  expectedImpactScore: number | null
  realizedImpactScore: number | null
  impactNotes: string | null
  progressNote: string | null
  createdAt: string
  updatedAt: string
  createdByUserId: string
  updatedByUserId: string
  history: ActionTrackerHistoryEvent[]
}

const VALID_STATUSES: ActionTrackerStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s.length ? s : null
}

function toHistory(value: unknown): ActionTrackerHistoryEvent[] {
  if (!Array.isArray(value)) return []
  const out: ActionTrackerHistoryEvent[] = []
  for (const item of value) {
    const row = toRecord(item)
    const status = String(row.status || '') as ActionTrackerStatus
    if (!VALID_STATUSES.includes(status)) continue
    const changedAt = String(row.changedAt || '')
    const changedByUserId = String(row.changedByUserId || '')
    if (!changedAt || !changedByUserId) continue
    out.push({
      status,
      changedAt,
      changedByUserId,
      note: toNullableString(row.note) || undefined,
    })
  }
  return out
}

export function extractActionTracker(payload: unknown): ActionTrackerState | null {
  const root = toRecord(payload)
  const tracker = toRecord(root.actionTracker)
  if (!Object.keys(tracker).length) return null

  const status = String(tracker.status || '') as ActionTrackerStatus
  if (!VALID_STATUSES.includes(status)) return null

  const ownerUserId = toNullableString(tracker.ownerUserId)
  const createdAt = toNullableString(tracker.createdAt)
  const updatedAt = toNullableString(tracker.updatedAt)
  const createdByUserId = toNullableString(tracker.createdByUserId)
  const updatedByUserId = toNullableString(tracker.updatedByUserId)
  if (!ownerUserId || !createdAt || !updatedAt || !createdByUserId || !updatedByUserId) return null

  return {
    ownerUserId,
    dueDate: toNullableString(tracker.dueDate),
    status,
    expectedImpactScore: toNullableNumber(tracker.expectedImpactScore),
    realizedImpactScore: toNullableNumber(tracker.realizedImpactScore),
    impactNotes: toNullableString(tracker.impactNotes),
    progressNote: toNullableString(tracker.progressNote),
    createdAt,
    updatedAt,
    createdByUserId,
    updatedByUserId,
    history: toHistory(tracker.history),
  }
}

export function attachActionTracker(payload: unknown, tracker: ActionTrackerState): Record<string, unknown> {
  const root = toRecord(payload)
  return {
    ...root,
    actionTracker: {
      ownerUserId: tracker.ownerUserId,
      dueDate: tracker.dueDate,
      status: tracker.status,
      expectedImpactScore: tracker.expectedImpactScore,
      realizedImpactScore: tracker.realizedImpactScore,
      impactNotes: tracker.impactNotes,
      progressNote: tracker.progressNote,
      createdAt: tracker.createdAt,
      updatedAt: tracker.updatedAt,
      createdByUserId: tracker.createdByUserId,
      updatedByUserId: tracker.updatedByUserId,
      history: tracker.history,
    },
  }
}

export function createActionTracker(args: {
  ownerUserId: string
  dueDate: string | null
  expectedImpactScore: number | null
  impactNotes: string | null
  actorUserId: string
  nowIso: string
}): ActionTrackerState {
  return {
    ownerUserId: args.ownerUserId,
    dueDate: args.dueDate,
    status: 'TODO',
    expectedImpactScore: args.expectedImpactScore,
    realizedImpactScore: null,
    impactNotes: args.impactNotes,
    progressNote: null,
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    createdByUserId: args.actorUserId,
    updatedByUserId: args.actorUserId,
    history: [
      {
        status: 'TODO',
        changedAt: args.nowIso,
        changedByUserId: args.actorUserId,
        note: 'Action tracker created',
      },
    ],
  }
}

export function updateActionTrackerState(args: {
  current: ActionTrackerState
  actorUserId: string
  nowIso: string
  ownerUserId?: string
  dueDate?: string | null
  status?: ActionTrackerStatus
  expectedImpactScore?: number | null
  realizedImpactScore?: number | null
  impactNotes?: string | null
  progressNote?: string | null
}): ActionTrackerState {
  const next: ActionTrackerState = {
    ...args.current,
    ownerUserId: args.ownerUserId ?? args.current.ownerUserId,
    dueDate: args.dueDate !== undefined ? args.dueDate : args.current.dueDate,
    status: args.status ?? args.current.status,
    expectedImpactScore: args.expectedImpactScore !== undefined ? args.expectedImpactScore : args.current.expectedImpactScore,
    realizedImpactScore: args.realizedImpactScore !== undefined ? args.realizedImpactScore : args.current.realizedImpactScore,
    impactNotes: args.impactNotes !== undefined ? args.impactNotes : args.current.impactNotes,
    progressNote: args.progressNote !== undefined ? args.progressNote : args.current.progressNote,
    updatedAt: args.nowIso,
    updatedByUserId: args.actorUserId,
    history: [...args.current.history],
  }

  if (args.status && args.status !== args.current.status) {
    next.history.push({
      status: args.status,
      changedAt: args.nowIso,
      changedByUserId: args.actorUserId,
      note: args.progressNote || undefined,
    })
  }

  return next
}
