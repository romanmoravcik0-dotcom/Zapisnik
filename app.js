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
let shown = 60, openEditor = null, tab = "ledger";

function rebuild(){
  entries.sort((a,b)=>a.i-b.i);
  running = new Map();
  let b = START;
  for (const e of entries){ b += e.a; running.set(e.i, b); }
  const seen = new Map();
  for (const e of entries){
    if (!seen.has(e.m)) seen.set(e.m, {p:e.m, payout:0, otherIn:0, out:0, entries:[]});
    const P = seen.get(e.m);
    P.entries.push(e);
    if (isPayout(e)) P.payout += e.a;
    else if (e.a > 0) P.otherIn += e.a;
    else P.out += -e.a;
  }
  periods = [...seen.values()];
  for (const P of periods){
    P.net = P.payout + P.otherIn - P.out;
    P.end = running.get(P.entries[P.entries.length-1].i);
    P.start = P.end - P.net;
  }
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
  const doc = {v:1, start:START, entries, lastBackup, payWords};
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
  }
  rebuild();
}

/* ---------- mutations ---------- */
async function addItems(items){
  const m = nextPeriodFor(items);
  let i = entries.length ? entries[entries.length-1].i : 0;
  for (const it of items) entries.push({i: ++i, a: it.a, n: it.n, m});
  rebuild(); render();
  await persist();
}
async function editEntry(entry, amount, note){
  const e = entries.find(x => x.i === entry.i);
  if (!e) return;
  e.a = amount; e.n = note;
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
  if (!P){ $("pnote").textContent = "Zatiaľ žiadne položky."; return; }
  const bits = ["Obdobie <b>" + monLabel(P.p) + "</b>"];
  if (P.payout) bits.push("výplata <b>" + eur(P.payout) + "</b>");
  bits.push("utratené <b>" + eur(P.out) + "</b>");
  $("pnote").innerHTML = bits.join(" · ");
}

/* ---------- ledger ---------- */
function rowEl(e){
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row" + (e.fix ? " fix" : "") + (isPayout(e) ? " pay" : "");
  btn.innerHTML =
    '<span class="row-bal">' + NF.format(Math.round(running.get(e.i))) + '</span>' +
    '<span class="row-note"></span>' +
    '<span class="row-amt ' + (e.a>0?"p":"n") + '">' + signed(e.a) + '</span>';
  const note = btn.querySelector(".row-note");
  note.textContent = e.n;
  const c = document.createElement("span");
  c.className = "row-cat"; c.textContent = category(e);
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
  const ok = document.createElement("button");
  ok.className = "btn-sm primary"; ok.type = "button"; ok.textContent = "Uložiť";
  ok.addEventListener("click", () => {
    const v = Math.round(parseFloat(String(amt.value).replace(",",".").replace(/\s/g,"")));
    if (!isFinite(v) || v === 0){ toast("Suma musí byť číslo, kladné alebo záporné."); return; }
    openEditor = null; editEntry(e, v, note.value.trim() || e.n);
  });
  const del = document.createElement("button");
  del.className = "btn-sm danger"; del.type = "button"; del.textContent = "Zmazať";
  del.addEventListener("click", () => { openEditor = null; deleteEntry(e); });
  const cancel = document.createElement("button");
  cancel.className = "btn-sm"; cancel.type = "button"; cancel.textContent = "Zruš";
  cancel.addEventListener("click", () => { openEditor = null; render(); });
  d.append(amt, note, ok, del, cancel);
  return d;
}
function renderLedger(){
  const host = $("ld-list");
  $("ld-empty").hidden = entries.length > 0;
  host.innerHTML = "";
  if (!entries.length) return;
  const list = entries.slice(-shown).reverse();
  let box = null, curP = null;
  for (const e of list){
    if (e.m !== curP){
      curP = e.m;
      const P = periods.find(x => x.p === curP);
      const dv = document.createElement("div");
      dv.className = "divider";
      dv.innerHTML = '<span class="dv-t"></span><span class="dv-l"></span><span class="dv-m"></span>';
      dv.querySelector(".dv-t").textContent = monLabel(curP);
      dv.querySelector(".dv-m").textContent =
        (P.payout ? "výplata " + eur(P.payout) + " · " : "") + "utratené " + eur(P.out);
      host.appendChild(dv);
      box = document.createElement("div"); box.className = "rows";
      host.appendChild(box);
    }
    box.appendChild(rowEl(e));
    if (openEditor === e.i) box.appendChild(editorEl(e));
  }
  if (entries.length > shown){
    const b = document.createElement("button");
    b.className = "more"; b.type = "button";
    b.textContent = "Zobraziť starších " + Math.min(120, entries.length - shown) + " položiek";
    b.addEventListener("click", () => { shown += 120; render(); });
    host.appendChild(b);
  }
}

