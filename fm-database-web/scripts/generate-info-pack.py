#!/usr/bin/env python3
"""
generate-info-pack.py — Search PubMed for recent evidence on a topic and
synthesise a coach-usable, patient-friendly evidence brief.

Input (stdin JSON):
  {
    "topic": "HRT menopause benefits and risks",
    "keywords": ["hormone replacement therapy", "menopause", "cardiovascular"],
    "audience": "patient",          # patient | coach
    "max_papers": 15,               # how many abstracts to pull
    "save_slug": "hrt-menopause-evidence-brief"   # resource slug to save as
  }

Output (stdout JSON):
  { "ok": true, "slug": "hrt-menopause-evidence-brief", "title": "...", "word_count": 1200 }
  OR
  { "ok": false, "error": "..." }
"""
from __future__ import annotations
import sys, json, os, re, time, textwrap
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.parse import urlencode, quote_plus
from urllib.error import URLError

# ── Bootstrap fm-database venv path ──────────────────────────────────────────
HERE = Path(__file__).parent
FMDB_REPO = HERE.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_REPO))

try:
    from anthropic import Anthropic
    from dotenv import load_dotenv
    load_dotenv(FMDB_REPO / ".env", override=True)
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"Import error: {e}"}))
    sys.exit(1)

# ── PubMed helper (NCBI E-utils, free, no key needed for basic use) ───────────

NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

def _ncbi_get(endpoint: str, params: dict) -> dict | str:
    """Hit an NCBI E-utils endpoint; return JSON dict or raw text."""
    url = f"{NCBI_BASE}/{endpoint}?" + urlencode(params)
    req = Request(url, headers={"User-Agent": "fmdb-info-pack/1.0 (contact: internal)"})
    try:
        with urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8")
    except URLError as e:
        raise RuntimeError(f"PubMed request failed: {e}") from e
    if params.get("retmode") == "json":
        return json.loads(raw)
    return raw


def search_pubmed(query: str, max_results: int = 15, years_back: int = 10) -> list[str]:
    """Return a list of PubMed IDs matching query, limited to recent papers."""
    from datetime import datetime
    min_date = str(datetime.now().year - years_back)
    data = _ncbi_get("esearch.fcgi", {
        "db": "pubmed",
        "term": query,
        "retmax": max_results,
        "retmode": "json",
        "sort": "relevance",
        "mindate": min_date,
        "datetype": "pdat",
    })
    if not isinstance(data, dict):
        return []
    return data.get("esearchresult", {}).get("idlist", [])


def fetch_abstracts(pmids: list[str]) -> list[dict]:
    """Fetch abstracts for given PubMed IDs. Returns list of {pmid, title, abstract, authors, year, journal}."""
    if not pmids:
        return []
    # Fetch in one batch (max 200)
    text = _ncbi_get("efetch.fcgi", {
        "db": "pubmed",
        "id": ",".join(pmids),
        "rettype": "abstract",
        "retmode": "text",
    })
    # Parse simple text output into individual abstracts
    articles = []
    current: list[str] = []
    for line in str(text).splitlines():
        if re.match(r"^\d+\.", line) and current:
            articles.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        articles.append("\n".join(current))

    # Also try to get structured metadata via esummary
    results = []
    try:
        summary = _ncbi_get("esummary.fcgi", {
            "db": "pubmed",
            "id": ",".join(pmids),
            "retmode": "json",
        })
        if isinstance(summary, dict):
            uid_data = summary.get("result", {})
            for pmid in pmids:
                rec = uid_data.get(pmid, {})
                results.append({
                    "pmid": pmid,
                    "title": rec.get("title", ""),
                    "journal": rec.get("fulljournalname", rec.get("source", "")),
                    "year": rec.get("pubdate", "")[:4],
                    "authors": ", ".join(
                        a.get("name", "") for a in rec.get("authors", [])[:3]
                    ) + (" et al." if len(rec.get("authors", [])) > 3 else ""),
                    "doi": next(
                        (a.get("value", "") for a in rec.get("articleids", []) if a.get("idtype") == "doi"),
                        "",
                    ),
                })
    except Exception:
        for pmid in pmids:
            results.append({"pmid": pmid, "title": "", "journal": "", "year": "", "authors": "", "doi": ""})

    # Attach raw abstract text
    abstract_map = {}
    for block in articles:
        m = re.search(r"PMID[:\s]+(\d+)", block)
        if m:
            abstract_map[m.group(1)] = block

    for r in results:
        r["abstract_text"] = abstract_map.get(r["pmid"], "")

    return results


# ── Claude synthesis ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a functional medicine researcher and health educator.
Your job is to synthesise recent research into an accurate, readable evidence brief.

Rules:
1. Use plain English — no jargon without explanation.
2. Be balanced — include both benefits AND risks/limitations when they exist in the evidence.
3. Never exaggerate or minimise; stick to what the papers actually say.
4. Include a "What to discuss with your doctor / coach" section at the end.
5. Cite papers inline as [Author Year] or [PMID: xxxxxxxx] when you reference them.
6. Separate clearly what is strong evidence vs emerging vs speculative.
7. Output valid Markdown — use ## headings, bullet lists, bold for key points.
8. If writing for a patient, avoid medical abbreviations or explain them immediately.
"""


def synthesise(topic: str, papers: list[dict], audience: str, client: Anthropic) -> str:
    papers_block = ""
    for p in papers:
        papers_block += f"\n---\nPMID: {p['pmid']}\nTitle: {p['title']}\nAuthors: {p['authors']}\nJournal: {p['journal']} ({p['year']})\nDOI: {p['doi']}\n\n{p['abstract_text'][:3000]}\n"

    audience_note = (
        "The audience is a **patient / lay person** — write in warm, accessible language."
        if audience == "patient"
        else "The audience is a **health coach or clinician** — you can use clinical terms but still explain them."
    )

    prompt = f"""{audience_note}

