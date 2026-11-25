/* Personal Job Finder Radar: renders docs/data/jobs.json (rebuilt daily by a scheduled workflow).
   Applied / Deleted marks live in this browser; Export / Import moves them between devices. */
(function () {
  "use strict";

  const SEED = window.JOB_SEED || { jobs: [], built: "" };
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_MONTHLY = 25000;
  const TECH = ["AI/ML", "Web Dev", "Software Dev", "Mobile", "Data", "DevOps/Cloud"];
  const TABS = [
    { id: "kochi", label: "Kochi", lede: "Kochi, Infopark, Kakkanad and the rest of Ernakulam." },
    { id: "tvm", label: "Trivandrum", lede: "Technopark, Kazhakoottam and Thiruvananthapuram." },
    { id: "bangalore", label: "Bangalore", lede: "Bengaluru offices and hybrid roles." },
    { id: "elsewhere", label: "India & remote", lede: "Other Indian cities, and remote roles you can do from India." },
    { id: "walkin", label: "Walk-in drives", lede: "Walk-in interviews and hiring drives in Kerala, Chennai / Tamil Nadu and Bangalore. Low or unlisted pay is kept here so you can judge each drive." },
    { id: "mnc", label: "Big companies", lede: "The biggest IT employers hiring freshers in India: their programs, where each stands, and the openings found so far." },
    { id: "germany", label: "Germany (visa)", lede: "Tech roles in Germany whose employers offer visa sponsorship, mostly through the EU Blue Card." },
  ];

  /* ---------- storage (never required) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("jr." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("jr." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c != null && n.append(c.nodeType ? c : document.createTextNode(String(c))));
    return n;
  };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const parseDate = (s) => { if (!s) return null; const d = new Date(String(s).slice(0, 10) + "T00:00:00"); return isNaN(d) ? null : d; };
  const fmtDate = (d) => d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "";
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
  const key = (j) => (String(j.title || "") + "|" + String(j.company || "")).toLowerCase().replace(/\s+/g, " ").trim();

  function cityOf(j) {
    const loc = String(j.city || "") + " " + String(j.location || "");
    if (/trivandrum|thiruvananthapuram|technopark|kazhakoottam|tvm/i.test(loc)) return "tvm";
    if (/bangalore|bengaluru|whitefield|electronic city|koramangala|hsr layout/i.test(loc)) return "bangalore";
    if (j.is_kochi || /kochi|cochin|ernakulam|kakkanad|infopark|kalamassery|aluva|edappally|palarivattom|vyttila|kadavanthra|kadavanthara|smart ?city/i.test(loc)) {
      if (/koratty|thrissur/i.test(loc)) return "elsewhere";
      return "kochi";
    }
    return "elsewhere";
  }

  function salaryOf(j) {
    const v = Number(j.salary_min_monthly_inr);
    return isFinite(v) && v > 0 ? v : null;
  }

  /* A job is listed when: tech role, fresher (or experience not stated), deadline not passed,
     and either a stated minimum ≥ ₹25k/month or no salary stated (shown in its own section). */
  function eligible(j) {
    if (!TECH.includes(j.category)) return false;
    if (!inIndia(j)) return false;
    if (j.is_fresher === false) return false;
    const dl = parseDate(j.deadline);
    if (dl && dl < today()) return false;
    const s = salaryOf(j);
    if (s != null && s < MIN_MONTHLY) return false;
    if (s == null && j.salary_text && !/not|negotiable|best in|competitive|^\s*paid\s*$/i.test(j.salary_text)) return false; // stated but unparsed (e.g. foreign currency)
    return true;
  }
  /* Walk-ins: tech, fresher or unstated, not expired, in Kerala / Tamil Nadu / Bangalore. No pay floor. */
  const WALKIN_RE = /walk[\s-]?in|hiring drive|recruitment drive|interview drive/i;
  const REGION_RE = /kerala|kochi|cochin|ernakulam|kakkanad|infopark|aluva|kalamassery|trivandrum|thiruvananthapuram|technopark|kazhakoottam|kozhikode|calicut|thrissur|kollam|kannur|palakkad|kottayam|tamil nadu|chennai|coimbatore|madurai|trichy|tiruchirappalli|salem|tidel|bangalore|bengaluru/i;
  function isWalkin(j) {
    if (!(j.job_type && WALKIN_RE.test(j.job_type)) && !WALKIN_RE.test(String(j.title || ""))) return false;
    if (!REGION_RE.test(String(j.city || "") + " " + String(j.location || ""))) return false;
    if (!TECH.includes(j.category) || j.is_fresher === false) return false;
    const dl = parseDate(j.deadline);
    return !(dl && dl < today());
  }
  function walkinJobs() { return mergedJobs().filter(isWalkin); }

  /* India only: an Indian place, or a remote role open to people in India. */
  const INDIA_RE = /india|kerala|kochi|cochin|ernakulam|kakkanad|infopark|aluva|kalamassery|palarivattom|trivandrum|thiruvananthapuram|technopark|kazhakoottam|kozhikode|calicut|thrissur|kollam|kannur|kottayam|palakkad|tamil nadu|chennai|coimbatore|madurai|trichy|bangalore|bengaluru|karnataka|mysore|mangalore|hyderabad|telangana|pune|mumbai|maharashtra|miraj|nagpur|delhi|noida|gurugram|gurgaon|haryana|kolkata|west bengal|gujarat|ahmedabad|goa|jaipur|chandigarh|indore|bhubaneswar|lucknow|visakhapatnam|uttar pradesh|pan india/i;
  const REMOTE_RE = /remote|work from home|\bwfh\b/i;
  const OPEN_RE = /everywhere|worldwide|anywhere|global|asia|apac/i;
  const FOREIGN_RE = /united states|\busa?\b|u\.s\.|san francisco|new york|london|united kingdom|\buk\b|canada|australia|singapore|dubai|\buae\b|germany|berlin|munich|europe|\beu\b|philippines|hong kong|china|hangzhou|japan|france|paris|netherlands|ireland/i;
  function inIndia(j) {
    const loc = String(j.city || "") + " " + String(j.location || "") + " " + String(j.country || "");
    if (j.country && !/india/i.test(j.country) && !REMOTE_RE.test(loc)) return false;
    if (INDIA_RE.test(loc)) return true;
    return REMOTE_RE.test(loc) && (OPEN_RE.test(loc) || !FOREIGN_RE.test(loc));
  }
  const notExpired = (j) => { const dl = parseDate(j.deadline); return !(dl && dl < today()); };
  const GERMANY_RE = /germany|deutschland|berlin|m[üu]nchen|munich|hamburg|frankfurt|k[öo]ln|cologne|stuttgart|d[üu]sseldorf|leipzig|dresden|karlsruhe|n[üu]rnberg|nuremberg|bonn|hannover|potsdam|darmstadt|heidelberg|mannheim|bochum|aachen|bremen|essen|dortmund/i;
  function isGermany(j) {
    const loc = String(j.city || "") + " " + String(j.location || "") + " " + String(j.country || "");
    return GERMANY_RE.test(loc) && j.visa_sponsorship === true && TECH.includes(j.category) && j.is_fresher !== false && notExpired(j);
  }
  function germanyJobs() { return mergedJobs().filter(isGermany); }

  /* MNC India pipeline: about 50 of the biggest tech employers in India. Status as researched on 21 Nov 2026. */
  const MNC_GROUPS = [["svc", "IT services & consulting"], ["tech", "Global tech & product"], ["prod", "Indian product companies"], ["rd", "Chips & engineering R&D"], ["ker", "Kerala hubs"]];
  const ST_FILTERS = [["all", "All"], ["open", "Hiring now"], ["rolling", "Rolling"], ["watch", "Watch"]];
  const MNCS = [
    { name: "TCS", re: /\btcs\b|tata consultancy/i, grp: "svc", prog: "TCS NQT (Ninja / Digital / Prime)", st: "closed", stx: "Registration closed", note: "November NQT registration closed 12 Nov; the test is on 24 Nov. Watch for the next NQT cycle.", url: "https://www.tcs.com/careers/india", dom: "tcs.com" },
    { name: "Infosys", re: /infosys/i, grp: "svc", prog: "Systems Engineer / Specialist Programmer", st: "rolling", stx: "Hiring", note: "Plans 20,000+ fresher hires in FY27. Off-campus roles open on its careers site.", url: "https://career.infosys.com/joblist", dom: "infosys.com" },
    { name: "Wipro", re: /wipro/i, grp: "svc", prog: "Elite NLTH, Developer L1, AI Engineer L1", st: "rolling", stx: "Rolling", note: "No fixed fresher target. Your Wipro career alerts already feed this page.", url: "https://careers.wipro.com/", dom: "wipro.com" },
    { name: "Cognizant", re: /cognizant/i, grp: "svc", prog: "GenC / GenC Next / GenC Pro", st: "open", stx: "Drive listed", note: "GenC Analyst Trainee off-campus drive posted 4 Nov on job sites. Confirm on the careers page.", url: "https://careers.cognizant.com/in/en", dom: "cognizant.com" },
    { name: "Accenture", re: /accenture/i, grp: "svc", prog: "Associate Software Engineer (ASE)", st: "open", stx: "Roles listed", note: "ASE and associate developer roles seen in November listings.", url: "https://www.accenture.com/in-en/careers", dom: "accenture.com" },
    { name: "Capgemini", re: /capgemini/i, grp: "svc", prog: "Analyst / Associate Software Engineer", st: "open", stx: "Roles listed", note: "Associate Software Engineer (Bangalore) and 2026-batch analyst roles seen in November.", url: "https://www.capgemini.com/in-en/careers/", dom: "capgemini.com" },
    { name: "HCLTech", re: /\bhcl/i, grp: "svc", prog: "Graduate Engineer Trainee / TechBee", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.hcltech.com/careers", dom: "hcltech.com" },
    { name: "Tech Mahindra", re: /tech ?mahindra/i, grp: "svc", prog: "Associate Software Engineer", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://careers.techmahindra.com/", dom: "techmahindra.com" },
    { name: "LTIMindtree", re: /ltimindtree|lti ?mindtree/i, grp: "svc", prog: "Graduate Engineer Trainee", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.ltimindtree.com/careers/", dom: "ltimindtree.com" },
    { name: "Deloitte USI", re: /deloitte/i, grp: "svc", prog: "Analyst Trainee (Technology) via NLA", st: "closed", stx: "Next cycle", note: "The 2026-batch NLA closed in January. The next intake is expected in the coming months.", url: "https://www.deloitte.com/in/en/careers.html", dom: "deloitte.com" },
    { name: "PwC India", re: /\bpwc\b|pricewaterhouse/i, grp: "svc", prog: "Associate, Technology / AC", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.pwc.in/careers.html", dom: "pwc.com" },
    { name: "Persistent", re: /persistent systems|\bpersistent\b/i, grp: "svc", prog: "Graduate Engineer Trainee", st: "none", stx: "Watch", note: "Usually runs drives in spring. No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.persistent.com/careers/", dom: "persistent.com" },
    { name: "Mphasis", re: /mphasis/i, grp: "svc", prog: "Associate Software Engineer", st: "none", stx: "Watch", note: "Usually runs drives in spring. No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://careers.mphasis.com/", dom: "mphasis.com" },
    { name: "Hexaware", re: /hexaware/i, grp: "svc", prog: "Graduate Engineer Trainee", st: "none", stx: "Watch", note: "Usually runs drives in early summer. No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://hexaware.com/careers/", dom: "hexaware.com" },
    { name: "Coforge", re: /coforge/i, grp: "svc", prog: "Graduate Engineer Trainee", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.coforge.com/careers", dom: "coforge.com" },
    { name: "Thoughtworks", re: /thoughtworks/i, grp: "svc", prog: "Graduate Developer", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.thoughtworks.com/careers", dom: "thoughtworks.com" },
    { name: "Amazon", re: /amazon|\baws\b/i, grp: "tech", prog: "SDE I / Applied Scientist I", st: "open", stx: "Roles listed", note: "SDE I for 2026 grads listed in Bengaluru, Hyderabad and Chennai.", url: "https://www.amazon.jobs/en/search?base_query=software+development+engineer&loc_query=India", dom: "amazon.jobs" },
    { name: "Microsoft", re: /microsoft/i, grp: "tech", prog: "Software Engineer (new college grad)", st: "rolling", stx: "Rolling", note: "Early-career SWE and cloud roles in Hyderabad, Bengaluru and Noida. Search “new college graduate”.", url: "https://jobs.careers.microsoft.com/global/en/search?q=new%20college%20graduate&lc=India", dom: "microsoft.com" },
    { name: "Google", re: /google/i, grp: "tech", prog: "Software Engineer, University Graduate / Internships", st: "open", stx: "Roles listed", note: "21 Nov web search: Forward Deployed Engineer Intern 2027 and Student Researcher 2027 (Bengaluru), plus a Software Engineer, Search role. Filter by Early career or Intern, India.", url: "https://www.google.com/about/careers/applications/jobs/results/?location=India&target_level=EARLY", dom: "google.com" },
    { name: "IBM", re: /\bibm\b/i, grp: "tech", prog: "Associate Developer / Associate System Engineer", st: "open", stx: "Roles listed", note: "Entry-level roles across India, Kochi included.", url: "https://www.ibm.com/careers/search", dom: "ibm.com" },
    { name: "Oracle", re: /oracle/i, grp: "tech", prog: "Associate Software / Support Engineer, MTS", st: "open", stx: "Roles listed", note: "Associate Support Engineer seen in Bangalore. No dated SWE posting confirmed.", url: "https://careers.oracle.com/", dom: "oracle.com" },
    { name: "SAP Labs", re: /\bsap\b/i, grp: "tech", prog: "Associate Developer", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://jobs.sap.com/", dom: "sap.com" },
    { name: "Adobe", re: /adobe/i, grp: "tech", prog: "Member of Technical Staff (MTS)", st: "none", stx: "Watch", note: "No new fresher or intern role in the 21 Nov web search. Last seen: SDE, Noida (posted 10 Sep). Set a job alert on the careers site.", url: "https://careers.adobe.com/us/en", dom: "adobe.com" },
    { name: "Meta", re: /\bmeta\b|facebook/i, grp: "tech", prog: "Software Engineer (University Grad) / Intern", st: "none", stx: "Watch", note: "No India fresher or intern opening found on 21 Nov; Meta hires few freshers in India (mostly Bengaluru and Hyderabad). Set an alert.", url: "https://www.metacareers.com/jobs?offices[0]=Bangalore%2C%20India&offices[1]=Hyderabad%2C%20India", dom: "metacareers.com" },
    { name: "Salesforce", re: /salesforce/i, grp: "tech", prog: "AMTS, Software Engineering", st: "open", stx: "Intake open", note: "2026-batch AMTS intake rounds reported for Bengaluru and Hyderabad.", url: "https://careers.salesforce.com/en/jobs/?country=India", dom: "salesforce.com" },
    { name: "Cisco", re: /cisco/i, grp: "tech", prog: "Software Engineer (India, evergreen)", st: "open", stx: "Roles listed", note: "Full Stack fresher role posted 13 Nov in Bengaluru. Some requisitions already closed.", url: "https://jobs.cisco.com/", dom: "cisco.com" },
    { name: "Atlassian", re: /atlassian/i, grp: "tech", prog: "Graduate Software Engineer", st: "rolling", stx: "Rolling", note: "Graduate SWE roles appear through the year.", url: "https://www.atlassian.com/company/careers/all-jobs", dom: "atlassian.com" },
    { name: "Uber", re: /\buber\b/i, grp: "tech", prog: "Software Engineer I", st: "rolling", stx: "Rolling", note: "Entry SWE and data roles in Bengaluru and Hyderabad.", url: "https://www.uber.com/in/en/careers/", dom: "uber.com" },
    { name: "Intuit", re: /intuit\b/i, grp: "tech", prog: "Software Engineer 1", st: "rolling", stx: "Rolling", note: "Software Engineer 1 roles seen in Bangalore.", url: "https://jobs.intuit.com/", dom: "intuit.com" },
    { name: "ServiceNow", re: /servicenow/i, grp: "tech", prog: "Associate Software Engineer", st: "rolling", stx: "Rolling", note: "Associate SWE and QA roles in Hyderabad.", url: "https://careers.servicenow.com/", dom: "servicenow.com" },
    { name: "Flipkart", re: /flipkart/i, grp: "prod", prog: "SDE 1", st: "rolling", stx: "Rolling", note: "Online test, machine-coding round, two DSA rounds, then hiring manager.", url: "https://www.flipkartcareers.com/", dom: "flipkart.com" },
    { name: "Zoho", re: /\bzoho\b/i, grp: "prod", prog: "Member Technical Staff / Zoho Schools", st: "rolling", stx: "Rolling", note: "Often posts openings quietly in December.", url: "https://www.zoho.com/careers/", dom: "zohocorp.com" },
    { name: "Freshworks", re: /freshworks/i, grp: "prod", prog: "Associate Software Engineer", st: "rolling", stx: "Rolling", note: "Often posts openings quietly in December.", url: "https://www.freshworks.com/company/careers/", dom: "freshworks.com" },
    { name: "PhonePe", re: /phonepe/i, grp: "prod", prog: "Software Engineer / Graduate Trainee", st: "rolling", stx: "Rolling", note: "Backend and mobile roles. Often posts in December.", url: "https://www.phonepe.com/careers/", dom: "phonepe.com" },
    { name: "Intel", re: /\bintel\b/i, grp: "rd", prog: "Graduate / Software Engineer", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://jobs.intel.com/", dom: "intel.com" },
    { name: "Qualcomm", re: /qualcomm/i, grp: "rd", prog: "Engineering intern → Associate Engineer", st: "rolling", stx: "Rolling", note: "Hyderabad, Bangalore and Chennai internships with high full-time conversion.", url: "https://careers.qualcomm.com/", dom: "qualcomm.com" },
    { name: "NVIDIA", re: /nvidia/i, grp: "rd", prog: "New College Grad (SWE, AI)", st: "none", stx: "Watch", note: "Fall new-grad requisitions are mostly closed. India roles appear on its Workday site.", url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", dom: "nvidia.com" },
    { name: "Samsung R&D", re: /samsung/i, grp: "rd", prog: "Software Engineer (SRI-B / SRI-N)", st: "none", stx: "Watch", note: "Mostly campus hiring. No off-campus opening found.", url: "https://research.samsung.com/careers", dom: "samsung.com" },
    { name: "Bosch (BGSW)", re: /bosch/i, grp: "rd", prog: "Associate Software Engineer", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.bosch-softwaretechnologies.com/en/careers/", dom: "bosch.com" },
    { name: "KPIT", re: /kpit/i, grp: "rd", prog: "Graduate Engineer Trainee", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.kpit.com/careers/", dom: "kpit.com" },
    { name: "L&T Technology Services", re: /l&t technology|\bltts\b/i, grp: "rd", prog: "Graduate Engineer Trainee", st: "none", stx: "Watch", note: "No fresher role found on 21 Nov. Set a job alert on the careers site.", url: "https://www.ltts.com/careers", dom: "ltts.com" },
    { name: "Tata Elxsi", re: /tata elxsi/i, grp: "rd", prog: "Graduate Engineer Trainee", st: "none", stx: "Experienced only", note: "Current Trivandrum openings ask for 3+ years.", url: "https://www.tataelxsi.com/careers/job-openings", dom: "tataelxsi.com" },
    { name: "UST", re: /\bust\b|ust global/i, grp: "ker", prog: "Developer I / internships", st: "rolling", stx: "Kerala hub", note: "Big in Trivandrum and Kochi. DevOps internships ran in TVM this year.", url: "https://careers.ust.com/", dom: "ust.com" },
    { name: "EY GDS", re: /\bey\b|ernst|ey gds/i, grp: "ker", prog: "Associate / Technology Consulting intern", st: "rolling", stx: "Kerala hub", note: "Kochi and Trivandrum centres. Tech consulting internships listed for 2026.", url: "https://www.ey.com/en_in/careers", dom: "ey.com" },
    { name: "IBS Software", re: /ibs software/i, grp: "ker", prog: "Trainee Engineer / Data Engineer", st: "rolling", stx: "Kerala hub", note: "Technopark and Kochi offices. Experience isn't stated on current data roles.", url: "https://www.ibsplc.com/careers", dom: "ibsplc.com" },
  ];
  const mncOf = (j) => MNCS.find((m) => m.re.test(String(j.company || "")));
  function isMnc(j) { return !!mncOf(j) && inIndia(j) && TECH.includes(j.category) && j.is_fresher !== false && notExpired(j); }
  function mncJobs() { return mergedJobs().filter(isMnc); }

  /* ---------- applied / deleted marks (this browser) ---------- */
  const marks = new Map(Object.entries(store.get("marks", {})));
  const markId = (k) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } return "m" + (h >>> 0).toString(36) + k.length.toString(36); };
  const markOf = (j) => marks.get(markId(key(j))) || {};
  function saveMarks() { store.set("marks", Object.fromEntries(marks)); }
  function setMark(j, patch, quiet) {
    const id = markId(key(j));
    const before = marks.has(id) ? Object.assign({}, marks.get(id)) : null;
    const next = Object.assign({}, before || {}, patch, { key: key(j), title: j.title || "", company: j.company || "", at: new Date().toISOString() });
    if (!next.applied && !next.deleted) marks.delete(id); else marks.set(id, next);
    saveMarks();
    render();
    if (quiet) return;
    const msg = patch.deleted === true ? "Deleted “" + j.title + "”" : patch.deleted === false ? "Restored “" + j.title + "”"
      : patch.applied === true ? "Marked “" + j.title + "” as applied" : "Moved “" + j.title + "” back to open roles";
    toast(msg, () => { if (before) marks.set(id, before); else marks.delete(id); saveMarks(); render(); });
  }

  /* ---------- toast ---------- */
  let toastT = 0;
  function toast(msg, undo, kind) {
    const box = $("#toast");
    const kids = [el("span", { text: msg })];
    if (undo) {
      const b = el("button", { type: "button", text: "Undo" });
      b.addEventListener("click", () => { undo(); box.hidden = true; });
      kids.push(b);
    }
    box.replaceChildren(...kids);
    box.dataset.kind = kind || "";
    box.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { box.hidden = true; }, 6000);
  }

  /* ---------- data ---------- */
  function mergedJobs() {
    const map = new Map();
    SEED.jobs.forEach((j) => { if (j && j.title) map.set(key(j), j); });
    return [...map.values()];
  }
  function allJobs() { return mergedJobs().filter(eligible); }

  /* ---------- small formatters ---------- */
  const cap = (s) => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) : ""; };
  const srcName = (s) => String(s || "").replace(/\s*\((verify|visa)[^)]*\)/i, "").replace(/^Telegram @/, "Telegram: ");
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  function ago(ms) {
    const h = (Date.now() - ms) / 36e5;
    if (h < 1) return "less than an hour ago";
    if (h < 36) return plural(Math.round(h), "hour") + " ago";
    return plural(Math.round(h / 24), "day") + " ago";
  }
  const icon = (d) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = d;
    return s;
  };
  const I = {
    check: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  /* ---------- sorting / filters ---------- */
  const SORTS = {
    "salary-desc": (a, b) => (salaryOf(b) ?? -1) - (salaryOf(a) ?? -1),
    "salary-asc": (a, b) => (salaryOf(a) ?? Infinity) - (salaryOf(b) ?? Infinity),
    "deadline": (a, b) => (parseDate(a.deadline) || 8.64e15) - (parseDate(b.deadline) || 8.64e15),
    "newest": (a, b) => (Date.parse(b.first_seen || b.posted_or_email_date) || 0) - (Date.parse(a.first_seen || a.posted_or_email_date) || 0),
  };
  const ui = { q: "", cat: store.get("cat", "all"), mncSt: store.get("mncSt", "all"), view: "open" };
  if (ui.cat !== "all" && !TECH.includes(ui.cat)) ui.cat = "all";
  function uiOk(j) {
    if (ui.cat !== "all" && j.category !== ui.cat) return false;
    if (!ui.q) return true;
    const hay = [j.title, j.company, j.location, j.category, j.experience_text, j.job_type, j.source].join(" ").toLowerCase();
    return ui.q.split(/\s+/).every((w) => hay.includes(w));
  }
  const inView = (j) => { const m = markOf(j); return ui.view === "deleted" ? !!m.deleted : ui.view === "applied" ? (!!m.applied && !m.deleted) : (!m.applied && !m.deleted); };

  function currentTab() {
    const h = location.hash.replace("#", "");
    return TABS.some((t) => t.id === h) ? h : "kochi";
  }
  function tabJobs(tab, pool) {
    if (tab === "walkin") return walkinJobs();
    if (tab === "mnc") return mncJobs();
    if (tab === "germany") return germanyJobs();
    return pool.filter((j) => cityOf(j) === tab);
  }

  /* ---------- radar dial (header) ---------- */
  const SECTORS = [["kochi", "Kochi"], ["tvm", "Trivandrum"], ["bangalore", "Bangalore"], ["elsewhere", "India"], ["germany", "Germany"]];
  function renderRadar(pool) {
    const svg = $("#radar");
    if (!svg) return;
    const R = 100, C = 110, NS = "http://www.w3.org/2000/svg";
    const mk = (tag, a) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); return n; };
    const parts = [];
    [1, 2 / 3, 1 / 3].forEach((f) => parts.push(mk("circle", { cx: C, cy: C, r: R * f, class: "ring" })));
    const span = 360 / SECTORS.length;
    const pt = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    SECTORS.forEach(([id, label], i) => {
      const [x, y] = pt(i * span, R);
      parts.push(mk("line", { x1: C, y1: C, x2: x, y2: y, class: "spoke" }));
      const [lx, ly] = pt(i * span + span / 2, R + 2);
      const t = mk("text", { x: lx, y: ly, class: "sector", "text-anchor": lx < C - 8 ? "end" : lx > C + 8 ? "start" : "middle", "dominant-baseline": ly < C ? "auto" : "hanging" });
      t.textContent = label;
      parts.push(t);
    });
    const sweep = mk("g", { class: "sweep" });
    const [sx, sy] = pt(0, R), [ex, ey] = pt(-38, R);
    sweep.append(mk("path", { d: `M${C},${C} L${sx},${sy} A${R},${R} 0 0 0 ${ex},${ey} Z`, fill: "url(#sweepGrad)" }));
    const defs = mk("defs", {});
    const g = mk("linearGradient", { id: "sweepGrad", x1: "0", y1: "0", x2: "1", y2: "0" });
    g.append(mk("stop", { offset: "0", "stop-color": "currentColor", "stop-opacity": "0" }), mk("stop", { offset: "1", "stop-color": "currentColor", "stop-opacity": ".45" }));
    defs.append(g);
    const now = Date.now();
    let n = 0;
    const germany = new Set(germanyJobs().map(key));
    pool.concat(germanyJobs()).forEach((j) => {
      const posted = parseDate(j.posted_or_email_date), first = Date.parse(j.first_seen || "");
      const seen = posted ? Math.min(posted.getTime() + 12 * 36e5, isNaN(first) ? Infinity : first) : first;
      if (isNaN(seen)) return;
      const age = (now - seen) / DAY_MS;
      if (age > 7 || markOf(j).deleted) return;
      const sec = germany.has(key(j)) ? "germany" : cityOf(j);
      const i = SECTORS.findIndex(([id]) => id === sec);
      if (i < 0) return;
      let h = 0; const k = key(j); for (let c = 0; c < k.length; c++) h = (h * 31 + k.charCodeAt(c)) >>> 0;
      const deg = i * span + 6 + (h % 1000) / 1000 * (span - 12);
      const [x, y] = pt(deg, 10 + Math.min(age, 7) / 7 * (R - 16) + ((h >> 10) % 7));
      const dot = mk("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: age < 1 ? 3 : 2.2, class: "blip" + (age < 1 ? " fresh" : "") });
      dot.style.animationDelay = (deg / 360 * 1.6).toFixed(2) + "s";
      parts.push(dot);
      n++;
    });
    parts.push(mk("circle", { cx: C, cy: C, r: 3, class: "core" }));
    svg.replaceChildren(defs, ...parts, sweep);
    svg.setAttribute("aria-label", n + " roles first seen in the last 7 days, placed by region; dots nearer the centre are newer.");
  }

  /* ---------- header ---------- */
  function renderHeader(pool) {
    const fresh = pool.concat(germanyJobs()).filter((j) => j.live && !markOf(j).deleted && !markOf(j).applied).length;
    const total = pool.filter((j) => !markOf(j).deleted && !markOf(j).applied).length;
    $("#headline").textContent = fresh
      ? plural(fresh, "new role") + " in the last 3 days, " + total + " open in all."
      : total + " open roles. Nothing new in the last 3 days.";
    const at = SEED.built_at ? Date.parse(SEED.built_at) : NaN;
    const late = !isNaN(at) && Date.now() - at > 36 * 36e5;
    const when = $("#when");
    when.textContent = isNaN(at) ? "No refresh has run yet." : "Updated " + ago(at) + ". Refreshes daily at 7:00 AM IST." + (late ? " The last scheduled refresh did not run; open the workflow to check it." : "");
    when.dataset.kind = late ? "warn" : "";
  }
  function renderSources() {
    const src = SEED.sources || {};
    $("#src-list").replaceChildren(...Object.entries(src).map(([name, s]) => {
      const state = s.ok === true ? (s.found ? "ok" : "zero") : s.ok === null ? "off" : "bad";
      const txt = s.ok === true ? (s.found ? s.found + " found, " + s.new + " new" : "nothing today") : s.ok === null ? "not connected" : "failed";
      return el("li", { class: state, title: s.error || "" }, el("span", { text: name.replace(/\s*\(.*\)/, "") }), el("b", { text: txt }));
    }));
  }

  /* ---------- toolbar ---------- */
  function renderCats() {
    $("#cats").replaceChildren(...["all", ...TECH].map((c) => {
      const b = el("button", { type: "button", "aria-pressed": String(ui.cat === c), text: c === "all" ? "All fields" : c });
      b.addEventListener("click", () => { ui.cat = c; store.set("cat", c); render(); });
      return b;
    }));
  }
  function renderViews(counts) {
    $("#views").replaceChildren(...[["open", "Open"], ["applied", "Applied"], ["deleted", "Deleted"]].map(([id, label]) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(ui.view === id) }, label, el("b", { text: String(counts[id]) }));
      b.addEventListener("click", () => { ui.view = id; render(); });
      return b;
    }));
  }

  /* ---------- job rows ---------- */
  function jobItem(j) {
    const s = salaryOf(j);
    const dl = parseDate(j.deadline);
    const days = dl ? Math.round((dl - today()) / DAY_MS) : null;
    const url = safeUrl(j.apply_url);
    const mk = markOf(j);
    const soon = dl && days <= 3 && !mk.applied;
    const type = cap(j.job_type && !/^(none|—|-)$/i.test(j.job_type) ? j.job_type : "");
    const exp = j.experience_text && !/^LinkedIn:|^Google:|not stated/i.test(j.experience_text) ? j.experience_text : "";
    const tags = [
      j.live ? el("span", { class: "tag new", text: "New" }) : null,
      el("span", { class: "tag", text: j.category }),
      type ? el("span", { class: "tag", text: type.length > 28 ? type.slice(0, 26) + "…" : type }) : null,
      exp ? el("span", { class: "tag soft", title: exp, text: exp.length > 44 ? exp.slice(0, 42) + "…" : exp }) : (j.is_fresher === true ? el("span", { class: "tag soft", text: "Fresher" }) : null),
    ];
    const applyBtn = url
      ? el("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer" }, "Apply", icon(I.out))
      : el("span", { class: "btn ghost", text: "No link" });
    const appliedBtn = el("button", { type: "button", class: "btn toggle", "aria-pressed": String(!!mk.applied) }, icon(I.check), el("span", { text: mk.applied ? "Applied" : "Mark applied" }));
    appliedBtn.addEventListener("click", () => setMark(j, { applied: !mk.applied }));
    const delBtn = el("button", { type: "button", class: "btn icon" + (mk.deleted ? " restore" : ""), "aria-label": (mk.deleted ? "Restore " : "Delete ") + j.title, title: mk.deleted ? "Restore" : "Delete" }, icon(mk.deleted ? I.undo : I.trash));
    delBtn.addEventListener("click", () => setMark(j, { deleted: !mk.deleted }));
    const posted = parseDate(j.posted_or_email_date);
    return el("article", { class: "job" + (mk.applied ? " is-applied" : "") + (mk.deleted ? " is-deleted" : "") + (soon ? " is-soon" : "") },
      el("div", { class: "job-main" },
        el("h3", {}, url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: j.title }) : j.title),
        el("p", { class: "job-co" }, el("span", { class: "co-name", text: j.company || "Company not listed" }), el("span", { class: "co-loc", text: j.location || "" })),
        el("div", { class: "tags" }, tags),
        el("p", { class: "job-src", text: "From " + srcName(j.source) + (posted ? ", posted " + fmtDate(posted) : "") })),
      el("div", { class: "job-pay" + (s ? "" : " none") },
        el("span", { text: s ? (j.salary_display || j.salary_text) : "Pay not listed" }),
        s && j.salary_display && !/month|mo\b/i.test(j.salary_display) ? el("small", { text: "≈ ₹" + Math.round(s / 1000) + "k a month" }) : null),
      el("div", { class: "job-due" + (soon ? " soon" : "") },
        el("span", { text: dl ? "Apply by " + fmtDate(dl) : "No deadline" }),
        dl ? el("small", { text: days === 0 ? "Last day" : plural(days, "day") + " left" }) : null),
      el("div", { class: "job-act" }, applyBtn, appliedBtn, delBtn));
  }
  function group(jobs, title, note) {
    return el("section", { class: "group" },
      el("div", { class: "group-h" }, el("h2", { text: title }), el("span", { class: "count", text: String(jobs.length) }), note ? el("p", { text: note }) : null),
      jobs.length ? el("div", { class: "jobs" }, jobs.map(jobItem)) : el("p", { class: "empty", text: emptyText() }));
  }
  function emptyText() {
    if (ui.q || ui.cat !== "all") return "No roles match this search. Clear the search or pick “All fields”.";
    if (ui.view === "applied") return "Roles you mark as applied collect here.";
    if (ui.view === "deleted") return "Roles you delete collect here, so you can restore them.";
    return "No open roles here right now. Check another tab, or press Refresh now.";
  }

  /* ---------- MNC tracker ---------- */
  function trackerSection(openings) {
    const counts = new Map();
    openings.forEach((j) => { const m = mncOf(j); counts.set(m.name, (counts.get(m.name) || 0) + 1); });
    const f = ui.mncSt || "all";
    const match = (m, id) => id === "all" || (id === "watch" ? (m.st === "none" || m.st === "closed") : m.st === id);
    const filt = el("div", { class: "seg", role: "radiogroup", "aria-label": "Company status" }, ST_FILTERS.map(([id, label]) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(f === id) }, label, el("b", { text: String(MNCS.filter((m) => match(m, id)).length) }));
      b.addEventListener("click", () => { ui.mncSt = id; store.set("mncSt", id); render(); });
      return b;
    }));
    const card = (m) => {
      const n = counts.get(m.name) || 0;
      const show = el("button", { type: "button", class: "linkish", disabled: n ? null : "disabled", text: n ? "See " + plural(n, "opening") : "No openings yet" });
      show.addEventListener("click", () => { $("#q").value = m.name; ui.q = m.name.toLowerCase(); render(); const t = $("#mnc-openings"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
      return el("article", { class: "co" },
        el("div", { class: "co-top" }, el("h3", { text: m.name }), el("span", { class: "st " + m.st, text: m.stx })),
        el("p", { class: "prog", text: m.prog }),
        el("p", { class: "co-note", text: m.note }),
        el("div", { class: "co-foot" }, show, el("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" }, "Careers site", icon(I.out))));
    };
    const groups = MNC_GROUPS.map(([g, label]) => {
      const list = MNCS.filter((m) => m.grp === g && match(m, f));
      return list.length ? el("div", { class: "co-grp" }, el("h3", { class: "co-grp-h", text: label }), el("div", { class: "tracker" }, list.map(card))) : null;
    });
    return el("section", { class: "group" },
      el("div", { class: "group-h" }, el("h2", { text: "Company tracker" }), el("span", { class: "count", text: String(MNCS.length) }), filt),
      ...groups);
  }

  /* ---------- render ---------- */
  function render() {
    const tab = currentTab();
    const sort = $("#sort").value;
    const pool = allJobs();
    const base = tabJobs(tab, pool).filter(uiOk);
    const counts = { open: 0, applied: 0, deleted: 0 };
    base.forEach((j) => { const m = markOf(j); if (m.deleted) counts.deleted++; else if (m.applied) counts.applied++; else counts.open++; });
    renderViews(counts);
    renderCats();
    renderHeader(pool);

    $("#tabs").replaceChildren(...TABS.map((t) => {
      const n = tabJobs(t.id, pool).filter((j) => { const m = markOf(j); return !m.deleted && !m.applied; }).length;
      return el("a", { href: "#" + t.id, class: t.id === tab ? "on" : null, "aria-current": t.id === tab ? "page" : null }, t.label, el("b", { text: String(n) }));
    }));
    const on = $("#tabs a.on"), bar = $("#tabs");
    if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = on.offsetLeft - 16;
    const meta = TABS.find((t) => t.id === tab);
    $("#tab-title").textContent = meta.label;
    $("#tab-lede").textContent = meta.lede;

    const list = base.filter(inView).sort(SORTS[sort] || SORTS["salary-desc"]);
    const soon = list.filter((j) => { const d = parseDate(j.deadline); return d && (d - today()) / DAY_MS <= 3; }).length;
    $("#tab-sum").textContent = plural(list.length, ui.view === "open" ? "role" : ui.view + " role") + (soon && ui.view === "open" ? ", " + soon + " closing within 3 days" : "") + ".";

    const out = [];
    if (tab === "mnc") out.push(trackerSection(mncJobs()));
    if (tab === "germany") out.push(el("p", { class: "callout" },
      "Most of these employers hire non-EU graduates on the EU Blue Card, which has a minimum salary. Check the current threshold and German-language needs on ",
      el("a", { href: "https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card", target: "_blank", rel: "noopener noreferrer", text: "Make it in Germany" }), " before you apply."));
    if (["walkin", "mnc", "germany"].includes(tab)) {
      const g = group(list, tab === "mnc" ? "Fresher openings at these companies" : tab === "walkin" ? "Walk-in drives" : "Visa-sponsored roles");
      if (tab === "mnc") g.id = "mnc-openings";
      out.push(g);
    } else {
      const paid = list.filter((j) => salaryOf(j) != null);
      const unpaid = list.filter((j) => salaryOf(j) == null);
      if (sort === "salary-asc" || sort === "salary-desc") unpaid.sort(SORTS.newest);
      if (paid.length || ui.view === "open") out.push(group(paid, "Pay listed", "₹3 LPA (₹25k a month) or more"));
      out.push(group(unpaid, "Pay not listed"));
    }
    $("#list").replaceChildren(...out);
  }

  /* ---------- refresh link, marks backup ---------- */
  function initControls() {
    const host = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0];
    const pages = /\.github\.io$/.test(host);
    const owner = pages ? host.split(".")[0] : "TAKIGOKUL";
    const repo = pages && seg ? seg : "personal-job-finder-radar";
    $("#refresh").href = `https://github.com/${owner}/${repo}/actions/workflows/refresh.yml`;
    $("#marks-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(Object.fromEntries(marks), null, 1)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "job-radar-marks.json" });
      document.body.append(a); a.click(); a.remove();
      toast("Saved " + plural(marks.size, "mark") + " to job-radar-marks.json");
    });
    $("#marks-import").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const inc = data && data.marks ? data.marks : data;
        let n = 0;
        for (const [id, m] of Object.entries(inc || {})) { if (m && (m.applied || m.deleted)) { marks.set(id, Object.assign({}, marks.get(id) || {}, m)); n++; } }
        saveMarks(); render();
        toast("Loaded " + plural(n, "mark") + ".");
      } catch (err) { toast("That file isn't a marks backup. Choose job-radar-marks.json.", null, "warn"); }
      e.target.value = "";
    });
    const sortSel = $("#sort");
    sortSel.value = store.get("sort", "salary-desc");
    sortSel.addEventListener("change", () => { store.set("sort", sortSel.value); render(); });
    window.addEventListener("hashchange", () => { render(); });
    const qIn = $("#q");
    let qT = 0;
    qIn.addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(() => { ui.q = qIn.value.trim().toLowerCase(); render(); }, 120); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== qIn && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); qIn.focus(); }
    });
  }

  initControls();
  renderSources();
  renderRadar(allJobs());
  render();
})();
