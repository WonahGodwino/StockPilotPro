import crypto from 'node:crypto'
import { Client } from 'pg'
import { prisma } from '@/lib/prisma'

export type ExternalProviderType = 'postgresql'
export type ExternalConnectionStatus = 'PENDING' | 'CONNECTED' | 'VALIDATED' | 'ERROR' | 'DISABLED'
export type ExternalValidationState = 'DRAFT' | 'VALIDATED' | 'FAILED'

export type ExternalTableColumn = {
  name: string
  dataType: string
  nullable: boolean
}

export type ExternalSchemaTable = {
  name: string
  columns: ExternalTableColumn[]
}

export type ExternalEntityMapping = {
  table: string
  columns: Record<string, string>
}

export type ExternalMappingConfig = {
  sales?: ExternalEntityMapping
  saleItems?: ExternalEntityMapping
  expenses?: ExternalEntityMapping
  products?: ExternalEntityMapping
  inventory?: ExternalEntityMapping
  branches?: ExternalEntityMapping
}

export type ExternalConnectionInput = {
  tenantId: string
  userId: string
  providerType: ExternalProviderType
  connectionName?: string
  host: string
  port?: number
  databaseName: string
  schemaName?: string
  sslRequired?: boolean
  username?: string
  password?: string
}

export type ExternalDataConnectionSummary = {
  id: string
  tenantId: string
  providerType: string
  connectionName: string | null
  host: string
  port: number
  databaseName: string
  schemaName: string
  sslRequired: boolean
  status: string
  validationState: string
  groundingEnabled: boolean
  isActive: boolean
  lastValidatedAt: string | null
  lastValidationError: string | null
  lastHealthStatus: string | null
  lastHealthAt: string | null
  hasStoredCredentials: boolean
  schemaSnapshot: {
    tableCount: number
    tables: ExternalSchemaTable[]
  } | null
  mappingConfig: ExternalMappingConfig
  contractIssues: ExternalMappingContractIssue[]
}

export type ExternalDiscoveryResult = {
  tables: ExternalSchemaTable[]
  suggestions: ExternalMappingConfig
  defaultTransactionReadOnly: boolean
  readOnlyValidatedBy: 'session-default' | 'privilege-restricted'
}

export type ExternalMappingValidationResult = {
  ok: boolean
  requiredEntitiesMapped: string[]
  missingEntities: string[]
  entityResults: Array<{
    entity: keyof ExternalMappingConfig
    ok: boolean
    table?: string
    rowCount?: number
    checkedColumns: string[]
    error?: string
  }>
}

export type ExternalMappingContractIssue = {
  entity: keyof ExternalMappingConfig
  missingMappings: string[]
  missingSchemaColumns: string[]
}

export type EnterpriseAiDataProviderContext = {
  source: 'internal' | 'external'
  externalConnection: ExternalDataConnectionSummary | null
  externalGroundingReady: boolean
}

export type ExternalGroundingSaleRow = {
  saleId: string
  saleDate: string
  totalAmount: number
  currency: string | null
  branchId: string | null
}

export type ExternalGroundingSaleItemRow = {
  saleId: string
  saleDate: string
  productId: string
  quantity: number
  subtotal: number
}

export type ExternalGroundingExpenseRow = {
  expenseDate: string
  amount: number
  category: string | null
  title: string | null
  branchId: string | null
}

export type ExternalGroundingProductRow = {
  productId: string
  name: string
  category: string | null
  costPrice: number
  originalCostPrice?: number | null
  purchaseDate?: string | null
  sellingPrice: number
  currentStock: number
  lowStockThreshold: number
  branchId: string | null
}

export type ExternalGroundingInventoryRow = {
  productId: string
  quantity: number
  branchId: string | null
}

export type ExternalGroundingBranchRow = {
  branchId: string
  name: string
}

export type ExternalGroundingSnapshot = {
  source: 'external'
  sales: ExternalGroundingSaleRow[]
  saleItems: ExternalGroundingSaleItemRow[]
  expenses: ExternalGroundingExpenseRow[]
  products: ExternalGroundingProductRow[]
  inventory: ExternalGroundingInventoryRow[]
  branches: ExternalGroundingBranchRow[]
  latestDataAt: string | null
}

