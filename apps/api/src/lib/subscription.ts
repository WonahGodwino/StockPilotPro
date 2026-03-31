/**
 * Allowed subscription status transitions.
 * Enforces the ACTIVE → SUSPENDED → EXPIRED flow.
 * EXPIRED is a terminal state; create a new subscription to reactivate.
 */
export const SUBSCRIPTION_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['SUSPENDED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED'],
  EXPIRED: [],
}

export function isAllowedStatusTransition(from: string, to: string): boolean {
  return (SUBSCRIPTION_TRANSITIONS[from] ?? []).includes(to)
}
