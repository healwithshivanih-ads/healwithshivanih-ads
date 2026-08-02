# Recipe images — audit and status

Audit run 2026-07-29 over the recipe library's images, looking for what a CLIENT
sees on a meal card: a photo that is blank, or shows something other than the dish.

## ✅ Done — 17 regenerated 2026-08-02

All 17 were regenerated with ChatGPT image generation, visually reviewed one by
one (right dish, no text/watermark/collage, no hands or people), centre-cropped to
the library's 3:2 landscape and saved at 1200×800 over the existing
`images/web/<slug>.jpg`. Each recipe's `image` block was moved off
`web_reference_uncleared` — the old `credit`/`source_url` pointed at Wikimedia and
Pinterest pages that are no longer where the picture came from, so leaving them
would have misattributed a generated image to a photographer.

**Was broken / blank (3):** `everyday-digestive-lassi`, `everyday-ghee`,
`ginger-lime-lassi`

**Was the wrong subject (5)** — each showed a raw ingredient or a graphic instead
of the dish: `amla-water` (amla on a tree), `almond-drink-ayurvedic` (raw almonds),
`rajma` (dry uncooked beans), `lemon-water` (lemons on stones), `lemon-ginger-soup`
(a text-overlay graphic)

**Was off-subject or the wrong colour (9):** `cherry-millet-cakes`,
`chicken-and-vegetable-poha`, `asparagus-white-bean-soup`, `cauliflower-leek-soup`,
`sol-kadhi-with-steamed-rice` (was white, should be pink), `walnut-coriander-chutney`
(was white coconut chutney, should be green), `white-bean-artichoke-croquettes`
(was a burger), `mushroom-methi-sabzi`, `snake-gourd-sabzi`

## ⬜ Still open — cosmetic only (5)

These show the **right dish** but carry a small watermark. Left alone deliberately;
regenerate only if you want them perfect.

`capsicum-sabzi` · `cardamom-limeade` · `ragi-idli` · `green-moong-sabzi` ·
`vegetable-millet-pulao`

---

### If you regenerate more

Save to `fm-database-web/public/recipe-images/images/web/<slug>.jpg`, overwriting in
place — no YAML change is needed for the path, each recipe already points at its own
`<slug>.jpg`. Landscape 3:2, ~1200×800. Then set the recipe's `image` block to the
generated-image convention the library already uses on 157 recipes:

```yaml
image:
  file: images/web/<slug>.jpg
  credit: generated with ChatGPT image generation
  source_url: chatgpt-generated://<slug>
  rights_status: original_generated
  note: original generated image; visually reviewed for no people, hands, text,
    or watermark
```

Style that worked: realistic food photography, natural daylight, single hero dish,
plain ceramic or steel and a neutral surface, no text, no hands, no collage.
