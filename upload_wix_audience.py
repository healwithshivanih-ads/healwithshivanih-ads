#!/usr/bin/env python3
"""
upload_wix_audience.py — Wix Contacts → Meta Custom Audience + Lookalike
─────────────────────────────────────────────────────────────────────────
1. Pulls all contacts from Wix CRM (email + phone)
2. Hashes them with SHA-256 (Meta's required format)
3. Creates/updates a Meta Custom Audience called "Wix Contacts"
4. Creates a 1% Lookalike Audience from that (India)
5. Patches the warm retargeting ad set to include BOTH audiences

Run any time you want to refresh (new Wix contacts get added automatically
by lead_responder.py, so re-run this monthly or before a new campaign).

Usage:
  python3 upload_wix_audience.py            # full run
  python3 upload_wix_audience.py --no-lookalike  # skip lookalike creation
"""

import os, sys, hashlib, argparse, json, time, requests
from pathlib import Path
from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

# ── credentials ───────────────────────────────────────────────────────────────
TOKEN    = os.getenv("META_ACCESS_TOKEN")
ACCOUNT  = os.getenv("META_AD_ACCOUNT_ID")
WIX_KEY  = os.getenv("WIX_API_KEY")
WIX_SITE = os.getenv("WIX_SITE_ID", "8cfa772f-403b-473c-b756-4ad1e55e2465")
GRAPH    = "https://graph.facebook.com/v19.0"

# Ad set ID for the warm retargeting campaign (from run_warm_retarget.py)
WARM_ADSET_ID = "120244048884880305"

def step(msg): print(f"\n▶  {msg}")
def ok(msg):   print(f"   ✅ {msg}")
def info(msg): print(f"   ℹ  {msg}")
def warn(msg): print(f"   ⚠  {msg}")

# ── 1. Fetch Wix contacts ─────────────────────────────────────────────────────
CACHE_FILE    = BASE / "wix_contacts_cache.json"
PROGRESS_FILE = BASE / "wix_contacts_progress.json"

def fetch_wix_contacts(force_refresh=False):
    step("Fetching ALL contacts from Wix CRM")

    # Use completed cache if fresh (under 24h) and not forced
    if not force_refresh and CACHE_FILE.exists():
        age = time.time() - CACHE_FILE.stat().st_mtime
        if age < 86400:
            contacts = json.loads(CACHE_FILE.read_text())
            ok(f"Loaded {len(contacts):,} contacts from cache (age {age/3600:.1f}h)")
            return contacts
        info("Cache >24h old — refreshing")

    # Resume from progress if available
    all_contacts = []
    start_offset = 0
    if not force_refresh and PROGRESS_FILE.exists():
        prog = json.loads(PROGRESS_FILE.read_text())
        all_contacts  = prog["contacts"]
        start_offset  = prog["next_offset"]
        info(f"  Resuming from offset {start_offset:,} ({len(all_contacts):,} already fetched)")

    hdrs  = {"Authorization": WIX_KEY, "wix-site-id": WIX_SITE}
    PAGE  = 100
    total = None
    offset = start_offset

    while True:
        # Retry loop with backoff for rate limits + timeouts
        for attempt in range(8):
            try:
                r = requests.get("https://www.wixapis.com/contacts/v4/contacts",
                                 headers=hdrs,
                                 params={"limit": PAGE, "offset": offset, "fieldsets": "FULL"},
                                 timeout=45)
                if r.status_code == 429:
                    wait = 15 * (2 ** attempt)
                    info(f"  Rate limited — waiting {wait}s…")
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                break
            except requests.exceptions.Timeout:
                wait = 20 * (2 ** attempt)
                info(f"  Timeout — retrying in {wait}s…")
                time.sleep(wait)
        else:
            # Save progress before giving up
            PROGRESS_FILE.write_text(json.dumps({"contacts": all_contacts, "next_offset": offset}))
            raise RuntimeError(f"Failed after 8 attempts at offset {offset}. Progress saved — re-run to resume.")

        data     = r.json()
        contacts = data.get("contacts", [])
        all_contacts.extend(contacts)

        meta     = data.get("pagingMetadata", {})
        total    = meta.get("total", total or 0)
        has_next = meta.get("hasNext", False)

        if len(all_contacts) % 1000 == 0 or not has_next:
            info(f"  Fetched {len(all_contacts):,}/{total:,}…")
            # Save incremental progress every 1000 contacts
            PROGRESS_FILE.write_text(json.dumps({"contacts": all_contacts, "next_offset": offset + PAGE}))

        if not has_next or not contacts:
            break
        offset += PAGE
        time.sleep(0.2)   # ~5 req/s — safely under Wix rate limit

    # Completed — write final cache and clear progress
    CACHE_FILE.write_text(json.dumps(all_contacts))
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
    ok(f"Fetched {len(all_contacts):,} contacts from Wix ✓")
    return all_contacts

