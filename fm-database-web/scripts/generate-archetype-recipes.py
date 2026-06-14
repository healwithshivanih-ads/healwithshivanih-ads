#!/usr/bin/env python3
"""Generate recipe YAMLs for active-plan dishes that have no recipe yet.

Dishes cluster into ~14 archetypes that share one correct technique (dry
sabzi, dal/tadka, khichdi, millet upma/porridge, flatbread, batter chilla/
dosa, egg, protein curry, paneer/tofu, chutney, salad, soup, poha, drink,
snack). The archetype is detected from the slug; the main ingredient is
inferred from the slug/dish so we don't hand-author 150 entries. Output is a
valid recipe YAML keyed by the exact dish slug (so the image pass and the
app's matcher both resolve cleanly).

Idempotent: never overwrites an existing recipe file.
"""
import sys, os, json, re, yaml

RECIPES = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                       "fm-database", "data", "_recipes"))
TODAY = "2026-06-12"


def title(dish):
    d = re.sub(r"\([^)]*\)", "", dish)
    d = re.split(r"—|;", d)[0]
    d = re.sub(r"\bwith\b.*$", "", d)
    d = re.sub(r"[½¾⅓¼]|^\d+\s*", "", d).strip()
    d = re.sub(r"\b(small|medium|large|fresh|light|new|cup|cups|tbsp|tsp|bowl|"
               r"portion|g|grams|piece|first|intro|introduce|today|style|"
               r"homemade|home-set|plain|well|cooked|dry|semi-solid|combined)\b",
               "", d, flags=re.I)
    d = re.sub(r"\s+", " ", d).strip(" -")
    return d[:1].upper() + d[1:] if d else dish


# main ingredient inferred by stripping the archetype suffix from the slug
def main_of(slug, *suffixes):
    s = slug
    for suf in suffixes:
        s = re.sub(suf, "", s)
    return s.replace("-", " ").strip() or "vegetable"


def rec(slug, name, mtype, diet, ingredients, steps, one_line, headnote,
        dosha=("vata", "pitta", "kapha"), good_for=("agni-digestive-fire",),
        kcal=180, protein=6, region="Indian", allergens=()):
    return {
        "slug": slug, "name": name, "meal_type": list(mtype), "diet": list(diet),
        "region": region, "seasons": ["all"],
        "balances_dosha": list(dosha), "aggravates_dosha": [],
        "rasa": ["sweet", "pungent"],
        "main_ingredients": [i["item"] for i in ingredients],
        "contains_allergens": list(allergens),
        "ingredients": ingredients, "steps": steps,
        "servings": "2", "prep_time_min": 10, "cook_time_min": 15,
        "approx_kcal_per_serving": kcal, "kcal_is_estimate": True,
        "protein_g": protein, "good_for": list(good_for),
        "one_line": one_line, "headnote": headnote,
        "attribution": {"author": "Shivani Hari", "source_id": "shivani-hari-original"},
        "sources": [{"id": "shivani-hari-original", "location": name}],
        "version": 1, "status": "active",
        "updated_at": TODAY, "updated_by": "Shivani",
    }


def ing(item, qty, unit=""):
    return {"item": item, "qty": str(qty), "unit": unit}


