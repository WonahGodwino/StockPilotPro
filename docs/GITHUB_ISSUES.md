# StockPilot Pro — GitHub Issues Log

> This file is the authoritative list of GitHub Issues for the StockPilot Pro project.
> Copy each issue into GitHub and assign to **GitHub Copilot** or specific team members.
> Labels used: `feature`, `bug`, `enhancement`, `security`, `testing`, `chore`, `backend`, `frontend`, `infra`

---

## EPIC 1 — Authentication & Security

### Issue #1 — Implement JWT login endpoint
**Labels:** `feature` `backend` `security`
**Priority:** P0

Implement `POST /api/auth/login` that accepts email + password, validates credentials with bcryptjs, issues a signed JWT access token (15 min expiry) and a refresh token (7 days), stores the refresh token hash in the `RefreshToken` table, and returns the user object.

**Acceptance Criteria:**
- [ ] Returns `401` for invalid credentials
- [ ] Returns `403` if tenant subscription is expired/suspended
- [ ] Access token payload includes `userId`, `tenantId`, `role`, `subsidiaryId`
- [ ] Refresh token is stored with `expiresAt`, `ipAddress`, `userAgent` metadata

---

### Issue #2 — Implement JWT token rotation (refresh endpoint)
**Labels:** `feature` `backend` `security`
**Priority:** P0

Implement `POST /api/auth/refresh` that accepts a refresh token, validates it against the DB, issues a new access token + refresh token (rotation pattern), and revokes the old refresh token.

**Acceptance Criteria:**
- [ ] Old refresh token is invalidated on each use (rotation)
- [ ] Returns `401` if token is expired, revoked, or invalid
- [ ] New token pair is issued atomically

---

### Issue #3 — Implement logout endpoint
**Labels:** `feature` `backend` `security`
**Priority:** P0

Implement `POST /api/auth/logout` that revokes the provided refresh token from the `RefreshToken` table.

**Acceptance Criteria:**
- [ ] Refresh token is deleted from DB
- [ ] Returns `200` even if token not found (idempotent)

---

### Issue #4 — Frontend: Login page with demo credential auto-fill
**Labels:** `feature` `frontend`
**Priority:** P0

Build the React login page at `/login` with email/password form. Include three quick-fill buttons for demo credentials (Super Admin, Business Admin, Salesperson). Show toast on success/failure. Redirect to `/dashboard` on success.

**Acceptance Criteria:**
- [ ] Form validates email format and required fields
- [ ] Quick-fill buttons populate credentials
- [ ] Auth tokens stored in Zustand auth store (persisted to localStorage)
- [ ] Redirects unauthenticated users back to `/login` from protected routes

---

### Issue #5 — Frontend: Axios JWT interceptor with auto-refresh
**Labels:** `feature` `frontend` `security`
**Priority:** P0

In `src/lib/api.ts`, implement an Axios response interceptor that detects `401` errors, automatically calls `/auth/refresh`, retries the original request, and queues concurrent 401 requests while the refresh is in-flight.

**Acceptance Criteria:**
- [ ] Queued requests are resolved after token refresh succeeds
- [ ] User is logged out if refresh fails
- [ ] No infinite refresh loop

---

## EPIC 2 — Multi-Tenancy & Subscriptions

### Issue #6 — Tenant CRUD API (Super Admin)
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/tenants`, `POST /api/tenants`, `GET /api/tenants/[id]`, `PUT /api/tenants/[id]`, `DELETE /api/tenants/[id]`. Only `SUPER_ADMIN` can create/update/delete. Soft-delete via `archived: true`.

**Acceptance Criteria:**
- [ ] `SUPER_ADMIN` can list, create, update, soft-delete tenants
- [ ] `BUSINESS_ADMIN` can only view their own tenant
- [ ] Deleting a tenant sets `archived: true` (no hard delete)

---

### Issue #7 — Subscription management API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/subscriptions`, `POST /api/subscriptions`, `PUT /api/subscriptions/[id]`. Super Admin can create subscriptions linking a tenant to a plan with expiry. Business Admin can view their own subscription status.

**Acceptance Criteria:**
- [ ] Status transitions enforced: ACTIVE → SUSPENDED → EXPIRED
- [ ] Expiry date checked at login to block expired tenants
- [ ] Super Admin can manually update status and expiry

---

### Issue #8 — Plans CRUD API
**Labels:** `feature` `backend`
**Priority:** P1

Implement `GET /api/plans` (public for listing) and `POST /api/plans` (Super Admin only). Plans have `name`, `price`, `maxBranches`, `features[]`, `billingCycle`.

**Acceptance Criteria:**
- [ ] Anyone authenticated can list plans
- [ ] Only `SUPER_ADMIN` can create plans
- [ ] `maxBranches` is enforced when creating subsidiaries

---

### Issue #9 — Enforce branch limit based on subscription plan
**Labels:** `feature` `backend`
**Priority:** P1