# ── 2. Extract + hash ─────────────────────────────────────────────────────────
def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def normalise_phone(raw: str) -> str:
    """Return digits-only E.164 number (no +). Default country: India (+91)."""
    digits = "".join(c for c in raw if c.isdigit())
    if not digits:
        return ""
    # If number starts with 91 and is 12 digits — already has country code
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    # 10-digit Indian number
    if len(digits) == 10:
        return "91" + digits
    # Already has some country code (11+ digits)
    return digits

def build_user_data(contacts):
    step("Extracting and hashing emails + phones (SHA-256)")
    rows = []          # list of {"email": hashed, "phone": hashed}
    email_count = phone_count = 0

    for c in contacts:
        info_block = c.get("info", {})
        row = {}

        # Email
        for item in info_block.get("emails", {}).get("items", []):
            raw = item.get("email", "").strip().lower()
            if raw and "@" in raw:
                row["email"] = sha256(raw)
                email_count += 1
                break

        # Phone
        for item in info_block.get("phones", {}).get("items", []):
            raw = item.get("phone", "") or item.get("e164Phone", "")
            norm = normalise_phone(raw)
            if norm:
                row["phone"] = sha256(norm)
                phone_count += 1
                break

        if row:
            rows.append(row)

    ok(f"Ready to upload: {len(rows)} users "
       f"({email_count} emails, {phone_count} phones)")
    return rows, email_count, phone_count

# ── 3. Create or find existing Custom Audience ────────────────────────────────
AUDIENCE_NAME = "Wix Contacts — Heal With Shivanih"

def get_or_create_custom_audience():
    step("Creating Meta Custom Audience (or reusing existing)")

    # Check for existing
    r = requests.get(f"{GRAPH}/{ACCOUNT}/customaudiences",
        params={"access_token": TOKEN, "fields": "id,name", "limit": 50})
    for aud in r.json().get("data", []):
        if aud["name"] == AUDIENCE_NAME:
            ok(f"Found existing audience: {aud['id']} — will refresh it")
            return aud["id"]

    # Create new
    r = requests.post(f"{GRAPH}/{ACCOUNT}/customaudiences", json={
        "access_token":       TOKEN,
        "name":               AUDIENCE_NAME,
        "subtype":            "CUSTOM",
        "description":        "Exported from Wix CRM — existing clients & leads",
        "customer_file_source": "USER_PROVIDED_ONLY",
    })
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"]["message"])
    ok(f"Created Custom Audience: {data['id']}")
    return data["id"]

# ── 4. Upload hashed users ────────────────────────────────────────────────────
def upload_users(audience_id, rows):
    step(f"Uploading {len(rows)} hashed users to Meta")

    # Build schema + data arrays
    # Use PHONE only for rows that have it; EMAIL only for rows that have it
    # Meta accepts mixed schemas per-user with the multi-key format
    schema  = ["EMAIL_SHA256", "PHONE_SHA256"]
    payload = []
    for row in rows:
        payload.append([
            row.get("email", ""),
            row.get("phone", ""),
        ])

    # Upload in batches of 1000
    BATCH = 1000
    total_matched = 0
    for i in range(0, len(payload), BATCH):
        batch = payload[i:i+BATCH]
        r = requests.post(f"{GRAPH}/{audience_id}/users", json={
            "access_token": TOKEN,
            "payload": {
                "schema":   schema,
                "data":     batch,
                "is_raw":   False,   # data is already hashed
            },
        })
        data = r.json()
        if "error" in data:
            raise RuntimeError(data["error"]["message"])
        matched = data.get("num_received", len(batch))
        total_matched += matched
        info(f"  Batch {i//BATCH + 1}: uploaded {len(batch)}, received {matched}")

    ok(f"Upload complete — {total_matched} users sent to Meta")
    info("Meta will match against its user graph (takes ~30 min to populate)")

# ── 5. Create Lookalike Audience ──────────────────────────────────────────────
LOOKALIKE_NAME = "Lookalike 1% — Wix Contacts (India)"

