/* ============ BOOKINGS: SEARCH & STATS (top of the Κρατήσεις tab) ============
 * Read-only view over CACHE.bookings: pick a month, a single day or a date
 * range, filter, and see counts, revenue, busiest days/hours, top customers
 * and the matching list. Editing stays in the existing tables below.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad = (n) => String(n).padStart(2, '0');
const ld = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ld(new Date());
const MONTHS = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος','Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
const DAYS = ['Κυριακή','Δευτέρα','Τρίτη','Τετάρτη','Πέμπτη','Παρασκευή','Σάββατο'];
const DAYS_S = ['Κυρ','Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ'];
const BAR = '#3aa58a';
function shiftMonth(m, k){ const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + k, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
const monthName = (m) => MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
function dayName(iso){ const [y, m, d] = iso.split('-').map(Number); return DAYS[new Date(y, m - 1, d).getDay()]; }
function fdate(iso){ if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return DAYS_S[new Date(y, m - 1, d).getDay()] + ' ' + pad(d) + '/' + pad(m); }
function fdateLong(iso){ const [y, m, d] = iso.split('-'); return dayName(iso) + ' ' + d + '/' + m + '/' + y; }
function eur(n){ n = Math.round((+n || 0) * 100) / 100; return n.toLocaleString('el-GR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + '€'; }
const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^(00)?30(?=69)/, '');

/* ---------- state ---------- */
const S = {
  mode: 'month',            // month | day | range
  month: today().slice(0, 7),
  day: today(),
  from: today().slice(0, 7) + '-01',
  to: today(),
  court: 'all', pay: 'all', status: 'active', q: '',
  showList: false,
  bookings: [], sig: '',
};

/* ---------- filtering ---------- */
function inPeriod(b){
  const d = b.date || '';
  if (S.mode === 'month') return d.startsWith(S.month);
  if (S.mode === 'day') return d === S.day;
  const a = S.from <= S.to ? S.from : S.to, z = S.from <= S.to ? S.to : S.from;
  return d >= a && d <= z;
}
function matches(b, ignoreStatus){
  if (!inPeriod(b)) return false;
  if (S.court !== 'all' && b.court !== S.court) return false;
  if (S.pay !== 'all'){
    const p = b.payMethod || 'pending';
    if (p !== S.pay) return false;
  }
  if (!ignoreStatus){
    if (S.status === 'active' && b.status === 'cancelled') return false;
    if (S.status === 'cancelled' && b.status !== 'cancelled') return false;
  }
  if (S.q){
    const q = S.q.toLowerCase(), qp = normPhone(S.q);
    const hit = (b.name || '').toLowerCase().includes(q) || (b.userEmail || '').toLowerCase().includes(q)
      || (qp.length >= 3 && normPhone(b.phone).includes(qp));
    if (!hit) return false;
  }
  return true;
}
function periodLabel(){
  if (S.mode === 'month') return monthName(S.month);
  if (S.mode === 'day') return fdateLong(S.day);
  const a = S.from <= S.to ? S.from : S.to, z = S.from <= S.to ? S.to : S.from;
  return a.split('-').reverse().join('/') + ' – ' + z.split('-').reverse().join('/');
}
function prevPeriodList(){
  // Same-length period just before the current one, for comparison.
  if (S.mode === 'month'){
    const pm = shiftMonth(S.month, -1), short = MONTHS[+pm.slice(5, 7) - 1].slice(0, 3);
    // Current month is still running: compare with the same days of last month.
    if (S.month === today().slice(0, 7)){
      const upto = pm + '-' + today().slice(8, 10);
      return { label: 'ίδιες μέρες ' + short, fn: (d) => d.startsWith(pm) && d <= upto, cur: (d) => d <= today() };
    }
    return { label: short, fn: (d) => d.startsWith(pm) };
  }
  if (S.mode === 'day'){
    const [y, m, d] = S.day.split('-').map(Number); const p = ld(new Date(y, m - 1, d - 7));
    return { label: 'την προηγ. ' + DAYS[new Date(y, m - 1, d).getDay()], fn: (x) => x === p };
  }
  return null;
}

