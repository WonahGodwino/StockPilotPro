import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { trackWorkflowOutcome } from './enterprise-ai-outcome-tracker'
import { clamp, round2 } from './enterprise-ai-statistics'

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumber(value)
  if (parsed === null || parsed <= 0) return null
  return parsed
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mergeRecords(...records: unknown[]): Record<string, unknown> {
  return records.reduce<Record<string, unknown>>((accumulator, record) => ({
    ...accumulator,
    ...asRecord(record),
  }), {})
}

function appendExecutionNote(existing: unknown, note: string): string {
  const base = typeof existing === 'string' && existing.trim() ? existing.trim() : ''
  return base ? `${base}\n${note}` : note
}

export type ExecutableAction = {
  type: 'create_po' | 'adjust_price' | 'transfer_stock' | 'approve_expense' | 'send_alert'
  parameters: Record<string, unknown>
  estimatedImpact: number
  riskLevel: 'low' | 'medium' | 'high'
  requiresApproval: boolean
}

export type WorkflowStage = {
  id: string
  type: 'condition' | 'human_approval' | 'api_call' | 'notification' | 'rollback' | 'audit'
  name: string
  onFailure: 'abort' | 'continue' | 'escalate'
}

export type WorkflowRecord = {
  executionId: string
  status: string
  approvalStatus: string
  rollbackReady: boolean
}

export type WorkflowDefinitionStep = WorkflowStage & {
  config?: Record<string, unknown>
  timeoutMinutes?: number
  retryCount?: number
}

export type WorkflowDefinitionInput = {
  name: string
  trigger: string
  description?: string
  requiresApproval?: boolean
  maxCost?: number
  priority?: number
  auditLevel?: 'full' | 'summary' | 'none'
  steps: WorkflowDefinitionStep[]
  rollbackSteps?: WorkflowDefinitionStep[]
}

export type WorkflowExecutionSummary = {
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

export type WorkflowDashboard = {
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

export type ExecutionPlanItem = {
  action: ExecutableAction
  decision: 'auto_execute' | 'pending_approval'
  priority: 'high' | 'medium' | 'low'
  requiresHumanDecision: boolean
  matchedRuleIds: string[]
  workflowStages: WorkflowStage[]
  workflowRecord?: WorkflowRecord
  reason: string
}

export type ExecutionPlan = {
  actions: ExecutionPlanItem[]
  autoExecutableCount: number
  approvalRequiredCount: number
  highPriorityHumanActions: string[]
  workflowCoverageScore: number
}

type RuleRecord = {
  id: string
  name: string
  trigger: string
  action: string
  parameters: unknown
  requiresApproval: boolean
  maxAutoAmount: number
}

type RuleTenantMetadata = {
  id: string
  condition?: unknown
  parameters?: unknown
  createdBy?: string | null
}

type WorkflowRuleLookupRecord = RuleRecord & RuleTenantMetadata & {
  isActive: boolean
}

function workflowRuleTenantFilter(tenantId: string) {
  return {
    condition: {
      path: ['tenantId'],
      equals: tenantId,
    },
  } as const
}

function getWorkflowRuleTenantId(rule: { condition?: unknown; parameters?: unknown }): string | null {
  const condition = asRecord(rule.condition)
  const parameters = asRecord(rule.parameters)
  return toStringValue(condition.tenantId) || toStringValue(parameters.tenantId)
}

function buildWorkflowRuleTenantScope(rule: { condition?: unknown; parameters?: unknown }, tenantId: string) {
  return {
    condition: toJsonValue({
      ...asRecord(rule.condition),
      tenantId,
    }),
    parameters: toJsonValue({
      ...asRecord(rule.parameters),
      tenantId,
    }),
  }
}

async function inferLegacyWorkflowRuleTenantId(args: {
  ruleId: string
  createdBy?: string | null
  fallbackTenantId?: string
}): Promise<string | null> {
  if (args.fallbackTenantId) return args.fallbackTenantId

  if (args.createdBy) {
    const creator = await prisma.user.findUnique({
      where: { id: args.createdBy },
      select: { tenantId: true },
    })
    if (creator?.tenantId) return creator.tenantId
  }

  const executionTenants = await prisma.autonomousExecution.findMany({
    where: { ruleId: args.ruleId },
    select: { tenantId: true },
    distinct: ['tenantId'],
    take: 2,
  })

  return executionTenants.length === 1 ? executionTenants[0].tenantId : null
}

async function ensureWorkflowRuleTenantScope(args: RuleTenantMetadata & {
  fallbackTenantId?: string
}): Promise<string | null> {
  const tenantId = getWorkflowRuleTenantId(args)
  if (tenantId) return tenantId

  const inferredTenantId = await inferLegacyWorkflowRuleTenantId({
    ruleId: args.id,
    createdBy: args.createdBy,
    fallbackTenantId: args.fallbackTenantId,
  })
  if (!inferredTenantId) return null

  await prisma.autonomousRule.update({
    where: { id: args.id },
    data: buildWorkflowRuleTenantScope(args, inferredTenantId),
  })

  return inferredTenantId
}

async function findWorkflowRuleForTenant(args: {
  workflowId: string
  tenantId: string
  requireActive?: boolean
}): Promise<WorkflowRuleLookupRecord | null> {
  const scopedRule = await prisma.autonomousRule.findFirst({
    where: {
      id: args.workflowId,
      ...(args.requireActive ? { isActive: true } : {}),
      ...workflowRuleTenantFilter(args.tenantId),
    },
    select: {
      id: true,
      name: true,
      trigger: true,
      action: true,
      parameters: true,
      condition: true,
      createdBy: true,
      requiresApproval: true,
      isActive: true,
      maxAutoAmount: true,
    },
  })
  if (scopedRule) return scopedRule

  const legacyRule = await prisma.autonomousRule.findUnique({
    where: { id: args.workflowId },
    select: {
      id: true,
      name: true,
      trigger: true,
      action: true,
      parameters: true,
      condition: true,
      createdBy: true,
      requiresApproval: true,
      isActive: true,
      maxAutoAmount: true,
    },
  })
  if (!legacyRule) return null

  const resolvedTenantId = await ensureWorkflowRuleTenantScope(legacyRule)
  if (resolvedTenantId !== args.tenantId) return null
  if (args.requireActive && !legacyRule.isActive) return null
  return legacyRule
}

export async function backfillLegacyWorkflowRulesForTenant(tenantId: string): Promise<void> {
  const [tenantUsers, tenantExecutions] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true },
    }),
    prisma.autonomousExecution.findMany({
      where: { tenantId },
      select: { ruleId: true },
      distinct: ['ruleId'],
    }),
  ])

  const creatorIds = tenantUsers.map((user) => user.id)
  const executionRuleIds = tenantExecutions.map((execution) => execution.ruleId)
  const loadByCreator = creatorIds.length > 0
  const candidateRuleIds = Array.from(new Set(executionRuleIds))

  if (!loadByCreator && candidateRuleIds.length === 0) return

  const rules = await prisma.autonomousRule.findMany({
    where: {
      OR: [
        ...(loadByCreator ? [{ createdBy: { in: creatorIds } }] : []),
        ...(candidateRuleIds.length > 0 ? [{ id: { in: candidateRuleIds } }] : []),
      ],
    },
    select: {
      id: true,
      condition: true,
      parameters: true,
      createdBy: true,
    },
  })

  for (const rule of rules) {
    if (!getWorkflowRuleTenantId(rule)) {
      await ensureWorkflowRuleTenantScope(rule)
    }
  }
}