In `POST /api/subsidiaries`, check the tenant's active subscription plan `maxBranches` limit. Reject creation if the limit has been reached.

**Acceptance Criteria:**
- [ ] Returns `403` with descriptive message when limit exceeded
- [ ] Super Admin is exempt from limit

---

### Issue #10 — Frontend: Super Admin Tenants management page
**Labels:** `feature` `frontend`
**Priority:** P1

Build `/admin/tenants` page. Show all tenants in expandable cards with subscription status badge. Allow create/edit tenant via modal. Allow activate/suspend toggle.

**Acceptance Criteria:**
- [ ] Search by tenant name or email
- [ ] Create modal with name, email, phone, address
- [ ] Expandable row shows plan name, expiry, branch count
- [ ] Suspend/activate button

---

### Issue #11 — Frontend: Super Admin Plans page
**Labels:** `feature` `frontend`
**Priority:** P1

Build `/admin/plans` page. Show plans as cards with pricing, branch limit, and features list. Allow create/edit via modal.

**Acceptance Criteria:**
- [ ] Plans shown as visual pricing cards
- [ ] Features listed as checkmarks
- [ ] Create/edit modal with textarea for features (one per line)

---

## EPIC 3 — Inventory / Products

### Issue #12 — Products CRUD API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/products`, `POST /api/products`, `GET /api/products/[id]`, `PUT /api/products/[id]`, `DELETE /api/products/[id]`. Products are tenant-scoped. Include search, category filter, and low-stock filter query params.

**Acceptance Criteria:**
- [ ] GET supports `?search=`, `?category=`, `?lowStock=true`, `?archived=false`
- [ ] Product has: `name`, `sku`, `barcode`, `category`, `costPrice`, `sellingPrice`, `quantity`, `lowStockThreshold`, `type` (GOODS/SERVICE), `status` (ACTIVE/DRAFT/ARCHIVED), `subsidiaryId`
- [ ] Salesperson cannot archive/delete products

---

### Issue #13 — Frontend: Products page with CRUD
**Labels:** `feature` `frontend`
**Priority:** P0

Build `/products` page. Show products in a paginated table with search, category filter, and low-stock warning badge. Admin can create/edit/archive products. Caches products to IndexedDB via Dexie for offline use.

**Acceptance Criteria:**
- [ ] Inline low-stock warning (red badge) when `quantity <= lowStockThreshold`
- [ ] ProductModal for create/edit with all fields + margin % indicator
- [ ] Profit margin shown as colored indicator (green ≥ 30%, amber 15-30%, red < 15%)
- [ ] Products cached to IndexedDB after each load

---

### Issue #14 — Barcode scan support in Products and POS
**Labels:** `feature` `frontend`
**Priority:** P1

Add a global keyboard event listener in the POS (Sales) page that buffers keystrokes for 200ms to detect USB barcode scanner input. Lookup product by barcode from cache or API and add to cart.

**Acceptance Criteria:**
- [ ] Buffer timeout of 200ms distinguishes scanner from manual typing
- [ ] Barcode lookup falls back to Dexie IndexedDB when offline
- [ ] Sound/visual feedback on scan
- [ ] Handles unknown barcode gracefully (toast error)

---

### Issue #15 — Low stock notification system
**Labels:** `feature` `backend`
**Priority:** P1

In `src/lib/helpers.ts`, implement `checkLowStockAlerts()`. After each sale that deducts stock, check all products where `quantity <= lowStockThreshold`. Create a `Notification` record (type: `LOW_STOCK`) deduped per product per day.

**Acceptance Criteria:**
- [ ] One notification per product per calendar day (no spam)
- [ ] Notification message includes product name and current quantity
- [ ] Triggered after every sale that modifies stock

---

## EPIC 4 — Point of Sale (Sales)

### Issue #16 — Sales recording API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `POST /api/sales`. Accepts `subsidiaryId`, `items[]` (productId, quantity, unitPrice, discount), `paymentMethod`. Atomically deducts stock from each product, creates the `Sale` + `SaleItem` records, generates a receipt number (format `RCP-YYYYMMDD-NNNNN`), and triggers low-stock checks.

**Acceptance Criteria:**
- [ ] Returns `400` if any product has insufficient stock
- [ ] Transaction is atomic (Prisma `$transaction`)
- [ ] Receipt number is unique per tenant per day
- [ ] Supports payment methods: CASH, CARD, TRANSFER

---

### Issue #17 — Sales list & detail API
**Labels:** `feature` `backend`
**Priority:** P1

Implement `GET /api/sales` (paginated, filterable by date range, subsidiaryId) and `GET /api/sales/[id]` (full detail with items, product names, salesperson).

**Acceptance Criteria:**
- [ ] Pagination with `page`, `limit` params
- [ ] Date range filter: `?from=`, `?to=`
- [ ] Salesperson can only see their own sales
- [ ] GET by ID returns full receipt data

---