/* ---------- render ---------- */
function bars(rows, fmt){
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.map(([label, v, sub]) => `
    <div class="bks-bar-row" title="${esc(label)}: ${esc(fmt(v))}">
      <span class="bks-bar-l">${esc(label)}</span>
      <span class="bks-bar"><i style="width:${v ? Math.max(2, v / max * 100) : 0}%;background:${BAR}"></i></span>
      <b>${esc(fmt(v))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}
    </div>`).join('');
}
function paint(){
  const r = $('bksRoot'); if (!r) return;
  const all = S.bookings;
  const list = all.filter(b => matches(b)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
  const scope = all.filter(b => matches(b, true));
  const active = scope.filter(b => b.status !== 'cancelled');
  const cancelled = scope.filter(b => b.status === 'cancelled');
  const rev = active.reduce((s, b) => s + (+b.total || 0), 0);
  const prev = prevPeriodList();
  let cmp = '';
  if (prev){
    const pl = all.filter(b => b.status !== 'cancelled' && prev.fn(b.date || '') && (S.court === 'all' || b.court === S.court));
    // Compare like with like: when last month is cut at today's day, cut this month too
    // (future bookings already in the system would otherwise inflate the difference).
    const curA = prev.cur ? active.filter(b => prev.cur(b.date || '')) : active;
    const curRev = curA.reduce((s, b) => s + (+b.total || 0), 0);
    const dc = curA.length - pl.length, dr = curRev - pl.reduce((s, b) => s + (+b.total || 0), 0);
    cmp = { c: (dc >= 0 ? '+' : '−') + Math.abs(dc) + ' από ' + prev.label, r: (dr >= 0 ? '+' : '−') + eur(Math.abs(dr)) + ' από ' + prev.label, cn: dc < 0, rn: dr < 0 };
  }
  const four = active.filter(b => +b.players === 4).length, two = active.filter(b => +b.players === 2).length;
  const cash = active.filter(b => b.payMethod === 'cash'), card = active.filter(b => b.payMethod === 'card');
  const pend = active.filter(b => !b.payMethod || b.payMethod === 'pending');
  const sum = (a) => a.reduce((s, b) => s + (+b.total || 0), 0);

  // by weekday (Mon..Sun), by time slot, top customers
  const wd = [1, 2, 3, 4, 5, 6, 0].map(i => [DAYS[i], active.filter(b => { const [y, m, d] = (b.date || '').split('-').map(Number); return y && new Date(y, m - 1, d).getDay() === i; }).length]);
  const slots = {}; active.forEach(b => { const k = b.time || '—'; slots[k] = (slots[k] || 0) + 1; });
  const slotRows = Object.entries(slots).sort((a, b) => a[0].localeCompare(b[0]));
  const cust = {};
  active.forEach(b => {
    const k = normPhone(b.phone) || (b.name || '').trim().toLowerCase() || '—';
    const c = cust[k] || (cust[k] = { name: b.name || '—', phone: b.phone || '', n: 0, sum: 0, guest: true });
    c.n++; c.sum += (+b.total || 0); if (b.guest === false) c.guest = false;
  });
  const top = Object.values(cust).sort((a, b) => b.n - a.n || b.sum - a.sum).slice(0, 8);
  const custCount = Object.keys(cust).length;

  const sel = (name, val, opts) => `<select class="am-in bks-sel" data-bks-f="${name}">${opts.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const period = S.mode === 'month' ? `
      <div class="fin-nav">
        <button class="btn" data-bks="mprev" aria-label="Προηγούμενος μήνας">‹</button>
        <span class="fin-month">${esc(monthName(S.month))}</span>
        <button class="btn" data-bks="mnext" aria-label="Επόμενος μήνας">›</button>
      </div>`
    : S.mode === 'day' ? `
      <div class="fin-nav">
        <button class="btn" data-bks="dprev" aria-label="Προηγούμενη μέρα">‹</button>
        <input type="date" class="am-in bks-date" data-bks-f="day" value="${esc(S.day)}">
        <button class="btn" data-bks="dnext" aria-label="Επόμενη μέρα">›</button>
      </div>`
    : `<div class="bks-range"><label>ΑΠΟ <input type="date" class="am-in bks-date" data-bks-f="from" value="${esc(S.from)}"></label><label>ΕΩΣ <input type="date" class="am-in bks-date" data-bks-f="to" value="${esc(S.to)}"></label></div>`;

  const rowsHtml = list.map(b => {
    const p = b.payMethod || 'pending';
    return `<tr class="${b.status === 'cancelled' ? 'bks-canc' : ''}">
      <td>${esc(fdate(b.date))}</td><td>${esc(b.time || '')}</td><td>${esc((b.court || '').replace('Γήπεδο ', 'Γ'))}</td>
      <td>${esc(b.name || '')}${b.guest ? ' <span class="bks-tag">guest</span>' : ''}</td>
      <td>${b.phone ? `<a href="tel:${esc(b.phone)}" style="color:inherit">${esc(b.phone)}</a>` : ''}</td>
      <td>${+b.players || 0}άδα</td><td>${eur(b.total)}</td>
      <td>${b.status === 'cancelled' ? '<span class="pill canc">ΑΚΥΡΩΘΗΚΕ</span>' : p === 'cash' ? '💵' : p === 'card' ? '💳' : '<span style="color:#ffc14a">⏳</span>'}</td>
    </tr>`;
  }).join('');
  const showList = S.showList || S.mode === 'day';

  r.innerHTML = `<div class="panel bks">
    <h3>🔎 ΑΝΑΖΗΤΗΣΗ & ΣΤΑΤΙΣΤΙΚΑ</h3>
    <div class="bks-top">
      <div class="am-chips">
        <button class="am-chip txt ${S.mode === 'month' ? 'on' : ''}" data-bks="mode" data-m="month">Μήνας</button>
        <button class="am-chip txt ${S.mode === 'day' ? 'on' : ''}" data-bks="mode" data-m="day">Ημερομηνία</button>
        <button class="am-chip txt ${S.mode === 'range' ? 'on' : ''}" data-bks="mode" data-m="range">Περίοδος</button>
      </div>
      ${period}
    </div>
    <div class="bks-filters">
      ${sel('court', S.court, [['all', 'Όλα τα γήπεδα'], ['Γήπεδο 1', 'Γήπεδο 1'], ['Γήπεδο 2', 'Γήπεδο 2']])}
      ${sel('pay', S.pay, [['all', 'Κάθε πληρωμή'], ['cash', '💵 Μετρητά'], ['card', '💳 Κάρτα'], ['pending', '⏳ Εκκρεμεί']])}
      ${sel('status', S.status, [['active', 'Ενεργές'], ['cancelled', 'Ακυρωμένες'], ['all', 'Όλες']])}
      <input class="am-in bks-q" data-bks-f="q" placeholder="🔍 Όνομα ή τηλέφωνο" value="${esc(S.q)}">
    </div>

    <div class="stat-grid bks-kpis">
      <div class="stat"><div class="stat-label">ΚΡΑΤΗΣΕΙΣ</div><div class="stat-value">${active.length}</div>${cmp ? `<div class="stat-delta${cmp.cn ? ' neg' : ''}">${esc(cmp.c)}</div>` : '<div class="stat-delta" style="color:rgba(244,249,255,0.5)">' + four + ' τετράδες · ' + two + ' δυάδες</div>'}</div>
      <div class="stat"><div class="stat-label">ΕΣΟΔΑ</div><div class="stat-value">${eur(rev)}</div>${cmp ? `<div class="stat-delta${cmp.rn ? ' neg' : ''}">${esc(cmp.r)}</div>` : ''}</div>
      <div class="stat"><div class="stat-label">ΜΕΣΗ ΚΡΑΤΗΣΗ</div><div class="stat-value">${eur(active.length ? rev / active.length : 0)}</div><div class="stat-delta" style="color:rgba(244,249,255,0.5)">${custCount} διαφορετικοί πελάτες</div></div>
      <div class="stat"><div class="stat-label">ΑΚΥΡΩΣΕΙΣ</div><div class="stat-value">${cancelled.length}</div><div class="stat-delta" style="color:rgba(244,249,255,0.5)">${scope.length ? Math.round(cancelled.length / scope.length * 100) : 0}% των κρατήσεων</div></div>
    </div>

    <div class="bks-grid">
      <div class="bks-box"><div class="bks-h">ΠΛΗΡΩΜΕΣ</div>
        <div class="fin-line"><span>💵 Μετρητά <small>${cash.length} κρατήσεις</small></span><b>${eur(sum(cash))}</b></div>
        <div class="fin-line"><span>💳 Κάρτα <small>${card.length} κρατήσεις</small></span><b>${eur(sum(card))}</b></div>
        <div class="fin-line"><span style="color:#ffc14a">⏳ Εκκρεμούν <small>${pend.length} κρατήσεις</small></span><b>${eur(sum(pend))}</b></div>
        <div class="fin-line"><span>Τετράδες / Δυάδες</span><b>${four} / ${two}</b></div>
        <div class="fin-line"><span>Γήπεδο 1 / Γήπεδο 2</span><b>${active.filter(b => b.court === 'Γήπεδο 1').length} / ${active.filter(b => b.court === 'Γήπεδο 2').length}</b></div>
        <div class="fin-line"><span>Μέλη / Guests</span><b>${active.filter(b => b.guest === false).length} / ${active.filter(b => b.guest).length}</b></div>
      </div>
      ${S.mode === 'day' ? '' : `<div class="bks-box"><div class="bks-h">ΠΟΙΕΣ ΜΕΡΕΣ ΓΕΜΙΖΟΥΝ</div>${bars(wd, v => v + '')}</div>`}
      <div class="bks-box"><div class="bks-h">ΠΟΙΕΣ ΩΡΕΣ ΓΕΜΙΖΟΥΝ</div>${slotRows.length ? bars(slotRows, v => v + '') : '<div class="am-empty">—</div>'}</div>
      <div class="bks-box"><div class="bks-h">ΚΑΛΥΤΕΡΟΙ ΠΕΛΑΤΕΣ</div>
        ${top.length ? top.map((c, i) => `<div class="fin-line"><span>${i + 1}. ${esc(c.name)}${c.phone ? `<small>${esc(c.phone)}${c.guest ? ' · guest' : ''}</small>` : ''}</span><b>${c.n}× · ${eur(c.sum)}</b></div>`).join('') : '<div class="am-empty">—</div>'}
      </div>
    </div>

    <div class="bks-listhead">
      <div class="bks-h" style="margin:0">ΚΡΑΤΗΣΕΙΣ · ${esc(periodLabel())} <span class="pill" style="background:rgba(255,255,255,0.08);color:rgba(244,249,255,0.6);margin-left:6px">${list.length}</span></div>
      ${S.mode === 'day' ? '' : `<button class="btn" data-bks="toggle">${showList ? 'Απόκρυψη λίστας' : 'Εμφάνιση λίστας'}</button>`}
    </div>
    ${showList ? (list.length ? `<div class="tbl-scroll"><table class="tbl bks-tbl"><thead><tr><th>Ημέρα</th><th>Ώρα</th><th>Γήπ.</th><th>Παίκτης</th><th>Τηλ.</th><th>Πακέτο</th><th>Σύνολο</th><th>Πληρ.</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`
      : '<div class="am-empty">Καμία κράτηση με αυτά τα κριτήρια.</div>') : ''}
  </div>`;
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-bks]'); if (!el || !$('bksRoot') || !$('bksRoot').contains(el)) return;
  const shiftDay = (k) => { const [y, m, d] = S.day.split('-').map(Number); S.day = ld(new Date(y, m - 1, d + k)); };
  switch (el.dataset.bks){
    case 'mode': S.mode = el.dataset.m; break;
    case 'mprev': S.month = shiftMonth(S.month, -1); break;
    case 'mnext': S.month = shiftMonth(S.month, 1); break;
    case 'dprev': shiftDay(-1); break;
    case 'dnext': shiftDay(1); break;
    case 'toggle': S.showList = !S.showList; break;
    default: return;
  }
  paint();
});
document.addEventListener('change', (e) => {
  const t = e.target; if (!$('bksRoot') || !$('bksRoot').contains(t) || !t.dataset.bksF) return;
  const f = t.dataset.bksF;
  if (f === 'q') return;
  if ((f === 'day' || f === 'from' || f === 'to') && !t.value) return;
  S[f] = t.value; paint();
});
let qT;
document.addEventListener('input', (e) => {
  const t = e.target; if (!$('bksRoot') || !$('bksRoot').contains(t) || t.dataset.bksF !== 'q') return;
  clearTimeout(qT);
  qT = setTimeout(() => {
    S.q = t.value.trim();
    const pos = t.selectionStart;
    paint();
    const again = document.querySelector('#bksRoot .bks-q');
    if (again){ again.focus(); try { again.setSelectionRange(pos, pos); } catch(_) {} }
  }, 350);
});

/* ---------- public ---------- */
// Called from renderBookings() (also every minute) — only repaint when data changed,
// so typing in the search box isn't interrupted.
window.npBkStats = {
  render(bookings){
    const arr = Array.isArray(bookings) ? bookings : [];
    const sig = arr.length + '|' + arr.map(b => (b.id || '') + (b.status || '') + (b.payMethod || '') + (b.total || 0) + (b.date || '') + (b.time || '')).join(',');
    S.bookings = arr;
    if (sig === S.sig && $('bksRoot') && $('bksRoot').childElementCount) return;
    S.sig = sig;
    paint();
  },
};
if (window.__bkAll) window.npBkStats.render(window.__bkAll);