type ExecutionRuntimeRecord = {
  id: string
  ruleId: string
  tenantId: string
  status: string
  approvalStatus: string
  approvedAt: Date | null
  approvedBy: string | null
  executedAt: Date | null
  createdAt: Date
  triggerData: unknown
  actionTaken: unknown
  result: unknown
  errorMessage: string | null
}

type WorkflowOperationResult = {
  status: 'executed' | 'handoff_required'
  actualImpact?: number
  details: Record<string, unknown>
  rollbackData?: Record<string, unknown>
}

function normalizeRuleName(trigger: string): string {
  return trigger
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function actionRuleMatches(action: ExecutableAction, rules: RuleRecord[]) {
  const aliases: Record<ExecutableAction['type'], string[]> = {
    create_po: ['auto_reorder', 'stockout_risk', 'reorder', 'stock', 'workflow'],
    transfer_stock: ['stock_transfer', 'stock', 'reorder', 'workflow'],
    adjust_price: ['pricing', 'margin_drop', 'price', 'workflow'],
    approve_expense: ['expense_spike', 'expense', 'approval', 'workflow'],
    send_alert: ['create_alert', 'alert', 'notify', 'workflow'],
  }

  const matchers = aliases[action.type]
  return rules.filter((rule) => {
    const haystack = `${rule.name} ${rule.trigger} ${rule.action}`.toLowerCase()
    return matchers.some((matcher) => haystack.includes(matcher))
  })
}

function defaultWorkflowStages(action: ExecutableAction, requiresHumanDecision: boolean, canAutoExecute: boolean): WorkflowStage[] {
  const stages: WorkflowStage[] = [
    { id: 'signal_validation', type: 'condition', name: 'Validate trigger signal', onFailure: 'abort' },
    { id: 'policy_match', type: 'condition', name: 'Evaluate governance policy', onFailure: 'abort' },
  ]

  if (requiresHumanDecision) {
    stages.push(
      { id: 'human_review', type: 'human_approval', name: 'Request human approval', onFailure: 'escalate' },
      { id: 'notify_approvers', type: 'notification', name: 'Notify approvers', onFailure: 'continue' },
    )
  } else if (canAutoExecute) {
    stages.push({ id: 'auto_execute', type: 'api_call', name: 'Execute action', onFailure: 'abort' })
  } else {
    stages.push({ id: 'manual_triage', type: 'notification', name: 'Escalate for manual triage', onFailure: 'continue' })
  }

  stages.push(
    { id: 'rollback_ready', type: 'rollback', name: `Rollback ${action.type} if needed`, onFailure: 'escalate' },
    { id: 'audit_log', type: 'audit', name: 'Write workflow audit trail', onFailure: 'continue' },
  )

  return stages
}

function workflowStagesFromRule(rule: RuleRecord, fallback: WorkflowStage[]): WorkflowStage[] {
  if (!rule.parameters || typeof rule.parameters !== 'object' || Array.isArray(rule.parameters)) {
    return fallback
  }

  const parameters = rule.parameters as { steps?: unknown; rollbackSteps?: unknown }
  if (!Array.isArray(parameters.steps)) return fallback

  const stages = parameters.steps
    .map((step, index) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return null
      const value = step as { id?: unknown; type?: unknown; name?: unknown; onFailure?: unknown }
      if (typeof value.id !== 'string' || typeof value.type !== 'string' || typeof value.name !== 'string') return null
      const stageType = value.type === 'human_approval' || value.type === 'api_call' || value.type === 'condition' || value.type === 'notification'
        ? value.type
        : 'condition'
      const onFailure = value.onFailure === 'continue' || value.onFailure === 'escalate' ? value.onFailure : 'abort'
      return {
        id: value.id || `rule_stage_${index + 1}`,
        type: stageType,
        name: value.name,
        onFailure,
      } satisfies WorkflowStage
    })
    .filter((step) => step !== null) as WorkflowStage[]

  if (Array.isArray(parameters.rollbackSteps) && parameters.rollbackSteps.length > 0) {
    stages.push({ id: 'rollback_ready', type: 'rollback', name: 'Configured rollback steps available', onFailure: 'escalate' })
  }

  if (!stages.some((stage) => stage.type === 'audit')) {
    stages.push({ id: 'audit_log', type: 'audit', name: 'Write workflow audit trail', onFailure: 'continue' })
  }

  return stages.length > 0 ? stages : fallback
}

function buildWorkflowStages(args: {
  action: ExecutableAction
  matchedRules: RuleRecord[]
  requiresHumanDecision: boolean
  canAutoExecute: boolean
}): WorkflowStage[] {
  const fallback = defaultWorkflowStages(args.action, args.requiresHumanDecision, args.canAutoExecute)
  if (args.matchedRules.length === 0) return fallback
  return workflowStagesFromRule(args.matchedRules[0], fallback)
}

function dedupeKey(tenantId: string, action: ExecutableAction): string {
  return JSON.stringify({ tenantId, type: action.type, parameters: action.parameters })
}