type StoredCredentials = {
  username: string
  password: string
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const REQUIRED_MAPPING_ENTITIES: Array<keyof ExternalMappingConfig> = [
  'sales',
  'saleItems',
  'expenses',
  'products',
  'inventory',
  'branches',
]

const REQUIRED_MAPPING_COLUMNS: Record<keyof ExternalMappingConfig, string[]> = {
  sales: ['id', 'date', 'totalAmount', 'currency', 'branchId'],
  saleItems: ['saleId', 'productId', 'quantity', 'subtotal'],
  expenses: ['date', 'amount', 'category', 'title', 'branchId'],
  products: ['id', 'name', 'category', 'costPrice', 'sellingPrice', 'currentStock', 'lowStockThreshold', 'branchId'],
  inventory: ['productId', 'quantity', 'branchId'],
  branches: ['id', 'name'],
}

function getEncryptionKey(): Buffer {
  const source = process.env.ENTERPRISE_AI_EXTERNAL_DATA_SECRET_KEY?.trim()
  if (!source) {
    if (process.env.NODE_ENV === 'test') {
      return crypto.createHash('sha256').update('stockpilotpro-external-data-test-key').digest()
    }
    throw new Error('ENTERPRISE_AI_EXTERNAL_DATA_SECRET_KEY must be configured before storing or reading external data credentials.')
  }
  return crypto.createHash('sha256').update(source).digest()
}

function encryptCredentials(credentials: StoredCredentials): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const payload = JSON.stringify(credentials)
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return JSON.stringify({
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encrypted: encrypted.toString('base64'),
  })
}

