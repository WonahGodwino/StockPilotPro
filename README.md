# StockPilot Pro

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/Node.js->=18-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)

> **Enterprise-Grade Stock & Financial Management System** — Multi-tenant SaaS platform with role-based access control, comprehensive audit logging, distributed rate limiting, and offline-first PWA capabilities.

---

## 📋 Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Security & Compliance](#security--compliance)
- [Quick Start](#quick-start)
- [Development](#development)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [GitHub Copilot Guidelines](#github-copilot-guidelines)
- [Contributing](#contributing)
- [License](#license)

---

## 🎯 Project Overview

**StockPilot Pro** is a comprehensive, enterprise-ready financial and inventory management system designed for multi-tenant SaaS deployments. It combines a modern React frontend with a robust Next.js API backend, featuring:

- **Multi-Tenant Architecture**: Complete data isolation with per-tenant service subscriptions
- **Role-Based Access Control (RBAC)**: Fine-grained permission system with role hierarchy (SUPER_ADMIN → BUSINESS_ADMIN → SALESPERSON)
- **Distributed Rate Limiting**: Redis-backed throttling with in-memory fallback for API protection
- **Auth Lockout Policy**: Account and IP-based failure tracking to prevent brute-force attacks
- **Comprehensive Audit Logging**: All mutations tracked with before/after old/new value snapshots
- **Offline-First PWA**: IndexedDB + Service Workers for seamless offline operation
- **Real-Time Collaboration**: WebSocket support for live updates across distributed teams

---

## ✨ Key Features

### Security & Access Control
- **RBAC Matrix** — Role-based permission enforcement on all mutation endpoints
- **JWT Authentication** — Stateless access + refresh token flow with configurable expiry
- **Account Lockout Policy** — Configurable thresholds for account/IP-based rate limiting
- **Distributed Rate Limiting** — Redis-backed with graceful in-memory fallback
- **Audit Trail** — Complete mutation history with changed values and request metadata

### Business Logic
- **Product Management** — GOODS/SERVICE types, pricing, stock tracking, barcode support
- **Sales/POS** — Invoice generation, payment methods (CASH/TRANSFER/POS), discounts
- **Expense Tracking** — Multi-category expense budgeting with approval workflows
- **Financial Reports** — Profit/loss, COGS, revenue trends, low-stock alerts
- **Subsidiary Management** — Multi-location support with centralized control
- **Subscription Billing** — Tiered plans with per-subsidiary pricing

### User Experience
- **Responsive Design** — Mobile-first UI with Tailwind CSS + dark mode support
- **Lazy-Loaded Routes** — Performance-optimized with code splitting and Suspense boundaries
- **Offline Support** — IndexedDB synchronization + Service Worker caching
- **Real-Time Notifications** — WebSocket-based push notifications
- **Grouped Navigation** — Collapsible sidebar sections (General, Operations, Management, Super Admin)

---

## 🏗️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Vite + React 18 + TypeScript | Component-based UI with hot module reload |
| **State Management** | Zustand | Lightweight, persistence-capable store |
| **Styling** | Tailwind CSS + Lucide Icons | Utility-first CSS + professional icons |
| **Offline First** | Dexie.js + Service Workers | IndexedDB sync + PWA caching |
| **API Client** | Axios + React Router (v6) | HTTP + client-side routing |
| **Backend** | Next.js 14 (App Router + API Routes) | Unified framework with edge runtime support |
| **ORM** | Prisma + PostgreSQL | Type-safe database access |
| **Cache** | Redis (ioredis) | Distributed rate limiting + session data |
| **Authentication** | JWT (jsonwebtoken + bcryptjs) | Stateless auth with secure password hashing |
| **Real-Time** | WebSockets (ws) | Live notifications and collaborative features |
| **Testing** | ts-node + Custom test runners | RBAC regression testing (see `tests/rbac.spec.ts`) |

---

## 🏛️ Architecture

### Monorepo Workspace Structure

```
StockPilotPro (root)
├─ package.json                          (workspace config + build scripts)
├─ apps/
│  ├─ api/                               (Next.js API backend)
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  │  ├─ api/
│  │  │  │  │  ├─ auth/                  (JWT login/logout/refresh)
│  │  │  │  │  ├─ users/                 (RBAC-enforced user CRUD)
│  │  │  │  │  ├─ products/              (Product management + audit)
│  │  │  │  │  ├─ sales/                 (POS/invoice + audit)
│  │  │  │  │  ├─ expenses/              (Expense tracking + audit)
│  │  │  │  │  ├─ subscriptions/         (Billing + audit)
│  │  │  │  │  ├─ plans/                 (Super-admin tier management)
│  │  │  │  │  ├─ tenants/               (Multi-tenant setup)
│  │  │  │  │  ├─ subsidiaries/          (Location management)
│  │  │  │  │  └─ notifications/         (Real-time alerts)
│  │  │  │  ├─ api/reports/              (Analytics & dashboards)
│  │  │  │  └─ layout.tsx                (Root layout)
│  │  │  ├─ lib/
│  │  │  │  ├─ rbac.ts                   (Core permission engine)
│  │  │  │  ├─ rate-limit.ts             (Distributed throttling + lockout)
│  │  │  │  ├─ redis.ts                  (Redis client wrapper)
│  │  │  │  ├─ audit.ts                  (Mutation tracking)
│  │  │  │  ├─ auth.ts                   (JWT helpers + IP extraction)
│  │  │  │  ├─ jwt.ts                    (Token generation/verification)
│  │  │  │  ├─ prisma.ts                 (ORM singleton)
│  │  │  │  └─ helpers.ts                (Utility functions)
│  │  │  ├─ prisma/
│  │  │  │  ├─ schema.prisma             (Database models)
│  │  │  │  └─ seed.ts                   (Development data)
│  │  │  └─ tests/
│  │  │     ├─ rbac.spec.ts              (RBAC regression tests)
│  │  │     └─ tsconfig.json             (Test-specific config)
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ next.config.mjs
│  │
│  └─ client/                             (Vite + React frontend)
│     ├─ src/
│     │  ├─ pages/                        (Route-specific page components)
│     │  │  ├─ Dashboard.tsx
│     │  │  ├─ Products.tsx
│     │  │  ├─ Sales.tsx
│     │  │  ├─ Expenses.tsx
│     │  │  ├─ Reports.tsx
│     │  │  ├─ Users.tsx
│     │  │  ├─ Subsidiaries.tsx
│     │  │  ├─ Notifications.tsx
│     │  │  └─ superadmin/
│     │  │     ├─ Tenants.tsx
│     │  │     └─ Plans.tsx
│     │  ├─ components/
│     │  │  ├─ layout/
│     │  │  │  ├─ Sidebar.tsx             (Grouped navigation + role-based items)
│     │  │  │  ├─ Header.tsx              (User info + notifications icon)
│     │  │  │  └─ AppLayout.tsx           (Main layout wrapper)
│     │  │  ├─ products/
│     │  │  │  └─ ProductModal.tsx
│     │  │  ├─ sales/
│     │  │  │  └─ Receipt.tsx             (Invoice printing component)
│     │  │  └─ expenses/
│     │  │     └─ ExpenseModal.tsx
│     │  ├─ store/
│     │  │  ├─ auth.store.ts              (Auth state + persistence)
│     │  │  ├─ app.store.ts               (UI state + sidebar toggle)
│     │  │  └─ cart.store.ts              (Shopping cart with offline sync)
│     │  ├─ lib/
│     │  │  ├─ api.ts                     (Axios instance + interceptors)
│     │  │  ├─ db.ts                      (Dexie.js local store)
│     │  │  └─ sync.ts                    (Offline-to-online reconciliation)
│     │  ├─ types/
│     │  │  └─ index.ts                   (TypeScript types & interfaces)
│     │  ├─ App.tsx                       (Main app with route setup + lazy loading)
│     │  └─ main.tsx
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vite.config.ts
│     ├─ tailwind.config.ts
│     └─ index.html
│
├─ docs/
│  ├─ GITHUB_ISSUES.md                   (All tracked issues with descriptions)
│  └─ MILESTONE_BOARD.md                 (Milestone/epic roadmap)
│
├─ scripts/
│  └─ sync_github_issues.ps1              (Issue creation automation)
│
└─ README.md                              (this file)
```

### Authentication Flow

```
Client (Login Page)
    ↓
POST /api/auth/login (credentials)
    ↓
Backend: bcryptjs verify + rate-limit check
    ↓
Generate JWT (access + refresh tokens)
    ↓
Store in auth store (Zustand) + localStorage
    ↓
Redirect to /dashboard
    │
    ├─→ Axios interceptor adds `Authorization: Bearer <token>`
    │
    ├─→ Token expires → Auto-refresh via POST /api/auth/refresh
    │
    └─→ Invalid/expired → Redirect to /login
```

### RBAC Architecture

```
Role Hierarchy:
  SUPER_ADMIN (all permissions)
      ↓
  BUSINESS_ADMIN (tenant-level permissions)
      ↓
  SALESPERSON (limited transaction permissions)
```

**Key Implementation Files:**
- `apps/api/src/lib/rbac.ts` — Permission matrix definition + guard function
- All mutation endpoints (`POST/PUT/DELETE`) validate permissions before execution
- Example: `apps/api/src/app/api/users/route.ts` checks `hasPermission('users:write')`

### Rate Limiting & Auth Lockout

```
LOGIN ATTEMPT
    ↓
Check IP/Account failures (Redis or in-memory)
    ↓
Threshold exceeded? → Return 429 (Too Many Requests)
    ↓
Valid credentials? → Generate tokens + clear failure count
    ↓
Invalid credentials? → Increment failure + lockout entry
    ↓
Lockout expires after AUTH_LOCKOUT_DURATION_MS
```

**Configuration (`.env.example`):**
- `AUTH_LOCKOUT_ACCOUNT_THRESHOLD=5` — Max failures per account
- `AUTH_LOCKOUT_IP_THRESHOLD=20` — Max failures per IP
- `AUTH_LOCKOUT_WINDOW_MS=900000` — Tracking window (15 min)
- `AUTH_LOCKOUT_DURATION_MS=1800000` — Lockout duration (30 min)

### Audit Logging System

**Every mutation endpoint logs changes:**
```typescript
// Example from /api/products/route.ts (POST)
await auditLog.log({
  action: 'CREATE',
  entity: 'Product',
  entityId: newProduct.id,
  userId: user.id,
  tenantId: user.tenantId,
  oldValues: {},
  newValues: newProduct,
  metadata: { ip, userAgent },
})
```

**Audited Endpoints:**
- Users: POST/PUT/DELETE
- Products: POST/PUT/DELETE
- Sales: POST/PUT/DELETE
- Expenses: POST/PUT/DELETE
- Subscriptions: POST/PUT/DELETE
- Plans: POST/PUT/DELETE
- Tenants: POST/PUT/DELETE
- Subsidiaries: POST/PUT/DELETE

---

## 📁 Project Structure

```
StockPilotPro/
├── apps/
│   ├── api/          ← Next.js backend with Prisma ORM
│   └── client/       ← Vite + React 18 + TypeScript frontend
├── docs/
│   ├── GITHUB_ISSUES.md     (Issue backlog)
│   └── MILESTONE_BOARD.md   (Roadmap)
├── scripts/
│   └── sync_github_issues.ps1
├── .env.example           (Root environment template)
├── .gitignore
├── package.json           (Workspace root)
└── README.md
```

---

## 🔒 Security & Compliance

### Authentication & Authorization
- **JWT-Based Auth**: 15-minute access tokens + 7-day refresh tokens
- **Password Hashing**: bcryptjs with salt rounds (10)
- **RBAC Enforcement**: All endpoints validate user permissions before execution
- **Token Refresh**: Automatic silent refresh with expiry-aware retry logic

### Rate Limiting & DDoS Protection
- **Distributed Rate Limiting**: Redis-backed with configurable thresholds
- **Account Lockout**: Per-account brute-force protection
- **IP-Based Throttling**: Per-IP request rate limiting
- **In-Memory Fallback**: Auto-degrades to memory-based limits if Redis unavailable

### Audit & Compliance
- **Complete Mutation Audit**: Every POST/PUT/DELETE captured with old/new values
- **Request Metadata**: IP address, User-Agent, timestamp, user ID
- **Data Retention**: All audit logs persisted in PostgreSQL (`AuditLog` table)
- **Tenant Isolation**: Data strictly isolated at database level

### Environment Security
- **Secrets Management**: All sensitive values in `.env` (git-ignored)
- **Configuration Validation**: Zod schemas for safe environment parsing
- **No Hardcoded Credentials**: All connection strings from environment

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** >= 18 (with npm or yarn)
- **PostgreSQL** >= 14 (local or remote)
- **Redis** (optional but recommended; uses in-memory fallback)
- **Git** (for version control)

### 1. Clone Repository

```bash
git clone https://github.com/WonahGodwino/StockPilotPro.git
cd StockPilotPro
npm install --legacy-peer-deps
```

### 2. Environment Setup

```bash
# Root environment
cp .env.example .env

# API environment
cp apps/api/.env.example apps/api/.env

# Client environment
cp apps/client/.env.example apps/client/.env
```

**Edit `.env` files with your configuration:**
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection (optional)
- `JWT_SECRET` — Strong random secret (min 32 chars)
- `JWT_REFRESH_SECRET` — Different strong secret
- `AUTH_LOCKOUT_*` — Adjust thresholds as needed

### 3. Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed development data (optional)
npm run db:seed

# Open Prisma Studio for data browsing
npm run db:studio
```

### 4. Start Development Servers

```bash
# Both API (port 3000) and Client (port 5173)
npm run dev

# Or individually:
npm run dev --workspace=apps/api      # API only
npm run dev --workspace=apps/client   # Client only
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 💻 Development

### Available Scripts

```bash
# Root level
npm run dev              # Start both API + Client dev servers
npm run build            # Build both API + Client for production
npm run lint             # Lint all workspaces

# API workspace
npm run dev              # Next.js dev server (port 3000)
npm run build            # Production build
npm run start            # Run production server
npm run test:rbac        # RBAC regression tests
npm run db:migrate       # Prisma migrations
npm run db:seed          # Seed database
npm run db:studio        # Prisma Studio UI

# Client workspace
npm run dev              # Vite dev server (port 5173)
npm run build            # Production build
npm run preview          # Preview production build
npm run lint             # ESLint check
```

### Running Tests

```bash
# RBAC matrix tests
npm run test:rbac

# Expected output:
# ✓ SUPER_ADMIN has all permissions
# ✓ BUSINESS_ADMIN has management permissions
# ✓ SALESPERSON has limited transaction permissions
# ✓ Unauthorized roles denied appropriately
```

### Code Quality

- **TypeScript**: Strict mode enabled
- **ESLint**: Enforced on client and API
- **Prettier**: Consistent formatting (configured in workspace)
- **Prisma Formatting**: Automatic schema formatting

---

## 📡 API Reference

### Authentication Endpoints

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}

// Response (200 OK)
{
  "accessToken": "jwt...",
  "refreshToken": "jwt...",
  "user": {
    "id": "...",
    "email": "...",
    "firstName": "...",
    "lastName": "...",
    "role": "BUSINESS_ADMIN",
    "tenantId": "...",
    "subsidiaryId": "..."
  }
}
```

#### Refresh Token
```http
POST /api/auth/refresh
Content-Type: application/json

{ "refreshToken": "jwt..." }

// Response (200 OK)
{ "accessToken": "jwt...", "refreshToken": "jwt..." }
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "refreshToken": "jwt..." }

// Response (200 OK)
{ "message": "Logged out successfully" }
```

### User Management Endpoints

#### List Users (BUSINESS_ADMIN only)
```http
GET /api/users?page=1&limit=20
Authorization: Bearer <accessToken>

// Response (200 OK)
{
  "data": [
    {
      "id": "...",
      "email": "...",
      "firstName": "...",
      "lastName": "...",
      "role": "SALESPERSON"
    }
  ],
  "total": 42
}
```

#### Create User (SUPER_ADMIN or BUSINESS_ADMIN)
```http
POST /api/users
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "email": "newuser@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "password": "securepassword",
  "role": "SALESPERSON"
}

// Response (201 Created)
{ "id": "...", "email": "...", ... }
```

#### Update User (SUPER_ADMIN or BUSINESS_ADMIN)
```http
PUT /api/users/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "firstName": "Jane", "role": "BUSINESS_ADMIN" }

