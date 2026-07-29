# Recipe images to regenerate

Save each new image (landscape, ~800px wide, appetising, no text/watermark/collage,
finished plated food) to:

    fm-database-web/public/recipe-images/images/web/<slug>.jpg

Overwrite the existing file at that path (same filename). No YAML change needed —
each recipe already points at its `<slug>.jpg`.

Style: real-looking Indian home-food photography, natural light, single hero dish,
no hands/people, no text overlays.

---

## 🔴 Broken / blank (3) — must fix

| slug | dish | depict |
|---|---|---|
| `everyday-digestive-lassi` | Everyday Digestive Lassi | thin churned yogurt drink, pale yellow (turmeric-tinted), in a glass — buttermilk/lassi look |
| `everyday-ghee` | Everyday Ghee | golden clarified ghee in a small glass jar with a spoon |
| `ginger-lime-lassi` | Ginger Lime Lassi | pale thin yogurt lassi in a glass with a lime wedge |

## 🟠 Clearly wrong subject (5)

| slug | dish | currently shows → should show |
|---|---|---|
| `amla-water` | Amla Water | raw amla on a tree → amla drink (cloudy pale-green water) in a glass |
| `almond-drink-ayurvedic` | Almond Drink | raw almonds + cinnamon sticks → creamy almond milk drink in a glass |
| `rajma` | Rajma | dry raw kidney beans → cooked home-style rajma curry in a bowl |
| `lemon-water` | Lemon Water | raw lemons on stones → warm lemon water in a glass |
| `lemon-ginger-soup` | Lemon Ginger Soup | text-overlay graphic → clear light lemon-ginger vegetable soup in a bowl |

## 🟡 Borderline — off-subject or wrong colour (9)

| slug | dish | issue → should show |
|---|---|---|
| `cherry-millet-cakes` | Cherry Millet Cakes | bread + peach → small baked millet-cherry snack cakes |
| `chicken-and-vegetable-poha` | Chicken & Vegetable Poha | dark fritters → light flattened-rice poha with chicken + veg |
| `asparagus-white-bean-soup` | Asparagus & White Bean Soup | brown soup → green blended asparagus-white-bean soup |
| `cauliflower-leek-soup` | Cauliflower Leek Soup | bright green → pale/cream cauliflower-leek soup |
| `sol-kadhi-with-steamed-rice` | Sol Kadhi with Steamed Rice | white → PINK kokum-coconut kadhi + a side of steamed rice |
| `walnut-coriander-chutney` | Walnut Coriander Chutney | plain white coconut chutney → green coriander-walnut chutney |
| `white-bean-artichoke-croquettes` | White Bean & Artichoke Croquettes | a burger → baked bean-artichoke patties/croquettes |
| `mushroom-methi-sabzi` | Mushroom Methi Sabzi | mushroom gravy (dup) → dry mushroom + fenugreek-greens sabzi |
| `snake-gourd-sabzi` | Snake Gourd Sabzi | looks like dal → dry South-Indian snake-gourd sabzi with tempering |

---

### Cosmetic only (leave unless you want them perfect)
Small watermarks but correct dish: `capsicum-sabzi`, `cardamom-limeade`, `ragi-idli`,
`green-moong-sabzi`, `vegetable-millet-pulao`.
