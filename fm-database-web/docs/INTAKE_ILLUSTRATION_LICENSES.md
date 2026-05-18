# Intake form illustration licenses

Every image in `fm-database-web/public/intake-illustrations/` is recorded
here with its source + license. Add a new entry whenever an image is
added or replaced — keeps compliance auditable and makes future
illustration swaps painless.

---

## `beighton-composite.png`

Composite illustration showing all 5 Beighton hypermobility tests in one
line-drawing image. Used in the intake form's joint-hypermobility screen
(and the coach-side Beighton verify panel on the pre-session brief).

| Field | Value |
| --- | --- |
| **Source** | Wikimedia Commons |
| **Original file** | [`File:Hypermobility Beighton Score.png`](https://commons.wikimedia.org/wiki/File:Hypermobility_Beighton_Score.png) |
| **Original URL** | https://upload.wikimedia.org/wikipedia/commons/4/46/Hypermobility_Beighton_Score.png |
| **Author** | Rollcloud (Wikimedia Commons user) |
| **License** | CC0 1.0 Universal — public domain dedication |
| **Attribution required?** | No (CC0 waives attribution). We credit anyway as best practice. |
| **Size** | 1119 × 972 PNG (541 KB) |
| **Downloaded** | 2026-05-18 |
| **Local path** | `fm-database-web/public/intake-illustrations/beighton-composite.png` |
| **Served at** | `/intake-illustrations/beighton-composite.png` |

> "I, the copyright holder of this work, hereby publish it under the
> following license: This work is made available under the terms of the
> Creative Commons CC0 1.0 Universal Public Domain Dedication."
> — license declaration on the file's Commons page

---

## Inline SVG illustrations (not separate image files)

These are authored directly in React components — no separate file, no
external license to track. Each is our own work, licensed under the
repo's existing proprietary terms.

| Component | Where it lives | What it shows |
| --- | --- | --- |
| `NasaLeanTestPosition` | `fm-database-web/src/components/intake-forms/illustrations/` (forthcoming) | Stick-figure standing against a wall, heels ~15 cm out, head + shoulders touching wall. For the orthostatic standing-tolerance self-check. |

Replace the SVG with a licensed image only if a clearly better option
appears — Wikimedia's tilt-table image is NOT a substitute (tilt-table
test is different equipment + procedure from the wall-lean test).

---

## Image-swap procedure

To replace any image in `intake-illustrations/`:

1. Download the new file into `public/intake-illustrations/` (overwrite the existing filename).
2. Update the entry above with the new source URL + author + license + downloaded date.
3. If the new license is **not** CC0 / public domain, ensure attribution is rendered somewhere visible to clients — current convention is a small italic credit at the bottom of the form section that uses the image.
4. Commit both the new image AND the updated `INTAKE_ILLUSTRATION_LICENSES.md` together.

Never hot-link to Wikimedia (or any external CDN) at runtime — Commons
URLs can break, throttle, or change. Always host locally.