// Response (200 OK)
{ "message": "User updated", "user": {...} }
```

#### Delete User (SUPER_ADMIN only)
```http
DELETE /api/users/:id
Authorization: Bearer <accessToken>

// Response (200 OK)
{ "message": "User deleted" }
```

### Product Management

#### List Products
```http
GET /api/products?page=1&limit=50&status=ACTIVE
Authorization: Bearer <accessToken>

// Response
{
  "data": [
    {
      "id": "...",
      "name": "Product A",
      "type": "GOODS",
      "sellingPrice": 100,
      "quantity": 50,
      "status": "ACTIVE"
    }
  ],
  "total": 120
}
```

#### Create Product
```http
POST /api/products
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "New Product",
  "type": "GOODS",
  "unit": "pcs",
  "costPrice": 50,
  "sellingPrice": 100,
  "lowStockThreshold": 10,
  "barcode": "1234567890"
}

// Response (201 Created)
{ "id": "...", "name": "New Product", ... }
```

### Sales/POS Endpoints

#### Create Sale
```http
POST /api/sales
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "items": [
    { "productId": "...", "quantity": 2, "unitPrice": 100, "discount": 0 }
  ],
  "totalAmount": 200,
  "amountPaid": 200,
  "paymentMethod": "CASH",
  "notes": "Sale notes"
}

