# SSO Configuration

StockPilot Pro supports optional Single Sign-On (SSO) via **Google** and **Microsoft** for `BUSINESS_ADMIN` and `SUPER_ADMIN` accounts.

SSO is opt-in and configured at the **tenant level** – each tenant can independently enable or disable SSO, and choose which providers are allowed.

---

## How It Works

1. A `SUPER_ADMIN` or `BUSINESS_ADMIN` enables SSO for the tenant via **Settings → Users → SSO Authentication** (or the Tenants admin panel).
2. Users on the login page enter their email address. If SSO is enabled for their account, provider buttons appear (Google / Microsoft).
3. Clicking a button redirects through the OAuth2 Authorization Code flow, handled entirely on the API side.
4. On success the API creates a session (JWT) and redirects the user back to the frontend dashboard.

> SSO is **only available** for `BUSINESS_ADMIN` and `SUPER_ADMIN` roles. `SALESPERSON` accounts must use password-based login.

---

## Required Environment Variables (API)

Add these to `apps/api/.env`:

```bash
# ── API Base URL (used to build OAuth redirect URIs) ─────────────────────────
API_BASE_URL=https://api.yourdomain.com   # or http://localhost:3000 for local dev

# ── Google OAuth2 ─────────────────────────────────────────────────────────────
# Create a project at https://console.developers.google.com/
# Add an OAuth 2.0 credential of type "Web application"
# Authorised redirect URI: ${API_BASE_URL}/api/auth/sso/google/callback
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# ── Microsoft OAuth2 ──────────────────────────────────────────────────────────
# Register an app at https://portal.azure.com/ → Azure Active Directory → App registrations
# Redirect URI: ${API_BASE_URL}/api/auth/sso/microsoft/callback
# Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
MICROSOFT_CLIENT_ID=your-azure-application-client-id
MICROSOFT_CLIENT_SECRET=your-azure-client-secret

# ── Frontend Origin (already required, used for post-SSO redirect) ────────────
ALLOWED_ORIGIN=https://app.yourdomain.com   # or http://localhost:5173 for local dev
```

---

## Client Environment Variables

```bash
# apps/client/.env
VITE_API_URL=https://api.yourdomain.com/api   # or http://localhost:3000/api for local dev
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/sso-check` | Check if SSO is available for an email (public) |
| `GET` | `/api/auth/sso/:provider` | Initiate OAuth2 flow (`provider` = `google` or `microsoft`) |
| `GET` | `/api/auth/sso/:provider/callback` | OAuth2 callback (called by provider) |
| `GET` | `/api/tenants/:id/sso` | Get SSO settings for a tenant (BUSINESS_ADMIN / SUPER_ADMIN) |
| `PATCH` | `/api/tenants/:id/sso` | Update SSO settings for a tenant (BUSINESS_ADMIN / SUPER_ADMIN) |

### PATCH `/api/tenants/:id/sso` payload

```json
{
  "ssoEnabled": true,
  "ssoProviders": ["google", "microsoft"]
}
```

---

## Database Migration

After pulling these changes, run the Prisma migration:

```bash
cd apps/api
npx prisma migrate dev --name add-sso-support
```

This adds:
- `ssoEnabled` (boolean, default `false`) to the `Tenant` table
- `ssoProviders` (JSON array, default `[]`) to the `Tenant` table
- A new `SsoAccount` table that links users to their OAuth identities
- `password` field on `User` is now nullable (to support SSO-only accounts in future)