### Issue #18 — Frontend: POS / Sales page
**Labels:** `feature` `frontend`
**Priority:** P0

Build `/sales` page with a two-panel layout: left (product search + results grid) and right (cart). Cart supports quantity adjustment, per-item discount, and shows total + change calculator. Checkout button posts to API.

**Acceptance Criteria:**
- [ ] Product search autocomplete (min 2 chars)
- [ ] Cart persists during session via Zustand cart store
- [ ] Calculates change from "Amount Tendered" input
- [ ] Successful checkout shows receipt modal and clears cart
- [ ] Offline: sale is stored in IndexedDB `pendingRecords` and synced when online

---

### Issue #19 — Frontend: Printable POS receipt
**Labels:** `feature` `frontend`
**Priority:** P1

Build `Receipt` component using `react-to-print`. Shows store name, branch, receipt number, date/time, itemized list with qty × price − discount, subtotal, total, amount tendered, change, and salesperson name.

**Acceptance Criteria:**
- [ ] Print-optimized CSS (no sidebar, white background)
- [ ] All sale items listed with individual totals
- [ ] Footer with "Thank you" message

---

## EPIC 5 — Expenses

### Issue #20 — Expenses CRUD API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/expenses`, `POST /api/expenses`, `PUT /api/expenses/[id]`, `DELETE /api/expenses/[id]`. Expenses are tenant + subsidiary scoped. Categories: Rent, Utilities, Salaries, Marketing, Transportation, Maintenance, Supplies, Other.

**Acceptance Criteria:**
- [ ] GET supports `?category=`, `?from=`, `?to=`, `?subsidiaryId=`
- [ ] Salesperson cannot delete expenses
- [ ] Soft-delete or hard-delete (based on role)

---

### Issue #21 — Frontend: Expenses page with category filter
**Labels:** `feature` `frontend`
**Priority:** P0

Build `/expenses` page. Show expenses in table with category filter chips and date range filter. Show running total. Admin can create/edit/delete entries via `ExpenseModal`.

**Acceptance Criteria:**
- [ ] Category filter pills at the top
- [ ] Total shown in a summary card
- [ ] ExpenseModal with title, amount, date, category, notes
- [ ] Confirmation dialog before delete

---

## EPIC 6 — Reports & Analytics

### Issue #22 — P&L Report API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/reports`. Returns: `totalSales`, `costOfGoods`, `grossProfit`, `totalExpenses`, `netProfit`, `totalProductWorth`, `expensesByCategory{}`, `topProducts[]` for a given period. Restricted to `BUSINESS_ADMIN` and `SUPER_ADMIN`.

**Acceptance Criteria:**
- [ ] Period params: `daily`, `monthly`, `quarterly`, `yearly`, `custom` (with `?from=&to=`)
- [ ] `topProducts` sorted by revenue descending (top 10)
- [ ] `expensesByCategory` is a key-value map
- [ ] Returns `403` for SALESPERSON

---

### Issue #23 — Dashboard stats API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/reports/dashboard`. Returns today's sales count + total, this month's revenue + expenses, total products, low stock count, and 7-day sales trend array `[{ date, revenue }]`.

**Acceptance Criteria:**
- [ ] All stats scoped to user's `tenantId`
- [ ] 7-day trend includes days with zero sales
- [ ] Fast response (all calcs in single Prisma query batch)

---

### Issue #24 — Frontend: Dashboard with live charts
**Labels:** `feature` `frontend`
**Priority:** P0

Build `/dashboard` page that fetches `/reports/dashboard` and `/reports?period=monthly`. Show 4 KPI stat cards, P&L summary (admin only), a 7-day AreaChart (Recharts), and a monthly BarChart (revenue vs expenses).

**Acceptance Criteria:**
- [ ] Charts animate on load
- [ ] P&L cards hidden from SALESPERSON role
- [ ] Low stock count card links to `/products?lowStock=true`
- [ ] Loading skeleton while fetching

---

### Issue #25 — Frontend: Reports page with period selector
**Labels:** `feature` `frontend`
**Priority:** P1

Build `/reports` page. Period selector buttons (daily/monthly/quarterly/yearly/custom). Custom range shows date pickers + Generate button. Shows P&L summary cards, top products BarChart, expenses by category PieChart.

**Acceptance Criteria:**
- [ ] Period buttons update charts instantly
- [ ] Custom range: "Generate" button triggers fetch
- [ ] Profit margin % calculated from net profit / total revenue
- [ ] Page redirects SALESPERSON to `/dashboard`

---

## EPIC 7 — Notifications

### Issue #26 — Notifications API
**Labels:** `feature` `backend`
**Priority:** P1

Implement `GET /api/notifications` (returns list + `unreadCount`) and `PUT /api/notifications/[id]/read` (marks as read). Notifications are tenant-scoped, not subsidiary-scoped.

**Acceptance Criteria:**
- [ ] GET supports `?unread=true` filter
- [ ] `unreadCount` returned in every GET response
- [ ] Mark-as-read is idempotent

