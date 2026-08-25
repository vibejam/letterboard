# Creator identity boundary

Letterboard currently uses the SHA-256 hash of a normalized, private creator email as the Founding 100 identity boundary. The hash is stored only in the protected `creator_identities` table and is never returned by public APIs, rendered in the UI, or written to structured logs.

The database allows one pending or confirmed claim for an active identity. A creator ban changes the protected identity status to `banned`, records the reason and authenticated admin actor in `creator_bans`, and writes an `admin_audit_log` entry. Existing confirmed positions are not removed by a ban.

Email-only identity is intentionally a phase-one boundary: separate email addresses can bypass it. The later stronger model should add authenticated creator accounts and an explicit, audited identity-linking flow, then associate claims with that account while preserving the existing email hash only as a recovery and duplicate-detection signal.

The migration is prepared locally in `supabase/migrations/20260824192622_creator_identity_bans_and_logo_source.sql`. Production application requires the final release approval gate.