# ---- archetype builders -----------------------------------------------------
def dry_sabzi(slug, dish, veg):
    name = title(dish)
    return rec(
        slug, name, ("lunch", "dinner"), ("vegetarian", "vegan", "gluten_free"),
        [ing(f"{veg}, diced", 2, "cups"), ing("ghee or coconut oil", 1, "tbsp"),
         ing("mustard seeds", 0.5, "tsp"), ing("cumin seeds", 0.5, "tsp"),
         ing("curry leaves", "8-10", "leaves"), ing("ginger, grated", 1, "tsp"),
         ing("turmeric", 0.25, "tsp"), ing("grated fresh coconut (optional)", 2, "tbsp"),
         ing("salt", "to taste"), ing("fresh coriander, chopped", 2, "tbsp")],
        ["Heat ghee in a kadai over medium heat. Add mustard seeds and let them pop, "
         "then add cumin seeds, curry leaves, and ginger; sauté 30 seconds until fragrant.",
         f"Add the diced {veg} and turmeric. Stir to coat in the tempering.",
         "Add salt, cover, and cook on low 8-12 minutes, stirring occasionally, until "
         "the vegetable is just tender (not mushy). Add a splash of water only if it sticks.",
         "Uncover, raise heat briefly to dry off any moisture. Stir in grated coconut "
         "if using.",
         "Garnish with fresh coriander and serve warm with roti or rice."],
        f"A light, dry South-Indian style {veg} sabzi tempered with mustard, cumin and curry leaves.",
        f"Cooking {veg} gently with a simple tempering keeps it easy to digest and lets the "
        "vegetable's own flavour come through — no heavy gravy, no tomato.",
        good_for=("agni-digestive-fire", "digestion-and-nutrient-absorption"), kcal=120, protein=4)


def dal_tadka(slug, dish, lentil):
    name = title(dish)
    return rec(
        slug, name, ("lunch", "dinner"), ("vegetarian", "gluten_free"),
        [ing(f"{lentil}", 0.75, "cup"), ing("turmeric", 0.5, "tsp"),
         ing("ghee", 1, "tbsp"), ing("cumin seeds", 0.5, "tsp"),
         ing("ginger, grated", 1, "tsp"), ing("curry leaves", "8-10", "leaves"),
         ing("asafoetida (hing)", "1 pinch"), ing("salt", "to taste"),
         ing("lemon juice", 1, "tsp"), ing("fresh coriander", 2, "tbsp")],
        [f"Rinse the {lentil} well. Pressure-cook with turmeric and 2.5 cups water "
         "until soft (3-4 whistles), or simmer covered 25-30 minutes. Whisk smooth.",
         "Heat ghee in a small pan. Add cumin seeds, let them splutter, then add ginger, "
         "curry leaves, and a pinch of hing; sauté 20 seconds.",
         "Pour the tempering into the cooked dal. Add salt and a little hot water for a "
         "pourable consistency. Simmer 3-4 minutes.",
         "Finish with lemon juice and coriander. Serve warm with rice or roti."],
        f"A comforting, well-tempered {lentil} simmered soft and finished with a ghee-cumin tadka.",
        f"A simple {lentil} is one of the most digestible protein sources — cooked soft, "
        "spiced gently with cumin and ginger, and kept free of heavy onion-tomato gravy.",
        good_for=("agni-digestive-fire", "digestion-and-nutrient-absorption"), kcal=190, protein=11)


def khichdi(slug, dish, grain):
    name = title(dish)
    return rec(
        slug, name, ("lunch", "dinner"), ("vegetarian", "gluten_free"),
        [ing(f"{grain}", 0.5, "cup"), ing("split yellow moong dal", 0.25, "cup"),
         ing("ghee", 1, "tbsp"), ing("cumin seeds", 0.5, "tsp"),
         ing("ginger, grated", 1, "tsp"), ing("turmeric", 0.25, "tsp"),
         ing("mixed vegetables, diced (carrot, beans, peas)", 1, "cup"),
         ing("asafoetida (hing)", "1 pinch"), ing("salt", "to taste")],
        [f"Rinse the {grain} and moong dal together until the water runs clear.",
         "Heat ghee in a pressure cooker. Add cumin seeds, ginger, and hing; sauté 20 seconds.",
         "Add the diced vegetables and turmeric; stir 1 minute.",
         f"Add the drained {grain}-dal, salt, and 3 cups water. Pressure-cook 3-4 whistles "
         "(or simmer covered 25 minutes) until soft and porridge-like.",
         "Rest 5 minutes, fluff gently, and serve warm with a little extra ghee."],
        f"A soft, one-pot {grain} khichdi with moong dal and vegetables — the classic gut-rest meal.",
        f"Khichdi is Ayurveda's most healing everyday meal: {grain} and moong dal cooked soft "
        "together are easy to digest and gently nourishing.",
        good_for=("agni-digestive-fire", "gut-health", "digestion-and-nutrient-absorption"),
        kcal=240, protein=9)


