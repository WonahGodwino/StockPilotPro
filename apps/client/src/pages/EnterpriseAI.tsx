import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Bot, Sparkles, ShieldAlert, RefreshCw, CalendarDays, ClipboardCheck, TrendingUp, SlidersHorizontal, Gauge, Save, Printer, Trash2, Search, Download, FileText, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import toast from 'react-hot-toast'

type Recommendation = {
  id: string
  recommendationType: string
  status: string
  title: string
  summary: string
  confidenceScore?: number | null
  riskScore?: number | null
  outputPayload?: unknown
  createdAt: string
}

type AssistantBrief = {
  summary: string
  comparativeInsights: string[]
  actions: string[]
  risks: string[]
  followUpQuestions: string[]
  responseMode?: 'clarify' | 'brief' | 'deep'
  clarificationPrompt?: string
  businessGuidance?: {
    operatingMode: 'clarification_needed' | 'insufficient_evidence' | 'monitor_only' | 'manual_intervention' | 'decision_ready'
    confidenceLabel: string
    why: string
    primaryRecommendation: string
    expectedImpact: string
    nextReview: string
    audience: string
  }
  groundingNotes?: string[]
  factBasis?: string[]
  financialMetrics?: {
    revenue?: number
    profit?: number
    margin?: number
    expenseRatio?: number
    inventoryTurnover?: number
    cashRunway?: number | null
  }
  alerts?: Array<{
    severity: 'critical' | 'warning' | 'info'
    message: string
    actionRequired: string
  }>
  scenarioAnalysis?: {
    bestScenario: string | null
    worstScenario: string | null
    profitSpread: number
    roiSpread: number
    calibrationSampleSize?: number
    averageSuccessScore?: number
    calibrationScore?: number
    historicalAccuracy?: number
    profitConfidenceInterval?: {
      low: number
      high: number
    }
  }
  causalAnalysis?: {
    problem: string
    topCauses: Array<{ cause: string; contribution: number }>
    interventions: string[]
    methods?: Array<{
      method: 'granger' | 'difference_in_differences' | 'synthetic_control'
      title: string
      confidence: number
      pValue?: number
      effectSize?: number
    }>
    confidenceScore?: number
  }
  strategicInsights?: Array<{
    level: 'tactical' | 'operational' | 'strategic' | 'visionary'
    insight: string
    estimatedROI: number
    timeHorizon: 'immediate' | 'quarter' | 'year' | '3_years'
  }>
  explanation?: {
    summary: string
    confidence: number
    keyFactors: Array<{ factor: string; contribution: number; direction: 'positive' | 'negative' }>
    limitations: string[]
  }
  executionPlan?: {
    autoExecutableCount: number
    approvalRequiredCount: number
    highPriorityHumanActions?: string[]
    workflowCoverageScore?: number
    workflowStages?: Array<{
      actionType: string
      stageCount: number
      matchedRules: number
      requiresHumanDecision: boolean
      executionId?: string
      approvalStatus?: string
      rollbackReady?: boolean
    }>
    topActionDecision?: 'auto_execute' | 'pending_approval'
  }
}

type CausalDiagnosticsResponse = {
  data: {
    problem: string
    confidenceScore: number
    topCauses: Array<{ cause: string; contribution: number; evidence?: string[] }>
    contributingFactors: string[]
    interventions: Array<{ action: string; expectedImpact: number; confidence: number }>
    methods: Array<{
      method: 'granger' | 'difference_in_differences' | 'synthetic_control'
      title: string
      signal: string
      confidence: number
      pValue?: number
      effectSize?: number
      lagDays?: number
      treatedUnit?: string
      controlUnits?: string[]
    }>
    selectedMethod?: {
      method: 'granger' | 'difference_in_differences' | 'synthetic_control'
      title: string
      signal: string
      confidence: number
      pValue?: number
      effectSize?: number
      lagDays?: number
    } | null
    significant: boolean
    interpretation: string
  }
}

type SimulationPreviewResponse = {
  data: {
    scenario: string
    pointEstimate: number
    projectedRevenue: number
    projectedMargin: number
    confidenceInterval: [number, number]
    percentile10: number
    percentile90: number
    calibrationScore: number
    historicalAccuracy: number
    recommendation: string
    interpretation: string
  }
}

type WorkflowExecutionSummary = {
  id: string
  ruleId: string
  ruleName: string
  trigger: string
  action: string
  status: string
  approvalStatus: string
  createdAt: string
  approvedAt: string | null
  approvedBy: string | null
  triggerData: unknown
  actionTaken: unknown
  result: unknown
  errorMessage: string | null
}

type WorkflowDashboardResponse = {
  data: {
    workflows: Array<{
      id: string
      name: string
      trigger: string
      isActive: boolean
      requiresApproval: boolean
      priority: number
      maxAutoAmount: number
      executionCount: number
      successCount: number
      updatedAt: string
    }>
    pendingApprovals: WorkflowExecutionSummary[]
    recentExecutions: WorkflowExecutionSummary[]
    stats: {
      totalWorkflows: number
      activeWorkflows: number
      pendingApprovalsCount: number
      successRate: number
      executionCount: number
    }
  }
}

type AssistantIncomeBreakdown = {
  totalIncome: number
  salesIncome: number
  subscriptionIncome: number
  hasSubscriptionIncomeSource?: boolean
  streamMix: {
    salesPct: number
    subscriptionPct: number
  }
}

type AssistantReply = {
  id: string
  prompt: string
  response: string
  createdAt: string
  currencyCode?: string
  incomeBreakdown?: AssistantIncomeBreakdown
  conversationId?: string
  provider?: string
  groundingSource?: 'internal' | 'external'
  externalData?: {
    externalGroundingReady: boolean
    contractIssues: ExternalGroundingContractIssue[]
  } | null
  sourceRecommendationId?: string
  brief?: AssistantBrief
}

type HumanApprovalQueueItem = {
  recommendationId: string
  status: 'OPEN' | 'SNOOZED'
  createdAt: string
  prompt: string
  provider: string | null
  summary: string
  highPriorityHumanActions: string[]
}

type HumanApprovalQueueResponse = {
  data: HumanApprovalQueueItem[]
}

type HumanApprovalHistoryEntry = {
  id: string
  action: string
  note: string | null
  createdAt: string
  actor: {
    userId: string
    firstName: string
    lastName: string
    email: string
    role: string
  } | null
}

type HumanApprovalHistoryResponse = {
  data: {
    recommendationId: string
    status: string
    title: string
    summary: string
    actedAt: string | null
    actedByUserId: string | null
    history: HumanApprovalHistoryEntry[]
  }
}

function shouldShowSubscriptionIncomeRow(incomeBreakdown?: AssistantIncomeBreakdown): boolean {
  if (!incomeBreakdown) return false
  return Number(incomeBreakdown.subscriptionIncome) > 0
}

function shouldShowIncomeBreakdownForPrompt(prompt: string, incomeBreakdown?: AssistantIncomeBreakdown): boolean {
  if (!incomeBreakdown) return false
  if (/(restock|reorder|inventory|stockout|stock out|shortage|replenish|low stock|stock level)/i.test(prompt)) {
    return false
  }
  return Number(incomeBreakdown.totalIncome) > 0 || shouldShowSubscriptionIncomeRow(incomeBreakdown)
}

type AssistantLibraryResponse = {
  data: AssistantReply[]
}

type AssistantLibrarySaveResponse = {
  data: AssistantReply
}

type ActionTrackerStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'

type ActionTrackerState = {
  ownerUserId: string
  dueDate: string | null
  status: ActionTrackerStatus
  expectedImpactScore: number | null
  realizedImpactScore: number | null
  impactNotes: string | null
  progressNote: string | null
  updatedAt: string
}

type ActionItem = {
  recommendationId: string
  recommendationType: string
  title: string
  summary: string
  recommendationStatus: string
  createdAt: string
  updatedAt: string
  tracker: ActionTrackerState
}

type ActionListResponse = {
  data: {
    tenantId: string
    total: number
    statusCounts: Record<string, number>
    items: ActionItem[]
  }
}

type ActionUpdateDraft = {
  status: ActionTrackerStatus
  realizedImpactScore: string
  progressNote: string
}

type AlertPriority = 'P1' | 'P2' | 'P3'

type AlertPolicyDraft = {
  minPriorityToNotify: AlertPriority
  quietHoursStartUtc: string
  quietHoursEndUtc: string
  suppressAfterAckHours: string
  dedupeP1Hours: string
  dedupeP2Hours: string
  dedupeP3Hours: string
}

type AlertPolicyResponse = {
  data: {
    tenantId: string
    source: 'defaults' | 'tenant-signal'
    signalId: string | null
    updatedAt: string | null
    updatedByUserId: string | null
    policy: {
      minPriorityToNotify: AlertPriority
      quietHoursStartUtc: number | null
      quietHoursEndUtc: number | null
      suppressAfterAckHours: number
      dedupeHoursByPriority: {
        P1: number
        P2: number
        P3: number
      }
    }
    revisions: Array<{
      id: string
      effectiveDate: string
      createdByUserId: string
      source: string
      tags: string[]
      policy: {
        minPriorityToNotify: AlertPriority
        quietHoursStartUtc: number | null
        quietHoursEndUtc: number | null
        suppressAfterAckHours: number
        dedupeHoursByPriority: {
          P1: number
          P2: number
          P3: number
        }
      }
    }>
  }
}

type MetricsResponse = {
  data: {
    tenantId: string
    recentMetrics: Array<{
      id: string
      metricKey: string
      metricValue: number
      dimensions: unknown
      measuredAt: string
    }>
  }
}

type ReliabilityPanelData = {
  groundingQualityAvg: number | null
  fallbackRate: number | null
  responseP95LatencyMs: number | null
  externalProviderAvgLatencyMs: number | null
  freshnessHours: number | null
  sampleSize: number
}

type ExternalGroundingContractIssue = {
  entity: string
  missingMappings: string[]
  missingSchemaColumns: string[]
}

type ExternalGroundingContextData = {
  providerContext: {
    source: 'internal' | 'external'
    externalGroundingReady: boolean
  }
  externalData: null | {
    providerType: string
    status: string
    validationState: string
    groundingEnabled: boolean
    contractIssues: ExternalGroundingContractIssue[]
    lastValidatedAt: string | null
    lastValidationError: string | null
    host: string
    databaseName: string
    schemaName: string
  }
}

type ExternalMappingEntityKey = 'sales' | 'saleItems' | 'expenses' | 'products' | 'inventory' | 'branches'

type ExternalSchemaTable = {
  name: string
  columns: Array<{
    name: string
    dataType: string
    nullable: boolean
  }>
}

type ExternalEntityMapping = {
  table: string
  columns: Record<string, string>
}

type ExternalMappingConfig = Partial<Record<ExternalMappingEntityKey, ExternalEntityMapping>>

type ExternalDataConnectionSummary = {
  id: string
  tenantId: string
  providerType: string
  connectionName: string | null
  host: string
  port: number
  databaseName: string
  schemaName: string
  sslRequired: boolean
  status: string
  validationState: string
  groundingEnabled: boolean
  isActive: boolean
  lastValidatedAt: string | null
  lastValidationError: string | null
  lastHealthStatus: string | null
  lastHealthAt: string | null
  hasStoredCredentials: boolean
  schemaSnapshot: {
    tableCount: number
    tables: ExternalSchemaTable[]
  } | null
  mappingConfig: ExternalMappingConfig
  contractIssues: ExternalGroundingContractIssue[]
}

type ExternalDiscoveryResult = {
  tables: ExternalSchemaTable[]
  suggestions: ExternalMappingConfig
  defaultTransactionReadOnly: boolean
}

type ExternalValidationResult = {
  ok: boolean
  requiredEntitiesMapped: string[]
  missingEntities: string[]
  entityResults: Array<{
    entity: ExternalMappingEntityKey
    ok: boolean
    table?: string
    rowCount?: number
    checkedColumns: string[]
    error?: string
  }>
}

type ExternalConnectionFormState = {
  connectionName: string
  host: string
  port: string
  databaseName: string
  schemaName: string
  sslRequired: boolean
  username: string
  password: string
}

type ExternalProvisioningProfile = 'generic' | 'supabase' | 'neon' | 'aws_rds' | 'self_hosted'

const EXTERNAL_CONNECTION_FORM_DEFAULTS: ExternalConnectionFormState = {
  connectionName: '',
  host: '',
  port: '5432',
  databaseName: '',
  schemaName: 'public',
  sslRequired: true,
  username: '',
  password: '',
}

const EXTERNAL_MAPPING_REQUIREMENTS: Array<{
  key: ExternalMappingEntityKey
  label: string
  description: string
  requiredColumns: string[]
  optionalColumns?: string[]
}> = [
  {
    key: 'sales',
    label: 'Sales',
    description: 'Header-level sales transactions for revenue trends and branch comparisons.',
    requiredColumns: ['id', 'date', 'totalAmount', 'currency', 'branchId'],
  },
  {
    key: 'saleItems',
    label: 'Sale Items',
    description: 'Line items used for SKU-level demand and basket analysis.',
    requiredColumns: ['saleId', 'productId', 'quantity', 'subtotal'],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Operating expense rows for margin, burn, and anomaly checks.',
    requiredColumns: ['date', 'amount', 'category', 'title', 'branchId'],
  },
  {
    key: 'products',
    label: 'Products',
    description: 'Product catalog and stock metrics used by pricing and replenishment workflows.',
    requiredColumns: ['id', 'name', 'category', 'costPrice', 'sellingPrice', 'currentStock', 'lowStockThreshold', 'branchId'],
    optionalColumns: ['purchaseDate', 'originalCostPrice'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Branch inventory snapshots used when stock is tracked outside the product table.',
    requiredColumns: ['productId', 'quantity', 'branchId'],
  },
  {
    key: 'branches',
    label: 'Branches',
    description: 'Branch dimension table for location names and branch-level grounding.',
    requiredColumns: ['id', 'name'],
  },
]

const EXTERNAL_ENTITY_TABLE_HINTS: Record<ExternalMappingEntityKey, string[]> = {
  sales: ['sales', 'orders', 'transactions', 'invoices'],
  saleItems: ['sale_items', 'order_items', 'invoice_items', 'line_items'],
  expenses: ['expenses', 'costs', 'bills', 'payments'],
  products: ['products', 'items', 'inventory_products', 'goods'],
  inventory: ['inventory', 'stock', 'inventory_items'],
  branches: ['branches', 'stores', 'locations', 'subsidiaries'],
}

const EXTERNAL_ENTITY_COLUMN_HINTS: Record<ExternalMappingEntityKey, Record<string, string[]>> = {
  sales: {
    id: ['id', 'sale_id', 'order_id', 'invoice_id'],
    date: ['date', 'created_at', 'sale_date', 'order_date', 'invoice_date'],
    totalAmount: ['total_amount', 'amount', 'grand_total', 'total'],
    currency: ['currency', 'currency_code'],
    branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
  },
  saleItems: {
    saleId: ['sale_id', 'order_id', 'invoice_id'],
    productId: ['product_id', 'item_id'],
    quantity: ['quantity', 'qty', 'count'],
    subtotal: ['subtotal', 'line_total', 'amount'],
  },
  expenses: {
    date: ['date', 'created_at', 'expense_date'],
    amount: ['amount', 'total_amount'],
    category: ['category', 'expense_category', 'type'],
    title: ['title', 'name', 'description'],
    branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
  },
  products: {
    id: ['id', 'product_id', 'item_id'],
    name: ['name', 'product_name', 'title'],
    category: ['category', 'type'],
    costPrice: ['cost_price', 'cost'],
    originalCostPrice: ['original_cost_price', 'purchase_cost', 'initial_cost', 'unit_cost'],
    purchaseDate: ['purchase_date', 'received_at', 'received_date', 'acquired_at', 'created_at'],
    sellingPrice: ['selling_price', 'price', 'unit_price'],
    currentStock: ['current_stock', 'stock_on_hand', 'quantity', 'qty', 'stock'],
    lowStockThreshold: ['low_stock_threshold', 'reorder_level', 'reorder_point', 'minimum_stock'],
    branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
  },
  inventory: {
    productId: ['product_id', 'item_id'],
    quantity: ['quantity', 'qty', 'stock', 'stock_on_hand'],
    branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
  },
  branches: {
    id: ['id', 'branch_id', 'store_id', 'location_id'],
    name: ['name', 'branch_name', 'store_name', 'location_name'],
  },
}

function normalizeExternalSchemaToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function scoreExternalSchemaCandidate(value: string, candidates: string[]): number {
  const normalizedValue = normalizeExternalSchemaToken(value)
  if (!normalizedValue) return 0

  let bestScore = 0
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeExternalSchemaToken(candidate)
    if (!normalizedCandidate) continue
    if (normalizedValue === normalizedCandidate) return 100
    if (normalizedValue.startsWith(normalizedCandidate) || normalizedCandidate.startsWith(normalizedValue)) {
      bestScore = Math.max(bestScore, 80)
      continue
    }
    if (normalizedValue.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedValue)) {
      bestScore = Math.max(bestScore, 65)
      continue
    }

    const candidateTokens = candidate.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    const valueTokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    const overlap = candidateTokens.filter((token) => valueTokens.includes(token)).length
    if (overlap > 0) bestScore = Math.max(bestScore, 40 + overlap * 10)
  }

  return bestScore
}

function pickBestExternalColumnMatch(table: ExternalSchemaTable, candidates: string[]): string | undefined {
  let bestMatch: string | undefined
  let bestScore = 0
  for (const column of table.columns) {
    const score = scoreExternalSchemaCandidate(column.name, candidates)
    if (score > bestScore) {
      bestScore = score
      bestMatch = column.name
    }
  }
  return bestScore >= 40 ? bestMatch : undefined
}

function buildSuggestedExternalColumns(entity: ExternalMappingEntityKey, table: ExternalSchemaTable): Record<string, string> {
  const hints = EXTERNAL_ENTITY_COLUMN_HINTS[entity]
  const suggested: Record<string, string> = {}
  for (const [columnKey, candidates] of Object.entries(hints)) {
    const match = pickBestExternalColumnMatch(table, candidates)
    if (match) suggested[columnKey] = match
  }
  return suggested
}

function buildExternalMappingColumnsForTable(
  entity: ExternalMappingEntityKey,
  table: ExternalSchemaTable | null,
  currentColumns?: Record<string, string>,
): Record<string, string> {
  const requirement = EXTERNAL_MAPPING_REQUIREMENTS.find((item) => item.key === entity)
  if (!requirement) return {}

  if (!table) {
    return Object.fromEntries(
      Object.entries(currentColumns || {}).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
    )
  }

  const availableColumnNames = new Set(table.columns.map((column) => column.name))
  const suggestedColumns = buildSuggestedExternalColumns(entity, table)
  const nextColumns: Record<string, string> = {}

  for (const columnKey of [...requirement.requiredColumns, ...(requirement.optionalColumns || [])]) {
    const currentValue = currentColumns?.[columnKey]?.trim()
    if (currentValue && availableColumnNames.has(currentValue)) {
      nextColumns[columnKey] = currentValue
      continue
    }
    const suggestedValue = suggestedColumns[columnKey]
    if (suggestedValue) nextColumns[columnKey] = suggestedValue
  }

  return nextColumns
}

function buildExternalConnectionForm(summary: ExternalDataConnectionSummary | null): ExternalConnectionFormState {
  if (!summary) return { ...EXTERNAL_CONNECTION_FORM_DEFAULTS }
  return {
    connectionName: summary.connectionName || '',
    host: summary.host,
    port: String(summary.port || 5432),
    databaseName: summary.databaseName,
    schemaName: summary.schemaName || 'public',
    sslRequired: summary.sslRequired,
    username: '',
    password: '',
  }
}

function mergeExternalMappingSuggestions(current: ExternalMappingConfig, suggestions: ExternalMappingConfig): ExternalMappingConfig {
  const merged: ExternalMappingConfig = { ...current }
  for (const entity of EXTERNAL_MAPPING_REQUIREMENTS) {
    const currentMapping = current[entity.key]
    const suggestedMapping = suggestions[entity.key]
    if (!currentMapping?.table && suggestedMapping?.table) {
      merged[entity.key] = suggestedMapping
      continue
    }
    if (currentMapping?.table && suggestedMapping?.columns) {
      merged[entity.key] = {
        table: currentMapping.table,
        columns: {
          ...suggestedMapping.columns,
          ...currentMapping.columns,
        },
      }
    }
  }
  return merged
}

