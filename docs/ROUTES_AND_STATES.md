# Screen inventory

The current prototype is intentionally a single-page flow so onboarding can be tested in one sitting.

## Public board

- `/` — canonical homepage and live Founding 100 leaderboard.
- `#board` — vertically stacked Top 3 followed by compact rows 4–10.
- `#how-it-works` — three-step explanation; can later become `/about` only if needed.

## Modal states

The claim flow is rendered from `ClaimFlow` and can later become route segments or a dedicated onboarding route.

1. `url`: URL-first entry.
2. `preview`: scraper result preview, explicitly labeled “Newsletter found”.
3. `ownership`: passive email confirmation, no code-pasting.
4. `success`: pending or confirmed status, place number, optional sharing.
5. `profile`: public profile plus share card preview.

## Design tokens

- Paper: `#FBFAF7`
- Ink: `#111214`
- Coral: `#F15C49`
- Lime: `#B8E635`
- Graphite: `#595A5D`
- Lines: `#D7D0C7`

The logo and Boardmark assets live in `public/` and the same marks are implemented as React components so the UI never drifts from the downloadable assets.