// Response (201 Created)
{
  "id": "...",
  "receiptNumber": "RCV-20260331-001",
  "totalAmount": 200,
  "items": [...]
}
```

#### Get Reports/Dashboard
```http
GET /api/reports/dashboard
Authorization: Bearer <accessToken>

// Response
{
  "salesThisMonth": 15000,
  "expensesThisMonth": 5000,
  "grossProfit": 8000,
  "netProfit": 3000,
  "salesTrend": [ { "date": "2026-03-31", "total": 500 }, ... ]
}
```

---

## 🗄️ Database Schema

### Core Models

**Users**
```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  password      String
  firstName     String
  lastName      String
  role          String    // SUPER_ADMIN | BUSINESS_ADMIN | SALESPERSON
  tenantId      String?
  subsidiaryId  String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  tenant        Tenant?   @relation(fields: [tenantId], references: [id])
  subsidiary    Subsidiary? @relation(fields: [subsidiaryId], references: [id])
}
```

**Tenants**
```prisma
model Tenant {
  id            String    @id @default(cuid())
  name          String
  slug          String    @unique
  email         String
  phone         String?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  
  users         User[]
  subsidiaries  Subsidiary[]
  subscriptions Subscription[]
  auditLogs     AuditLog[]
}
```

**Products**
```prisma
model Product {
  id                String   @id @default(cuid())
  tenantId          String
  name              String
  type              String   // GOODS | SERVICE
  description       String?
  unit              String
  quantity          Int      @default(0)
  costPrice         Float
  sellingPrice      Float
  barcode           String?  @unique
  lowStockThreshold Int      @default(0)
  status            String   // ACTIVE | DRAFT | ARCHIVED
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

**Sales**
```prisma
model Sale {
  id              String    @id @default(cuid())
  tenantId        String
  userId          String
  totalAmount     Float
  discount        Float     @default(0)
  amountPaid      Float
  paymentMethod   String    // CASH | TRANSFER | POS
  receiptNumber   String    @unique
  notes           String?
  createdAt       DateTime  @default(now())
  
  items           SaleItem[]
}
```

**AuditLog** (comprehensive mutation tracking)
```prisma
model AuditLog {
  id              String   @id @default(cuid())
  tenantId        String
  userId          String?
  action          String   // CREATE | UPDATE | DELETE
  entity          String   // Product | User | Sale
  entityId        String
  oldValues       Json?
  newValues       Json?
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime @default(now())
  
  tenant          Tenant   @relation(fields: [tenantId], references: [id])
}
```

*See `apps/api/prisma/schema.prisma` for complete schema.*

---

## 🌐 Deployment

### Production Build

```bash
# Build both API and Client
npm run build

# Outputs:
# - apps/api/.next         (Next.js production build)
# - apps/client/dist       (Vite production bundle)
```

### Docker Support (Optional)

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000 5173

CMD ["npm", "run", "dev"]
```

### Environment Variables for Production

```bash
NODE_ENV=production
DATABASE_URL=postgresql://prod-user:prod-pass@prod-host:5432/stockpilot
REDIS_URL=redis://prod-redis-host:6379
JWT_SECRET=<generate-strong-random-secret>
JWT_REFRESH_SECRET=<generate-strong-random-secret>
NEXT_PUBLIC_APP_URL=https://app.stockpilot.io
VITE_API_URL=https://api.stockpilot.io
```

---

## 🤖 GitHub Copilot Guidelines

*This section helps GitHub Copilot understand the project structure and contribute effectively.*

### Project Context

**StockPilot Pro** is a **multi-tenant, subscription-based SaaS** managing inventory, sales, and finances for small-to-medium businesses. Every feature must respect:

1. **Data Isolation**: All data filtered by `tenantId` (no cross-tenant leakage)
2. **RBAC Enforcement**: Permission checks before every mutation
3. **Audit Trail**: Every change logged with old/new values
4. **Rate Limiting**: API protection against abuse

### Code Patterns

#### Adding a New Mutation Endpoint

When creating a new `POST`, `PUT`, or `DELETE` endpoint:

```typescript
// apps/api/src/app/api/[resource]/route.ts
import { isAuthenticatedUser, hasPermission } from '@/lib/rbac'
import { auditLog } from '@/lib/audit'

export async function POST(req: Request) {
  // 1. Extract user from JWT
  const user = await isAuthenticatedUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Check permission
  if (!hasPermission(user.role, 'resource:write')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Extract and validate body
  const body = await req.json()
  // ... validation with zod ...

  // 4. Execute database mutation
  const created = await prisma.resource.create({
    data: { ...body, tenantId: user.tenantId },
  })

  // 5. Log to audit trail
  await auditLog.log({
    action: 'CREATE',
    entity: 'Resource',
    entityId: created.id,
    userId: user.id,
    tenantId: user.tenantId,
    oldValues: {},
    newValues: created,
    metadata: { ip: getClientIp(req), userAgent: req.headers.get('user-agent') },
  })

  // 6. Return response
  return Response.json(created, { status: 201 })
}
```

#### Adding a New Frontend Page

When adding a new page component:

```typescript
// apps/client/src/pages/NewFeature.tsx
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import { useState, useEffect } from 'react'

export default function NewFeature() {
  const user = useAuthStore((s) => s.user)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    api.get('/api/resource')
      .then((r) => setData(r.data.data))
      .catch((e) => console.error('Failed to load:', e))
      .finally(() => setLoading(false))
  }, [user])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">New Feature</h1>
      {/* Content */}
    </div>
  )
}
```

### Testing Guidelines

When writing tests for RBAC or business logic:

```typescript
// apps/api/tests/feature.spec.ts
import { hasPermission } from '@/lib/rbac'