function decryptCredentials(payload: string): StoredCredentials {
  const parsed = JSON.parse(payload) as { iv: string; authTag: string; encrypted: string }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(parsed.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.encrypted, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(decrypted.toString('utf8')) as StoredCredentials
}

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_RE.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`)
  }
  return `"${identifier}"`
}

function buildTableReference(schemaName: string, tableName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
}

function buildColumnReference(alias: string, columnName: string): string {
  return `${quoteIdentifier(alias)}.${quoteIdentifier(columnName)}`
}

function normalizeMappingConfig(mappingConfig: unknown): ExternalMappingConfig {
  if (!mappingConfig || typeof mappingConfig !== 'object') return {}
  return mappingConfig as ExternalMappingConfig
}

function normalizeSchemaTables(schemaTables: unknown): ExternalSchemaTable[] {
  if (!Array.isArray(schemaTables)) return []
  return schemaTables.filter((table): table is ExternalSchemaTable => {
    return Boolean(table && typeof table === 'object' && 'name' in table && 'columns' in table)
  })
}

export function findExternalMappingContractIssues(
  mappingConfig: ExternalMappingConfig,
  schemaTables: ExternalSchemaTable[] = [],
): ExternalMappingContractIssue[] {
  const schemaTableMap = new Map(
    normalizeSchemaTables(schemaTables).map((table) => [table.name, table]),
  )

  const issues: ExternalMappingContractIssue[] = []
  for (const entity of REQUIRED_MAPPING_ENTITIES) {
    const entityMapping = mappingConfig[entity]
    if (!entityMapping?.table) continue

    const requiredColumns = REQUIRED_MAPPING_COLUMNS[entity]
    const missingMappings = requiredColumns.filter((columnKey) => {
      const mappedColumn = entityMapping.columns?.[columnKey]
      return typeof mappedColumn !== 'string' || mappedColumn.trim().length === 0
    })

    const schemaTable = schemaTableMap.get(entityMapping.table)
    const schemaColumnNames = new Set((schemaTable?.columns || []).map((column) => column.name))
    const missingSchemaColumns = schemaTable
      ? requiredColumns.filter((columnKey) => {
          const mappedColumn = entityMapping.columns?.[columnKey]
          return typeof mappedColumn === 'string' && mappedColumn.trim().length > 0 && !schemaColumnNames.has(mappedColumn)
        })
      : []

    if (missingMappings.length > 0 || missingSchemaColumns.length > 0) {
      issues.push({
        entity,
        missingMappings,
        missingSchemaColumns,
      })
    }
  }

  return issues
}

function toConnectionSummary(row: {
  id: string
  tenantId: string
  providerType: string
  connectionName: string | null
  host: string
  port: number
  databaseName: string
  schemaName: string
  sslRequired: boolean
  status: string
  validationState: string
  groundingEnabled: boolean
  isActive: boolean
  lastValidatedAt: Date | null
  lastValidationError: string | null
  lastHealthStatus: string | null
  lastHealthAt: Date | null
  encryptedCredentials: string
  schemaSnapshot: unknown
  mappingConfig: unknown
}): ExternalDataConnectionSummary {
  const schemaSnapshot = row.schemaSnapshot && typeof row.schemaSnapshot === 'object'
    ? row.schemaSnapshot as { tableCount?: number; tables?: ExternalSchemaTable[] }
    : null
  const normalizedSchemaTables = normalizeSchemaTables(schemaSnapshot?.tables)
  const mappingConfig = normalizeMappingConfig(row.mappingConfig)
  const contractIssues = findExternalMappingContractIssues(mappingConfig, normalizedSchemaTables)

  return {
    id: row.id,
    tenantId: row.tenantId,
    providerType: row.providerType,
    connectionName: row.connectionName,
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    schemaName: row.schemaName,
    sslRequired: row.sslRequired,
    status: row.status,
    validationState: row.validationState,
    groundingEnabled: row.groundingEnabled,
    isActive: row.isActive,
    lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    lastValidationError: row.lastValidationError,
    lastHealthStatus: row.lastHealthStatus,
    lastHealthAt: row.lastHealthAt ? row.lastHealthAt.toISOString() : null,
    hasStoredCredentials: Boolean(row.encryptedCredentials),
    schemaSnapshot: schemaSnapshot
      ? {
          tableCount: schemaSnapshot.tableCount || 0,
          tables: normalizedSchemaTables,
        }
      : null,
    mappingConfig,
    contractIssues,
  }
}

async function withPostgresClient<T>(
  connection: {
    host: string
    port: number
    databaseName: string
    sslRequired: boolean
  },
  credentials: StoredCredentials,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.databaseName,
    user: credentials.username,
    password: credentials.password,
    ssl: connection.sslRequired ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
    query_timeout: 8000,
  })

  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

function inferSuggestedTable(
  tables: ExternalSchemaTable[],
  preferredNames: string[],
): ExternalSchemaTable | null {
  const lowerPreferred = preferredNames.map((name) => name.toLowerCase())
  for (const preferred of lowerPreferred) {
    const direct = tables.find((table) => table.name.toLowerCase() === preferred)
    if (direct) return direct
  }
  return tables.find((table) => lowerPreferred.some((preferred) => table.name.toLowerCase().includes(preferred))) || null
}

function inferColumn(table: ExternalSchemaTable | null, candidates: string[]): string | undefined {
  if (!table) return undefined
  const lowered = candidates.map((candidate) => candidate.toLowerCase())
  for (const candidate of lowered) {
    const direct = table.columns.find((column) => column.name.toLowerCase() === candidate)
    if (direct) return direct.name
  }
  return table.columns.find((column) => lowered.some((candidate) => column.name.toLowerCase().includes(candidate)))?.name
}

function buildSuggestedColumnMap(
  table: ExternalSchemaTable | null,
  candidatesByField: Record<string, string[]>,
): Record<string, string> {
  if (!table) return {}

  const suggested: Record<string, string> = {}
  for (const [field, candidates] of Object.entries(candidatesByField)) {
    const match = inferColumn(table, candidates)
    if (match) suggested[field] = match
  }
  return suggested
}

function inferMappingSuggestions(tables: ExternalSchemaTable[]): ExternalMappingConfig {
  const sales = inferSuggestedTable(tables, ['sales', 'orders', 'transactions', 'invoices'])
  const saleItems = inferSuggestedTable(tables, ['sale_items', 'order_items', 'invoice_items', 'line_items'])
  const expenses = inferSuggestedTable(tables, ['expenses', 'costs', 'bills', 'payments'])
  const products = inferSuggestedTable(tables, ['products', 'items', 'inventory_products', 'goods'])
  const inventory = inferSuggestedTable(tables, ['inventory', 'stock', 'inventory_items'])
  const branches = inferSuggestedTable(tables, ['branches', 'stores', 'locations', 'subsidiaries'])

  return {
    sales: sales ? {
      table: sales.name,
      columns: buildSuggestedColumnMap(sales, {
        id: ['id', 'sale_id', 'order_id'],
        date: ['date', 'created_at', 'sale_date', 'order_date'],
        totalAmount: ['total_amount', 'amount', 'grand_total', 'total'],
        currency: ['currency', 'currency_code'],
        branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
      }),
    } : undefined,
    saleItems: saleItems ? {
      table: saleItems.name,
      columns: buildSuggestedColumnMap(saleItems, {
        saleId: ['sale_id', 'order_id', 'invoice_id'],
        productId: ['product_id', 'item_id'],
        quantity: ['quantity', 'qty'],
        unitPrice: ['unit_price', 'price'],
        subtotal: ['subtotal', 'line_total', 'amount'],
      }),
    } : undefined,
    expenses: expenses ? {
      table: expenses.name,
      columns: buildSuggestedColumnMap(expenses, {
        id: ['id', 'expense_id'],
        date: ['date', 'created_at', 'expense_date'],
        amount: ['amount', 'total_amount'],
        category: ['category', 'expense_category'],
        title: ['title', 'name', 'description'],
        branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
      }),
    } : undefined,
    products: products ? {
      table: products.name,
      columns: buildSuggestedColumnMap(products, {
        id: ['id', 'product_id', 'item_id'],
        name: ['name', 'product_name', 'title'],
        category: ['category', 'type'],
        costPrice: ['cost_price', 'cost'],
        originalCostPrice: ['original_cost_price', 'purchase_cost', 'initial_cost', 'unit_cost'],
        purchaseDate: ['purchase_date', 'received_at', 'received_date', 'acquired_at', 'created_at'],
        sellingPrice: ['selling_price', 'price', 'unit_price'],
        currentStock: ['quantity', 'current_stock', 'stock_on_hand'],
        lowStockThreshold: ['low_stock_threshold', 'reorder_level'],
        branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
      }),
    } : undefined,
    inventory: inventory ? {
      table: inventory.name,
      columns: buildSuggestedColumnMap(inventory, {
        productId: ['product_id', 'item_id'],
        quantity: ['quantity', 'qty', 'stock'],
        branchId: ['branch_id', 'store_id', 'location_id', 'subsidiary_id'],
      }),
    } : undefined,
    branches: branches ? {
      table: branches.name,
      columns: buildSuggestedColumnMap(branches, {
        id: ['id', 'branch_id', 'store_id', 'location_id'],
        name: ['name', 'branch_name', 'store_name'],
      }),
    } : undefined,
  }
}

async function discoverPostgresSchema(input: {
  host: string
  port: number
  databaseName: string
  schemaName: string
  sslRequired: boolean
  credentials: StoredCredentials
}): Promise<ExternalDiscoveryResult> {
  return withPostgresClient(input, input.credentials, async (client) => {
    const readOnlyResult = await client.query<{ setting: string }>('SHOW default_transaction_read_only')
    const defaultTransactionReadOnly = readOnlyResult.rows[0]?.setting === 'on'

    const writePrivilegeResult = await client.query<{
      has_write_privileges: boolean
      can_create_in_schema: boolean
    }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables t
         WHERE t.table_schema = $1
           AND t.table_type = 'BASE TABLE'
           AND (
             has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'INSERT')
             OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'UPDATE')
             OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'DELETE')
             OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'TRUNCATE')
             OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'REFERENCES')
             OR has_table_privilege(current_user, quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'TRIGGER')
           )
       ) AS has_write_privileges,
       has_schema_privilege(current_user, $1, 'CREATE') AS can_create_in_schema`,
      [input.schemaName],
    )

    const privilegeRestrictedReadOnly = !writePrivilegeResult.rows[0]?.has_write_privileges && !writePrivilegeResult.rows[0]?.can_create_in_schema
    if (!defaultTransactionReadOnly && !privilegeRestrictedReadOnly) {
      throw new Error('Phase 1 requires PostgreSQL credentials with default_transaction_read_only=on or a reporting user that has no write privileges on the target schema.')
    }

    const columnsResult = await client.query<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
    }>(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name ASC, ordinal_position ASC`,
      [input.schemaName],
    )

    const tableMap = new Map<string, ExternalSchemaTable>()
    for (const row of columnsResult.rows) {
      const existing = tableMap.get(row.table_name) || {
        name: row.table_name,
        columns: [],
      }
      existing.columns.push({
        name: row.column_name,
        dataType: row.data_type,
        nullable: row.is_nullable === 'YES',
      })
      tableMap.set(row.table_name, existing)
    }

    const tables = Array.from(tableMap.values())
    return {
      tables,
      suggestions: inferMappingSuggestions(tables),
      defaultTransactionReadOnly,
      readOnlyValidatedBy: defaultTransactionReadOnly ? 'session-default' : 'privilege-restricted',
    }
  })
}

export async function upsertExternalDataConnection(input: ExternalConnectionInput): Promise<ExternalDataConnectionSummary> {
  const providerType = input.providerType
  if (providerType !== 'postgresql') {
    throw new Error(`Unsupported provider type: ${providerType}`)
  }

  const schemaName = input.schemaName || 'public'
  const port = input.port || 5432
  const existing = await prisma.enterpriseAiExternalDataConnection.findUnique({
    where: {
      tenantId_providerType: {
        tenantId: input.tenantId,
        providerType,
      },
    },
  })

  const existingCredentials = existing?.encryptedCredentials
    ? decryptCredentials(existing.encryptedCredentials)
    : null
  const username = input.username?.trim() || existingCredentials?.username
  const password = input.password || existingCredentials?.password

  if (!username || !password) {
    throw new Error('Read-only database username and password are required the first time you connect this source.')
  }

  const discovery = await discoverPostgresSchema({
    host: input.host,
    port,
    databaseName: input.databaseName,
    schemaName,
    sslRequired: input.sslRequired ?? true,
    credentials: {
      username,
      password,
    },
  })

  const saved = await prisma.enterpriseAiExternalDataConnection.upsert({
    where: {
      tenantId_providerType: {
        tenantId: input.tenantId,
        providerType,
      },
    },
    update: {
      connectionName: input.connectionName || null,
      host: input.host,
      port,
      databaseName: input.databaseName,
      schemaName,
      sslRequired: input.sslRequired ?? true,
      encryptedCredentials: encryptCredentials({ username, password }),
      status: 'CONNECTED',
      validationState: 'DRAFT',
      schemaSnapshot: {
        tableCount: discovery.tables.length,
        tables: discovery.tables,
      },
      mappingConfig: discovery.suggestions,
      lastValidatedAt: new Date(),
      lastValidationError: null,
      lastHealthStatus: 'HEALTHY',
      lastHealthAt: new Date(),
      groundingEnabled: false,
      isActive: true,
      updatedBy: input.userId,
    },
    create: {
      tenantId: input.tenantId,
      providerType,
      connectionName: input.connectionName || null,
      host: input.host,
      port,
      databaseName: input.databaseName,
      schemaName,
      sslRequired: input.sslRequired ?? true,
      encryptedCredentials: encryptCredentials({ username, password }),
      status: 'CONNECTED',
      validationState: 'DRAFT',
      schemaSnapshot: {
        tableCount: discovery.tables.length,
        tables: discovery.tables,
      },
      mappingConfig: discovery.suggestions,
      lastValidatedAt: new Date(),
      lastHealthStatus: 'HEALTHY',
      lastHealthAt: new Date(),
      groundingEnabled: false,
      isActive: true,
      createdBy: input.userId,
      updatedBy: input.userId,
    },
  })

  return toConnectionSummary(saved)
}

export async function getExternalDataConnectionSummary(tenantId: string): Promise<ExternalDataConnectionSummary | null> {
  const row = await prisma.enterpriseAiExternalDataConnection.findFirst({
    where: {
      tenantId,
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' },
  })
  return row ? toConnectionSummary(row) : null
}

export async function disableExternalDataConnection(args: { tenantId: string; userId: string }): Promise<ExternalDataConnectionSummary | null> {
  const row = await prisma.enterpriseAiExternalDataConnection.findFirst({
    where: { tenantId: args.tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) return null

  const updated = await prisma.enterpriseAiExternalDataConnection.update({
    where: { id: row.id },
    data: {
      isActive: false,
      groundingEnabled: false,
      status: 'DISABLED',
      updatedBy: args.userId,
      lastHealthStatus: 'DISABLED',
      lastHealthAt: new Date(),
    },
  })

  return toConnectionSummary(updated)
}

export async function rediscoverExternalSchema(tenantId: string): Promise<ExternalDiscoveryResult> {
  const row = await prisma.enterpriseAiExternalDataConnection.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) {
    throw new Error('No active external data connection found for tenant.')
  }

  const credentials = decryptCredentials(row.encryptedCredentials)
  const discovery = await discoverPostgresSchema({
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    schemaName: row.schemaName,
    sslRequired: row.sslRequired,
    credentials,
  })

  await prisma.enterpriseAiExternalDataConnection.update({
    where: { id: row.id },
    data: {
      status: 'CONNECTED',
      schemaSnapshot: {
        tableCount: discovery.tables.length,
        tables: discovery.tables,
      },
      lastHealthStatus: 'HEALTHY',
      lastHealthAt: new Date(),
      lastValidationError: null,
    },
  })

  return discovery
}

export async function saveExternalMappings(args: {
  tenantId: string
  userId: string
  mappingConfig: ExternalMappingConfig
  groundingEnabled?: boolean
}): Promise<ExternalDataConnectionSummary> {
  const row = await prisma.enterpriseAiExternalDataConnection.findFirst({
    where: { tenantId: args.tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) {
    throw new Error('No active external data connection found for tenant.')
  }

  const updated = await prisma.enterpriseAiExternalDataConnection.update({
    where: { id: row.id },
    data: {
      mappingConfig: args.mappingConfig,
      groundingEnabled: Boolean(args.groundingEnabled),
      validationState: 'DRAFT',
      updatedBy: args.userId,
    },
  })

  return toConnectionSummary(updated)
}

export async function validateExternalMappings(tenantId: string): Promise<ExternalMappingValidationResult> {
  const row = await prisma.enterpriseAiExternalDataConnection.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) {
    throw new Error('No active external data connection found for tenant.')
  }

  const mappingConfig = normalizeMappingConfig(row.mappingConfig)
  const missingEntities = REQUIRED_MAPPING_ENTITIES.filter((entity) => !mappingConfig[entity]?.table)
  const schemaSnapshot = row.schemaSnapshot && typeof row.schemaSnapshot === 'object'
    ? row.schemaSnapshot as { tables?: ExternalSchemaTable[] }
    : null
  const contractIssues = findExternalMappingContractIssues(mappingConfig, normalizeSchemaTables(schemaSnapshot?.tables))
  const contractIssueByEntity = new Map(contractIssues.map((issue) => [issue.entity, issue]))
  const credentials = decryptCredentials(row.encryptedCredentials)
  const entityResults: ExternalMappingValidationResult['entityResults'] = []

  await withPostgresClient({
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    sslRequired: row.sslRequired,
  }, credentials, async (client) => {
    for (const entity of REQUIRED_MAPPING_ENTITIES) {
      const entityMapping = mappingConfig[entity]
      if (!entityMapping?.table) {
        entityResults.push({ entity, ok: false, checkedColumns: [], error: 'Missing table mapping' })
        continue
      }

      const contractIssue = contractIssueByEntity.get(entity)
      if (contractIssue) {
        const contractErrors: string[] = []
        if (contractIssue.missingMappings.length > 0) {
          contractErrors.push(`Missing required mapped fields: ${contractIssue.missingMappings.join(', ')}`)
        }
        if (contractIssue.missingSchemaColumns.length > 0) {
          contractErrors.push(`Mapped columns not found in discovered schema: ${contractIssue.missingSchemaColumns.join(', ')}`)
        }
        entityResults.push({
          entity,
          ok: false,
          table: entityMapping.table,
          checkedColumns: Object.values(entityMapping.columns || {}),
          error: contractErrors.join('. '),
        })
        continue
      }

      try {
        const checkedColumns = Object.values(entityMapping.columns || {})
        for (const columnName of checkedColumns) quoteIdentifier(columnName)

        const countResult = await client.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM ${buildTableReference(row.schemaName, entityMapping.table)}`,
        )

        entityResults.push({
          entity,
          ok: true,
          table: entityMapping.table,
          rowCount: Number(countResult.rows[0]?.total || 0),
          checkedColumns,
        })
      } catch (error) {
        entityResults.push({
          entity,
          ok: false,
          table: entityMapping.table,
          checkedColumns: Object.values(entityMapping.columns || {}),
          error: (error as Error).message,
        })
      }
    }
  })

  const ok = missingEntities.length === 0 && entityResults.every((result) => result.ok)

  await prisma.enterpriseAiExternalDataConnection.update({
    where: { id: row.id },
    data: {
      validationState: ok ? 'VALIDATED' : 'FAILED',
      status: ok ? 'VALIDATED' : 'ERROR',
      groundingEnabled: ok && row.groundingEnabled,
      lastValidatedAt: new Date(),
      lastValidationError: ok ? null : entityResults.find((result) => !result.ok)?.error || 'Mapping validation failed',
      lastHealthStatus: ok ? 'HEALTHY' : 'ERROR',
      lastHealthAt: new Date(),
    },
  })

  return {
    ok,
    requiredEntitiesMapped: REQUIRED_MAPPING_ENTITIES.filter((entity) => Boolean(mappingConfig[entity]?.table)),
    missingEntities,
    entityResults,
  }
}