function sanitizeExternalMappingConfig(mappingConfig: ExternalMappingConfig): ExternalMappingConfig {
  const sanitized: ExternalMappingConfig = {}
  for (const entity of EXTERNAL_MAPPING_REQUIREMENTS) {
    const mapping = mappingConfig[entity.key]
    const table = mapping?.table?.trim()
    if (!table) continue
    const columns = Object.fromEntries(
      Object.entries(mapping?.columns || {}).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
    )
    sanitized[entity.key] = {
      table,
      columns,
    }
  }
  return sanitized
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildReportingUserSql(args: {
  username: string
  databaseName: string
  schemaName: string
}): string {
  const username = args.username.trim() || 'reporting_reader'
  const databaseName = args.databaseName.trim() || 'your_database'
  const schemaName = args.schemaName.trim() || 'public'
  return [
    `CREATE ROLE ${quoteSqlIdentifier(username)} LOGIN PASSWORD ${quoteSqlLiteral('replace-with-strong-password')};`,
    `ALTER ROLE ${quoteSqlIdentifier(username)} SET default_transaction_read_only = on;`,
    `GRANT CONNECT ON DATABASE ${quoteSqlIdentifier(databaseName)} TO ${quoteSqlIdentifier(username)};`,
    `GRANT USAGE ON SCHEMA ${quoteSqlIdentifier(schemaName)} TO ${quoteSqlIdentifier(username)};`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteSqlIdentifier(schemaName)} TO ${quoteSqlIdentifier(username)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteSqlIdentifier(schemaName)} GRANT SELECT ON TABLES TO ${quoteSqlIdentifier(username)};`,
    '',
    `-- Verify in a session for ${username}`,
    'SHOW default_transaction_read_only;',
  ].join('\n')
}

const EXTERNAL_PROVISIONING_PROFILES: Array<{
  key: ExternalProvisioningProfile
  label: string
  summary: string
  notes: string[]
}> = [
  {
    key: 'generic',
    label: 'Generic PostgreSQL',
    summary: 'Use when you have normal PostgreSQL admin access and can run role and grant statements directly.',
    notes: [
      'Run the generated SQL with a database admin account.',
      'Replace the placeholder password before executing the script.',
      'Confirm the reporting user can connect and SHOW default_transaction_read_only returns on.',
    ],
  },
  {
    key: 'supabase',
    label: 'Supabase',
    summary: 'Use the Supabase SQL editor with a privileged project role, then connect StockPilotPro with the generated reporting user.',
    notes: [
      'Run the generated SQL in the Supabase SQL editor under the project owner/admin connection.',
      'Make sure your grants cover the schema that holds the reporting tables, often public.',
      'Use the project database host and the new reporting username in the StockPilotPro connection form.',
    ],
  },
  {
    key: 'neon',
    label: 'Neon',
    summary: 'Use a Neon role with read-only defaults if your branch allows role management.',
    notes: [
      'Run the generated SQL from psql or Neon SQL editor using an admin-capable role on the target branch.',
      'If branch-level permissions restrict role creation, create the role on the parent environment first.',
      'Use the branch connection host together with the generated reporting username in StockPilotPro.',
    ],
  },
  {
    key: 'aws_rds',
    label: 'AWS RDS / Aurora',
    summary: 'Run the generated statements through Query Editor, psql, or another admin session against the instance or cluster.',
    notes: [
      'Use the master or delegated admin user to create the reporting role and grants.',
      'If IAM auth is enabled for your environment, keep StockPilotPro on normal password auth for this reporting user unless you add a custom integration layer.',
      'Verify the role against the same database and schema you will connect to from StockPilotPro.',
    ],
  },
  {
    key: 'self_hosted',
    label: 'Self-hosted PostgreSQL',
    summary: 'Use psql, pgAdmin, or your existing DBA workflow to create a constrained reporting user.',
    notes: [
      'Prefer a dedicated reporting account rather than reusing an application login.',
      'Limit network access for the reporting user to the StockPilotPro host or VPN if possible.',
      'Re-run the grant statements if you move tables to a different schema.',
    ],
  },
]

function ConfidenceGauge({ value, max = 100, label, size = 'md' }: { value: number; max?: number; label?: string; size?: 'sm' | 'md' | 'lg' }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const colorClass = pct >= 85 ? 'from-emerald-500 to-emerald-400' : pct >= 60 ? 'from-amber-400 to-amber-300' : 'from-rose-500 to-rose-400'
  const textColor = pct >= 85 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-700' : 'text-rose-700'
  const height = size === 'sm' ? 'h-2' : size === 'lg' ? 'h-4' : 'h-2.5'

  return (
    <div className="space-y-1">
      {label && <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>}
      <div className="flex items-center gap-2">
        <div className={`flex-1 rounded-full bg-gray-200 ${height} overflow-hidden`}>
          <div
            className={`${height} rounded-full bg-gradient-to-r ${colorClass} transition-all duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-${size === 'sm' ? 'xs' : 'sm'} font-bold tabular-nums ${textColor} min-w-[3.5rem] text-right`}>
          {value.toFixed(size === 'sm' ? 0 : 1)}{max === 100 ? '%' : ''}
        </span>
      </div>
    </div>
  )
}

function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 space-y-3 animate-pulse ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={`skel-${i}`} className="flex items-center gap-3">
          <div className="h-3 bg-gray-200 rounded flex-1" style={{ width: `${60 + Math.random() * 40}%` }} />
          {i === 0 && <div className="h-3 bg-gray-200 rounded w-16" />}
        </div>
      ))}
    </div>
  )
}

const PRESET_PROMPTS = [
  { label: '🔍 Stock Risks', prompt: 'Which products are at risk of stockout in the next 14 days? Prioritize by urgency.' },
  { label: '📊 Branch Revenue', prompt: 'Compare branch revenue trends this month versus last month. Highlight top and bottom performers.' },
  { label: '💰 Cash Flow', prompt: 'Analyze cash runway based on current burn rate and provide 90-day forecast.' },
  { label: '📦 Reorder Plan', prompt: 'Generate a reorder plan for low-stock items with suggested quantities and timing.' },
  { label: '⚠️ High Expenses', prompt: 'Identify expense categories with the biggest increase this month and recommend cost controls.' },
  { label: '🎯 Pricing Review', prompt: 'Review product pricing against margins and recommend adjustments for top 10 products.' },
]

function getConfidenceBadge(score: number | null | undefined): { label: string; classes: string; icon: string } {
  if (score === null || score === undefined) return { label: 'Pending', classes: 'border-gray-200 bg-gray-50 text-gray-600', icon: '⏳' }
  if (score >= 0.85) return { label: 'High Confidence', classes: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: '🟢' }
  if (score >= 0.60) return { label: 'Moderate Confidence', classes: 'border-amber-200 bg-amber-50 text-amber-700', icon: '🟡' }
  return { label: 'Low Confidence — Verify', classes: 'border-rose-200 bg-rose-50 text-rose-700', icon: '🔴' }
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  const errorPayload = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error
  if (typeof errorPayload === 'string' && errorPayload.trim()) {
    if (/default_transaction_read_only=on|no write privileges on the target schema/i.test(errorPayload)) {
      return 'This PostgreSQL user is not read-only enough for Phase 1. Either set default_transaction_read_only to on for the reporting user, or remove all write privileges from that user on the target schema so it is effectively read-only before reconnecting.'
    }
    return errorPayload
  }
  if (Array.isArray(errorPayload)) return fallback
  return fallback
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toTextValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getWorkflowStatusUi(status: string): { label: string; classes: string } {
  if (status === 'executed') return { label: 'Executed', classes: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  if (status === 'rolled_back') return { label: 'Rolled Back', classes: 'border-slate-300 bg-slate-100 text-slate-700' }
  if (status === 'handoff_required') return { label: 'Handoff', classes: 'border-violet-200 bg-violet-50 text-violet-700' }
  if (status === 'failed') return { label: 'Failed', classes: 'border-rose-200 bg-rose-50 text-rose-700' }
  if (status === 'pending_approval') return { label: 'Pending Approval', classes: 'border-amber-200 bg-amber-50 text-amber-700' }
  if (status === 'rejected') return { label: 'Rejected', classes: 'border-rose-200 bg-rose-50 text-rose-700' }
  if (status === 'executing') return { label: 'Executing', classes: 'border-sky-200 bg-sky-50 text-sky-700' }
  return { label: status.replace(/_/g, ' '), classes: 'border-gray-200 bg-gray-50 text-gray-700' }
}

function summarizeWorkflowOutcome(result: unknown): {
  operation: string | null
  actualImpact: number | null
  measuredAt: string | null
  rolledBackAt: string | null
  message: string | null
  handoffRequired: boolean
  rollbackReady: boolean
  detailLines: string[]
} {
  const record = toRecord(result)
  const operation = toTextValue(record.operation)
  const actualImpact = toFiniteNumber(record.actualImpact)
  const measuredAt = toTextValue(record.measuredAt)
  const rolledBackAt = toTextValue(record.rolledBackAt)
  const message = toTextValue(record.message)
  const handoffRequired = record.handoffRequired === true
  const rollbackReady = record.rollbackReady === true
  const detailLines: string[] = []

  const units = toFiniteNumber(record.units)
  if (units !== null) detailLines.push(`Units moved: ${units.toLocaleString()}`)

  const previousPrice = toFiniteNumber(record.previousPrice)
  const newPrice = toFiniteNumber(record.newPrice)
  if (previousPrice !== null && newPrice !== null) {
    detailLines.push(`Price updated from ${previousPrice.toLocaleString()} to ${newPrice.toLocaleString()}`)
  }

  const expenseId = toTextValue(record.expenseId)
  if (expenseId) detailLines.push(`Expense record: ${expenseId}`)

  const notificationId = toTextValue(record.notificationId)
  if (notificationId) detailLines.push(`Notification: ${notificationId}`)

  const sourceProductId = toTextValue(record.sourceProductId)
  const targetProductId = toTextValue(record.targetProductId)
  if (sourceProductId && targetProductId) {
    detailLines.push(`Transfer route: ${sourceProductId} -> ${targetProductId}`)
  }

  return {
    operation,
    actualImpact,
    measuredAt,
    rolledBackAt,
    message,
    handoffRequired,
    rollbackReady,
    detailLines,
  }
}

function stringifyWorkflowPayload(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return 'Unable to render payload'
  }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function toHourOrEmpty(value: number | null): string {
  if (value === null || Number.isNaN(Number(value))) return ''
  return String(value)
}

function clampIntString(raw: string, min: number, max: number): string {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return ''
  return String(Math.max(min, Math.min(max, Math.round(parsed))))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPrintListSection(title: string, items: string[]): string {
  if (!items.length) return ''
  const rendered = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  return `<section><h3>${escapeHtml(title)}</h3><ul>${rendered}</ul></section>`
}

type IssueTone = 'critical' | 'moderate' | 'positive' | 'info'

function getIssueTone(severity: 'critical' | 'warning' | 'info', message: string): IssueTone {
  const text = message.toLowerCase()
  const hasNegatedUrgency = /(no\s+critical|no\s+urgent|no\s+stockout|no\s+immediate|without\s+critical|resolved\s+critical|0\s+critical|0\s+urgent|0\s+stockout|0\s+loss\-making|no\s+branch\s+distress)/.test(text)
  const isPositive = /(improv|improved|increase|grew|growth|profitable|healthy|stable|resolved|adequate|above\s+threshold|good|excellent|on\s+track|success|achievement|no\s+critical|no\s+urgent|no\s+stockout)/.test(text)
  const isUrgent = /(urgent|immediate|critical|stockout|operating\s+at\s+a\s+loss|business\s+is\s+operating\s+at\s+a\s+loss|emergency|high\s+risk|crashed|collapsed)/.test(text)
  const isModerate = /(moderate|warning|risk|declin|spike|thin\s+margin|unresolved|attention|important|monitor)/.test(text)
  const isRiskContext = /(obsolescence|holding\s+cost|storage\s+cost|tied\-up\s+capital|tied\s+up\s+capital|cash\s+tied|days\s+of\s+inventory)/.test(text)

  if (severity === 'critical' && !hasNegatedUrgency) return 'critical'
  if (severity === 'warning') return 'moderate'
  if (isUrgent && !hasNegatedUrgency) return 'critical'
  if (isModerate || isRiskContext) return 'moderate'
  if (isPositive && !isUrgent && !isRiskContext) return 'positive'
  return 'info'
}

function getIssueToneUi(tone: IssueTone): { label: string; classes: string } {
  if (tone === 'critical') {
    return { label: '🚨 Critical', classes: 'border-rose-200 bg-rose-50 text-rose-700' }
  }
  if (tone === 'moderate') {
    return { label: '⚠ Moderate', classes: 'border-amber-200 bg-amber-50 text-amber-700' }
  }
  if (tone === 'positive') {
    return { label: '✅ Achievement', classes: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  }
  return { label: 'ℹ Info', classes: 'border-sky-200 bg-sky-50 text-sky-700' }
}

function isBenignIssueMessage(message: string): boolean {
  const text = message.toLowerCase().trim()
  return /(^|\b)(no\s+immediate|no\s+critical|no\s+urgent|no\s+stockout|no\s+branch\s+distress|0\s+critical|0\s+stockout|0\s+loss\-making)(\b|$)/.test(text)
}

function extractPositiveCount(text: string, pattern: RegExp): number {
  const match = text.match(pattern)
  if (!match) return 0
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeEntityName(raw: string): string {
  return raw
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/[;,.]+$/g, '')
    .trim()
}

function extractIssueEntities(reply: AssistantReply): {
  stockItems: string[]
  branches: string[]
  general: string[]
} {
  const texts = [
    reply.response || '',
    reply.brief?.summary || '',
    ...(reply.brief?.comparativeInsights || []),
    ...(reply.brief?.actions || []),
    ...(reply.brief?.risks || []),
  ]

  const stockItemSet = new Set<string>()
  const branchSet = new Set<string>()
  const generalSet = new Set<string>()

  const maybeAdd = (candidate: string, bucket: Set<string>) => {
    const value = normalizeEntityName(candidate)
    if (!value || value.length < 2) return
    if (/^(uncategorized|important|critical|monitor|this week|immediate)$/i.test(value)) return
    bucket.add(value)
    generalSet.add(value)
  }

  for (const text of texts) {
    let match: RegExpExecArray | null

    const quoted = /['\"]([^'\"]{2,70})['\"]/g
    while ((match = quoted.exec(text)) !== null) {
      maybeAdd(match[1], generalSet)
    }

    const stockFromAction = /(?:order|reorder|po\s+for|units\s+of)\s+\d*\s*units?\s+of\s+([A-Za-z0-9][A-Za-z0-9 "&\-().]{1,70})/ig
    while ((match = stockFromAction.exec(text)) !== null) {
      maybeAdd(match[1], stockItemSet)
    }

    const stockFromBullet = /(?:^|•)\s*([A-Za-z0-9][A-Za-z0-9 "&\-().]{1,70})\s*\(/g
    while ((match = stockFromBullet.exec(text)) !== null) {
      maybeAdd(match[1], stockItemSet)
    }

    const branchRegex = /\b([A-Za-z0-9][A-Za-z0-9 "&\-().]{1,50}\s+Branch)\b/ig
    while ((match = branchRegex.exec(text)) !== null) {
      maybeAdd(match[1], branchSet)
    }
  }

  return {
    stockItems: Array.from(stockItemSet).slice(0, 8),
    branches: Array.from(branchSet).slice(0, 8),
    general: Array.from(generalSet).slice(0, 12),
  }
}

function enrichIssueWithEntities(
  issue: { severity: 'critical' | 'warning' | 'info'; message: string; actionRequired: string },
  entities: { stockItems: string[]; branches: string[]; general: string[] },
): { severity: 'critical' | 'warning' | 'info'; message: string; actionRequired: string } {
  if (/\baffected:\b/i.test(issue.message)) return issue

  const msg = issue.message.toLowerCase()
  let involved: string[] = []

  if (/(stock|inventory|sku|reorder|stockout|obsolescence|holding\s*cost|days\s+of\s+inventory)/i.test(msg)) {
    involved = entities.stockItems.length ? entities.stockItems : entities.general
  } else if (/branch/i.test(msg)) {
    involved = entities.branches.length ? entities.branches : entities.general
  } else {
    involved = entities.general
  }

  if (!involved.length) return issue
  return {
    ...issue,
    message: `${issue.message} Affected: ${involved.slice(0, 4).join(', ')}.`,
  }
}

function buildAutoDetectedIssueList(reply: AssistantReply): Array<{
  severity: 'critical' | 'warning' | 'info'
  message: string
  actionRequired: string
}> {
  const entities = extractIssueEntities(reply)
  const issues = (reply.brief?.alerts || [])
    .filter((item) => item && typeof item.message === 'string' && item.message.trim())
    .filter((item) => !isBenignIssueMessage(item.message))
    .map((item) => ({
      severity: item.severity,
      message: item.message.trim(),
      actionRequired: (item.actionRequired || '').trim() || 'Review and take action',
    }))

  const metrics = reply.brief?.financialMetrics
  if (metrics) {
    if (typeof metrics.margin === 'number' && typeof metrics.expenseRatio === 'number' && metrics.margin >= 95 && metrics.expenseRatio <= 1) {
      issues.push({
        severity: 'warning',
        message: 'Possible reporting anomaly: margin is near 100% while expense ratio is near 0%. Verify COGS and expense categorization.',
        actionRequired: 'Run a ledger audit for missing COGS and uncategorized expenses in this period',
      })
    }

    if (typeof metrics.profit === 'number' && metrics.profit < 0) {
      issues.push({
        severity: 'critical',
        message: 'Business is operating at a net loss in the analyzed window.',
        actionRequired: 'Reduce controllable costs and prioritize highest-margin products immediately',
      })
    }

    if (typeof metrics.inventoryTurnover === 'number' && metrics.inventoryTurnover < 1) {
      issues.push({
        severity: 'warning',
        message: `Inventory turnover is ${metrics.inventoryTurnover.toFixed(1)}x, indicating slow stock movement.`,
        actionRequired: 'Review dead stock and rebalance reorder quantities for slow-moving SKUs',
      })
    }

    if (typeof metrics.cashRunway === 'number' && metrics.cashRunway > 0 && metrics.cashRunway < 2) {
      issues.push({
        severity: 'critical',
        message: `Cash runway is low at ${metrics.cashRunway.toFixed(1)} months.`,
        actionRequired: 'Activate cash-preservation plan and defer non-essential spend',
      })
    }
  }

  const sourceText = `${reply.response || ''} ${reply.brief?.summary || ''}`
  const p1Count = extractPositiveCount(sourceText, /(\d+)\s+CRITICAL\s*\(P1/i)
  const p2Count = extractPositiveCount(sourceText, /(\d+)\s+IMPORTANT\s*\(P2/i)
  const stockoutCount = extractPositiveCount(sourceText, /(\d+)\s+stockout\s+risks?/i)

  if (p1Count > 0) {
    issues.push({
      severity: 'critical',
      message: `${p1Count} critical stockout item(s) detected.`,
      actionRequired: 'Create immediate purchase orders for P1 items today',
    })
  }
  if (p2Count > 0) {
    issues.push({
      severity: 'warning',
      message: `${p2Count} important stock-risk item(s) require action this week.`,
      actionRequired: 'Approve reorder plan for P2 items within 7 days',
    })
  }
  if (stockoutCount > 0 && p1Count === 0 && p2Count === 0) {
    issues.push({
      severity: 'warning',
      message: `${stockoutCount} stockout risk signal(s) identified in the latest analysis.`,
      actionRequired: 'Review SKU-level risk breakdown and update reorder priorities',
    })
  }

  if (issues.length > 0) {
    const deduped = new Map<string, { severity: 'critical' | 'warning' | 'info'; message: string; actionRequired: string }>()
    for (const issue of issues) {
      const key = issue.message.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!deduped.has(key)) deduped.set(key, issue)
    }
    return Array.from(deduped.values()).slice(0, 8).map((issue) => enrichIssueWithEntities(issue, entities))
  }

  const fallback = (reply.brief?.risks || [])
    .filter((item) => typeof item === 'string' && item.trim())
    .filter((risk) => !isBenignIssueMessage(risk))
    .filter((risk) => /(risk|loss|declin|spike|warning|below\s+threshold|stockout|distress|slow turnover|cash tied|excessive)/i.test(risk))
    .slice(0, 6)
    .map((risk) => {
      const lower = risk.toLowerCase()
      const hasNegatedUrgency = /(no\s+critical|no\s+urgent|no\s+stockout|without\s+critical|resolved\s+critical)/.test(lower)
      const isPositive = /(improv|improved|increase|grew|growth|profitable|healthy|stable|resolved|adequate|above\s+threshold|good|excellent|on\s+track|success|achievement|no\s+critical|no\s+urgent|no\s+stockout|0\s+critical|0\s+stockout)/.test(lower)
      const severity: 'critical' | 'warning' | 'info' = (!hasNegatedUrgency && /(critical|urgent|immediate|stockout|operating at a loss|business is operating at a loss|loss|emergency|high risk|crashed|collapsed)/.test(lower))
        ? 'critical'
        : (/(moderate|risk|declin|spike|warning|thin margin|unresolved|attention|important|monitor)/.test(lower))
          ? 'warning'
          : isPositive
            ? 'info'
            : 'info'

      return {
        severity,
        message: risk.trim(),
        actionRequired: 'Review this risk in the latest assistant recheck',
      }
    })

  return fallback.map((issue) => enrichIssueWithEntities(issue, entities))
}

function buildIncomeStreamsText(reply: AssistantReply, fallbackCurrency: string): string {
  const breakdown = reply.incomeBreakdown
  if (!breakdown || !shouldShowIncomeBreakdownForPrompt(reply.prompt, breakdown)) return 'Income streams not shown for this prompt.'

  const currency = reply.currencyCode || fallbackCurrency
  const showSubscription = shouldShowSubscriptionIncomeRow(breakdown)

  const lines = [
    `Total Income: ${currency} ${Number(breakdown.totalIncome).toLocaleString()}`,
    `Sales: ${currency} ${Number(breakdown.salesIncome).toLocaleString()} (${Number(breakdown.streamMix.salesPct).toFixed(1)}%)`,
  ]

  if (showSubscription) {
    lines.push(
      `Subscription: ${currency} ${Number(breakdown.subscriptionIncome).toLocaleString()} (${Number(breakdown.streamMix.subscriptionPct).toFixed(1)}%)`,
    )
  }

  return lines.join('\n')
}

function buildIncomeStreamsHtml(reply: AssistantReply, fallbackCurrency: string): string {
  const breakdown = reply.incomeBreakdown
  if (!breakdown || !shouldShowIncomeBreakdownForPrompt(reply.prompt, breakdown)) return ''

  const currency = escapeHtml(reply.currencyCode || fallbackCurrency)
  const showSubscription = shouldShowSubscriptionIncomeRow(breakdown)

  return `
    <section>
      <h3>Income Streams (30d)</h3>
      <ul>
        <li>Total Income: ${currency} ${escapeHtml(Number(breakdown.totalIncome).toLocaleString())}</li>
        <li>Sales: ${currency} ${escapeHtml(Number(breakdown.salesIncome).toLocaleString())} (${escapeHtml(Number(breakdown.streamMix.salesPct).toFixed(1))}%)</li>
        ${showSubscription
          ? `<li>Subscription: ${currency} ${escapeHtml(Number(breakdown.subscriptionIncome).toLocaleString())} (${escapeHtml(Number(breakdown.streamMix.subscriptionPct).toFixed(1))}%)</li>`
          : ''}
      </ul>
    </section>
  `
}

function buildIssuesText(reply: AssistantReply): string {
  const issues = buildAutoDetectedIssueList(reply)
  if (!issues.length) return 'No auto-detected issues.'
  return issues
    .map((issue) => {
      const tone = getIssueTone(issue.severity, issue.message)
      const label = tone === 'critical' ? 'CRITICAL' : tone === 'moderate' ? 'MODERATE' : tone === 'positive' ? 'POSITIVE' : 'INFO'
      return `[${label}] ${issue.message} | Action: ${issue.actionRequired}`
    })
    .join('\n')
}

function buildIssuesHtml(reply: AssistantReply): string {
  const issues = buildAutoDetectedIssueList(reply)
  if (!issues.length) return ''

  const rendered = issues
    .map((issue) => {
      const tone = getIssueTone(issue.severity, issue.message)
      const label = tone === 'critical' ? 'CRITICAL' : tone === 'moderate' ? 'MODERATE' : tone === 'positive' ? 'POSITIVE' : 'INFO'
      const severity = escapeHtml(label)
      const message = escapeHtml(issue.message)
      const action = escapeHtml(issue.actionRequired)
      return `<li><strong>[${severity}]</strong> ${message}<br /><em>Action:</em> ${action}</li>`
    })
    .join('')

  return `<section><h3>AI Auto-Detected Issues</h3><ul>${rendered}</ul></section>`
}

function buildContractIssueSummary(reply: AssistantReply): string {
  const issues = reply.externalData?.contractIssues || []
  if (!issues.length) return 'None'
  return issues
    .map((issue) => {
      const segments: string[] = []
      if (issue.missingMappings.length) segments.push(`missing mappings: ${issue.missingMappings.join(', ')}`)
      if (issue.missingSchemaColumns.length) segments.push(`missing schema columns: ${issue.missingSchemaColumns.join(', ')}`)
      return segments.length ? `${issue.entity} (${segments.join(' | ')})` : issue.entity
    })
    .join('; ')
}

function buildGroundingMetaText(reply: AssistantReply): string {
  const segments: string[] = []
  if (reply.provider) segments.push(`Provider: ${reply.provider}`)
  if (reply.groundingSource) segments.push(`Grounding: ${reply.groundingSource}`)
  if (reply.externalData) {
    segments.push(`External ready: ${reply.externalData.externalGroundingReady ? 'yes' : 'no'}`)
    if (reply.externalData.contractIssues.length) {
      segments.push(`Contract issues: ${reply.externalData.contractIssues.length}`)
    }
  }
  return segments.join(' | ')
}

function getBusinessGuidanceTone(mode?: 'clarification_needed' | 'insufficient_evidence' | 'monitor_only' | 'manual_intervention' | 'decision_ready') {
  switch (mode) {
    case 'decision_ready':
      return {
        card: 'border-emerald-200 bg-emerald-50',
        badge: 'border-emerald-300 bg-emerald-100 text-emerald-800',
      }
    case 'manual_intervention':
      return {
        card: 'border-sky-200 bg-sky-50',
        badge: 'border-sky-300 bg-sky-100 text-sky-800',
      }
    case 'clarification_needed':
      return {
        card: 'border-amber-200 bg-amber-50',
        badge: 'border-amber-300 bg-amber-100 text-amber-800',
      }
    case 'insufficient_evidence':
    case 'monitor_only':
    default:
      return {
        card: 'border-slate-200 bg-slate-50',
        badge: 'border-slate-300 bg-slate-100 text-slate-700',
      }
  }
}

function buildAssistantPrintHtml(reply: AssistantReply): string {
  const prompt = escapeHtml(reply.prompt)
  const response = escapeHtml(reply.response).replace(/\n/g, '<br />')
  const provider = reply.provider ? `<p><strong>Provider:</strong> ${escapeHtml(reply.provider)}</p>` : ''
  const grounding = reply.groundingSource ? `<p><strong>Grounding:</strong> ${escapeHtml(reply.groundingSource)}</p>` : ''
  const externalReady = reply.externalData ? `<p><strong>External Ready:</strong> ${reply.externalData.externalGroundingReady ? 'Yes' : 'No'}</p>` : ''
  const contractIssues = reply.externalData?.contractIssues.length
    ? `<p><strong>Contract Issues:</strong> ${escapeHtml(buildContractIssueSummary(reply))}</p>`
    : ''
  const createdAt = new Date(reply.createdAt).toLocaleString()
  const incomeSection = buildIncomeStreamsHtml(reply, 'NGN')
  const issuesSection = buildIssuesHtml(reply)

  const briefSection = reply.brief
    ? `
      <section>
        <h3>Structured Brief</h3>
        <p><strong>Summary:</strong> ${escapeHtml(reply.brief.summary)}</p>
        ${reply.brief.businessGuidance ? `<p><strong>Business Guidance:</strong> ${escapeHtml(reply.brief.businessGuidance.confidenceLabel)} | ${escapeHtml(reply.brief.businessGuidance.primaryRecommendation)} | ${escapeHtml(reply.brief.businessGuidance.expectedImpact)}</p>` : ''}
        ${buildPrintListSection('Comparative Insights', reply.brief.comparativeInsights)}
        ${buildPrintListSection('Actions', reply.brief.actions)}
        ${buildPrintListSection('Risks', reply.brief.risks)}
        ${buildPrintListSection('Follow-up Questions', reply.brief.followUpQuestions)}
        ${reply.brief.factBasis ? buildPrintListSection('Fact Basis', reply.brief.factBasis) : ''}
        ${reply.brief.groundingNotes ? buildPrintListSection('Grounding Notes', reply.brief.groundingNotes) : ''}
        ${reply.brief.scenarioAnalysis ? `<p><strong>Scenario:</strong> Best ${escapeHtml(reply.brief.scenarioAnalysis.bestScenario || 'N/A')} | Worst ${escapeHtml(reply.brief.scenarioAnalysis.worstScenario || 'N/A')} | Profit Spread ${escapeHtml(String(reply.brief.scenarioAnalysis.profitSpread))} | ROI Spread ${escapeHtml(String(reply.brief.scenarioAnalysis.roiSpread))}</p>` : ''}
        ${reply.brief.causalAnalysis ? buildPrintListSection('Causal Interventions', reply.brief.causalAnalysis.interventions) : ''}
        ${reply.brief.strategicInsights ? buildPrintListSection('Strategic Insights', reply.brief.strategicInsights.map((s) => `[${s.level}] ${s.insight} (ROI ${s.estimatedROI}%, ${s.timeHorizon})`)) : ''}
        ${reply.brief.executionPlan ? `<p><strong>Execution Plan:</strong> Auto ${reply.brief.executionPlan.autoExecutableCount}, Approval ${reply.brief.executionPlan.approvalRequiredCount}</p>` : ''}
        ${reply.brief.executionPlan?.highPriorityHumanActions ? buildPrintListSection('High-Priority Human Approvals', reply.brief.executionPlan.highPriorityHumanActions) : ''}
        ${issuesSection}
      </section>
    `
    : ''

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Saved Enterprise AI Assistant Result</title>
        <style>
          body { font-family: "Segoe UI", Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { margin-top: 22px; margin-bottom: 8px; font-size: 16px; }
          h3 { margin-top: 16px; margin-bottom: 6px; font-size: 14px; }
          p, li { font-size: 13px; line-height: 1.6; }
          .meta { color: #4b5563; font-size: 12px; margin-bottom: 12px; }
          .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f9fafb; }
          ul { margin: 8px 0 0 18px; }
          @media print {
            body { margin: 12mm; }
          }
        </style>
      </head>
      <body>
        <h1>Enterprise AI Assistant Record</h1>
        <p class="meta">Generated: ${escapeHtml(createdAt)}</p>
        ${provider}
        ${grounding}
        ${externalReady}
        ${contractIssues}

        <h2>Prompt</h2>
        <div class="card"><p>${prompt}</p></div>

        <h2>Response</h2>
        <div class="card"><p>${response}</p></div>

        ${incomeSection}

        ${briefSection}
      </body>
    </html>
  `
}

function printHtmlDocument(html: string): boolean {
  try {
    const printWindow = window.open('about:blank', '_blank', 'width=960,height=760')
    if (printWindow) {
      // Keep a detached opener to reduce cross-window coupling while retaining a usable handle.
      printWindow.opener = null
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()

      const triggerPopupPrint = () => {
        try {
          printWindow.focus()
          printWindow.print()
        } catch {
          // The iframe fallback below handles environments that block popup printing.
        }
      }

      if (printWindow.document.readyState === 'complete') {
        setTimeout(triggerPopupPrint, 80)
      } else {
        printWindow.addEventListener('load', () => setTimeout(triggerPopupPrint, 80), { once: true })
      }

      return true
    }
  } catch {
    // Fall back to iframe-based print below.
  }

  try {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'
    iframe.setAttribute('aria-hidden', 'true')

    document.body.appendChild(iframe)

    const frameWindow = iframe.contentWindow
    const frameDocument = frameWindow?.document
    if (!frameWindow || !frameDocument) {
      iframe.remove()
      return false
    }

    frameDocument.open()
    frameDocument.write(html)
    frameDocument.close()

    const triggerIframePrint = () => {
      try {
        frameWindow.focus()
        frameWindow.print()
      } finally {
        setTimeout(() => iframe.remove(), 1500)
      }
    }

    if (frameDocument.readyState === 'complete') {
      setTimeout(triggerIframePrint, 80)
    } else {
      iframe.addEventListener('load', () => setTimeout(triggerIframePrint, 80), { once: true })
    }

    return true
  } catch {
    return false
  }
}

function toCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""')
  return `"${escaped}"`
}

