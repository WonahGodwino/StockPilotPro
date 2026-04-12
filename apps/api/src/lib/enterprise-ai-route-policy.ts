export type EnterpriseRole = string
export type SignalClass = 'PUBLIC' | 'PLATFORM' | 'TENANT'
export type RecommendationType =
  | 'DEMAND_FORECAST'
  | 'REORDER_ADVISOR'
  | 'PRICING_MARGIN_ADVISOR'
  | 'CASHFLOW_FORECAST'
  | 'EXPENSE_RISK_ALERT'
  | 'ANOMALY_DETECTION'
  | 'BRANCH_PERFORMANCE'
  | 'NL_ASSISTANT'

export type SimulationType = 'PRICE_ADJUSTMENT' | 'STOCK_TRANSFER' | 'EXPENSE_CAP'

export function isRecommendationTypeAllowedForRole(role: EnterpriseRole, recommendationType: RecommendationType): boolean {
  if (recommendationType === 'ANOMALY_DETECTION') return role === 'SUPER_ADMIN'
  return role === 'SUPER_ADMIN' || role === 'BUSINESS_ADMIN'
}

export function resolveMetricsTenantScope(role: EnterpriseRole, requestedTenantId: string | undefined, accessTenantId: string): string {
  if (role === 'SUPER_ADMIN') return requestedTenantId || accessTenantId
  return accessTenantId
}

export function resolveSignalTenantScope(input: {
  role: EnterpriseRole
  signalClass: SignalClass
  payloadTenantId?: string
  accessTenantId: string
}): string | null {
  const { role, signalClass, payloadTenantId, accessTenantId } = input

  if (signalClass !== 'TENANT') {
    if (role !== 'SUPER_ADMIN') {
      throw new Error('Only SUPER_ADMIN can ingest public/platform signals')
    }
    return null
  }

  const tenantId = payloadTenantId || accessTenantId
  if (role !== 'SUPER_ADMIN' && tenantId !== accessTenantId) {
    throw new Error('Forbidden: tenant mismatch')
  }

  return tenantId
}

export function isSimulationTypeAllowedForRole(role: EnterpriseRole, _simulationType: SimulationType): boolean {
  return role === 'SUPER_ADMIN' || role === 'BUSINESS_ADMIN'
}

export function isActionTrackerAllowedForRole(role: EnterpriseRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'BUSINESS_ADMIN'
}

export function isAlertPolicyAllowedForRole(role: EnterpriseRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'BUSINESS_ADMIN'
}