---

### Issue #27 — Frontend: Notifications page
**Labels:** `feature` `frontend`
**Priority:** P1

Build `/notifications` page. Show all notifications grouped or sorted by time. Filter toggle (All / Unread). "Mark all as read" button. Clicking an unread notification marks it read inline. Unread count badge in sidebar and header bell icon.

**Acceptance Criteria:**
- [ ] Unread notifications have left indigo border
- [ ] `formatDistanceToNow` used for relative timestamps
- [ ] Type icons: LOW_STOCK → Package, SUBSCRIPTION_EXPIRY → AlertTriangle

---

### Issue #28 — Subscription expiry notification
**Labels:** `feature` `backend`
**Priority:** P1

In `src/lib/helpers.ts`, implement `checkSubscriptionExpiry()`. When a tenant's subscription is within 7 days of expiry, create a `SUBSCRIPTION_EXPIRY` notification (deduplicated per day).

**Acceptance Criteria:**
- [ ] Triggered on each login and on a daily cron (or manual call)
- [ ] Notification message includes days remaining
- [ ] Only created once per day per tenant

---

## EPIC 8 — Offline-First & PWA

### Issue #29 — IndexedDB caching with Dexie.js
**Labels:** `feature` `frontend`
**Priority:** P1

Set up Dexie.js (`StockPilotProDB`) in `src/lib/db.ts` with tables: `products`, `sales`, `expenses`, `pendingRecords`, `cart`. Implement helper functions: `cacheProducts`, `getCachedProducts`, `searchCachedProducts`, `getProductByBarcode`, `addPendingSale`, `getPendingRecords`, `markSynced`.

**Acceptance Criteria:**
- [ ] Products cached after each successful API fetch
- [ ] Barcode lookup works offline from cache
- [ ] Pending sales stored with unique ID and timestamp

---

### Issue #30 — Offline-to-online sync engine
**Labels:** `feature` `frontend`
**Priority:** P1

Implement `syncPendingRecords()` in `src/lib/sync.ts`. When network is restored (or every 30s), iterate `pendingRecords` from Dexie, POST to API, and mark as synced. Handle conflicts gracefully.

**Acceptance Criteria:**
- [ ] `window.addEventListener('online', ...)` triggers sync immediately
- [ ] 30-second polling when online
- [ ] Failed syncs are retried (not discarded)
- [ ] User sees toast notification on sync completion

---

### Issue #31 — PWA manifest and service worker
**Labels:** `feature` `frontend` `infra`
**Priority:** P2

Configure `vite-plugin-pwa` in `vite.config.ts`. Set up `manifest.json` with app name, icons, theme color, display mode `standalone`. Configure service worker to cache API responses and static assets.

**Acceptance Criteria:**
- [ ] App installable on Chrome/Android as PWA
- [ ] Static assets cached for offline use
- [ ] Splash screen and home screen icon configured

---

## EPIC 9 — Users & RBAC

### Issue #32 — Users CRUD API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/users`, `POST /api/users`, `PUT /api/users/[id]`. Users are tenant-scoped. Only BUSINESS_ADMIN+ can create/edit users. Passwords hashed with bcryptjs (salt rounds 12).

**Acceptance Criteria:**
- [ ] Password never returned in response
- [ ] Email must be unique within a tenant
- [ ] Admin cannot change another admin's role to SUPER_ADMIN
- [ ] `subsidiaryId` assignment restricts user to that branch

---

### Issue #33 — RBAC permission matrix
**Labels:** `feature` `backend` `security`
**Priority:** P0

Implement `src/lib/rbac.ts` with permission checks. Define permission matrix for 3 roles: `SUPER_ADMIN` (all permissions), `BUSINESS_ADMIN` (tenant-scoped management), `SALESPERSON` (limited to creating sales, viewing own data).

**Permission map:**
- `view:reports`, `view:profit_loss`, `view:analytics` — SUPER_ADMIN, BUSINESS_ADMIN only
- `manage:products` — SUPER_ADMIN, BUSINESS_ADMIN only
- `create:sales` — all roles
- `manage:tenants` — SUPER_ADMIN only

**Acceptance Criteria:**
- [ ] `hasPermission(user, permission)` returns boolean
- [ ] `requirePermission(req, permission)` throws on unauthorized
- [ ] `assertTenantAccess(user, tenantId)` throws if IDs don't match (except SUPER_ADMIN)

---

### Issue #34 — Frontend: Users management page
**Labels:** `feature` `frontend`
**Priority:** P1

Build `/users` page. Show all team members in a table (name, email, role badge, branch). Admin can add/edit users via modal. Role selector and branch assignment included.

**Acceptance Criteria:**
- [ ] Role badges color-coded (Admin = amber, Salesperson = blue)
- [ ] Current user row shows "(you)" and edit is disabled
- [ ] Password field optional on edit (blank = no change)

