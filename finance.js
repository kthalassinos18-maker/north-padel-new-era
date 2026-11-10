/* ============ FINANCE (dashboard: monthly income / expenses) ============
 * Monthly overview on the Dashboard: income = booking revenue (from /bookings),
 * expenses = manual entries (rackets, balls, maintenance...) kept in
 * /finance_entries (admin-only).
 * Reuses a few .am-* form/chip styles from americano.css.
 */
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const C_FIN = 'finance_entries';
const COL_IN = '#3aa58a';   // income  (validated pair on #0f2540)
const COL_OUT = '#e0703a';  // expense
const MONTHS = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος','Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
const MONTHS_S = ['Ιαν','Φεβ','Μαρ','Απρ','Μάι','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];
const CATS = {
  expense: [
    ['rackets', '🎾 Ρακέτες'], ['balls', '🟡 Μπαλάκια'], ['maintenance', '🔧 Συντήρηση'],
    ['utilities', '💡 Ρεύμα / Νερό'], ['rent', '🏠 Ενοίκιο'], ['staff', '👷 Προσωπικό'],
    ['marketing', '📣 Διαφήμιση'], ['taxes', '🧾 Φόροι / Λογιστής'], ['bar', '🍺 Κυλικείο / Αναλώσιμα'],
    ['other', '✨ Άλλο'],
  ],
};
const catLabel = (kind, c) => ((CATS[kind] || []).find(x => x[0] === c) || [c, c || '—'])[1];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad = (n) => String(n).padStart(2, '0');
function localToday(){ const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const thisMonth = () => localToday().slice(0, 7);
function shiftMonth(m, k){ const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
const monthName = (m) => MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
const monthShort = (m) => MONTHS_S[+m.slice(5, 7) - 1];
function eur(n){
  n = Math.round((+n || 0) * 100) / 100;
  return n.toLocaleString('el-GR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + '€';
}
function fd(s){ if (!s) return ''; const p = s.split('-'); return p[2] + '/' + p[1]; }
function parseAmount(s){ const n = parseFloat(String(s || '').replace(/\s/g, '').replace('€', '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; }
const db = () => window.npFB.db;

/* ---------- state ---------- */
const F = { month: thisMonth(), entries: [], loaded: false, loading: false, error: null, bookings: [], edit: null };

async function load(){
  if (F.loaded || F.loading || !window.npFB) return;
  F.loading = true;
  try {
    const snap = await getDocs(query(collection(db(), C_FIN), orderBy('date', 'desc')));
    F.entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    F.loaded = true; F.error = null;
  } catch(e){
    F.error = e.code === 'permission-denied'
      ? 'Δεν υπάρχει άδεια για τα έξοδα — πρέπει να ενημερωθούν τα Firestore Rules.'
      : e.message;
  }
  F.loading = false;
  paint();
}

/* ---------- numbers ---------- */
// `upto` (YYYY-MM-DD, optional) cuts the month at that day — used to compare a
// month that is still running with the same days of the previous month.
function monthData(m, upto){
  const inM = (d) => (d || '').startsWith(m) && (!upto || d <= upto);
  const bk = F.bookings.filter(b => b.status !== 'cancelled' && inM(b.date));
  const sum = (arr) => arr.reduce((s, b) => s + (+b.total || 0), 0);
  // Income comes only from court bookings; entries are expenses.
  const ent = F.entries.filter(e => e.kind !== 'income' && inM(e.date));
  const exp = ent;
  const byCat = (arr) => {
    const o = {}; arr.forEach(e => { o[e.category] = (o[e.category] || 0) + (+e.amount || 0); });
    return Object.entries(o).sort((a, b) => b[1] - a[1]);
  };
  const bookingRev = sum(bk);
  const expenses = exp.reduce((s, e) => s + (+e.amount || 0), 0);
  return {
    count: bk.length,
    four: bk.filter(b => +b.players === 4).length,
    two: bk.filter(b => +b.players === 2).length,
    court1: bk.filter(b => b.court === 'Γήπεδο 1').length,
    court2: bk.filter(b => b.court === 'Γήπεδο 2').length,
    rackets: bk.reduce((s, b) => s + (+b.rackets || 0), 0),
    balls: bk.filter(b => b.premiumBalls).length,
    bookingRev,
    cash: sum(bk.filter(b => b.payMethod === 'cash')),
    card: sum(bk.filter(b => b.payMethod === 'card')),
    pending: sum(bk.filter(b => !b.payMethod || b.payMethod === 'pending')),
    expenses, expByCat: byCat(exp),
    income: bookingRev,
    net: bookingRev - expenses,
    entries: ent,
  };
}
function delta(cur, prev, goodUp, label){
  if (!prev && !cur) return '<div class="stat-delta" style="color:rgba(244,249,255,0.4)">—</div>';
  const d = cur - prev;
  const up = d >= 0, good = goodUp ? up : !up;
  const pct = prev ? ' (' + (up ? '+' : '−') + Math.abs(Math.round(d / Math.abs(prev) * 100)) + '%)' : '';
  return `<div class="stat-delta${d === 0 ? '' : good ? '' : ' neg'}">${up ? '▲ +' : '▼ −'}${eur(Math.abs(d))}${pct} από ${label}</div>`;
}

/* ---------- render ---------- */
function paint(){
  const r = $('finRoot'); if (!r) return;
  const m = F.month, D = monthData(m);
  const isNow = m === thisMonth();
  // Running month: compare 1..today with the same days of last month.
  const pm = shiftMonth(m, -1);
  const C = isNow ? monthData(m, localToday()) : D;
  const P = isNow ? monthData(pm, pm + '-' + localToday().slice(8, 10)) : monthData(pm);
  const vs = (isNow ? 'ίδιες μέρες ' : '') + monthShort(pm);
  const head = `<div class="fin-head">
      <h3 class="fin-title">💰 ΟΙΚΟΝΟΜΙΚΑ</h3>
      <div class="fin-nav">
        <button class="btn" data-fin="prev" aria-label="Προηγούμενος μήνας">‹</button>
        <span class="fin-month">${esc(monthName(m))}</span>
        <button class="btn" data-fin="next" aria-label="Επόμενος μήνας" ${isNow ? 'disabled' : ''}>›</button>
        ${isNow ? '' : '<button class="btn" data-fin="now">Σήμερα</button>'}
      </div>
      <div class="fin-add">
        <button class="btn" data-fin="add">+ ΝΕΟ ΕΞΟΔΟ</button>
      </div>
    </div>`;
  const err = F.error ? `<div class="notice" style="margin-bottom:14px"><strong>Έξοδα:</strong> ${esc(F.error)}</div>` : '';
  const kpis = `<div class="stat-grid fin-kpis">
      <div class="stat"><div class="stat-label">ΕΣΟΔΑ</div><div class="stat-value">${eur(D.income)}</div>${delta(C.income, P.income, true, vs)}</div>
      <div class="stat"><div class="stat-label">ΕΞΟΔΑ</div><div class="stat-value">${eur(D.expenses)}</div>${delta(C.expenses, P.expenses, false, vs)}</div>
      <div class="stat"><div class="stat-label">ΚΑΘΑΡΟ</div><div class="stat-value" style="color:${D.net < 0 ? '#ff6b6b' : '#b7ff4a'}">${D.net < 0 ? '−' : ''}${eur(Math.abs(D.net))}</div>${delta(C.net, P.net, true, vs)}</div>
      <div class="stat"><div class="stat-label">ΚΡΑΤΗΣΕΙΣ</div><div class="stat-value">${D.count}</div><div class="stat-delta" style="color:rgba(244,249,255,0.55)">${C.count - P.count >= 0 ? '+' : '−'}${Math.abs(C.count - P.count)} από ${vs}</div></div>
    </div>`;
  const line = (label, val, sub) => `<div class="fin-line"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${val}</b></div>`;
  const incomeBox = `<div class="panel fin-box"><h3>ΕΣΟΔΑ ΑΠΟ ΚΡΑΤΗΣΕΙΣ</h3>
      ${line('📅 Κρατήσεις γηπέδων', eur(D.bookingRev), D.count + ' κρατήσεις · ' + D.four + ' τετράδες · ' + D.two + ' δυάδες')}
      <div class="fin-sub">
        ${line('💵 Μετρητά', eur(D.cash))}
        ${line('💳 Κάρτα', eur(D.card))}
        ${D.pending ? line('<span style="color:#ffc14a">⏳ Δεν έχουν πληρωθεί ακόμα</span>', eur(D.pending)) : ''}
        ${line('Γήπεδο 1 / Γήπεδο 2', D.court1 + ' / ' + D.court2)}
        ${D.rackets || D.balls ? line('Ενοικίαση ρακετών / premium μπαλάκια', D.rackets + ' / ' + D.balls) : ''}
      </div>
    </div>`;
  const maxExp = D.expByCat.length ? D.expByCat[0][1] : 0;
  const expenseBox = `<div class="panel fin-box"><h3>ΠΟΥ ΠΗΓΑΝ ΤΑ ΕΞΟΔΑ</h3>
      ${D.expByCat.length ? D.expByCat.map(([c, v]) => `
        <div class="fin-cat">
          <div class="fin-cat-row"><span>${esc(catLabel('expense', c))}</span><b>${eur(v)} <small>${Math.round(v / D.expenses * 100)}%</small></b></div>
          <div class="fin-bar"><i style="width:${Math.max(2, v / maxExp * 100)}%"></i></div>
        </div>`).join('') + line('<b>Σύνολο</b>', eur(D.expenses))
      : `<div class="am-empty">Κανένα έξοδο αυτόν τον μήνα.<br><br><button class="btn" data-fin="add">+ ΠΡΟΣΘΗΚΗ ΕΞΟΔΟΥ</button></div>`}
    </div>`;
  const rows = D.entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const list = `<div class="panel"><h3>ΕΞΟΔΑ ${esc(monthName(m).toUpperCase())} <span class="pill" style="background:rgba(255,255,255,0.08);color:rgba(244,249,255,0.6)">${rows.length}</span></h3>
      ${rows.length ? '<div class="fin-list">' + rows.map(e => `
        <button class="fin-entry" data-fin="edit" data-id="${esc(e.id)}">
          <span class="fin-date">${esc(fd(e.date))}</span>
          <span class="fin-desc"><b>${esc(catLabel('expense', e.category))}</b>${e.description ? `<small>${esc(e.description)}</small>` : ''}</span>
          <span class="fin-amt out">−${eur(e.amount)}</span>
        </button>`).join('') + '</div>'
      : '<div class="am-empty">Δεν υπάρχουν καταχωρημένα έξοδα για αυτόν τον μήνα.</div>'}
    </div>`;
  r.innerHTML = head + err + kpis + `<div class="fin-cols">${incomeBox}${expenseBox}</div>` + chartPanel() + list;
  bindChart();
}

/* ---------- 12-month chart ---------- */
function chartPanel(){
  // Phones get 6 months so the labels stay readable.
  const N = window.innerWidth < 640 ? 6 : 12;
  const months = []; for (let k = N - 1; k >= 0; k--) months.push(shiftMonth(F.month, -k));
  const data = months.map(m => { const d = monthData(m); return { m, inc: d.income, exp: d.expenses, net: d.net }; });
  const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
  const mob = N === 6, W = mob ? 360 : 720, H = mob ? 200 : 220, L = mob ? 34 : 44, R = 8, T = 10, B = 26, cw = (W - L - R) / N, bw = Math.min(16, (cw - 10) / 2);
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  let svg = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="fin-grid"/><text x="${L - 6}" y="${y(t) + 4}" class="fin-ax" text-anchor="end">${t >= 1000 ? (t / 1000) + 'k' : t}</text>`).join('');
  const bar = (x, v, col) => {
    if (v <= 0) return '';
    const top = y(v), h = (H - B) - top, rr = Math.min(4, h, bw / 2);
    return `<path d="M${x},${H - B} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${H - B} Z" fill="${col}"/>`;
  };
  data.forEach((d, i) => {
    const cx = L + cw * i + cw / 2;
    svg += `<g class="fin-col${d.m === F.month ? ' sel' : ''}" data-i="${i}">
        <rect x="${L + cw * i}" y="${T}" width="${cw}" height="${H - T - B + 20}" class="fin-hit"/>
        ${bar(cx - bw - 1, d.inc, COL_IN)}${bar(cx + 1, d.exp, COL_OUT)}
        <text x="${cx}" y="${H - 8}" class="fin-ax${d.m === F.month ? ' cur' : ''}" text-anchor="middle">${monthShort(d.m)}</text>
      </g>`;
  });
  svg += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="fin-base"/>`;
  F._chart = data;
  const tbl = `<details class="fin-tbl"><summary>Πίνακας</summary><div class="tbl-scroll" style="margin:8px 0 0"><table class="tbl" style="min-width:0"><thead><tr><th>Μήνας</th><th>Έσοδα</th><th>Έξοδα</th><th>Καθαρό</th></tr></thead><tbody>
      ${data.slice().reverse().map(d => `<tr><td>${esc(monthName(d.m))}</td><td>${eur(d.inc)}</td><td>${eur(d.exp)}</td><td>${d.net < 0 ? '−' : ''}${eur(Math.abs(d.net))}</td></tr>`).join('')}
    </tbody></table></div></details>`;
  return `<div class="panel"><h3>ΤΕΛΕΥΤΑΙΟΙ ${N} ΜΗΝΕΣ
        <span class="fin-legend"><i style="background:${COL_IN}"></i>Έσοδα <i style="background:${COL_OUT}"></i>Έξοδα</span></h3>
      <div class="fin-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Έσοδα και έξοδα ανά μήνα">${svg}</svg><div class="fin-tip" id="finTip" hidden></div></div>
      <div class="am-muted" style="font-size:11px;margin-top:4px">Πάτα σε έναν μήνα για να δεις τις λεπτομέρειές του.</div>
      ${tbl}
    </div>`;
}
function bindChart(){
  const wrap = document.querySelector('#finRoot .fin-chart'), tip = $('finTip');
  if (!wrap) return;
  wrap.querySelectorAll('.fin-col').forEach(g => {
    const d = F._chart[+g.dataset.i];
    const show = () => {
      tip.innerHTML = `<b>${esc(monthName(d.m))}</b><div><i style="background:${COL_IN}"></i>Έσοδα <span>${eur(d.inc)}</span></div><div><i style="background:${COL_OUT}"></i>Έξοδα <span>${eur(d.exp)}</span></div><div>Καθαρό <span>${d.net < 0 ? '−' : ''}${eur(Math.abs(d.net))}</span></div>`;
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect(), gr = g.getBoundingClientRect();
      let left = gr.left - wr.left + gr.width / 2 - tip.offsetWidth / 2;
      left = Math.max(0, Math.min(left, wr.width - tip.offsetWidth));
      tip.style.left = left + 'px';
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
    g.addEventListener('click', () => { F.month = d.m; paint(); });
  });
}

/* ---------- entry editor ---------- */
function openEditor(entry){
  const E = F.edit = entry ? { ...entry, kind: 'expense' } : {
    id: null, kind: 'expense', category: 'rackets',
    date: F.month === thisMonth() ? localToday() : F.month + '-01', amount: '', description: '', notes: '',
  };
  const m = document.createElement('div');
  m.className = 'mem-modal open'; m.id = 'finModal';
  m.innerHTML = `<div class="mem-card" style="max-width:520px">
      <button class="mem-close" type="button" data-fin="close" aria-label="Κλείσιμο">×</button>
      <h2 class="mem-title">${entry ? 'Επεξεργασία εξόδου' : 'Νέο έξοδο'}</h2>
      <div class="am-lab" style="margin-top:0">ΚΑΤΗΓΟΡΙΑ</div>
      <div class="am-chips" id="finCats"></div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field"><label>ΠΟΣΟ (€) *</label><input class="am-in" id="finAmt" inputmode="decimal" placeholder="π.χ. 45,50" value="${E.amount === '' ? '' : esc(String(E.amount).replace('.', ','))}"></div>
        <div class="field"><label>ΗΜΕΡΟΜΗΝΙΑ</label><input class="am-in" id="finDate" type="date" value="${esc(E.date)}"></div>
      </div>
      <div class="field" style="margin-top:14px"><label>ΠΕΡΙΓΡΑΦΗ</label><input class="am-in" id="finDesc" maxlength="120" placeholder="π.χ. 4 ρακέτες Bullpadel, κουτί μπαλάκια Head" value="${esc(E.description)}"></div>
      <div class="field" style="margin-top:14px"><label>ΣΗΜΕΙΩΣΕΙΣ</label><textarea class="am-in" id="finNotes" rows="2" maxlength="500" placeholder="π.χ. προμηθευτής, αρ. τιμολογίου">${esc(E.notes)}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
        <button class="am-btn-main" data-fin="save" style="flex:1">💾 ΑΠΟΘΗΚΕΥΣΗ</button>
        ${entry ? '<button class="btn danger" data-fin="delete">Διαγραφή</button>' : ''}
      </div>
      <div class="am-err" id="finErr"></div>
    </div>`;
  m.addEventListener('click', (e) => { if (e.target === m) closeEditor(); });
  document.body.appendChild(m);
  paintCats();
  setTimeout(() => { const a = $('finAmt'); if (a && !entry) a.focus(); }, 50);
}
function paintCats(){
  const E = F.edit, el = $('finCats'); if (!el) return;
  const list = CATS.expense;
  if (!list.some(c => c[0] === E.category)) E.category = list[0][0];
  el.innerHTML = list.map(([k, l]) => `<button class="am-chip txt ${E.category === k ? 'on' : ''}" data-fin="cat" data-cat="${k}">${esc(l)}</button>`).join('');
}
function closeEditor(){ const m = $('finModal'); if (m) m.remove(); F.edit = null; }
async function saveEntry(btn){
  const E = F.edit, err = $('finErr');
  const amount = parseAmount($('finAmt').value);
  const date = $('finDate').value;
  if (!(amount > 0)){ err.textContent = 'Γράψε ποσό μεγαλύτερο από 0.'; return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){ err.textContent = 'Διάλεξε ημερομηνία.'; return; }
  const data = { kind: 'expense', category: E.category, amount, date,
    description: $('finDesc').value.trim(), notes: $('finNotes').value.trim() };
  btn.disabled = true; err.textContent = 'Αποθήκευση...';
  try {
    if (E.id){
      await updateDoc(doc(db(), C_FIN, E.id), { ...data, updatedAt: serverTimestamp() });
      Object.assign(F.entries.find(x => x.id === E.id), data);
    } else {
      const ref = await addDoc(collection(db(), C_FIN), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      F.entries.push({ id: ref.id, ...data });
    }
    F.month = date.slice(0, 7) > thisMonth() ? F.month : date.slice(0, 7);
    closeEditor(); paint();
  } catch(e){
    btn.disabled = false;
    err.textContent = 'Αποτυχία: ' + e.message + (e.code === 'permission-denied' ? ' — χρειάζεται ενημέρωση των Firestore Rules.' : '');
  }
}
async function deleteEntry(){
  const E = F.edit;
  if (!confirm('Διαγραφή αυτού του εξόδου;')) return;
  try {
    await deleteDoc(doc(db(), C_FIN, E.id));
    F.entries = F.entries.filter(x => x.id !== E.id);
    closeEditor(); paint();
  } catch(e){ $('finErr').textContent = 'Αποτυχία: ' + e.message; }
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-fin]'); if (!el) return;
  const inRoot = $('finRoot') && $('finRoot').contains(el), inModal = $('finModal') && $('finModal').contains(el);
  if (!inRoot && !inModal) return;
  switch (el.dataset.fin){
    case 'prev': F.month = shiftMonth(F.month, -1); paint(); break;
    case 'next': if (F.month < thisMonth()){ F.month = shiftMonth(F.month, 1); paint(); } break;
    case 'now': F.month = thisMonth(); paint(); break;
    case 'add': openEditor(null); break;
    case 'edit': openEditor(F.entries.find(x => x.id === el.dataset.id)); break;
    case 'cat': F.edit.category = el.dataset.cat; paintCats(); break;
    case 'save': saveEntry(el); break;
    case 'delete': deleteEntry(); break;
    case 'close': closeEditor(); break;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('finModal')) closeEditor(); });

/* ---------- public ---------- */
// Called by renderDashboard() every time bookings are (re)loaded.
window.npFinance = {
  render(bookings){
    F.bookings = Array.isArray(bookings) ? bookings : [];
    paint();
    load();
  },
};
// renderDashboard() may have run before this module loaded.
if (window.__finBookings) window.npFinance.render(window.__finBookings);
