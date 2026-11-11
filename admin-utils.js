/* ============ ADMIN UTILS (shared by finance.js and bookings-stats.js) ============
 * - Periods: month / week (Mon–Sun) / day, navigation and fair comparison
 * - payParts(): how much of a booking was paid cash / card / still pending,
 *   including split payments (payMethod 'split' + payCash + payCard)
 */
const pad = (n) => String(n).padStart(2, '0');
export const ld = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => ld(new Date());
export const addDays = (iso, k) => { const d = parse(iso); d.setDate(d.getDate() + k); return ld(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

export const MONTHS = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος','Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
export const MONTHS_S = ['Ιαν','Φεβ','Μαρ','Απρ','Μάι','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];
export const DAYS = ['Κυριακή','Δευτέρα','Τρίτη','Τετάρτη','Πέμπτη','Παρασκευή','Σάββατο'];
const DAYS_ACC = ['την προηγ. Κυριακή','την προηγ. Δευτέρα','την προηγ. Τρίτη','την προηγ. Τετάρτη','την προηγ. Πέμπτη','την προηγ. Παρασκευή','το προηγ. Σάββατο'];
export const MODE_LABEL = { month: 'Μήνας', week: 'Εβδομάδα', day: 'Ημέρα', range: 'Περίοδος' };

/** {from, to, label} for a period containing `anchor` (YYYY-MM-DD). */
export function range(mode, anchor){
  const d = parse(anchor), y = d.getFullYear(), m = d.getMonth();
  if (mode === 'month'){
    return { from: ld(new Date(y, m, 1)), to: ld(new Date(y, m + 1, 0)), label: MONTHS[m] + ' ' + y };
  }
  if (mode === 'week'){
    const from = addDays(anchor, -((d.getDay() + 6) % 7)), to = addDays(from, 6);
    const a = parse(from), b = parse(to);
    const label = a.getMonth() === b.getMonth()
      ? a.getDate() + ' – ' + b.getDate() + ' ' + MONTHS_S[b.getMonth()] + ' ' + b.getFullYear()
      : a.getDate() + ' ' + MONTHS_S[a.getMonth()] + ' – ' + b.getDate() + ' ' + MONTHS_S[b.getMonth()] + ' ' + b.getFullYear();
    return { from, to, label };
  }
  return { from: anchor, to: anchor, label: DAYS[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(m + 1) + '/' + y };
}
export function shift(mode, anchor, k){
  if (mode === 'month'){ const d = parse(anchor); return ld(new Date(d.getFullYear(), d.getMonth() + k, 1)); }
  return addDays(anchor, mode === 'week' ? 7 * k : k);
}
/**
 * Current vs previous period, like for like:
 *   month → previous month, week → previous week, day → same weekday last week.
 * If the current period is still running, both are cut at the same day
 * (e.g. 1–11 Nov vs 1–11 Oct) so future bookings don't skew it.
 */
export function compare(mode, anchor){
  if (mode === 'range') return null;
  const r = range(mode, anchor), t = today();
  if (mode === 'day'){
    const p = addDays(anchor, -7);
    return { cur: { from: r.from, to: r.to }, prev: { from: p, to: p }, label: DAYS_ACC[parse(anchor).getDay()] };
  }
  const p = range(mode, shift(mode, anchor, -1));
  let label = mode === 'month' ? MONTHS_S[parse(p.from).getMonth()] : 'προηγ. εβδομάδα';
  const cur = { from: r.from, to: r.to }, prev = { from: p.from, to: p.to };
  if (t >= r.from && t <= r.to){
    cur.to = t;
    const cut = addDays(p.from, daysBetween(r.from, t));
    prev.to = cut < p.to ? cut : p.to;
    label = 'ίδιες μέρες ' + (mode === 'month' ? label : 'προηγ. εβδομάδας');
  }
  return { cur, prev, label };
}
export const inRange = (d, rg) => !!d && d >= rg.from && d <= rg.to;

/** Period picker: [Μήνας | Εβδομάδα | Ημέρα (| Περίοδος)]  ‹ label › */
export function pickerHtml(ns, mode, anchor, opts = {}){
  const modes = opts.modes || ['month', 'week', 'day'];
  const r = mode === 'range' ? null : range(mode, anchor);
  const isNow = r && today() >= r.from && today() <= r.to;
  const nav = mode === 'range' ? (opts.rangeHtml || '') : `
    <div class="pp-nav">
      <button class="btn" data-${ns}="pprev" aria-label="Προηγούμενο">‹</button>
      ${mode === 'day'
        ? `<label class="pp-label pp-daypick">${r.label}<input type="date" data-${ns}-f="anchor" value="${anchor}" aria-label="Ημερομηνία"></label>`
        : `<span class="pp-label">${r.label}</span>`}
      <button class="btn" data-${ns}="pnext" aria-label="Επόμενο" ${opts.noFuture && isNow ? 'disabled' : ''}>›</button>
    </div>
    ${isNow ? '' : `<button class="btn pp-now" data-${ns}="pnow">Σήμερα</button>`}`;
  return `<div class="pp">
      <div class="pp-right">${nav}</div>
      <div class="pp-modes" role="tablist">${modes.map(m => `<button class="pp-mode ${m === mode ? 'on' : ''}" role="tab" aria-selected="${m === mode}" data-${ns}="pmode" data-m="${m}">${MODE_LABEL[m]}</button>`).join('')}</div>
    </div>`;
}

/** Cash / card / pending split of one booking's total. */
export function payParts(b){
  const t = +b.total || 0, m = b.payMethod || 'pending';
  if (m === 'cash') return { cash: t, card: 0, pending: 0 };
  if (m === 'card') return { cash: 0, card: t, pending: 0 };
  if (m === 'split'){
    const cash = Math.min(t, Math.max(0, +b.payCash || 0));
    return { cash, card: Math.max(0, t - cash), pending: 0 };
  }
  return { cash: 0, card: 0, pending: t };
}
export function sumPay(list){
  return list.reduce((s, b) => { const p = payParts(b); s.cash += p.cash; s.card += p.card; s.pending += p.pending; return s; }, { cash: 0, card: 0, pending: 0 });
}

// Tapping the day label opens the native date picker (desktop browsers need showPicker()).
document.addEventListener('click', (e) => {
  const lab = e.target.closest('.pp-daypick'); if (!lab) return;
  const inp = lab.querySelector('input[type=date]');
  if (inp && e.target !== inp && inp.showPicker){ try { inp.showPicker(); } catch(_) {} }
});