---

## EPIC 10 — Subsidiaries / Branches

### Issue #35 — Subsidiaries CRUD API
**Labels:** `feature` `backend`
**Priority:** P0

Implement `GET /api/subsidiaries`, `POST /api/subsidiaries`, `GET /api/subsidiaries/[id]`, `PUT /api/subsidiaries/[id]`, `DELETE /api/subsidiaries/[id]`. Enforce plan `maxBranches` limit on creation.

**Acceptance Criteria:**
- [ ] Salesperson can only see their assigned subsidiary
- [ ] Soft-delete via `archived: true`
- [ ] Branch limit enforced with descriptive error

---

### Issue #36 — Frontend: Subsidiaries/Branches page
**Labels:** `feature` `frontend`
**Priority:** P1

Build `/subsidiaries` page. Show branches as cards with name, active/inactive badge, address, and phone. Admin can create/edit/toggle active state.

**Acceptance Criteria:**
- [ ] Inactive branches shown with reduced opacity
- [ ] Toggle activate/deactivate with confirmation
- [ ] Branch card shows address and phone if available

---

## EPIC 11 — Infrastructure & DevOps

### Issue #37 — Monorepo setup with npm workspaces
**Labels:** `chore` `infra`
**Priority:** P0

Configure root `package.json` as an npm workspaces monorepo with `apps/api` and `apps/client` as workspaces. Root scripts: `dev` (concurrent), `db:migrate`, `db:seed`, `db:studio`.

**Acceptance Criteria:**
- [ ] `npm run dev` starts both API (port 3000) and client (port 5173)
- [ ] `npm run db:migrate` runs Prisma migrate
- [ ] `npm run db:seed` seeds demo data

---

### Issue #38 — Prisma schema — all models
**Labels:** `chore` `backend` `infra`
**Priority:** P0

Design and finalize the complete Prisma schema with 12 models: `Plan`, `Tenant`, `Subscription`, `User`, `RefreshToken`, `Subsidiary`, `Product`, `Sale`, `SaleItem`, `Expense`, `Notification`, `AuditLog`. All models include soft-delete, audit fields.

**Models must have:**
- `createdAt`, `updatedAt` timestamps
- `createdBy`, `updatedBy` user references
- `archived` boolean for soft-delete
- Proper foreign key relations and indexes

---

### Issue #39 — Prisma seed file with demo data
**Labels:** `chore` `backend`
**Priority:** P0

Create `apps/api/prisma/seed.ts` that seeds: 3 plans (Starter $99.99, Growth $249.99, Enterprise $599.99), 1 super admin, 1 demo tenant with active subscription, 2 subsidiaries, 3 users (admin + 2 salespeople), 5 products.

**Demo credentials:**
- `superadmin@stockpilot.pro` / `SuperAdmin@123`
- `admin@demo.com` / `Admin@123`
- `sales@demo.com` / `Sales@123`

---

### Issue #40 — Environment configuration
**Labels:** `chore` `infra`
**Priority:** P0

Create `.env.example` files in root, `apps/api`, and `apps/client`. Document all required environment variables. Add `.gitignore` entries to prevent `.env` from being committed.

**Required variables (API):**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `NEXT_PUBLIC_APP_URL`

**Required variables (Client):**
- `VITE_API_URL`

---

## EPIC 12 — Testing

### Issue #41 — Unit tests: JWT utilities
**Labels:** `testing` `backend`
**Priority:** P2

Write unit tests for `src/lib/jwt.ts` covering: token signing, verification, expiry, revocation, rotation. Use Jest or Vitest.

**Acceptance Criteria:**
- [ ] Expired tokens throw appropriate errors
- [ ] Revoked tokens are rejected
- [ ] Token rotation invalidates the old token

---

### Issue #42 — Unit tests: RBAC permission checker
**Labels:** `testing` `backend`
**Priority:** P2

Write unit tests for `src/lib/rbac.ts`. Test all 3 roles against all 12 permissions. Test `assertTenantAccess` and `assertSubsidiaryAccess`.

**Acceptance Criteria:**
- [ ] SUPER_ADMIN passes all permission checks
- [ ] SALESPERSON fails `view:reports` check
- [ ] Cross-tenant access throws for BUSINESS_ADMIN

---

### Issue #43 — Integration tests: Auth flow
**Labels:** `testing` `backend`
**Priority:** P2

Write integration tests for the full auth flow: login → refresh → logout. Test with expired subscription, wrong password, and revoked refresh token scenarios.

**Acceptance Criteria:**
- [ ] Login with expired subscription returns `403`
- [ ] Refresh with revoked token returns `401`
- [ ] Logout invalidates the refresh token in DB

---

### Issue #44 — Integration tests: Sales + stock deduction
**Labels:** `testing` `backend`
**Priority:** P2

Write integration tests for `POST /api/sales`. Test: normal sale, oversell (insufficient stock), multi-item sale, low stock notification trigger.