function workflowExecutionView(execution: {
  id: string
  ruleId: string
  status: string
  approvalStatus: string
  approvedAt: Date | null
  approvedBy: string | null
  createdAt: Date
  triggerData: unknown
  actionTaken: unknown
  result: unknown
  errorMessage: string | null
}, rulesById: Map<string, { name: string; trigger: string; action: string }>): WorkflowExecutionSummary {
  const rule = rulesById.get(execution.ruleId)
  return {
    id: execution.id,
    ruleId: execution.ruleId,
    ruleName: rule?.name || execution.ruleId,
    trigger: rule?.trigger || 'custom',
    action: rule?.action || 'workflow',
    status: execution.status,
    approvalStatus: execution.approvalStatus,
    createdAt: execution.createdAt.toISOString(),
    approvedAt: execution.approvedAt ? execution.approvedAt.toISOString() : null,
    approvedBy: execution.approvedBy,
    triggerData: execution.triggerData,
    actionTaken: execution.actionTaken,
    result: execution.result,
    errorMessage: execution.errorMessage,
  }
}

export function buildWorkflowDashboardStats(input: {
  workflows: Array<{ isActive: boolean }>
  executions: Array<{ status: string }>
}): WorkflowDashboard['stats'] {
  const executedCount = input.executions.filter((item) => item.status === 'executed' || item.status === 'approved' || item.status === 'queued' || item.status === 'handoff_required').length
  return {
    totalWorkflows: input.workflows.length,
    activeWorkflows: input.workflows.filter((item) => item.isActive).length,
    pendingApprovalsCount: input.executions.filter((item) => item.status === 'pending_approval').length,
    successRate: input.executions.length > 0 ? round2(executedCount / input.executions.length) : 0,
    executionCount: input.executions.length,
  }
}

function resolveExecutionActionType(args: {
  actionTaken: unknown
  rule?: Pick<RuleRecord, 'trigger' | 'action'> | null
}): ExecutableAction['type'] {
  const actionTaken = asRecord(args.actionTaken)
  const direct = toStringValue(actionTaken.actionType)
  if (direct === 'create_po' || direct === 'adjust_price' || direct === 'transfer_stock' || direct === 'approve_expense' || direct === 'send_alert') {
    return direct
  }

  const haystack = `${args.rule?.trigger || ''} ${args.rule?.action || ''}`.toLowerCase()
  if (haystack.includes('price') || haystack.includes('pricing') || haystack.includes('margin')) return 'adjust_price'
  if (haystack.includes('transfer')) return 'transfer_stock'
  if (haystack.includes('expense')) return 'approve_expense'
  if (haystack.includes('alert') || haystack.includes('notify')) return 'send_alert'
  return 'create_po'
}

function resolveExecutionContext(execution: ExecutionRuntimeRecord): Record<string, unknown> {
  const triggerData = asRecord(execution.triggerData)
  const actionTaken = asRecord(execution.actionTaken)
  return mergeRecords(
    asRecord(triggerData.context),
    asRecord(actionTaken.parameters),
    actionTaken,
    asRecord(execution.result),
  )
}

async function loadExecutionRuntime(args: { executionId: string; tenantId: string }): Promise<{
  execution: ExecutionRuntimeRecord
  rule: RuleRecord | null
}> {
  const execution = await prisma.autonomousExecution.findFirst({
    where: { id: args.executionId, tenantId: args.tenantId },
    select: {
      id: true,
      ruleId: true,
      tenantId: true,
      status: true,
      approvalStatus: true,
      approvedAt: true,
      approvedBy: true,
      executedAt: true,
      createdAt: true,
      triggerData: true,
      actionTaken: true,
      result: true,
      errorMessage: true,
    },
  })
  if (!execution) throw new Error('Execution not found')

  const rawRule = await prisma.autonomousRule.findUnique({
    where: { id: execution.ruleId },
    select: {
      id: true,
      name: true,
      trigger: true,
      action: true,
      parameters: true,
      condition: true,
      createdBy: true,
      requiresApproval: true,
      maxAutoAmount: true,
    },
  })

  if (rawRule) {
    const ruleTenantId = await ensureWorkflowRuleTenantScope({
      id: rawRule.id,
      condition: rawRule.condition,
      parameters: rawRule.parameters,
      createdBy: rawRule.createdBy,
      fallbackTenantId: execution.tenantId,
    })
    if (ruleTenantId !== execution.tenantId) {
      throw new Error('Execution rule is not available for this tenant')
    }
  }

  const rule = rawRule ? {
    id: rawRule.id,
    name: rawRule.name,
    trigger: rawRule.trigger,
    action: rawRule.action,
    parameters: rawRule.parameters,
    requiresApproval: rawRule.requiresApproval,
    maxAutoAmount: rawRule.maxAutoAmount,
  } : null

  return { execution, rule }
}

async function ensureWorkflowRecord(args: {
  tenantId: string
  action: ExecutableAction
  matchedRules: RuleRecord[]
  decision: 'auto_execute' | 'pending_approval'
  workflowStages: WorkflowStage[]
  requiresHumanDecision: boolean
  triggeredBy?: string
}): Promise<WorkflowRecord | undefined> {
  const existing = await prisma.autonomousExecution.findFirst({
    where: {
      tenantId: args.tenantId,
      approvalStatus: args.requiresHumanDecision ? 'pending' : { in: ['not_required', 'approved'] },
      status: { in: ['pending_approval', 'planned', 'queued'] },
      triggerData: {
        path: ['dedupeKey'],
        equals: dedupeKey(args.tenantId, args.action),
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      approvalStatus: true,
      result: true,
    },
  }).catch(() => null)

  if (existing) {
    return {
      executionId: existing.id,
      status: existing.status,
      approvalStatus: existing.approvalStatus,
      rollbackReady: Boolean(existing.result && typeof existing.result === 'object' && !Array.isArray(existing.result)),
    }
  }

  const primaryRuleId = args.matchedRules[0]?.id || `assistant_${args.action.type}`
  const actionTaken = toJsonValue({
    actionType: args.action.type,
    estimatedImpact: args.action.estimatedImpact,
    decision: args.decision,
    workflowStages: args.workflowStages,
    parameters: args.action.parameters,
  })

  const created = await prisma.autonomousExecution.create({
    data: {
      ruleId: primaryRuleId,
      tenantId: args.tenantId,
      triggerData: toJsonValue({
        source: 'enterprise_ai_assistant',
        dedupeKey: dedupeKey(args.tenantId, args.action),
        matchedRuleIds: args.matchedRules.map((rule) => rule.id),
      }),
      actionTaken,
      status: args.requiresHumanDecision ? 'pending_approval' : args.decision === 'auto_execute' ? 'queued' : 'planned',
      approvalStatus: args.requiresHumanDecision ? 'pending' : 'not_required',
      result: toJsonValue({
        rollbackReady: args.workflowStages.some((stage) => stage.type === 'rollback'),
        triggeredBy: args.triggeredBy || 'system',
      }),
    },
    select: {
      id: true,
      status: true,
      approvalStatus: true,
    },
  })

  if (args.requiresHumanDecision) {
    await prisma.notification.create({
      data: {
        tenantId: args.tenantId,
        type: 'SYSTEM',
        title: `Enterprise AI approval required: ${args.action.type}`,
        message: `A workflow step requires human approval before ${args.action.type} can proceed.`,
      },
    }).catch(() => {})
  }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.triggeredBy || 'system',
    action: 'ENTERPRISE_AI_WORKFLOW_PLANNED',
    entity: 'AutonomousExecution',
    entityId: created.id,
    newValues: {
      actionType: args.action.type,
      decision: args.decision,
      matchedRuleIds: args.matchedRules.map((rule) => rule.id),
      requiresHumanDecision: args.requiresHumanDecision,
    },
  }).catch(() => {})

  return {
    executionId: created.id,
    status: created.status,
    approvalStatus: created.approvalStatus,
    rollbackReady: args.workflowStages.some((stage) => stage.type === 'rollback'),
  }
}

