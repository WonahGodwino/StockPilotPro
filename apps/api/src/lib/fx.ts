type OpenErApiResponse = {
  result?: string
  base_code?: string
  rates?: Record<string, number>
  error?: string
}

export async function fetchLiveFxRate(fromCurrency: string, toCurrency: string): Promise<number> {
  const from = fromCurrency.toUpperCase()
  const to = toCurrency.toUpperCase()

  if (from === to) {
    return 1
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`FX provider responded with ${response.status}`)
    }

    const payload = (await response.json()) as OpenErApiResponse
    const rate = payload.rates?.[to]

    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(payload.error || `No live FX rate available for ${from}/${to}`)
    }

    return rate
  } finally {
    clearTimeout(timeout)
  }
}
