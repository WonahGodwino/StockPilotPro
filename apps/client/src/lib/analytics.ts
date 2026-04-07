type AnalyticsPrimitive = string | number | boolean | null

type AnalyticsParams = Record<string, AnalyticsPrimitive | undefined>

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
    gtag?: (...args: unknown[]) => void
  }
}

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim()
let analyticsInitialized = false

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function sanitizeParams(params: AnalyticsParams): Record<string, AnalyticsPrimitive> {
  const sanitized: Record<string, AnalyticsPrimitive> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    }
  }
  return sanitized
}

export function initAnalytics(): void {
  if (!isBrowser() || analyticsInitialized) return

  analyticsInitialized = true
  window.dataLayer = window.dataLayer || []

  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer?.push({ gtag_call: args })
    }
  }

  if (!GA_MEASUREMENT_ID) return

  const scriptSrc = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`
  const existingScript = document.querySelector(`script[src=\"${scriptSrc}\"]`)
  if (!existingScript) {
    const script = document.createElement('script')
    script.async = true
    script.src = scriptSrc
    document.head.appendChild(script)
  }

  window.gtag('js', new Date())
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false,
    anonymize_ip: true,
  })
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  if (!isBrowser()) return

  const payload = sanitizeParams(params)
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    event: eventName,
    ...payload,
    event_timestamp: Date.now(),
  })

  if (GA_MEASUREMENT_ID && window.gtag) {
    window.gtag('event', eventName, payload)
  }

  if (import.meta.env.DEV) {
    console.info('[analytics]', eventName, payload)
  }
}

export function trackPageView(path: string, title?: string): void {
  trackEvent('page_view', {
    page_path: path,
    page_title: title || document.title,
  })
}
