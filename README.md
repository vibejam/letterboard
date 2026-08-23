# LETTERBOARD

Canonical Founding 100 frontend prototype for Letterboard.

This is a Vinext/Next-compatible site checkout with a production backend seam. Development fixtures are opt-in only (`NEXT_PUBLIC_ENABLE_DEV_FIXTURES=true`). It includes:

- Letterboard homepage with the live Founding 100 board
- Vertical Top 3 hierarchy with #1 carrying the strongest visual weight
- Compact Boardmark logo/badge in confirmed and pending states
- URL-first onboarding flow with auto-filled preview
- Passive ownership confirmation state
- Pending and confirmed profile states
- Optional share message and share-card preview
- Backend handoff docs and response contracts in `docs/`

## Run locally

```bash
npm run dev
```

## Validate

```bash
npm run build
npm test
```

## Backend configuration

Set these server variables in the hosting environment:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY` and optional `NEXT_PUBLIC_POSTHOG_HOST`
- `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`, and `OWNERSHIP_EMAIL_FROM` for production ownership email
- `ADMIN_REVIEW_TOKEN` for the protected review endpoint

Apply `supabase/migrations/20260822190743_founding100_schema.sql` to Supabase. Spotlight is intentionally disabled and there is no payment path in Phase 1.
