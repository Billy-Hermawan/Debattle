
import sys
import random
import time
import json
from typing import List, Dict, Callable
import requests
from bs4 import BeautifulSoup
import feedparser

# ----------------------------
# CONFIG: Local Ollama / Model
# ----------------------------
OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "deepseek-r1:8b"
TEMPERATURE = 0.6
TIMEOUT = 60
MIN_LEN = 200


# ----------------------------
# SOURCES (official/public)
# ----------------------------
# Business / commercial → Federal Court (RSS judgments feed)
FCA_RSS = "https://www.judgments.fedcourt.gov.au/rss/fca-judgments"  # Fed Court RSS feed (official)  :contentReference[oaicite:1]{index=1}

# Constitutional → High Court pages (official)
HCA_JUDGMENTS_LIST = "https://www.hcourt.gov.au/cases-and-judgments/judgments/judgments-2000-current"  # list page  :contentReference[oaicite:2]{index=2}
HCA_CURRENT_CASES = "https://www.hcourt.gov.au/cases-and-judgments/cases/current"  # current cases brief details  :contentReference[oaicite:3]{index=3}

# Criminal → Appellate/state sources with summaries or case pages
VIC_SC_JUDGMENT_SUMMARIES = "https://www.supremecourt.vic.gov.au/areas/case-summaries/judgments"  # summaries list  :contentReference[oaicite:4]{index=4}
QLD_QCA_LATEST = "https://www.queenslandjudgments.com.au/caselaw/qca/recent-judgments"  # latest QCA  :contentReference[oaicite:5]{index=5}

HEADERS = {
    "User-Agent": "DebateCaseGenerator/1.0 (educational; respects robots; contact: local)"
}

# ----------------------------
# FETCHERS
# ----------------------------
def fetch_url(url: str) -> str:
    r = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
    r.raise_for_status()
    return r.text

def extract_text_generic(html: str, selectors: List[str]) -> str:
    """
    Pull readable text from the first matching selector.
    Fallback: <main> or <article>, else whole page (minified).
    """
    soup = BeautifulSoup(html, "html.parser")
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            text = " ".join(el.get_text(" ").split())
            if len(text) > MIN_LEN:
                return text
    # try main/article
    for sel in ["main", "article"]:
        el = soup.find(sel)
        if el:
            text = " ".join(el.get_text(" ").split())
            if len(text) > MIN_LEN:
                return text
    # fallback whole page
    return " ".join(soup.get_text(" ").split())

def get_business_extracts(limit: int = 6) -> List[Dict]:
    """
    Federal Court of Australia (FCA) business/commercial-friendly:
    Try the official FCA judgments RSS first; if empty, fall back to the FCA Latest Judgments page.
    """
    out: List[Dict] = []

    # --- Try RSS first (official) ---
    try:
        feed = feedparser.parse(FCA_RSS)  # https://www.judgments.fedcourt.gov.au/rss/fca-judgments
        entries = list(feed.entries)[:limit * 2]  # grab a few extra; we’ll filter below
        random.shuffle(entries)
        for e in entries:
            try:
                if not getattr(e, "link", None):
                    continue
                html = fetch_url(e.link)
                text = extract_text_generic(html, selectors=[
                    "main", "#content", ".content", "article"
                ])
                if len(text) >= MIN_LEN:
                    out.append({"title": e.title, "url": e.link, "text": text})
                if len(out) >= limit:
                    return out
                time.sleep(0.3)
            except Exception:
                continue
    except Exception:
        pass

    # --- Fallback: FCA “Latest Judgments” HTML page ---
    # https://www.fedcourt.gov.au/digital-law-library/judgments/latest
    if len(out) < 2:
        try:
            latest_html = fetch_url("https://www.fedcourt.gov.au/digital-law-library/judgments/latest")
            soup = BeautifulSoup(latest_html, "html.parser")
            candidates = []
            for a in soup.select("a[href]"):
                href = a.get("href", "")
                title = a.get_text(" ", strip=True)
                if not title:
                    continue
                # keep judgment links (usually to judgments.fedcourt.gov.au)
                if "judgments.fedcourt.gov.au" in href:
                    candidates.append((title, href))
            random.shuffle(candidates)
            for title, url in candidates[:limit * 2]:
                try:
                    html = fetch_url(url)
                    text = extract_text_generic(html, selectors=[
                        "main", "#content", ".content", "article"
                    ])
                    if len(text) >= MIN_LEN:
                        out.append({"title": title, "url": url, "text": text})
                    if len(out) >= limit:
                        break
                    time.sleep(0.3)
                except Exception:
                    continue
        except Exception:
            pass

    return out[:limit]