def millet_upma(slug, dish, grain):
    name = title(dish)
    return rec(
        slug, name, ("breakfast", "lunch"), ("vegetarian", "vegan", "gluten_free"),
        [ing(f"{grain}", 1, "cup"), ing("ghee or coconut oil", 1, "tbsp"),
         ing("mustard seeds", 0.5, "tsp"), ing("urad dal", 1, "tsp"),
         ing("curry leaves", "8-10", "leaves"), ing("ginger, grated", 1, "tsp"),
         ing("onion, chopped (optional)", 0.5, "medium"),
         ing("mixed vegetables, diced (carrot, peas, beans)", 0.75, "cup"),
         ing("salt", "to taste"), ing("fresh coriander", 2, "tbsp")],
        [f"Dry-roast the {grain} in a pan 2-3 minutes until nutty. Set aside.",
         "Heat ghee, add mustard seeds and urad dal; once they pop add curry leaves, "
         "ginger, and onion. Sauté until soft.",
         "Add diced vegetables; stir-fry 2 minutes.",
         f"Add 2.5 cups water and salt; bring to a boil. Stir in the roasted {grain}.",
         "Cover and cook on low 12-15 minutes until the water is absorbed and the grain "
         "is fluffy. Rest 5 minutes, garnish with coriander, and serve warm."],
        f"A savoury, fluffy {grain} upma tempered with mustard and curry leaves and studded with vegetables.",
        f"Dry-roasting the {grain} before cooking keeps the upma light and fluffy rather "
        "than sticky — a warm, grounding breakfast that's gentle on digestion.",
        good_for=("agni-digestive-fire", "blood-sugar-regulation"), kcal=260, protein=6)


def millet_porridge(slug, dish, grain):
    name = title(dish)
    return rec(
        slug, name, ("breakfast",), ("vegetarian", "gluten_free"),
        [ing(f"{grain}", 0.5, "cup"), ing("water or thin milk", 2, "cups"),
         ing("ghee", 1, "tsp"), ing("cardamom powder", "1 pinch"),
         ing("dates or soaked raisins", 4, "pieces"), ing("salt", "1 pinch")],
        [f"Rinse the {grain} well.",
         f"Combine {grain} with water (or thin milk), a pinch of salt, and chopped dates "
         "in a pot.",
         "Cook covered on low 15-20 minutes, stirring occasionally, until soft and creamy. "
         "Add more liquid if needed.",
         "Stir in ghee and cardamom. Serve warm."],
        f"A creamy, lightly sweet {grain} porridge — a warm, easy-to-digest start to the day.",
        f"Slow-cooked {grain} porridge is grounding and soothing, naturally sweetened with "
        "dates and warmed with cardamom.",
        good_for=("agni-digestive-fire", "digestion-and-nutrient-absorption"), kcal=230, protein=5)


def flatbread(slug, dish, flour):
    name = title(dish)
    return rec(
        slug, name, ("lunch", "dinner"), ("vegetarian", "vegan", "gluten_free"),
        [ing(f"{flour} flour", 1.5, "cups"), ing("warm water", "as needed"),
         ing("salt", "to taste"), ing("ghee or oil", 1, "tsp")],
        [f"Mix {flour} flour with salt. Add warm water a little at a time, kneading into "
         "a soft, pliable dough. Rest 10 minutes.",
         "Divide into balls. Pat or roll each into a round flatbread on a floured surface "
         "(gluten-free flours roll best between two sheets of parchment).",
         "Cook on a hot tava 1-2 minutes per side until brown spots appear and it puffs.",
         "Smear lightly with ghee and serve warm."],
        f"A wholesome {flour} flatbread — naturally gluten-free and far steadier on blood sugar than wheat.",
        f"{flour.capitalize()} rotis are a traditional millet/whole-grain bread: more fibre, "
        "more minerals, and a gentler glucose response than refined wheat.",
        good_for=("blood-sugar-regulation", "agni-digestive-fire"), kcal=120, protein=3)