const MAX_ASSISTANT_PROMPT_LENGTH = 2000

function truncateForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function appendPromptLinesWithinLimit(target: string[], lines: string[], maxLength: number): number {
  let added = 0
  for (const line of lines) {
    const candidate = [...target, line].join('\n')
    if (candidate.length > maxLength) break
    target.push(line)
    added += 1
  }
  return added
}

function extractPriorityFocusFromReply(reply: AssistantReply): {
  priorityActions: string[]
  unresolvedIssues: string[]
} {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

  const actionCandidates = new Set<string>()
  const riskCandidates = new Set<string>()

  for (const item of reply.brief?.actions || []) {
    const cleaned = normalize(item)
    if (cleaned) actionCandidates.add(cleaned)
  }
  for (const item of reply.brief?.risks || []) {
    const cleaned = normalize(item)
    if (cleaned) riskCandidates.add(cleaned)
  }

  const responseLines = reply.response
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .filter(Boolean)

  for (const line of responseLines) {
    const actionLike = /(p1|p2|priority|urgent|immediate|next\s*7\s*days|action|todo|to-do|reorder|follow-up)/i.test(line)
    const issueLike = /(risk|issue|unresolved|pending|blocker|worse|critical|warning|stockout|loss|declin)/i.test(line)

    if (actionLike && line.length <= 220) {
      actionCandidates.add(line)
    }
    if (issueLike && line.length <= 220) {
      riskCandidates.add(line)
    }
  }

  const byPriorityThenLength = (a: string, b: string): number => {
    const rank = (value: string): number => {
      const lower = value.toLowerCase()
      if (/\bp1\b|critical|urgent|immediate/.test(lower)) return 0
      if (/\bp2\b|important|high\s+priority/.test(lower)) return 1
      if (/\bp3\b|monitor/.test(lower)) return 2
      return 3
    }
    return rank(a) - rank(b) || a.length - b.length
  }

  const priorityActions = Array.from(actionCandidates)
    .sort(byPriorityThenLength)
    .slice(0, 12)

  const unresolvedIssues = Array.from(riskCandidates)
    .sort(byPriorityThenLength)
    .slice(0, 12)

  return { priorityActions, unresolvedIssues }
}

