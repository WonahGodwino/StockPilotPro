import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

type RestoreSummary = {
  configured: boolean
  attempted: boolean
  success: boolean
  durationMs: number | null
  targetHost: string | null
  targetDatabase: string | null
  error?: string
}

export type BackupJobResult = {
  success: boolean
  filePath: string
  durationMs: number
  sizeBytes: number | null
  backupSuccess: boolean
  restore: RestoreSummary
  error?: string
}

type ParsedDbUrl = {
  host: string
  port: string
  database: string
  username: string
  password: string
}

function parsePostgresUrl(rawUrl: string): ParsedDbUrl {
  const url = new URL(rawUrl.replace(/^"|"$/g, ''))
  return {
    host: url.hostname || 'localhost',
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}

async function runPgDump(source: ParsedDbUrl, filePath: string): Promise<void> {
  const pgDumpBin = (process.env.PG_DUMP_PATH ?? 'pg_dump').trim()

  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: source.password }
    const args = ['-h', source.host, '-p', source.port, '-U', source.username, '-Fc', '-f', filePath, source.database]

    const child = spawn(pgDumpBin, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`))
      }
    })

    child.on('error', (err) => {
      reject(
        new Error(
          `Failed to start pg_dump: ${err.message}. ` +
            'Ensure pg_dump is in PATH or set the PG_DUMP_PATH environment variable.',
        ),
      )
    })
  })
}

async function runPgRestore(target: ParsedDbUrl, filePath: string): Promise<void> {
  const pgRestoreBin = (process.env.PG_RESTORE_PATH ?? 'pg_restore').trim()
  const restoreMode = (process.env.BACKUP_RESTORE_MODE ?? 'clean').toLowerCase()

  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: target.password }
    const args = ['-h', target.host, '-p', target.port, '-U', target.username, '-d', target.database, '--no-owner', '--no-privileges']

    // Clean mode replaces target DB objects with backup content.
    if (restoreMode === 'clean') {
      args.push('--clean', '--if-exists')
    }

    args.push(filePath)

    const child = spawn(pgRestoreBin, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`pg_restore exited with code ${code}: ${stderr.trim()}`))
      }
    })

    child.on('error', (err) => {
      reject(
        new Error(
          `Failed to start pg_restore: ${err.message}. ` +
            'Ensure pg_restore is in PATH or set the PG_RESTORE_PATH environment variable.',
        ),
      )
    })
  })
}

/**
 * Runs pg_dump against the configured DATABASE_URL and writes the result
 * to BACKUP_ARTIFACT_PATH in custom (-Fc) format.
 *
 * Environment variables consumed:
 *   DATABASE_URL          — PostgreSQL connection string (required)
 *   BACKUP_ARTIFACT_PATH  — Absolute path for the output file (required)
 *   PG_DUMP_PATH          — Optional override for the pg_dump binary location
 *                           (default: "pg_dump", assumes it is in PATH)
 */
export async function runDatabaseBackup(): Promise<BackupJobResult> {
  const startedAt = Date.now()
  const restoreEnabled = (process.env.BACKUP_AUTO_RESTORE_ENABLED ?? 'false').toLowerCase() === 'true'
  const targetDbUrl = process.env.BACKUP_RESTORE_TARGET_DATABASE_URL
  const restoreConfigured = restoreEnabled && Boolean(targetDbUrl)

  const baseRestore: RestoreSummary = {
    configured: restoreConfigured,
    attempted: false,
    success: !restoreConfigured,
    durationMs: null,
    targetHost: null,
    targetDatabase: null,
  }

  const filePath = (process.env.BACKUP_ARTIFACT_PATH ?? '').replace(/^"|"$/g, '').trim()
  if (!filePath) {
    return {
      success: false,
      filePath: '',
      durationMs: 0,
      sizeBytes: null,
      backupSuccess: false,
      restore: baseRestore,
      error: 'BACKUP_ARTIFACT_PATH is not configured',
    }
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return {
      success: false,
      filePath,
      durationMs: 0,
      sizeBytes: null,
      backupSuccess: false,
      restore: baseRestore,
      error: 'DATABASE_URL is not configured',
    }
  }

  try {
    const source = parsePostgresUrl(dbUrl)

    // Ensure target directory exists
    await mkdir(dirname(filePath), { recursive: true })

    await runPgDump(source, filePath)

    const meta = await stat(filePath)
    let restore = baseRestore

    if (restoreConfigured && targetDbUrl) {
      const restoreStartedAt = Date.now()
      const target = parsePostgresUrl(targetDbUrl)
      restore = {
        ...restore,
        attempted: true,
        targetHost: target.host,
        targetDatabase: target.database,
      }

      try {
        await runPgRestore(target, filePath)
        restore = {
          ...restore,
          success: true,
          durationMs: Date.now() - restoreStartedAt,
        }
      } catch (restoreErr) {
        restore = {
          ...restore,
          success: false,
          durationMs: Date.now() - restoreStartedAt,
          error: (restoreErr as Error).message,
        }
      }
    }

    const backupDuration = Date.now() - startedAt
    const overallSuccess = restoreConfigured ? restore.success : true

    return {
      success: overallSuccess,
      filePath,
      durationMs: backupDuration,
      sizeBytes: meta.size,
      backupSuccess: true,
      restore,
      error: overallSuccess ? undefined : restore.error,
    }
  } catch (err) {
    return {
      success: false,
      filePath,
      durationMs: Date.now() - startedAt,
      sizeBytes: null,
      backupSuccess: false,
      restore: baseRestore,
      error: (err as Error).message,
    }
  }
}