describe('Feature Authorization', () => {
  it('SUPER_ADMIN should have full access', () => {
    expect(hasPermission('SUPER_ADMIN', 'resource:write')).toBe(true)
  })

  it('SALESPERSON should have limited access', () => {
    expect(hasPermission('SALESPERSON', 'users:write')).toBe(false)
  })

  it('Unauthorized roles should be denied', () => {
    expect(() => {
      hasPermission('INVALID_ROLE', 'resource:read')
    }).toThrow()
  })
})
```

### Common Issues & Solutions

| Issue | Solution |
|---|---|
| `tenantId` missing in response | Always filter queries with `.where({ tenantId: user.tenantId })` |
| Permission denied errors | Check RBAC matrix in `libs/rbac.ts`; ensure permission string exists |
| Rate limit errors in dev | Adjust `AUTH_LOCKOUT_ACCOUNT_THRESHOLD` in `.env`; or clear Redis cache |
| Audit logs missing | Verify `auditLog.log()` called in mutation endpoints |
| Offline sync conflicts | Check `apps/client/src/lib/sync.ts` for conflict resolution logic |

### Performance Considerations

- **Lazy Load Routes**: Use `lazy()` + `Suspense` in `apps/client/src/App.tsx`
- **API Pagination**: Always include `?page=1&limit=20` in list endpoints
- **Caching**: Leverage Zustand stores for frequently accessed data
- **Database Indexes**: Ensure `tenantId` + `id` indexed for fast filtered queries
- **WebSocket Optimization**: Only open connection when needed; close on unmount

### Security Checklist

Before merging a new feature:

- ✅ User authentication required (no public endpoints except `/login`)
- ✅ RBAC permission checked (using `hasPermission()`)
- ✅ `tenantId` validation (user's tenant matches resource's tenant)
- ✅ Audit logging implemented (for all mutations)
- ✅ Input validation (Zod schema)
- ✅ SQL injection prevention (Prisma ORM)
- ✅ Rate limiting applied (if auth-related)
- ✅ Error messages don't leak sensitive info

---

## 📝 Contributing

### Development Workflow

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Follow existing code style and patterns
   - Update types/schemas as needed
   - Add tests for business logic

3. **Test Locally**
   ```bash
   npm run build          # Verify production build
   npm run test:rbac      # Run RBAC tests
   npm run lint           # Lint all code
   ```

4. **Commit & Push**
   ```bash
   git add .
   git commit -m "feat: descriptive message"
   git push origin feature/your-feature-name
   ```

5. **Open Pull Request**
   - Reference related issues
   - Describe changes and rationale
   - Include screenshots for UI changes

### Issue Labels

- `feature` — New functionality
- `bug` — Defect or error
- `security` — Security vulnerability
- `performance` — Performance optimization
- `refactor` — Code restructuring
- `documentation` — Docs improvements
- `M1 MVP` — Must complete for initial release
- `M2 Hardening` — Security/stability enhancements
- `M3 Polish` — UX/performance refinements

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](./LICENSE) file for details.

---

## 📞 Support

For questions, issues, or collaborations:

- **GitHub Issues**: [Report bugs](https://github.com/WonahGodwino/StockPilotPro/issues)
- **Email**: support@stockpilot.io (placeholder)
- **Documentation**: See `docs/` folder for detailed guides

---

**Built with ❤️ for modern business operations.**
npm install
```