export default function EnterpriseAIPage() {
  const user = useAuthStore((s) => s.user)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const [loading, setLoading] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [branchRows, setBranchRows] = useState<Array<{ branchName: string; revenue: number; expense: number; margin: number; score: number }>>([])
  const [assistantPrompt, setAssistantPrompt] = useState('Summarize branch performance priorities for this week')
  const [assistantReplies, setAssistantReplies] = useState<AssistantReply[]>([])
  const [savedAssistantReplies, setSavedAssistantReplies] = useState<AssistantReply[]>([])
  const [assistantSavePendingIds, setAssistantSavePendingIds] = useState<Record<string, boolean>>({})
  const [assistantDeletePendingIds, setAssistantDeletePendingIds] = useState<Record<string, boolean>>({})
  const [assistantRecheckPendingIds, setAssistantRecheckPendingIds] = useState<Record<string, boolean>>({})
  const [deleteConfirmReply, setDeleteConfirmReply] = useState<AssistantReply | null>(null)
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false)
  const deleteDialogCancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const [approvalHistoryQueueItem, setApprovalHistoryQueueItem] = useState<HumanApprovalQueueItem | null>(null)
  const [approvalHistoryVisible, setApprovalHistoryVisible] = useState(false)
  const [approvalHistoryLoading, setApprovalHistoryLoading] = useState(false)
  const [approvalHistoryData, setApprovalHistoryData] = useState<HumanApprovalHistoryResponse['data'] | null>(null)
  const approvalHistoryCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const [selectedWorkflowExecution, setSelectedWorkflowExecution] = useState<WorkflowExecutionSummary | null>(null)
  const [workflowExecutionDetailVisible, setWorkflowExecutionDetailVisible] = useState(false)
  const workflowExecutionDetailCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const [loadedSavedReply, setLoadedSavedReply] = useState<AssistantReply | null>(null)
  const [savedAssistantSearch, setSavedAssistantSearch] = useState('')
  const [loadingSavedAssistant, setLoadingSavedAssistant] = useState(false)
  const [conversationId] = useState(() => `enterprise-ai-${Date.now()}`)
  const [humanApprovalQueue, setHumanApprovalQueue] = useState<HumanApprovalQueueItem[]>([])
  const [humanApprovalLoading, setHumanApprovalLoading] = useState(false)
  const [humanApprovalDecisionPendingId, setHumanApprovalDecisionPendingId] = useState<string | null>(null)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [actionStatusCounts, setActionStatusCounts] = useState<Record<string, number>>({})
  const [actionFilterStatus, setActionFilterStatus] = useState<'ALL' | ActionTrackerStatus>('ALL')
  const [actionFilterOverdueOnly, setActionFilterOverdueOnly] = useState(false)
  const [actionCandidates, setActionCandidates] = useState<Recommendation[]>([])
  const [selectedRecommendationId, setSelectedRecommendationId] = useState('')
  const [actionOwnerUserId, setActionOwnerUserId] = useState(user?.id || '')
  const [actionDueDate, setActionDueDate] = useState('')
  const [actionExpectedImpact, setActionExpectedImpact] = useState('')
  const [actionNotes, setActionNotes] = useState('')
  const [actionSaving, setActionSaving] = useState(false)
  const [actionDrafts, setActionDrafts] = useState<Record<string, ActionUpdateDraft>>({})
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null)
  const [alertPolicyDraft, setAlertPolicyDraft] = useState<AlertPolicyDraft>({
    minPriorityToNotify: 'P3',
    quietHoursStartUtc: '',
    quietHoursEndUtc: '',
    suppressAfterAckHours: '24',
    dedupeP1Hours: '2',
    dedupeP2Hours: '8',
    dedupeP3Hours: '24',
  })
  const [alertPolicyMeta, setAlertPolicyMeta] = useState<{ source: 'defaults' | 'tenant-signal'; updatedAt: string | null; signalId: string | null }>({
    source: 'defaults',
    updatedAt: null,
    signalId: null,
  })
  const [alertPolicyRevisions, setAlertPolicyRevisions] = useState<AlertPolicyResponse['data']['revisions']>([])
  const [alertPolicyLoading, setAlertPolicyLoading] = useState(false)
  const [alertPolicySaving, setAlertPolicySaving] = useState(false)
  const [restoringPolicyId, setRestoringPolicyId] = useState<string | null>(null)
  const [reliabilityLoading, setReliabilityLoading] = useState(false)
  const [reliability, setReliability] = useState<ReliabilityPanelData>({
    groundingQualityAvg: null,
    fallbackRate: null,
    responseP95LatencyMs: null,
    externalProviderAvgLatencyMs: null,
    freshnessHours: null,
    sampleSize: 0,
  })
  const [externalGroundingLoading, setExternalGroundingLoading] = useState(false)
  const [externalGroundingContext, setExternalGroundingContext] = useState<ExternalGroundingContextData | null>(null)
  const [externalDataSummary, setExternalDataSummary] = useState<ExternalDataConnectionSummary | null>(null)
  const [externalConnectionForm, setExternalConnectionForm] = useState<ExternalConnectionFormState>({ ...EXTERNAL_CONNECTION_FORM_DEFAULTS })
  const [externalMappingDraft, setExternalMappingDraft] = useState<ExternalMappingConfig>({})
  const [externalDiscovery, setExternalDiscovery] = useState<ExternalDiscoveryResult | null>(null)
  const [externalValidation, setExternalValidation] = useState<ExternalValidationResult | null>(null)
  const [externalDataSetupLoading, setExternalDataSetupLoading] = useState(false)
  const [externalDataMutating, setExternalDataMutating] = useState(false)
  const [externalDataFeatureBlocked, setExternalDataFeatureBlocked] = useState<string | null>(null)
  const [externalDataAccessResolved, setExternalDataAccessResolved] = useState(false)
  const [externalProvisioningProfile, setExternalProvisioningProfile] = useState<ExternalProvisioningProfile>('generic')
  const [causalMethod, setCausalMethod] = useState<'granger' | 'did' | 'synthetic'>('granger')
  const [causalDiagnosticsLoading, setCausalDiagnosticsLoading] = useState(false)
  const [causalDiagnostics, setCausalDiagnostics] = useState<CausalDiagnosticsResponse['data'] | null>(null)
  const [simulationPreviewLoading, setSimulationPreviewLoading] = useState(false)
  const [simulationType, setSimulationType] = useState<'price_change' | 'marketing_spend' | 'inventory_change' | 'staffing_change' | 'expansion'>('price_change')
  const [simulationPreview, setSimulationPreview] = useState<SimulationPreviewResponse['data'] | null>(null)
  const [workflowDashboardLoading, setWorkflowDashboardLoading] = useState(false)
  const [workflowDashboard, setWorkflowDashboard] = useState<WorkflowDashboardResponse['data'] | null>(null)
  const [workflowDecisionPendingId, setWorkflowDecisionPendingId] = useState<string | null>(null)
  const [workflowRollbackPendingId, setWorkflowRollbackPendingId] = useState<string | null>(null)

  const canAccess = user?.role === 'SUPER_ADMIN' || user?.role === 'BUSINESS_ADMIN'

  const withTracker = (rec: Recommendation): boolean => {
    const payload = (rec.outputPayload && typeof rec.outputPayload === 'object' && !Array.isArray(rec.outputPayload))
      ? rec.outputPayload as Record<string, unknown>
      : null
    const tracker = payload?.actionTracker
    return Boolean(tracker && typeof tracker === 'object')
  }

  const loadBranchInsights = async () => {
    setLoading(true)
    try {
      await api.post('/enterprise-ai/recommendations', {
        recommendationType: 'BRANCH_PERFORMANCE',
      })

      const { data } = await api.get<{ data: Recommendation[] }>('/enterprise-ai/recommendations?recommendationType=BRANCH_PERFORMANCE&limit=1')
      const top = data.data?.[0]
      const ranked = ((top?.outputPayload as { rankedBranches?: Array<{ branchName: string; revenue: number; expense: number; margin: number; score: number }> } | undefined)?.rankedBranches || [])
      setBranchRows(ranked)
      setBlocked(null)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load branch insights'
      if (status === 403) setBlocked(msg)
      else toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const refreshConsoleInsights = async () => {
    await Promise.all([
      loadBranchInsights(),
      loadSavedAssistantReplies(),
      loadReliabilityMetrics(),
      loadExternalGroundingStatus(),
      loadExternalDataSetup(),
      loadHumanApprovalQueue(),
      loadWorkflowDashboard(),
    ])
  }

  const loadCausalDiagnostics = async () => {
    const prompt = assistantPrompt.trim() || 'Assess the main drivers of revenue performance for this tenant.'
    setCausalDiagnosticsLoading(true)
    try {
      const { data } = await api.get<CausalDiagnosticsResponse>(`/enterprise-ai/causal?type=${causalMethod}&prompt=${encodeURIComponent(prompt)}`)
      setCausalDiagnostics(data.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load causal diagnostics'
      toast.error(msg)
    } finally {
      setCausalDiagnosticsLoading(false)
    }
  }

  const loadSimulationPreview = async () => {
    setSimulationPreviewLoading(true)
    try {
      const prompt = assistantPrompt.toLowerCase()
      const parameters = simulationType === 'price_change'
        ? { priceChangePct: prompt.includes('decrease') ? -5 : 5 }
        : simulationType === 'marketing_spend'
          ? { spendChangePct: 20 }
          : simulationType === 'inventory_change'
            ? { p1CoveragePct: 100 }
            : simulationType === 'staffing_change'
              ? { staffingCostPct: 10 }
              : { revenueLiftPct: 12, expenseLiftPct: 7 }

      const { data } = await api.post<SimulationPreviewResponse>('/enterprise-ai/causal', {
        simulationType,
        parameters,
        confidenceLevel: 0.9,
      })
      setSimulationPreview(data.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to run calibrated simulation'
      toast.error(msg)
    } finally {
      setSimulationPreviewLoading(false)
    }
  }

  const loadWorkflowDashboard = async () => {
    setWorkflowDashboardLoading(true)
    try {
      const { data } = await api.get<WorkflowDashboardResponse>('/enterprise-ai/workflows?limit=20')
      setWorkflowDashboard(data.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load workflow dashboard'
      toast.error(msg)
    } finally {
      setWorkflowDashboardLoading(false)
    }
  }

  const reviewWorkflowExecution = async (executionId: string, approved: boolean) => {
    setWorkflowDecisionPendingId(executionId)
    try {
      await api.patch('/enterprise-ai/workflows', {
        executionId,
        approved,
        notes: approved ? 'Approved from Enterprise AI workflow dashboard' : 'Rejected from Enterprise AI workflow dashboard',
      })
      toast.success(approved ? 'Workflow approved' : 'Workflow rejected')
      await loadWorkflowDashboard()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to review workflow execution'
      toast.error(msg)
    } finally {
      setWorkflowDecisionPendingId(null)
    }
  }

  const rollbackWorkflowExecution = async (executionId: string) => {
    setWorkflowRollbackPendingId(executionId)
    try {
      await api.patch('/enterprise-ai/workflows', {
        action: 'rollback',
        executionId,
        notes: 'Rolled back from Enterprise AI workflow dashboard',
      })
      toast.success('Workflow rolled back')
      await loadWorkflowDashboard()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to roll back workflow execution'
      toast.error(msg)
    } finally {
      setWorkflowRollbackPendingId(null)
    }
  }

  const loadHumanApprovalQueue = async () => {
    setHumanApprovalLoading(true)
    try {
      const { data } = await api.get<HumanApprovalQueueResponse>('/enterprise-ai/assistant-approvals?limit=25')
      setHumanApprovalQueue(data.data || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load human approval queue'
      toast.error(msg)
    } finally {
      setHumanApprovalLoading(false)
    }
  }

  const applyHumanApprovalDecision = async (recommendationId: string, action: 'accept' | 'reject') => {
    setHumanApprovalDecisionPendingId(recommendationId)
    try {
      await api.patch(`/enterprise-ai/recommendations/${recommendationId}/decision`, {
        action,
        note: action === 'accept'
          ? 'Approved from Human Approval Queue'
          : 'Rejected from Human Approval Queue',
      })
      toast.success(action === 'accept' ? 'Action approved' : 'Action rejected')
      await loadHumanApprovalQueue()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to apply decision'
      toast.error(msg)
    } finally {
      setHumanApprovalDecisionPendingId(null)
    }
  }

  const loadActionCandidates = async () => {
    try {
      const { data } = await api.get<{ data: Recommendation[] }>('/enterprise-ai/recommendations?sort=priority&status=OPEN&limit=25')
      const candidates = data.data.filter((rec) => !withTracker(rec))
      setActionCandidates(candidates)
      if (!selectedRecommendationId && candidates.length) {
        setSelectedRecommendationId(candidates[0].id)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load action candidates'
      toast.error(msg)
    }
  }

  const loadActionItems = async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '40')
      if (actionFilterStatus !== 'ALL') params.set('status', actionFilterStatus)
      if (actionFilterOverdueOnly) params.set('overdueOnly', 'true')

      const { data } = await api.get<ActionListResponse>(`/enterprise-ai/actions?${params.toString()}`)
      setActionItems(data.data.items)
      setActionStatusCounts(data.data.statusCounts)

      const drafts: Record<string, ActionUpdateDraft> = {}
      for (const item of data.data.items) {
        drafts[item.recommendationId] = {
          status: item.tracker.status,
          realizedImpactScore: item.tracker.realizedImpactScore === null ? '' : String(item.tracker.realizedImpactScore),
          progressNote: item.tracker.progressNote || '',
        }
      }
      setActionDrafts(drafts)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load action tracker items'
      toast.error(msg)
    }
  }

  const loadAlertPolicy = async () => {
    setAlertPolicyLoading(true)
    try {
      const { data } = await api.get<AlertPolicyResponse>('/enterprise-ai/alerts/policy')
      const policy = data.data.policy
      setAlertPolicyDraft({
        minPriorityToNotify: policy.minPriorityToNotify,
        quietHoursStartUtc: toHourOrEmpty(policy.quietHoursStartUtc),
        quietHoursEndUtc: toHourOrEmpty(policy.quietHoursEndUtc),
        suppressAfterAckHours: String(policy.suppressAfterAckHours),
        dedupeP1Hours: String(policy.dedupeHoursByPriority.P1),
        dedupeP2Hours: String(policy.dedupeHoursByPriority.P2),
        dedupeP3Hours: String(policy.dedupeHoursByPriority.P3),
      })
      setAlertPolicyMeta({
        source: data.data.source,
        updatedAt: data.data.updatedAt,
        signalId: data.data.signalId,
      })
      setAlertPolicyRevisions(data.data.revisions || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load alert policy'
      toast.error(msg)
    } finally {
      setAlertPolicyLoading(false)
    }
  }

  const loadReliabilityMetrics = async () => {
    setReliabilityLoading(true)
    try {
      const { data } = await api.get<MetricsResponse>('/enterprise-ai/metrics')
      const rows = data.data.recentMetrics || []

      const grounding = rows.filter((row) => row.metricKey === 'assistant_grounding_quality_score')
      const responseLatency = rows.filter((row) => row.metricKey === 'assistant_response_latency_ms')
      const providerLatency = rows.filter((row) => row.metricKey === 'assistant_external_provider_latency_ms')
      const fallbackRows = rows.filter((row) => row.metricKey === 'assistant_external_provider_fallback_count')

      const groundingValues = grounding.map((row) => Number(row.metricValue)).filter((x) => Number.isFinite(x))
      const responseValues = responseLatency.map((row) => Number(row.metricValue)).filter((x) => Number.isFinite(x))
      const providerValues = providerLatency.map((row) => Number(row.metricValue)).filter((x) => Number.isFinite(x))

      const fallbackCount = fallbackRows.reduce((sum, row) => sum + Number(row.metricValue || 0), 0)
      const responseCount = responseLatency.length
      const latestGrounding = grounding[0]
      const latestFreshness = Number(toRecord(latestGrounding?.dimensions).freshnessHours)

      setReliability({
        groundingQualityAvg: groundingValues.length
          ? groundingValues.reduce((sum, v) => sum + v, 0) / groundingValues.length
          : null,
        fallbackRate: responseCount > 0 ? fallbackCount / responseCount : null,
        responseP95LatencyMs: percentile(responseValues, 95),
        externalProviderAvgLatencyMs: providerValues.length
          ? providerValues.reduce((sum, v) => sum + v, 0) / providerValues.length
          : null,
        freshnessHours: Number.isFinite(latestFreshness) ? latestFreshness : null,
        sampleSize: responseCount,
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load reliability metrics'
      toast.error(msg)
    } finally {
      setReliabilityLoading(false)
    }
  }

  const loadExternalGroundingStatus = async () => {
    setExternalGroundingLoading(true)
    try {
      const { data } = await api.get<{ data: ExternalGroundingContextData }>('/enterprise-ai/context')
      setExternalGroundingContext(data.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load external grounding status'
      toast.error(msg)
    } finally {
      setExternalGroundingLoading(false)
    }
  }

  const loadExternalDataSetup = async () => {
    setExternalDataSetupLoading(true)
    try {
      const { data } = await api.get<{ data: ExternalDataConnectionSummary | null }>('/enterprise-ai/external-data')
      const summary = data.data
      setExternalDataSummary(summary)
      setExternalConnectionForm(buildExternalConnectionForm(summary))
      setExternalMappingDraft(summary?.mappingConfig || {})
      setExternalDataFeatureBlocked(null)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = getApiErrorMessage(err, 'Failed to load external database setup')
      if (status === 403) {
        setExternalDataSummary(null)
        setExternalDiscovery(null)
        setExternalValidation(null)
        setExternalMappingDraft({})
        setExternalConnectionForm({ ...EXTERNAL_CONNECTION_FORM_DEFAULTS })
        setExternalDataFeatureBlocked(msg)
      } else {
        toast.error(msg)
      }
    } finally {
      setExternalDataAccessResolved(true)
      setExternalDataSetupLoading(false)
    }
  }

  const submitExternalConnection = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setExternalDataMutating(true)
    try {
      const hadExistingConnection = Boolean(externalDataSummary)
      const payload = {
        providerType: 'postgresql' as const,
        connectionName: externalConnectionForm.connectionName.trim() || undefined,
        host: externalConnectionForm.host.trim(),
        port: Number(externalConnectionForm.port || '5432'),
        databaseName: externalConnectionForm.databaseName.trim(),
        schemaName: externalConnectionForm.schemaName.trim() || 'public',
        sslRequired: externalConnectionForm.sslRequired,
        username: externalConnectionForm.username.trim() || undefined,
        password: externalConnectionForm.password || undefined,
      }
      const { data } = await api.post<{ data: ExternalDataConnectionSummary }>('/enterprise-ai/external-data', payload)
      setExternalDataSummary(data.data)
      setExternalConnectionForm(buildExternalConnectionForm(data.data))
      setExternalMappingDraft(data.data.mappingConfig || {})
      setExternalValidation(null)
      toast.success(hadExistingConnection ? 'External database connection updated' : 'External database connection saved')
      await Promise.all([loadExternalGroundingStatus(), loadExternalDataSetup()])
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to save external database connection'))
    } finally {
      setExternalDataMutating(false)
    }
  }

  const discoverExternalSchema = async () => {
    setExternalDataMutating(true)
    try {
      const { data } = await api.post<{ data: ExternalDiscoveryResult }>('/enterprise-ai/external-data/discover')
      setExternalDiscovery(data.data)
      setExternalMappingDraft((current) => mergeExternalMappingSuggestions(current, data.data.suggestions || {}))
      toast.success('External schema discovery complete')
      await loadExternalDataSetup()
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to discover external schema'))
    } finally {
      setExternalDataMutating(false)
    }
  }

  const saveExternalMappings = async (groundingEnabled = externalDataSummary?.groundingEnabled ?? false) => {
    setExternalDataMutating(true)
    try {
      const mappingPayload = sanitizeExternalMappingConfig(externalMappingDraft)
      const { data } = await api.patch<{ data: ExternalDataConnectionSummary }>('/enterprise-ai/external-data', {
        mappingConfig: mappingPayload,
        groundingEnabled,
      })
      setExternalDataSummary(data.data)
      setExternalMappingDraft(data.data.mappingConfig || {})
      toast.success(groundingEnabled ? 'Mappings saved and grounding updated' : 'Mappings saved')
      await Promise.all([loadExternalGroundingStatus(), loadExternalDataSetup()])
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to save external mappings'))
    } finally {
      setExternalDataMutating(false)
    }
  }

  const validateExternalMappings = async () => {
    setExternalDataMutating(true)
    try {
      const { data } = await api.post<{ data: ExternalValidationResult }>('/enterprise-ai/external-data/validate')
      setExternalValidation(data.data)
      toast.success(data.data.ok ? 'External mapping validation passed' : 'Validation completed with issues')
      await Promise.all([loadExternalGroundingStatus(), loadExternalDataSetup()])
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to validate external mappings'))
    } finally {
      setExternalDataMutating(false)
    }
  }

  const toggleExternalGrounding = async (enabled: boolean) => {
    await saveExternalMappings(enabled)
  }

  const disableExternalConnection = async () => {
    setExternalDataMutating(true)
    try {
      await api.delete('/enterprise-ai/external-data')
      setExternalDataSummary(null)
      setExternalDiscovery(null)
      setExternalValidation(null)
      setExternalMappingDraft({})
      setExternalConnectionForm({ ...EXTERNAL_CONNECTION_FORM_DEFAULTS })
      toast.success('External database connection disabled')
      await Promise.all([loadExternalGroundingStatus(), loadExternalDataSetup()])
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to disable external database connection'))
    } finally {
      setExternalDataMutating(false)
    }
  }

  const updateExternalMappingTable = (entity: ExternalMappingEntityKey, table: string) => {
    const normalizedTableName = table.trim().toLowerCase()
    const selectedTable = normalizedTableName ? availableExternalTableLookup.get(normalizedTableName) || null : null
    setExternalMappingDraft((current) => ({
      ...current,
      [entity]: {
        table,
        columns: buildExternalMappingColumnsForTable(entity, selectedTable, current[entity]?.columns),
      },
    }))
  }

  const updateExternalMappingColumn = (entity: ExternalMappingEntityKey, columnKey: string, value: string) => {
    setExternalMappingDraft((current) => ({
      ...current,
      [entity]: {
        table: current[entity]?.table || '',
        columns: {
          ...(current[entity]?.columns || {}),
          [columnKey]: value,
        },
      },
    }))
  }

  const autofillExternalEntityMapping = (entity: ExternalMappingEntityKey) => {
    const currentTableName = externalMappingDraft[entity]?.table?.trim()
    const selectedTable = currentTableName ? availableExternalTableLookup.get(currentTableName.toLowerCase()) || null : null
    if (!selectedTable) {
      toast.error('Choose a discovered table before auto-filling columns')
      return
    }

    setExternalMappingDraft((current) => ({
      ...current,
      [entity]: {
        table: currentTableName,
        columns: buildExternalMappingColumnsForTable(entity, selectedTable, current[entity]?.columns),
      },
    }))
    toast.success('Column suggestions applied')
  }

  const applyAllExternalMappingSuggestions = () => {
    setExternalMappingDraft((current) => {
      const next: ExternalMappingConfig = { ...current }
      for (const entity of EXTERNAL_MAPPING_REQUIREMENTS) {
        const currentTableName = current[entity.key]?.table?.trim()
        const selectedTable = currentTableName
          ? availableExternalTableLookup.get(currentTableName.toLowerCase()) || null
          : externalEntityCandidateTables[entity.key][0] || null
        const resolvedTableName = currentTableName || selectedTable?.name || ''
        if (!resolvedTableName) continue
        next[entity.key] = {
          table: resolvedTableName,
          columns: buildExternalMappingColumnsForTable(entity.key, selectedTable, current[entity.key]?.columns),
        }
      }
      return next
    })
    toast.success('Suggested mappings applied')
  }

  const saveAlertPolicy = async (e: FormEvent) => {
    e.preventDefault()
    setAlertPolicySaving(true)
    try {
      const payload = {
        minPriorityToNotify: alertPolicyDraft.minPriorityToNotify,
        quietHoursStartUtc: alertPolicyDraft.quietHoursStartUtc.trim() === '' ? null : Number(clampIntString(alertPolicyDraft.quietHoursStartUtc, 0, 23)),
        quietHoursEndUtc: alertPolicyDraft.quietHoursEndUtc.trim() === '' ? null : Number(clampIntString(alertPolicyDraft.quietHoursEndUtc, 0, 23)),
        suppressAfterAckHours: Number(clampIntString(alertPolicyDraft.suppressAfterAckHours, 1, 24 * 14) || '24'),
        dedupeHoursByPriority: {
          P1: Number(clampIntString(alertPolicyDraft.dedupeP1Hours, 1, 48) || '2'),
          P2: Number(clampIntString(alertPolicyDraft.dedupeP2Hours, 1, 72) || '8'),
          P3: Number(clampIntString(alertPolicyDraft.dedupeP3Hours, 1, 24 * 7) || '24'),
        },
      }

      const { data } = await api.patch<AlertPolicyResponse>('/enterprise-ai/alerts/policy', payload)
      toast.success('Alert policy updated')
      const saved = data.data.policy
      setAlertPolicyDraft({
        minPriorityToNotify: saved.minPriorityToNotify,
        quietHoursStartUtc: toHourOrEmpty(saved.quietHoursStartUtc),
        quietHoursEndUtc: toHourOrEmpty(saved.quietHoursEndUtc),
        suppressAfterAckHours: String(saved.suppressAfterAckHours),
        dedupeP1Hours: String(saved.dedupeHoursByPriority.P1),
        dedupeP2Hours: String(saved.dedupeHoursByPriority.P2),
        dedupeP3Hours: String(saved.dedupeHoursByPriority.P3),
      })
      setAlertPolicyMeta({
        source: data.data.source,
        updatedAt: data.data.updatedAt,
        signalId: data.data.signalId,
      })
      setAlertPolicyRevisions(data.data.revisions || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update alert policy'
      toast.error(msg)
    } finally {
      setAlertPolicySaving(false)
    }
  }

  const restoreAlertPolicy = async (revisionId: string) => {
    setRestoringPolicyId(revisionId)
    try {
      const { data } = await api.patch<AlertPolicyResponse>('/enterprise-ai/alerts/policy', {
        restoreSignalId: revisionId,
      })
      toast.success('Policy restored from revision')
      const saved = data.data.policy
      setAlertPolicyDraft({
        minPriorityToNotify: saved.minPriorityToNotify,
        quietHoursStartUtc: toHourOrEmpty(saved.quietHoursStartUtc),
        quietHoursEndUtc: toHourOrEmpty(saved.quietHoursEndUtc),
        suppressAfterAckHours: String(saved.suppressAfterAckHours),
        dedupeP1Hours: String(saved.dedupeHoursByPriority.P1),
        dedupeP2Hours: String(saved.dedupeHoursByPriority.P2),
        dedupeP3Hours: String(saved.dedupeHoursByPriority.P3),
      })
      setAlertPolicyMeta({
        source: data.data.source,
        updatedAt: data.data.updatedAt,
        signalId: data.data.signalId,
      })
      setAlertPolicyRevisions(data.data.revisions || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to restore policy revision'
      toast.error(msg)
    } finally {
      setRestoringPolicyId(null)
    }
  }

  const runAssistantPrompt = async (promptText: string): Promise<boolean> => {
    const normalizedPrompt = promptText.trim()
    if (!normalizedPrompt) return false
    const safePrompt = truncateForPrompt(normalizedPrompt, MAX_ASSISTANT_PROMPT_LENGTH)
    setLoading(true)
    try {
      const { data } = await api.post<{ data: Recommendation }>('/enterprise-ai/recommendations', {
        recommendationType: 'NL_ASSISTANT',
        prompt: safePrompt,
        conversationId,
      })

      const payload = (data.data.outputPayload as {
        response?: string
        provider?: string
        groundingSource?: 'internal' | 'external'
        externalData?: {
          externalGroundingReady: boolean
          contractIssues?: ExternalGroundingContractIssue[]
        } | null
        brief?: AssistantBrief
        currencyCode?: string
        incomeBreakdown?: AssistantIncomeBreakdown
      } | undefined)
      setAssistantReplies((prev) => [
        {
          id: data.data.id,
          prompt: safePrompt,
          response: payload?.response || data.data.summary,
          createdAt: data.data.createdAt,
          currencyCode: payload?.currencyCode,
          incomeBreakdown: payload?.incomeBreakdown,
          conversationId,
          provider: payload?.provider,
          groundingSource: payload?.groundingSource,
          externalData: payload?.externalData
            ? {
                externalGroundingReady: payload.externalData.externalGroundingReady,
                contractIssues: payload.externalData.contractIssues || [],
              }
            : null,
          brief: payload?.brief,
        },
        ...prev,
      ])
      await loadReliabilityMetrics()
      await loadExternalGroundingStatus()
      void loadHumanApprovalQueue()
      setBlocked(null)
      return true
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to query assistant'
      if (status === 403) setBlocked(msg)
      else toast.error(msg)
      return false
    } finally {
      setLoading(false)
    }
  }

  const sendAssistantPrompt = async (e: FormEvent) => {
    e.preventDefault()
    await runAssistantPrompt(assistantPrompt)
  }

  const runReplyFollowUp = async (reply: AssistantReply, followUpPrompt: string) => {
    const trimmed = followUpPrompt.trim()
    if (!trimmed) return
    setLoadedSavedReply(reply)
    setAssistantPrompt(trimmed)
    const ok = await runAssistantPrompt(trimmed)
    if (!ok) {
      toast.error('Follow-up request failed. Try again with a shorter prompt.')
    }
  }

  const loadSavedAssistantReplies = async () => {
    setLoadingSavedAssistant(true)
    try {
      const { data } = await api.get<AssistantLibraryResponse>('/enterprise-ai/assistant-library?limit=25')
      setSavedAssistantReplies(data.data || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load saved assistant responses'
      toast.error(msg)
    } finally {
      setLoadingSavedAssistant(false)
    }
  }

  const saveAssistantReply = async (reply: AssistantReply) => {
    setAssistantSavePendingIds((prev) => ({ ...prev, [reply.id]: true }))
    try {
      const { data } = await api.post<AssistantLibrarySaveResponse>('/enterprise-ai/assistant-library', {
        prompt: reply.prompt,
        response: reply.response,
        currencyCode: reply.currencyCode || baseCurrency,
        incomeBreakdown: reply.incomeBreakdown,
        conversationId: reply.conversationId || conversationId,
        provider: reply.provider,
        groundingSource: reply.groundingSource,
        externalData: reply.externalData,
        sourceRecommendationId: reply.id,
        brief: reply.brief,
      })
      const saved = data.data
      if (saved) {
        setSavedAssistantReplies((prev) => {
          const deduped = prev.filter((item) => item.id !== saved.id)
          return [saved, ...deduped]
        })
      } else {
        await loadSavedAssistantReplies()
      }
      toast.success('Assistant response saved for later')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save assistant response'
      toast.error(msg)
    } finally {
      setAssistantSavePendingIds((prev) => ({ ...prev, [reply.id]: false }))
    }
  }

  const printAssistantReply = (reply: AssistantReply) => {
    let html = ''
    try {
      html = buildAssistantPrintHtml(reply)
    } catch {
      toast.error('Unable to prepare this response for printing.')
      return
    }

    const opened = printHtmlDocument(html)
    if (!opened) {
      toast.error('Unable to render print preview. Please try again.')
      return
    }
  }

  const printAutoDetectedIssues = (issues: Array<{
    severity: 'critical' | 'warning' | 'info'
    message: string
    actionRequired: string
    createdAt: string
    prompt: string
  }>) => {
    if (!issues.length) {
      toast.error('No auto-detected issues to print')
      return
    }

    const rendered = issues.map((issue) => {
      const tone = getIssueTone(issue.severity, issue.message)
      const label = tone === 'critical' ? 'CRITICAL' : tone === 'moderate' ? 'MODERATE' : tone === 'positive' ? 'ACHIEVEMENT' : 'INFO'
      return `<li><strong>[${escapeHtml(label)}]</strong> ${escapeHtml(issue.message)}<br /><em>Action:</em> ${escapeHtml(issue.actionRequired)}<br /><em>Source prompt:</em> ${escapeHtml(truncateForPrompt(issue.prompt, 180))}<br /><em>Detected:</em> ${escapeHtml(new Date(issue.createdAt).toLocaleString())}</li>`
    }).join('')

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Auto-Detected Issues</title>
          <style>
            body { font-family: "Segoe UI", Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            p, li { font-size: 13px; line-height: 1.6; }
            ul { margin: 10px 0 0 18px; }
          </style>
        </head>
        <body>
          <h1>AI Auto-Detected Issues</h1>
          <p>Generated: ${escapeHtml(new Date().toLocaleString())}</p>
          <ul>${rendered}</ul>
        </body>
      </html>
    `

    const opened = printHtmlDocument(html)
    if (!opened) {
      toast.error('Unable to render print preview. Please try again.')
    }
  }

  const deleteSavedAssistantReply = async (reply: AssistantReply) => {
    const id = reply.id
    setAssistantDeletePendingIds((prev) => ({ ...prev, [id]: true }))
    try {
      await api.delete(`/enterprise-ai/assistant-library/${id}`)
      setSavedAssistantReplies((prev) => prev.filter((item) => item.id !== id))
      if (loadedSavedReply?.id === id) {
        setLoadedSavedReply(null)
      }
      toast.success('Saved assistant entry deleted')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete saved assistant entry'
      toast.error(msg)
    } finally {
      setAssistantDeletePendingIds((prev) => ({ ...prev, [id]: false }))
      setDeleteDialogVisible(false)
      setDeleteConfirmReply(null)
    }
  }

  const openDeleteConfirmDialog = (reply: AssistantReply) => {
    setDeleteConfirmReply(reply)
    setDeleteDialogVisible(false)
    requestAnimationFrame(() => setDeleteDialogVisible(true))
  }

  const closeDeleteConfirmDialog = () => {
    if (!deleteConfirmReply) return
    if (assistantDeletePendingIds[deleteConfirmReply.id]) return
    setDeleteDialogVisible(false)
    setDeleteConfirmReply(null)
  }

  const openApprovalHistoryDrawer = async (queueItem: HumanApprovalQueueItem) => {
    setApprovalHistoryQueueItem(queueItem)
    setApprovalHistoryVisible(false)
    setApprovalHistoryLoading(true)
    try {
      const { data } = await api.get<HumanApprovalHistoryResponse>(`/enterprise-ai/assistant-approvals/${queueItem.recommendationId}/history`)
      setApprovalHistoryData(data.data)
      requestAnimationFrame(() => setApprovalHistoryVisible(true))
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load approval history'
      toast.error(msg)
      setApprovalHistoryQueueItem(null)
      setApprovalHistoryData(null)
    } finally {
      setApprovalHistoryLoading(false)
    }
  }

  const closeApprovalHistoryDrawer = () => {
    if (!approvalHistoryQueueItem) return
    if (approvalHistoryLoading) return
    setApprovalHistoryVisible(false)
    setApprovalHistoryQueueItem(null)
    setApprovalHistoryData(null)
  }

  const openWorkflowExecutionDetail = (execution: WorkflowExecutionSummary) => {
    setSelectedWorkflowExecution(execution)
    setWorkflowExecutionDetailVisible(false)
    requestAnimationFrame(() => setWorkflowExecutionDetailVisible(true))
  }

  const closeWorkflowExecutionDetail = () => {
    if (!selectedWorkflowExecution) return
    setWorkflowExecutionDetailVisible(false)
    setSelectedWorkflowExecution(null)
  }

  const buildFollowUpRecheckPrompt = (reply: AssistantReply): string => {
    const { priorityActions, unresolvedIssues } = extractPriorityFocusFromReply(reply)
    const priorPrompt = truncateForPrompt(reply.prompt, 420)
    const previousResponseCurrency = (reply.currencyCode || '').trim().toUpperCase() || null
    const currencyChanged = Boolean(previousResponseCurrency && previousResponseCurrency !== baseCurrency)

    const draftLines = [
      'Follow-up recheck request:',
      `I previously received this assistant guidance on ${new Date(reply.createdAt).toLocaleString()}.`,
      `CURRENCY_CONTEXT_CURRENT_BASE: ${baseCurrency}`,
      previousResponseCurrency ? `CURRENCY_CONTEXT_PREVIOUS_RESPONSE: ${previousResponseCurrency}` : '',
      'Conversion rule: use tenant saved exchange rates only. Do not use live or inferred market rates.',
      currencyChanged
        ? `Currency instruction: present all money in ${baseCurrency}, and include previous-currency value in brackets where relevant (example: ${baseCurrency} 1,000 (${previousResponseCurrency} ...)).`
        : `Currency instruction: present all money in ${baseCurrency}.`,
      '',
      'Original prompt:',
      priorPrompt,
      '',
      'Original key pending actions/TODO (prioritized):',
    ]

    if (priorityActions.length === 0) {
      draftLines.push('No explicit prior actions were detected.')
    } else {
      const actionLines = priorityActions.map((item, idx) => `${idx + 1}. ${item}`)
      const addedActions = appendPromptLinesWithinLimit(draftLines, actionLines, MAX_ASSISTANT_PROMPT_LENGTH)
      const omittedActions = actionLines.length - addedActions
      if (omittedActions > 0) {
        appendPromptLinesWithinLimit(
          draftLines,
          [`[${omittedActions} additional action item(s) omitted to stay within prompt size limits]`],
          MAX_ASSISTANT_PROMPT_LENGTH,
        )
      }
    }

    draftLines.push('', 'Original unresolved issues/risks (prioritized):')

    if (unresolvedIssues.length === 0) {
      draftLines.push('No explicit prior unresolved issues were detected.')
    } else {
      const riskLines = unresolvedIssues.map((item, idx) => `${idx + 1}. ${item}`)
      const addedRisks = appendPromptLinesWithinLimit(draftLines, riskLines, MAX_ASSISTANT_PROMPT_LENGTH)
      const omittedRisks = riskLines.length - addedRisks
      if (omittedRisks > 0) {
        appendPromptLinesWithinLimit(
          draftLines,
          [`[${omittedRisks} additional risk item(s) omitted to stay within prompt size limits]`],
          MAX_ASSISTANT_PROMPT_LENGTH,
        )
      }
    }

    appendPromptLinesWithinLimit(draftLines, [
      '',
      'Please reassess current status versus those actions and risks using latest tenant data.',
      'Return a concise progress recheck with:',
      '1) What has improved',
      '2) What is still unresolved',
      '3) What got worse or remains high risk',
      '4) Updated next 3 priority actions for the next 7 days',
    ], MAX_ASSISTANT_PROMPT_LENGTH)

    return draftLines.join('\n')
  }

  const loadSavedReplyOnly = (reply: AssistantReply) => {
    const followUpPrompt = buildFollowUpRecheckPrompt(reply)
    setLoadedSavedReply(reply)
    setAssistantPrompt(followUpPrompt)
    toast.success('Saved entry loaded to prompt for follow-up.')
  }

  const injectLoadedReplyRecheckPrompt = (reply: AssistantReply) => {
    const followUpPrompt = buildFollowUpRecheckPrompt(reply)
    setLoadedSavedReply(reply)
    setAssistantPrompt(followUpPrompt)
    toast.success('Follow-up recheck prompt prepared. Review and submit when ready.')
  }

  const loadSavedReplyForRecheck = async (reply: AssistantReply) => {
    const followUpPrompt = buildFollowUpRecheckPrompt(reply)
    setLoadedSavedReply(reply)
    setAssistantPrompt(followUpPrompt)
    setAssistantRecheckPendingIds((prev) => ({ ...prev, [reply.id]: true }))
    try {
      const ok = await runAssistantPrompt(followUpPrompt)
      if (ok) {
        toast.success('Saved entry loaded and follow-up recheck generated')
      } else {
        toast.error('Follow-up recheck failed. Please retry with a shorter prompt.')
      }
    } finally {
      setAssistantRecheckPendingIds((prev) => ({ ...prev, [reply.id]: false }))
    }
  }

  const exportSavedEntriesCsv = (entries: AssistantReply[]) => {
    if (!entries.length) {
      toast.error('No saved entries to export')
      return
    }

    const header = ['id', 'createdAt', 'provider', 'groundingSource', 'externalGroundingReady', 'contractIssueCount', 'contractIssues', 'prompt', 'response', 'autoDetectedIssueCount', 'autoDetectedIssues']
    const rows = entries.map((entry) => [
      entry.id,
      entry.createdAt,
      entry.provider || '',
      entry.groundingSource || '',
      entry.externalData ? String(entry.externalData.externalGroundingReady) : '',
      entry.externalData?.contractIssues.length || 0,
      buildContractIssueSummary(entry),
      entry.prompt,
      entry.response,
      buildAutoDetectedIssueList(entry).length,
      buildIssuesText(entry),
    ])

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => toCsvCell(String(cell))).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `saved-enterprise-ai-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV export started')
  }

  const exportSavedEntriesPdf = async (entries: AssistantReply[]) => {
    if (!entries.length) {
      toast.error('No saved entries to export')
      return
    }

    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 40
      const contentWidth = pageWidth - margin * 2
      let cursorY = margin

      const colors = {
        brand: [37, 99, 235] as const,
        text: [17, 24, 39] as const,
        muted: [107, 114, 128] as const,
        cardBg: [249, 250, 251] as const,
        cardBorder: [229, 231, 235] as const,
        sectionTitle: [30, 64, 175] as const,
      }

      const newPage = () => {
        doc.addPage()
        cursorY = margin
      }

      const ensurePageSpace = (requiredHeight: number) => {
        if (cursorY + requiredHeight > pageHeight - margin) newPage()
      }

      const writeWrapped = (
        text: string,
        fontSize = 11,
        lineHeight = 15,
        color: readonly [number, number, number] = colors.text,
      ) => {
        doc.setFontSize(fontSize)
        doc.setTextColor(color[0], color[1], color[2])
        const lines = doc.splitTextToSize(text, contentWidth) as string[]
        for (const line of lines) {
          ensurePageSpace(lineHeight)
          doc.text(line, margin, cursorY)
          cursorY += lineHeight
        }
      }

      const writeCardSection = (title: string, value: string) => {
        const cardPadding = 10
        const titleHeight = 18
        const lineHeight = 13
        const maxCardTextWidth = contentWidth - cardPadding * 2
        const fullLines = doc.splitTextToSize(value || 'N/A', maxCardTextWidth) as string[]
        const sectionGap = 10
        let remainingLines = [...fullLines]
        let continued = false

        while (remainingLines.length) {
          const availableHeight = pageHeight - margin - cursorY
          const maxLines = Math.max(1, Math.floor((availableHeight - titleHeight - cardPadding * 2) / lineHeight))
          if (maxLines <= 1) {
            newPage()
            continue
          }

          const chunk = remainingLines.splice(0, maxLines)
          const cardHeight = cardPadding * 2 + titleHeight + chunk.length * lineHeight

          ensurePageSpace(cardHeight + sectionGap)

          doc.setDrawColor(colors.cardBorder[0], colors.cardBorder[1], colors.cardBorder[2])
          doc.setFillColor(colors.cardBg[0], colors.cardBg[1], colors.cardBg[2])
          doc.roundedRect(margin, cursorY, contentWidth, cardHeight, 8, 8, 'FD')

          doc.setFont('helvetica', 'bold')
          doc.setFontSize(11)
          doc.setTextColor(colors.sectionTitle[0], colors.sectionTitle[1], colors.sectionTitle[2])
          doc.text(continued ? `${title} (cont.)` : title, margin + cardPadding, cursorY + cardPadding + 10)

          doc.setFont('helvetica', 'normal')
          doc.setFontSize(10)
          doc.setTextColor(colors.text[0], colors.text[1], colors.text[2])

          let lineY = cursorY + cardPadding + titleHeight + 10
          for (const line of chunk) {
            doc.text(line, margin + cardPadding, lineY)
            lineY += lineHeight
          }

          cursorY += cardHeight + sectionGap
          continued = true
        }
      }

      const listToText = (title: string, items: string[]) => {
        if (!items.length) return `${title}: none`
        return items.map((item) => `- ${item}`).join('\n')
      }

      doc.setFillColor(colors.brand[0], colors.brand[1], colors.brand[2])
      doc.roundedRect(margin, cursorY, contentWidth, 58, 10, 10, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16)
      doc.text(`Saved Enterprise AI Assistant Entries (${entries.length})`, margin + 14, cursorY + 24)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Generated ${new Date().toLocaleString()}`, margin + 14, cursorY + 43)
      cursorY += 74

      entries.forEach((entry, index) => {
        ensurePageSpace(70)

        doc.setDrawColor(colors.cardBorder[0], colors.cardBorder[1], colors.cardBorder[2])
        doc.line(margin, cursorY, pageWidth - margin, cursorY)
        cursorY += 12

        doc.setFillColor(239, 246, 255)
        doc.roundedRect(margin, cursorY, contentWidth, 26, 6, 6, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(30, 64, 175)
        doc.text(`Entry ${index + 1}`, margin + 10, cursorY + 17)
        cursorY += 34

        doc.setFont('helvetica', 'normal')
        writeWrapped(`Created: ${new Date(entry.createdAt).toLocaleString()}`, 10, 13, colors.muted)
        if (entry.provider) writeWrapped(`Provider: ${entry.provider}`, 10, 13, colors.muted)
        if (entry.groundingSource) writeWrapped(`Grounding: ${entry.groundingSource}`, 10, 13, colors.muted)
        if (entry.externalData) writeWrapped(`External ready: ${entry.externalData.externalGroundingReady ? 'Yes' : 'No'}`, 10, 13, colors.muted)
        cursorY += 8

        writeCardSection('Prompt', entry.prompt)
        writeCardSection('Response', entry.response)
        if (entry.externalData?.contractIssues.length) {
          writeCardSection('Grounding Contract Issues', buildContractIssueSummary(entry))
        }
        if (shouldShowIncomeBreakdownForPrompt(entry.prompt, entry.incomeBreakdown)) {
          writeCardSection('Income Streams (30d)', buildIncomeStreamsText(entry, baseCurrency))
        }

        if (entry.brief) {
          writeCardSection('Structured Brief Summary', entry.brief.summary)
          writeCardSection('Actions', listToText('Actions', entry.brief.actions))
          writeCardSection('Comparative Insights', listToText('Comparative Insights', entry.brief.comparativeInsights))
          writeCardSection('Risks', listToText('Risks', entry.brief.risks))
          if (entry.brief.strategicInsights?.length) {
            writeCardSection('Strategic Insights', listToText('Strategic Insights', entry.brief.strategicInsights.map((s) => `[${s.level}] ${s.insight} (ROI ${s.estimatedROI}%, ${s.timeHorizon})`)))
          }
          if (entry.brief.executionPlan) {
            writeCardSection('Execution Plan', `Auto-executable: ${entry.brief.executionPlan.autoExecutableCount}\nApproval-required: ${entry.brief.executionPlan.approvalRequiredCount}`)
            if (entry.brief.executionPlan.highPriorityHumanActions?.length) {
              writeCardSection('High-Priority Human Approvals', listToText('High-Priority Human Approvals', entry.brief.executionPlan.highPriorityHumanActions))
            }
          }
        }

        writeCardSection('AI Auto-Detected Issues', buildIssuesText(entry))

        cursorY += 6
      })

      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i += 1) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(colors.muted[0], colors.muted[1], colors.muted[2])
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 18, { align: 'right' })
      }

      doc.save(`saved-enterprise-ai-${new Date().toISOString().slice(0, 10)}.pdf`)
      toast.success('PDF export downloaded')
    } catch {
      toast.error('Unable to generate PDF export. Please try again.')
    }
  }

  const createActionFromRecommendation = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedRecommendationId) {
      toast.error('Select a recommendation to track')
      return
    }

    setActionSaving(true)
    try {
      await api.post('/enterprise-ai/actions', {
        recommendationId: selectedRecommendationId,
        ownerUserId: actionOwnerUserId || undefined,
        dueDate: actionDueDate ? new Date(actionDueDate).toISOString() : undefined,
        expectedImpactScore: actionExpectedImpact ? Number(actionExpectedImpact) : undefined,
        impactNotes: actionNotes || undefined,
      })
      toast.success('Action tracker created')
      setActionExpectedImpact('')
      setActionDueDate('')
      setActionNotes('')
      await Promise.all([loadActionItems(), loadActionCandidates()])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create action tracker'
      toast.error(msg)
    } finally {
      setActionSaving(false)
    }
  }

  const updateActionItem = async (recommendationId: string) => {
    const draft = actionDrafts[recommendationId]
    if (!draft) return
    setUpdatingActionId(recommendationId)
    try {
      await api.patch(`/enterprise-ai/actions/${recommendationId}`, {
        status: draft.status,
        realizedImpactScore: draft.realizedImpactScore.trim() === '' ? undefined : Number(draft.realizedImpactScore),
        progressNote: draft.progressNote.trim() || undefined,
      })
      toast.success('Action updated')
      await loadActionItems()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update action'
      toast.error(msg)
    } finally {
      setUpdatingActionId(null)
    }
  }

  useEffect(() => {
    if (canAccess) {
      void loadBranchInsights()
      void loadActionCandidates()
      void loadActionItems()
      void loadAlertPolicy()
      void loadReliabilityMetrics()
      void loadExternalGroundingStatus()
      void loadExternalDataSetup()
      void loadSavedAssistantReplies()
      void loadHumanApprovalQueue()
      void loadWorkflowDashboard()
    }
  }, [canAccess])

  useEffect(() => {
    if (canAccess) {
      void loadActionItems()
    }
  }, [actionFilterStatus, actionFilterOverdueOnly])

  useEffect(() => {
    if (user?.id) setActionOwnerUserId(user.id)
  }, [user?.id])

  const availableExternalTables = useMemo(() => {
    const summaryTables = externalDataSummary?.schemaSnapshot?.tables || []
    const discoveredTables = externalDiscovery?.tables || []
    return discoveredTables.length > 0 ? discoveredTables : summaryTables
  }, [externalDataSummary?.schemaSnapshot?.tables, externalDiscovery?.tables])

  const availableExternalTableNames = useMemo(
    () => availableExternalTables.map((table) => table.name),
    [availableExternalTables],
  )

  const availableExternalTableLookup = useMemo(
    () => new Map(availableExternalTables.map((table) => [table.name.toLowerCase(), table])),
    [availableExternalTables],
  )

  const externalEntityCandidateTables = useMemo(() => {
    return EXTERNAL_MAPPING_REQUIREMENTS.reduce<Record<ExternalMappingEntityKey, ExternalSchemaTable[]>>((accumulator, entity) => {
      accumulator[entity.key] = availableExternalTables
        .map((table) => ({
          table,
          score: scoreExternalSchemaCandidate(table.name, EXTERNAL_ENTITY_TABLE_HINTS[entity.key]),
        }))
        .filter((entry) => entry.score >= 40)
        .sort((left, right) => right.score - left.score || left.table.name.localeCompare(right.table.name))
        .slice(0, 3)
        .map((entry) => entry.table)
      return accumulator
    }, {
      sales: [],
      saleItems: [],
      expenses: [],
      products: [],
      inventory: [],
      branches: [],
    })
  }, [availableExternalTables])

  const externalReportingUsername = useMemo(
    () => externalConnectionForm.username.trim() || 'reporting_reader',
    [externalConnectionForm.username],
  )

  const reportingUserSql = useMemo(
    () => buildReportingUserSql({
      username: externalReportingUsername,
      databaseName: externalConnectionForm.databaseName,
      schemaName: externalConnectionForm.schemaName,
    }),
    [externalConnectionForm.databaseName, externalConnectionForm.schemaName, externalReportingUsername],
  )

  const selectedProvisioningProfile = useMemo(
    () => EXTERNAL_PROVISIONING_PROFILES.find((profile) => profile.key === externalProvisioningProfile) || EXTERNAL_PROVISIONING_PROFILES[0],
    [externalProvisioningProfile],
  )

  const currentExternalContractIssues = externalDataSummary?.contractIssues || externalGroundingContext?.externalData?.contractIssues || []

  const currentExternalContractIssueByEntity = useMemo(
    () => new Map(currentExternalContractIssues.map((issue) => [issue.entity, issue])),
    [currentExternalContractIssues],
  )

  const copyReportingUserSql = async () => {
    try {
      await navigator.clipboard.writeText(reportingUserSql)
      toast.success('Reporting-user SQL copied')
    } catch {
      toast.error('Unable to copy SQL. Select and copy it manually.')
    }
  }

  const applySuggestedReportingUsername = () => {
    setExternalConnectionForm((current) => ({
      ...current,
      username: current.username.trim() || 'reporting_reader',
    }))
    toast.success('Reporting username applied to connection field')
  }

  useEffect(() => {
    if (!deleteConfirmReply) return

    const isDeleting = Boolean(assistantDeletePendingIds[deleteConfirmReply.id])
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        setDeleteDialogVisible(false)
        setDeleteConfirmReply(null)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!isDeleting) {
      setTimeout(() => {
        deleteDialogCancelButtonRef.current?.focus()
      }, 0)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [deleteConfirmReply, assistantDeletePendingIds])

  useEffect(() => {
    if (!approvalHistoryQueueItem) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !approvalHistoryLoading) {
        closeApprovalHistoryDrawer()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!approvalHistoryLoading) {
      setTimeout(() => {
        approvalHistoryCloseButtonRef.current?.focus()
      }, 0)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [approvalHistoryQueueItem, approvalHistoryLoading])

  useEffect(() => {
    if (!selectedWorkflowExecution) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeWorkflowExecutionDetail()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => {
      workflowExecutionDetailCloseButtonRef.current?.focus()
    }, 0)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [selectedWorkflowExecution])

  const rankingSummary = useMemo(() => {
    if (!branchRows.length) return 'No branch performance recommendations yet.'
    const lead = branchRows[0]
    return `${lead.branchName} currently leads with margin ${lead.margin.toFixed(2)}.`
  }, [branchRows])

  const actionSummary = useMemo(() => {
    const total = actionItems.length
    const overdue = actionItems.filter((item) => {
      if (!item.tracker.dueDate) return false
      if (item.tracker.status === 'DONE' || item.tracker.status === 'CANCELLED') return false
      return new Date(item.tracker.dueDate).getTime() < Date.now()
    }).length
    const inProgress = actionStatusCounts.IN_PROGRESS || 0
    const done = actionStatusCounts.DONE || 0
    return { total, overdue, inProgress, done }
  }, [actionItems, actionStatusCounts])

  const savedSourceIds = useMemo(() => {
    return new Set(savedAssistantReplies.map((item) => item.sourceRecommendationId).filter((id): id is string => Boolean(id)))
  }, [savedAssistantReplies])

  const filteredSavedAssistantReplies = useMemo(() => {
    const needle = savedAssistantSearch.trim().toLowerCase()
    if (!needle) return savedAssistantReplies
    return savedAssistantReplies.filter((item) => {
      return item.prompt.toLowerCase().includes(needle)
        || item.response.toLowerCase().includes(needle)
        || (item.provider || '').toLowerCase().includes(needle)
    })
  }, [savedAssistantReplies, savedAssistantSearch])

  const loadedSavedReplyFocus = useMemo(() => {
    if (!loadedSavedReply) {
      return { priorityActions: [] as string[], unresolvedIssues: [] as string[] }
    }
    return extractPriorityFocusFromReply(loadedSavedReply)
  }, [loadedSavedReply])

  const autoDetectedIssues = useMemo(() => {
    const sourceReplies = assistantReplies.length ? assistantReplies : savedAssistantReplies
    const top = sourceReplies.slice(0, 6)
    const deduped = new Map<string, {
      severity: 'critical' | 'warning' | 'info'
      message: string
      actionRequired: string
      createdAt: string
      prompt: string
    }>()

    for (const reply of top) {
      const issues = buildAutoDetectedIssueList(reply)
      for (const issue of issues) {
        const key = `${issue.severity}:${issue.message.toLowerCase()}`
        if (!deduped.has(key)) {
          deduped.set(key, {
            ...issue,
            createdAt: reply.createdAt,
            prompt: reply.prompt,
          })
        }
      }
    }

    const weight = { critical: 0, warning: 1, info: 2 }
    return Array.from(deduped.values())
      .sort((a, b) => {
        const severityDelta = weight[a.severity] - weight[b.severity]
        if (severityDelta !== 0) return severityDelta
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      .slice(0, 8)
  }, [assistantReplies, savedAssistantReplies])

  if (!user) return <Navigate to="/login" replace />
  if (!canAccess) return <Navigate to="/dashboard" replace />

  return (
    <div className="relative w-full overflow-hidden">
      <div className={`pointer-events-none absolute inset-y-0 right-0 hidden lg:block ${sidebarOpen ? 'w-64' : 'w-16'}`}>
        <div className="h-full border-l border-cyan-100/80 bg-gradient-to-b from-cyan-50 via-white to-indigo-50" />
        <div className={`absolute inset-x-3 top-6 space-y-3 pointer-events-auto transition-opacity ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}>
          <div className="rounded-xl border border-cyan-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-700">AI Focus Rail</p>
            <p className="mt-1 text-xs text-slate-600">Actionable zones for pending priorities and unresolved issues.</p>
          </div>
          <div className="rounded-xl border border-indigo-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Priority Levels</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">P1 Urgent</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">P2 Important</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">P3 Monitor</span>
            </div>
          </div>
          <div className="rounded-xl border border-amber-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">AI Auto-Detected Issues</p>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {autoDetectedIssues.length}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700 transition-colors hover:bg-sky-100"
                  onClick={() => printAutoDetectedIssues(autoDetectedIssues)}
                >
                  <Printer className="w-3 h-3" /> Print
                </button>
              </div>
            </div>

            {autoDetectedIssues.length === 0 ? (
              <p className="mt-2 text-xs text-slate-600">No anomalies surfaced yet.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {autoDetectedIssues.slice(0, 4).map((issue, idx) => {
                  const tone = getIssueTone(issue.severity, issue.message)
                  const toneUi = getIssueToneUi(tone)

                  return (
                    <div key={`${issue.severity}-rail-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2">
                      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${toneUi.classes}`}>
                        {toneUi.label}
                      </span>
                      <p className="mt-1 text-[11px] font-medium text-slate-800 leading-tight">{issue.message}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`relative p-4 sm:p-6 space-y-6 w-full ${sidebarOpen ? 'lg:max-w-[calc(100%-16rem)]' : 'lg:max-w-[calc(100%-4rem)]'}`}
      >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise AI Console</h1>
          <p className="text-sm text-gray-500 mt-1">Branch performance insights and Enterprise Assistant for Enterprise tenants.</p>
        </div>
        <button className="btn-primary" onClick={() => { void refreshConsoleInsights() }} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Insights
        </button>
      </div>

      {blocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Enterprise upgrade required</p>
              <p className="text-sm text-amber-800 mt-1">{blocked}</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {externalDataAccessResolved && !externalDataFeatureBlocked && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-orange-600" />
              <h2 className="font-semibold text-gray-900">External Grounding Status</h2>
            </div>
            <button className="btn-secondary" onClick={() => { void Promise.all([loadExternalGroundingStatus(), loadExternalDataSetup()]) }} disabled={externalGroundingLoading || externalDataSetupLoading}>
              <RefreshCw className={`w-4 h-4 ${externalGroundingLoading || externalDataSetupLoading ? 'animate-spin' : ''}`} /> Refresh Status
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-4">
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                <p className="font-semibold">Read-only PostgreSQL connector</p>
                <p className="mt-1">Use a PostgreSQL account with default_transaction_read_only enabled. After connecting, discover the schema, map the six required entities, validate, then enable grounding.</p>
                <p className="mt-2 text-xs text-sky-800">If setup fails on the read-only check, run ALTER ROLE your_reporting_user SET default_transaction_read_only = on; on the external database, then verify with SHOW default_transaction_read_only; before retrying.</p>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold">Provision reporting user</p>
                    <p className="mt-1 text-indigo-900">The app should not execute role-management SQL on a customer database. Use this helper to generate the PostgreSQL script, run it in your DB admin tool, then reuse the same username below for connection setup.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={applySuggestedReportingUsername}>
                      Use {externalReportingUsername}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => { void copyReportingUserSql() }}>
                      <ClipboardCheck className="w-4 h-4" /> Copy SQL
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[0.7fr,1.3fr]">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-indigo-700">Environment Profile</label>
                    <select
                      className="input mt-1"
                      value={externalProvisioningProfile}
                      onChange={(e) => setExternalProvisioningProfile(e.target.value as ExternalProvisioningProfile)}
                    >
                      {EXTERNAL_PROVISIONING_PROFILES.map((profile) => (
                        <option key={profile.key} value={profile.key}>{profile.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-white/80 p-3">
                    <p className="text-sm font-semibold text-indigo-950">{selectedProvisioningProfile.label}</p>
                    <p className="mt-1 text-xs text-indigo-900">{selectedProvisioningProfile.summary}</p>
                    <div className="mt-2 space-y-1 text-xs text-indigo-900">
                      {selectedProvisioningProfile.notes.map((note) => (
                        <p key={note}>• {note}</p>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-indigo-200 bg-slate-950 p-3">
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-emerald-200">{reportingUserSql}</pre>
                </div>
                <p className="mt-2 text-xs text-indigo-800">Replace the placeholder password in the SQL, run it with a privileged PostgreSQL account, then use the same username and password in the connection form below.</p>
              </div>

              {externalGroundingContext?.externalData ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Configured source: <span className="font-semibold text-gray-900">{externalGroundingContext.providerContext.source}</span> | Provider: <span className="font-semibold text-gray-900">{externalGroundingContext.externalData.providerType}</span> | Ready: <span className="font-semibold text-gray-900">{externalGroundingContext.providerContext.externalGroundingReady ? 'Yes' : 'No'}</span>
                  </p>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Status</p>
                      <p className="text-lg font-semibold text-gray-900">{externalGroundingContext.externalData.status}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Validation</p>
                      <p className="text-lg font-semibold text-gray-900">{externalGroundingContext.externalData.validationState}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Grounding Enabled</p>
                      <p className="text-lg font-semibold text-gray-900">{externalGroundingContext.externalData.groundingEnabled ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Contract Issues</p>
                      <p className="text-lg font-semibold text-gray-900">{currentExternalContractIssues.length}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
                    <p><span className="font-semibold">Connection:</span> {externalGroundingContext.externalData.host} / {externalGroundingContext.externalData.databaseName} / {externalGroundingContext.externalData.schemaName}</p>
                    <p className="mt-1"><span className="font-semibold">Last validated:</span> {externalGroundingContext.externalData.lastValidatedAt ? new Date(externalGroundingContext.externalData.lastValidatedAt).toLocaleString() : 'Not validated yet'}</p>
                    {externalDataSummary?.lastHealthAt && (
                      <p className="mt-1"><span className="font-semibold">Last health check:</span> {new Date(externalDataSummary.lastHealthAt).toLocaleString()} ({externalDataSummary.lastHealthStatus || 'unknown'})</p>
                    )}
                    {externalGroundingContext.externalData.lastValidationError && (
                      <p className="mt-1 text-rose-700"><span className="font-semibold">Last validation error:</span> {externalGroundingContext.externalData.lastValidationError}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600">No external data connection is configured for this tenant yet.</p>
              )}

              <form className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 lg:grid-cols-2" onSubmit={submitExternalConnection}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Connection Name</label>
                    <input
                      className="input mt-1"
                      value={externalConnectionForm.connectionName}
                      onChange={(e) => setExternalConnectionForm((current) => ({ ...current, connectionName: e.target.value }))}
                      placeholder="Warehouse analytics replica"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Host</label>
                    <input
                      className="input mt-1"
                      value={externalConnectionForm.host}
                      onChange={(e) => setExternalConnectionForm((current) => ({ ...current, host: e.target.value }))}
                      placeholder="db.example.com"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Port</label>
                      <input
                        className="input mt-1"
                        type="number"
                        min="1"
                        max="65535"
                        value={externalConnectionForm.port}
                        onChange={(e) => setExternalConnectionForm((current) => ({ ...current, port: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Schema</label>
                      <input
                        className="input mt-1"
                        value={externalConnectionForm.schemaName}
                        onChange={(e) => setExternalConnectionForm((current) => ({ ...current, schemaName: e.target.value }))}
                        placeholder="public"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Database Name</label>
                    <input
                      className="input mt-1"
                      value={externalConnectionForm.databaseName}
                      onChange={(e) => setExternalConnectionForm((current) => ({ ...current, databaseName: e.target.value }))}
                      placeholder="stockpilot_reporting"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Read-only Username</label>
                    <input
                      className="input mt-1"
                      value={externalConnectionForm.username}
                      onChange={(e) => setExternalConnectionForm((current) => ({ ...current, username: e.target.value }))}
                      placeholder={externalDataSummary?.hasStoredCredentials ? 'Leave blank to keep current username' : 'reporting_reader'}
                      required={!externalDataSummary?.hasStoredCredentials}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <input
                      className="input mt-1"
                      type="password"
                      value={externalConnectionForm.password}
                      onChange={(e) => setExternalConnectionForm((current) => ({ ...current, password: e.target.value }))}
                      placeholder={externalDataSummary?.hasStoredCredentials ? 'Leave blank to keep stored password' : 'Required'}
                      required={!externalDataSummary?.hasStoredCredentials}
                    />
                  </div>
                  <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={externalConnectionForm.sslRequired}
                      onChange={(e) => setExternalConnectionForm((current) => ({ ...current, sslRequired: e.target.checked }))}
                    />
                    <span>Require SSL/TLS for the connector session.</span>
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button className="btn-primary" type="submit" disabled={externalDataMutating}>
                      <Save className={`w-4 h-4 ${externalDataMutating ? 'animate-pulse' : ''}`} />
                      {externalDataSummary ? 'Update Connection' : 'Save Connection'}
                    </button>
                    <button className="btn-secondary" type="button" onClick={() => setExternalConnectionForm(buildExternalConnectionForm(externalDataSummary))} disabled={externalDataMutating}>
                      <RotateCcw className="w-4 h-4" /> Reset
                    </button>
                    {externalDataSummary && (
                      <button className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50" type="button" onClick={() => { void disableExternalConnection() }} disabled={externalDataMutating}>
                        <Trash2 className="w-4 h-4" /> Disable Connection
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {externalDataSummary && (
                <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Schema discovery and contract validation</p>
                      <p className="text-sm text-gray-600">Discover tables from the connected database, map the required entities, then validate before turning on grounding.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary" type="button" onClick={() => { void discoverExternalSchema() }} disabled={externalDataMutating}>
                        <Search className="w-4 h-4" /> Discover Schema
                      </button>
                      <button className="btn-secondary" type="button" onClick={applyAllExternalMappingSuggestions} disabled={externalDataMutating || availableExternalTables.length === 0}>
                        <Sparkles className="w-4 h-4" /> Auto-Fill Suggestions
                      </button>
                      <button className="btn-secondary" type="button" onClick={() => { void saveExternalMappings(false) }} disabled={externalDataMutating}>
                        <Save className="w-4 h-4" /> Save Mappings
                      </button>
                      <button className="btn-secondary" type="button" onClick={() => { void validateExternalMappings() }} disabled={externalDataMutating}>
                        <ClipboardCheck className="w-4 h-4" /> Validate
                      </button>
                      <button
                        className={`btn-primary ${externalDataSummary.groundingEnabled ? 'bg-slate-700 hover:bg-slate-800' : ''}`}
                        type="button"
                        onClick={() => { void toggleExternalGrounding(!externalDataSummary.groundingEnabled) }}
                        disabled={externalDataMutating || currentExternalContractIssues.length > 0}
                      >
                        {externalDataSummary.groundingEnabled ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        {externalDataSummary.groundingEnabled ? 'Disable Grounding' : 'Enable Grounding'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr,0.8fr]">
                    <div className="space-y-4">
                      {EXTERNAL_MAPPING_REQUIREMENTS.map((entity) => {
                        const mapping = externalMappingDraft[entity.key]
                        const selectedTable = mapping?.table?.trim()
                          ? availableExternalTableLookup.get(mapping.table.trim().toLowerCase()) || null
                          : null
                        const entityIssue = currentExternalContractIssueByEntity.get(entity.key)
                        const candidateTables = externalEntityCandidateTables[entity.key]
                        const mappedCount = entity.requiredColumns.filter((columnKey) => Boolean(mapping?.columns?.[columnKey]?.trim())).length
                        const optionalMappedCount = (entity.optionalColumns || []).filter((columnKey) => Boolean(mapping?.columns?.[columnKey]?.trim())).length
                        const columnOptionsId = `external-column-options-${entity.key}`
                        return (
                          <div key={entity.key} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{entity.label}</p>
                                <p className="text-xs text-gray-600">{entity.description}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600">{mappedCount}/{entity.requiredColumns.length} mapped</span>
                                <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600">{entity.requiredColumns.length} required fields</span>
                                {entity.optionalColumns && entity.optionalColumns.length > 0 && (
                                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">{optionalMappedCount}/{entity.optionalColumns.length} optional provenance fields</span>
                                )}
                              </div>
                            </div>
                            <div className="mt-3">
                              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Table</label>
                              <input
                                className="input mt-1"
                                list="external-table-options"
                                value={mapping?.table || ''}
                                onChange={(e) => updateExternalMappingTable(entity.key, e.target.value)}
                                placeholder="Choose or type a table name"
                              />
                              {candidateTables.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {candidateTables.map((table) => (
                                    <button
                                      key={`${entity.key}-candidate-${table.name}`}
                                      type="button"
                                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${mapping?.table === table.name ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-gray-200 bg-white text-gray-600 hover:border-sky-200 hover:text-sky-700'}`}
                                      onClick={() => updateExternalMappingTable(entity.key, table.name)}
                                    >
                                      {table.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {selectedTable ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                  <span>{selectedTable.columns.length} discovered columns available for this mapping.</span>
                                  <button type="button" className="font-semibold text-sky-700 hover:text-sky-800" onClick={() => autofillExternalEntityMapping(entity.key)}>
                                    Auto-fill columns
                                  </button>
                                </div>
                              ) : mapping?.table ? (
                                <p className="mt-2 text-xs text-amber-700">This table is not in the latest discovery snapshot. Re-run discovery or correct the table name.</p>
                              ) : null}
                              {entityIssue && (
                                <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                                  {entityIssue.missingMappings.length > 0 && (
                                    <p>Missing mapped fields: {entityIssue.missingMappings.join(', ')}</p>
                                  )}
                                  {entityIssue.missingSchemaColumns.length > 0 && (
                                    <p>Mapped columns missing from schema: {entityIssue.missingSchemaColumns.join(', ')}</p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                              {entity.requiredColumns.map((columnKey) => (
                                <div key={`${entity.key}-${columnKey}`}>
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{columnKey}</label>
                                  <input
                                    className="input mt-1"
                                    list={columnOptionsId}
                                    value={mapping?.columns?.[columnKey] || ''}
                                    onChange={(e) => updateExternalMappingColumn(entity.key, columnKey, e.target.value)}
                                    placeholder={selectedTable ? `Mapped column from ${selectedTable.name}` : `Mapped column for ${columnKey}`}
                                  />
                                </div>
                              ))}
                            </div>
                            {entity.optionalColumns && entity.optionalColumns.length > 0 && (
                              <div className="mt-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Optional provenance fields</p>
                                    <p className="mt-1 text-xs text-gray-600">Map these if your external products table stores original purchase dates or original unit cost.</p>
                                  </div>
                                </div>
                                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                  {entity.optionalColumns.map((columnKey) => (
                                    <div key={`${entity.key}-${columnKey}`}>
                                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{columnKey}</label>
                                      <input
                                        className="input mt-1"
                                        list={columnOptionsId}
                                        value={mapping?.columns?.[columnKey] || ''}
                                        onChange={(e) => updateExternalMappingColumn(entity.key, columnKey, e.target.value)}
                                        placeholder={selectedTable ? `Optional column from ${selectedTable.name}` : `Optional column for ${columnKey}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <datalist id={columnOptionsId}>
                              {(selectedTable?.columns || []).map((column) => (
                                <option key={`${entity.key}-${selectedTable?.name || 'table'}-${column.name}`} value={column.name} />
                              ))}
                            </datalist>
                          </div>
                        )
                      })}
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-semibold text-gray-900">Discovered schema</p>
                        <p className="mt-1 text-xs text-gray-600">{availableExternalTables.length > 0 ? `${availableExternalTables.length} table${availableExternalTables.length === 1 ? '' : 's'} available for mapping.` : 'Run discovery after saving the connection to pull the schema snapshot.'}</p>
                        {externalDiscovery && (
                          <p className={`mt-2 text-xs font-semibold ${externalDiscovery.defaultTransactionReadOnly ? 'text-emerald-700' : 'text-rose-700'}`}>
                            default_transaction_read_only: {externalDiscovery.defaultTransactionReadOnly ? 'on' : 'off'}
                          </p>
                        )}
                        <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                          {availableExternalTables.map((table) => (
                            <div key={table.name} className="rounded-lg border border-gray-200 bg-white p-3">
                              <p className="text-sm font-semibold text-gray-900">{table.name}</p>
                              <p className="mt-1 text-xs text-gray-500">{table.columns.map((column) => column.name).join(', ') || 'No columns discovered'}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {externalValidation && (
                        <div className={`rounded-xl border p-4 ${externalValidation.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                          <p className={`text-sm font-semibold ${externalValidation.ok ? 'text-emerald-900' : 'text-amber-900'}`}>Validation {externalValidation.ok ? 'passed' : 'requires attention'}</p>
                          {externalValidation.missingEntities.length > 0 && (
                            <p className="mt-2 text-sm text-amber-900">Missing entities: {externalValidation.missingEntities.join(', ')}</p>
                          )}
                          <div className="mt-3 space-y-2">
                            {externalValidation.entityResults.map((result) => (
                              <div key={`validation-${result.entity}`} className="rounded-lg border border-white/80 bg-white/90 p-3 text-sm text-gray-700">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-semibold text-gray-900">{result.entity}</p>
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                    {result.ok ? 'Ready' : 'Issue'}
                                  </span>
                                </div>
                                {result.table && <p className="mt-1 text-xs text-gray-500">Table: {result.table}</p>}
                                {typeof result.rowCount === 'number' && <p className="mt-1 text-xs text-gray-500">Sample rows checked: {result.rowCount}</p>}
                                {result.error && <p className="mt-1 text-xs text-rose-700">{result.error}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {currentExternalContractIssues.length > 0 ? (
                        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">Blocking Contract Issues</p>
                          <div className="mt-3 space-y-3">
                            {currentExternalContractIssues.map((issue) => (
                              <div key={`contract-issue-${issue.entity}`} className="rounded-lg border border-orange-200 bg-white p-3">
                                <p className="text-sm font-semibold text-orange-900">{issue.entity}</p>
                                {issue.missingMappings.length > 0 && (
                                  <p className="mt-1 text-sm text-orange-900">Missing mapped fields: {issue.missingMappings.join(', ')}</p>
                                )}
                                {issue.missingSchemaColumns.length > 0 && (
                                  <p className="mt-1 text-sm text-orange-900">Mapped columns missing from schema: {issue.missingSchemaColumns.join(', ')}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : externalDataSummary.groundingEnabled ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                          External mapping contract is complete. Assistant requests can use external-grounded mode when the configured connector is reachable.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                          Contract checks are clear. Validate once, then enable grounding when you are ready for assistant requests to query this source.
                        </div>
                      )}
                    </div>
                  </div>

                  <datalist id="external-table-options">
                    {availableExternalTableNames.map((tableName) => (
                      <option key={`table-option-${tableName}`} value={tableName} />
                    ))}
                  </datalist>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Branch Performance Insights</h2>
          </div>
          <p className="text-sm text-gray-600">{rankingSummary}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[580px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="py-2 text-left">Branch</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Expense</th>
                  <th className="py-2 text-right">Margin</th>
                  <th className="py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {branchRows.length === 0 ? (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={5}>No branch ranking available yet.</td>
                  </tr>
                ) : (
                  branchRows.map((row) => (
                    <tr key={row.branchName} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-900">{row.branchName}</td>
                      <td className="py-2 text-right">{row.revenue.toFixed(2)}</td>
                      <td className="py-2 text-right">{row.expense.toFixed(2)}</td>
                      <td className="py-2 text-right">{row.margin.toFixed(2)}</td>
                      <td className="py-2 text-right">{row.score.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-600" />
            <h2 className="font-semibold text-gray-900">Enterprise Assistant</h2>
          </div>

          <form className="space-y-3" onSubmit={sendAssistantPrompt}>
            {loadedSavedReply && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Loaded For Follow-up Recheck</p>
                <p className="text-sm text-indigo-900 mt-1"><span className="font-semibold">Original prompt:</span> {loadedSavedReply.prompt}</p>
                {loadedSavedReplyFocus.priorityActions.length ? (
                  <ul className="list-disc pl-5 text-sm text-indigo-900 mt-2 space-y-1">
                    {loadedSavedReplyFocus.priorityActions.slice(0, 6).map((item, idx) => (
                      <li key={`${loadedSavedReply.id}-loaded-action-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                {loadedSavedReplyFocus.unresolvedIssues.length ? (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Unresolved Issues</p>
                    <ul className="list-disc pl-5 text-sm text-indigo-900 mt-1 space-y-1">
                      {loadedSavedReplyFocus.unresolvedIssues.slice(0, 5).map((item, idx) => (
                        <li key={`${loadedSavedReply.id}-loaded-risk-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                    onClick={() => injectLoadedReplyRecheckPrompt(loadedSavedReply)}
                  >
                    Use For Prompt
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={assistantRecheckPendingIds[loadedSavedReply.id] || loading}
                    onClick={() => { void loadSavedReplyForRecheck(loadedSavedReply) }}
                  >
                    <TrendingUp className="w-4 h-4" /> {assistantRecheckPendingIds[loadedSavedReply.id] ? 'Rechecking...' : 'Run Recheck Now'}
                  </button>
                </div>
              </div>
            )}
            <textarea
              className="input min-h-[110px]"
              value={assistantPrompt}
              onChange={(e) => setAssistantPrompt(e.target.value)}
              placeholder="Ask for scoped recommendations, e.g. Which branch should reduce discount leakage this week?"
            />
            <div className="flex flex-wrap gap-2">
              {PRESET_PROMPTS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-sm"
                  onClick={() => setAssistantPrompt(preset.prompt)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button className="btn-primary" type="submit" disabled={loading}>Ask Assistant</button>
          </form>

          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Human Approval Queue</p>
                <p className="text-xs text-rose-800 mt-0.5">Order and stock-transfer decisions are high-priority and require explicit human approval.</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={humanApprovalLoading}
                onClick={() => { void loadHumanApprovalQueue() }}
              >
                <RefreshCw className={`w-4 h-4 ${humanApprovalLoading ? 'animate-spin' : ''}`} /> Refresh Queue
              </button>
            </div>

            {humanApprovalQueue.length === 0 ? (
              <p className="mt-3 text-sm text-rose-900">No pending human approvals right now.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {humanApprovalQueue.slice(0, 8).map((item) => (
                  <div key={item.recommendationId} className="rounded-lg border border-rose-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">HIGH PRIORITY</span>
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-700">{item.status}</span>
                      {item.provider && (
                        <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{item.provider}</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-gray-900"><span className="font-semibold">Prompt:</span> {item.prompt}</p>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 space-y-1">
                      {item.highPriorityHumanActions.map((action, idx) => (
                        <li key={`${item.recommendationId}-human-action-${idx}`}>{action}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-gray-500">Detected: {new Date(item.createdAt).toLocaleString()}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={humanApprovalDecisionPendingId === item.recommendationId || approvalHistoryLoading}
                        onClick={() => { void openApprovalHistoryDrawer(item) }}
                      >
                        <FileText className="w-4 h-4" /> History
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={humanApprovalDecisionPendingId === item.recommendationId}
                        onClick={() => { void applyHumanApprovalDecision(item.recommendationId, 'accept') }}
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={humanApprovalDecisionPendingId === item.recommendationId}
                        onClick={() => { void applyHumanApprovalDecision(item.recommendationId, 'reject') }}
                      >
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">Causal Diagnostics</p>
                  <p className="text-xs text-sky-900 mt-0.5">Runs the econometric methods already embedded in the assistant against the current tenant context.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-md border border-sky-200 bg-white px-2 py-1 text-xs text-sky-900"
                    value={causalMethod}
                    onChange={(e) => setCausalMethod(e.target.value as 'granger' | 'did' | 'synthetic')}
                  >
                    <option value="granger">Granger</option>
                    <option value="did">DiD</option>
                    <option value="synthetic">Synthetic</option>
                  </select>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={causalDiagnosticsLoading}
                    onClick={() => { void loadCausalDiagnostics() }}
                  >
                    <RefreshCw className={`w-4 h-4 ${causalDiagnosticsLoading ? 'animate-spin' : ''}`} /> Run
                  </button>
                </div>
              </div>

              {causalDiagnostics ? (
                <div className="mt-3 space-y-2 text-sm text-sky-950">
                  <p><span className="font-semibold">Problem:</span> {causalDiagnostics.problem}</p>
                  <p><span className="font-semibold">Interpretation:</span> {causalDiagnostics.interpretation}</p>
                  <p><span className="font-semibold">Confidence:</span> {Math.round(causalDiagnostics.confidenceScore * 100)}%</p>
                  {causalDiagnostics.selectedMethod && (
                    <div className="rounded-md border border-sky-200 bg-white p-3 text-xs text-sky-900">
                      <p className="font-semibold">Selected method</p>
                      <p className="mt-1">{causalDiagnostics.selectedMethod.title}</p>
                      <p className="mt-1">{causalDiagnostics.selectedMethod.signal}</p>
                      <p className="mt-1">Confidence {Math.round(causalDiagnostics.selectedMethod.confidence * 100)}%{causalDiagnostics.selectedMethod.pValue !== undefined ? ` | p=${causalDiagnostics.selectedMethod.pValue.toFixed(3)}` : ''}</p>
                    </div>
                  )}
                  {causalDiagnostics.topCauses.length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-sky-900 space-y-1">
                      {causalDiagnostics.topCauses.slice(0, 4).map((cause, idx) => (
                        <li key={`causal-top-cause-${idx}`}>{cause.cause} ({Math.round(cause.contribution * 100)}%)</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-sky-900">No causal diagnostics loaded yet.</p>
              )}
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Calibrated Simulation</p>
                  <p className="text-xs text-emerald-900 mt-0.5">Preview a single calibrated scenario with confidence intervals and historical accuracy.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-900"
                    value={simulationType}
                    onChange={(e) => setSimulationType(e.target.value as 'price_change' | 'marketing_spend' | 'inventory_change' | 'staffing_change' | 'expansion')}
                  >
                    <option value="price_change">Price Change</option>
                    <option value="marketing_spend">Marketing Spend</option>
                    <option value="inventory_change">Inventory Change</option>
                    <option value="staffing_change">Staffing Change</option>
                    <option value="expansion">Expansion</option>
                  </select>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={simulationPreviewLoading}
                    onClick={() => { void loadSimulationPreview() }}
                  >
                    <RefreshCw className={`w-4 h-4 ${simulationPreviewLoading ? 'animate-spin' : ''}`} /> Simulate
                  </button>
                </div>
              </div>

              {simulationPreview ? (
                <div className="mt-3 space-y-2 text-sm text-emerald-950">
                  <p><span className="font-semibold">Scenario:</span> {simulationPreview.scenario}</p>
                  <p><span className="font-semibold">Projected profit:</span> {simulationPreview.pointEstimate.toLocaleString()}</p>
                  <p><span className="font-semibold">Profit interval:</span> {simulationPreview.confidenceInterval[0].toLocaleString()} to {simulationPreview.confidenceInterval[1].toLocaleString()}</p>
                  <p><span className="font-semibold">Calibration:</span> {Math.round(simulationPreview.calibrationScore * 100)}% | Historical accuracy: {Math.round(simulationPreview.historicalAccuracy * 100)}%</p>
                  <p><span className="font-semibold">Interpretation:</span> {simulationPreview.interpretation}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-emerald-900">No simulation preview loaded yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Workflow Dashboard</p>
                <p className="text-xs text-amber-900 mt-0.5">Review persisted workflow executions, pending approvals, and workflow coverage from assistant-generated plans.</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={workflowDashboardLoading}
                onClick={() => { void loadWorkflowDashboard() }}
              >
                <RefreshCw className={`w-4 h-4 ${workflowDashboardLoading ? 'animate-spin' : ''}`} /> Refresh Workflows
              </button>
            </div>

            {workflowDashboard ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-amber-950">
                  Workflows: {workflowDashboard.stats.totalWorkflows} total | Active: {workflowDashboard.stats.activeWorkflows} | Pending approvals: {workflowDashboard.stats.pendingApprovalsCount} | Success rate: {Math.round(workflowDashboard.stats.successRate * 100)}%
                </p>

                {workflowDashboard.pendingApprovals.length > 0 ? (
                  <div className="space-y-2">
                    {workflowDashboard.pendingApprovals.slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded-md border border-amber-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-amber-950">{item.ruleName}</p>
                            <p className="text-xs text-amber-800">Trigger: {item.trigger} | Status: {item.status} | Approval: {item.approvalStatus}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={workflowDecisionPendingId === item.id || workflowRollbackPendingId === item.id}
                              onClick={() => { void reviewWorkflowExecution(item.id, true) }}
                            >
                              <CheckCircle2 className="w-4 h-4" /> Approve
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={workflowDecisionPendingId === item.id || workflowRollbackPendingId === item.id}
                              onClick={() => { void reviewWorkflowExecution(item.id, false) }}
                            >
                              <XCircle className="w-4 h-4" /> Reject
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-amber-900">Created {new Date(item.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-amber-900">No pending workflow approvals right now.</p>
                )}

                <div className="rounded-lg border border-amber-200 bg-white/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Recent Executions</p>
                      <p className="text-xs text-amber-900 mt-0.5">Execution outcomes, realized impact capture, and rollback availability for the latest workflows.</p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      {workflowDashboard.recentExecutions.length} records
                    </span>
                  </div>

                  {workflowDashboard.recentExecutions.length === 0 ? (
                    <p className="mt-3 text-sm text-amber-900">No workflow executions recorded yet.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {workflowDashboard.recentExecutions.slice(0, 8).map((item) => {
                        const outcome = summarizeWorkflowOutcome(item.result)
                        const statusUi = getWorkflowStatusUi(item.status)
                        const canRollback = outcome.rollbackReady && (item.status === 'executed' || item.status === 'handoff_required')

                        return (
                          <div key={`workflow-execution-${item.id}`} className="rounded-md border border-amber-200 bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-amber-950">{item.ruleName}</p>
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusUi.classes}`}>
                                    {statusUi.label}
                                  </span>
                                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                                    Approval: {item.approvalStatus}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-amber-800">Trigger: {item.trigger} | Action: {item.action}</p>
                                <p className="mt-1 text-[11px] text-gray-500">Created {new Date(item.createdAt).toLocaleString()}{item.approvedAt ? ` | Approved ${new Date(item.approvedAt).toLocaleString()}` : ''}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700"
                                  onClick={() => openWorkflowExecutionDetail(item)}
                                >
                                  <FileText className="w-4 h-4" /> Details
                                </button>
                                {canRollback && (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={workflowRollbackPendingId === item.id || workflowDecisionPendingId === item.id}
                                    onClick={() => { void rollbackWorkflowExecution(item.id) }}
                                  >
                                    <RotateCcw className="w-4 h-4" /> {workflowRollbackPendingId === item.id ? 'Rolling back...' : 'Rollback'}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-xs text-amber-950">
                              <div className="rounded-md border border-amber-100 bg-amber-50/50 p-2">
                                <p className="font-semibold text-amber-700">Operation</p>
                                <p className="mt-1">{outcome.operation || 'workflow'}</p>
                              </div>
                              <div className="rounded-md border border-amber-100 bg-amber-50/50 p-2">
                                <p className="font-semibold text-amber-700">Actual Impact</p>
                                <p className="mt-1">{outcome.actualImpact === null ? 'Not measured' : `${outcome.actualImpact.toLocaleString()}%`}</p>
                              </div>
                              <div className="rounded-md border border-amber-100 bg-amber-50/50 p-2">
                                <p className="font-semibold text-amber-700">Measured</p>
                                <p className="mt-1">{outcome.measuredAt ? new Date(outcome.measuredAt).toLocaleString() : 'Pending'}</p>
                              </div>
                              <div className="rounded-md border border-amber-100 bg-amber-50/50 p-2">
                                <p className="font-semibold text-amber-700">Rollback</p>
                                <p className="mt-1">{outcome.rolledBackAt ? `Completed ${new Date(outcome.rolledBackAt).toLocaleString()}` : outcome.rollbackReady ? 'Available' : 'Not available'}</p>
                              </div>
                            </div>

                            {outcome.handoffRequired && (
                              <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 p-2 text-xs text-violet-900">
                                This execution produced a governed handoff instead of direct mutation because the underlying business operation is not implemented in the current domain model.
                              </div>
                            )}

                            {outcome.message && (
                              <p className="mt-3 text-sm text-amber-950"><span className="font-semibold">Outcome:</span> {outcome.message}</p>
                            )}

                            {outcome.detailLines.length > 0 && (
                              <ul className="mt-2 list-disc pl-5 text-xs text-amber-900 space-y-1">
                                {outcome.detailLines.map((detail, idx) => (
                                  <li key={`${item.id}-workflow-detail-${idx}`}>{detail}</li>
                                ))}
                              </ul>
                            )}

                            {item.errorMessage && (
                              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
                                <span className="font-semibold">Execution error:</span> {item.errorMessage}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-amber-900">No workflow dashboard data loaded yet.</p>
            )}
          </div>

          <div className="space-y-3 max-h-[420px] lg:max-h-[520px] overflow-auto pr-1">
            {assistantReplies.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 text-center">
                <p className="text-sm font-medium text-gray-600">No assistant response yet.</p>
                <p className="text-xs text-gray-500 mt-1">Ask a focused question to start your strategy history.</p>
              </div>
            ) : (
              assistantReplies.map((reply) => (
                <div key={reply.id} className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/30 to-white p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      Assistant Reply
                    </span>
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-500">
                      {new Date(reply.createdAt).toLocaleString()}
                    </span>
                    {reply.provider && (
                      <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                        {reply.provider}
                      </span>
                    )}
                    {reply.groundingSource && (
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${reply.groundingSource === 'external' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                        {reply.groundingSource === 'external' ? 'External Grounding' : 'Internal Grounding'}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Prompt</p>
                    <p className="text-sm text-gray-800 mt-1 leading-relaxed">{reply.prompt}</p>
                  </div>

                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Response</p>
                  {reply.brief ? (
                    <div className="mt-2 space-y-3">
                      {reply.incomeBreakdown && shouldShowIncomeBreakdownForPrompt(reply.prompt, reply.incomeBreakdown) && (
                        <div className="rounded-md border border-cyan-100 bg-cyan-50 p-3">
                          <p className="text-xs font-semibold text-cyan-700">Income Streams (30d)</p>
                          <div className={`mt-2 grid grid-cols-1 ${shouldShowSubscriptionIncomeRow(reply.incomeBreakdown) ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2 text-xs`}>
                            <div className="rounded border border-cyan-200 bg-white p-2">
                              <p className="text-cyan-600 font-semibold">Total Income</p>
                              <p className="text-slate-800 mt-1">{reply.currencyCode || baseCurrency} {Number(reply.incomeBreakdown.totalIncome).toLocaleString()}</p>
                            </div>
                            <div className="rounded border border-cyan-200 bg-white p-2">
                              <p className="text-cyan-600 font-semibold">Sales</p>
                              <p className="text-slate-800 mt-1">{reply.currencyCode || baseCurrency} {Number(reply.incomeBreakdown.salesIncome).toLocaleString()} ({Number(reply.incomeBreakdown.streamMix.salesPct).toFixed(1)}%)</p>
                            </div>
                            {shouldShowSubscriptionIncomeRow(reply.incomeBreakdown) && (
                              <div className="rounded border border-cyan-200 bg-white p-2">
                                <p className="text-cyan-600 font-semibold">Subscription</p>
                                <p className="text-slate-800 mt-1">{reply.currencyCode || baseCurrency} {Number(reply.incomeBreakdown.subscriptionIncome).toLocaleString()} ({Number(reply.incomeBreakdown.streamMix.subscriptionPct).toFixed(1)}%)</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Summary</p>
                        <p className="text-sm text-gray-800 mt-1 leading-relaxed">{reply.brief.summary}</p>
                      </div>
                      {reply.brief.businessGuidance && (() => {
                        const tone = getBusinessGuidanceTone(reply.brief.businessGuidance.operatingMode)
                        return (
                          <div className={`rounded-md border p-3 ${tone.card}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}>
                                {reply.brief.businessGuidance.confidenceLabel}
                              </span>
                              <span className="text-[11px] font-medium text-slate-600">Audience: {reply.brief.businessGuidance.audience}</span>
                            </div>
                            <p className="text-sm text-slate-900 mt-2"><span className="font-semibold">Best next move:</span> {reply.brief.businessGuidance.primaryRecommendation}</p>
                            <p className="text-xs text-slate-700 mt-1"><span className="font-semibold">Why:</span> {reply.brief.businessGuidance.why}</p>
                            <p className="text-xs text-slate-700 mt-1"><span className="font-semibold">Expected impact:</span> {reply.brief.businessGuidance.expectedImpact}</p>
                            <p className="text-xs text-slate-700 mt-1"><span className="font-semibold">Next review:</span> {reply.brief.businessGuidance.nextReview}</p>
                          </div>
                        )
                      })()}
                      {reply.brief.responseMode === 'clarify' && reply.brief.clarificationPrompt && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold text-amber-700">Clarification Mode</p>
                          <p className="text-xs text-amber-900 mt-1">The original prompt was too broad, so the assistant narrowed the next-step options instead of forcing a mixed answer.</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Comparative Insights</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.comparativeInsights.map((item, idx) => (
                            <li key={`${reply.id}-insight-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Actions (next 7 days)</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.actions.map((item, idx) => (
                            <li key={`${reply.id}-action-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Risks</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.risks.map((item, idx) => (
                            <li key={`${reply.id}-risk-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      {reply.brief.factBasis && reply.brief.factBasis.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Fact Basis</p>
                          <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                            {reply.brief.factBasis.map((item, idx) => (
                              <li key={`${reply.id}-fact-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {reply.brief.groundingNotes && reply.brief.groundingNotes.length > 0 && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-700">Grounding Notes</p>
                          <ul className="list-disc pl-5 text-xs text-slate-700 mt-1 space-y-1">
                            {reply.brief.groundingNotes.map((item, idx) => (
                              <li key={`${reply.id}-grounding-note-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {reply.brief.scenarioAnalysis && (
                        <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3">
                          <p className="text-xs font-semibold text-indigo-700">Scenario Analysis</p>
                          <p className="text-sm text-indigo-900 mt-1">
                            Best: {reply.brief.scenarioAnalysis.bestScenario || 'N/A'} | Worst: {reply.brief.scenarioAnalysis.worstScenario || 'N/A'}
                          </p>
                          <p className="text-xs text-indigo-800 mt-1">
                            Profit spread: {reply.brief.scenarioAnalysis.profitSpread.toLocaleString()} | ROI spread: {reply.brief.scenarioAnalysis.roiSpread.toLocaleString()}
                          </p>
                          {(reply.brief.scenarioAnalysis.calibrationScore !== undefined || reply.brief.scenarioAnalysis.historicalAccuracy !== undefined) && (
                            <p className="text-xs text-indigo-800 mt-1">
                              Calibration: {Math.round((reply.brief.scenarioAnalysis.calibrationScore || 0) * 100)}% | Historical accuracy: {Math.round((reply.brief.scenarioAnalysis.historicalAccuracy || 0) * 100)}%
                            </p>
                          )}
                          {reply.brief.scenarioAnalysis.profitConfidenceInterval && (
                            <p className="text-xs text-indigo-800 mt-1">
                              Profit interval: {reply.brief.scenarioAnalysis.profitConfidenceInterval.low.toLocaleString()} to {reply.brief.scenarioAnalysis.profitConfidenceInterval.high.toLocaleString()}
                            </p>
                          )}
                        </div>
                      )}
                      {reply.brief.causalAnalysis && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Root Cause Analysis ({reply.brief.causalAnalysis.problem})</p>
                          <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                            {reply.brief.causalAnalysis.topCauses.map((cause, idx) => (
                              <li key={`${reply.id}-cause-${idx}`}>{cause.cause} ({Math.round(cause.contribution * 100)}%)</li>
                            ))}
                          </ul>
                          {reply.brief.causalAnalysis.methods && reply.brief.causalAnalysis.methods.length > 0 && (
                            <ul className="list-disc pl-5 text-xs text-gray-600 mt-2 space-y-1">
                              {reply.brief.causalAnalysis.methods.map((method, idx) => (
                                <li key={`${reply.id}-method-${idx}`}>
                                  {method.title} | confidence {Math.round(method.confidence * 100)}%{method.pValue !== undefined ? ` | p=${method.pValue.toFixed(3)}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {reply.brief.strategicInsights && reply.brief.strategicInsights.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Strategic Insights</p>
                          <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                            {reply.brief.strategicInsights.map((item, idx) => (
                              <li key={`${reply.id}-strategy-${idx}`}>[{item.level}] {item.insight} (ROI {item.estimatedROI}%, {item.timeHorizon})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {reply.brief.explanation && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-semibold text-slate-700">Explainability</p>
                          <p className="text-sm text-slate-800 mt-1">{reply.brief.explanation.summary}</p>
                          <p className="text-xs text-slate-600 mt-1">Confidence: {(reply.brief.explanation.confidence * 100).toFixed(0)}%</p>
                        </div>
                      )}
                      {reply.brief.executionPlan && (
                        <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                          <p className="text-xs font-semibold text-rose-700">Execution Governance</p>
                          <p className="text-sm text-rose-900 mt-1">Auto-executable: {reply.brief.executionPlan.autoExecutableCount} | Human approval required: {reply.brief.executionPlan.approvalRequiredCount}</p>
                          {reply.brief.executionPlan.workflowCoverageScore !== undefined && (
                            <p className="text-xs text-rose-800 mt-1">Workflow coverage: {Math.round(reply.brief.executionPlan.workflowCoverageScore * 100)}%</p>
                          )}
                          {reply.brief.executionPlan.highPriorityHumanActions && reply.brief.executionPlan.highPriorityHumanActions.length > 0 && (
                            <ul className="list-disc pl-5 text-sm text-rose-900 mt-1 space-y-1">
                              {reply.brief.executionPlan.highPriorityHumanActions.map((item, idx) => (
                                <li key={`${reply.id}-human-approval-${idx}`}>HIGH RECOMMENDATION: {item}</li>
                              ))}
                            </ul>
                          )}
                          {reply.brief.executionPlan.workflowStages && reply.brief.executionPlan.workflowStages.length > 0 && (
                            <ul className="list-disc pl-5 text-xs text-rose-800 mt-2 space-y-1">
                              {reply.brief.executionPlan.workflowStages.map((item, idx) => (
                                <li key={`${reply.id}-workflow-stage-${idx}`}>
                                  {item.actionType}: {item.stageCount} stages, {item.matchedRules} matching rules{item.executionId ? `, execution ${item.executionId}` : ''}{item.approvalStatus ? `, ${item.approvalStatus}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {reply.brief.alerts && reply.brief.alerts.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Auto-Detected Issues</p>
                          <div className="mt-1 space-y-2">
                            {reply.brief.alerts.map((alert, idx) => {
                              const tone = getIssueTone(alert.severity, alert.message)
                              const toneUi = getIssueToneUi(tone)

                              return (
                                <div key={`${reply.id}-alert-${idx}`} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneUi.classes}`}>
                                    {toneUi.label}
                                  </span>
                                  <p className="text-sm text-gray-900 mt-1">{alert.message}</p>
                                  <p className="text-xs text-gray-700 mt-1"><span className="font-semibold">Action:</span> {alert.actionRequired}</p>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Follow-up Questions</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-2">
                          {reply.brief.followUpQuestions.map((item, idx) => (
                            <li key={`${reply.id}-followup-${idx}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>{item}</span>
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 transition-colors hover:bg-cyan-100"
                                  onClick={() => { void runReplyFollowUp(reply, item) }}
                                >
                                  Ask now
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                                  onClick={() => {
                                    setLoadedSavedReply(reply)
                                    setAssistantPrompt(item)
                                  }}
                                >
                                  Load to prompt
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {reply.provider && (
                        <p className="text-[11px] text-gray-500">Generated via: {reply.provider}{reply.groundingSource ? ` | Grounding: ${reply.groundingSource}` : ''}</p>
                      )}
                      {reply.externalData && reply.externalData.contractIssues.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold text-amber-700">External grounding fallback</p>
                          <p className="text-xs text-amber-900 mt-1">This reply used internal grounding because the external mapping contract is still incomplete.</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-800 mt-1 whitespace-pre-line">{reply.response}</p>
                  )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={assistantSavePendingIds[reply.id] || savedSourceIds.has(reply.id)}
                      onClick={() => { void saveAssistantReply(reply) }}
                    >
                      <Save className="w-4 h-4" />
                      {savedSourceIds.has(reply.id) ? 'Saved' : assistantSavePendingIds[reply.id] ? 'Saving...' : 'Save for later'}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100"
                      onClick={() => printAssistantReply(reply)}
                    >
                      <Printer className="w-4 h-4" />
                      Print
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-2 border-t border-gray-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Saved for later</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Search, recheck progress, export, and print from your strategy archive.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100" type="button" onClick={() => { void exportSavedEntriesPdf(filteredSavedAssistantReplies) }}>
                  <FileText className="w-4 h-4" /> Export PDF
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100" type="button" onClick={() => exportSavedEntriesCsv(filteredSavedAssistantReplies)}>
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => { void loadSavedAssistantReplies() }} disabled={loadingSavedAssistant}>
                  <RefreshCw className={`w-4 h-4 ${loadingSavedAssistant ? 'animate-spin' : ''}`} /> Refresh Saved
                </button>
              </div>
            </div>
            <div className="mt-2 relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                className="input pl-8"
                value={savedAssistantSearch}
                onChange={(e) => setSavedAssistantSearch(e.target.value)}
                placeholder="Search saved prompts and responses"
              />
            </div>
            <div className="mt-2 space-y-2 max-h-64 lg:max-h-80 overflow-auto pr-1">
              {filteredSavedAssistantReplies.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">No saved assistant entries yet.</p>
                </div>
              ) : (
                filteredSavedAssistantReplies.map((reply) => (
                  <div key={reply.id} className="rounded-lg border border-gray-200 p-3 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:border-indigo-200">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Saved Reply</span>
                      {reply.provider && <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{reply.provider}</span>}
                      {reply.groundingSource && (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${reply.groundingSource === 'external' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                          {reply.groundingSource === 'external' ? 'External Grounding' : 'Internal Grounding'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 line-clamp-2"><span className="font-semibold">Prompt:</span> {reply.prompt}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2"><span className="font-semibold">Response:</span> {reply.response}</p>
                    {buildGroundingMetaText(reply) && (
                      <p className="text-[11px] text-gray-500 mt-1">{buildGroundingMetaText(reply)}</p>
                    )}
                    {reply.brief?.alerts && reply.brief.alerts.length > 0 && (
                      <p className="text-[11px] text-amber-700 mt-1 font-medium">Auto-detected issues: {reply.brief.alerts.length}</p>
                    )}
                    {reply.externalData?.contractIssues.length ? (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                        <p className="text-[11px] font-semibold text-amber-700">Fallback persisted with contract issues</p>
                        <p className="mt-1 text-[11px] text-amber-900 line-clamp-3">{buildContractIssueSummary(reply)}</p>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-gray-400">{new Date(reply.createdAt).toLocaleString()}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                          onClick={() => loadSavedReplyOnly(reply)}
                        >
                          <Search className="w-4 h-4" /> Load To Prompt
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={assistantRecheckPendingIds[reply.id] || loading}
                          onClick={() => { void loadSavedReplyForRecheck(reply) }}
                        >
                          <TrendingUp className="w-4 h-4" /> {assistantRecheckPendingIds[reply.id] ? 'Rechecking...' : 'Load & Recheck'}
                        </button>
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100" onClick={() => printAssistantReply(reply)}>
                          <Printer className="w-4 h-4" /> Print
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={assistantDeletePendingIds[reply.id]}
                          onClick={() => openDeleteConfirmDialog(reply)}
                        >
                          <Trash2 className="w-4 h-4" /> {assistantDeletePendingIds[reply.id] ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {deleteConfirmReply && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 transition-opacity duration-200 ${deleteDialogVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteConfirmDialog()
            }
          }}
        >
          <div
            className={`w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${deleteDialogVisible ? 'translate-y-0 scale-100' : 'translate-y-2 scale-95'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Delete saved assistant entry"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-lg font-semibold text-slate-900">Delete Saved Assistant Entry?</p>
              <p className="text-sm text-slate-500 mt-1">This action is permanent and cannot be undone.</p>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Prompt Preview</p>
                <p className="text-sm text-slate-800 mt-1">
                  {deleteConfirmReply.prompt.length > 200
                    ? `${deleteConfirmReply.prompt.slice(0, 200)}...`
                    : deleteConfirmReply.prompt}
                </p>
              </div>
              <p className="text-xs text-slate-500">Created: {new Date(deleteConfirmReply.createdAt).toLocaleString()}</p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="btn-secondary"
                ref={deleteDialogCancelButtonRef}
                onClick={closeDeleteConfirmDialog}
                disabled={assistantDeletePendingIds[deleteConfirmReply.id]}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-rose-600 hover:bg-rose-700"
                onClick={() => { void deleteSavedAssistantReply(deleteConfirmReply) }}
                disabled={assistantDeletePendingIds[deleteConfirmReply.id]}
              >
                {assistantDeletePendingIds[deleteConfirmReply.id] ? 'Deleting...' : 'Yes, Delete Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {approvalHistoryQueueItem && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 transition-opacity duration-200 ${approvalHistoryVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeApprovalHistoryDrawer()
            }
          }}
        >
          <div
            className={`w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${approvalHistoryVisible ? 'translate-y-0 scale-100' : 'translate-y-2 scale-95'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Approval history"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-lg font-semibold text-slate-900">Approval Audit History</p>
              <p className="text-sm text-slate-500 mt-1">Review who approved or rejected this high-priority human action and when.</p>
            </div>

            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-auto">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Prompt Preview</p>
                <p className="text-sm text-slate-800 mt-1">{approvalHistoryQueueItem.prompt}</p>
              </div>

              {approvalHistoryLoading ? (
                <p className="text-sm text-slate-600">Loading approval history...</p>
              ) : approvalHistoryData ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current Status</p>
                    <p className="text-sm text-slate-900 mt-1">{approvalHistoryData.status}</p>
                    <p className="text-xs text-slate-500 mt-1">{approvalHistoryData.summary}</p>
                  </div>

                  {approvalHistoryData.history.length === 0 ? (
                    <p className="text-sm text-slate-600">No approval decisions have been recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {approvalHistoryData.history.map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{entry.action.toUpperCase()}</span>
                            <span className="text-[11px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-slate-900 mt-2">
                            {entry.actor
                              ? `${entry.actor.firstName} ${entry.actor.lastName} (${entry.actor.role})`
                              : 'Unknown actor'}
                          </p>
                          {entry.actor?.email && <p className="text-xs text-slate-500 mt-1">{entry.actor.email}</p>}
                          {entry.note && <p className="text-sm text-slate-700 mt-2"><span className="font-semibold">Note:</span> {entry.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600">History unavailable.</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="btn-secondary"
                ref={approvalHistoryCloseButtonRef}
                onClick={closeApprovalHistoryDrawer}
                disabled={approvalHistoryLoading}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedWorkflowExecution && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 transition-opacity duration-200 ${workflowExecutionDetailVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeWorkflowExecutionDetail()
            }
          }}
        >
          <div
            className={`w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${workflowExecutionDetailVisible ? 'translate-y-0 scale-100' : 'translate-y-2 scale-95'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Workflow execution detail"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-lg font-semibold text-slate-900">Workflow Execution Detail</p>
              <p className="text-sm text-slate-500 mt-1">Inspect workflow inputs, execution payloads, and rollback metadata for this run.</p>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-auto">
              {(() => {
                const outcome = summarizeWorkflowOutcome(selectedWorkflowExecution.result)
                const statusUi = getWorkflowStatusUi(selectedWorkflowExecution.status)
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusUi.classes}`}>
                        {statusUi.label}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                        Approval: {selectedWorkflowExecution.approvalStatus}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                        Rule: {selectedWorkflowExecution.ruleName}
                      </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Execution Id</p>
                        <p className="mt-1 break-all text-sm text-slate-900">{selectedWorkflowExecution.id}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operation</p>
                        <p className="mt-1 text-sm text-slate-900">{outcome.operation || 'workflow'}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Actual Impact</p>
                        <p className="mt-1 text-sm text-slate-900">{outcome.actualImpact === null ? 'Not measured' : `${outcome.actualImpact.toLocaleString()}%`}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Rollback State</p>
                        <p className="mt-1 text-sm text-slate-900">{outcome.rolledBackAt ? `Rolled back ${new Date(outcome.rolledBackAt).toLocaleString()}` : outcome.rollbackReady ? 'Available' : 'Not available'}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Lifecycle</p>
                      <p className="mt-1 text-sm text-slate-900">Created: {new Date(selectedWorkflowExecution.createdAt).toLocaleString()}</p>
                      <p className="mt-1 text-sm text-slate-900">Approved: {selectedWorkflowExecution.approvedAt ? new Date(selectedWorkflowExecution.approvedAt).toLocaleString() : 'Not approved yet'}</p>
                      <p className="mt-1 text-sm text-slate-900">Measured: {outcome.measuredAt ? new Date(outcome.measuredAt).toLocaleString() : 'Pending outcome capture'}</p>
                    </div>

                    {outcome.message && (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Outcome Summary</p>
                        <p className="mt-1 text-sm text-indigo-950">{outcome.message}</p>
                      </div>
                    )}

                    {outcome.detailLines.length > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Parsed Details</p>
                        <ul className="mt-2 list-disc pl-5 text-sm text-slate-800 space-y-1">
                          {outcome.detailLines.map((line, idx) => (
                            <li key={`${selectedWorkflowExecution.id}-detail-line-${idx}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedWorkflowExecution.errorMessage && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-rose-600">Execution Error</p>
                        <p className="mt-1 text-sm text-rose-950">{selectedWorkflowExecution.errorMessage}</p>
                      </div>
                    )}

                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Trigger Data</p>
                        <pre className="mt-2 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">{stringifyWorkflowPayload(selectedWorkflowExecution.triggerData)}</pre>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Action Payload</p>
                        <pre className="mt-2 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">{stringifyWorkflowPayload(selectedWorkflowExecution.actionTaken)}</pre>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Result Payload</p>
                        <pre className="mt-2 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">{stringifyWorkflowPayload(selectedWorkflowExecution.result)}</pre>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="btn-secondary"
                ref={workflowExecutionDetailCloseButtonRef}
                onClick={closeWorkflowExecutionDetail}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-cyan-700" />
            <h2 className="font-semibold text-gray-900">Reliability and Accuracy</h2>
          </div>
          <button className="btn-secondary" onClick={() => { void loadReliabilityMetrics() }} disabled={reliabilityLoading}>
            <RefreshCw className={`w-4 h-4 ${reliabilityLoading ? 'animate-spin' : ''}`} /> Refresh Metrics
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Track assistant quality in production using grounding score, fallback rate, and latency. Use this panel to detect drift before response quality degrades.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <ConfidenceGauge
              value={reliability.groundingQualityAvg === null ? 0 : reliability.groundingQualityAvg * 100}
              label="Grounding Quality"
              size="sm"
            />
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Fallback Rate</p>
            <p className={`text-lg font-bold tabular-nums ${reliability.fallbackRate === null ? 'text-gray-600' : (reliability.fallbackRate > 0.2 ? 'text-rose-700' : reliability.fallbackRate > 0.05 ? 'text-amber-700' : 'text-emerald-700')}`}>
              {reliability.fallbackRate === null ? 'n/a' : `${(reliability.fallbackRate * 100).toFixed(1)}%`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Latency P95</p>
            <p className={`text-lg font-bold tabular-nums ${reliability.responseP95LatencyMs === null ? 'text-gray-600' : reliability.responseP95LatencyMs > 5000 ? 'text-rose-700' : reliability.responseP95LatencyMs > 2000 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {reliability.responseP95LatencyMs === null ? 'n/a' : `${Math.round(reliability.responseP95LatencyMs / 1000)}s`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">External LLM Latency</p>
            <p className={`text-lg font-bold tabular-nums ${reliability.externalProviderAvgLatencyMs === null ? 'text-gray-600' : reliability.externalProviderAvgLatencyMs > 5000 ? 'text-rose-700' : reliability.externalProviderAvgLatencyMs > 2000 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {reliability.externalProviderAvgLatencyMs === null ? 'n/a' : `${(reliability.externalProviderAvgLatencyMs / 1000).toFixed(1)}s`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Data Freshness</p>
            <p className={`text-lg font-bold tabular-nums ${reliability.freshnessHours === null ? 'text-gray-600' : reliability.freshnessHours > 24 ? 'text-rose-700' : reliability.freshnessHours > 6 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {reliability.freshnessHours === null ? 'n/a' : `${reliability.freshnessHours.toFixed(1)}h`}
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500">Sample size: {reliability.sampleSize} assistant response metric(s).</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-violet-600" />
            <h2 className="font-semibold text-gray-900">Alert Fatigue Policy</h2>
          </div>
          <button className="btn-secondary" onClick={() => { void loadAlertPolicy() }} disabled={alertPolicyLoading}>
            <RefreshCw className={`w-4 h-4 ${alertPolicyLoading ? 'animate-spin' : ''}`} /> Refresh Policy
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Tune enterprise alert noise controls for this tenant. Scheduler emits only alerts that pass priority, quiet-hours, ack-cooldown, and dedupe checks.
        </p>

        <form className="rounded-xl border border-gray-100 p-4 bg-gray-50 space-y-3" onSubmit={saveAlertPolicy}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <label className="text-sm text-gray-700">
              Minimum priority
              <select
                className="input mt-1"
                value={alertPolicyDraft.minPriorityToNotify}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, minPriorityToNotify: e.target.value as AlertPriority }))}
              >
                <option value="P1">P1 only</option>
                <option value="P2">P1 + P2</option>
                <option value="P3">P1 + P2 + P3</option>
              </select>
            </label>

            <label className="text-sm text-gray-700">
              Quiet start (UTC hour)
              <input
                className="input mt-1"
                type="number"
                min={0}
                max={23}
                value={alertPolicyDraft.quietHoursStartUtc}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, quietHoursStartUtc: e.target.value }))}
                placeholder="blank = disabled"
              />
            </label>

            <label className="text-sm text-gray-700">
              Quiet end (UTC hour)
              <input
                className="input mt-1"
                type="number"
                min={0}
                max={23}
                value={alertPolicyDraft.quietHoursEndUtc}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, quietHoursEndUtc: e.target.value }))}
                placeholder="blank = disabled"
              />
            </label>

            <label className="text-sm text-gray-700">
              Suppress after read (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={336}
                value={alertPolicyDraft.suppressAfterAckHours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, suppressAfterAckHours: e.target.value }))}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm text-gray-700">
              Dedupe P1 (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={48}
                value={alertPolicyDraft.dedupeP1Hours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, dedupeP1Hours: e.target.value }))}
              />
            </label>
            <label className="text-sm text-gray-700">
              Dedupe P2 (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={72}
                value={alertPolicyDraft.dedupeP2Hours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, dedupeP2Hours: e.target.value }))}
              />
            </label>
            <label className="text-sm text-gray-700">
              Dedupe P3 (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={168}
                value={alertPolicyDraft.dedupeP3Hours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, dedupeP3Hours: e.target.value }))}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Source: {alertPolicyMeta.source} {alertPolicyMeta.updatedAt ? `• Updated ${new Date(alertPolicyMeta.updatedAt).toLocaleString()}` : ''}
            </p>
            <button className="btn-primary" type="submit" disabled={alertPolicySaving}>
              {alertPolicySaving ? 'Saving Policy...' : 'Save Policy'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-100 p-4 bg-white space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-800">Recent Policy Revisions</p>
            <p className="text-xs text-gray-500">Showing last {alertPolicyRevisions.length} revision(s)</p>
          </div>

          {alertPolicyRevisions.length === 0 ? (
            <p className="text-sm text-gray-500">No policy revisions found yet.</p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-auto">
              {alertPolicyRevisions.map((revision, idx) => {
                const isCurrent = revision.id === alertPolicyMeta.signalId
                return (
                  <div key={revision.id} className="rounded-lg border border-gray-100 p-3 bg-gray-50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-600">
                        Rev {idx + 1} • {new Date(revision.effectiveDate).toLocaleString()} • {revision.source}
                      </p>
                      <button
                        className="btn-secondary"
                        disabled={isCurrent || restoringPolicyId === revision.id}
                        onClick={() => { void restoreAlertPolicy(revision.id) }}
                      >
                        {isCurrent ? 'Current' : restoringPolicyId === revision.id ? 'Restoring...' : 'Restore'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      min: {revision.policy.minPriorityToNotify} • quiet: {revision.policy.quietHoursStartUtc ?? 'none'}-{revision.policy.quietHoursEndUtc ?? 'none'} • ack: {revision.policy.suppressAfterAckHours}h
                    </p>
                    <p className="text-xs text-gray-500">
                      dedupe: P1 {revision.policy.dedupeHoursByPriority.P1}h / P2 {revision.policy.dedupeHoursByPriority.P2}h / P3 {revision.policy.dedupeHoursByPriority.P3}h
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-sky-600" />
            <h2 className="font-semibold text-gray-900">Action Tracker Board</h2>
          </div>
          <button className="btn-secondary" onClick={() => { void Promise.all([loadActionItems(), loadActionCandidates()]) }}>
            <RefreshCw className="w-4 h-4" /> Refresh Board
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">Tracked Actions</p>
            <p className="text-lg font-semibold text-gray-900">{actionSummary.total}</p>
          </div>
          <div className="rounded-lg border border-rose-100 p-3 bg-rose-50">
            <p className="text-xs text-rose-700">Overdue</p>
            <p className="text-lg font-semibold text-rose-900">{actionSummary.overdue}</p>
          </div>
          <div className="rounded-lg border border-amber-100 p-3 bg-amber-50">
            <p className="text-xs text-amber-700">In Progress</p>
            <p className="text-lg font-semibold text-amber-900">{actionSummary.inProgress}</p>
          </div>
          <div className="rounded-lg border border-emerald-100 p-3 bg-emerald-50">
            <p className="text-xs text-emerald-700">Done</p>
            <p className="text-lg font-semibold text-emerald-900">{actionSummary.done}</p>
          </div>
        </div>

        <form className="rounded-xl border border-gray-100 p-4 bg-gray-50 space-y-3" onSubmit={createActionFromRecommendation}>
          <p className="text-sm font-medium text-gray-800">Create tracked action from recommendation</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <select className="input" value={selectedRecommendationId} onChange={(e) => setSelectedRecommendationId(e.target.value)}>
              {actionCandidates.length === 0 ? (
                <option value="">No open recommendations available</option>
              ) : (
                actionCandidates.map((rec) => (
                  <option key={rec.id} value={rec.id}>{rec.title}</option>
                ))
              )}
            </select>
            <input className="input" value={actionOwnerUserId} onChange={(e) => setActionOwnerUserId(e.target.value)} placeholder="Owner user id" />
            <input className="input" type="datetime-local" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} />
            <input className="input" type="number" min={-100} max={100} value={actionExpectedImpact} onChange={(e) => setActionExpectedImpact(e.target.value)} placeholder="Expected impact score (-100 to 100)" />
          </div>
          <textarea className="input" value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} placeholder="Impact notes" />
          <button className="btn-primary" type="submit" disabled={actionSaving || actionCandidates.length === 0}>Create Action</button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[220px]" value={actionFilterStatus} onChange={(e) => setActionFilterStatus(e.target.value as 'ALL' | ActionTrackerStatus)}>
            <option value="ALL">All statuses</option>
            <option value="TODO">TODO</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="BLOCKED">BLOCKED</option>
            <option value="DONE">DONE</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={actionFilterOverdueOnly} onChange={(e) => setActionFilterOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>

        <div className="space-y-3 max-h-[420px] overflow-auto">
          {actionItems.length === 0 ? (
            <p className="text-sm text-gray-500">No tracked actions yet.</p>
          ) : (
            actionItems.map((item) => {
              const draft = actionDrafts[item.recommendationId]
              const dueTs = item.tracker.dueDate ? new Date(item.tracker.dueDate).getTime() : null
              const overdue = dueTs !== null && dueTs < Date.now() && item.tracker.status !== 'DONE' && item.tracker.status !== 'CANCELLED'
              return (
                <div key={item.recommendationId} className="rounded-lg border border-gray-100 p-3 bg-white space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{item.recommendationType} • Owner: {item.tracker.ownerUserId}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${overdue ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                      {overdue ? 'OVERDUE' : item.tracker.status}
                    </span>
                  </div>

                  <p className="text-sm text-gray-700">{item.summary}</p>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2">
                      <p className="text-[11px] text-gray-500 uppercase">Expected Impact</p>
                      <p className="text-sm font-medium text-gray-900">{item.tracker.expectedImpactScore ?? 'n/a'}</p>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2">
                      <p className="text-[11px] text-gray-500 uppercase">Realized Impact</p>
                      <p className="text-sm font-medium text-gray-900">{item.tracker.realizedImpactScore ?? 'n/a'}</p>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2">
                      <p className="text-[11px] text-gray-500 uppercase">Due</p>
                      <p className="text-sm font-medium text-gray-900">{item.tracker.dueDate ? new Date(item.tracker.dueDate).toLocaleString() : 'No due date'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <select
                      className="input"
                      value={draft?.status || item.tracker.status}
                      onChange={(e) => setActionDrafts((prev) => ({
                        ...prev,
                        [item.recommendationId]: {
                          status: e.target.value as ActionTrackerStatus,
                          realizedImpactScore: prev[item.recommendationId]?.realizedImpactScore || '',
                          progressNote: prev[item.recommendationId]?.progressNote || '',
                        },
                      }))}
                    >
                      <option value="TODO">TODO</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="BLOCKED">BLOCKED</option>
                      <option value="DONE">DONE</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                    <input
                      className="input"
                      type="number"
                      min={-100}
                      max={100}
                      placeholder="Realized impact"
                      value={draft?.realizedImpactScore || ''}
                      onChange={(e) => setActionDrafts((prev) => ({
                        ...prev,
                        [item.recommendationId]: {
                          status: prev[item.recommendationId]?.status || item.tracker.status,
                          realizedImpactScore: e.target.value,
                          progressNote: prev[item.recommendationId]?.progressNote || '',
                        },
                      }))}
                    />
                    <button
                      className="btn-primary"
                      disabled={updatingActionId === item.recommendationId}
                      onClick={() => { void updateActionItem(item.recommendationId) }}
                    >
                      {updatingActionId === item.recommendationId ? 'Saving...' : 'Save Update'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-center">
                    <input
                      className="input"
                      placeholder="Progress note"
                      value={draft?.progressNote || ''}
                      onChange={(e) => setActionDrafts((prev) => ({
                        ...prev,
                        [item.recommendationId]: {
                          status: prev[item.recommendationId]?.status || item.tracker.status,
                          realizedImpactScore: prev[item.recommendationId]?.realizedImpactScore || '',
                          progressNote: e.target.value,
                        },
                      }))}
                    />
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <CalendarDays className="w-4 h-4" /> Updated {new Date(item.tracker.updatedAt).toLocaleString()}
                      <TrendingUp className="w-4 h-4 ml-2" /> Recommendation status: {item.recommendationStatus}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
