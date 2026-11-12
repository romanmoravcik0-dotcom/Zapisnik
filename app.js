"use strict";
/* Zápisník zostatku — offline. Everything lives in this phone:
   IndexedDB is the store, localStorage a second copy, a file the backup. */

/* ---------- formatting ---------- */
const NF = new Intl.NumberFormat("sk-SK", {maximumFractionDigits:0});
const eur = v => NF.format(Math.round(v)) + " €";
const signed = v => (v > 0 ? "+" : v < 0 ? "−" : "") + NF.format(Math.abs(Math.round(v))) + " €";
const MON = ["január","február","marec","apríl","máj","jún","júl","august","september","október","november","december"];
const monLabel = p => /^\d{4}-\d{2}$/.test(p) ? MON[+p.slice(5)-1] + " " + p.slice(0,4) : p;
const yearOf = p => +String(p).slice(0,4);
const $ = id => document.getElementById(id);

/* ---------- categories: built from the words actually used in the notes ---------- */
const CATS = [
  ["Bývanie",      /byvanie|najom|najm|energie|elektrina|\bplyn\b|kuchyn|nabytok|matrac|kavovar|domace potreby|mycka|chladnic|pracka/],
  ["Cestovanie",   /letenk|ubytovan|hotel|penzion|dovolenka|zajazd|parkovan|batozin|lounge|suvenir|vylet|pobyt|chata|zazitk|cestovn|letisk|\bvlak\b|autobus|taxi|depozit|zaloha auto|pozicanie auta|zaloha palivo/],
  ["Auto",         /nafta|benzin|tanko|\bolej\b|filtr|pneu|gumy|\bpzp\b|\bstk\b|\bek\b|vstrek|turbo|brzd|tlmic|ramen|lozisk|napravnic|diely|servis|prepis|\begr\b|\bdpf\b|klapk|zamk|snimac|bateri|lambda|poistka|dialnicn|prezut|kaucia|cerpadlo|xenon|aditivum|suciastk|stierac|spojk|vyfuk|karoser|umyvar/],
  ["Darčeky",      /darcek|darcky|darceky|narodenin|menin|\bnar\b|vianoc|kvety|oslava|silvester|svadba|krstiny/],
  ["Zdravie",      /zubar|dentaln|lekar|masaz|fitko|\bgym\b|protein|doplnk|\bliek\b|lekaren|zdravotna|poistovn|optika|okuliar/],
  ["Dane, odvody", /\bdan\b|danov|socialna|odvod|poplatk|pokuta|\bucet\b|domena|predplatn|banka/],
  ["Oblečenie",    /oblecen|topank|tenisk|rifle|mikin|tricka|nohavic|kosel|bunda|kabat|slapk|parfum|\bvona\b|taska|kufor|opasok|ciapk|ponozk/],
  ["Elektronika",  /telefon|mobil|notebook|pocitac|tablet|nabijack|slucha|televiz|\btv\b|strojcek|holiaci|monitor|klavesnic|elektronik/],
  ["Jedlo",        /jedlo|obed|vecer|ranajk|sushi|pizza|potravin|restaur|\bkava\b|bufet|donas|strava/],
];
const deacc = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();

/* Which word marks the monthly pay-in. It is a setting, not a built-in: the
   word belongs to whoever uses the app and is kept on their own device. */