export async function buildExecutionPlan(
  actions: ExecutableAction[],
  context: { confidence: number; impactThreshold?: number; tenantId?: string; userId?: string },
): Promise<ExecutionPlan> {
  const impactThreshold = context.impactThreshold ?? 5000
  if (context.tenantId) {
    await backfillLegacyWorkflowRulesForTenant(context.tenantId)
  }

  const rules = context.tenantId
    ? await prisma.autonomousRule.findMany({
        where: {
          isActive: true,
          ...workflowRuleTenantFilter(context.tenantId),
        },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          name: true,
          trigger: true,
          action: true,
          parameters: true,
          requiresApproval: true,
          maxAutoAmount: true,
        },
      })
    : []

  const planActions = await Promise.all(actions.map(async (action) => {
    const isOrderOrTransfer = action.type === 'create_po' || action.type === 'transfer_stock'
    const matchedRules = actionRuleMatches(action, rules)
    const requiresHumanDecision = isOrderOrTransfer || action.requiresApproval || matchedRules.some((rule) => rule.requiresApproval)
    const maxAutoAmount = matchedRules.length > 0
      ? Math.max(...matchedRules.map((rule) => Number(rule.maxAutoAmount || 0)), 0)
      : impactThreshold
    const canAutoExecute =
      !isOrderOrTransfer &&
      context.confidence > 85 &&
      action.riskLevel === 'low' &&
      action.estimatedImpact <= Math.max(impactThreshold, maxAutoAmount) &&
      !requiresHumanDecision

    const priority: 'high' | 'medium' | 'low' = isOrderOrTransfer
      ? 'high'
      : action.riskLevel === 'high'
        ? 'high'
        : action.riskLevel === 'medium'
          ? 'medium'
          : 'low'

    const workflowStages = buildWorkflowStages({ action, matchedRules, requiresHumanDecision, canAutoExecute })
    const decision = canAutoExecute ? 'auto_execute' : 'pending_approval'
    const workflowRecord = context.tenantId
      ? await ensureWorkflowRecord({
          tenantId: context.tenantId,
          action,
          matchedRules,
          decision,
          workflowStages,
          requiresHumanDecision,
          triggeredBy: context.userId,
        })
      : undefined

    return {
      action,
      decision,
      priority,
      requiresHumanDecision,
      matchedRuleIds: matchedRules.map((rule) => rule.id),
      workflowStages,
      workflowRecord,
      reason: canAutoExecute
        ? 'Confidence and risk/impact thresholds satisfied'
        : isOrderOrTransfer
          ? 'Order and stock-transfer actions are governance-locked and require human approval'
          : 'Requires governance approval due to confidence, risk, impact, or workflow policy constraints',
    } satisfies ExecutionPlanItem
  }))

  const highPriorityHumanActions = planActions
    .filter((item) => item.requiresHumanDecision && item.priority === 'high')
    .map((item) => {
      if (item.action.type === 'create_po') return 'Approve purchase order action'
      if (item.action.type === 'transfer_stock') return 'Approve stock transfer action'
      return 'Approve high-priority action'
    })

  return {
    actions: planActions,
    autoExecutableCount: planActions.filter((item) => item.decision === 'auto_execute').length,
    approvalRequiredCount: planActions.filter((item) => item.decision === 'pending_approval').length,
    highPriorityHumanActions,
    workflowCoverageScore: planActions.length > 0
      ? round2(planActions.filter((item) => item.matchedRuleIds.length > 0 || !!item.workflowRecord).length / planActions.length)
      : 0,
  }
}

