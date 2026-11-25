#!/usr/bin/env python3
"""Personal Job Finder Radar: daily job collector.

Pulls fresher / entry-level tech openings from public sources (LinkedIn's public
job search, company careers APIs, Telegram public channels, RSS feeds, Kerala IT
parks, Arbeitnow) and optionally from Gmail job alerts. Writes docs/data/jobs.json,
which the static site in docs/ reads. Standard library only, so it runs anywhere.

Every source is independent: if one fails or is blocked, the others still run and
the failure is recorded in the output's "sources" block.
"""
from __future__ import annotations

import base64
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "jobs.json"
CFG = json.loads((ROOT / "config" / "sources.json").read_text())
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
TODAY = dt.date.today()
NOW = dt.datetime.now(dt.timezone.utc)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- http
def fetch(url, data=None, headers=None, timeout=30, tries=2):
    """GET (or POST when data is given). Returns text, or None on failure."""
    h = {"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"}
    h.update(headers or {})
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        h.setdefault("Content-Type", "application/json")
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 999) or e.code >= 500:
                time.sleep(3 * (i + 1))
                continue
            log(f"  http {e.code} {url[:110]}")
            return None
        except Exception as e:  # network errors, timeouts
            log(f"  error {type(e).__name__} {url[:110]}")
            time.sleep(2)
    return None


def fetch_json(url, **kw):
    t = fetch(url, **kw)
    if not t:
        return None
    try:
        return json.loads(t)
    except ValueError:
        return None