export async function loadExternalGroundingSnapshot(args: {
  tenantId: string
  startDate: Date
  endDate: Date
}): Promise<ExternalGroundingSnapshot | null> {
  const row = await prisma.enterpriseAiExternalDataConnection.findFirst({
    where: {
      tenantId: args.tenantId,
      isActive: true,
      status: 'VALIDATED',
      validationState: 'VALIDATED',
      groundingEnabled: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (!row?.encryptedCredentials) {
    return null
  }

  const mappingConfig = normalizeMappingConfig(row.mappingConfig)
  const hasRequiredMappings = REQUIRED_MAPPING_ENTITIES.every((entity) => Boolean(mappingConfig[entity]?.table))
  if (!hasRequiredMappings) {
    return null
  }

  const schemaSnapshot = row.schemaSnapshot && typeof row.schemaSnapshot === 'object'
    ? row.schemaSnapshot as { tables?: ExternalSchemaTable[] }
    : null
  const contractIssues = findExternalMappingContractIssues(mappingConfig, normalizeSchemaTables(schemaSnapshot?.tables))
  if (contractIssues.length > 0) {
    console.error('[Enterprise AI] External grounding snapshot rejected due to invalid mapping contract:', contractIssues)
    return null
  }

  const credentials = decryptCredentials(row.encryptedCredentials)

  try {
    return await withPostgresClient({
      host: row.host,
      port: row.port,
      databaseName: row.databaseName,
      sslRequired: row.sslRequired,
    }, credentials, async (client) => {
      const salesMapping = mappingConfig.sales!
      const saleItemsMapping = mappingConfig.saleItems!
      const expensesMapping = mappingConfig.expenses!
      const productsMapping = mappingConfig.products!
      const inventoryMapping = mappingConfig.inventory!
      const branchesMapping = mappingConfig.branches!

      const salesTable = buildTableReference(row.schemaName, salesMapping.table)
      const saleItemsTable = buildTableReference(row.schemaName, saleItemsMapping.table)
      const expensesTable = buildTableReference(row.schemaName, expensesMapping.table)
      const productsTable = buildTableReference(row.schemaName, productsMapping.table)
      const inventoryTable = buildTableReference(row.schemaName, inventoryMapping.table)
      const branchesTable = buildTableReference(row.schemaName, branchesMapping.table)

      const salesDateColumn = buildColumnReference('s', salesMapping.columns.date)
      const salesIdColumn = buildColumnReference('s', salesMapping.columns.id)
      const salesTotalColumn = buildColumnReference('s', salesMapping.columns.totalAmount)
      const salesCurrencyColumn = buildColumnReference('s', salesMapping.columns.currency)
      const salesBranchColumn = buildColumnReference('s', salesMapping.columns.branchId)

      const saleItemsSaleIdColumn = buildColumnReference('si', saleItemsMapping.columns.saleId)
      const saleItemsProductIdColumn = buildColumnReference('si', saleItemsMapping.columns.productId)
      const saleItemsQuantityColumn = buildColumnReference('si', saleItemsMapping.columns.quantity)
      const saleItemsSubtotalColumn = buildColumnReference('si', saleItemsMapping.columns.subtotal)

      const expenseDateColumn = buildColumnReference('e', expensesMapping.columns.date)
      const expenseAmountColumn = buildColumnReference('e', expensesMapping.columns.amount)
      const expenseCategoryColumn = buildColumnReference('e', expensesMapping.columns.category)
      const expenseTitleColumn = buildColumnReference('e', expensesMapping.columns.title)
      const expenseBranchColumn = buildColumnReference('e', expensesMapping.columns.branchId)

      const productIdColumn = buildColumnReference('p', productsMapping.columns.id)
      const productNameColumn = buildColumnReference('p', productsMapping.columns.name)
      const productCategoryColumn = buildColumnReference('p', productsMapping.columns.category)
      const productCostColumn = buildColumnReference('p', productsMapping.columns.costPrice)
      const productOriginalCostColumn = productsMapping.columns.originalCostPrice
        ? buildColumnReference('p', productsMapping.columns.originalCostPrice)
        : null
      const productPurchaseDateColumn = productsMapping.columns.purchaseDate
        ? buildColumnReference('p', productsMapping.columns.purchaseDate)
        : null
      const productPriceColumn = buildColumnReference('p', productsMapping.columns.sellingPrice)
      const productStockColumn = buildColumnReference('p', productsMapping.columns.currentStock)
      const productThresholdColumn = buildColumnReference('p', productsMapping.columns.lowStockThreshold)
      const productBranchColumn = buildColumnReference('p', productsMapping.columns.branchId)

      const inventoryProductIdColumn = buildColumnReference('i', inventoryMapping.columns.productId)
      const inventoryQuantityColumn = buildColumnReference('i', inventoryMapping.columns.quantity)
      const inventoryBranchColumn = buildColumnReference('i', inventoryMapping.columns.branchId)

      const branchIdColumn = buildColumnReference('b', branchesMapping.columns.id)
      const branchNameColumn = buildColumnReference('b', branchesMapping.columns.name)

      const [salesResult, saleItemsResult, expensesResult, productsResult, inventoryResult, branchesResult] = await Promise.all([
        client.query<{
          sale_id: string
          sale_date: Date | string
          total_amount: string
          currency: string | null
          branch_id: string | null
        }>(
          `SELECT
             ${salesIdColumn}::text AS sale_id,
             ${salesDateColumn} AS sale_date,
             COALESCE(${salesTotalColumn}, 0)::text AS total_amount,
             COALESCE(${salesCurrencyColumn}::text, '') AS currency,
             COALESCE(${salesBranchColumn}::text, NULL) AS branch_id
           FROM ${salesTable} s
           WHERE ${salesDateColumn} >= $1 AND ${salesDateColumn} < $2`,
          [args.startDate, args.endDate],
        ),
        client.query<{
          sale_id: string
          sale_date: Date | string
          product_id: string
          quantity: string
          subtotal: string
        }>(
          `SELECT
             ${saleItemsSaleIdColumn}::text AS sale_id,
             ${salesDateColumn} AS sale_date,
             ${saleItemsProductIdColumn}::text AS product_id,
             COALESCE(${saleItemsQuantityColumn}, 0)::text AS quantity,
             COALESCE(${saleItemsSubtotalColumn}, 0)::text AS subtotal
           FROM ${saleItemsTable} si
           JOIN ${salesTable} s ON ${saleItemsSaleIdColumn} = ${salesIdColumn}
           WHERE ${salesDateColumn} >= $1 AND ${salesDateColumn} < $2`,
          [args.startDate, args.endDate],
        ),
        client.query<{
          expense_date: Date | string
          amount: string
          category: string | null
          title: string | null
          branch_id: string | null
        }>(
          `SELECT
             ${expenseDateColumn} AS expense_date,
             COALESCE(${expenseAmountColumn}, 0)::text AS amount,
             COALESCE(${expenseCategoryColumn}::text, '') AS category,
             COALESCE(${expenseTitleColumn}::text, '') AS title,
             COALESCE(${expenseBranchColumn}::text, NULL) AS branch_id
           FROM ${expensesTable} e
           WHERE ${expenseDateColumn} >= $1 AND ${expenseDateColumn} < $2`,
          [args.startDate, args.endDate],
        ),
        client.query<{
          product_id: string
          name: string
          category: string | null
          cost_price: string
          original_cost_price: string | null
          purchase_date: Date | string | null
          selling_price: string
          current_stock: string
          low_stock_threshold: string
          branch_id: string | null
        }>(
          `SELECT
             ${productIdColumn}::text AS product_id,
             COALESCE(${productNameColumn}::text, '') AS name,
             COALESCE(${productCategoryColumn}::text, '') AS category,
             COALESCE(${productCostColumn}, 0)::text AS cost_price,
             ${productOriginalCostColumn ? `COALESCE(${productOriginalCostColumn}, NULL)::text` : 'NULL::text'} AS original_cost_price,
             ${productPurchaseDateColumn || 'NULL::timestamptz'} AS purchase_date,
             COALESCE(${productPriceColumn}, 0)::text AS selling_price,
             COALESCE(${productStockColumn}, 0)::text AS current_stock,
             COALESCE(${productThresholdColumn}, 0)::text AS low_stock_threshold,
             COALESCE(${productBranchColumn}::text, NULL) AS branch_id
           FROM ${productsTable} p`,
        ),
        client.query<{
          product_id: string
          quantity: string
          branch_id: string | null
        }>(
          `SELECT
             ${inventoryProductIdColumn}::text AS product_id,
             COALESCE(${inventoryQuantityColumn}, 0)::text AS quantity,
             COALESCE(${inventoryBranchColumn}::text, NULL) AS branch_id
           FROM ${inventoryTable} i`,
        ),
        client.query<{
          branch_id: string
          name: string
        }>(
          `SELECT
             ${branchIdColumn}::text AS branch_id,
             COALESCE(${branchNameColumn}::text, '') AS name
           FROM ${branchesTable} b`,
        ),
      ])

      const latestSalesAt = salesResult.rows.reduce<number>((max, row) => {
        const value = new Date(row.sale_date).getTime()
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)
      const latestExpenseAt = expensesResult.rows.reduce<number>((max, row) => {
        const value = new Date(row.expense_date).getTime()
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)
      const latestDataAt = Math.max(latestSalesAt, latestExpenseAt)

      return {
        source: 'external',
        sales: salesResult.rows.map((row) => ({
          saleId: row.sale_id,
          saleDate: new Date(row.sale_date).toISOString(),
          totalAmount: Number(row.total_amount || 0),
          currency: row.currency || null,
          branchId: row.branch_id || null,
        })),
        saleItems: saleItemsResult.rows.map((row) => ({
          saleId: row.sale_id,
          saleDate: new Date(row.sale_date).toISOString(),
          productId: row.product_id,
          quantity: Number(row.quantity || 0),
          subtotal: Number(row.subtotal || 0),
        })),
        expenses: expensesResult.rows.map((row) => ({
          expenseDate: new Date(row.expense_date).toISOString(),
          amount: Number(row.amount || 0),
          category: row.category || null,
          title: row.title || null,
          branchId: row.branch_id || null,
        })),
        products: productsResult.rows.map((row) => ({
          productId: row.product_id,
          name: row.name,
          category: row.category || null,
          costPrice: Number(row.cost_price || 0),
          originalCostPrice: row.original_cost_price !== null ? Number(row.original_cost_price || 0) : null,
          purchaseDate: row.purchase_date ? new Date(row.purchase_date).toISOString() : null,
          sellingPrice: Number(row.selling_price || 0),
          currentStock: Number(row.current_stock || 0),
          lowStockThreshold: Number(row.low_stock_threshold || 0),
          branchId: row.branch_id || null,
        })),
        inventory: inventoryResult.rows.map((row) => ({
          productId: row.product_id,
          quantity: Number(row.quantity || 0),
          branchId: row.branch_id || null,
        })),
        branches: branchesResult.rows.map((row) => ({
          branchId: row.branch_id,
          name: row.name,
        })),
        latestDataAt: latestDataAt > 0 ? new Date(latestDataAt).toISOString() : null,
      }
    })
  } catch (error) {
    console.error('[Enterprise AI] External grounding snapshot unavailable:', error)
    return null
  }
}

export async function resolveEnterpriseAiDataProviderContext(tenantId: string): Promise<EnterpriseAiDataProviderContext> {
  const externalConnection = await getExternalDataConnectionSummary(tenantId)
  const externalGroundingReady = Boolean(
    externalConnection
    && externalConnection.status === 'VALIDATED'
    && externalConnection.validationState === 'VALIDATED'
    && externalConnection.groundingEnabled
    && externalConnection.contractIssues.length === 0,
  )
  return {
    source: externalGroundingReady ? 'external' : 'internal',
    externalConnection,
    externalGroundingReady,
  }
}