async function runWorkflowOperation(args: {
  execution: ExecutionRuntimeRecord
  rule: RuleRecord | null
  userId: string
}): Promise<WorkflowOperationResult> {
  const context = resolveExecutionContext(args.execution)
  const actionType = resolveExecutionActionType({ actionTaken: args.execution.actionTaken, rule: args.rule })

  if (actionType === 'create_po') {
    const notification = await prisma.notification.create({
      data: {
        tenantId: args.execution.tenantId,
        type: 'SYSTEM',
        title: toStringValue(context.title) || 'Purchase order handoff required',
        message: toStringValue(context.actionText) || 'Enterprise AI approved a purchase-order action that requires external fulfillment.',
      },
      select: { id: true },
    })

    return {
      status: 'handoff_required',
      details: {
        operation: 'create_po',
        handoffRequired: true,
        notificationId: notification.id,
        message: 'Purchase-order execution is not supported by the current domain model. A governed handoff was created instead.',
      },
      rollbackData: {
        operation: 'create_po',
        notificationId: notification.id,
      },
    }
  }

  if (actionType === 'send_alert') {
    const notification = await prisma.notification.create({
      data: {
        tenantId: args.execution.tenantId,
        subsidiaryId: toStringValue(context.subsidiaryId) || undefined,
        productId: toStringValue(context.productId) || undefined,
        type: 'SYSTEM',
        title: toStringValue(context.title) || 'Enterprise AI workflow alert',
        message: toStringValue(context.message) || toStringValue(context.actionText) || 'A workflow alert was triggered by Enterprise AI.',
      },
      select: { id: true },
    })

    return {
      status: 'executed',
      actualImpact: 15,
      details: {
        operation: 'send_alert',
        notificationId: notification.id,
      },
      rollbackData: {
        operation: 'send_alert',
        notificationId: notification.id,
      },
    }
  }

  if (actionType === 'approve_expense') {
    const expenseId = toStringValue(context.expenseId)
    if (!expenseId) throw new Error('Expense approval workflow requires expenseId')

    const expense = await prisma.expense.findFirst({
      where: { id: expenseId, tenantId: args.execution.tenantId, archived: false },
      select: { id: true, amount: true, notes: true },
    })
    if (!expense) throw new Error('Expense not found for workflow execution')

    const approvalNote = `Enterprise AI workflow approved by ${args.userId} on ${new Date().toISOString()}`
    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        notes: appendExecutionNote(expense.notes, approvalNote),
        updatedBy: args.userId,
      },
    })

    return {
      status: 'executed',
      actualImpact: round2(clamp(100 - Math.min(95, Number(expense.amount || 0) / 100), 5, 100)),
      details: {
        operation: 'approve_expense',
        expenseId: expense.id,
      },
      rollbackData: {
        operation: 'approve_expense',
        expenseId: expense.id,
        previousNotes: expense.notes || '',
      },
    }
  }

  if (actionType === 'adjust_price') {
    const productId = toStringValue(context.productId)
    if (!productId) throw new Error('Price adjustment workflow requires productId')

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId: args.execution.tenantId, archived: false },
      select: {
        id: true,
        name: true,
        sellingPrice: true,
        subsidiaryId: true,
      },
    })
    if (!product) throw new Error('Product not found for price adjustment')

    const currentPrice = Number(product.sellingPrice || 0)
    const explicitTarget = toPositiveNumber(context.targetPrice)
    const percentChange = toNumber(context.percentChange)
    const nextPrice = explicitTarget ?? (percentChange !== null ? round2(currentPrice * (1 + percentChange / 100)) : null)
    if (nextPrice === null || nextPrice <= 0) throw new Error('Price adjustment workflow requires targetPrice or percentChange')

    await prisma.product.update({
      where: { id: product.id },
      data: {
        sellingPrice: nextPrice,
        updatedBy: args.userId,
      },
    })

    await prisma.notification.create({
      data: {
        tenantId: args.execution.tenantId,
        subsidiaryId: product.subsidiaryId,
        productId: product.id,
        type: 'SYSTEM',
        title: 'Enterprise AI adjusted product price',
        message: `${product.name} price changed from ${currentPrice.toFixed(2)} to ${nextPrice.toFixed(2)}.`,
      },
    }).catch(() => {})

    return {
      status: 'executed',
      actualImpact: currentPrice > 0 ? round2(((nextPrice - currentPrice) / currentPrice) * 100) : 0,
      details: {
        operation: 'adjust_price',
        productId: product.id,
        previousPrice: currentPrice,
        newPrice: nextPrice,
      },
      rollbackData: {
        operation: 'adjust_price',
        productId: product.id,
        previousPrice: currentPrice,
      },
    }
  }

  const units = toPositiveNumber(context.units ?? context.quantity)
  const sourceProductId = toStringValue(context.sourceProductId) || toStringValue(context.productId)
  const targetProductId = toStringValue(context.targetProductId)
  const fromSubsidiaryId = toStringValue(context.fromSubsidiaryId)
  const toSubsidiaryId = toStringValue(context.toSubsidiaryId)
  if (!sourceProductId || !toSubsidiaryId || !units) {
    throw new Error('Stock transfer workflow requires sourceProductId or productId, toSubsidiaryId, and units')
  }

  const transferResult = await prisma.$transaction(async (tx) => {
    const sourceProduct = await tx.product.findFirst({
      where: {
        id: sourceProductId,
        tenantId: args.execution.tenantId,
        archived: false,
        ...(fromSubsidiaryId ? { subsidiaryId: fromSubsidiaryId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        subsidiaryId: true,
        name: true,
        category: true,
        description: true,
        type: true,
        unit: true,
        quantity: true,
        costPrice: true,
        sellingPrice: true,
        barcode: true,
        lowStockThreshold: true,
        expiryDate: true,
        status: true,
      },
    })
    if (!sourceProduct) throw new Error('Source product not found for stock transfer')

    const sourceQuantity = Number(sourceProduct.quantity || 0)
    if (units > sourceQuantity) throw new Error('Requested transfer quantity exceeds available stock')

    let targetProduct = targetProductId
      ? await tx.product.findFirst({
          where: { id: targetProductId, tenantId: args.execution.tenantId, archived: false },
          select: { id: true, quantity: true, lowStockThreshold: true },
        })
      : await tx.product.findFirst({
          where: {
            tenantId: args.execution.tenantId,
            subsidiaryId: toSubsidiaryId,
            name: sourceProduct.name,
            archived: false,
          },
          select: { id: true, quantity: true, lowStockThreshold: true },
        })

    let targetCreated = false
    if (!targetProduct) {
      targetProduct = await tx.product.create({
        data: {
          tenantId: sourceProduct.tenantId,
          subsidiaryId: toSubsidiaryId,
          name: sourceProduct.name,
          category: sourceProduct.category,
          description: sourceProduct.description || undefined,
          type: sourceProduct.type,
          unit: sourceProduct.unit,
          quantity: 0,
          costPrice: sourceProduct.costPrice,
          sellingPrice: sourceProduct.sellingPrice,
          barcode: sourceProduct.barcode || undefined,
          lowStockThreshold: sourceProduct.lowStockThreshold,
          expiryDate: sourceProduct.expiryDate || undefined,
          status: sourceProduct.status,
          createdBy: args.userId,
          updatedBy: args.userId,
        },
        select: { id: true, quantity: true, lowStockThreshold: true },
      })
      targetCreated = true
    }

    const targetQuantity = Number(targetProduct.quantity || 0)
    const sourceThreshold = Number(sourceProduct.lowStockThreshold || 0)
    const targetThreshold = Number(targetProduct.lowStockThreshold || 0)

    await tx.product.update({
      where: { id: sourceProduct.id },
      data: {
        quantity: round2(sourceQuantity - units),
        updatedBy: args.userId,
      },
    })
    await tx.product.update({
      where: { id: targetProduct.id },
      data: {
        quantity: round2(targetQuantity + units),
        updatedBy: args.userId,
      },
    })

    const shortageBefore = Math.max(0, sourceThreshold - sourceQuantity) + Math.max(0, targetThreshold - targetQuantity)
    const shortageAfter = Math.max(0, sourceThreshold - (sourceQuantity - units)) + Math.max(0, targetThreshold - (targetQuantity + units))
    const actualImpact = shortageBefore > 0
      ? round2(((shortageBefore - shortageAfter) / shortageBefore) * 100)
      : round2((units / Math.max(1, sourceQuantity)) * 25)

    return {
      actualImpact,
      sourceProduct,
      targetProduct,
      sourceQuantity,
      targetQuantity,
      targetCreated,
      units,
    }
  })

  await prisma.notification.create({
    data: {
      tenantId: args.execution.tenantId,
      subsidiaryId: toSubsidiaryId,
      productId: transferResult.targetProduct.id,
      type: 'SYSTEM',
      title: 'Enterprise AI transferred stock',
      message: `${round2(transferResult.units)} units were transferred to improve branch availability.`,
    },
  }).catch(() => {})

  return {
    status: 'executed',
    actualImpact: transferResult.actualImpact,
    details: {
      operation: 'transfer_stock',
      sourceProductId: transferResult.sourceProduct.id,
      targetProductId: transferResult.targetProduct.id,
      units: round2(transferResult.units),
      targetCreated: transferResult.targetCreated,
    },
    rollbackData: {
      operation: 'transfer_stock',
      sourceProductId: transferResult.sourceProduct.id,
      targetProductId: transferResult.targetProduct.id,
      sourcePreviousQuantity: transferResult.sourceQuantity,
      targetPreviousQuantity: transferResult.targetQuantity,
      targetCreated: transferResult.targetCreated,
    },
  }
}

export async function executeWorkflowExecution(args: {
  executionId: string
  tenantId: string
  userId: string
}): Promise<WorkflowExecutionSummary> {
  const { execution, rule } = await loadExecutionRuntime({ executionId: args.executionId, tenantId: args.tenantId })
  if (execution.status === 'executed' || execution.status === 'handoff_required') {
    return workflowExecutionView(execution, new Map(rule ? [[rule.id, { name: rule.name, trigger: rule.trigger, action: rule.action }]] : []))
  }

  const existingResult = asRecord(execution.result)
  await prisma.autonomousExecution.update({
    where: { id: execution.id },
    data: {
      status: 'executing',
      errorMessage: null,
      result: toJsonValue({
        ...existingResult,
        executionStartedAt: new Date().toISOString(),
      }),
    },
  })

  try {
    const operationResult = await runWorkflowOperation({ execution, rule, userId: args.userId })
    let updated = await prisma.autonomousExecution.update({
      where: { id: execution.id },
      data: {
        status: operationResult.status,
        approvalStatus: execution.approvalStatus === 'pending' ? 'approved' : execution.approvalStatus,
        approvedAt: execution.approvedAt || new Date(),
        approvedBy: execution.approvedBy || args.userId,
        executedAt: new Date(),
        result: toJsonValue({
          ...existingResult,
          ...operationResult.details,
          rollbackReady: Boolean(operationResult.rollbackData),
          rollbackData: operationResult.rollbackData || null,
          handoffRequired: operationResult.status === 'handoff_required',
        }),
        errorMessage: null,
      },
      select: {
        id: true,
        ruleId: true,
        status: true,
        approvalStatus: true,
        approvedAt: true,
        approvedBy: true,
        createdAt: true,
        triggerData: true,
        actionTaken: true,
        result: true,
        errorMessage: true,
      },
    })

    if (operationResult.status === 'executed') {
      await trackWorkflowOutcome({
        executionId: execution.id,
        actualImpact: round2(operationResult.actualImpact ?? 0),
      })

      const refreshed = await prisma.autonomousExecution.findUnique({
        where: { id: execution.id },
        select: {
          id: true,
          ruleId: true,
          status: true,
          approvalStatus: true,
          approvedAt: true,
          approvedBy: true,
          createdAt: true,
          triggerData: true,
          actionTaken: true,
          result: true,
          errorMessage: true,
        },
      })
      if (refreshed) updated = refreshed
    } else if (rule) {
      await prisma.autonomousRule.update({
        where: { id: rule.id },
        data: { executionCount: { increment: 1 } },
      }).catch(() => {})
    }

    await logAudit({
      tenantId: args.tenantId,
      userId: args.userId,
      action: 'ENTERPRISE_AI_WORKFLOW_EXECUTE',
      entity: 'AutonomousExecution',
      entityId: execution.id,
      newValues: {
        status: operationResult.status,
        actualImpact: operationResult.actualImpact ?? null,
      },
    }).catch(() => {})

    return workflowExecutionView(updated, new Map(rule ? [[rule.id, { name: rule.name, trigger: rule.trigger, action: rule.action }]] : []))
  } catch (error) {
    const failed = await prisma.autonomousExecution.update({
      where: { id: execution.id },
      data: {
        status: 'failed',
        errorMessage: (error as Error).message,
        result: toJsonValue({
          ...existingResult,
          rollbackReady: Boolean(asRecord(existingResult).rollbackData),
        }),
      },
      select: {
        id: true,
        ruleId: true,
        status: true,
        approvalStatus: true,
        approvedAt: true,
        approvedBy: true,
        createdAt: true,
        triggerData: true,
        actionTaken: true,
        result: true,
        errorMessage: true,
      },
    })

    await logAudit({
      tenantId: args.tenantId,
      userId: args.userId,
      action: 'ENTERPRISE_AI_WORKFLOW_EXECUTION_FAILED',
      entity: 'AutonomousExecution',
      entityId: execution.id,
      newValues: {
        error: (error as Error).message,
      },
    }).catch(() => {})

    return workflowExecutionView(failed, new Map(rule ? [[rule.id, { name: rule.name, trigger: rule.trigger, action: rule.action }]] : []))
  }
}

export async function rollbackWorkflowExecution(args: {
  executionId: string
  tenantId: string
  userId: string
  note?: string
}): Promise<WorkflowExecutionSummary> {
  const { execution, rule } = await loadExecutionRuntime({ executionId: args.executionId, tenantId: args.tenantId })
  const result = asRecord(execution.result)
  const rollbackData = asRecord(result.rollbackData)
  const operation = toStringValue(rollbackData.operation)
  if (!operation) throw new Error('Execution is not rollback-capable')

  if (operation === 'adjust_price') {
    const productId = toStringValue(rollbackData.productId)
    const previousPrice = toPositiveNumber(rollbackData.previousPrice)
    if (!productId || previousPrice === null) throw new Error('Rollback metadata is incomplete for price adjustment')
    await prisma.product.update({
      where: { id: productId },
      data: { sellingPrice: previousPrice, updatedBy: args.userId },
    })
  } else if (operation === 'transfer_stock') {
    const sourceProductId = toStringValue(rollbackData.sourceProductId)
    const targetProductId = toStringValue(rollbackData.targetProductId)
    const sourcePreviousQuantity = toNumber(rollbackData.sourcePreviousQuantity)
    const targetPreviousQuantity = toNumber(rollbackData.targetPreviousQuantity)
    const targetCreated = rollbackData.targetCreated === true
    if (!sourceProductId || !targetProductId || sourcePreviousQuantity === null || targetPreviousQuantity === null) {
      throw new Error('Rollback metadata is incomplete for stock transfer')
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: sourceProductId },
        data: { quantity: round2(sourcePreviousQuantity), updatedBy: args.userId },
      })
      if (targetCreated && targetPreviousQuantity === 0) {
        await tx.product.delete({ where: { id: targetProductId } })
      } else {
        await tx.product.update({
          where: { id: targetProductId },
          data: { quantity: round2(targetPreviousQuantity), updatedBy: args.userId },
        })
      }
    })
  } else if (operation === 'approve_expense') {
    const expenseId = toStringValue(rollbackData.expenseId)
    if (!expenseId) throw new Error('Rollback metadata is incomplete for expense approval')
    await prisma.expense.update({
      where: { id: expenseId },
      data: {
        notes: typeof rollbackData.previousNotes === 'string' ? rollbackData.previousNotes : null,
        updatedBy: args.userId,
      },
    })
  } else if (operation === 'send_alert' || operation === 'create_po') {
    const notificationId = toStringValue(rollbackData.notificationId)
    if (!notificationId) throw new Error('Rollback metadata is incomplete for notification cleanup')
    await prisma.notification.delete({ where: { id: notificationId } }).catch(() => {})
  } else {
    throw new Error('Execution is not rollback-capable')
  }

  const updated = await prisma.autonomousExecution.update({
    where: { id: execution.id },
    data: {
      status: 'rolled_back',
      result: toJsonValue({
        ...result,
        rolledBackAt: new Date().toISOString(),
        rolledBackBy: args.userId,
        rollbackNote: args.note || null,
      }),
      errorMessage: null,
    },
    select: {
      id: true,
      ruleId: true,
      status: true,
      approvalStatus: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
      triggerData: true,
      actionTaken: true,
      result: true,
      errorMessage: true,
    },
  })

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'ENTERPRISE_AI_WORKFLOW_ROLLBACK',
    entity: 'AutonomousExecution',
    entityId: execution.id,
    newValues: {
      operation,
      note: args.note || null,
    },
  }).catch(() => {})

  return workflowExecutionView(updated, new Map(rule ? [[rule.id, { name: rule.name, trigger: rule.trigger, action: rule.action }]] : []))
}

