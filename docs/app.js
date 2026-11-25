/* Personal Job Finder Radar: renders docs/data/jobs.json (rebuilt daily by a scheduled workflow).
   Applied / Deleted marks live in this browser; Export / Import moves them between devices. */
(function () {
  "use strict";

  const SEED = window.JOB_SEED || { jobs: [], built: "" };
  const IN_ARTIFACT = !!(window.claude && typeof window.claude.use === "function");
  const CAN_LIVE = false;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MIN_MONTHLY = 25000;
  const TECH = ["AI/ML", "Web Dev", "Software Dev", "Mobile", "Data", "DevOps/Cloud"];
  const TABS = [
    { id: "kochi", label: "Kochi", lede: "Kochi, Infopark, Kakkanad and the rest of Ernakulam." },
    { id: "tvm", label: "Trivandrum", lede: "Technopark, Kazhakoottam and Thiruvananthapuram." },
    { id: "bangalore", label: "Bangalore", lede: "Bengaluru offices and hybrid roles." },
    { id: "elsewhere", label: "Rest of India & remote", lede: "Other Indian cities, and remote roles you can do from India." },
    { id: "walkin", label: "Walk-in drives", lede: "Walk-in interviews and hiring drives in Kerala, Chennai / Tamil Nadu and Bangalore. Low or unlisted pay is kept here so you can judge each drive." },
    { id: "mnc", label: "MNC India", lede: "The biggest IT employers hiring freshers in India: their programs, where each stands, and the openings found so far." },
    { id: "germany", label: "Germany · visa", lede: "Tech roles in Germany whose employers offer visa sponsorship, mostly through the EU Blue Card." },
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

  /* ---------- applied / deleted marks (artifact db; browser storage fallback) ---------- */
  const marks = new Map(Object.entries(store.get("marks", {})));
  let marksDb = null;
  const markId = (k) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } return "m" + (h >>> 0).toString(36) + k.length.toString(36); };
  const markOf = (j) => marks.get(markId(key(j))) || {};
  function markState(msg, kind) { const n = $("#mark-state"); n.textContent = msg; n.dataset.kind = kind || ""; }
  async function setMark(j, patch) {
    const id = markId(key(j));
    const next = Object.assign({}, marks.get(id) || {}, patch, { key: key(j), title: j.title || "", company: j.company || "", at: new Date().toISOString() });
    const empty = !next.applied && !next.deleted;
    if (empty) marks.delete(id); else marks.set(id, next);
    render();
    if (!marksDb) { store.set("marks", Object.fromEntries(marks)); return; }
    try {
      const ref = marksDb.collection("marks").doc(id);
      if (empty) await ref.delete(); else await ref.set(next);
      markState(patch.applied === true ? "Moved to Applied. Tick “Show applied” to see it." : patch.deleted === true ? "Deleted. Tick “Show deleted” to see it." : "Saved", "");
    } catch (e) { markState("Couldn't save that mark: " + ((e && e.message) || "error"), "warn"); }
  }
  async function initMarks() {
    try { marksDb = await (window.claude && window.claude.use ? window.claude.use("db") : null); } catch (e) { marksDb = null; }
    if (!marksDb) { markState(marks.size ? "Marks are saved in this browser." : "", ""); return; }
    const timer = setTimeout(() => markState("Marks are taking a while to load.", "warn"), 10000);
    marksDb.collection("marks").onSnapshot((snap) => {
      clearTimeout(timer);
      marks.clear();
      snap.docs.forEach((d) => marks.set(d.id, d.data() || {}));
      markState("", "");
      render();
    }, (err) => { clearTimeout(timer); markState("Marks can't be loaded here: " + ((err && err.message) || "no access"), "warn"); });
    marksDb.collection("jobs").onSnapshot((snap) => {
      dbJobs.clear();
      snap.docs.forEach((d) => { const v = d.data(); if (v && v.title) dbJobs.set(d.id, v); });
      render();
    }, () => {});
    marksDb.doc("meta/refresh").onSnapshot((d) => {
      const v = (d && d.data()) || {};
      meta = { lastRun: v.lastRun || null, lastChecked: v.lastChecked || null, processed: Array.isArray(v.processed) ? v.processed : [] };
      metaLoaded = true;
      paintSync();
      maybeAuto();
    }, () => { metaLoaded = true; paintSync(); });
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
  function trackerSection(openings) {
    const counts = new Map();
    openings.forEach((j) => { const m = mncOf(j); counts.set(m.name, (counts.get(m.name) || 0) + 1); });
    const f = ui.mncSt || "all";
    const pass = (m) => f === "all" || (f === "watch" ? (m.st === "none" || m.st === "closed") : m.st === f);
    const filt = el("div", { class: "chips", role: "group", "aria-label": "Company status" }, ST_FILTERS.map(([id, label]) => {
      const n = MNCS.filter((m) => id === "all" || (id === "watch" ? (m.st === "none" || m.st === "closed") : m.st === id)).length;
      const b = el("button", { type: "button", "aria-pressed": String(f === id), text: label + " · " + n });
      b.addEventListener("click", () => { ui.mncSt = id; store.set("mncSt", id); render(); });
      return b;
    }));
    const card = (m) => {
      const n = counts.get(m.name) || 0;
      const show = el("button", { type: "button", class: "linkish", text: n ? "Show " + n + " opening" + (n === 1 ? "" : "s") : "No openings yet", disabled: n ? null : "disabled" });
      show.addEventListener("click", () => { $("#q").value = m.name; ui.q = m.name.toLowerCase(); render(); const t = document.querySelector("#list .block:last-child"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
      return el("article", { class: "co" },
        el("div", { class: "co-top" }, el("h3", { text: m.name }), el("span", { class: "st " + m.st, text: m.stx })),
        el("p", { class: "prog", text: m.prog }),
        el("p", { text: m.note }),
        el("div", { class: "co-foot" }, show, el("a", { href: m.url, target: "_blank", rel: "noopener noreferrer", text: "Careers ↗" })));
    };
    const groups = MNC_GROUPS.map(([g, label]) => {
      const list = MNCS.filter((m) => m.grp === g && pass(m));
      if (!list.length) return null;
      return el("div", { class: "grp" }, el("h3", { class: "grp-h", text: label + " (" + list.length + ")" }), el("div", { class: "tracker" }, list.map(card)));
    });
    return el("section", { class: "block" },
      el("div", { class: "trk-head" }, el("h2", {}, "Company tracker", el("span", { class: "count", text: String(MNCS.length) })), filt),
      ...groups,
      el("p", { class: "note", text: "Status checked 21 Nov 2026 from careers pages and job sites. Roles marked “Web listing (verify)” come from job sites, so confirm them on the company’s careers page. To keep this tab filling up, turn on job alerts on these careers sites with your Gmail address: “Check Gmail for new jobs” picks them up and files them here." }));
  }

  function allJobs() { return mergedJobs().filter(eligible); }
  function mergedJobs() {
    const live = store.get("live", []);
    const map = new Map();
    [...SEED.jobs, ...live, ...[...dbJobs.values()].map((j) => Object.assign({}, j, { live: !!j.found_at && Date.now() - Date.parse(j.found_at) < 7 * DAY_MS }))].forEach((j) => { if (j && j.title) map.set(key(j), Object.assign({}, map.get(key(j)) || {}, j)); });
    return [...map.values()];
  }

  /* ---------- sorting ---------- */
  const SORTS = {
    "salary-desc": (a, b) => (salaryOf(b) ?? -1) - (salaryOf(a) ?? -1),
    "salary-asc": (a, b) => (salaryOf(a) ?? Infinity) - (salaryOf(b) ?? Infinity),
    "deadline": (a, b) => (parseDate(a.deadline) || 8.64e15) - (parseDate(b.deadline) || 8.64e15),
    "newest": (a, b) => (parseDate(b.posted_or_email_date) || 0) - (parseDate(a.posted_or_email_date) || 0),
  };

  /* ---------- search, category chips, summary ---------- */
  const ui = { q: "", cat: store.get("cat", "all"), mncSt: store.get("mncSt", "all") };
  if (ui.cat !== "all" && !TECH.includes(ui.cat)) ui.cat = "all";
  function uiOk(j) {
    if (ui.cat !== "all" && j.category !== ui.cat) return false;
    if (!ui.q) return true;
    const hay = [j.title, j.company, j.location, j.category, j.experience_text, j.job_type].join(" ").toLowerCase();
    return ui.q.split(/\s+/).every((w) => hay.includes(w));
  }
  function renderCats() {
    const box = $("#cats");
    box.replaceChildren(...["all", ...TECH].map((c) => {
      const b = el("button", { type: "button", "aria-pressed": String(ui.cat === c), text: c === "all" ? "All" : c });
      b.addEventListener("click", () => { ui.cat = c; store.set("cat", c); render(); });
      return b;
    }));
  }
  function renderStats(every) {
    const open = every.filter((j) => { const m = markOf(j); return !m.deleted && !m.applied; });
    const soon = open.filter((j) => { const d = parseDate(j.deadline); return d && (d - today()) / DAY_MS <= 3; }).length;
    const fresh = open.filter((j) => j.live).length;
    const walk = walkinJobs().filter((j) => { const m = markOf(j); return !m.deleted && !m.applied; }).length;
    const applied = new Set([...every, ...walkinJobs()].filter((j) => markOf(j).applied && !markOf(j).deleted).map(key)).size;
    const item = (n, label, cls) => el("li", { class: cls || null }, el("b", { text: String(n) }), el("span", { text: label }));
    $("#stats").replaceChildren(
      item(open.length, "open roles"),
      item(fresh, "new this week", fresh ? "info" : ""),
      item(soon, "closing in 3 days", soon ? "warn" : ""),
      item(walk, "walk-in drives"),
      item(applied, "applied", applied ? "ok" : ""));
  }

  /* ---------- rendering ---------- */
  function currentTab() {
    const h = location.hash.replace("#", "");
    return TABS.some((t) => t.id === h) ? h : "kochi";
  }

  function row(j) {
    const s = salaryOf(j);
    const dl = parseDate(j.deadline);
    const days = dl ? Math.round((dl - today()) / DAY_MS) : null;
    const url = safeUrl(j.apply_url);
    const fresher = j.is_fresher === true
      ? el("span", { class: "tag ok", text: j.experience_text || "Fresher" })
      : el("span", { class: "tag unk", text: "Experience not stated" });
    const mk = markOf(j);
    const cb = el("input", { type: "checkbox", "aria-label": "Applied: " + j.title });
    cb.checked = !!mk.applied;
    cb.addEventListener("change", () => setMark(j, { applied: cb.checked }));
    const del = el("button", { type: "button", class: "x" + (mk.deleted ? " restore" : ""), "aria-label": (mk.deleted ? "Restore " : "Delete ") + j.title, text: mk.deleted ? "Restore" : "Delete" });
    del.addEventListener("click", () => setMark(j, { deleted: !mk.deleted }));
    return el("tr", { class: [mk.applied ? "applied" : "", mk.deleted ? "gone" : ""].join(" ").trim() || null },
      el("td", { class: "mark" }, el("label", {}, cb, el("span", { class: "lbl", text: "Applied" }))),
      el("td", { "data-label": "Role" },
        el("strong", { text: j.title }),
        el("div", { class: "tags" }, el("span", { class: "chip", text: j.category }), fresher, j.live ? el("span", { class: "tag new", text: "New" }) : null)),
      el("td", { "data-label": "Company" }, el("span", { text: j.company || "—" }), el("small", { text: j.location || "" })),
      el("td", { "data-label": "Salary", class: "num" },
        el("span", { text: j.salary_display || j.salary_text || "Not stated" }),
        s ? el("small", { text: "≈ ₹" + Math.round(s / 1000) + "k / month min" }) : null),
      el("td", { "data-label": "Type" }, el("span", { text: j.job_type || "—" })),
      el("td", { "data-label": "Apply by" },
        dl ? el("span", { class: "due" + (days <= 3 ? " soon" : ""), text: fmtDate(dl) }) : el("span", { class: "due open", text: "Open" }),
        el("small", { text: dl ? (days === 0 ? "Last day" : days + " day" + (days === 1 ? "" : "s") + " left") : "No deadline stated" })),
      el("td", { "data-label": "Source" }, el("span", { text: j.source || "—" }), el("small", { text: fmtDate(parseDate(j.posted_or_email_date)) })),
      el("td", { class: "act" }, url ? el("a", { class: "apply", href: url, target: "_blank", rel: "noopener noreferrer", text: "Apply" }) : el("span", { class: "muted", text: "See email" })),
      el("td", { class: "del" }, del)
    );
  }

  function table(jobs, caption) {
    const head = ["Applied", "Role", "Company", "Salary", "Type", "Apply by", "Source", "", "Delete"];
    return el("section", { class: "block" },
      el("h2", {}, caption, el("span", { class: "count", text: String(jobs.length) })),
      jobs.length
        ? el("div", { class: "scroll" }, el("table", {},
            el("colgroup", {}, ["c-apl", "c-role", "c-co", "c-sal", "c-type", "c-due", "c-src", "c-act", "c-del"].map((c) => el("col", { class: c }))),
            el("thead", {}, el("tr", {}, head.map((h) => el("th", { scope: "col", text: h })))),
            el("tbody", {}, jobs.map(row))))
        : el("p", { class: "empty", text: (ui.q || ui.cat !== "all") ? "No roles match this search or category." : "Nothing here yet. The next Gmail check may add some." })
    );
  }

  function render() {
    const tab = currentTab();
    const sort = $("#sort").value;
    const showDel = $("#show-deleted").checked, showApplied = $("#show-applied").checked;
    const every = allJobs();
    const deletedN = new Set([...every, ...walkinJobs()].filter((j) => markOf(j).deleted).map(key)).size;
    $("#del-count").textContent = deletedN ? "(" + deletedN + ")" : "";
    const appliedN = new Set([...every, ...walkinJobs()].filter((j) => markOf(j).applied && !markOf(j).deleted).map(key)).size;
    $("#app-count").textContent = appliedN ? "(" + appliedN + ")" : "";
    const jobs = every.filter((j) => { const m = markOf(j); return (showDel || !m.deleted) && (showApplied || !m.applied) && uiOk(j); });
    const byTab = Object.fromEntries(TABS.map((t) => [t.id, []]));
    jobs.forEach((j) => byTab[cityOf(j)].push(j));
    byTab.walkin = walkinJobs().filter((j) => { const m = markOf(j); return (showDel || !m.deleted) && (showApplied || !m.applied) && uiOk(j); });
    const markOk = (j) => { const m = markOf(j); return (showDel || !m.deleted) && (showApplied || !m.applied) && uiOk(j); };
    byTab.mnc = mncJobs().filter(markOk);
    byTab.germany = germanyJobs().filter(markOk);
    renderStats(every);
    renderCats();

    const nav = $("#tabs");
    nav.replaceChildren(...TABS.map((t) =>
      el("a", { href: "#" + t.id, class: t.id === tab ? "on" : null, "aria-current": t.id === tab ? "page" : null },
        t.label, el("b", { text: String(byTab[t.id].length) }))));
    const meta = TABS.find((t) => t.id === tab);
    $("#title").textContent = ["walkin", "elsewhere", "mnc", "germany"].includes(meta.id) ? meta.label : meta.label + " openings";
    $("#lede").textContent = meta.lede;

    const list = byTab[tab].slice().sort(SORTS[sort] || SORTS["salary-desc"]);
    const paid = list.filter((j) => salaryOf(j) != null);
    const unpaid = list.filter((j) => salaryOf(j) == null);
    if (sort === "salary-asc" || sort === "salary-desc") unpaid.sort(SORTS.deadline);
    if (tab === "walkin") { $("#list").replaceChildren(table(list, "Walk-in drives")); }
    else if (tab === "mnc") { $("#list").replaceChildren(trackerSection(byTab.mnc), table(list, "Fresher openings at these companies")); }
    else if (tab === "germany") {
      const note = el("p", { class: "callout" }, el("strong", { text: "How sponsorship works: " }),
        "most of these employers hire non-EU graduates on the EU Blue Card, which has a minimum salary. Check the current threshold and German-language needs on ",
        el("a", { href: "https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card", target: "_blank", rel: "noopener noreferrer", text: "Make it in Germany" }),
        " before you apply. Roles here come from Arbeitnow's visa-sponsorship list and your Gmail.");
      $("#list").replaceChildren(note, table(list, "Visa-sponsored roles in Germany"));
    }
    else $("#list").replaceChildren(
      table(paid, "Pay ₹3 LPA or more"),
      table(unpaid, "Salary not listed")
    );
    $("#stamp").textContent = SEED.built ? "Updated " + SEED.built : "";
  }

  /* ---------- live refresh (local only) ---------- */
  const settings = () => store.get("settings", { geminiKey: "", model: "gemini-flash-latest", clientId: "" });
  let gmailToken = null;

  function status(msg, kind) {
    const s = $("#live-status");
    s.textContent = msg;
    s.dataset.kind = kind || "";
  }

  async function gemini(prompt, useSearch) {
    const { geminiKey, model } = settings();
    if (!geminiKey) throw new Error("Add your Gemini API key first.");
    const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } };
    if (useSearch) body.tools = [{ google_search: {} }];
    else body.generationConfig.responseMimeType = "application/json";
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model || "gemini-flash-latest") + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || "Gemini returned " + res.status);
    const text = ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return parseJobs(text);
  }

  function parseJobs(text) {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { const arr = JSON.parse(m[0]); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
  }

  const SCHEMA = `Return ONLY a JSON array. Each item: {"title","company","location","city":"Kochi|Trivandrum|Bangalore|Remote|Other","experience_text","is_fresher":true|false|null,"salary_text","salary_min_monthly_inr":number|null (yearly÷12, USD×84),"salary_display":"short e.g. ₹4–6 LPA","job_type","deadline":"YYYY-MM-DD"|null,"posted_or_email_date":"YYYY-MM-DD"|null,"apply_url","source","category":"AI/ML|Web Dev|Software Dev|Mobile|Data|DevOps/Cloud|Other"}.`;

  async function searchWeb() {
    const d = new Date().toISOString().slice(0, 10);
    const prompt = `Today is ${d}. Use Google Search to find currently open FRESHER / entry-level (0–1 year, intern, trainee, graduate) jobs for: AI engineer, ML engineer, GenAI/LLM engineer, AI product development, data science, web developer, full-stack, software developer. Cover four areas equally: Kochi (Infopark, Kakkanad, SmartCity), Trivandrum (Technopark), Bangalore, and remote-India. Only include postings published in the last 21 days or with a deadline on/after today, each with a direct posting URL you actually found. Exclude conferences, courses, contests. Up to 30 items. ${SCHEMA}`;
    return gemini(prompt, true);
  }

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = resolve; s.onerror = () => reject(new Error("Could not load Google sign-in."));
      document.head.append(s);
    });
  }

  async function connectGmail(silent) {
    const { clientId } = settings();
    if (!clientId) throw new Error("Add your Google OAuth client ID in Settings first.");
    await loadGis();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        callback: (r) => {
          if (r.error) return reject(new Error("Gmail sign-in failed: " + r.error));
          gmailToken = { value: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
          store.set("gmailLinked", true);
          resolve();
        },
        error_callback: (e) => reject(new Error("Gmail sign-in closed" + (e && e.type ? " (" + e.type + ")" : ""))),
      });
      client.requestAccessToken({ prompt: silent ? "" : "consent" });
    });
  }

  async function gmailApi(path) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { headers: { Authorization: "Bearer " + gmailToken.value } });
    if (!r.ok) throw new Error("Gmail returned " + r.status);
    return r.json();
  }

  function decodePart(p) {
    const out = [];
    (function walk(x) {
      if (!x) return;
      if (x.body && x.body.data && /text\/(plain|html)/.test(x.mimeType || "")) {
        const b64 = x.body.data.replace(/-/g, "+").replace(/_/g, "/");
        let t = "";
        try { t = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch (e) { /* skip */ }
        if (/html/.test(x.mimeType)) t = t.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<a [^>]*href="([^"]+)"[^>]*>/gi, " [$1] ").replace(/<[^>]+>/g, " ");
        out.push(t);
      }
      (x.parts || []).forEach(walk);
    })(p);
    return out.join("\n").replace(/&nbsp;|&#\d+;|&\w+;/g, " ").replace(/https?:\/\/\S{180,}/g, "[long link]").replace(/\s+/g, " ").slice(0, 7000);
  }

  async function searchGmail() {
    if (!gmailToken || gmailToken.exp < Date.now()) await connectGmail(true);
    const q = encodeURIComponent("newer_than:3d (from:indeed.com OR from:wellfound.com OR from:naukri.com OR from:linkedin.com OR from:internshala.com OR from:instahyre.com OR hiring OR \"job opening\" OR walk-in)");
    const list = await gmailApi("messages?maxResults=15&q=" + q);
    const texts = [];
    for (const m of list.messages || []) {
      const full = await gmailApi("messages/" + m.id + "?format=full");
      const subj = (full.payload.headers || []).find((h) => h.name === "Subject")?.value || "";
      const date = new Date(Number(full.internalDate)).toISOString().slice(0, 10);
      texts.push(`--- EMAIL (${date}) ${subj}\n${decodePart(full.payload)}`);
    }
    if (!texts.length) return [];
    const prompt = `Extract every individual job posting from these job-alert emails. Use the email date as posted_or_email_date when none is given and source = the job site name. Ignore ads, courses, contests and conferences. ${SCHEMA}\n\n${texts.join("\n\n")}`;
    return gemini(prompt, false);
  }

  async function refresh(manual) {
    if (!CAN_LIVE) return;
    const s = settings();
    if (!s.geminiKey) { if (manual) status("Add your Gemini API key in Settings to refresh.", "warn"); return; }
    const btn = $("#refresh");
    btn.disabled = true;
    status("Searching the web…");
    const found = [];
    const notes = [];
    try { found.push(...(await searchWeb()).map((j) => Object.assign(j, { source: j.source || "Web" }))); }
    catch (e) { notes.push("Web search: " + e.message); }
    if (s.clientId && store.get("gmailLinked", false)) {
      status("Reading Gmail job alerts…");
      try { found.push(...(await searchGmail())); }
      catch (e) { notes.push("Gmail: " + e.message); }
    }
    const now = new Date().toISOString();
    const fresh = found.filter((j) => j && j.title && safeUrl(j.apply_url)).map((j) => Object.assign(j, { live: true, fetched_at: now }));
    const kept = store.get("live", []).filter((j) => Date.now() - new Date(j.fetched_at) < 21 * DAY_MS).map((j) => Object.assign(j, { live: false }));
    const merged = new Map([...kept, ...fresh].map((j) => [key(j), j]));
    store.set("live", [...merged.values()]);
    store.set("lastRefresh", now);
    btn.disabled = false;
    status(`Found ${fresh.length} jobs.` + (notes.length ? " " + notes.join(" · ") : ""), notes.length ? "warn" : "ok");
    render();
  }

  function initLive() {
    const panel = $("#live");
    if (!CAN_LIVE) {
      panel.hidden = true;
      return;
    }
    const s = settings();
    $("#gemini-key").value = s.geminiKey;
    $("#gemini-model").value = s.model || "gemini-flash-latest";
    $("#client-id").value = s.clientId;
    $("#gmail-state").textContent = store.get("gmailLinked", false) ? "Gmail connected" : "Gmail not connected";
    $("#settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      store.set("settings", { geminiKey: $("#gemini-key").value.trim(), model: $("#gemini-model").value.trim() || "gemini-flash-latest", clientId: $("#client-id").value.trim() });
      status("Settings saved on this browser.", "ok");
    });
    $("#connect-gmail").addEventListener("click", async () => {
      try { await connectGmail(false); $("#gmail-state").textContent = "Gmail connected"; status("Gmail connected (read-only).", "ok"); }
      catch (e) { status(e.message, "warn"); }
    });
    $("#refresh").addEventListener("click", () => refresh(true));
    $("#clear-live").addEventListener("click", () => { store.set("live", []); store.set("lastRefresh", null); status("Cleared jobs found by refresh.", "ok"); render(); });
    const due = () => { const last = store.get("lastRefresh", null); return !last || Date.now() - new Date(last) > DAY_MS; };
    if (due()) refresh(false);
    setInterval(() => { if (due() && document.visibilityState === "visible") refresh(false); }, 60 * 60 * 1000);
  }

  /* ---------- Gmail check (inside claude.ai: Gmail connector + Claude) ---------- */
  const GMAIL = "Gmail";
  const dbJobs = new Map();
  let meta = { lastRun: null, lastChecked: null, processed: [] };
  let metaLoaded = false, running = false, autoTried = false;
  const gm = { mcp: null, sample: null, perms: null, ready: false };
  const SEED_THREADS = new Set(SEED.jobs.flatMap((j) => String(j.source_thread_id || "").split(",")).map((x) => x.trim()).filter(Boolean)
    .concat(["1a1fa44c5c13bf6b", "1a1f50e0851c25e7", "1a1f045fbe35604a", "1a1f21d734a3a0e4", "1a1f742ac5799792", "1a1f80f814b5f269", "1a1f3d0c2a524ae0"]));
  const SENDERS = "from:jobalert.indeed.com OR from:match.indeed.com OR from:wellfound.com OR from:internshala.com OR from:unstop.news OR from:jobs2web.com OR from:naukri.com OR from:linkedin.com OR from:careerbrew@substack.com OR from:foundit.in OR from:infopark.in OR from:technopark.org OR from:tcs.com OR from:infosys.com OR from:wipro.com OR from:hcltech.com OR from:techmahindra.com OR from:cognizant.com OR from:accenture.com OR from:capgemini.com OR from:ibm.com OR from:ltimindtree.com OR from:ust.com OR from:ey.com OR from:ibsplc.com OR from:tataelxsi.com OR from:arbeitnow.com OR from:relocate.me OR subject:(\"visa sponsorship\" OR relocation) OR subject:(walk-in OR \"walk in\" OR hiring OR internship OR vacancy OR openings OR \"job alert\")";
  const MNC_SENDERS = MNCS.map((m) => "from:" + m.dom).join(" OR ");
  const autoDays = () => { const v = Number(store.get("autoEvery", 2)); return isFinite(v) ? v : 2; };
  const isDue = () => { const d = autoDays(); return d > 0 && (!meta.lastRun || Date.now() - Date.parse(meta.lastRun) > d * DAY_MS); };
  function syncStatus(msg, kind) { const n = $("#sync-status"); n.textContent = msg || ""; n.dataset.kind = kind || ""; }
  function ago(iso) {
    const ms = Date.now() - Date.parse(iso); if (!isFinite(ms)) return "";
    const m = Math.round(ms / 60000); if (m < 2) return "just now"; if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); if (h < 24) return h + " h ago"; const d = Math.round(h / 24); return d + (d === 1 ? " day ago" : " days ago");
  }
  function paintSync() {
    const btn = $("#check-now"), dot = $("#sync-dot");
    const last = meta.lastChecked || meta.lastRun;
    $("#sync-when").textContent = running ? "Checking Gmail…" : last ? "Last checked " + ago(last) : "Not checked from this page yet";
    dot.className = "dot" + (running ? " run" : !gm.mcp ? " off" : isDue() ? " due" : "");
    btn.disabled = running || !gm.ready;
    btn.setAttribute("aria-busy", String(running));
    btn.lastElementChild.textContent = running ? "Checking…" : "Check Gmail for new jobs";
    if (gm.ready && !gm.mcp && !running) syncStatus("Gmail checks need this page open in claude.ai with the Gmail connector on.", "warn");
  }
  function cleanBody(t) {
    return String(t || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/[^\s"')]*indeed\.com[^\s"')]*?[?&]jk=([0-9a-f]+)[^\s"')]*/gi, "https://in.indeed.com/viewjob?jk=$1")
      .replace(/https?:\/\/\S{220,}/g, "[link]")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  }
  function extractPrompt(text) {
    const d = new Date().toISOString().slice(0, 10);
    return `Today is ${d}. The reader is a fresher (0–1 year experience) in India looking for AI/ML, web, software, mobile, data and cloud jobs, mainly in Kerala, Bangalore, Chennai / Tamil Nadu or remote.
Below is one email from their inbox. List every distinct job or internship posting it contains that is located in India, is remote and open to people in India, or is in Germany with visa sponsorship or relocation support. Skip jobs located in any other country. Ignore ads, courses, contests, webinars, newsletters' non-job text and application receipts. For walk-in interviews or hiring drives set job_type to "walk-in" and deadline to the walk-in date. Use only facts stated in the email and null where it says nothing. apply_url must be a link copied exactly from the email for that job, or null. salary_min_monthly_inr: monthly minimum in rupees (yearly ÷ 12, USD × 84), or null.
${SCHEMA}
Also give each item "country" (e.g. "India", "Germany") and "visa_sponsorship": true | false | null (true only when the email says the employer sponsors a visa or supports relocation).
Reply with [] if the email lists no jobs.

EMAIL:
${text}`;
  }
  const CAT_OK = new Set([...TECH, "Other"]);
  const KERALA_RE = /kochi|cochin|ernakulam|kakkanad|infopark|aluva|kalamassery|palarivattom|edappally|kerala/i;
  function normalize(r, threadId, threadUrl) {
    if (!r || typeof r !== "object") return null;
    const str = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    const title = str(r.title), company = str(r.company);
    if (!title || !company) return null;
    const num = Number(r.salary_min_monthly_inr);
    const j = {
      title, company, location: str(r.location), city: str(r.city), experience_text: str(r.experience_text),
      is_fresher: r.is_fresher === true ? true : r.is_fresher === false ? false : undefined,
      salary_text: str(r.salary_text), salary_display: str(r.salary_display),
      salary_min_monthly_inr: isFinite(num) && num > 0 ? Math.round(num) : undefined,
      job_type: str(r.job_type), deadline: /^\d{4}-\d{2}-\d{2}$/.test(r.deadline || "") ? r.deadline : undefined,
      posted_or_email_date: /^\d{4}-\d{2}-\d{2}$/.test(r.posted_or_email_date || "") ? r.posted_or_email_date : new Date().toISOString().slice(0, 10),
      apply_url: safeUrl(r.apply_url) || safeUrl(threadUrl) || undefined,
      source: str(r.source) || "Gmail", source_thread_id: threadId,
      category: CAT_OK.has(r.category) ? r.category : "Other", found_at: new Date().toISOString(),
      country: str(r.country), visa_sponsorship: r.visa_sponsorship === true ? true : undefined,
    };
    j.is_kochi = KERALA_RE.test((j.city || "") + " " + (j.location || ""));
    if (!inIndia(j) && !(j.visa_sponsorship && GERMANY_RE.test((j.location || "") + " " + (j.country || "")))) return null;
    Object.keys(j).forEach((k) => j[k] === undefined && delete j[k]);
    return j;
  }
  function knownKey(k) {
    if (SEED.jobs.some((j) => key(j) === k)) return true;
    for (const v of dbJobs.values()) if (key(v) === k) return true;
    return false;
  }
  async function addJob(j) {
    const k = key(j), id = markId(k);
    if (knownKey(k) || (marks.get(id) || {}).deleted) return false;
    dbJobs.set(id, j);
    await marksDb.collection("jobs").doc(id).set(j);
    return true;
  }
  async function saveMeta(processed, finished) {
    const now = new Date().toISOString();
    const next = { lastChecked: now, lastRun: finished ? now : (meta.lastRun || null), processed: [...new Set([...(meta.processed || []), ...processed])].slice(-800) };
    meta = next;
    await marksDb.doc("meta/refresh").set(next);
  }
  const fmtQ = (d) => d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
  function errText(e) {
    const c = e && e.code;
    if (c === "not_granted" || c === "consent_required") return "Gmail or Claude access wasn't allowed. Allow both from the page's permissions to check.";
    if (c === "server_not_connected" || c === "server_not_found" || c === "needs_reauth") return "Connect Gmail in claude.ai settings → Connectors, then try again.";
    if (c === "rate_limited") return "Usage limit reached for now. Try again later.";
    return "The check stopped: " + ((e && e.message) || c || "unknown error") + ". Try again.";
  }
  async function runCheck(manual) {
    if (running || !gm.mcp || !gm.sample || !marksDb) {
      if (manual && !marksDb) syncStatus("Storage isn't ready yet. Try again in a moment.", "warn");
      return;
    }
    running = true; paintSync();
    try {
      const since = meta.lastRun ? new Date(Date.parse(meta.lastRun) - DAY_MS) : new Date(Date.now() - 5 * DAY_MS);
      const query = `after:${fmtQ(since)} -from:me (${SENDERS} OR ${MNC_SENDERS}) -subject:(designer OR graphic OR interior OR "video editor")`;
      syncStatus("Searching Gmail for job alerts…");
      const res = await gm.mcp.callTool(GMAIL, "search_threads", { query, pageSize: 30, view: "THREAD_VIEW_SUMMARY" }, { cache: false });
      const threads = ((res && res.payload && res.payload.threads) || []).filter((t) => t && t.id);
      const done = new Set([...SEED_THREADS, ...(meta.processed || [])]);
      const todo = threads.filter((t) => !done.has(t.id));
      const batch = todo.slice(0, 8);
      if (!batch.length) { await saveMeta([], true); syncStatus("No new job emails since the last check.", "ok"); return; }
      let added = 0;
      for (let i = 0; i < batch.length; i++) {
        const t = batch[i];
        const subj = ((t.messages || [])[0] || {}).subject || "";
        syncStatus(`Reading email ${i + 1} of ${batch.length}${subj ? ": " + subj.slice(0, 60) : ""}`);
        const th = await gm.mcp.callTool(GMAIL, "get_thread", { threadId: t.id, messageFormat: "PLAIN_TEXT" }, { cache: false });
        const p = (th && th.payload) || {};
        const text = (p.messages || []).map((m) => `Subject: ${m.subject || ""}\nFrom: ${m.sender || ""}\nDate: ${m.date || ""}\n\n${cleanBody(m.plaintextBody || m.snippet || "")}`).join("\n\n---\n\n").slice(0, 18000);
        let found = [];
        try { found = await gm.sample.json(extractPrompt(text), { modelTier: "default" }); }
        catch (e) { if (e && (e.code === "rate_limited" || e.code === "not_granted")) throw e; found = []; }
        for (const r of Array.isArray(found) ? found : []) { const j = normalize(r, t.id, p.viewUrl); if (j && await addJob(j)) added++; }
        await saveMeta([t.id], false);
        render();
      }
      const more = todo.length - batch.length;
      await saveMeta([], more === 0);
      syncStatus((added ? `Added ${added} new job${added === 1 ? "" : "s"} from ${batch.length} email${batch.length === 1 ? "" : "s"}.` : `Read ${batch.length} email${batch.length === 1 ? "" : "s"}. Nothing new that fits.`) + (more ? ` ${more} more waiting: check again.` : ""), "ok");
    } catch (e) {
      syncStatus(errText(e), "warn");
    } finally {
      running = false; paintSync(); render();
    }
  }
  async function maybeAuto() {
    if (autoTried || running || !gm.ready || !gm.mcp || !gm.sample || !metaLoaded || !isDue()) return;
    if (gm.perms) {
      try {
        const st = await gm.perms.state();
        if (st && Object.values(st).some((v) => v === "prompt" || v === "denied")) { syncStatus("A check is due. Press the button to run it.", ""); return; }
      } catch (e) { return; }
    } else return;
    autoTried = true;
    runCheck(false);
  }
  async function initGmail() {
    if (!IN_ARTIFACT) { $("#sync").hidden = true; return; }
    const use = (n) => Promise.resolve(window.claude.use(n)).catch(() => null);
    const [m, s, p] = await Promise.all([use("mcp"), use("sample"), use("permissions")]);
    Object.assign(gm, { mcp: m, sample: s, perms: p, ready: true });
    paintSync();
    maybeAuto();
    setInterval(() => { if (document.visibilityState === "visible") { autoTried = false; paintSync(); maybeAuto(); } }, 60 * 60 * 1000);
  }

  /* ---------- refresh card (workflow link + source status) and marks backup ---------- */
  function initRefreshCard() {
    const host = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0];
    const pages = /\.github\.io$/.test(host);
    const owner = pages ? host.split(".")[0] : "TAKIGOKUL";
    const repo = pages && seg ? seg : "personal-job-finder-radar";
    $("#gh-run").href = `https://github.com/${owner}/${repo}/actions/workflows/refresh.yml`;
    const at = SEED.built_at ? Date.parse(SEED.built_at) : NaN;
    const hrs = isNaN(at) ? null : (Date.now() - at) / 36e5;
    const ago = hrs == null ? "" : hrs < 1 ? "less than an hour ago" : hrs < 48 ? Math.round(hrs) + " hours ago" : Math.round(hrs / 24) + " days ago";
    $("#gh-when").textContent = hrs == null ? "No data yet" : "Last refreshed " + ago;
    $("#gh-dot").className = "dot" + (hrs == null || hrs > 36 ? " due" : "");
    if (hrs != null && hrs > 36) syncStatus("The daily refresh looks late. Open the workflow page to check it.", "warn");
    const src = SEED.sources || {};
    $("#gh-sources").replaceChildren(...Object.entries(src).map(([name, s]) => {
      const txt = s.ok === true ? `${s.found} found · ${s.new} new` : s.ok === null ? (s.note || "off") : "failed";
      return el("li", { class: s.ok === true ? (s.found ? "ok" : "bad") : s.ok === null ? "" : "bad", title: s.error || "" }, el("span", { text: name }), el("b", { text: txt }));
    }));
    $("#marks-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(Object.fromEntries(marks), null, 1)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "job-radar-marks.json" });
      document.body.append(a); a.click(); a.remove();
      syncStatus(`Exported ${marks.size} marks. Import this file on your other devices.`, "ok");
    });
    $("#marks-import").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const inc = data && data.marks ? data.marks : data;
        let n = 0;
        for (const [id, m] of Object.entries(inc || {})) { if (m && (m.applied || m.deleted)) { marks.set(id, Object.assign({}, marks.get(id) || {}, m)); n++; } }
        store.set("marks", Object.fromEntries(marks));
        syncStatus(`Imported ${n} marks.`, "ok");
        render();
      } catch (err) { syncStatus("That file isn't a marks export.", "warn"); }
      e.target.value = "";
    });
  }

  /* ---------- boot ---------- */
  const sortSel = $("#sort");
  sortSel.value = store.get("sort", "salary-desc");
  sortSel.addEventListener("change", () => { store.set("sort", sortSel.value); render(); });
  window.addEventListener("hashchange", render);
  ["show-deleted", "show-applied"].forEach((id) => { const c = $("#" + id); c.checked = store.get("pref2." + id, false); c.addEventListener("change", () => { store.set("pref2." + id, c.checked); render(); }); });
  const qIn = $("#q");
  let qT = 0;
  qIn.addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(() => { ui.q = qIn.value.trim().toLowerCase(); render(); }, 120); });
  initMarks();
  initRefreshCard();
  render();
})();
