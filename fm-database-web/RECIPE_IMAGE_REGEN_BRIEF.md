# Recipe image regeneration brief (for Codex)

Regenerate an ORIGINAL photo for each recipe below. These replace web-sourced, uncleared-rights images that were wrong, generic, or duplicated across different dishes.

## Global rules
- Output path per recipe is given as `file:` — overwrite that exact JPG.
- Each image MUST be unique — never reuse one photo across recipes (that is the main defect here).
- Style: realistic, appetizing, authentic INDIAN HOME-STYLE food photography; single serving; natural light; simple neutral background; 3:2 landscape.
- Depict the SPECIFIC dish and its defining ingredients (e.g. methi leaves visible for a methi sabzi; NO tomato for 'shakshuka-no-tomato'; whole jowar grain not couscous).
- VEG SAFETY: unless a line is tagged **[NON-VEG]**, the image must contain NO meat, fish, or prawn. Egg is allowed only where the dish names egg.
- After generating, set the recipe YAML `image.rights_status: original_generated` and keep `image.file: images/web/<slug>.jpg`.
- Do NOT touch these verified-good images: everyday-digestive-lassi, everyday-ghee, ginger-lime-lassi, lemon-ginger-soup.


## TIER A — duplicate photo reused across different dishes (highest priority; regenerate ALL members so each is unique)

### shared image → instant-lauki-thatte-idli, soft-idli-with-gunpowder-podi, steamed-vegetable-idada

- **Instant Lauki Thatte Idli**  
  file: `fm-database-web/public/recipe-images/images/web/instant-lauki-thatte-idli.jpg`  
  depict: Instant Lauki Thatte Idli — soaked rice, soaked poha (flattened rice), thick curd, lauki (bottle gourd), grated, green chillies, fresh coriander, chopped, salt, Eno fruit salt, oil, for greasing

- **Soft Idli with Gunpowder Podi**  
  file: `fm-database-web/public/recipe-images/images/web/soft-idli-with-gunpowder-podi.jpg`  
  depict: Soft Idli with Gunpowder Podi — idli rice (parboiled rice), whole white urad dal, fenugreek seeds, salt, water, for grinding, oil or ghee, for greasing moulds, white sesame seeds, chana dal, urad dal, dry red chillies, curry leaves, asafoetida (hing), 

- **Steamed Vegetable Idada**  
  file: `fm-database-web/public/recipe-images/images/web/steamed-vegetable-idada.jpg`  
  depict: Steamed Vegetable Idada — raw rice, soaked 6 hours and drained, urad dal, soaked 4 hours and drained, sour curd (for fermenting agent and tang), bottle gourd (lauki), peeled and finely grated, carrot, finely grated, ginger, finely grated, green c


### shared image → grilled-mushroom-chaat, kerala-mushroom-roast, mushroom-pepper-fry

- **Grilled Mushroom Chaat**  
  file: `fm-database-web/public/recipe-images/images/web/grilled-mushroom-chaat.jpg`  
  depict: Grilled Mushroom Chaat — button mushrooms, halved, oil (any neutral), chaat masala, cumin powder, red chilli powder, salt, red onion, finely chopped, tomato, finely chopped, green chilli, finely chopped, fresh coriander leaves, chopped, lemon ju

- **Kerala Mushroom Roast**  
  file: `fm-database-web/public/recipe-images/images/web/kerala-mushroom-roast.jpg`  
  depict: Kerala Mushroom Roast — button mushrooms, quartered, coconut oil, mustard seeds, dried red chillies, curry leaves, onion, thinly sliced, ginger, julienned, garlic, thinly sliced, green chilli, slit, turmeric powder, coriander powder, black pepp

- **Mushroom Pepper Fry**  
  file: `fm-database-web/public/recipe-images/images/web/mushroom-pepper-fry.jpg`  
  depict: Mushroom Pepper Fry — button mushrooms, coconut oil, mustard seeds, dried red chillies, curry leaves, onion, thinly sliced, ginger, grated, garlic, minced, black pepper, coarsely cracked, cumin powder, turmeric powder, salt, lemon juice, fres