Topic: {topic}

Here are {len(papers)} recent PubMed abstracts on this topic:
{papers_block}

Please write a comprehensive evidence brief covering:

## Key Findings (bullet summary)
## What the Research Shows (detailed, balanced narrative)
## Benefits Supported by Evidence
## Risks and Limitations in the Evidence
## Who This May Be Most Relevant For
## What to Discuss with Your Doctor / Health Coach
## Sources Cited

Make it thorough but readable. Aim for 800–1200 words."""

    msg = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


# ── Resource YAML writer ──────────────────────────────────────────────────────

def save_resource(slug: str, title: str, topic: str, content: str, pmids: list[str], audience: str) -> Path:
    resources_root = Path(os.environ.get("FMDB_RESOURCES_DIR", Path.home() / "fm-resources"))
    resources_dir = resources_root / "resources"
    resources_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls = [f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" for pmid in pmids[:5]]

    import yaml  # type: ignore
    record = {
        "slug": slug,
        "title": title,
        "kind": "evidence_brief",
        "audience": audience,  # patient | coach
        "description": f"Evidence brief on: {topic}. Synthesised from {len(pmids)} PubMed papers.",
        "text": content,
        "url": urls[0] if urls else None,
        "related_topics": [],
        "tags": ["evidence-brief", "research-summary"],
        "shareable": True,
        "license_notes": "Generated from PubMed open-access abstracts. Cite original papers when sharing.",
        "version": 1,
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "updated_by": os.environ.get("FMDB_USER", "shivani"),
    }

    out = resources_dir / f"{slug}.yaml"
    with open(out, "w") as f:
        yaml.safe_dump(record, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    return out


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    try:
        inp = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Bad JSON input: {e}"}))
        sys.exit(1)

    topic = inp.get("topic", "").strip()
    keywords = inp.get("keywords", [])
    audience = inp.get("audience", "patient")
    max_papers = int(inp.get("max_papers", 12))
    save_slug = inp.get("save_slug", "").strip()
    dry_run = inp.get("dry_run", False)

    if not topic:
        print(json.dumps({"ok": False, "error": "topic is required"}))
        sys.exit(1)

    if not save_slug:
        # Auto-slug from topic
        save_slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:60]

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print(json.dumps({"ok": False, "error": "ANTHROPIC_API_KEY not set"}))
        sys.exit(1)

    # Build search query
    search_query = " AND ".join(f'"{kw}"' for kw in keywords) if keywords else topic
    # Bias toward clinical trials + systematic reviews for credibility
    search_query += ' AND ("systematic review"[pt] OR "meta-analysis"[pt] OR "randomized controlled trial"[pt] OR "clinical trial"[pt] OR "cohort study"[tiab])'

    # 1. Search PubMed
    try:
        pmids = search_pubmed(search_query, max_results=max_papers)
    except RuntimeError as e:
        # Fallback: simpler query without publication type filter
        try:
            simple_q = " AND ".join(f'"{kw}"' for kw in keywords) if keywords else topic
            pmids = search_pubmed(simple_q, max_results=max_papers)
        except RuntimeError as e2:
            print(json.dumps({"ok": False, "error": f"PubMed search failed: {e2}"}))
            sys.exit(1)

    if not pmids:
        print(json.dumps({"ok": False, "error": f"No PubMed papers found for: {search_query}"}))
        sys.exit(1)

    # 2. Fetch abstracts
    try:
        time.sleep(0.35)  # NCBI rate limit courtesy
        papers = fetch_abstracts(pmids)
    except RuntimeError as e:
        print(json.dumps({"ok": False, "error": f"PubMed fetch failed: {e}"}))
        sys.exit(1)

    papers_found = len([p for p in papers if p.get("title")])

    if dry_run:
        print(json.dumps({
            "ok": True,
            "dry_run": True,
            "pmids_found": pmids,
            "papers_with_metadata": papers_found,
            "slug": save_slug,
        }))
        return

    # 3. Synthesise
    client = Anthropic(api_key=api_key)
    try:
        content = synthesise(topic, papers, audience, client)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Synthesis failed: {e}"}))
        sys.exit(1)

    # 4. Generate title from first line of output
    first_line = content.strip().splitlines()[0] if content.strip() else topic
    title = re.sub(r"^#+\s*", "", first_line).strip() or f"Evidence Brief: {topic}"

    # 5. Save as resource
    try:
        path = save_resource(save_slug, title, topic, content, pmids, audience)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Save failed: {e}"}))
        sys.exit(1)

    word_count = len(content.split())
    print(json.dumps({
        "ok": True,
        "slug": save_slug,
        "title": title,
        "papers_used": papers_found,
        "pmids": pmids,
        "word_count": word_count,
        "saved_to": str(path),
    }))


if __name__ == "__main__":
    main()
