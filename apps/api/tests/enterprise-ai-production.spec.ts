import { strict as assert } from 'assert'
import { buildWorkflowDashboardStats, deriveExecutableActionsFromBrief } from '../src/lib/enterprise-ai-autonomous-executor'
import { calculateSuccessScore } from '../src/lib/enterprise-ai-outcome-tracker'

const workflowStats = buildWorkflowDashboardStats({
  workflows: [
    { isActive: true },
    { isActive: false },
    { isActive: true },
  ],
  executions: [
    { status: 'pending_approval' },
    { status: 'approved' },
    { status: 'executed' },
    { status: 'handoff_required' },
    { status: 'rejected' },
  ],
})

assert.equal(workflowStats.totalWorkflows, 3)
assert.equal(workflowStats.activeWorkflows, 2)
assert.equal(workflowStats.pendingApprovalsCount, 1)
assert.equal(workflowStats.executionCount, 5)
assert.equal(workflowStats.successRate, 0.6)

const actions = deriveExecutableActionsFromBrief({
  actions: [
    'P1 - Reorder detergent SKU immediately',
    'P1 - Transfer stock from branch B to branch A',
    'P2 - Adjust price for slow movers',
    'P3 - Monitor stockout alerts daily',
  ],
  estimatedCost: 2400,
})

assert.equal(actions.length, 4)
assert.equal(actions[0].type, 'create_po')
assert.equal(actions[0].requiresApproval, true)
assert.equal(actions[1].type, 'transfer_stock')
assert.equal(actions[2].type, 'adjust_price')
assert.equal(actions[3].type, 'send_alert')

assert.equal(calculateSuccessScore(100, 130), 90)
assert.equal(calculateSuccessScore(100, 100), 75)
assert.equal(calculateSuccessScore(100, 85), 60)
assert.equal(calculateSuccessScore(100, 55), 40)
assert.equal(calculateSuccessScore(100, 20), 20)
assert.equal(calculateSuccessScore(0, 10), 50)

console.log('enterprise-ai-production.spec: all assertions passed')