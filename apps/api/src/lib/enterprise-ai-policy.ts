function normalizeFeatureToken(token: string): string {
  return token.trim().toUpperCase().replace(/\s+/g, '_')
}

export function hasEnterpriseAiFeature(features: unknown, feature: string): boolean {
  const wanted = normalizeFeatureToken(feature)

  if (Array.isArray(features)) {
    return features.some((item) => typeof item === 'string' && normalizeFeatureToken(item) === wanted)
  }

  if (features && typeof features === 'object') {
    const map = features as Record<string, unknown>
    return map[wanted] === true || map[feature] === true
  }

  return false
}

export function isUnsafeAssistantPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  const blocked = ['drop table', 'delete from', 'truncate', 'shutdown', 'rm -rf', 'credential', 'password dump', 'private key']
  return blocked.some((token) => normalized.includes(token))
}

export function roleSupportsEnterpriseAi(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'BUSINESS_ADMIN'
}