export async function createWorkflowDefinition(input: WorkflowDefinitionInput & { createdBy: string; tenantId: string }) {
  const name = input.name.trim() || normalizeRuleName(input.trigger)
  const created = await prisma.autonomousRule.create({
    data: {
      name,
      trigger: input.trigger,
      condition: toJsonValue({ type: input.trigger, source: 'workflow_management', tenantId: input.tenantId }),
      action: 'workflow',
      parameters: toJsonValue({
        tenantId: input.tenantId,
        description: input.description || null,
        auditLevel: input.auditLevel || 'full',
        maxCost: input.maxCost || 0,
        steps: input.steps,
        rollbackSteps: input.rollbackSteps || [],
      }),
      priority: input.priority ?? 100,
      isActive: true,
      requiresApproval: input.requiresApproval !== false,
      maxAutoAmount: input.maxCost || 0,
      createdBy: input.createdBy,
    },
    select: {
      id: true,
      name: true,
      trigger: true,
      action: true,
      priority: true,
      isActive: true,
      requiresApproval: true,
      maxAutoAmount: true,
      executionCount: true,
      successCount: true,
      updatedAt: true,
    },
  })

  return {
    ...created,
    updatedAt: created.updatedAt.toISOString(),
  }
}

export async function triggerWorkflowExecution(args: {
  workflowId: string
  tenantId: string
  userId: string
  context?: Record<string, unknown>
}): Promise<WorkflowExecutionSummary> {
  const rule = await findWorkflowRuleForTenant({
    workflowId: args.workflowId,
    tenantId: args.tenantId,
    requireActive: true,
  })
  if (!rule) throw new Error('Workflow not found or inactive')

  const fallbackStages = defaultWorkflowStages({
    type: 'send_alert',
    parameters: { workflowId: args.workflowId },
    estimatedImpact: 0,
    riskLevel: 'low',
    requiresApproval: rule.requiresApproval,
  }, rule.requiresApproval, !rule.requiresApproval)
  const workflowStages = workflowStagesFromRule(rule as RuleRecord, fallbackStages)

  const execution = await prisma.autonomousExecution.create({
    data: {
      ruleId: rule.id,
      tenantId: args.tenantId,
      triggerData: toJsonValue({
        source: 'workflow_management_api',
        triggeredBy: args.userId,
        context: args.context || {},
      }),
      actionTaken: toJsonValue({
        actionType: 'workflow',
        workflowStages,
        ruleName: rule.name,
      }),
      status: rule.requiresApproval ? 'pending_approval' : 'queued',
      approvalStatus: rule.requiresApproval ? 'pending' : 'not_required',
      result: toJsonValue({
        rollbackReady: workflowStages.some((stage) => stage.type === 'rollback'),
      }),
    },
    select: {
      id: true,
      ruleId: true,
      status: true,
      approvalStatus: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
      triggerData: true,
      actionTaken: true,
      result: true,
      errorMessage: true,
    },
  })

  if (rule.requiresApproval) {
    await prisma.notification.create({
      data: {
        tenantId: args.tenantId,
        type: 'SYSTEM',
        title: `Workflow approval required: ${rule.name}`,
        message: `Workflow ${rule.name} requires approval before execution.`,
      },
    }).catch(() => {})
  }

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'ENTERPRISE_AI_WORKFLOW_TRIGGER',
    entity: 'AutonomousExecution',
    entityId: execution.id,
    newValues: {
      workflowId: rule.id,
      workflowName: rule.name,
      requiresApproval: rule.requiresApproval,
    },
  }).catch(() => {})

  if (!rule.requiresApproval) {
    return executeWorkflowExecution({
      executionId: execution.id,
      tenantId: args.tenantId,
      userId: args.userId,
    })
  }

  return workflowExecutionView(execution, new Map([[rule.id, { name: rule.name, trigger: rule.trigger, action: rule.action }]]))
}