def batter_chilla(slug, dish, base):
    name = title(dish)
    return rec(
        slug, name, ("breakfast", "lunch"), ("vegetarian", "gluten_free"),
        [ing(f"{base}", 1, "cup"), ing("water", "as needed"),
         ing("ginger, grated", 1, "tsp"), ing("green chilli, minced (optional)", 1, "piece"),
         ing("turmeric", 0.25, "tsp"), ing("finely chopped vegetables (onion, capsicum, coriander)", 0.5, "cup"),
         ing("salt", "to taste"), ing("ghee or oil for cooking", 2, "tsp")],
        [f"Whisk {base} with water into a smooth, pourable batter (like thin pancake batter).",
         "Stir in ginger, chilli, turmeric, chopped vegetables, and salt. Rest 10 minutes.",
         "Heat a non-stick or cast-iron tava on medium. Lightly grease. Pour a ladle of "
         "batter and spread into a thin round.",
         "Drizzle a few drops of ghee around the edge. Cook 2-3 minutes until the base is "
         "golden, flip, and cook the other side 1-2 minutes.",
         "Serve hot with chutney."],
        f"A savoury, protein-rich {name.lower()} — quick, gut-friendly, and naturally gluten-free.",
        "A simple batter cooked thin on a tava makes a light, savoury pancake that's high in "
        "protein and easy to digest — a far better breakfast than refined flour.",
        good_for=("agni-digestive-fire", "blood-sugar-regulation"), kcal=180, protein=10)


def egg_dish(slug, dish):
    name = title(dish)
    scramble = any(k in slug for k in ("bhurji", "scramble", "masala-egg"))
    return rec(
        slug, name, ("breakfast", "lunch"), ("eggetarian", "gluten_free"),
        [ing("eggs", 2 if "egg" in slug else 3, "whole"),
         ing("ghee or coconut oil", 1, "tsp"), ing("cumin seeds", 0.25, "tsp"),
         ing("onion, chopped", 0.5, "medium"),
         ing("vegetables (capsicum, spinach, tomato)", 0.5, "cup"),
         ing("turmeric", 0.25, "tsp"), ing("salt and pepper", "to taste"),
         ing("fresh coriander", 1, "tbsp")],
        ["Heat ghee, add cumin seeds, then onion; sauté until soft.",
         "Add the chopped vegetables and turmeric; cook 2-3 minutes until tender.",
         ("Beat the eggs with salt and pepper, pour in, and stir continuously until just "
          "set and soft." if scramble else
          "Beat the eggs with salt and pepper, pour over the vegetables, and cook covered "
          "on low until set, folding once."),
         "Garnish with coriander and serve warm."],
        f"A protein-rich {name.lower()} cooked with vegetables and gentle spices.",
        "Eggs cooked with vegetables and a light tempering make a steady, protein-forward "
        "meal that keeps blood sugar even through the morning.",
        dosha=("vata", "kapha"), good_for=("agni-digestive-fire",), kcal=220, protein=14)