**Acceptance Criteria:**
- [ ] Oversell returns `400` with clear message
- [ ] Stock is correctly deducted from product
- [ ] Low stock notification created when threshold crossed

---

### Issue #45 — Frontend E2E tests: POS flow (Playwright)
**Labels:** `testing` `frontend`
**Priority:** P3

Write Playwright E2E tests for the POS flow: login as salesperson → search product → add to cart → set amount tendered → checkout → verify receipt shown.

**Acceptance Criteria:**
- [ ] Test runs against seeded demo data
- [ ] Receipt modal appears after successful checkout
- [ ] Cart is cleared after checkout

---

### Issue #46 — Frontend component tests: ProductModal
**Labels:** `testing` `frontend`
**Priority:** P3

Write React Testing Library tests for `ProductModal`. Test: form validation, margin indicator color changes, submit creates/updates product.

---

## EPIC 13 — UI/UX Polish

### Issue #47 — Loading skeletons for all data tables
**Labels:** `enhancement` `frontend`
**Priority:** P2

Replace spinner placeholders with skeleton loaders (animated gray bars) across Products, Sales, Expenses, Users, and Subsidiaries pages.

---

### Issue #48 — Dark mode support
**Labels:** `enhancement` `frontend`
**Priority:** P3

Add dark mode support via Tailwind `dark:` variant. Persist preference in localStorage. Toggle in Header component.

---

### Issue #49 — Mobile-responsive POS layout
**Labels:** `enhancement` `frontend`
**Priority:** P2

Adjust the Sales/POS page for mobile. Cart and product search should stack vertically on screens < 768px. Checkout button always visible at bottom.

---

### Issue #50 — Pagination component
**Labels:** `enhancement` `frontend`
**Priority:** P2

Build a reusable `Pagination` component and wire it to Products, Sales, and Expenses pages. API already supports `page` + `limit` params.

**Acceptance Criteria:**
- [ ] Prev/Next buttons and page number display
- [ ] "Showing X–Y of Z results" text
- [ ] Disabled state on first/last page

---

### Issue #51 — Real-time notifications via WebSocket
**Labels:** `enhancement` `backend` `frontend`
**Priority:** P3

Set up a WebSocket server in `apps/api` using the `ws` package. Push low-stock and subscription-expiry notifications to connected clients in real-time. Client subscribes on mount and updates the notification bell count.

**Acceptance Criteria:**
- [ ] WebSocket server on `/api/ws` (or separate port)
- [ ] JWT-authenticated WebSocket connection
- [ ] Notification bell updates without page reload

---

### Issue #52 — Audit log API
**Labels:** `enhancement` `backend`
**Priority:** P3

Implement `GET /api/audit-logs` (Super Admin only). Returns paginated `AuditLog` records filtered by `tenantId`, `userId`, `action`, `entity`, date range.

---

### Issue #53 — CSV/Excel export for reports
**Labels:** `enhancement` `frontend`
**Priority:** P3

Add "Export CSV" button to the Reports page. Exports the current P&L data as a CSV file using `papaparse` or a similar library.

---

## EPIC 14 — Enterprise AI Package (Tenant-Gated)

### Issue #54 — Enterprise package entitlement and route guard
**Labels:** `feature` `backend` `security`
**Priority:** P0

Implement package entitlement checks for Enterprise AI features. Add middleware guards for `/api/enterprise-ai/*` that allow access only when tenant has active Enterprise package entitlement.

**Acceptance Criteria:**
- [ ] Unauthorized tenants receive `403` with upgrade metadata
- [ ] Authorized Enterprise tenants can call all Enterprise AI endpoints
- [ ] Guard is reusable and applied consistently to all Enterprise AI routes

---

### Issue #55 — Enterprise package unlimited branches enforcement
**Labels:** `feature` `backend`
**Priority:** P0

Update branch limit enforcement so Enterprise package tenants have unlimited branch creation while non-Enterprise plans still enforce `maxBranches`.

**Acceptance Criteria:**
- [ ] Enterprise tenants bypass branch cap checks
- [ ] Non-Enterprise tenants still receive limit errors as configured
- [ ] Branch creation audit includes plan context used for decision

---

### Issue #56 — Tenant context feature store for AI inputs
**Labels:** `feature` `backend`
**Priority:** P0

Build a tenant-scoped feature aggregation layer for AI input signals (sales, products, stock movement, expenses, branch performance) with cached snapshots for efficient inference.

**Acceptance Criteria:**
- [ ] Feature snapshots are tenant-isolated
- [ ] Snapshot includes branch and product granularity
- [ ] Snapshot freshness metadata is stored and exposed

---

### Issue #57 — Public and platform signal ingestion for contextual intelligence
**Labels:** `feature` `backend` `infra`
**Priority:** P1

Implement ingestion and normalization of public signals (seasonality, holidays, macro proxies) and platform-level anonymized benchmarks to complement tenant-local context.

