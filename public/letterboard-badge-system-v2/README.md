# Letterboard Boardmark Badge System v2

Corrected coding-ready assets for the four founding tiers: OG, Legend, Icon and Pioneer.

The boxed symbol is the canonical Letterboard **L**: one vertical stroke and one bottom horizontal stroke. It must never be replaced with diagonals, a K-like glyph, or a custom reinterpretation.

## Non-negotiable uniformity rules

- Every badge is exactly **320 × 96 px** with the same `viewBox`.
- Every badge uses the same outer radius, inner frame, boxed L, three-line mark, divider, dot position and wordmark baseline.
- The boxed L is identical in all four tiers; only its light/dark treatment follows the surface.
- Do not allow tier labels to change the component width or height.
- Render the SVG inside a fixed aspect-ratio wrapper: `aspect-ratio: 10 / 3; width: 100%; max-width: 320px;`.
- Preserve the colour distinction. OG is the only dark badge; the other three use the same warm paper surface.
- Do not stretch individual SVGs independently. Scale the whole badge proportionally.
- Do not use the legacy `boardmark.svg` or `boardmark-pending.svg` as tier artwork. Those files must either be removed from rendering or made aliases of the canonical component.

## Recommended site integration

Use one reusable component:

```tsx
<Boardmark tier="og" size="compact" />
```

Use the SVGs in `assets/` for the first production pass. Later, the same geometry can be parameterized from `boardmark-tokens.json` without changing the public appearance.

Suggested locations in the LETTERBOARD repo:

```text
public/brand/boardmarks/boardmark-og.svg
public/brand/boardmarks/boardmark-legend.svg
public/brand/boardmarks/boardmark-icon.svg
public/brand/boardmarks/boardmark-pioneer.svg
```

The badge should be used in newsletter rows, profile headers, share cards and the compact confirmation state. Internal points must never be displayed publicly unless the product owner explicitly changes that rule.
