# Personal Job Finder Radar

A self-updating radar of **fresher / entry-level tech jobs** (software, AI/ML, data, web, mobile, cloud): Kerala (Kochi, Trivandrum), Chennai, Bangalore, the rest of India and remote, big-tech internships, walk-in drives, and visa-sponsored roles in Germany.

It runs entirely on free GitHub features. No paid AI subscription is needed.

- **Collector**: `scraper/radar.py` runs every day at 07:00 IST in GitHub Actions and writes `docs/data/jobs.json`.
- **Website**: `docs/` is served by GitHub Pages. It shows tabs (Kochi, Trivandrum, Bangalore, Rest of India and remote, Walk-in drives, MNC India tracker, Germany visa), search, sorting, and **Applied** / **Delete** marks saved in your browser.

## Sources

| Source | What it gives | How |
|---|---|---|
| LinkedIn | Entry-level and internship jobs, past week, per city, plus remote and walk-ins | Public guest job search (no login) |
| Google, Amazon, Microsoft | Early-career, intern and level-I roles in India | Their public careers search |
| Adobe, NVIDIA, Intel, Salesforce | India intern, graduate and associate roles | Workday careers API |
| Telegram | Fresher drives posted in public channels (`config/sources.json`) | `t.me/s/<channel>` web preview |
| OffCampusJobs4u, Freshershunt | Off-campus drives and internships | RSS |
| Infopark, Technopark | Kerala IT park openings, including walk-ins and deadlines | Official job boards |
| Arbeitnow | Germany jobs with visa sponsorship | Public API |
| Remotive | Remote junior roles open to India | Public API |
| Gmail (optional) | Your job-alert emails (Indeed, LinkedIn, Naukri, Wellfound…) | Gmail API + Gemini free tier, see below |

Each source is independent: if one is blocked on a given day, the rest still update. The site's "Sources checked" panel shows each one's status.

Jobs disappear when their deadline passes, or after 21 days without being seen again. Non-tech roles and roles that are clearly senior are filtered out.

## Refresh

- **Automatic**: daily at 07:00 IST.
- **On demand**: press **Refresh now** on the site (or Actions → *Refresh jobs* → **Run workflow**). New data is live in about 5 minutes.

## Change what it searches

Edit `config/sources.json`: LinkedIn keywords and cities, Telegram channels, RSS feeds, Workday companies, Amazon and Microsoft queries. Commit the change; the next run uses it.

## Optional: Gmail job alerts

Add four repository secrets (Settings → Secrets and variables → Actions):

1. `GEMINI_API_KEY`: a free key from https://aistudio.google.com/apikey
2. `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`: in Google Cloud Console, create an OAuth client of type *Desktop app* with the Gmail API enabled.
3. `GMAIL_REFRESH_TOKEN`: run `python scraper/gmail_token.py` locally once and paste the token it prints.

Only the extracted job fields and their original apply links are saved. Email text and Gmail links never reach the repository.

## Moving your Applied / Deleted marks

Marks are stored in the browser. Use **Export marks** on one device and **Import marks** on another.

## Keep it running

GitHub pauses scheduled workflows in a repository with no activity for 60 days. The daily data commit normally counts as activity. If the site ever says the refresh looks late, open the Actions tab and re-enable the workflow.
