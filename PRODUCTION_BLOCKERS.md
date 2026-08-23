# Letterboard production blockers

Status: NO-GO until resolved.

- No Letterboard Supabase production project ref is configured or discoverable. The authenticated account currently exposes only `cozabgkejxlzzomphtpu` (VibeJam) and `csuejshnycgbfvtjbxoq` (HOTRANK). Do not apply the Letterboard migration to either project without explicit confirmation.
- No production deployment target or authenticated deploy credentials are configured in the workspace. The hosting metadata only contains the Site Creator project identifier and no deploy URL.
- No production `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_POSTHOG_KEY`, or `RESEND_API_KEY` values are available. Email and PostHog cannot be verified end-to-end until those are supplied.
- The migration and application checks are ready locally; production migration, email delivery, PostHog delivery, browser verification against the deployed app, and deployment remain blocked by the missing project/environment configuration.