/* ---------- periods ---------- */
function renderPeriods(){
  const host = $("v-periods");
  if (!periods.length){ host.innerHTML = '<div class="empty"><p>Obdobia sa vytvoria samé, keď zapíšeš výplatu.</p></div>'; return; }
  const rows = periods.slice().reverse().map(P => {
    const dated = /^\d{4}-\d{2}$/.test(P.p);
    return "<tr><td>" + (dated ? monLabel(P.p) : P.p + " (bez mesiacov)") + "</td>" +
      "<td>" + (P.payout ? eur(P.payout) : "—") + "</td>" +
      "<td>" + (P.otherIn ? eur(P.otherIn) : "—") + "</td>" +
      "<td>" + eur(P.out) + "</td>" +
      '<td class="' + (P.net>0?"p":P.net<0?"n":"") + '">' + signed(P.net) + "</td>" +
      "<td>" + eur(P.end) + "</td></tr>";
  }).join("");
  const done = periods.filter(P => P.payout);
  const avgOut = done.length ? done.reduce((s,P)=>s+P.out,0)/done.length : 0;
  const avgPay = done.length ? done.reduce((s,P)=>s+P.payout,0)/done.length : 0;
  host.innerHTML =
    '<div class="card"><h2>Priemer na jedno výplatné obdobie</h2>' +
    '<p class="sub">Z ' + done.length + ' období, v ktorých je zapísaná výplata.</p>' +
    '<div class="kpis">' +
      '<div class="kpi"><span class="lbl">Výplata</span><span class="v num">' + eur(avgPay) + '</span></div>' +
      '<div class="kpi"><span class="lbl">Výdavky</span><span class="v num">' + eur(avgOut) + '</span></div>' +
      '<div class="kpi"><span class="lbl">Ostáva</span><span class="v num" style="color:' +
        (avgPay-avgOut>0?"var(--pos)":"var(--neg)") + '">' + signed(avgPay-avgOut) + '</span></div>' +
    '</div></div>' +
    '<div class="tscroll"><table><caption>Obdobie je úsek od jednej výplaty po ďalšiu.</caption>' +
    "<thead><tr><th>Obdobie</th><th>Výplata</th><th>Iné príjmy</th><th>Výdavky</th><th>Čistá zmena</th><th>Zostatok</th></tr></thead>" +
    "<tbody>" + rows + "</tbody></table></div>";
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
    let dt = null;
    if (dm){ let y = +dm[3]; if (y < 100) y += 2000; dt = y*12 + (+dm[2]) - 1; }
    const cut = rest.search(/\(\s*\d{1,2}\.\d{1,2}/);
    if (cut >= 0) rest = rest.slice(0, cut);
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
    rows.push({bal, items, dt, header, yearMark: yearMark ? +yearMark[1] : null});
  }
  if (rows.length < 2) return null;

  const flat = [];
  rows.forEach((r, ri) => r.items.forEach(it => flat.push({a: it.a, n: it.n, ri})));
  if (!flat.length) return null;

  // Months come from the payout dates noted in the text; the rest follow monthly.
  const payIdx = [];
  flat.forEach((e, i) => { if (isPayout(e)) payIdx.push(i); });
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

  const out = [];
  let bal = rows[0].bal, seq = 0, lastRi = -1, pendingYear = null;
  const yr = p => +String(p).slice(0,4);
  for (let j = 0; j < flat.length; j++){
    const e = flat[j];
    if (e.ri !== lastRi){
      lastRi = e.ri;
      const diff = rows[e.ri].bal - bal;
      const y = yr(period[j]);
      let label = null;
      if (Math.abs(diff) >= 50) label = "nezapísané (dorovnanie zostatku)";
      else if (pendingYear !== null && y !== pendingYear && diff) label = "zaokrúhlenie za rok " + pendingYear;
      if (label){ out.push({i: ++seq, a: diff, n: label, m: period[j], fix: 1}); bal += diff; }
      pendingYear = y;
    }
    out.push({i: ++seq, a: e.a, n: e.n, m: period[j]});
    bal += e.a;
  }
  const lastRow = rows[rows.length-1];
  if (!lastRow.items.length){
    const endDiff = lastRow.bal - bal;
    if (endDiff){ out.push({i: ++seq, a: endDiff, n: "dorovnanie zostatku", m: out[out.length-1].m, fix: 1}); bal += endDiff; }
  }
  return {start: rows[0].bal, entries: out, end: bal,
          stats: {rows: rows.length, items: flat.length, fixes: out.filter(o=>o.fix).length, payouts: payIdx.length}};
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
    lines.push(NF.format(Math.round(b)) + "€ " + (e.a>0?"+":"-") + NF.format(Math.abs(e.a)) + "€ " + e.n);
    b += e.a;
  }
  lines.push("", NF.format(Math.round(b)) + "€");
  return lines.join("\n");
}
function stamp(){ const d = new Date(); return d.toISOString().slice(0,10); }
$("exp-json").addEventListener("click", async () => {
  download("zapisnik-" + stamp() + ".json", JSON.stringify({v:1, start:START, entries, payWords}, null, 0), "application/json");
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
                         ...(e.fix ? {fix:1} : {})}));
      if (!clean.length) throw new Error("prázdne");
      START = typeof d.start === "number" ? d.start : 0;
      if (Array.isArray(d.payWords) && d.payWords.length) payWords = d.payWords;
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
  const s = notesDraft.stats;
  apply.hidden = false;
  $("notes-info").textContent =
    "Našiel som " + s.items + " položiek v " + s.rows + " riadkoch, z toho " + s.payouts + " výplat. " +
    "Začiatok " + eur(notesDraft.start) + ", koniec " + eur(notesDraft.end) + ". " +
    (s.fixes ? s.fixes + " riadkov som musel dorovnať — tam zostatok v poznámkach nesedel s položkami. " : "") +
    "Sedí ti koncový zostatok?";
});
$("notes-apply").addEventListener("click", async () => {
  if (!notesDraft) return;
  START = notesDraft.start;
  entries = notesDraft.entries;
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
