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

The current `production_config` is `PRE_PRODUCTION`: live deposits are disabled, real payouts are disabled, and the payout lock is closed. `deposit_rules` still references the TRON Mainnet USDT contract, but the production gate remains closed. New HD wallet endpoints are fail-closed until their server-side secrets and readiness checks are satisfied. Financial state changes stay behind Supabase RPCs/Edge Functions and authenticated role checks. Deposit evidence is stored in the private `private-verification` bucket.

## Verification

Run:

```
npm run check
```

The check validates the canonical client/admin source files, Supabase function wiring, storage migration tracking, Android source alignment, and Cloudflare Pages deployment wiring.

## Security

- Build 46 / version 2.6.7 adds Shop marketplace round-trip route restoration, brief Auth-session hydration retries on return, immediately available real seed photos, above-the-fold image priority, and direct image loading without a separate probe. It retains Client startup optimizations, Cloudflare Turnstile on sign-in/signup/recovery, the 12–128 character password policy, and server-side breached-password checks. Physical-device and real-network image timing checks remain outstanding.
- Cloudflare Turnstile's public sitekey is embedded in the client. The widget secret is not stored in the repository source. Supabase's native Auth CAPTCHA toggle remains pending manual dashboard activation; until then, do not describe the native CAPTCHA check as server-enforced.
- Google login remains optional. Facebook login is intentionally hidden until Meta credentials/redirects are configured and the profile-linking migration is applied.
- The custom breached-password check improves AegisPay-controlled signup/recovery flows, but is not a full substitute for Supabase's native leaked-password check on every possible direct Auth password update. Keep that limitation in mind when assessing production security.
- Never put service-role keys, payout private keys, Telegram bot secrets, AI provider keys, release keystore material or Cloudflare Turnstile secret in browser assets or Cloudflare Pages client variables.

## Branch policy

`main` is the only production source of truth. Experimental branches are not production sources. Any future UI or business change must start from and return to `main`.

## Canonical production baseline

- Production branch: `main`
- Client portal: `/app/` from root `client.html`
- Master Admin: `/admin/` from root `master-admin.html`
- Cloudflare Pages: `aegispay-pro`
- Supabase: `wtcspnrmsoisroavojop`
- Android source candidate: Build 46 / versionName 2.6.7. The root `app-version.json` is a test-channel fallback; the Web Portal Deploy workflow generates the final `stable` or `test` manifest, versioned Client/Admin APK URLs, and SHA-256 values according to the signing configuration. Physical-device performance and install/update verification remain pending.
