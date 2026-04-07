type ApiValidationIssue = {
  path?: Array<string | number>
  message?: string
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  const error = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error

  if (typeof error === 'string' && error.trim()) return error

  if (Array.isArray(error) && error.length > 0) {
    const firstIssue = error[0] as ApiValidationIssue | string

    if (typeof firstIssue === 'string' && firstIssue.trim()) return firstIssue

    if (firstIssue && typeof firstIssue === 'object') {
      if (typeof firstIssue.message === 'string' && firstIssue.message.trim()) {
        const path = Array.isArray(firstIssue.path) && firstIssue.path.length > 0
          ? `${firstIssue.path.join('.')}: `
          : ''
        return `${path}${firstIssue.message}`
      }
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }

  return fallback
}