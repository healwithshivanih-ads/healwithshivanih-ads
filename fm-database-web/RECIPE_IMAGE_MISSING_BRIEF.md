# Missing recipe images — generation brief (for Codex)

Codex added recipe text for these 71 dishes but they have NO photo (rights_status:none, file missing),
so the client app shows a generic placeholder. Generate an ORIGINAL photo for each.

## Global rules
- Output path: `fm-database-web/public/recipe-images/images/web/<slug>.jpg` — create that exact JPG.
- Authentic INDIAN HOME-STYLE food photography; single serving; natural light; neutral background; 3:2 landscape.
- Depict the SPECIFIC dish + its defining ingredient. VEG SAFETY: no meat/fish unless tagged [NON-VEG].
- After generating, set the recipe YAML `image.rights_status: original_generated` and `image.file: images/web/<slug>.jpg`.

## Priority A — on LIVE client menus (clients see a placeholder now; count = #clients)

- (5) **Green chutney sandwich** — `green-chutney-sandwich.jpg` — whole-wheat bread, mint leaves, coriander leaves, green chilli, lemon juice, cucumber, thinly sliced, salt and roasted cumin powder
- (5) **Sautéed methi** — `sauteed-methi.jpg` — fenugreek leaves (methi), cleaned and chopped, garlic, crushed, onion, chopped, jeera (cumin seeds), haldi (turmeric), red chilli powder, hing (asafoetida), cooking oil, salt
- (4) **Sautéed palak** — `sauteed-palak.jpg` — spinach (palak), washed and roughly chopped, garlic, sliced, jeera (cumin seeds), green chilli, slit, haldi (turmeric), hing (asafoetida), cooking oil, salt, lemon juice
- (3) **Besan cheela with methi** — `besan-methi-cheela.jpg` — gram flour (besan), fresh methi (fenugreek) leaves, chopped, water, green chilli, minced, ginger, grated, turmeric powder, cumin powder, salt, cold-pressed oil, for cooking
- (3) **Sautéed mustard greens** — `sauteed-mustard-greens.jpg` — mustard greens (sarson), cleaned and chopped, garlic, crushed, onion, chopped, green chilli, chopped, ginger, grated, haldi (turmeric), hing (asafoetida), cooking oil, salt
- (3) **Vegetable moong khichdi** — `vegetable-moong-khichdi.jpg` — split yellow moong dal, white rice, ghee, cumin seeds, asafoetida (hing), ginger, grated, turmeric, diced mixed vegetables (carrot, beans, bottle gourd, peas), salt, water, fresh coriander, chopped
- (2) **Sautéed zucchini** — `sauteed-zucchini.jpg` — zucchini, sliced into half-moons, garlic, chopped, rai (mustard seeds), jeera (cumin seeds), curry leaves, haldi (turmeric), red chilli powder, cooking oil, salt, fresh coriander, chopped
- (2) **Stir-fried cabbage** — `stir-fried-cabbage.jpg` — cabbage, finely shredded, green peas, rai (mustard seeds), jeera (cumin seeds), urad dal (split black gram), curry leaves, green chilli, chopped, haldi (turmeric), hing (asafoetida), cooking oil, salt
- (2) **Tofu and spinach curry** — `tofu-spinach-curry.jpg` — firm tofu, cubed, spinach, blanched and pureed, onion, finely chopped, tomato, chopped, ginger-garlic paste, cooking oil, cumin seeds, turmeric, green chilli, slit, coriander powder, garam masala, sal
- (2) **Mixed vegetable paratha** — `vegetable-paratha.jpg` — whole-wheat atta, carrot (grated), cabbage (finely shredded), green peas (mashed), green chilli (finely chopped), cumin powder, coriander leaves (chopped), ghee (for cooking), salt
- (1) **Aloo gobi sabzi** — `aloo-gobi-sabzi.jpg` — potato, cubed small, cauliflower, small florets, onion, finely chopped, tomato, chopped, ginger-garlic paste, jeera (cumin seeds), haldi (turmeric), red chilli powder, dhania (coriander) powder, cooki
- (1) **Amaranth leaves sabzi with sesame and turmeric** — `amaranth-sesame-sabzi.jpg` — amaranth leaves (chaulai), cleaned and chopped, sesame seeds (til), garlic, crushed, rai (mustard seeds), green chilli, chopped, haldi (turmeric), hing (asafoetida), cooking oil, salt
- (1) **Bitter melon sabzi** — `bitter-melon-sabzi.jpg` — bitter gourd (karela), sliced into thin rounds, onion, thinly sliced, rai (mustard seeds), jeera (cumin seeds), haldi (turmeric), red chilli powder, dhania (coriander) powder, amchur (dry mango powder
- (1) **Bottle gourd ginger soup** — `bottle-gourd-ginger-soup.jpg` — bottle gourd (lauki), peeled and cubed, ginger, garlic, cumin seeds, turmeric, black pepper, oil, water, coriander leaves, lemon juice, salt
- (1) **Carrot-coriander soup** — `carrot-coriander-soup.jpg` — carrots, peeled and chopped, coriander leaves, ginger, garlic, onion, cumin seeds, black pepper, oil, water, lemon juice, salt
- (1) **Chicken soup with ginger, garlic and turmeric** [NON-VEG] — `chicken-ginger-turmeric-soup.jpg` — bone-in chicken pieces, ginger, julienned, garlic, crushed, turmeric powder, black peppercorns, crushed, onion, chopped, curry leaves, coriander leaves, chopped, ghee, salt, lemon
- (1) **Chicken liver masala** [NON-VEG] — `chicken-liver-masala.jpg` — chicken liver, trimmed and cut into bite-size pieces, onion, finely chopped, tomato, chopped, ginger-garlic paste, turmeric powder, red chilli powder, garam masala, green chilli, slit, coriander leave
- (1) **Chickpea-vegetable pulao** — `chickpea-vegetable-pulao.jpg` — white rice, soaked 20 minutes, cooked chickpeas (or soaked and boiled), cold-pressed vegetable oil, cumin seeds, bay leaf, cinnamon stick, green cardamom, cloves, onion, sliced, ginger-garlic paste, d
- (1) **Fish stew** [NON-VEG] — `fish-stew.jpg` — firm fish, cut into chunks (surmai, rohu, basa or catla), coconut milk, onion, sliced, tomato, chopped, ginger-garlic paste, green chilli, slit, curry leaves, turmeric powder, coconut oil, salt, lemon
- (1) **Grilled fish** [NON-VEG] — `grilled-fish.jpg` — firm fish steaks (surmai, rohu, mackerel or catla), turmeric powder, red chilli powder, ginger-garlic paste, lemon, salt, mustard oil or coconut oil
- (1) **Kodo millet pulao with peas and jeera** — `kodo-millet-pulao.jpg` — kodo millet, rinsed and soaked 20 minutes, green peas (fresh or frozen), cold-pressed vegetable oil, cumin seeds, bay leaf, cinnamon stick, cloves, onion, sliced, ginger, grated, diced carrot, turmeri
- (1) **Methi-bajra thepla** — `methi-bajra-thepla.jpg` — whole wheat flour (atta), bajra (pearl millet) flour, fresh methi (fenugreek) leaves, chopped, curd (yogurt), turmeric powder, red chilli powder, cumin powder, salt, cold-pressed oil, for dough and co
- (1) **Methi-jowar thepla** — `methi-jowar-thepla.jpg` — whole wheat flour (atta), jowar (sorghum) flour, fresh methi (fenugreek) leaves, chopped, curd (yogurt), turmeric powder, ginger-green chilli paste, sesame seeds, salt, cold-pressed oil, for dough and
- (1) **Methi paneer** — `methi-paneer.jpg` — paneer, cubed, fresh methi (fenugreek) leaves, chopped, onion, finely chopped, tomato, pureed, ginger-garlic paste, turmeric powder, coriander powder, garam masala, salt, cold-pressed oil
- (1) **Palak-moong soup** — `palak-moong-soup.jpg` — spinach (palak), yellow moong dal, ginger, garlic, cumin seeds, turmeric, black pepper, ghee, water, lemon juice, salt
- (1) **Pan-seared chicken breast** [NON-VEG] — `pan-seared-chicken-breast.jpg` — boneless chicken breast, turmeric powder, black pepper, freshly cracked, ginger-garlic paste, lemon, salt, ghee or coconut oil
- (1) **Pan-seared fish** [NON-VEG] — `pan-seared-fish.jpg` — fish fillets (basa, surmai, rohu or mackerel), turmeric powder, black pepper, freshly cracked, lemon, salt, coconut oil or ghee
- (1) **Pointed gourd sabzi** — `pointed-gourd-sabzi.jpg` — pointed gourd (parwal), sliced lengthwise, onion, thinly sliced, rai (mustard seeds), jeera (cumin seeds), haldi (turmeric), red chilli powder, dhania (coriander) powder, hing (asafoetida), cooking oi
- (1) **Rasam** — `rasam.jpg` — tamarind, tomato, rasam powder, black pepper (crushed), cumin seeds, garlic, curry leaves, hing (asafoetida), turmeric, coriander leaves, ghee or oil, water, salt
- (1) **Ringan bharta** — `ringan-bharta.jpg` — large round brinjal (eggplant), onion, finely chopped, tomato, finely chopped, green chilli, chopped, ginger-garlic paste, jeera (cumin seeds), haldi (turmeric), red chilli powder, cooking oil, salt, 
- (1) **Roasted sweet potato** — `roasted-sweet-potato.jpg` — sweet potato, cut into cubes, cold-pressed oil, turmeric powder, red chilli powder, roasted cumin powder, chaat masala, salt, lemon juice
- (1) **Kitchari with split mung dal and sama** — `sama-mung-kitchari.jpg` — sama (barnyard millet), split mung dal (yellow moong), ghee, cumin seeds, asafoetida (hing), ginger, grated, turmeric, diced seasonal vegetables (bottle gourd, carrot, beans), salt, water, fresh coria
- (1) **Sautéed broccoli** — `sauteed-broccoli.jpg` — broccoli, small florets, garlic, sliced, jeera (cumin seeds), green chilli, slit, haldi (turmeric), black pepper, crushed, cooking oil, salt, lemon juice
- (1) **Sautéed cauliflower and peas** — `sauteed-cauliflower-peas.jpg` — cauliflower, small florets, green peas, onion, chopped, jeera (cumin seeds), ginger, grated, haldi (turmeric), red chilli powder, dhania (coriander) powder, cooking oil, salt, fresh coriander, chopped
- (1) **Sautéed green beans** — `sauteed-green-beans.jpg` — green beans, finely chopped, fresh grated coconut, rai (mustard seeds), urad dal (split black gram), curry leaves, green chilli, chopped, haldi (turmeric), hing (asafoetida), cooking oil, salt
- (1) **Sesame chutney** — `sesame-chutney.jpg` — white sesame seeds (til), garlic cloves, dry red chilli, tamarind, cumin seeds, salt, water
- (1) **Soya chunk curry** — `soya-chunk-curry.jpg` — soya chunks, onion, finely chopped, tomato, pureed, ginger-garlic paste, cooking oil, cumin seeds, turmeric, red chilli powder, coriander powder, garam masala, salt, fresh coriander, chopped
- (1) **Soya chunk pulao with vegetables** — `soya-chunk-pulao.jpg` — soya chunks, basmati rice, soaked, mixed vegetables (carrot, beans, peas), chopped, onion, sliced, ginger-garlic paste, cooking oil, bay leaf, cloves, green cardamom, cinnamon stick, cumin seeds, gara
- (1) **Sprouted chana curry** — `sprouted-chana-curry.jpg` — sprouted brown chana (chickpeas), onion, finely chopped, tomato, chopped, ginger-garlic paste, turmeric powder, coriander powder, cumin seeds, garam masala, salt, cold-pressed oil
- (1) **Tindora sabzi** — `tindora-sabzi.jpg` — ivy gourd (tindora), sliced into rounds, onion, sliced, rai (mustard seeds), jeera (cumin seeds), curry leaves, haldi (turmeric), red chilli powder, dhania (coriander) powder, hing (asafoetida), cooki
- (1) **Tofu bhurji with capsicum and tomato** — `tofu-bhurji.jpg` — firm tofu, crumbled, capsicum, finely chopped, tomato, finely chopped, onion, finely chopped, ginger-garlic paste, cooking oil, cumin seeds, turmeric, red chilli powder, garam masala, salt, fresh cori
- (1) **Tofu matar curry** — `tofu-matar-curry.jpg` — firm tofu, cubed, green peas, onion, finely chopped, tomato, pureed, ginger-garlic paste, cooking oil, cumin seeds, turmeric, red chilli powder, coriander powder, garam masala, salt, fresh coriander, 
- (1) **Tofu and ridge gourd curry** — `tofu-ridge-gourd-curry.jpg` — firm tofu, cubed, ridge gourd (turai), peeled and diced, onion, finely chopped, tomato, chopped, ginger-garlic paste, cooking oil, mustard seeds, cumin seeds, turmeric, red chilli powder, coriander po
- (1) **Tomato-beetroot soup** — `tomato-beetroot-soup.jpg` — ripe tomatoes, beetroot, peeled and chopped, ginger, garlic, onion, cumin seeds, black pepper, oil, water, coriander leaves, lemon juice, salt
- (1) **Vegetable bajra khichdi** — `vegetable-bajra-khichdi.jpg` — bajra (pearl millet), soaked, split yellow moong dal, ghee, cumin seeds, asafoetida (hing), ginger, grated, turmeric, diced mixed vegetables (carrot, beans, peas, bottle gourd), salt, water, fresh cor
- (1) **Vegetable rice pulao with vegetables** — `vegetable-pulao.jpg` — white rice, soaked 20 minutes, cold-pressed vegetable oil, cumin seeds, bay leaf, cinnamon stick, green cardamom, cloves, onion, sliced, ginger-garlic paste, diced mixed vegetables (carrot, beans, pea
- (1) **Vegetable uttapam** — `vegetable-uttapam.jpg` — fermented dosa batter (rice and urad dal), onion, finely chopped, tomato, finely chopped, capsicum, finely chopped, green chilli, minced, fresh coriander, chopped, salt, cold-pressed oil, for cooking
- (1) **Whole-roast chicken leg** [NON-VEG] — `whole-roast-chicken-leg.jpg` — whole bone-in chicken legs (thigh + drumstick), turmeric powder, red chilli powder, ginger-garlic paste, black pepper, freshly cracked, lemon, ghee or oil, salt

## Priority B — in catalogue, not yet on a live menu

- **Aloo paratha** — `aloo-paratha.jpg` — whole-wheat atta, potato (boiled and mashed), green chilli (finely chopped), coriander leaves (chopped), ajwain, red chilli powder, ghee (for cooking), salt
- **Egg sandwich** [NON-VEG] — `egg-sandwich.jpg` — whole-wheat bread, eggs, boiled and peeled, onion, finely chopped, green chilli, chopped, mustard paste, black pepper and salt, coriander leaves, chopped
- **Gobi paratha** — `gobi-paratha.jpg` — whole-wheat atta, cauliflower (finely grated), ginger (grated), green chilli (finely chopped), coriander leaves (chopped), cumin powder, ghee (for cooking), salt
- **Hummus and veggie wrap** [NON-VEG] — `hummus-veg-wrap.jpg` — whole-wheat rotis, hummus, cucumber, cut in strips, carrot, grated, lettuce or cabbage, shredded, onion, thinly sliced, lemon juice, black pepper and salt
- **Jeera rice** — `jeera-rice.jpg` — basmati rice, cumin seeds (jeera), oil, bay leaf, green chilli (slit), water, salt, coriander leaves (to garnish)
- **Masala avocado toast** — `masala-avocado-toast.jpg` — whole-wheat bread, ripe avocado, onion, finely chopped, tomato, finely chopped, green chilli, finely chopped, lemon juice, chaat masala and salt, coriander leaves, chopped
- **Methi paratha** — `methi-paratha.jpg` — whole-wheat atta, fresh fenugreek leaves (methi, chopped), turmeric powder, red chilli powder, ajwain, oil (to bind), ghee (for cooking), salt
- **Sautéed mushroom and palak** — `mushroom-palak-sabzi.jpg` — button mushrooms, sliced, spinach (palak), chopped, onion, chopped, garlic, chopped, jeera (cumin seeds), haldi (turmeric), red chilli powder, black pepper, crushed, cooking oil, salt
- **Palak sesame chutney** — `palak-sesame-chutney.jpg` — palak (spinach) leaves, chopped, white sesame seeds (til), green chilli, garlic cloves, lemon juice, cumin seeds, salt, cold-pressed oil
- **Paneer kathi roll** — `paneer-kathi-roll.jpg` — whole-wheat rotis, paneer, cut in strips, onion, sliced, capsicum, sliced, curd, tandoori or garam masala, red chilli powder and salt, green chutney, oil
- **Paneer paratha** — `paneer-paratha.jpg` — whole-wheat atta, paneer (grated), green chilli (finely chopped), coriander leaves (chopped), cumin powder, garam masala, ghee (for cooking), salt
- **Paneer sandwich** — `paneer-sandwich.jpg` — whole-wheat bread, paneer, crumbled, onion, finely chopped, capsicum, finely chopped, tomato, finely chopped, green chilli, chopped, turmeric, chaat masala and salt, coriander leaves, chopped
- **Peanut butter banana toast** — `peanut-butter-banana-toast.jpg` — whole-wheat bread, natural peanut butter, banana, sliced, cinnamon powder, chia or flax seeds (optional)
- **Plain paratha** — `plain-paratha.jpg` — whole-wheat atta, ghee (for layering and cooking), water, salt
- **Soya chunk and peas curry** — `soya-chunk-peas-curry.jpg` — soya chunks, green peas, onion, finely chopped, tomato, chopped, ginger-garlic paste, cooking oil, cumin seeds, turmeric, red chilli powder, coriander powder, garam masala, salt, fresh coriander, chop
- **Sprouts and veg sandwich** — `sprouts-sandwich.jpg` — whole-wheat bread, moong sprouts, lightly steamed, onion, finely chopped, tomato, finely chopped, green chilli, chopped, lemon juice, chaat masala and salt, coriander leaves, chopped
- **Tomato rasam** — `tomato-rasam.jpg` — ripe tomatoes, tamarind, rasam powder, black pepper (crushed), cumin seeds, garlic, curry leaves, hing (asafoetida), turmeric, mustard seeds, coriander leaves, ghee or oil, water, salt
- **Tomato rice** — `tomato-rice.jpg` — cooked rice, tomato (finely chopped), onion (sliced), mustard seeds, curry leaves, turmeric powder, red chilli powder, oil, salt
- **Vegetable biryani** — `veg-biryani.jpg` — basmati rice, mixed vegetables (carrot, beans, cauliflower, peas), onion (thinly sliced), curd (whisked), ginger-garlic paste, biryani masala, whole spices (bay leaf, cardamom, cloves, cinnamon), ghee
- **Vegetable frankie** — `vegetable-frankie.jpg` — whole-wheat rotis, boiled potato, mashed, onion, thinly sliced, butter, for toasting, frankie or chaat masala, red chilli powder, lemon juice, green chutney, salt
- **Vegetable fried rice** — `vegetable-fried-rice.jpg` — cooked rice (cooled), carrot (finely diced), french beans (finely chopped), capsicum (diced), spring onion (chopped), garlic (minced), oil, black pepper powder, salt
- **Vegetable sandwich** — `vegetable-sandwich.jpg` — whole-wheat bread, cucumber, thinly sliced, tomato, thinly sliced, onion, thinly sliced, capsicum, thinly sliced, boiled potato, sliced (optional), green mint-coriander chutney, chaat masala, black pe
- **Whole-wheat roti** — `whole-wheat-roti.jpg` — whole-wheat atta, water, salt, ghee (optional, to smear)