### shared image → clear-mushroom-ginger-soup, hot-sour-vegetable-soup-indian-style, lemongrass-ginger-clear-soup

- **Clear Mushroom Ginger Soup**  
  file: `fm-database-web/public/recipe-images/images/web/clear-mushroom-ginger-soup.jpg`  
  depict: Clear Mushroom Ginger Soup — button mushrooms, wiped and thinly sliced, ginger, cut into thin matchsticks, garlic, thinly sliced, spring onion, thinly sliced (whites and greens separated), vegetable broth or water, soy sauce (gluten-free tamari if n

- **Hot & Sour Vegetable Soup (Indian Style)**  
  file: `fm-database-web/public/recipe-images/images/web/hot-sour-vegetable-soup-indian-style.jpg`  
  depict: Hot & Sour Vegetable Soup (Indian Style) — fresh ginger, garlic, green chilli, carrot, French beans, cabbage, tomato, spring onion greens, apple cider vinegar or white vinegar, soy-free tamari or coconut aminos, black pepper powder, white pepper powder, cold-pres

- **Lemongrass Ginger Clear Soup**  
  file: `fm-database-web/public/recipe-images/images/web/lemongrass-ginger-clear-soup.jpg`  
  depict: Lemongrass Ginger Clear Soup — lemongrass stalks, fresh ginger, garlic, green chilli, carrot, celery stalk, spring onion, black pepper, water, lime juice, salt, cold-pressed sesame oil, fresh coriander, thin rice noodles (optional)


### shared image → ginger-tulsi-rasam, pepper-moong-rasam

- **Ginger Tulsi Rasam**  
  file: `fm-database-web/public/recipe-images/images/web/ginger-tulsi-rasam.jpg`  
  depict: Ginger Tulsi Rasam — tamarind, water (warm, for soaking), tomato, fresh ginger, fresh tulsi (holy basil) leaves, black pepper, cumin seeds, turmeric powder, asafoetida (hing), dry red chilli, curry leaves, cold-pressed coconut oil or sesame 

- **Pepper Moong Rasam**  
  file: `fm-database-web/public/recipe-images/images/web/pepper-moong-rasam.jpg`  
  depict: Pepper Moong Rasam — split yellow moong dal, tamarind, water (warm, for soaking), tomato, fresh ginger, black pepper, whole black peppercorns, cumin seeds, turmeric powder, asafoetida (hing), dry red chilli, curry leaves, mustard seeds, cold


### shared image → mushroom-masala, mushroom-methi-sabzi

- **Mushroom Masala**  
  file: `fm-database-web/public/recipe-images/images/web/mushroom-masala.jpg`  
  depict: Mushroom Masala — button mushrooms, wiped clean and sliced, onion, finely chopped, tomatoes, finely chopped, ginger, grated, garlic, minced, oil, cumin seeds, bay leaf, coriander powder, cumin powder, turmeric powder, red chilli powder, g

- **Mushroom Methi Sabzi**  
  file: `fm-database-web/public/recipe-images/images/web/mushroom-methi-sabzi.jpg`  
  depict: Mushroom Methi Sabzi — button mushrooms, wiped and quartered, fresh methi (fenugreek) leaves, washed and roughly chopped, onion, finely chopped, ginger, grated, garlic, minced, tomato, finely chopped, oil, cumin seeds, turmeric powder, coriand


### shared image → masala-corn-bhutta-bowl, steamed-sweet-corn-chaat

- **Masala Corn Bhutta Bowl**  
  file: `fm-database-web/public/recipe-images/images/web/masala-corn-bhutta-bowl.jpg`  
  depict: Masala Corn Bhutta Bowl — corn on the cob, oil, green chilli, finely chopped, lemon juice, chaat masala, red chilli powder, black salt, salt, coriander leaves, chopped, ginger, finely grated

- **Steamed Sweet Corn Chaat**  
  file: `fm-database-web/public/recipe-images/images/web/steamed-sweet-corn-chaat.jpg`  
  depict: Steamed Sweet Corn Chaat — sweet corn kernels (fresh or frozen), lemon juice, roasted cumin powder, red chilli powder, black salt (kala namak), regular salt, fresh coriander leaves, finely chopped, green chilli, finely chopped


### shared image → masala-baked-eggs-with-greens, shakshuka-no-tomato-red-pepper-onion

- **Masala Baked Eggs with Greens** **[NON-VEG]**  
  file: `fm-database-web/public/recipe-images/images/web/masala-baked-eggs-with-greens.jpg`  
  depict: Masala Baked Eggs with Greens — eggs, coconut oil or neutral oil, cumin seeds, onion, finely chopped, garlic, minced, ginger, grated, green chilli, slit, tomatoes, finely chopped, turmeric powder, coriander powder, cumin powder, red chilli powder, fres

- **Shakshuka, No Tomato (Red Pepper & Onion)** **[NON-VEG]**  
  file: `fm-database-web/public/recipe-images/images/web/shakshuka-no-tomato-red-pepper-onion.jpg`  
  depict: Shakshuka, No Tomato (Red Pepper & Onion) — 3 eggs, 1/2 red bell pepper (capsicum), diced, 1/2 onion, sliced, 1 tbsp coriander, 1/4 tsp cumin, 1/4 tsp paprika/chilli, 1 tsp coconut oil, salt


### shared image → mushroom-millet-khichdi, weight-loss-jowar-pulao

- **Mushroom Millet Khichdi**  
  file: `fm-database-web/public/recipe-images/images/web/mushroom-millet-khichdi.jpg`  
  depict: Mushroom Millet Khichdi — foxtail millet, washed and soaked 20 min, yellow moong dal, washed, button mushrooms, roughly chopped, ghee, cumin seeds, bay leaf, onion, finely chopped, ginger, grated, garlic, minced, green chilli, slit, turmeric powd

- **Weight-Loss Jowar Pulao**  
  file: `fm-database-web/public/recipe-images/images/web/weight-loss-jowar-pulao.jpg`  
  depict: Weight-Loss Jowar Pulao — jowar (sorghum millet), water, ghee or oil, mustard seeds, cumin seeds, peanuts, ginger, chopped, green chillies, curry leaves, carrot, chopped, green beans, chopped, green peas, sweet corn, tomato, chopped, black pepper


### shared image → simple-stovetop-tofu, tofu-and-mushroom-stir-fry

- **Simple Stovetop Tofu**  
  file: `fm-database-web/public/recipe-images/images/web/simple-stovetop-tofu.jpg`  
  depict: Simple Stovetop Tofu — extra firm tofu, 12-oz block, ghee, nutritional yeast, tamari

- **Tofu and mushroom stir-fry**  
  file: `fm-database-web/public/recipe-images/images/web/tofu-and-mushroom-stir-fry.jpg`  
  depict: Tofu and mushroom stir-fry — firm tofu, cubed, ghee or oil, cumin seeds, ginger, grated, vegetables (capsicum, spinach, mushroom), turmeric, salt, fresh coriander


### shared image → everyday-almond-milk, spiced-nut-milk-smoothie

- **Everyday Almond Milk**  
  file: `fm-database-web/public/recipe-images/images/web/everyday-almond-milk.jpg`  
  depict: Everyday Almond Milk — raw almonds, water (for blending), water (for soaking), salt (optional)

- **Spiced Nut Milk Smoothie**  
  file: `fm-database-web/public/recipe-images/images/web/spiced-nut-milk-smoothie.jpg`  
  depict: Spiced Nut Milk Smoothie — almonds, soaked, warm water, maple syrup, Everyday Sweet Spice Mix, pure vanilla extract (optional), salt


### shared image → spiced-almond-milk-nightcap, winter-rejuvenating-tonic

- **Spiced Almond Milk Nightcap**  
  file: `fm-database-web/public/recipe-images/images/web/spiced-almond-milk-nightcap.jpg`  
  depict: Spiced Almond Milk Nightcap — 

- **Winter Rejuvenating Tonic**  
  file: `fm-database-web/public/recipe-images/images/web/winter-rejuvenating-tonic.jpg`  
  depict: Winter Rejuvenating Tonic — Medjool dates, almonds, soaked overnight, whole milk or Everyday Almond Milk, Everyday Sweet Spice Mix, ashwagandha powder (optional)


### shared image → bengali-mustard-oil-saag-bhaja, saut-ed-methi-greens

- **Bengali Mustard-Oil Saag Bhaja**  
  file: `fm-database-web/public/recipe-images/images/web/bengali-mustard-oil-saag-bhaja.jpg`  
  depict: Bengali Mustard-Oil Saag Bhaja — mixed winter greens (sarson/spinach/methi or a mix), washed and roughly chopped, mustard oil, garlic cloves, thinly sliced, dried red chillies, nigella seeds (kalonji), salt, lemon juice

- **Sautéed Methi Greens**  
  file: `fm-database-web/public/recipe-images/images/web/saut-ed-methi-greens.jpg`  
  depict: Sautéed Methi Greens — 1 small bunch methi (fenugreek) leaves, cleaned, 1 tsp garlic, sliced, 1/4 tsp cumin, 1 tsp coconut oil, salt, pinch chilli


### shared image → ghee-roasted-makhana-with-pepper, nutritional-yeast-makhana

- **Ghee-Roasted Makhana with Pepper**  
  file: `fm-database-web/public/recipe-images/images/web/ghee-roasted-makhana-with-pepper.jpg`  
  depict: Ghee-Roasted Makhana with Pepper — makhana (fox nuts), ghee, black pepper, freshly coarsely ground, rock salt (sendha namak)

- **Nutritional Yeast Makhana**  
  file: `fm-database-web/public/recipe-images/images/web/nutritional-yeast-makhana.jpg`  
  depict: Nutritional Yeast Makhana — makhana (fox nuts / lotus seeds), ghee, nutritional yeast flakes, black pepper, freshly ground, rock salt or sendha namak, red chilli powder, turmeric powder


### shared image → steamed-methi-muthia, steamed-sabudana-muthia

- **Steamed Methi Muthia**  
  file: `fm-database-web/public/recipe-images/images/web/steamed-methi-muthia.jpg`  
  depict: Steamed Methi Muthia — fresh methi (fenugreek) leaves, chopped, besan (chickpea flour), whole wheat flour, curd (yogurt), ginger-green chilli paste, turmeric powder, red chilli powder, ajwain (carom seeds), sugar, lemon juice, salt, oil, oil (

- **Steamed Sabudana Muthia**  
  file: `fm-database-web/public/recipe-images/images/web/steamed-sabudana-muthia.jpg`  
  depict: Steamed Sabudana Muthia — sabudana (tapioca pearls), soaked 4 hours and drained, roasted peanuts, coarsely crushed, boiled potato, mashed, green chilli, finely chopped, fresh ginger, grated, cumin seeds, rock salt (sendha namak), lemon juice, fre


### shared image → everyday-savory-spice-mix, fall-spice-mix

- **Everyday Savory Spice Mix**  
  file: `fm-database-web/public/recipe-images/images/web/everyday-savory-spice-mix.jpg`  
  depict: Everyday Savory Spice Mix — whole coriander seed, whole cumin seed, whole fennel seed, turmeric powder

- **Fall Spice Mix**  
  file: `fm-database-web/public/recipe-images/images/web/fall-spice-mix.jpg`  
  depict: Fall Spice Mix — coriander seeds, cumin seeds, fennel seeds, turmeric powder, ginger powder


### shared image → summer-spice-mix, winter-spice-mix

- **Summer Ayurvedic Spice Mix**  
  file: `fm-database-web/public/recipe-images/images/web/summer-spice-mix.jpg`  
  depict: Summer Ayurvedic Spice Mix — whole coriander seeds, whole cumin seeds, whole fennel seeds, turmeric powder, cardamom powder

- **Winter Spice Mix**  
  file: `fm-database-web/public/recipe-images/images/web/winter-spice-mix.jpg`  
  depict: Winter Spice Mix — coriander seeds, cumin seeds, turmeric powder, salt, dehydrated sugarcane, ginger powder, black pepper (optional)


## TIER B — wrong dish (photo shows a different food)

- **Besan uttapam**  
  file: `fm-database-web/public/recipe-images/images/web/besan-uttapam.jpg`  
  depict: Besan uttapam — besan (gram flour), water, ginger, grated, green chilli, minced (optional), turmeric, finely chopped vegetables (onion, capsicum, coriander), salt, ghee or oil for cooking

- **Overnight oats**  
  file: `fm-database-web/public/recipe-images/images/web/overnight-oats.jpg`  
  depict: Overnight oats — rolled oats, milk or Greek yogurt, chia seeds, mixed berries, walnuts, chopped, cinnamon, honey or soaked dates (optional)

- **Warm Spiced Oat Porridge**  
  file: `fm-database-web/public/recipe-images/images/web/spiced-oat-porridge.jpg`  
  depict: Warm Spiced Oat Porridge — 

- **Vegetable masala oats**  
  file: `fm-database-web/public/recipe-images/images/web/vegetable-masala-oats.jpg`  
  depict: Vegetable masala oats — rolled oats, mixed vegetables (carrot, peas, beans), oil, mustard seeds, curry leaves, onion, chopped, ginger, grated, turmeric, salt, water, fresh coriander

- **Basil Melon Cooler**  
  file: `fm-database-web/public/recipe-images/images/web/basil-melon-cooler.jpg`  
  depict: Basil Melon Cooler — chopped, deseeded watermelon, honeydew, or cantaloupe, fresh basil leaves, ginger powder, lime juice (from 1 lime), water, ice cubes (optional), fresh basil leaves and lime wedges for garnish

- **Cherry Millet Cakes**  
  file: `fm-database-web/public/recipe-images/images/web/cherry-millet-cakes.jpg`  
  depict: Cherry Millet Cakes — prunes, warm water, cooked millet, ground flaxseed, ginger powder, lemon juice, dried cherries, uncooked millet grains

- **Sesame Cookies**  
  file: `fm-database-web/public/recipe-images/images/web/sesame-cookies.jpg`  
  depict: Sesame Cookies — sesame tahini, almond flour, maple syrup, pure vanilla extract, Everyday Sweet Spice Mix, salt, baking soda, egg, whisked (or 1 flax egg), sesame seeds, plus extra for topping

- **Vegetable quinoa upma**  
  file: `fm-database-web/public/recipe-images/images/web/vegetable-quinoa-upma.jpg`  
  depict: Vegetable quinoa upma — quinoa, rinsed, mixed vegetables (carrot, peas, capsicum), oil, mustard seeds, chana dal, curry leaves, ginger, grated, green chilli, salt, water, lemon juice, fresh coriander

- **Quinoa vegetable paneer bowl**  
  file: `fm-database-web/public/recipe-images/images/web/quinoa-vegetable-paneer-bowl.jpg`  
  depict: Quinoa vegetable paneer bowl — cooked quinoa, paneer, cubed, mixed vegetables (broccoli, peppers, zucchini), olive oil, garlic, minced, lemon juice, black pepper, salt, fresh herbs or coriander

- **Turai clear soup**  
  file: `fm-database-web/public/recipe-images/images/web/turai-clear-soup.jpg`  
  depict: Turai clear soup — turai, chopped, ghee or coconut oil, cumin seeds, ginger, grated, black pepper, salt, lemon juice, fresh coriander

- **Chicken and vegetable poha** **[NON-VEG]**  
  file: `fm-database-web/public/recipe-images/images/web/chicken-and-vegetable-poha.jpg`  
  depict: Chicken and vegetable poha — chicken, coconut oil, onion, sliced, ginger-garlic paste, curry leaves, turmeric, coriander powder, light coconut milk, salt, fresh coriander

- **Lemon Water**  
  file: `fm-database-web/public/recipe-images/images/web/lemon-water.jpg`  
  depict: Lemon Water — ½ lemon, juiced, 1 cup warm (not hot) water


## TIER C — generic (real but non-specific)

- **Vegetable Soup (Lauki, Ash Gourd, Drumstick)**  
  file: `fm-database-web/public/recipe-images/images/web/vegetable-soup-lauki-ash-gourd-drumstick.jpg`  
  depict: Vegetable Soup (Lauki, Ash Gourd, Drumstick) — 1 cup mixed lauki + ash gourd, cubed, 1 drumstick, in batons, 1 inch ginger, 6 curry leaves, 1/4 tsp pepper, 1 tsp coconut oil, salt, coriander

- **Buckwheat / Millet Roti**  
  file: `fm-database-web/public/recipe-images/images/web/buckwheat-millet-roti.jpg`  
  depict: Buckwheat / Millet Roti — 1/2 cup buckwheat (or kodo/foxtail millet) flour, warm water to bind, pinch salt, ghee/coconut oil to cook


## TIER D — borderline / lower priority (regenerate if convenient; some may already be acceptable)

- **Tofu-Ginger Vegetable Soup**  
  file: `fm-database-web/public/recipe-images/images/web/tofu-ginger-vegetable-soup.jpg`  
  depict: Tofu-Ginger Vegetable Soup — sesame oil, carrots, chopped, celery, chopped, white onions, chopped, ginger, minced, garlic, minced, miso, water, soy sauce, scallions, chopped, cilantro, chopped, tofu, drained and cubed, bean sprouts, carrots, shredde

- **Jowar Vegetable Khichdi**  
  file: `fm-database-web/public/recipe-images/images/web/jowar-vegetable-khichdi.jpg`  
  depict: Jowar Vegetable Khichdi — whole jowar (sorghum), soaked overnight and drained, yellow moong dal, rinsed, carrot, diced small, French beans, chopped into 1 cm pieces, bottle gourd (lauki), peeled and diced, onion, finely chopped, tomato, chopped, 

- **Collard Wraps with Red Lentil Pâté**  
  file: `fm-database-web/public/recipe-images/images/web/collard-wraps-red-lentil-pate.jpg`  
  depict: Collard Wraps with Red Lentil Pâté — red lentils, water, Winter Spice Mix, sesame tahini, fresh lemon juice, red miso dissolved in 1 tbsp hot water, large collard leaves, cooked basmati rice, shredded carrots, cabbage, or beets (optional)

- **Fruit Salad Trio — Citrus Salad**  
  file: `fm-database-web/public/recipe-images/images/web/fruit-salad-citrus.jpg`  
  depict: Fruit Salad Trio — Citrus Salad — orange, sectioned and chopped, grapefruit, sectioned and chopped, dried pineapple rings, diced, coconut water, fresh lime juice

- **Hemp Protein Squares**  
  file: `fm-database-web/public/recipe-images/images/web/hemp-protein-squares.jpg`  
  depict: Hemp Protein Squares — hemp protein powder, almond or sunflower butter, unsweetened shredded coconut, coconut oil, pitted Medjool dates (about 4–5), dried apricots (about 6), cardamom powder

- **Tempeh Tawa Masala**  
  file: `fm-database-web/public/recipe-images/images/web/tempeh-tawa-masala.jpg`  
  depict: Tempeh Tawa Masala — tempeh, cut into 1 cm thick slices, oil, onion, thinly sliced, green capsicum, thinly sliced, tomato, finely chopped, ginger-garlic paste, turmeric powder, coriander powder, cumin powder, red chilli powder, garam masala,

- **Fish curry** **[NON-VEG]**  
  file: `fm-database-web/public/recipe-images/images/web/fish-curry.jpg`  
  depict: Fish curry — fish, coconut oil, onion, sliced, ginger-garlic paste, curry leaves, turmeric, coriander powder, light coconut milk, salt, fresh coriander

- **Steamed Zucchini Noodles with Yogurt Dill Sauce**  
  file: `fm-database-web/public/recipe-images/images/web/zucchini-noodles-yogurt-dill.jpg`  
  depict: Steamed Zucchini Noodles with Yogurt Dill Sauce — water for steaming, small to medium zucchini, fresh dill, chopped, organic whole milk yogurt, fresh lemon juice, turmeric powder, salt, freshly ground black pepper

- **Walnut Mint Pesto with Millets**  
  file: `fm-database-web/public/recipe-images/images/web/walnut-mint-pesto-with-millets.jpg`  
  depict: Walnut Mint Pesto with Millets — foxtail millet (kangni) or little millet, water, salt, walnut halves, fresh mint leaves, tightly packed, fresh coriander leaves, tightly packed, garlic cloves, lemon juice, extra-virgin olive oil or cold-pressed groundnu

- **Asparagus and White Bean Soup**  
  file: `fm-database-web/public/recipe-images/images/web/asparagus-white-bean-soup.jpg`  
  depict: Asparagus and White Bean Soup — asparagus stalks, water, olive oil, cooked white beans, Spring Salts, lemon, juiced (quarter), lemon wedges for serving, freshly ground black pepper

- **Kate's Only Salad**  
  file: `fm-database-web/public/recipe-images/images/web/kates-only-salad.jpg`  
  depict: Kate's Only Salad — fennel bulb, romaine or red leaf lettuce, chopped (or ½ lb mesclun greens), olive, sunflower, or grapeseed oil, fine balsamic vinegar, chèvre (goat cheese), chopped almonds or toasted sunflower seeds, dried cranberries

- **Cauliflower-Broccoli Coconut Sabzi**  
  file: `fm-database-web/public/recipe-images/images/web/cauliflower-broccoli-coconut-sabzi.jpg`  
  depict: Cauliflower-Broccoli Coconut Sabzi — 1 cup cauliflower + broccoli florets, 2 tbsp grated coconut, 1/4 tsp mustard, 1/4 tsp turmeric, 6 curry leaves, 1 tsp coconut oil, salt

- **Medicinal Hot Cocoa**  
  file: `fm-database-web/public/recipe-images/images/web/medicinal-hot-cocoa-ashwagandha.jpg`  
  depict: Medicinal Hot Cocoa — almond, sunflower, or cow's milk, maple syrup, coconut sugar, or raw cane sugar, cacao powder, cinnamon or Everyday Sweet Spice Mix, ashwagandha powder, cinnamon sticks or freshly grated nutmeg for garnish (optional)

- **Thin moong dal soup**  
  file: `fm-database-web/public/recipe-images/images/web/thin-moong-dal-soup.jpg`  
  depict: Thin moong dal soup — thin moong dal, chopped, ghee or coconut oil, cumin seeds, ginger, grated, black pepper, salt, lemon juice, fresh coriander

- **Til chutney**  
  file: `fm-database-web/public/recipe-images/images/web/til-chutney.jpg`  
  depict: Til chutney — til, grated coconut, ginger, green chilli (optional), lemon juice, salt, water, for tempering: coconut oil, mustard seeds, curry leaves

- **Tinda sabzi**  
  file: `fm-database-web/public/recipe-images/images/web/tinda-sabzi.jpg`  
  depict: Tinda sabzi — tinda, diced, ghee or coconut oil, mustard seeds, cumin seeds, curry leaves, ginger, grated, turmeric, grated fresh coconut (optional), salt, fresh coriander, chopped