**Acceptance Criteria:**
- [ ] Public data ingestion supports source tagging and validation
- [ ] Platform benchmarks are anonymized and non-identifiable
- [ ] AI services can reference both signal classes in response provenance

---

### Issue #58 — Demand forecast and reorder recommendation service
**Labels:** `feature` `backend`
**Priority:** P0

Create Enterprise AI demand forecasting and reorder recommendation endpoints per product per branch with confidence scores and reason codes.

**Acceptance Criteria:**
- [ ] Returns forecast horizon, suggested reorder quantity, and reorder point
- [ ] Includes confidence and top driver explanations
- [ ] Recommendations are persisted with `modelVersion` and `inputSnapshot`

---

### Issue #59 — Pricing and margin advisor service
**Labels:** `feature` `backend`
**Priority:** P1

Implement pricing guidance endpoint that suggests safe adjustment ranges and projected margin impact using tenant context and contextual signals.

**Acceptance Criteria:**
- [ ] Output provides min/recommended/max adjustment range
- [ ] Output includes projected margin impact before action
- [ ] No automatic price mutation without explicit user action

---

### Issue #60 — Cash-flow forecast and expense risk alerts
**Labels:** `feature` `backend`
**Priority:** P1

Build AI endpoints for short-term cash-flow forecasts and unusual expense growth detection, with actionable risk summaries.

**Acceptance Criteria:**
- [ ] Forecast outputs include inflow/outflow trend and net position projection
- [ ] Risk alerts identify unusual category spikes with severity
- [ ] Alerts are deduplicated and tenant-scoped

---

### Issue #61 — Anomaly detection for sales, expenses, and inventory
**Labels:** `feature` `backend` `security`
**Priority:** P1

Implement anomaly detection service for suspicious discounts, duplicate expenses, inventory shrinkage spikes, and transaction outliers.

**Acceptance Criteria:**
- [ ] Each anomaly includes risk score and reason codes
- [ ] Supports role-aware visibility for sensitive alerts
- [ ] Detection output can be acknowledged/resolved with audit trail

---

### Issue #62 — Branch performance copilot dashboard (Enterprise only)
**Labels:** `feature` `frontend`
**Priority:** P1

Create Enterprise branch performance views showing branch comparisons, bottlenecks, and prioritized improvement actions.

**Acceptance Criteria:**
- [ ] Branch ranking uses standardized metrics (revenue, margin, stock health, expense efficiency)
- [ ] UI supports large branch counts without pagination failures
- [ ] Non-Enterprise tenants cannot access route

---

### Issue #63 — Natural-language Enterprise AI assistant
**Labels:** `feature` `frontend` `backend`
**Priority:** P1

Implement chat-based business assistant for Enterprise users with scoped analytics queries and recommendation summaries.

**Acceptance Criteria:**
- [ ] Responses include source provenance tags (tenant/platform/public)
- [ ] Assistant respects role permissions and tenant scope
- [ ] Unsafe or out-of-scope prompts are rejected with safe guidance

---

### Issue #64 — Recommendation decision workflow and feedback loop
**Labels:** `feature` `frontend` `backend`
**Priority:** P1

Add recommendation lifecycle actions (`accept`, `reject`, `snooze`, `not_relevant`) and capture feedback to improve future recommendation quality.

**Acceptance Criteria:**
- [ ] Recommendation states are persisted with actor and timestamp
- [ ] Feedback is linked to recommendation context for retraining/evaluation
- [ ] Audit logs capture all recommendation decisions

---

### Issue #65 — Enterprise AI observability and quality evaluation
**Labels:** `enhancement` `backend` `infra` `testing`
**Priority:** P2

Add monitoring and evaluation dashboards for forecast error, anomaly precision, recommendation adoption, and API health for Enterprise AI services.

**Acceptance Criteria:**
- [ ] Metrics available per tenant and globally (anonymized where needed)
- [ ] Alerting thresholds configured for service regressions
- [ ] Evaluation jobs are repeatable and documented

---

### Issue #66 — Enterprise AI access and isolation test suite
**Labels:** `testing` `backend` `frontend` `security`
**Priority:** P1

Create automated tests validating Enterprise entitlement gating, tenant isolation, role boundaries, and upgrade-path UX for blocked tenants.

**Acceptance Criteria:**
- [ ] Non-Enterprise access attempts fail with expected responses
- [ ] Enterprise access succeeds for authorized roles
- [ ] Cross-tenant leakage tests pass for all Enterprise AI endpoints

---

## EPIC 5 — Advanced Enterprise Assistant Engine (Milestone 5)

### Issue #67 — Advanced snapshot feature engineering and freshness strategy
**Labels:** `enhancement` `backend` `testing`
**Priority:** P1

Extend tenant snapshot generation with richer operational features: weekday seasonality, discount intensity, stockout days, category margin bands, and branch-level expense quality checks. Add event-triggered refresh strategy for high-impact transactions.