const DEFAULT_PAY_WORDS = ["vyplata", "mzda"];
let payWords = DEFAULT_PAY_WORDS.slice();
const payRe = () => new RegExp(payWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|") || "\\u0000");
const isPayout = e => e.a >= 600 && payRe().test(deacc(e.n));
function category(e){
  if (e.fix) return "Dorovnanie";
  const d = deacc(e.n);
  if (e.a > 0 && payRe().test(d)) return "Výplata";
  for (const [name, rx] of CATS) if (rx.test(d)) return name;
  return e.a > 0 ? "Iný príjem" : "Ostatné";
}

/* ---------- the parser: one line, the way the notes are written ---------- */
const INCOMEISH = /vyplat|mzda|prijem|vratenie|vratene|\burok\b|stravne|sporenie|zaloh|depozit|preplatok|bonus|vklad/;
const looksLikeIncome = d => INCOMEISH.test(d) || payRe().test(d);
function parseLine(text){
  const src = String(text).replace(/−/g,"-").replace(/ /g," ");
  const re = /([+\-])?\s*(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(€|e\b)?/gi;
  const hits = [];
  let m;
  while ((m = re.exec(src))){
    const v = parseFloat(m[2].replace(/[ .](?=\d{3}\b)/g,"").replace(",","."));
    if (!isFinite(v) || v === 0) continue;
    // A bare number with neither sign nor € counts only as the first amount,
    // so "A6", "C7" or a year inside a note is never read as money.
    if (!m[1] && !m[3] && hits.length) continue;
    hits.push({sign:m[1]||null, v, s:m.index, e:m.index+m[0].length});
  }
  if (!hits.length) return [];
  const out = [];
  let last = null;
  for (let i=0;i<hits.length;i++){
    const h = hits[i];
    const to = i+1 < hits.length ? hits[i+1].s : src.length;
    const note = src.slice(h.e, to).replace(/\s+/g," ").trim().replace(/^[.,/\\-]+|[.,/\\-]+$/g,"");
    let sign;
    if (h.sign) sign = h.sign === "+" ? 1 : -1;
    else if (last !== null) sign = last;
    else sign = looksLikeIncome(deacc(note)) ? 1 : -1;
    last = sign;
    out.push({a: sign * Math.round(h.v), n: note || (sign>0 ? "príjem" : "výdavky")});
  }
  return out;
}

/* ---------- storage: IndexedDB first, localStorage as a second copy ---------- */
const LSKEY = "zapisnik.v1";
let idb = null;
function openIdb(){
  return new Promise(res => {
    let req;
    try { req = indexedDB.open("zapisnik", 1); } catch (e) { return res(null); }
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
    setTimeout(() => res(null), 4000);
  });
}
function idbGet(key){
  return new Promise(res => {
    if (!idb) return res(null);
    try {
      const r = idb.transaction("kv","readonly").objectStore("kv").get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function idbSet(key, val){
  return new Promise(res => {
    if (!idb) return res(false);
    try {
      const tx = idb.transaction("kv","readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => res(true);
      tx.onerror = tx.onabort = () => res(false);
    } catch (e) { res(false); }
  });
}
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LSKEY) || "null"); } catch (e) { return null; } };
const lsSet = v => { try { localStorage.setItem(LSKEY, JSON.stringify(v)); return true; } catch (e) { return false; } };

/* ---------- state ---------- */
let START = 0;
let entries = [];                 // [{i,a,n,m,fix?}] ordered by i
let running = new Map();
let periods = [];
let lastBackup = 0, storagePersisted = null, storageOk = true;
let budgets = {};
let written = {};                   // period -> his own month total from the notes: {ex, all}
const IMPORT_V = 4;                 // bump when reading the notes changes
let importV = 0;                  // period -> budget, as written under each payout
const pad2 = n => String(n).padStart(2,"0");
function todayISO(){ const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate()); }
function dayLabel(iso){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return "";
  const [y,m,d] = iso.split("-");
  return +d + ". " + +m + "." + (+y === new Date().getFullYear() ? "" : " " + y.slice(2));
}
let shown = 60, openEditor = null, tab = "ledger";

/* Housing is what the notes mark with the house sign — kept apart so that
   "minuté" reads like the first number in "(13.10.26 - 980€)1180€🏠". */
const isHousing = e => e.a < 0 && (/\u{1F3E0}/u.test(e.n) || /byvanie|najom/.test(deacc(e.n)));
function rebuild(){
  entries.sort((a,b)=>a.i-b.i);
  running = new Map();
  let b = START;
  for (const e of entries){ b += e.a; running.set(e.i, b); }
  const seen = new Map();
  let afterPayout = false;
  for (const e of entries){
    if (!seen.has(e.m)) seen.set(e.m, {p:e.m, payout:0, adj:0, otherIn:0, out:0, housing:0, entries:[], payDate:null});
    const P = seen.get(e.m);
    P.entries.push(e);
    if (isPayout(e)){ P.payout += e.a; if (!P.payDate && e.d) P.payDate = e.d; }
    // a slip written right at the payout line belongs to the payout, not to spending —
    // the notes count spending from the balance on the line after the payout
    else if (e.fix && afterPayout) P.adj += e.a;
    else if (e.a > 0) P.otherIn += e.a;
    else { P.out += -e.a; if (isHousing(e)) P.housing += -e.a; }
    afterPayout = isPayout(e);
  }
  periods = [...seen.values()];
  for (const P of periods){
    P.net = P.payout + P.adj + P.otherIn - P.out;
    P.burn = P.out - P.otherIn;          // with housing:    "…)1180€🏠"
    P.burnEx = P.burn - P.housing;       // without housing: "(13.10.26 - 980€)"
    const w = written[P.p];              // the number he wrote himself, when there is one
    if (w){
      P.written = true;
      if (w.all != null){ P.burnEx = w.ex; P.burn = w.all; }
      else { P.burn = w.ex; P.burnEx = w.ex - P.housing; }
    }
    P.end = running.get(P.entries[P.entries.length-1].i);
    P.start = P.end - P.net;             // the balance on the payout line itself
  }
}
const fullDay = iso => { const [y,m,d] = String(iso).split("-"); return +d + ". " + +m + ". " + y; };
/* A period is named after the payout that opens it: its date when the notes
   have one, else its month. */
const payLabel = P => P.payDate ? fullDay(P.payDate) : monLabel(P.p);
const isDated = P => /^\d{4}-\d{2}$/.test(P.p);
/* The budget written under a payout holds until a later payout sets another. */
function budgetFor(P){
  for (let k = periods.indexOf(P); k >= 0; k--){
    const v = budgets[periods[k].p];
    if (typeof v === "number") return v;
  }
  return 0;
}
const balance = () => entries.length ? running.get(entries[entries.length-1].i) : START;
const byYear = y => entries.filter(e => yearOf(e.m) === y);
const allYears = () => [...new Set(entries.map(e => yearOf(e.m)))].sort((a,b)=>a-b);

function ymNow(){ const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0"); }
function nextPeriodFor(items){
  const lp = entries.length ? entries[entries.length-1].m : null;
  if (!items.some(isPayout)) return lp || ymNow();
  let cand = ymNow();
  if (lp && /^\d{4}-\d{2}$/.test(lp) && cand <= lp){
    const t = yearOf(lp)*12 + (+lp.slice(5)-1) + 1;
    cand = String(Math.floor(t/12)).padStart(4,"0") + "-" + String(t%12+1).padStart(2,"0");
  }
  return cand;
}

async function persist(){
  const doc = {v:1, start:START, entries, lastBackup, payWords, budgets, written, importV};
  const a = await idbSet("ledger", doc);
  const b = lsSet(doc);
  const ok = a || b;
  if (ok !== storageOk){ storageOk = ok; render(); }
  if (!ok) toast("Pozor: zmenu sa nepodarilo uložiť do telefónu. Ulož si zálohu.");
  return ok;
}
async function load(){
  idb = await openIdb();
  let doc = await idbGet("ledger");
  if (!doc || !Array.isArray(doc.entries) || !doc.entries.length){
    const ls = lsGet();
    if (ls && Array.isArray(ls.entries) && (!doc || ls.entries.length > (doc.entries||[]).length)) doc = ls;
  }
  if (doc && Array.isArray(doc.entries)){
    START = typeof doc.start === "number" ? doc.start : 0;
    entries = doc.entries;
    lastBackup = doc.lastBackup || 0;
    if (Array.isArray(doc.payWords) && doc.payWords.length) payWords = doc.payWords;
    importV = typeof doc.importV === "number" ? doc.importV : 0;
    written = doc.written && typeof doc.written === "object" ? doc.written : {};
    budgets = doc.budgets && typeof doc.budgets === "object" ? doc.budgets : {};
    if (typeof doc.budget === "number" && doc.budget > 0 && !Object.keys(budgets).length) legacyBudget = doc.budget;
  }
  rebuild();
  if (legacyBudget && periods.length){ budgets[periods[periods.length-1].p] = legacyBudget; legacyBudget = 0; }
}
let legacyBudget = 0;

/* ---------- mutations ---------- */
async function addItems(items){
  const m = nextPeriodFor(items);
  let i = entries.length ? entries[entries.length-1].i : 0;
  const d = todayISO();
  for (const it of items) entries.push({i: ++i, a: it.a, n: it.n, m, d});
  rebuild(); render();
  await persist();
}
async function editEntry(entry, amount, note, date){
  const e = entries.find(x => x.i === entry.i);
  if (!e) return;
  e.a = amount; e.n = note;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) e.d = date; else if (!date) delete e.d;
  rebuild(); render(); await persist();
}
async function deleteEntry(entry){
  entries = entries.filter(e => e.i !== entry.i);
  rebuild(); render(); await persist();
}

let toastT = null;
function toast(msg){
  document.querySelectorAll(".toast").forEach(n => n.remove());
  const d = document.createElement("div");
  d.className = "toast"; d.setAttribute("role","status"); d.textContent = msg;
  document.body.appendChild(d);
  clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 5000);
}

/* ---------- input ---------- */
const entryEl = $("entry"), pvEl = $("pv"), addBtn = $("addbtn");
function renderPreview(){
  const items = parseLine(entryEl.value);
  addBtn.disabled = !items.length;
  pvEl.innerHTML = "";
  if (!entryEl.value.trim()) return;
  if (!items.length){ pvEl.innerHTML = '<span class="pv-err">Napíš sumu, napríklad <b>-100 nafta</b>.</span>'; return; }
  let b = balance();
  for (const it of items){
    b += it.a;
    const s = document.createElement("span");
    s.className = "pv-item";
    s.style.color = it.a > 0 ? "var(--pos)" : "var(--neg)";
    s.textContent = signed(it.a) + "  " + it.n;
    pvEl.appendChild(s);
  }
  const a = document.createElement("span");
  a.className = "pv-after num"; a.textContent = "→ " + eur(b);
  pvEl.appendChild(a);
}
entryEl.addEventListener("input", renderPreview);
$("f").addEventListener("submit", ev => {
  ev.preventDefault();
  const items = parseLine(entryEl.value);
  if (!items.length) return;
  entryEl.value = ""; renderPreview();
  addItems(items);
});

/* ---------- header ---------- */
function renderHeader(){
  $("bal").innerHTML = NF.format(Math.round(balance())) + '<small>€</small>';
  const cy = new Date().getFullYear();
  const ye = byYear(cy);
  const ynet = ye.reduce((s,e)=>s+e.a, 0);
  const yEl = $("ytd");
  yEl.textContent = ye.length ? signed(ynet) : "—";
  yEl.style.color = ynet > 0 ? "var(--pos)" : ynet < 0 ? "var(--neg)" : "var(--muted)";
  const P = periods[periods.length-1];
  renderBudget(P);
  if (!P){ $("pnote").textContent = "Zatiaľ žiadne položky."; return; }
  const bits = [];
  if (P.payout) bits.push("Od výplaty <b>" + payLabel(P) + "</b> (" + eur(P.payout) + ")");
  else bits.push("Obdobie <b>" + monLabel(P.p) + "</b>");
  if (!budgetFor(P)) bits.push("minuté <b>" + eur(Math.max(0, P.burnEx)) + "</b>");
  bits.push("s bývaním <b>" + eur(Math.max(0, P.burn)) + "</b>");
  $("pnote").innerHTML = bits.join(" · ");
}

function renderBudget(P){
  const box = $("budget");
  const budget = P ? budgetFor(P) : 0;
  $("bud-set").hidden = !P || !!budget;
  if (!budget || !P){ box.hidden = true; return; }
  box.hidden = false;
  const spent = Math.max(0, P.burnEx), left = budget - spent;
  const pct = Math.max(0, Math.min(100, spent / budget * 100));
  $("bud-left").innerHTML = left >= 0
    ? "Zostáva <b>" + eur(left) + "</b>"
    : '<b style="color:var(--neg)">Prekročené o ' + eur(-left) + "</b>";
  $("bud-of").textContent = "minuté " + eur(spent) + " z " + eur(budget);
  $("bud-of").className = "bud-of";
  const fill = $("bud-fill");
  fill.style.width = pct.toFixed(1) + "%";
  fill.className = "bud-fill" + (left < 0 ? " over" : pct >= 80 ? " warn" : "");
}

/* ---------- ledger ---------- */
function rowEl(e){
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row" + (e.fix ? " fix" : "") + (isPayout(e) ? " pay" : "");
  btn.innerHTML =
    '<span class="row-bal">' + NF.format(Math.round(running.get(e.i) - e.a)) + '</span>' +
    '<span class="row-note"></span>' +
    '<span class="row-amt ' + (e.a>0?"p":"n") + '">' + signed(e.a) + '</span>';
  const note = btn.querySelector(".row-note");
  note.textContent = e.n;
  const c = document.createElement("span");
  c.className = "row-cat";
  c.textContent = (e.d ? dayLabel(e.d) + " · " : "") + category(e);
  note.appendChild(c);
  btn.addEventListener("click", () => { openEditor = openEditor === e.i ? null : e.i; render(); });
  return btn;
}
function editorEl(e){
  const d = document.createElement("div");
  d.className = "editor";
  const amt = document.createElement("input");
  amt.className = "amt num"; amt.type = "text"; amt.inputMode = "numeric"; amt.value = String(e.a);
  amt.setAttribute("aria-label","Suma");
  const note = document.createElement("input");
  note.className = "note"; note.type = "text"; note.value = e.n;
  note.setAttribute("aria-label","Popis");
  const date = document.createElement("input");
  date.className = "note"; date.type = "date"; date.value = e.d || "";
  date.style.flex = "0 0 auto"; date.style.minWidth = "9.5em";
  date.setAttribute("aria-label","Dátum");
  const ok = document.createElement("button");
  ok.className = "btn-sm primary"; ok.type = "button"; ok.textContent = "Uložiť";
  ok.addEventListener("click", () => {
    const v = Math.round(parseFloat(String(amt.value).replace(",",".").replace(/\s/g,"")));
    if (!isFinite(v) || v === 0){ toast("Suma musí byť číslo, kladné alebo záporné."); return; }
    openEditor = null; editEntry(e, v, note.value.trim() || e.n, date.value);
  });
  const del = document.createElement("button");
  del.className = "btn-sm danger"; del.type = "button"; del.textContent = "Zmazať";
  del.addEventListener("click", () => { openEditor = null; deleteEntry(e); });
  const cancel = document.createElement("button");
  cancel.className = "btn-sm"; cancel.type = "button"; cancel.textContent = "Zruš";
  cancel.addEventListener("click", () => { openEditor = null; render(); });
  d.append(amt, note, date, ok, del, cancel);
  return d;
}
function renderLedger(){
  const host = $("ld-list");
  $("ld-empty").hidden = entries.length > 0;
  { const o = $("old-import"); if (o) o.remove(); }
  if (importV < IMPORT_V && entries.some(e => e.fix)){
    const w = document.createElement("div");
    w.className = "warn";
    w.innerHTML = "Históriu si vložil staršou verziou appky, ktorá z poznámok počítala niektoré sumy zle. " +
      "Choď do <b>Dáta</b> a vlož poznámky znova — potom budú zostatky aj minuté sedieť.";
    $("ld-list").before(w);
    w.id = "old-import";
  }
  host.innerHTML = "";
  if (!entries.length) return;
  const visible = entries.filter(e => !e.fix);    // balancing rows stay in the sums, not on screen
  const list = visible.slice(-shown).reverse();
  let box = null, curP = null;
  for (const e of list){
    if (e.m !== curP){
      curP = e.m;
      const P = periods.find(x => x.p === curP);
      const dv = document.createElement("div");
      dv.className = "divider";
      dv.innerHTML = '<span class="dv-t"></span><span class="dv-l"></span><span class="dv-m"></span>';
      dv.querySelector(".dv-t").textContent = P.payout ? "Od výplaty " + payLabel(P) : (isDated(P) ? monLabel(curP) : curP);
      dv.querySelector(".dv-m").textContent =
        (P.payout ? "+" + eur(P.payout) + " · " : "") + "minuté " + eur(Math.max(0, P.burnEx));
      host.appendChild(dv);
      box = document.createElement("div"); box.className = "rows";
      host.appendChild(box);
    }
    box.appendChild(rowEl(e));
    if (openEditor === e.i) box.appendChild(editorEl(e));
  }
  if (visible.length > shown){
    const b = document.createElement("button");
    b.className = "more"; b.type = "button";
    b.textContent = "Zobraziť starších " + Math.min(120, visible.length - shown) + " položiek";
    b.addEventListener("click", () => { shown += 120; render(); });
    host.appendChild(b);
  }
}

/* ---------- periods ---------- */
function renderPeriods(){
  const host = $("v-periods");
  if (!periods.length){ host.innerHTML = '<div class="empty"><p>Obdobia sa vytvoria samé, keď zapíšeš výplatu.</p></div>'; return; }
  // Read the way the notes are written: at each payout, what the month cost
  // without and with housing — "(13.10.26 - 980€)1180€🏠" — against the budget
  // set under the previous payout, then what came in.
  const td = (v, cls) => '<td' + (cls ? ' class="' + cls + '"' : "") + ">" + v + "</td>";
  const money = v => v >= 0 ? eur(v) : "+" + eur(-v);
  const spentCells = P => {
    if (!P) return td("—") + td("—") + td("—");
    const b = budgetFor(P);
    const over = b && P.burnEx > b;
    return td(money(P.burnEx), b ? (over ? "n" : "p") : (P.burnEx < 0 ? "p" : "")) +
           td(money(P.burn)) +
           td(b ? eur(b) : "—");
  };
  const rows = [];
  const last = periods[periods.length-1];
  rows.push("<tr><td>Teraz</td>" + spentCells(last) + td("—") + td(eur(balance())) + "</tr>");
  for (let k = periods.length-1; k >= 0; k--){
    const P = periods[k], prev = periods[k-1];
    if (P.payout){
      rows.push("<tr>" + td(payLabel(P)) + spentCells(prev) + td("+" + eur(P.payout), "p") + td(eur(P.start)) + "</tr>");
    } else {
      rows.push("<tr>" + td(isDated(P) ? monLabel(P.p) : P.p + " (bez mesiacov)") +
        td("—") + td("—") + td("—") + td("—") + td(eur(P.start)) + "</tr>");
    }
  }
  const done = periods.filter((P, k) => P.payout && k+1 < periods.length);   // closed windows only
  const avg = f => done.length ? done.reduce((s,P)=>s+f(P),0)/done.length : 0;
  const avgPay = avg(P=>P.payout), avgEx = avg(P=>P.burnEx), avgAll = avg(P=>P.burn);
  const withB = done.filter(P => budgetFor(P));
  const kept = withB.filter(P => P.burnEx <= budgetFor(P)).length;
  host.innerHTML =
    '<div class="card"><h2>Priemer na jedno výplatné obdobie</h2>' +
    '<p class="sub">Z ' + done.length + ' uzavretých období medzi dvoma výplatami.</p>' +
    '<div class="kpis">' +
      '<div class="kpi"><span class="lbl">Výplata</span><span class="v num">' + eur(avgPay) + '</span></div>' +
      '<div class="kpi"><span class="lbl">Minuté</span><span class="v num">' + eur(avgEx) + '</span>' +
        '<span class="d">s bývaním ' + eur(avgAll) + '</span></div>' +
      '<div class="kpi"><span class="lbl">Ostáva</span><span class="v num" style="color:' +
        (avgPay-avgAll>0?"var(--pos)":"var(--neg)") + '">' + signed(avgPay-avgAll) + '</span></div>' +
      (withB.length ? '<div class="kpi"><span class="lbl">Rozpočet</span><span class="v num">' + kept + " z " + withB.length +
        '</span><span class="d">období v rozpočte</span></div>' : "") +
    '</div></div>' +
    '<div class="tscroll"><table><caption>Ako v poznámkach: pri každej výplate koľko si za mesiac minul ' +
    '(bez bývania a s bývaním), aký bol rozpočet, koľko prišlo a zostatok tesne pred výplatou. ' +
    'Kde máš v poznámkach vlastný súčet v zátvorke, je tu presne ten.</caption>' +
    "<thead><tr><th>Výplata</th><th>Minuté</th><th>S bývaním</th><th>Rozpočet</th><th>Prišlo</th><th>Zostatok</th></tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table></div>";
}

/* ---------- years ---------- */
function yearStats(y){
  const es = byYear(y);
  let tmr = 0, inc = 0, out = 0;
  for (const e of es){
    if (e.a > 0 && payRe().test(deacc(e.n))) tmr += e.a;
    if (e.a > 0) inc += e.a; else out += -e.a;
  }
  return {y, n:es.length, tmr, inc, out, net: inc-out, entries: es};
}
const periodsOf = y => periods.filter(P => yearOf(P.p) === y && /^\d{4}-\d{2}$/.test(P.p));

function renderYears(){
  const host = $("v-years");
  const ys = allYears();
  if (!ys.length){ host.innerHTML = '<div class="empty"><p>Ročné súčty sa objavia, keď budeš mať prvé položky.</p></div>'; return; }
  const cur = ys[ys.length-1], prev = ys.length>1 ? ys[ys.length-2] : cur;
  const selA = ys.includes(+host.dataset.a) ? +host.dataset.a : cur;
  const selB = ys.includes(+host.dataset.b) ? +host.dataset.b : prev;

  let cmp = "";
  const pa = periodsOf(selA), pb = periodsOf(selB);
  if (pa.length && pb.length && selA !== selB){
    const n = Math.min(pa.length, pb.length);
    const sum = (ps, f) => ps.slice(0, n).reduce((s,P)=>s+f(P), 0);
    const kpi = (lbl, a, b, good) => {
      const d = a - b, up = good ? d > 0 : d < 0;
      return '<div class="kpi"><span class="lbl">' + lbl + '</span><span class="v num">' + eur(a) +
        '</span><span class="d" style="color:' + (d===0?"var(--muted)":up?"var(--pos)":"var(--neg)") + '">' +
        signed(d) + " oproti " + selB + "</span></div>";
    };
    cmp = '<div class="card"><h2>' + selA + " oproti " + selB + "</h2>" +
      '<p class="sub">Za prvých ' + n + " výplatných období roka. Posledné obdobie roka " + selA + " ešte nemusí byť dokončené.</p>" +
      '<div class="kpis">' +
      kpi("Usporené", sum(pa,P=>P.net), sum(pb,P=>P.net), true) +
      kpi("Výplaty", sum(pa,P=>P.payout), sum(pb,P=>P.payout), true) +
      kpi("Výdavky", sum(pa,P=>P.out), sum(pb,P=>P.out), false) + "</div></div>";
  }

  let chart = "";
  if (pa.length || pb.length){
    const get = (ps, m) => { const P = ps.find(x => +x.p.slice(5) === m); return P ? P.payout : 0; };
    const months = [...Array(12).keys()].map(i=>i+1).filter(m => get(pa,m) || get(pb,m));
    const max = Math.max(...months.flatMap(m => [get(pa,m), get(pb,m)]), 1);
    const bar = (v, color, yr) => v
      ? '<div class="gbar"><span class="gfill" style="width:calc((100% - 7.6em) * ' + (v/max).toFixed(3) +
        ');background:' + color + '"></span><span class="gval">' + eur(v) +
        ' <span style="opacity:.65">' + yr + "</span></span></div>"
      : '<div class="gbar"><span class="gval" style="opacity:.5">bez výplaty ' + yr + "</span></div>";
    chart = '<div class="card"><h2>Výplaty po mesiacoch</h2>' +
      '<p class="sub">Suma pripísaná na začiatku každého obdobia.</p>' +
      '<div class="legend"><span><i class="sw" style="background:var(--s1)"></i>' + selA + "</span>" +
      '<span><i class="sw" style="background:var(--s2)"></i>' + selB + "</span></div>" +
      '<div class="gchart">' + months.map(m =>
        '<div class="grow"><span class="gmon num">' + m + '.</span><div class="gbars">' +
        bar(get(pa,m), "var(--s1)", selA) + bar(get(pb,m), "var(--s2)", selB) +
        "</div></div>").join("") + "</div></div>";
  }

  const sa = yearStats(selA);
  const byCat = new Map();
  for (const e of sa.entries) if (e.a < 0 && !e.fix){ const c = category(e); byCat.set(c, (byCat.get(c)||0) + -e.a); }
  const cats = [...byCat.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  const cmax = cats.length ? cats[0][1] : 1;
  const catHtml = cats.length ? '<div class="card"><h2>Na čo išli výdavky v roku ' + selA + "</h2>" +
    '<p class="sub">Zaradené podľa slov v popise.</p><div class="catbars">' +
    cats.map(([c,v]) => '<div class="catrow"><div class="catname">' + c +
      '<div class="cattrack"><div class="catfill" style="width:' + (v/cmax*100).toFixed(1) + '%"></div></div></div>' +
      '<div class="catval">' + eur(v) + "</div></div>").join("") + "</div></div>" : "";

  const rows = ys.slice().reverse().map(y => {
    const s = yearStats(y);
    return "<tr><td>" + y + "</td><td>" + (s.tmr ? eur(s.tmr) : "—") + "</td><td>" + eur(s.inc) +
      "</td><td>" + eur(s.out) + '</td><td class="' + (s.net>0?"p":s.net<0?"n":"") + '">' + signed(s.net) +
      "</td><td>" + s.n + "</td></tr>";
  }).join("");
  const opt = sel => ys.map(y => '<option value="' + y + '"' + (y===sel?" selected":"") + ">" + y + "</option>").join("");
  host.innerHTML =
    '<div class="sel"><label for="selA">Porovnať</label><select id="selA">' + opt(selA) + "</select>" +
    '<label for="selB">s rokom</label><select id="selB">' + opt(selB) + "</select></div>" +
    cmp + chart + catHtml +
    '<div class="tscroll"><table><caption>Rok sa počíta podľa mesiaca výplaty.</caption>' +
    "<thead><tr><th>Rok</th><th>Výplaty</th><th>Príjmy</th><th>Výdavky</th><th>Usporené</th><th>Položiek</th></tr></thead>" +
    "<tbody>" + rows + "</tbody></table></div>";
  $("selA").addEventListener("change", ev => { host.dataset.a = ev.target.value; renderYears(); });
  $("selB").addEventListener("change", ev => { host.dataset.b = ev.target.value; renderYears(); });
}

/* ---------- reading the notes as they are actually written ----------
   Each line opens with the balance before it, then the changes. Where a
   line's balance does not follow from the one above, something was spent
   and never written down: that gap becomes its own entry, so the running
   balance keeps matching the notes. */
function parseNotesLedger(text){
  const BAL = /^\s*(\d{1,2}[\s ]+\d{3}|\d{4,6}|\d{1,3})\s*€?/;
  const DATEG = /\(\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
  const rows = [];
  let header = null;
  for (const raw of String(text).replace(/−/g,"-").split("\n")){
    if (!raw.trim()) continue;
    // "— október 2026 —" headings, the ones this app writes when it exports
    const h = /^\s*[—–-]{1,2}\s*(.+?)\s*[—–-]{1,2}\s*$/.exec(raw);
    if (h){
      const t = deacc(h[1]).trim();
      const ym = /^([a-z]+)\s+(\d{4})$/.exec(t);
      if (ym){
        const mi = MON.findIndex(n => deacc(n) === ym[1]);
        if (mi >= 0){ header = ym[2] + "-" + String(mi+1).padStart(2,"0"); continue; }
      }
      if (/^\d{4}$/.test(t)){ header = t; continue; }
    }
    const m = BAL.exec(raw);
    if (!m) continue;
    const bal = parseInt(m[1].replace(/[\s ]/g,""), 10);
    const yearMark = /\((20\d\d)\)/.exec(raw);
    let rest = raw.slice(m[0].length);
    const dm = DATEG.exec(rest);
    let dt = null, dtFull = null;
    if (dm){
      let y = +dm[3]; if (y < 100) y += 2000;
      dt = y*12 + (+dm[2]) - 1;
      dtFull = y + "-" + pad2(+dm[2]) + "-" + pad2(+dm[1]);
    }
    // "(12.11.26)" on its own is this line's date, the way this app writes it;
    // "(13.10.26 - 980€)" is the note's own marker for the payout that follows.
    const dateOnly = /\(\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s*\)\s*$/.test(rest);
    const wm = /\(\s*\d{1,2}\.\d{1,2}\.\d{2,4}\.?\s*-?\s*(\d{1,2}\s?\d{3}|\d{1,4})\s*€\s*\)?\s*(?:(\d{1,2}\s?\d{3}|\d{1,4})\s*€\s*\u{1F3E0})?/u.exec(rest);
    const rowWritten = wm ? {ex: parseInt(wm[1].replace(/\s/g,""),10), all: wm[2] ? parseInt(wm[2].replace(/\s/g,""),10) : null} : null;
    const cut = rest.search(/\(\s*\d{1,2}\.\d{1,2}/);
    if (cut >= 0) rest = rest.slice(0, cut);
    const bm = /^\s*\(\s*(\d{1,2}\s?\d{3}|\d{1,4})\s*€\s*\)/.exec(rest);
    const rowBudget = bm ? parseInt(bm[1].replace(/\s/g,""), 10) : null;
    rest = rest.replace(/\([^)]*\)/g, " ").replace(/\([^)]*$/, " ");
    const AMT = /([+\-])?\s*(\d{1,2}\s?\d{3}|\d{1,4})\s*(€)?/g;
    const hits = [];
    let mm, last = -1;
    while ((mm = AMT.exec(rest))){
      if (!mm[1] && !mm[3]) continue;           // needs a sign or a € to be money
      const v = parseInt(mm[2].replace(/\s/g,""), 10);
      if (!v) continue;
      const sign = mm[1] === "+" ? 1 : (mm[1] ? -1 : last);
      last = sign;
      hits.push({a: sign*v, s: mm.index, e: mm.index + mm[0].length});
    }
    const items = hits.map((h, k) => ({
      a: h.a,
      n: rest.slice(h.e, k+1 < hits.length ? hits[k+1].s : rest.length)
             .replace(/\s+/g," ").trim().replace(/^[.,/\\-]+|[.,/\\-]+$/g,"") || "výdavky"
    }));
    rows.push({bal, items, dt, dtFull, dateOnly, header, budget: rowBudget, written: rowWritten, yearMark: yearMark ? +yearMark[1] : null});
  }
  if (rows.length < 2) return null;

  const flat = [];
  rows.forEach((r, ri) => r.items.forEach(it => flat.push({a: it.a, n: it.n, ri, d: r.dateOnly ? r.dtFull : null})));
  if (!flat.length) return null;

  // Months come from the payout dates noted in the text; the rest follow monthly.
  const payIdx = [];
  flat.forEach((e, i) => { if (isPayout(e)) payIdx.push(i); });
  // a date noted just before a payout is that payout's date
  for (const i of payIdx){
    if (flat[i].d) continue;
    const ri = flat[i].ri;
    for (let j = ri; j >= Math.max(0, ri-2); j--){
      if (rows[j].dtFull && !rows[j].dateOnly){ flat[i].d = rows[j].dtFull; break; }
    }
  }
  let baseK = null, baseM = null;
  for (let k = 0; k < payIdx.length && baseK === null; k++){
    const ri = flat[payIdx[k]].ri;
    for (let j = ri; j >= Math.max(0, ri-2); j--){
      if (rows[j].dt != null){ baseK = k; baseM = rows[j].dt; break; }
    }
  }
  if (baseK === null && payIdx.length){
    const d = new Date();
    baseK = payIdx.length - 1; baseM = d.getFullYear()*12 + d.getMonth();
  }
  const monOf = k => {
    const t = baseM + (k - baseK);
    return String(Math.floor(t/12)).padStart(4,"0") + "-" + String(t%12 + 1).padStart(2,"0");
  };
  const period = new Array(flat.length).fill(null);
  for (let k = 0; k < payIdx.length; k++){
    const end = k+1 < payIdx.length ? payIdx[k+1] : flat.length;
    const p = monOf(k);
    for (let j = payIdx[k]; j < end; j++) period[j] = p;
  }
  const preYear = payIdx.length ? String(+monOf(0).slice(0,4) - 1) : String(new Date().getFullYear());
  let mark = null;
  for (let j = 0; j < flat.length; j++){
    const r = rows[flat[j].ri];
    if (r.yearMark) mark = String(r.yearMark);
    if (r.header) period[j] = r.header;            // an exported heading is exact
    else if (!period[j]) period[j] = mark || preYear;
  }

  // Every line opens with the balance as it was written. Where that does not
  // follow from the line above, the gap happened before this line — so it is
  // booked into the period of the line above, even when this line is a payout.
  // That keeps each period's total equal to the difference the notes show.
  const budgetsOut = {}, writtenOut = {};
  {
    const firstOfRow = new Map();
    flat.forEach((e, j) => { if (!firstOfRow.has(e.ri)) firstOfRow.set(e.ri, j); });
    let lastP = null;
    rows.forEach((r, ri) => {
      if (firstOfRow.has(ri)) lastP = period[firstOfRow.get(ri)];
      if (r.budget != null && lastP) budgetsOut[lastP] = r.budget;
      if (r.written && lastP) writtenOut[lastP] = r.written;
    });
  }

  const out = [];
  let bal = rows[0].bal, seq = 0, lastRi = -1;
  for (let j = 0; j < flat.length; j++){
    const e = flat[j];
    if (e.ri !== lastRi){
      lastRi = e.ri;
      const diff = rows[e.ri].bal - bal;
      if (diff){
        const m = out.length ? out[out.length-1].m : period[j];
        out.push({i: ++seq, a: diff, m, fix: 1,
                  n: Math.abs(diff) >= 50 ? "nezapísané (dorovnanie zostatku)" : "zaokrúhlenie"});
        bal += diff;
      }
    }
    out.push({i: ++seq, a: e.a, n: e.n, m: period[j], ...(e.d ? {d: e.d} : {})});
    bal += e.a;
  }
  const lastRow = rows[rows.length-1];
  if (!lastRow.items.length){
    const endDiff = lastRow.bal - bal;
    if (endDiff){ out.push({i: ++seq, a: endDiff, n: "dorovnanie zostatku", m: out[out.length-1].m, fix: 1}); bal += endDiff; }
  }
  return {start: rows[0].bal, entries: out, end: bal,
          budgets: budgetsOut,
          written: writtenOut,
          bigIncome: flat.filter(e => e.a >= 600).map(e => deacc(e.n)),
          stats: {rows: rows.length, items: flat.length, fixes: out.filter(o=>o.fix).length,
                 fixesBig: out.filter(o=>o.fix && Math.abs(o.a) >= 50).length, payouts: payIdx.length}};
}

/* When the payout word is not set, find it in the notes themselves: the word
   that most often labels a large pay-in, plus its one-letter typos. */
function lev(a, b){
  const m = a.length, n = b.length, d = Array.from({length: m+1}, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
function detectPayWords(notes){
  const first = notes.map(n => (n.split(/[^a-z0-9]+/).filter(Boolean)[0] || "")).filter(w => w.length >= 2);
  const count = new Map();
  for (const w of first) count.set(w, (count.get(w) || 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3) return null;
  const top = ranked[0][0];
  const variants = [...count.keys()].filter(w => w !== top && lev(w, top) <= 1);
  return [top, ...variants];
}

/* ---------- data tab ---------- */
function download(filename, text, type){
  const blob = new Blob([text], {type: type + ";charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}
function asText(){
  const lines = ["Zápisník zostatku — začiatok " + NF.format(START) + " €"];
  let b = START, cur = null;
  for (const e of entries){
    if (e.m !== cur){ cur = e.m; lines.push("", "— " + monLabel(cur) + " —"); }
    lines.push(NF.format(Math.round(b)) + "€ " + (e.a>0?"+":"-") + NF.format(Math.abs(e.a)) + "€ " + e.n +
               (e.d ? " (" + (+e.d.slice(8,10)) + "." + (+e.d.slice(5,7)) + "." + e.d.slice(2,4) + ")" : ""));
    b += e.a;
  }
  lines.push("", NF.format(Math.round(b)) + "€");
  return lines.join("\n");
}
function stamp(){ const d = new Date(); return d.toISOString().slice(0,10); }
$("exp-json").addEventListener("click", async () => {
  download("zapisnik-" + stamp() + ".json", JSON.stringify({v:1, start:START, entries, payWords, budgets, written}, null, 0), "application/json");
  lastBackup = Date.now(); await persist(); render();
});
$("exp-txt").addEventListener("click", () => download("zapisnik-" + stamp() + ".txt", asText(), "text/plain"));

async function markBackedUp(){ lastBackup = Date.now(); await persist(); render(); }
async function copyLedger(){
  try {
    await navigator.clipboard.writeText(asText());
    await markBackedUp();
    toast("Skopírované. Otvor Poznámky, podrž prst a daj Prilepiť.");
    return true;
  } catch (e){ return false; }
}
$("exp-notes").addEventListener("click", async () => {
  const text = asText();
  if (navigator.share){
    try {
      await navigator.share({title: "Zápisník zostatku " + stamp(), text});
      await markBackedUp();
      toast("Odoslané. V Poznámkach to nájdeš ako novú poznámku.");
      return;
    } catch (err){
      if (err && err.name === "AbortError") return;     // user closed the sheet
    }
  }
  if (!(await copyLedger())) toast("Nepodarilo sa ani zdieľať, ani skopírovať. Použi radšej zálohu do súboru.");
});
$("exp-copy").addEventListener("click", async () => {
  if (!(await copyLedger())) toast("Kopírovanie sa nepodarilo. Použi radšej zálohu do súboru.");
});
$("imp-file").addEventListener("change", ev => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const d = JSON.parse(String(fr.result));
      if (!d || !Array.isArray(d.entries)) throw new Error("zlý tvar");
      const clean = d.entries
        .filter(e => e && typeof e.a === "number" && e.a !== 0)
        .map((e, k) => ({i: typeof e.i === "number" ? e.i : k+1,
                         a: Math.round(e.a),
                         n: String(e.n || "položka").slice(0,120),
                         m: /^\d{4}(-\d{2})?$/.test(String(e.m)) ? String(e.m) : ymNow(),
                         ...(/^\d{4}-\d{2}-\d{2}$/.test(String(e.d)) ? {d: String(e.d)} : {}),
                         ...(e.fix ? {fix:1} : {})}));
      if (!clean.length) throw new Error("prázdne");
      START = typeof d.start === "number" ? d.start : 0;
      if (Array.isArray(d.payWords) && d.payWords.length) payWords = d.payWords;
      budgets = d.budgets && typeof d.budgets === "object" ? d.budgets : {};
      written = d.written && typeof d.written === "object" ? d.written : {};
      entries = clean; shown = 60; openEditor = null;
      rebuild(); await persist(); render();
      toast("Načítaných " + clean.length + " položiek. Zostatok " + eur(balance()) + ".");
    } catch (err){ toast("Súbor sa nepodarilo prečítať — čakám zálohu .json z tejto appky."); }
    ev.target.value = "";
  };
  fr.onerror = () => toast("Súbor sa nepodarilo otvoriť.");
  fr.readAsText(file);
});
let notesDraft = null;
$("notes-check").addEventListener("click", () => {
  notesDraft = parseNotesLedger($("notes").value);
  const apply = $("notes-apply");
  if (!notesDraft){
    apply.hidden = true;
    $("notes-info").textContent = "Nenašiel som zápisník — čakám riadky, ktoré začínajú zostatkom, napríklad „1 250€ - 20€ obed“.";
    return;
  }
  let detected = null;
  if (notesDraft.stats.payouts < 3){
    const words = detectPayWords(notesDraft.bigIncome);
    if (words){
      const before = payWords;
      payWords = words;
      const retry = parseNotesLedger($("notes").value);
      if (retry && retry.stats.payouts >= 3){ notesDraft = retry; detected = words; }
      else payWords = before;
    }
  }
  const s = notesDraft.stats;
  apply.hidden = false;
  if (detected) $("paywords").value = detected.join(", ");
  $("notes-info").textContent =
    (detected ? "Výplatu som spoznal podľa slova „" + detected[0] + "“" +
       (detected.length > 1 ? " (aj „" + detected.slice(1).join("“, „") + "“)" : "") + ". " : "") +
    "Našiel som " + s.items + " položiek v " + s.rows + " riadkoch, z toho " + s.payouts + " výplat. " +
    "Začiatok " + eur(notesDraft.start) + ", koniec " + eur(notesDraft.end) + ". " +
    (Object.keys(notesDraft.budgets).length ? "Rozpočtov pod výplatami: " + Object.keys(notesDraft.budgets).length + ". " : "") +
    (Object.keys(notesDraft.written).length ? "Tvojich mesačných súčtov zo zátvoriek: " + Object.keys(notesDraft.written).length + ". " : "") +
    (s.payouts === 0 ? "Pozor: bez výplat appka nerozdelí históriu na mesiace, len na roky. Nastav vyššie slovo pre výplatu a skontroluj znova. " : "") +
    "Sedí ti koncový zostatok?";
});
$("notes-apply").addEventListener("click", async () => {
  if (!notesDraft) return;
  START = notesDraft.start;
  entries = notesDraft.entries;
  budgets = notesDraft.budgets || {};
  written = notesDraft.written || {};
  importV = IMPORT_V;
  shown = 60; openEditor = null;
  rebuild(); await persist(); render();
  $("notes").value = ""; $("notes-apply").hidden = true;
  $("notes-info").textContent = "";
  notesDraft = null;
  toast("Zápisník načítaný. Zostatok " + eur(balance()) + ".");
});
$("bulk-add").addEventListener("click", async () => {
  const lines = $("bulk").value.split("\n").map(s => s.trim()).filter(Boolean);
  let items = [];
  for (const l of lines) items = items.concat(parseLine(l));
  if (!items.length){ $("bulk-info").textContent = "Nenašiel som žiadnu sumu."; return; }
  await addItems(items);
  $("bulk").value = "";
  $("bulk-info").textContent = "Pridaných " + items.length + " položiek.";
  toast("Pridaných " + items.length + " položiek.");
});
function goToBudget(){
  $("t-data").click();
  setTimeout(() => { const f = $("budgetval"); f.focus(); f.select(); }, 60);
}
$("bud-set").addEventListener("click", goToBudget);
$("budget").addEventListener("click", goToBudget);
$("budget").addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); goToBudget(); } });
$("budgetsave").addEventListener("click", async () => {
  const raw = String($("budgetval").value).replace(",",".").replace(/\s/g,"").trim();
  const v = raw === "" ? 0 : Math.round(parseFloat(raw));
  if (!isFinite(v) || v < 0){ toast("Zadaj číslo, alebo nechaj prázdne pre vypnutie."); return; }
  const P = periods[periods.length-1];
  if (!P){ toast("Najprv zapíš aspoň jednu položku."); return; }
  budgets[P.p] = v; await persist(); render();
  toast(v ? "Rozpočet od výplaty " + payLabel(P) + " je " + eur(v) + "." : "Rozpočet pre toto obdobie vypnutý.");
});
$("paysave").addEventListener("click", async () => {
  const words = String($("paywords").value).split(",").map(w => deacc(w).trim()).filter(Boolean);
  if (!words.length){ toast("Napíš aspoň jedno slovo."); return; }
  payWords = words;
  rebuild(); await persist(); render();
  toast("Výplatu rozpoznám podľa: " + words.join(", ") + ".");
});
$("startsave").addEventListener("click", async () => {
  const v = Math.round(parseFloat(String($("startval").value).replace(",",".").replace(/\s/g,"")));
  if (!isFinite(v)){ toast("Zadaj číslo."); return; }
  START = v; rebuild(); await persist(); render();
  toast("Začiatočný zostatok je " + eur(v) + ".");
});
function renderData(){
  $("startval").value = String(START);
  $("paywords").value = payWords.join(", ");
  const curP = periods[periods.length-1];
  const curB = curP ? budgetFor(curP) : 0;
  $("budgetval").value = curB ? String(curB) : "";
  $("budget-for").textContent = curP && curP.payout ? "od výplaty " + payLabel(curP) : "pre toto obdobie";
  const days = lastBackup ? Math.floor((Date.now()-lastBackup)/86400000) : null;
  $("backup-when").textContent = lastBackup
    ? "Naposledy zálohované " + (days === 0 ? "dnes" : "pred " + days + " dňami") + "."
    : "Zatiaľ si nerobil zálohu.";
  const warn = $("backup-warn");
  warn.innerHTML = "";
  if (entries.length && (!lastBackup || Date.now()-lastBackup > 30*86400000)){
    const d = document.createElement("div");
    d.className = "warn";
    d.textContent = "Zápisník nemáš zálohovaný. Stačí jedno ťuknutie nižšie — súbor si ulož do Súborov alebo na iCloud.";
    warn.appendChild(d);
  }
  if (!storageOk){
    const d = document.createElement("div");
    d.className = "warn";
    d.textContent = "Telefón teraz odmieta ukladať dáta. Ulož si zálohu, kým appku nezavrieš.";
    warn.appendChild(d);
  }
  $("about").textContent =
    "Dáta sú len v tomto telefóne, nikam sa neposielajú. " +
    (storagePersisted === true ? "iPhone ich má označené ako trvalé. "
     : storagePersisted === false ? "iPhone ich zatiaľ nemá označené ako trvalé — zálohuj pravidelne. " : "") +
    "Appka funguje aj bez internetu.";
}

/* ---------- quick chips from his own most-used notes ---------- */
function renderQuick(){
  const host = $("quick");
  const freq = new Map();
  for (const e of entries.slice(-220)){
    if (e.fix) continue;
    const k = e.n.trim();
    if (!k || k.length > 18) continue;
    freq.set(k, (freq.get(k)||0) + 1);
  }
  const top = [...freq.entries()].filter(([,c])=>c>2).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k])=>k);
  host.innerHTML = "";
  for (const t of top){
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = t;
    b.addEventListener("click", () => {
      const v = entryEl.value.trim();
      entryEl.value = /\d/.test(v) ? v.replace(/\s*$/, " ") + t : (v ? v + " " + t : "- " + t);
      entryEl.focus(); renderPreview();
    });
    host.appendChild(b);
  }
}

/* ---------- render + tabs ---------- */
function render(){
  renderHeader();
  if (tab === "ledger") renderLedger();
  else if (tab === "periods") renderPeriods();
  else if (tab === "years") renderYears();
  else renderData();
  renderQuick();
  $("foot").textContent = entries.length
    ? entries.length + " položiek · od " + eur(START) + " po " + eur(balance())
    : "";
}
for (const id of ["ledger","periods","years","data"]){
  $("t-"+id).addEventListener("click", () => {
    tab = id;
    for (const o of ["ledger","periods","years","data"]){
      $("t-"+o).setAttribute("aria-selected", String(o===id));
      $("v-"+o).hidden = o !== id;
    }
    render();
    window.scrollTo(0, 0);
  });
}

/* ---------- boot ---------- */
(async () => {
  await load();
  render();
  renderPreview();
  try {
    if (navigator.storage && navigator.storage.persist){
      storagePersisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch (e) { storagePersisted = null; }
  if (tab === "data") renderData();
  if ("serviceWorker" in navigator){
    try { await navigator.serviceWorker.register("./sw.js"); } catch (e) {}
  }
})();