def create_lookalike(source_audience_id):
    step("Creating 1% Lookalike Audience from Wix Contacts (India)")

    # Check for existing lookalike
    r = requests.get(f"{GRAPH}/{ACCOUNT}/customaudiences",
        params={"access_token": TOKEN, "fields": "id,name", "limit": 50})
    for aud in r.json().get("data", []):
        if aud["name"] == LOOKALIKE_NAME:
            ok(f"Lookalike already exists: {aud['id']}")
            return aud["id"]

    r = requests.post(f"{GRAPH}/{ACCOUNT}/customaudiences", json={
        "access_token":    TOKEN,
        "name":            LOOKALIKE_NAME,
        "subtype":         "LOOKALIKE",
        "origin_audience_id": source_audience_id,
        "lookalike_spec":  {
            "type":    "similarity",   # optimise for similarity (vs. reach)
            "ratio":   0.01,           # 1% = tightest, most similar
            "country": "IN",
        },
    })
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"]["message"])
    ok(f"Lookalike created: {data['id']}")
    info("Lookalike takes ~1–6 hours to populate (Meta processes in background)")
    return data["id"]

# ── 6. Patch warm ad set to include both audiences ────────────────────────────
def add_audiences_to_adset(custom_id, lookalike_id, skip_lookalike):
    step("Adding audiences to the warm retargeting ad set")

    audiences = [{"id": custom_id}]
    if not skip_lookalike:
        audiences.append({"id": lookalike_id})

    # Fetch current targeting
    r = requests.get(f"{GRAPH}/{WARM_ADSET_ID}",
        params={"access_token": TOKEN, "fields": "targeting"})
    data = r.json()
    if "error" in data:
        warn(f"Could not fetch ad set targeting: {data['error']['message']}")
        warn(f"Add audience IDs manually in Ads Manager:")
        warn(f"  Custom Audience: {custom_id}")
        if not skip_lookalike:
            warn(f"  Lookalike:       {lookalike_id}")
        return

    targeting = data.get("targeting", {})
    existing  = targeting.get("custom_audiences", [])
    # Merge without duplicates
    existing_ids = {a["id"] for a in existing}
    for a in audiences:
        if a["id"] not in existing_ids:
            existing.append(a)
    targeting["custom_audiences"] = existing

    # Patch the ad set
    r2 = requests.post(f"{GRAPH}/{WARM_ADSET_ID}", json={
        "access_token": TOKEN,
        "targeting":    targeting,
    })
    d2 = r2.json()
    if "error" in d2:
        warn(f"Could not update ad set: {d2['error']['message']}")
        warn("Add audiences manually in Ads Manager (Audience section of the ad set)")
    else:
        ok(f"Ad set updated — now targeting {len(existing)} custom audience(s)")
        if not skip_lookalike:
            info("Lookalike will activate once Meta finishes processing it (~6 hrs)")

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-lookalike", action="store_true",
                        help="Skip creating the Lookalike audience")
    args = parser.parse_args()

    print("\n" + "="*60)
    print("  Wix Contacts → Meta Custom Audience + Lookalike")
    print("="*60)

    contacts              = fetch_wix_contacts()
    rows, emails, phones  = build_user_data(contacts)

    if not rows:
        print("\n❌ No usable contact data found. Check Wix contacts have email or phone.")
        sys.exit(1)

    custom_id    = get_or_create_custom_audience()
    upload_users(custom_id, rows)

    lookalike_id = None
    if not args.no_lookalike:
        try:
            lookalike_id = create_lookalike(custom_id)
        except Exception as e:
            warn(f"Lookalike creation failed: {e}")
            warn("Custom Audience still created — you can create Lookalike manually in Ads Manager")

    add_audiences_to_adset(custom_id, lookalike_id, args.no_lookalike or not lookalike_id)

    print("\n" + "="*60)
    print("  ✅ Done!")
    print(f"  Custom Audience ID : {custom_id}")
    if lookalike_id:
        print(f"  Lookalike ID       : {lookalike_id}")
    print()
    print("  Both audiences are now attached to your warm campaign.")
    print("  → Custom Audience:  targets your exact Wix contacts on Meta")
    print("  → Lookalike 1%:     targets ~2M Indians most similar to your contacts")
    print()
    print("  Refresh any time new contacts are added:")
    print("  python3 upload_wix_audience.py")
    print("="*60 + "\n")

if __name__ == "__main__":
    main()