def protein_curry(slug, dish, protein):
    name = title(dish)
    veg = "non_vegetarian"
    stew = "stew" in slug or "soup" in slug
    return rec(
        slug, name, ("lunch", "dinner"), (veg, "gluten_free"),
        [ing(f"{protein}", 150, "g"), ing("coconut oil", 1, "tbsp"),
         ing("onion, sliced", 1, "medium"), ing("ginger-garlic paste", 1, "tbsp"),
         ing("curry leaves", "8-10", "leaves"), ing("turmeric", 0.5, "tsp"),
         ing("coriander powder", 1, "tsp"), ing("light coconut milk", 0.5, "cup"),
         ing("salt", "to taste"), ing("fresh coriander", 2, "tbsp")],
        [f"Clean and cut the {protein} into pieces.",
         "Heat coconut oil, add onion and curry leaves; sauté until golden. Add "
         "ginger-garlic paste and cook 1 minute.",
         "Add turmeric and coriander powder; stir 30 seconds.",
         f"Add the {protein} and salt; sear 2-3 minutes. Pour in coconut milk and "
         f"{'enough water for a light broth' if stew else 'a little water'}. "
         "Cover and simmer until just cooked through (fish 8-10 min, chicken 18-20 min, "
         "prawns 5-6 min).",
         "Finish with fresh coriander. Serve warm with rice or millet."],
        f"A light, coconut-based {name.lower()} — no tomato, gently spiced and freshly made.",
        f"Freshly cooked {protein} in a light coconut-curry-leaf base keeps the meal "
        "clean and easy to digest — no heavy tomato gravy, made the same day.",
        dosha=("vata", "kapha"), good_for=("agni-digestive-fire",), kcal=260, protein=24,
        region="South Indian")


def paneer_tofu(slug, dish):
    name = title(dish)
    is_tofu = "tofu" in slug
    base = "firm tofu" if is_tofu else "paneer"
    diet = ("vegan", "gluten_free") if is_tofu else ("vegetarian", "gluten_free")
    allergens = () if is_tofu else ("dairy",)
    return rec(
        slug, name, ("lunch", "dinner"), diet,
        [ing(f"{base}, cubed", 150, "g"), ing("ghee or oil", 1, "tbsp"),
         ing("cumin seeds", 0.5, "tsp"), ing("ginger, grated", 1, "tsp"),
         ing("vegetables (capsicum, spinach, mushroom)", 1, "cup"),
         ing("turmeric", 0.25, "tsp"), ing("salt", "to taste"),
         ing("fresh coriander", 2, "tbsp")],
        ["Heat ghee, add cumin seeds and ginger; sauté 30 seconds.",
         "Add the vegetables and turmeric; cook 3-4 minutes until tender.",
         f"Add the {base} and salt; toss gently 3-4 minutes until heated through and "
         "lightly golden (don't overcook or it toughens).",
         "Garnish with coriander and serve warm."],
        f"A simple, protein-rich {name.lower()} with vegetables and a light tempering.",
        f"{base.capitalize()} cooked simply with vegetables is a quick, satisfying protein "
        "that doesn't need a heavy gravy to taste good.",
        dosha=("vata", "kapha"), good_for=("agni-digestive-fire",), kcal=240, protein=16)


def chutney(slug, dish, base):
    name = title(dish)
    return rec(
        slug, name, ("condiment",), ("vegetarian", "vegan", "gluten_free"),
        [ing(f"{base}", 1, "cup"), ing("grated coconut", 0.25, "cup"),
         ing("ginger", "1 inch"), ing("green chilli (optional)", 1, "piece"),
         ing("lemon juice", 1, "tbsp"), ing("salt", "to taste"),
         ing("water", "as needed"),
         ing("for tempering: coconut oil, mustard seeds, curry leaves", "1 set")],
        [f"Blend {base}, coconut, ginger, chilli, lemon juice, and salt with a little "
         "water into a smooth chutney.",
         "Heat a little coconut oil, pop mustard seeds and curry leaves, and pour over "
         "the chutney.",
         "Serve fresh alongside chilla, dosa, idli, or rice."],
        f"A fresh, bright {name.lower()} to lift any meal — no preservatives, made fresh.",
        "Fresh chutneys add flavour, enzymes, and a hit of herbs without sugar or "
        "preservatives — make a small batch and use it the same day.",
        good_for=("agni-digestive-fire",), kcal=70, protein=2, region="South Indian")


