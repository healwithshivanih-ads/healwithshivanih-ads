# ── Campaign config — edit these to change targeting, budget, copy ─────────────

CAMPAIGN_NAME = "Heal With Shivanih — Follower Growth"
DAILY_BUDGET_INR = 30000  # in paise (₹300 = 30000 paise)

# Targeting
TARGETING = {
    "age_min": 28,
    "age_max": 52,
    "genders": [2],  # 1=male, 2=female
    "geo_locations": {
        "countries": ["IN"],
        "cities": [
            {"key": "2295424"},   # Mumbai
            {"key": "2295378"},   # Delhi
            {"key": "2295395"},   # Bangalore
            {"key": "2295414"},   # Hyderabad
            {"key": "2295421"},   # Pune
            {"key": "2295389"},   # Chennai
        ]
    },
    "locales": [6],  # English
    "publisher_platforms": ["instagram"],
    "instagram_positions": ["reels", "story", "stream"],
    "device_platforms": ["mobile"],
}

# Interest keywords to search + apply
INTEREST_KEYWORDS = [
    "Yoga",
    "Ayurveda",
    "Diabetes",
    "PCOS",
    "Functional medicine",
    "Holistic health",
    "Women's health",
    "Nutrition",
]

# Ad copy per creative
ADS = [
    {
        "name":        "Ad A — 6s Reels",
        "video_file":  "../out/ad_6s.mp4",
        "thumb_file":  "../out/cover.png",
        "message":     "Doctors won't tell you this one. A 10-minute walk after meals lowers blood sugar by up to 30% — no pills, no gym, no cost. Follow @healwithshivanih for more.",
        "headline":    "The free habit that beats most supplements",
        "description": "Simple functional health tip",
        "placement":   "reels",
    },
    {
        "name":        "Ad B — 15s Stories",
        "video_file":  "../out/ad_15s.mp4",
        "thumb_file":  "../out/cover_b.png",
        "message":     "What if the most powerful metabolic tool was already built into your body? 🚶‍♀️ Walk for 10 minutes after eating. Science says it cuts post-meal blood sugar spikes by up to 30%. No prescription. No side effects. Follow for one functional health tip a week.",
        "headline":    "Functional health, made simple",
        "description": "Follow @healwithshivanih",
        "placement":   "story",
    },
    {
        "name":        "Ad C — Cover A (image)",
        "image_file":  "../out/cover.png",
        "message":     "Doctors won't tell you this one. A 10-minute walk after meals lowers blood sugar by up to 30% — no pills, no gym, no cost. Follow @healwithshivanih for more.",
        "headline":    "This 10-min habit lowers blood sugar by 30%",
        "description": "No gym. No pills. No prescription.",
        "placement":   "stream",
    },
    {
        "name":        "Ad D — Cover B (image)",
        "image_file":  "../out/cover_b.png",
        "message":     "30% lower blood sugar spikes — from a walk? Yes, really. The science is simpler than you think. Follow @healwithshivanih for weekly functional health tips.",
        "headline":    "From a walk? Yes, really.",
        "description": "The science is simpler than you think.",
        "placement":   "stream",
    },
]