export async function reviewWorkflowExecution(args: {
  executionId: string
  tenantId: string
  userId: string
  approved: boolean
  note?: string
}): Promise<WorkflowExecutionSummary> {
  const existing = await prisma.autonomousExecution.findFirst({
    where: { id: args.executionId, tenantId: args.tenantId },
    select: {
      id: true,
      ruleId: true,
      status: true,
      approvalStatus: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
      triggerData: true,
      actionTaken: true,
      result: true,
      errorMessage: true,
    },
  })
  if (!existing) throw new Error('Execution not found')

  const rule = await prisma.autonomousRule.findFirst({
    where: {
      id: existing.ruleId,
      ...workflowRuleTenantFilter(args.tenantId),
    },
    select: { id: true, name: true, trigger: true, action: true },
  })

  const updated = await prisma.autonomousExecution.update({
    where: { id: args.executionId },
    data: {
      approvalStatus: args.approved ? 'approved' : 'rejected',
      status: args.approved ? 'approved' : 'rejected',
      approvedBy: args.userId,
      approvedAt: new Date(),
      errorMessage: args.approved ? null : args.note || 'Rejected by reviewer',
      result: toJsonValue({
        ...((existing.result && typeof existing.result === 'object' && !Array.isArray(existing.result)) ? existing.result : {}),
        reviewNote: args.note || null,
      }),
    },
    select: {
      id: true,
      ruleId: true,
      status: true,
      approvalStatus: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
      triggerData: true,
      actionTaken: true,
      result: true,
      errorMessage: true,
    },
  })

  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: 'ENTERPRISE_AI_WORKFLOW_REVIEW',
    entity: 'AutonomousExecution',
    entityId: updated.id,
    newValues: {
      approved: args.approved,
      note: args.note || null,
    },
  }).catch(() => {})

  if (args.approved) {
    return executeWorkflowExecution({
      executionId: updated.id,
      tenantId: args.tenantId,
      userId: args.userId,
    })
  }

  return workflowExecutionView(updated, new Map(rule ? [[rule.id, rule]] : []))
}

