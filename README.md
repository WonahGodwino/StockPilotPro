# StockPilot Pro

> **Enterprise Stock & Financial Management System** — Multi-tenant, subscription-based, offline-first.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React + TypeScript + Tailwind CSS |
| State | Zustand |
| Offline | Dexie.js (IndexedDB) + Service Workers |
| Backend | Next.js 14 (App Router + API Routes) |
| ORM | Prisma |
| Database | PostgreSQL |
| Cache | Redis |
| Auth | JWT (access + refresh tokens) |
| Real-time | WebSockets |

---

## Project Structure

```
StockPilotPro/
├── apps/
│   ├── api/          ← Next.js backend (API routes + Prisma)
│   └── client/       ← Vite + React frontend
├── docs/
│   └── GITHUB_ISSUES.md
├── .env.example
├── package.json
└── README.md
```

---

## Quick Start

### Prerequisites
- Node.js >= 18
- PostgreSQL >= 14
- Redis (optional but recommended)

### 1. Clone & Install

```bash
git clone <repo-url>
cd StockPilotPro
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

---

## Default Seed Credentials

After running `npm run db:seed`:

| Role | Email | Password |
|---|---|---|
| Super Admin | `superadmin@stockpilot.pro` | `SuperAdmin@123` |
| Business Admin | `admin@demo.com` | `Admin@123` |
| Salesperson | `sales@demo.com` | `Sales@123` |

---

## Deployment

- API: Vercel / Railway / Render / AWS
- Client: Vercel / Netlify / Cloudflare Pages
- Database: Neon / Supabase / RDS

---

## License

MIT © StockPilot Pro