def salad(slug, dish):
    name = title(dish)
    return rec(
        slug, name, ("salad", "side"), ("vegetarian", "vegan", "gluten_free"),
        [ing("mixed salad vegetables / sprouts (as named)", 2, "cups"),
         ing("cucumber, diced", 0.5, "cup"), ing("lemon juice", 1, "tbsp"),
         ing("roasted cumin powder", 0.5, "tsp"), ing("rock salt", "to taste"),
         ing("fresh coriander and mint", 2, "tbsp"),
         ing("coconut oil or cold-pressed oil (optional)", 1, "tsp")],
        ["Chop or lightly steam the main vegetables/sprouts as appropriate (sprouts are "
         "gentler on digestion lightly steamed).",
         "Toss with cucumber, lemon juice, roasted cumin, and rock salt.",
         "Fold through fresh herbs and a touch of oil if using. Serve fresh."],
        f"A fresh, crunchy {name.lower()} dressed simply with lemon, cumin, and herbs.",
        "A simple salad of fresh or lightly steamed vegetables with lemon and roasted cumin "
        "adds fibre and freshness — sprouts are best lightly steamed for easy digestion.",
        good_for=("agni-digestive-fire", "digestion-and-nutrient-absorption"),
        kcal=110, protein=6, region="Indian")


def soup(slug, dish, veg):
    name = title(dish)
    return rec(
        slug, name, ("soup", "dinner"), ("vegetarian", "vegan", "gluten_free"),
        [ing(f"{veg}, chopped", 2, "cups"), ing("ghee or coconut oil", 1, "tsp"),
         ing("cumin seeds", 0.5, "tsp"), ing("ginger, grated", 1, "tsp"),
         ing("black pepper", 0.25, "tsp"), ing("salt", "to taste"),
         ing("lemon juice", 1, "tsp"), ing("fresh coriander", 2, "tbsp")],
        ["Heat ghee, add cumin seeds and ginger; sauté 30 seconds.",
         f"Add the chopped {veg} and 3 cups water. Simmer covered 12-15 minutes until soft.",
         "Blend smooth (or leave brothy). Season with salt and pepper.",
         "Finish with lemon juice and coriander. Serve warm."],
        f"A light, warming {name.lower()} — soothing and easy on digestion.",
        f"A gentle {veg} soup with ginger and pepper is warming, hydrating, and the perfect "
        "light dinner when you want to rest the gut.",
        good_for=("agni-digestive-fire", "gut-health"), kcal=90, protein=3)


def poha(slug, dish):
    name = title(dish)
    return rec(
        slug, name, ("breakfast",), ("vegetarian", "vegan", "gluten_free"),
        [ing("flattened millet/rice poha", 1.5, "cups"),
         ing("coconut oil", 1, "tbsp"), ing("mustard seeds", 0.5, "tsp"),
         ing("curry leaves", "8-10", "leaves"), ing("onion, chopped", 0.5, "medium"),
         ing("peas and diced vegetables", 0.5, "cup"), ing("turmeric", 0.25, "tsp"),
         ing("roasted peanuts (optional)", 2, "tbsp"), ing("salt", "to taste"),
         ing("lemon juice and coriander", "to finish")],
        ["Rinse the poha briefly in a colander until just softened; drain and set aside.",
         "Heat oil, pop mustard seeds, add curry leaves and onion; sauté until soft.",
         "Add vegetables, turmeric, peanuts, and salt; cook 3-4 minutes.",
         "Fold in the drained poha gently, warm through 2 minutes.",
         "Finish with lemon juice and coriander. Serve warm."],
        f"A light, savoury {name.lower()} — a quick, no-sugar breakfast.",
        "Poha made with millet or rice flakes and plenty of vegetables is a light, quick "
        "breakfast — skip the sugar and lean on lemon and curry leaves for flavour.",
        good_for=("agni-digestive-fire",), kcal=220, protein=5)


