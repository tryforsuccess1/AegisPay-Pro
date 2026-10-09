# AegisPay

AegisPay uses one canonical production client/admin web stack with Supabase as the backend.

## Canonical architecture

- Client portal source: `client.html`
- Master Admin source: `master-admin.html`
- Client runtime: root `client.html` (self-contained)
- Master Admin/runtime helpers: `admin-auth.js`, `supabase-client.js`, `supabase-service.js`, `aegis-auth-redirect.js`, `app-update.js`
- Admin/shared UI assets: `shop-catalog.js`, `aegispay-logo.svg`, `manifest.webmanifest`, `service-worker.js`
- Public website source: `site/index.html` + `site/site.css`
- Cloudflare Pages publish package: generated at deploy time under `site/`
- Android source: `android/`; the client flavor bundles `client.html` and shared root web assets
- Database change tracking: `database/migrations/`
- Supabase Edge Functions: `supabase/functions/`

## Production routes

- Public website: `/`
- Client portal: `/app/`
- Master Admin: `/admin/`
- Client APK: `/downloads/aegispay-client.apk`

The `site/` portal copies are deployment artifacts. They are never independent application sources.

## Backend

Supabase project: `wtcspnrmsoisroavojop`.

The current project is running in a controlled PRE_PRODUCTION / LIVE_DEPOSIT_TEST state. Real payouts remain disabled behind the Phase 3 server-side production gate. Financial state changes stay behind Supabase RPCs/Edge Functions and authenticated role checks. Deposit evidence is stored in the private `private-verification` bucket.

## Verification

Run:

```
npm run check
```

The check validates the canonical client/admin source files, Supabase function wiring, storage migration tracking, Android source alignment, and Cloudflare Pages deployment wiring.

## Security

Never put service-role keys, payout private keys, Telegram bot secrets, AI provider keys, or release keystore material in browser assets or Cloudflare Pages client variables.

## Branch policy

`main` is the only production source of truth. Experimental branches are not production sources. Any future UI or business change must start from and return to `main`.

## Canonical production baseline

- Production branch: `main`
- Client portal: `/app/` from root `client.html`
- Master Admin: `/admin/` from root `master-admin.html`
- Cloudflare Pages: `aegispay-pro`
- Supabase: `wtcspnrmsoisroavojop`
- Android current baseline: versionCode 38 / versionName 2.5.9
