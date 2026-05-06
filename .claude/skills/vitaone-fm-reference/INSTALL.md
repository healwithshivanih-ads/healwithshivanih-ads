# Installing the vitaone-fm-reference Skill

You have a complete Claude Skill directory. Here's how to use it.

## What's in this folder

```
vitaone-fm-reference/
├── SKILL.md                          # Main instructions + triggers (~250 lines)
├── INSTALL.md                        # This file
├── references/
│   ├── topic_index.md               # Fast symptom/topic lookup
│   ├── practice_guide.md            # Scope-aware coaching guide (~760 lines)
│   ├── evidence_tiers.md            # Evidence validation for 7 topics (~475 lines)
│   └── full_kb.md                   # 122-post comprehensive reference (~675 lines)
└── templates/
    ├── session_scaffold.md          # Client-case response structure
    └── referral_language.md         # How to refer out with good language
```

## How to use it — three options

### Option 1: Package as a .skill file and install (cleanest)

Skills are distributed as zip archives with a `.skill` extension.

**On your Mac, in Terminal:**

```bash
cd "/Users/shivanihariharan/Library/Application Support/Claude/local-agent-mode-sessions/5d66196c-fac0-40e5-9bab-3ee7808e6db4/5a03df05-6715-4af2-a44f-f0b6bd9f8449/local_0e967caf-e66b-47b0-b62f-ba3051979b18/outputs"

zip -r vitaone-fm-reference.skill vitaone-fm-reference
```

This creates `vitaone-fm-reference.skill` that you can install:

- **In Claude Code (CLI):** use the `/plugin` command and install from the local file
- **In Cowork (desktop app):** use the Settings → Skills (or equivalent) path, upload the .skill file

The skill will then be available in all future sessions across all Claude products that read the same skills directory.

### Option 2: Drop the folder into your user skills directory directly

On macOS, Anthropic-managed skills live at:

```
/var/folders/mz/p2ch26l1645gty_k6r3d9zdc0000gn/T/claude-hostloop-plugins/d834358eb00925e0/skills/
```

Inside there is a `user/` subfolder for your custom skills. You can copy the `vitaone-fm-reference/` folder directly in there:

```bash
# Adjust the path if your user skills folder is elsewhere
cp -r "/Users/shivanihariharan/Library/Application Support/Claude/local-agent-mode-sessions/5d66196c-fac0-40e5-9bab-3ee7808e6db4/5a03df05-6715-4af2-a44f-f0b6bd9f8449/local_0e967caf-e66b-47b0-b62f-ba3051979b18/outputs/vitaone-fm-reference" \
  /var/folders/mz/p2ch26l1645gty_k6r3d9zdc0000gn/T/claude-hostloop-plugins/d834358eb00925e0/skills/user/
```

⚠️ **Caveat:** that `/var/folders/...` path is a cache directory, so it may get cleared by macOS periodically. Option 1 (package as .skill and install properly through the UI) is more durable.

### Option 3: Use as a project folder with CLAUDE.md

If you mostly do coaching work from one folder on your computer (e.g. `~/Coaching/`), you can:

1. Copy `vitaone-fm-reference/` into that folder
2. Create a `CLAUDE.md` at the root of your coaching folder saying:

```markdown
# Functional Medicine Coaching Workspace

When I ask about client cases or say "refer vitaone", consult the skill in `./vitaone-fm-reference/SKILL.md` and follow its instructions. Always respect the scope rules in SKILL.md and the practice_guide.md.
```

This is less portable (only works when Claude is invoked in that folder) but requires no installation.

---

## Testing the skill after install

Once installed, future Claude sessions should recognize these prompts and activate the skill:

### Explicit activation

- **"Refer vitaone on perimenopause insomnia"**
- **"Check vitaone: is selenium for Hashimoto's supported?"**
- **"Vitaone reference for a 42yo with PCOS and fatigue"**
- **"FM reference on statin alternatives"**

### Implicit activation (the skill should trigger automatically)

- **"I have a client, 38, irregular cycles, acne, sugar cravings, fasting glucose 95"** → skill recognizes PCOS pattern and pulls relevant sections
- **"A client's LDL is high but TG is low — how should I think about this?"** → cholesterol content + thyroid consideration
- **"Is it true that gluten causes thyroid antibodies?"** → evidence tier on gluten-Hashimoto's

## How to iterate later

As you use it and find gaps:

1. **Topics not in the 7 focus areas need evidence validation:** say "Let's add evidence tiering for [topic]" — I'll do a fresh research pass and add a section to `evidence_tiers.md`.
2. **New client patterns you encounter:** "Add a case pattern for [presentation]" — I'll update `topic_index.md`.
3. **More VitaOne content:** run Apify again for the ~200 older posts, drop the JSON, I'll extend `full_kb.md`.
4. **Voice or scope tuning:** tell me what phrasing isn't working, I'll adjust `SKILL.md`.

The files are plain Markdown — you can also edit them directly with any text editor. If you do, keep the SKILL.md frontmatter (the YAML block at the top between `---` markers) intact, or Claude won't recognize it as a skill.

## Quick reference — what lives where

| If you need... | Read this file |
|---|---|
| Fast "what's this symptom about" | `references/topic_index.md` |
| "Can I recommend X in session?" | `references/practice_guide.md` |
| "Is this claim supported?" | `references/evidence_tiers.md` |
| Deep content on a specific post/topic | `references/full_kb.md` |
| How to structure a case response | `templates/session_scaffold.md` |
| How to phrase a referral | `templates/referral_language.md` |

## One last thing

This skill is personalized to you — FMCA-trained, nutrition background, India, on path to NBHWC. If your scope or context changes (e.g., you get an Integrative Nutritionist license, or move, or expand to a different population), the SKILL.md frontmatter should be updated so Claude's responses stay appropriately scoped.