# ---- dispatch ---------------------------------------------------------------
def build(slug, dish):
    s = slug
    # order matters — most specific first
    if re.search(r"chutney", s):
        return chutney(s, dish, main_of(s, r"-?chutney", r"coconut-", r"coriander-",
                                        r"green-", r"til-", r"mint-", r"ginger-") or "coriander")
    if re.search(r"(salad|kachumber|chaat|slaw)", s):
        return salad(s, dish)
    if re.search(r"soup", s):
        return soup(s, dish, main_of(s, r"-?soup", r"-?clear", r"-?ginger", r"-?lemon",
                                     r"-?coriander", r"vegetable-") or "vegetable")
    if re.search(r"(khichdi|kichari)", s):
        return khichdi(s, dish, main_of(s, r"-?khichdi", r"-?millet", r"-?rice",
                                        r"vegetable-", r"mixed-veg-?", r"light-") or "millet")
    if re.search(r"porridge", s):
        return millet_porridge(s, dish, main_of(s, r"-?porridge", r"-?millet") or "millet")
    if re.search(r"(upma|pongal|pulao|pulav|stir-fry.*millet|millet.*stir)", s) and "millet" in s or re.search(r"(upma|pongal)", s):
        return millet_upma(s, dish, main_of(s, r"-?upma", r"-?pongal", r"-?pulao",
                                            r"-?and-vegetable-stir-fry", r"-?millet") or "millet")
    if re.search(r"(roti|bhakri|rotis)", s):
        return flatbread(s, dish, main_of(s, r"-?rotis?", r"-?bhakri", r"-?millet") or "millet")
    if re.search(r"(chilla|cheela|chila|dosa|idli|uttapam|besan-omelette)", s):
        base = "besan (gram flour)" if "besan" in s else \
               "soaked split moong dal, ground" if "moong" in s else \
               "fermented millet-and-dal batter" if any(g in s for g in ("ragi", "nachni", "foxtail", "little", "jowar")) else \
               "fermented rice-and-dal batter"
        return batter_chilla(s, dish, base)
    if re.search(r"(prawn|chicken|fish|lamb|keema|sukka)", s):
        prot = "chicken" if "chicken" in s or "keema" in s or "sukka" in s else \
               "prawns" if "prawn" in s else "fish" if "fish" in s else "lean lamb"
        return protein_curry(s, dish, prot)
    if re.search(r"egg", s):
        return egg_dish(s, dish)
    if re.search(r"(paneer|tofu)", s):
        return paneer_tofu(s, dish)
    if re.search(r"(dal|sambar|chana-masala)", s) and "khichdi" not in s:
        lentil = "toor dal" if "sambar" in s else \
                 "chickpeas (chana)" if "chana-masala" in s else \
                 main_of(s, r"-?dal", r"-?fry", r"-?tadka", r"mixed-", r"moringa-powder-in-") or "yellow lentils"
        if "sambar" in s:
            lentil = "toor dal"
        return dal_tadka(s, dish, lentil)
    if re.search(r"poha", s):
        return poha(s, dish)
    if re.search(r"(sabzi|subzi|sabji|thoran|poriyal|bharta|muthia)", s):
        veg = main_of(s, r"-?sabzi", r"-?subzi", r"-?sabji", r"-?coconut-thoran",
                      r"-?thoran", r"-?coconut-poriyal", r"-?poriyal", r"-?bharta",
                      r"-?muthia", r"mixed-", r"sprouted-", r"green-") or "mixed vegetable"
        return dry_sabzi(s, dish, veg)
    return None  # unhandled → skip (drinks/snacks/desserts handled elsewhere or left)


def main():
    dishes = json.load(open(sys.argv[1]))
    made, skipped, unhandled = [], [], []
    for d in dishes:
        slug = d["slug"]
        path = os.path.join(RECIPES, slug + ".yaml")
        if os.path.exists(path):
            skipped.append(slug)
            continue
        r = build(slug, d["dish"])
        if not r:
            unhandled.append(slug)
            continue
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(r, f, sort_keys=False, allow_unicode=True, width=100)
        made.append(slug)
    print(f"created={len(made)} skipped(existing)={len(skipped)} unhandled={len(unhandled)}")
    if unhandled:
        print("UNHANDLED:", ", ".join(unhandled))


if __name__ == "__main__":
    main()