### 2. Environment Setup

```bash
cp .env.example apps/api/.env
cp .env.example apps/client/.env
# Edit both files with your actual values
```

### 3. Database Setup

```bash
cd apps/api
npx prisma migrate dev --name init
npm run db:seed
```

### 4. Run Development Servers

```bash
# From root
npm run dev
# API runs on http://localhost:3000
# Client runs on http://localhost:5173
```

---

## User Roles

| Role | Access |
|---|---|
| `SUPER_ADMIN` | Manage all tenants, plans, billing |
| `BUSINESS_ADMIN` | Full access to own tenant |
| `SALESPERSON` | Create sales, manage products (no financials) |

---

## Key Features

- **Multi-Tenant**: Full data isolation per business via `tenant_id`
- **Subscription Plans**: Annual billing, per-subsidiary pricing
- **POS System**: Barcode scan, cart, receipt generation
- **Financial Reports**: Daily/Monthly/Quarterly/Custom range P&L
- **Offline-First**: IndexedDB sync when back online
- **Real-time Alerts**: WebSocket low-stock notifications
- **Audit Trail**: All records track `created_by`, `updated_by`, `archived`

---

## API Endpoints

```
POST   /api/auth/login
POST   /api/auth/register
POST   /api/auth/refresh
POST   /api/auth/logout

GET    /api/tenants
POST   /api/tenants
GET    /api/tenants/:id

GET    /api/subsidiaries
POST   /api/subsidiaries
PUT    /api/subsidiaries/:id
DELETE /api/subsidiaries/:id

GET    /api/products
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

GET    /api/sales
POST   /api/sales
GET    /api/sales/:id

GET    /api/expenses
POST   /api/expenses
PUT    /api/expenses/:id

GET    /api/reports
GET    /api/reports/dashboard

GET    /api/plans
POST   /api/plans

GET    /api/subscriptions
POST   /api/subscriptions
PUT    /api/subscriptions/:id

GET    /api/notifications
PUT    /api/notifications/:id/read

GET    /api/users
POST   /api/users
```

## Deployment

- API: Vercel / Railway / Render / AWS
- Client: Vercel / Netlify / Cloudflare Pages
- Database: Neon / Supabase / RDS

---

## License

MIT © StockPilot Pro
