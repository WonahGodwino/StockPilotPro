// ── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'SUPER_ADMIN' | 'BUSINESS_ADMIN' | 'SALESPERSON'

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  tenantId: string | null
  subsidiaryId: string | null
  tenant: { id: string; name: string; slug: string; baseCurrency: string } | null
}

// ── Products ─────────────────────────────────────────────────────────────────

export type ProductType = 'GOODS' | 'SERVICE'
export type ProductStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED'

export interface Product {
  id: string
  tenantId: string
  subsidiaryId: string
  name: string
  description?: string
  type: ProductType
  unit: string
  quantity: number
  costPrice: number
  sellingPrice: number
  barcode?: string
  lowStockThreshold: number
  status: ProductStatus
  createdAt: string
  updatedAt: string
  createdBy?: string
}

// ── Sales ─────────────────────────────────────────────────────────────────────

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'POS'

export interface SaleItem {
  id: string
  productId: string
  quantity: number
  unitPrice: number
  costPrice: number
  discount: number
  subtotal: number
  product?: { name: string; unit: string }
}

export interface Sale {
  id: string
  tenantId: string
  subsidiaryId: string
  userId: string
  totalAmount: number
  discount: number
  amountPaid: number
  paymentMethod: PaymentMethod
  receiptNumber: string
  currency: string
  fxRate: number
  notes?: string
  createdAt: string
  items: SaleItem[]
  user?: { firstName: string; lastName: string }
  subsidiary?: { name: string }
}

// Cart item (frontend only)
export interface CartItem {
  product: Product
  quantity: number
  unitPrice: number
  discount: number
}

// Checkout payload sent to POST /sales (and stored for offline sync)
export interface SaleCheckoutPayload {
  subsidiaryId: string
  paymentMethod: PaymentMethod
  discount: number
  amountPaid: number
  currency: string
  fxRate: number
  notes?: string
  items: {
    productId: string
    quantity: number
    unitPrice: number
    costPrice: number
    discount: number
  }[]
}

// ── Expenses ──────────────────────────────────────────────────────────────────

export interface Expense {
  id: string
  tenantId: string
  subsidiaryId: string
  userId: string
  title: string
  amount: number
  category: string
  date: string
  currency: string
  fxRate: number
  notes?: string
  createdAt: string
  user?: { firstName: string; lastName: string }
}

// ── Subsidiaries ──────────────────────────────────────────────────────────────

export interface Subsidiary {
  id: string
  tenantId: string
  name: string
  address?: string
  phone?: string
  email?: string
  isActive: boolean
  createdAt: string
  _count?: { users: number; products: number; sales: number }
}

// ── Tenants ───────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string
  name: string
  slug: string
  email: string
  phone?: string
  isActive: boolean
  baseCurrency: string
  createdAt: string
  subscriptions?: Subscription[]
  _count?: { users: number; subsidiaries: number }
}

// ── Plans & Subscriptions ─────────────────────────────────────────────────────

export interface Plan {
  id: string
  name: string
  description?: string
  price: number
  maxSubsidiaries: number
  extraSubsidiaryPrice: number
  features: Record<string, unknown>
  isActive: boolean
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED'

export interface Subscription {
  id: string
  tenantId: string
  planId: string
  status: SubscriptionStatus
  startDate: string
  expiryDate: string
  amount: number
  plan?: Plan
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  tenantId: string
  productId?: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
  product?: { name: string; unit: string }
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface ReportSummary {
  totalSales: number
  totalExpenses: number
  cogs: number
  grossProfit: number
  netProfit: number
  totalProductWorth: number
  salesCount: number
}

export interface DashboardData {
  salesThisMonth: number
  salesCount: number
  expensesThisMonth: number
  lowStockCount: number
  totalProducts: number
  activeSubsidiaries: number
  unreadNotifications: number
  salesTrend: { date: string; total: number }[]
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}
