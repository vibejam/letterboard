# Letterboard frontend → backend handoff

This package is the canonical Founding 100 frontend. It is intentionally mock-data driven so the backend can be added without changing the visual system.

## Product phase

Phase 1 is free onboarding only. The UI should not expose paid bids, Spotlight, categories, About, or Rules until 100 ownership-confirmed profiles exist. The current board communicates that transition as future copy only.

## Replaceable seams

| Frontend seam | Current source | Backend replacement |
| --- | --- | --- |
| Board rows and stats | `app/data/mock.ts` | `GET /api/board` with `stats`, `top`, `rows`, `activity` |
| URL auto-fill | `ClaimFlow` `detected` memo | `POST /api/newsletters/resolve` → scraper/enrichment job |
| Pending claim | `ClaimFlow` `setStep("ownership")` | `POST /api/claims` → pending profile + verification dispatch |
| Ownership confirmation | Demo `confirmOwnership()` | `GET /api/claims/:token/confirm` or provider webhook |
| Public profile | `ClaimFlow` profile step | `GET /p/:slug` |
| Share message | `copyShareMessage()` | Server-generated share copy and OG image metadata |
| Boardmark | `Boardmark` component + `public/boardmark*.svg` | Same asset; status is data-driven |

## Recommended data model

```ts
type NewsletterClaim = {
  id: string;
  canonicalUrl: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
  logoUrl: string | null;
  creatorEmail: string | null;
  creatorSocials: { x?: string; instagram?: string; tiktok?: string };
  foundingPlace: number | null;
  status: "pending" | "confirmed" | "rejected";
  verificationMethod: "email" | "oauth" | "social" | null;
  verifiedAt: string | null;
  createdAt: string;
};
```

## Verification rules

1. Treat “Newsletter found” as metadata resolution, not ownership verification.
2. A pending profile may be visible, but it must not show the green confirmed Boardmark.
3. The confirmed Boardmark appears only after a one-click email, trusted OAuth callback, or equivalent server-side proof.
4. Sharing is optional and never blocks a claimed place.
5. Store canonical URLs after stripping tracking parameters. Keep the original submitted URL in an audit field.

## State contract for `ClaimFlow`

`url` → `preview` → `ownership` → `success` → `profile`

- `url`: one URL field, no account required.
- `preview`: public metadata has been scraped; status is pending.
- `ownership`: verification message is queued; user can keep the profile pending.
- `success`: status is pending or confirmed and the reserved board position is shown.
- `profile`: public profile and share card preview.

## API response shapes

```json
{
  "resolve": {
    "canonicalUrl": "https://thedailysignal.co",
    "name": "The Daily Signal",
    "description": "A sharp daily briefing for people building what comes next.",
    "category": "Technology",
    "logoUrl": null,
    "contact": { "available": true, "masked": "m•••@thedailysignal.co" }
  },
  "claim": {
    "id": "claim_123",
    "status": "pending",
    "foundingPlace": 38,
    "profileSlug": "the-daily-signal"
  }
}
```

## Integration notes

- Keep `Boardmark` as the single status badge implementation.
- Keep top-three rows vertically stacked; #1 must have the coral outline and strongest visual weight.
- Preserve the current responsive table behavior: desktop shows topic/views/status, mobile collapses to place/name/status.
- Add realtime activity later through SSE, WebSocket, or polling without changing the `ActivityPanel` contract.
- When Phase 2 launches, add paid bidding behind a feature flag and a new route rather than changing Founding 100 semantics.

