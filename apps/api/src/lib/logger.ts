/**
 * Structured JSON logger for StockPilot API.
 *
 * In all environments every log entry is written as a single-line JSON object
 * to stdout (info/debug/warn) or stderr (error) so that log-aggregation tools
 * (CloudWatch, Datadog, Loki, etc.) can parse them natively.
 *
 * Environment variables
 *   LOG_LEVEL  – minimum level to emit: "debug" | "info" | "warn" | "error"
 *                Defaults to "info" in production and "debug" otherwise.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  requestId?: string
  tenantId?: string
  userId?: string
  method?: string
  path?: string
  statusCode?: number
  durationMs?: number
  entity?: string
  entityId?: string
  action?: string
  ip?: string
  err?: unknown
  [key: string]: unknown
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

// Resolve once at module load to avoid repeated env reads on every log call.
const MIN_LEVEL: number = (() => {
  const envLevel = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel
  if (envLevel in LEVELS) return LEVELS[envLevel]
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug
})()

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    }
  }
  return { raw: String(err) }
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVELS[level] < MIN_LEVEL) return

  const { err, ...rest } = context ?? {}

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    service: 'stockpilot-api',
    message,
    ...rest,
  }

  const serializedErr = serializeError(err)
  if (serializedErr) entry.error = serializedErr

  const line = JSON.stringify(entry) + '\n'

  if (level === 'error') {
    process.stderr.write(line)
  } else {
    process.stdout.write(line)
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
}

export default logger