# ---------------------------------------------------------------- text helpers
def clean(s):
    s = re.sub(r"<br\s*/?>", "\n", str(s or ""), flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    return re.sub(r"[ \t ]+", " ", s).strip()


def one_line(s, n=160):
    return re.sub(r"\s+", " ", clean(s))[:n].strip(" -–|:,")


CATS = [
    ("AI/ML", r"\b(ai|a\.i\.|ml|machine learning|deep learning|gen ?ai|generative|llm|nlp|computer vision|data scien|artificial intelligence|mlops|prompt|agentic|research (engineer|scientist|intern))\b"),
    ("Data", r"\b(data (engineer|analyst|analytics)|analytics|business intelligence|\bbi\b|power bi|sql|etl|big data|data annotation)\b"),
    ("DevOps/Cloud", r"\b(devops|cloud|sre|site reliability|aws|azure|gcp|kubernetes|platform engineer|infrastructure|system(s)? (admin|engineer)|network engineer|cyber ?security|security engineer|support engineer|technical support|it support)\b"),
    ("Mobile", r"\b(android|ios|flutter|react native|mobile|kotlin|swift)\b"),
    ("Web Dev", r"\b(web|front ?end|frontend|full ?stack|fullstack|react|angular|vue|node|php|laravel|mern|mean|django|wordpress|ui developer|javascript|typescript|next\.?js|shopify)\b"),
    ("Software Dev", r"\b(software|developer|programmer|sde|swe|engineer(ing)? (intern|trainee)|coder|java|python|\.net|dotnet|c\+\+|golang|rust|qa|quality (assurance|engineer)|test(ing)? engineer|tester|automation|embedded|firmware|application developer|salesforce developer|sap (abap|developer)|rpa|graduate engineer trainee|get\b|technical intern|it trainee|apprentice)\b"),
]
NON_TECH = re.compile(r"\b(sales|marketing|recruiter|hr\b|human resources|account(ant|ing)|finance|bpo|voice process|customer (service|support|care)|tele ?call|counsel|teacher|faculty|nurse|driver|delivery|content writer|graphic|designer|video|business development|operations executive|front office|receptionist|legal|procurement|logistics|warehouse|admission)\b", re.I)


def category(title, extra=""):
    t = f"{title} {extra}".lower()
    if NON_TECH.search(title) and not re.search(r"engineer|developer|software|data|ai\b|ml\b", title, re.I):
        return "Other"
    for name, pat in CATS:
        if re.search(pat, t, re.I):
            return name
    return "Other"


SENIOR = re.compile(r"\b(senior|sr\.?|lead|principal|staff|manager|director|architect|head|vp|vice president|chief|expert|consultant ii|ii|iii|iv|[3-9]\+? ?(yrs|years)|10\+)\b|\b(engineer|developer|analyst|scientist|sde)\s*[-]?\s*[2-5]\b", re.I)
FRESH = re.compile(r"fresher|freshers|\bintern(ship)?s?\b|trainee|graduate|entry[- ]?level|junior|\bjr\.?\b|associate|apprentice|new ?grad|campus|0\s*[-–to]+\s*[12]\s*(yrs?|years?)|\b20(25|26|27|28)\b|batch|\bl1\b|engineer i\b|developer i\b|sde[- ]?(1|i)\b|\bget\b|beginner|early career|university", re.I)


def fresher(title, text=""):
    if SENIOR.search(title):
        return False
    if FRESH.search(title) or FRESH.search(text or ""):
        return True
    return None


KOCHI = re.compile(r"kochi|cochin|ernakulam|kakkanad|infopark|kalamassery|aluva|edappally|palarivattom|vyttila|kadavanthra|smart ?city", re.I)


def make(title, company, location, url, source, posted=None, **kw):
    title, company = one_line(title, 140), one_line(company, 90)
    if not title or not company or not url or not str(url).startswith("http"):
        return None
    location = one_line(location or "India", 120) or "India"
    extra = kw.pop("extra", "")
    j = {
        "title": title,
        "company": company,
        "location": location,
        "apply_url": url,
        "source": source,
        "posted_or_email_date": (posted or TODAY).isoformat() if isinstance(posted, (dt.date, type(None))) else str(posted)[:10],
        "category": kw.pop("category", None) or category(title, extra),
        "is_kochi": bool(KOCHI.search(location)),
    }
    f = kw.pop("is_fresher", "auto")
    j["is_fresher"] = fresher(title, (kw.get("experience_text") or "") + " " + extra) if f == "auto" else f
    if SENIOR.search(title):
        j["is_fresher"] = False  # a title saying senior / II / lead always wins
    if j["is_fresher"] is None:
        j.pop("is_fresher")
    for k, v in kw.items():
        if v not in (None, ""):
            j[k] = v
    return j


def parse_salary(text):
    """Very small INR salary parser → minimum monthly INR, or None."""
    if not text:
        return None
    t = text.lower().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(k|l|lpa|lakh|lac)?", t)
    if not m or not re.search(r"₹|inr|rs|lpa|lakh|per month|/month|stipend|k\b", t):
        return None
    v = float(m.group(1))
    unit = m.group(2) or ""
    if unit in ("l", "lpa", "lakh", "lac") or "lpa" in t or "lakh" in t:
        return int(v * 100000 / 12)
    if unit == "k":
        v *= 1000
    if v < 1000:
        return None
    return int(v / 12) if ("year" in t or "annum" in t or "p.a" in t) else int(v)


# ---------------------------------------------------------------- sources
def src_linkedin():
    """LinkedIn public (guest) job search: no login, ~25 cards per request."""
    cfg = CFG["linkedin"]
    base = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?"
    queries = []
    for kw in cfg["keywords"]:
        for loc in cfg["locations"]:
            queries.append({"keywords": kw, "location": loc, "f_E": "1,2", "f_TPR": "r604800"})
    for loc in cfg["walkin_locations"]:
        queries.append({"keywords": "walk in drive software", "location": loc, "f_TPR": "r604800"})
    for kw in cfg["remote_keywords"]:
        queries.append({"keywords": kw, "location": "India", "f_E": "1,2", "f_WT": "2", "f_TPR": "r604800"})
    out, blocked = [], 0
    for q in queries[: cfg.get("max_requests", 90)]:
        t = fetch(base + urllib.parse.urlencode(q), tries=1)
        time.sleep(1.2)
        if t is None:
            blocked += 1
            if blocked >= 6:
                log("  linkedin: too many failures, stopping")
                break
            continue
        for card in re.findall(r"<li>(.*?)</li>", t, re.S):
            title = re.search(r'base-search-card__title">(.*?)<', card, re.S)
            comp = re.search(r'base-search-card__subtitle">(.*?)</h4>', card, re.S)
            loc = re.search(r'job-search-card__location">(.*?)<', card, re.S)
            link = re.search(r'href="(https://[a-z]+\.linkedin\.com/jobs/view/[^"?]+)', card)
            date = re.search(r'datetime="(\d{4}-\d{2}-\d{2})"', card)
            if not (title and comp and link):
                continue
            remote = q.get("f_WT") == "2"
            j = make(clean(title.group(1)), clean(comp.group(1)), (clean(loc.group(1)) if loc else "India") + (" (Remote)" if remote else ""),
                     link.group(1), "LinkedIn", date.group(1) if date else None,
                     experience_text="LinkedIn: entry level / internship" if q.get("f_E") else None)
            if j and "walk" in q["keywords"] and re.search(r"walk[\s-]?in|drive", j["title"], re.I):
                j["job_type"] = "walk-in"
            if j and q.get("f_E") and j.get("is_fresher") is None:
                j["is_fresher"] = True
            if j:
                out.append(j)
    return out


def src_amazon():
    out = []
    for q in CFG["amazon_queries"]:
        url = "https://www.amazon.jobs/en/search.json?" + urllib.parse.urlencode(
            {"base_query": q, "normalized_country_code[]": "IND", "result_limit": 100, "sort": "recent"})
        d = fetch_json(url)
        for x in (d or {}).get("jobs", []):
            title = x.get("title", "")
            if not re.search(r"\b(I|1)\b|intern|graduate|associate|trainee|apprentice|new grad", title) or SENIOR.search(title):
                continue
            try:
                posted = dt.datetime.strptime(x.get("posted_date", ""), "%B %d, %Y").date()
            except ValueError:
                posted = None
            j = make(title, "Amazon", x.get("normalized_location") or (x.get("city", "") + ", India"),
                     "https://www.amazon.jobs" + x.get("job_path", ""), "Amazon Jobs", posted, is_fresher=True,
                     experience_text=one_line(x.get("basic_qualifications", ""), 140))
            if j:
                out.append(j)
        time.sleep(1)
    return out


def src_microsoft():
    out = []
    for q in CFG["microsoft_queries"]:
        url = "https://apply.careers.microsoft.com/api/pcsx/search?" + urllib.parse.urlencode(
            {"domain": "microsoft.com", "query": q, "location": "India", "start": 0, "num": 50, "sort_by": "timestamp"})
        d = fetch_json(url, headers={"Accept": "application/json"})
        for p in ((d or {}).get("data") or {}).get("positions", []):
            title = p.get("name", "")
            if SENIOR.search(title):
                continue
            ts = p.get("postedTs")
            posted = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date() if ts else None
            if posted and (TODAY - posted).days > 30:
                continue
            path = p.get("positionUrl") or ""
            j = make(title, "Microsoft", "; ".join(p.get("locations") or ["India"]),
                     path if path.startswith("http") else "https://apply.careers.microsoft.com" + path, "Microsoft Careers", posted)
            if j:
                out.append(j)
        time.sleep(1)
    return out


def src_google():
    out = []
    for lvl in CFG["google_levels"]:
        for page in (1, 2, 3):
            url = ("https://www.google.com/about/careers/applications/jobs/results/?location=India&target_level="
                   f"{lvl}&sort_by=date&page={page}")
            t = fetch(url)
            if not t:
                break
            items = re.findall(r'<li class="lLd3Je"[^>]*>(.*?)</li>', t, re.S)
            if not items:
                break
            for it in items:
                title = re.search(r"<h3[^>]*>(.*?)</h3>", it, re.S)
                jid = re.search(r'jsdata="[^;"]*;(\d{8,});', it)
                loc = re.search(r"place</i><span[^>]*>(.*?)</span>", it, re.S)
                if not (title and jid):
                    continue
                j = make(clean(title.group(1)), "Google", clean(loc.group(1)) if loc else "India",
                         "https://www.google.com/about/careers/applications/jobs/results/" + jid.group(1), "Google Careers",
                         is_fresher=True, job_type="internship" if lvl.startswith("INTERN") else "full-time",
                         experience_text="Google: " + ("Intern / apprentice" if lvl.startswith("INTERN") else "Early career"))
                if j:
                    out.append(j)
            time.sleep(1)
    return out


INDIA_PATH = re.compile(r"india|bangalore|bengaluru|hyderabad|pune|chennai|mumbai|noida|gurgaon|gurugram|delhi|kochi|trivandrum|ahmedabad", re.I)


def src_workday():
    out = []
    for c in CFG["workday"]:
        seen = set()
        for q in CFG["workday_queries"]:
            url = f"https://{c['host']}/wday/cxs/{c['tenant']}/{c['site']}/jobs"
            d = fetch_json(url, data={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": q},
                           headers={"Accept": "application/json"})
            for p in (d or {}).get("jobPostings", []):
                path = p.get("externalPath", "")
                if path in seen:
                    continue
                seen.add(path)
                loc = p.get("locationsText", "")
                if not (INDIA_PATH.search(loc) or INDIA_PATH.search(path.split("/")[2] if path.count("/") > 2 else "")):
                    continue
                posted_on = p.get("postedOn", "")
                if "30+" in posted_on:
                    continue
                m = re.search(r"(\d+)", posted_on)
                posted = TODAY - dt.timedelta(days=int(m.group(1))) if m else TODAY
                if re.search(r"\d+ Locations", loc):
                    loc = path.split("/")[2].replace("-", " ") + " (+ more)"
                if "india" not in loc.lower():
                    loc += ", India"
                j = make(p.get("title", ""), c["company"], loc, f"https://{c['host']}/en-US/{c['site']}{path}",
                         f"{c['company']} Careers", posted)
                if j and j.get("is_fresher") is not False:
                    out.append(j)
            time.sleep(1)
    return out


def src_arbeitnow():
    """Germany, visa-sponsored (Arbeitnow's visa filter + a visa/relocation mention)."""
    out = []
    de = re.compile(r"germany|deutschland|berlin|m[üu]nchen|munich|hamburg|frankfurt|k[öo]ln|cologne|stuttgart|d[üu]sseldorf|leipzig|dresden|karlsruhe|n[üu]rnberg|bonn|hannover|potsdam|darmstadt|heidelberg|mannheim|bochum|aachen|bremen|essen|dortmund|remote", re.I)
    for page in range(1, CFG["arbeitnow_pages"] + 1):
        d = fetch_json(f"https://www.arbeitnow.com/api/job-board-api?visa_sponsorship=true&page={page}")
        for x in (d or {}).get("data", []):
            if "arbeitnow.com/" not in x.get("url", "") or not de.search(x.get("location", "")):
                continue
            if not re.search(r"visa|relocation|blue card", x.get("description", ""), re.I):
                continue
            title = x.get("title", "")
            cat = category(title)
            if cat == "Other" or SENIOR.search(title):
                continue
            posted = dt.datetime.fromtimestamp(x.get("created_at", 0), dt.timezone.utc).date()
            if (TODAY - posted).days > 30:
                continue
            loc = x["location"] if re.search("germany", x["location"], re.I) else x["location"] + ", Germany"
            j = make(title, x.get("company_name", ""), loc, x["url"], "Arbeitnow (visa sponsorship)", posted,
                     category=cat, city="Germany", country="Germany", visa_sponsorship=True,
                     experience_text="Junior" if re.search(r"junior|graduate|entry", title, re.I) else "Not stated")
            if j:
                out.append(j)
        time.sleep(1)
    return out


def src_remotive():
    d = fetch_json("https://remotive.com/api/remote-jobs?limit=300")
    out = []
    for x in (d or {}).get("jobs", []):
        where = x.get("candidate_required_location", "")
        if not re.search(r"worldwide|anywhere|india|asia|apac|global", where, re.I):
            continue
        title = x.get("title", "")
        if fresher(title, "") is not True:
            continue
        j = make(title, x.get("company_name", ""), f"Remote ({where})", x.get("url", ""), "Remotive",
                 (x.get("publication_date") or "")[:10] or None, salary_text=x.get("salary") or None, job_type="remote")
        if j:
            out.append(j)
    return out


RSS_SPLIT = re.compile(r"\s+(?:Off ?Campus|Recruitment|Internship|Walk[- ]?in|Hiring|Careers?|Jobs?|Drive|Is Hiring|Recruiting|Freshers?)\b", re.I)
CITY = re.compile(r"(Bengaluru|Bangalore|Hyderabad|Chennai|Pune|Mumbai|Noida|Gurugram|Gurgaon|Delhi|Kochi|Trivandrum|Thiruvananthapuram|Coimbatore|Kolkata|Ahmedabad|Remote|Pan India|Work From Home|Multiple Locations?)", re.I)


def src_rss():
    out = []
    for feed in CFG["rss_feeds"]:
        t = fetch(feed["url"])
        if not t:
            continue
        try:
            root = ET.fromstring(t.encode())
        except ET.ParseError:
            continue
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip()
            try:
                posted = parsedate_to_datetime(it.findtext("pubDate") or "").date()
            except (TypeError, ValueError):
                posted = TODAY
            if (TODAY - posted).days > 14 or re.search(r"result|admit card|syllabus|question|salary of|news|layoff|cuts", title, re.I):
                continue
            parts = RSS_SPLIT.split(title, maxsplit=1)
            company = parts[0].strip(" :–-|")
            role = re.split(r"[:–|]", title, maxsplit=1)[-1].strip() if re.search(r"[:–|]", title) else title
            role = re.sub(r"\b(20\d\d)\b\s*[:–-]?", r"\1 ", role).strip(" –-|")
            cities = CITY.findall(title)
            j = make(role or title, company, ", ".join(dict.fromkeys(cities)) + ", India" if cities else "India", link,
                     f"{feed['name']} (verify on careers site)", posted,
                     job_type="internship" if re.search("intern", title, re.I) else ("walk-in" if re.search(r"walk[- ]?in", title, re.I) else "full-time"))
            if j:
                out.append(j)
    return out


TG_SKIP = re.compile(r"hackathon|contest|webinar|course|bootcamp|masterclass|giveaway|quiz|scholarship|workshop|ambassador|govt|government", re.I)
TG_FIELD = lambda name: re.compile(rf"(?:^|\n)\W*(?:{name})\s*[:\-–]\s*(.+)", re.I)
F_COMPANY, F_ROLE = TG_FIELD(r"company(?: name)?"), TG_FIELD(r"role|job role|position|designation|post|job title")
F_LOC, F_BATCH = TG_FIELD(r"location|job location"), TG_FIELD(r"batch(?:es)?(?: eligible)?|eligible batch(?:es)?|passout|graduation year")
F_EXP, F_SAL = TG_FIELD(r"experience(?: required)?|level"), TG_FIELD(r"salary|ctc|package|stipend|expected stipend")
HIRING = re.compile(r"^\W*(.{2,60}?)\s+(?:is\s+)?(?:hiring|recruiting)(?:\s+freshers?)?(?:\s+for(?:\s+the)?)?\s*[:\-–]?\s*(.{0,90}?)(?:\s+role)?\s*(?:[!\-–|]|$)", re.I)


def tg_blocks(text):
    parts = re.split(r"\n\s*\n|(?=📌)|(?=🎯)", text)
    blocks, cur = [], ""
    for p in parts:
        cur = (cur + "\n" + p).strip() if cur and not re.search(r"https?://", cur) else p.strip()
        if re.search(r"https?://", cur):
            blocks.append(cur)
            cur = ""
    return blocks


def src_telegram():
    out = []
    for ch in CFG["telegram_channels"]:
        t = fetch(f"https://t.me/s/{ch}")
        if not t:
            continue
        for wrap in t.split('tgme_widget_message_wrap')[1:]:
            body = re.search(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', wrap, re.S)
            when = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})', wrap)
            if not body or not when:
                continue
            posted = dt.date.fromisoformat(when.group(1))
            if (TODAY - posted).days > 10:
                continue
            raw = re.sub(r'<a [^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>', r" \2 \1 ", body.group(1), flags=re.S)
            text = clean(raw)
            if TG_SKIP.search(text[:200]):
                continue
            for b in tg_blocks(text):
                links = [u for u in re.findall(r"https?://[^\s)]+", b) if not re.search(r"t\.me/|telegram|whatsapp\.com|instagram|youtube|chat\.whatsapp", u)]
                if not links:
                    continue
                lines = [l.strip(" •📌🎯🏢💼📍👨‍💻🎓💰🔗👉✅") for l in b.split("\n") if l.strip()]
                comp = F_COMPANY.search(b)
                role = F_ROLE.search(b)
                company = comp.group(1) if comp else None
                title = role.group(1) if role else None
                if not company:
                    m = HIRING.search(lines[0]) if lines else None
                    if m:
                        company = m.group(1)
                        title = title or m.group(2)
                if not company and lines:
                    first = re.split(r"\s+/\s+|,", lines[0])[0]
                    if len(first) <= 50 and not re.search(r"http|hiring|apply|join", first, re.I):
                        company = first
                        if not title and len(lines) > 1 and not re.search(r":", lines[1]):
                            title = lines[1]
                if not company:
                    continue
                title = title or "Fresher opening"
                loc = F_LOC.search(b)
                batch = F_BATCH.search(b) or re.search(r"for ((?:20\d\d,?\s*(?:&|and)?\s*)+)\s*(?:gr[a]?ds|graduates|batch)", b, re.I)
                exp = F_EXP.search(b)
                sal = F_SAL.search(b)
                exp_text = " · ".join(x for x in [("Batch " + one_line(batch.group(1), 60)) if batch else "", one_line(exp.group(1), 60) if exp else ""] if x)
                sal_text = one_line(sal.group(1), 60) if sal and not re.search(r"not (specified|disclosed)", sal.group(1), re.I) else None
                j = make(title, company, one_line(loc.group(1), 80) if loc else "India", links[0],
                         f"Telegram @{ch}", posted, experience_text=exp_text or None, salary_text=sal_text,
                         salary_min_monthly_inr=parse_salary(sal_text), extra=b[:300],
                         job_type="walk-in" if re.search(r"walk[\s-]?in", b, re.I) else ("internship" if re.search(r"\bintern", title, re.I) else None))
                if j:
                    out.append(j)
        time.sleep(1)
    return out


def src_infopark():
    out = []
    for page in CFG["infopark_pages"]:
        t = fetch(page)
        if not t:
            continue
        for row in re.findall(r"<tr>(.*?)</tr>", t, re.S):
            cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            link = re.search(r'href="(https://infopark\.in/company-jobs/details/[^"]+)"', row)
            if len(cells) < 4 or not link:
                continue
            try:
                posted = dt.datetime.strptime(cells[0], "%d-%m-%Y").date()
                deadline = dt.datetime.strptime(cells[3], "%d %b %Y").date().isoformat()
            except ValueError:
                continue
            if (TODAY - posted).days > 30:
                continue
            place = "Thrissur" if "thrissur" in page else "Cherthala" if "cherthala" in page else "Infopark, Kochi"
            j = make(cells[1], cells[2], f"{place}, Kerala", link.group(1), "Infopark Jobs", posted, deadline=deadline,
                     job_type="walk-in" if re.search(r"walk[\s-]?in", cells[1], re.I) else None)
            if j:
                out.append(j)
    return out


def src_technopark():
    out = []
    for page in range(1, CFG["technopark_pages"] + 1):
        d = fetch_json(f"https://technopark.in/api/paginated-jobs?page={page}", headers={"Accept": "application/json"})
        for x in (d or {}).get("data", []):
            try:
                posted = dt.date.fromisoformat(x.get("posted_date", "")[:10])
            except ValueError:
                posted = TODAY
            walk = bool(x.get("is_walk_in"))
            j = make(x.get("job_title", ""), (x.get("company") or {}).get("company", ""), "Technopark, Thiruvananthapuram, Kerala",
                     f"https://technopark.in/job-details/{x.get('id')}", "Technopark Jobs", posted,
                     deadline=(x.get("walk_in_start_date") if walk else x.get("closing_date")) or None,
                     job_type="walk-in" if walk else None)
            if j:
                out.append(j)
        time.sleep(1)
    return out


# ---------------------------------------------------------------- Gmail (optional)
def src_gmail():
    """Reads job-alert emails when GMAIL_* and GEMINI_API_KEY secrets are set.

    Gemini only extracts jobs from the email text; apply links must appear in the email.
    """
    need = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GEMINI_API_KEY"]
    if not all(os.environ.get(k) for k in need):
        return None  # not configured
    tok = fetch_json("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
        "client_id": os.environ["GMAIL_CLIENT_ID"], "client_secret": os.environ["GMAIL_CLIENT_SECRET"],
        "refresh_token": os.environ["GMAIL_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    if not tok or "access_token" not in tok:
        raise RuntimeError("Gmail token refresh failed")
    auth = {"Authorization": "Bearer " + tok["access_token"]}
    q = ("newer_than:2d (from:indeed.com OR from:linkedin.com OR from:naukri.com OR from:wellfound.com OR from:internshala.com "
         "OR from:unstop.news OR from:instahyre.com OR from:jobs2web.com OR from:foundit.in OR from:glassdoor.com OR subject:(hiring OR walk-in OR \"job alert\"))")
    lst = fetch_json("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + urllib.parse.urlencode({"q": q, "maxResults": 25}), headers=auth) or {}
    out = []
    for m in lst.get("messages", []):
        full = fetch_json(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{m['id']}?format=full", headers=auth)
        if not full:
            continue
        texts = []

        def walk(p):
            b = (p.get("body") or {}).get("data")
            if b and re.match(r"text/(plain|html)", p.get("mimeType", "")):
                s = base64.urlsafe_b64decode(b + "===").decode("utf-8", "replace")
                if "html" in p["mimeType"]:
                    s = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>', r" [\1] ", s)
                texts.append(clean(s))
            for c in p.get("parts", []) or []:
                walk(c)
        walk(full.get("payload", {}))
        subj = next((h["value"] for h in full.get("payload", {}).get("headers", []) if h["name"] == "Subject"), "")
        date = dt.datetime.fromtimestamp(int(full.get("internalDate", "0")) / 1000, dt.timezone.utc).date()
        body = re.sub(r"https?://\S{300,}", "", "\n".join(texts))[:12000]
        prompt = ("Extract every individual tech job posting from this job-alert email. Return ONLY a JSON array of objects with keys "
                  "title, company, location, apply_url (must be a URL that appears in the email, not a gmail link), salary_text, "
                  "experience_text, job_type, deadline (YYYY-MM-DD or null). Skip ads, courses and non-job content.\n\n"
                  f"Subject: {subj}\n\n{body}")
        gem = fetch_json(f"https://generativelanguage.googleapis.com/v1beta/models/{os.environ.get('GEMINI_MODEL', 'gemini-flash-latest')}:generateContent",
                         data={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}},
                         headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
        try:
            items = json.loads(gem["candidates"][0]["content"]["parts"][0]["text"])
        except Exception:
            continue
        for x in items if isinstance(items, list) else []:
            url = str(x.get("apply_url") or "")
            if not url or url not in body or "mail.google" in url:
                continue  # only keep links that really are in the email
            sender = re.search(r"(indeed|linkedin|naukri|wellfound|internshala|unstop|instahyre|foundit|glassdoor)", subj + body[:500], re.I)
            j = make(x.get("title"), x.get("company"), x.get("location"), url,
                     (sender.group(1).title() if sender else "Email") + " alert", date,
                     salary_text=x.get("salary_text"), salary_min_monthly_inr=parse_salary(x.get("salary_text")),
                     experience_text=x.get("experience_text"), job_type=x.get("job_type"), deadline=x.get("deadline"))
            if j:
                out.append(j)
        time.sleep(4)  # free Gemini tier rate limit
    return out


# ---------------------------------------------------------------- merge + write
TRACKING = re.compile(r"^(utm_.*|j|refid|eid|from|source|trk|trackingId|refId|position|pageNum|originalSubdomain|src|ref)$", re.I)


def scrub_url(u):
    """Remove tracking parameters so personal tokens never land in the public repo."""
    try:
        p = urllib.parse.urlsplit(u)
    except ValueError:
        return None
    if re.search(r"mail\.google|email_clicks|cts\.indeed|/redirect/.*[?&]j=", u):
        return None
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True) if not TRACKING.match(k)]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ""))


def norm_key(j):
    return re.sub(r"\s+", " ", f"{j['title']}|{j['company']}".lower()).strip()


SOURCES = [
    ("LinkedIn", src_linkedin), ("Google Careers", src_google), ("Amazon Jobs", src_amazon),
    ("Microsoft Careers", src_microsoft), ("Workday careers (Adobe, NVIDIA, Intel, Salesforce)", src_workday),
    ("Telegram channels", src_telegram), ("Fresher job blogs (RSS)", src_rss), ("Infopark", src_infopark),
    ("Technopark", src_technopark), ("Arbeitnow (Germany visa)", src_arbeitnow), ("Remotive", src_remotive),
    ("Gmail alerts", src_gmail),
]


def main(only=None):
    prev = json.loads(OUT.read_text()) if OUT.exists() else {"jobs": []}
    jobs = {norm_key(j): j for j in prev.get("jobs", [])}
    stats = {}
    for name, fn in SOURCES:
        if only and only.lower() not in name.lower():
            continue
        log(f"→ {name}")
        t0 = time.time()
        try:
            found = fn()
        except Exception as e:  # one broken source must not stop the run
            stats[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}
            log(f"  FAILED {e}")
            continue
        if found is None:
            stats[name] = {"ok": None, "note": "not configured"}
            continue
        found = [j for j in found if j.get("category") != "Other" and j.get("is_fresher") is not False]
        new = 0
        for j in found:
            url = scrub_url(j["apply_url"])
            if not url:
                continue
            j["apply_url"] = url
            k = norm_key(j)
            if k in jobs:
                old = jobs[k]
                old["last_seen"] = TODAY.isoformat()
                for f in ("deadline", "salary_text", "salary_min_monthly_inr", "experience_text", "job_type"):
                    if j.get(f) and not old.get(f):
                        old[f] = j[f]
            else:
                j["first_seen"] = j["last_seen"] = TODAY.isoformat()
                jobs[k] = j
                new += 1
        stats[name] = {"ok": True, "found": len(found), "new": new, "secs": round(time.time() - t0)}
        log(f"  found {len(found)}, new {new}")

    keep_days = CFG["keep_days_without_sighting"]
    kept = []
    for j in jobs.values():
        dl = j.get("deadline")
        try:
            if dl and dt.date.fromisoformat(str(dl)[:10]) < TODAY - dt.timedelta(days=1):
                continue
        except ValueError:
            pass
        seen = j.get("last_seen") or j.get("first_seen") or j.get("posted_or_email_date") or TODAY.isoformat()
        try:
            if (TODAY - dt.date.fromisoformat(seen[:10])).days > keep_days:
                continue
        except ValueError:
            pass
        if j.get("category") == "Other" or j.get("is_fresher") is False:
            continue
        kept.append(j)
    kept.sort(key=lambda j: (j.get("first_seen", ""), j.get("posted_or_email_date", "")), reverse=True)
    prev_stats = prev.get("sources", {})
    for name, s in prev_stats.items():
        stats.setdefault(name, s)
    OUT.write_text(json.dumps({
        "built": NOW.strftime("%d %b %Y, %H:%M UTC"),
        "built_at": NOW.isoformat(timespec="seconds"),
        "sources": stats,
        "jobs": kept,
    }, ensure_ascii=False, indent=0))
    log(f"wrote {len(kept)} jobs → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
