# Changelog

## 2026-04-02 - Subscription Renewal, Payments, and Audit Hardening

### Added
- End-to-end subscription transaction lifecycle for NEW, RENEW, and UPGRADE flows.
- Tenant admin renewal/upgrade initiation from Settings with payment method choice.
- Super-admin initiation and verification controls on tenant management screens.
- Super-admin subscription transaction ledger page with filters and CSV export.
- Paystack payment initialization and verification endpoints.
- Paystack webhook endpoint for automatic payment confirmation and activation.

### Data and Audit Enhancements
- Added `SubscriptionTransaction` audit fields to capture lifecycle actions and actor traces.
- Added transfer proof metadata persisted to database:
  - `transferProofOriginalName`
  - `transferProofSize`
  - `transferProofContentType`
  - `transferProofUploadedByUserId`
  - `transferProofUploadedAt`
- Added uploader relation for stricter transaction-level proof accountability.

### File Upload and Storage
- Added authenticated transfer proof upload endpoint.
- Proof files stored under `apps/api/public/uploads/subscription-proofs`.
- Added upload folder tracking via `.gitkeep` and ignore rule for uploaded binaries.

### Configuration
- Added Paystack env placeholders in `apps/api/.env.example`:
  - `PAYSTACK_SECRET_KEY`
  - `PAYSTACK_WEBHOOK_SECRET`
  - `PAYSTACK_CALLBACK_URL`

### Validation
- API build and client build pass.
- Migration(s) applied and Prisma client regenerated.
- Smoke checks passed for transfer-proof upload, transaction creation, and transaction CSV export.