export async function listWorkflowDashboard(args: {
  tenantId: string
  executionId?: string
  status?: string
  limit?: number
}): Promise<WorkflowDashboard | WorkflowExecutionSummary | null> {
  const limit = Math.min(50, Math.max(1, args.limit || 20))
  await backfillLegacyWorkflowRulesForTenant(args.tenantId)

  const rules = await prisma.autonomousRule.findMany({
    where: workflowRuleTenantFilter(args.tenantId),
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      name: true,
      trigger: true,
      isActive: true,
      requiresApproval: true,
      priority: true,
      maxAutoAmount: true,
      executionCount: true,
      successCount: true,
      updatedAt: true,
      action: true,
    },
  })
  const rulesById = new Map(rules.map((rule) => [rule.id, { name: rule.name, trigger: rule.trigger, action: rule.action }]))

  if (args.executionId) {
    const execution = await prisma.autonomousExecution.findFirst({
      where: { id: args.executionId, tenantId: args.tenantId },
      select: {
        id: true,
        ruleId: true,
        status: true,
        approvalStatus: true,
        approvedAt: true,
        approvedBy: true,
        createdAt: true,
        triggerData: true,
        actionTaken: true,
        result: true,
        errorMessage: true,
      },
    })
    return execution ? workflowExecutionView(execution, rulesById) : null
  }

  const executions = await prisma.autonomousExecution.findMany({
    where: {
      tenantId: args.tenantId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      ruleId: true,
      status: true,
      approvalStatus: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
      triggerData: true,
      actionTaken: true,
      result: true,
      errorMessage: true,
    },
  })

  const executionViews = executions.map((execution) => workflowExecutionView(execution, rulesById))

  return {
    workflows: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      isActive: rule.isActive,
      requiresApproval: rule.requiresApproval,
      priority: rule.priority,
      maxAutoAmount: rule.maxAutoAmount,
      executionCount: rule.executionCount,
      successCount: rule.successCount,
      updatedAt: rule.updatedAt.toISOString(),
    })),
    pendingApprovals: executionViews.filter((execution) => execution.status === 'pending_approval'),
    recentExecutions: executionViews.slice(0, limit),
    stats: buildWorkflowDashboardStats({ workflows: rules, executions }),
  }
}

export function deriveExecutableActionsFromBrief(input: {
  actions: string[]
  estimatedCost?: number
}): ExecutableAction[] {
  const derived: ExecutableAction[] = []

  for (const actionText of input.actions.slice(0, 5)) {
    const lower = actionText.toLowerCase()

    if (lower.includes('reorder') || lower.includes('order')) {
      derived.push({
        type: 'create_po',
        parameters: { actionText },
        estimatedImpact: Math.max(500, input.estimatedCost || 1500),
        riskLevel: 'high',
        requiresApproval: true,
      })
      continue
    }

    if (lower.includes('transfer stock') || lower.includes('stock transfer') || lower.includes('redistribute stock') || lower.includes('move stock')) {
      derived.push({
        type: 'transfer_stock',
        parameters: { actionText },
        estimatedImpact: Math.max(700, input.estimatedCost || 1800),
        riskLevel: 'high',
        requiresApproval: true,
      })
      continue
    }

    if (lower.includes('pricing') || lower.includes('price')) {
      derived.push({
        type: 'adjust_price',
        parameters: { actionText },
        estimatedImpact: 1200,
        riskLevel: 'medium',
        requiresApproval: true,
      })
      continue
    }

    if (lower.includes('expense') || lower.includes('budget')) {
      derived.push({
        type: 'approve_expense',
        parameters: { actionText },
        estimatedImpact: Math.max(500, input.estimatedCost || 900),
        riskLevel: 'medium',
        requiresApproval: true,
      })
      continue
    }

    if (lower.includes('alert') || lower.includes('monitor') || lower.includes('notify')) {
      derived.push({
        type: 'send_alert',
        parameters: { actionText },
        estimatedImpact: 200,
        riskLevel: 'low',
        requiresApproval: false,
      })
    }
  }

  return derived
}