**Acceptance Criteria:**
- [ ] Snapshot includes branch, category, and product derived features required for advanced assistant reasoning
- [ ] Snapshot refresh can be triggered by major sales, stock updates, and expense spikes
- [ ] Snapshot freshness policy is configurable and documented

---

### Issue #68 — Weighted opportunity and risk scoring engine
**Labels:** `feature` `backend` `testing`
**Priority:** P1

Implement deterministic scoring for recommendations using impact, confidence, urgency, and execution feasibility. Produce ranked actions with explicit score breakdown for transparency.

**Acceptance Criteria:**
- [ ] Recommendations include `opportunityScore` and `riskScore` with component breakdown
- [ ] Ranking is deterministic and reproducible for the same input snapshot
- [ ] Scoring behavior is covered by unit tests

---

### Issue #69 — Multi-horizon comparative analytics (7d/30d/rolling)
**Labels:** `feature` `backend` `frontend`
**Priority:** P1

Add comparative analysis windows (last 7d vs prior 7d, last 30d vs prior 30d, rolling trend) across branches and products with explicit change decomposition (volume/price/mix where possible).

**Acceptance Criteria:**
- [ ] API exposes selectable comparison windows and returns normalized deltas
- [ ] Branch and product comparisons are available in a single assistant grounding payload
- [ ] UI can display selected horizon and key comparative deltas

---

### Issue #70 — Deterministic what-if simulation engine
**Labels:** `feature` `backend`
**Priority:** P1

Implement scenario simulation endpoints for pricing, stock transfer, and expense cap strategies. Return projected effects on margin, stockout risk, and net position.

**Acceptance Criteria:**
- [ ] Supports at least three simulation types: price adjustment, stock transfer, expense cap
- [ ] Returns projected delta outputs with assumptions listed
- [ ] Simulation engine is tenant-scoped and role-gated

---

### Issue #71 — Decision outcome attribution and reranking feedback loop
**Labels:** `enhancement` `backend` `testing`
**Priority:** P1

Link recommendation decisions to realized outcomes after 7/14/30 days. Use outcome performance to rerank future recommendations and suppress low-value patterns.

**Acceptance Criteria:**
- [ ] Outcomes are attributed to recommendation IDs and time windows
- [ ] Reranking influences recommendation order based on historical realized impact
- [ ] Failing/low-impact recommendation patterns are automatically down-weighted

---

### Issue #72 — Robust anomaly detection baseline and false-positive control
**Labels:** `enhancement` `backend` `security` `testing`
**Priority:** P1

Upgrade anomaly detection to branch-aware robust baselines (median/MAD, z-score guards) with duplicate-expense similarity rules and confidence bands.

**Acceptance Criteria:**
- [ ] Anomaly detection uses branch-specific baselines
- [ ] Duplicate expense detector uses title/amount/time similarity criteria
- [ ] False-positive rate metric is tracked and reported

---

### Issue #73 — Action plan tracker with ownership and due dates
**Labels:** `feature` `frontend` `backend`
**Priority:** P2

Convert assistant actions into executable tasks with owner, due date, status, and expected impact. Add weekly review views for branch managers and admins.

**Acceptance Criteria:**
- [ ] Assistant outputs can be converted to tracked actions in one click
- [ ] Actions support owner assignment and lifecycle states
- [ ] Weekly review board shows overdue and high-impact items first

---

### Issue #74 — Enterprise Assistant quality KPI dashboard
**Labels:** `enhancement` `backend` `frontend` `infra`
**Priority:** P2

Build quality dashboard for assistant effectiveness: adoption rate, completion rate, realized impact, time-to-decision, and anomaly precision.

**Acceptance Criteria:**
- [ ] KPI endpoints return tenant-level and aggregate metrics
- [ ] Dashboard supports period filter and trend lines
- [ ] Alerts can be configured for quality regressions

---

### Issue #75 — Scheduled refresh and background intelligence jobs
**Labels:** `enhancement` `backend` `infra`
**Priority:** P2

Add background jobs for periodic snapshot recomputation, recommendation precomputation, and stale-context invalidation for high-volume tenants.

**Acceptance Criteria:**
- [ ] Scheduler supports tenant-safe batched execution
- [ ] Jobs are observable with status and duration metrics
- [ ] Retry and dead-letter behavior is documented

---

### Issue #76 — Advanced engine regression and benchmark suite
**Labels:** `testing` `backend` `frontend`
**Priority:** P1

Create regression suite for advanced assistant engine covering score stability, comparative analytics correctness, simulation output sanity, and reranking behavior under fixture datasets.

**Acceptance Criteria:**
- [ ] Deterministic tests validate stable recommendation ordering for fixed fixtures
- [ ] Simulation outputs are validated against expected bounds
- [ ] CI suite blocks regressions in advanced assistant KPI baselines

---

*Total Issues: 76*
*Last updated: Auto-generated by GitHub Copilot*