def get_constitutional_extracts(limit_pages: int = 1, limit_items: int = 5) -> List[Dict]:
    """
    High Court pages: take the judgments 2000-current index and/or current cases.
    We fetch the index page, collect some case links, then fetch a few case pages.
    """
    out = []
    try:
        html = fetch_url(HCA_JUDGMENTS_LIST)
        soup = BeautifulSoup(html, "html.parser")
        # Collect links that look like judgments pages
        links = []
        for a in soup.select("a[href]"):
            href = a.get("href", "")
            if "/judgments/" in href and href.startswith("http"):
                links.append((a.get_text(strip=True), href))
            elif "/judgments/" in href and href.startswith("/"):
                links.append((a.get_text(strip=True), "https://www.hcourt.gov.au" + href))
        # Deduplicate and sample
        random.shuffle(links)
        links = links[:limit_items]
        for title, url in links:
            try:
                page = fetch_url(url)
                text = extract_text_generic(page, selectors=["main", "#content", ".content"])
                out.append({"title": title or "HCA Judgment", "url": url, "text": text})
                time.sleep(0.5)
            except Exception:
                continue
    except Exception:
        pass

    # Add a couple from Current Cases (short briefs), if available
    try:
        html = fetch_url(HCA_CURRENT_CASES)
        soup = BeautifulSoup(html, "html.parser")
        items = soup.select("article, .item, li a")
        random.shuffle(items)
        for el in items[:max(1, limit_items // 2)]:
            try:
                t = el.get_text(" ", strip=True)
                href = el.get("href") if hasattr(el, "get") else None
                url = href if (href and href.startswith("http")) else (
                    ("https://www.hcourt.gov.au" + href) if href and href.startswith("/") else HCA_CURRENT_CASES
                )
                text = t
                out.append({"title": t[:120] or "HCA Current Case", "url": url, "text": text})
            except Exception:
                continue
    except Exception:
        pass

    return out[:limit_items]

def get_criminal_extracts(limit_items: int = 5) -> List[Dict]:
    """
    Use VIC Supreme Court judgment summaries page & QLD QCA latest page.
    We avoid PDFs (skip links ending with .pdf).
    """
    out = []
    # VIC summaries (often link to a summary page and PDFs)
    try:
        html = fetch_url(VIC_SC_JUDGMENT_SUMMARIES)
        soup = BeautifulSoup(html, "html.parser")
        # Grab visible entries (links around 'Judgment summary' items)
        for a in soup.select("a[href]"):
            href = a["href"]
            if href.lower().endswith(".pdf"):
                continue
            if href.startswith("/"):
                url = "https://www.supremecourt.vic.gov.au" + href
            elif href.startswith("http"):
                url = href
            else:
                continue
            title = a.get_text(" ", strip=True)
            if not title:
                continue
            try:
                sub = fetch_url(url)
                text = extract_text_generic(sub, selectors=["main", ".content", "#content"])
                if len(text) > 600:
                    out.append({"title": title, "url": url, "text": text})
                    if len(out) >= limit_items:
                        break
                time.sleep(0.5)
            except Exception:
                continue
    except Exception:
        pass

    # QLD QCA recent judgments (index page with case links)
    if len(out) < limit_items:
        try:
            html = fetch_url(QLD_QCA_LATEST)
            soup = BeautifulSoup(html, "html.parser")
            cand = []
            for a in soup.select("a[href]"):
                href = a["href"]
                if not href.startswith("http"):
                    # Queensland Judgments tends to use absolute hrefs; skip relative
                    continue
                title = a.get_text(" ", strip=True)
                # filter a bit
                if title and ("[20" in title or "[19" in title):
                    cand.append((title, href))
            random.shuffle(cand)
            for title, url in cand[:limit_items]:
                try:
                    page = fetch_url(url)
                    text = extract_text_generic(page, selectors=["main", ".content", "#content"])
                    if len(text) > 500:
                        out.append({"title": title, "url": url, "text": text})
                        if len(out) >= limit_items:
                            break
                    time.sleep(0.5)
                except Exception:
                    continue
        except Exception:
            pass

    # Truncate to desired size
    return out[:limit_items]

# ----------------------------
# PROMPTING DEEPSEEK
# ----------------------------
PROMPT_TEMPLATE = """You are drafting concise AU debate hypotheticals.
Read the excerpts below (from AU judgments). Create ONE short, hypothetical case
for the selected area: {AREA}. DO NOT copy facts; invent new facts inspired by themes.
Output bullets only, <=150 words.

EXCERPTS:
{EXTRACTS}

FORMAT:
- Title:
- Jurisdiction/Area:
- Core facts (3–5 bullets):
- Key issues (3–4):
- Relevant precedents (2–3): {{Case – 3–10 word principle}}
- Affirmative (3 bullets):
- Negative (3 bullets):
- Suggested debate motion (1):
"""

def ask_deepseek(area: str, extracts: str) -> str:
    payload = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": PROMPT_TEMPLATE.format(AREA=area, EXTRACTS=extracts)}],
        "think": True,
        "stream": False,
        "options": {"temperature": TEMPERATURE},
    }
    r = requests.post(OLLAMA_URL, json=payload, timeout=120)
    r.raise_for_status()
    data = r.json()

    # Try the common shapes
    content = (
        (data.get("message") or {}).get("content")
        or data.get("response")                   # some builds use 'response'
    )
    if not content:
        raise RuntimeError(f"Unexpected Ollama payload: keys={list(data.keys())}")
    return content

    r = requests.post("http://localhost:11434", json=payload, timeout=120)
    r.raise_for_status()
    data = r.json()

    # data["message"] will contain both `.thinking` and `.content` when think=True.
    # We only return the final answer:
    return data["message"]["content"]

# ----------------------------
# MAIN
# ----------------------------
AREA_SOURCES: Dict[str, List[Callable[[], List[Dict]]]] = {
    "constitutional": [lambda: get_constitutional_extracts(limit_items=6)],
    "business": [lambda: get_business_extracts(limit=6)],
    "criminal": [lambda: get_criminal_extracts(limit_items=6)],
}

def main():
    print("Choose case type: [constitutional] [business] [criminal]")
    area = input("> ").strip().lower()
    if area not in AREA_SOURCES:
        print("Unknown type. Please choose 'constitutional', 'business', or 'criminal'.")
        sys.exit(1)

    fetcher = random.choice(AREA_SOURCES[area])
    cases = fetcher()
    if not cases:
        print("Could not fetch source texts right now. Try again in a minute.")
        sys.exit(2)

    # Collapse a few extracts to keep prompt manageable
    random.shuffle(cases)
    chosen = cases[:3]
    extracts_text = "\n\n".join(f"### {c['title']}\n{c['text'][:2500]}" for c in chosen)

    # Call DeepSeek (Ollama)
    try:
        output = ask_deepseek(area.title(), extracts_text)
    except Exception as e:
        print("DeepSeek call failed:", e)
        sys.exit(3)

    # Pretty print
    print("\n" + "="*80)
    print(f"HYPOTHETICAL {area.upper()} CASE (DeepSeek)")
    print("="*80 + "\n")
    print(output)
    print("\n" + "="*80)
    print("Sources used for inspiration:")
    for c in chosen:
        print(f"- {c['title']}  -> {c['url']}")
    print("="*80)

if __name__ == "__main__":
    main()