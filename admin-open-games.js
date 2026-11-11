/* ============ ADMIN: OPEN GAMES («Βρες παίχτη») ============
 * Live list of upcoming open games in the Κρατήσεις tab: who is in, how many
 * are missing, and which games need the organiser's keep/cancel decision
 * (6h before start). Also tags bookings that are open games.
 */
import { collection, doc, query, where, onSnapshot, updateDoc, serverTimestamp, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const DAYS = ['Κυρ','Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ'];
const fdate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return DAYS[new Date(y, m - 1, d).getDay()] + ' ' + pad(d) + '/' + pad(m); };
const count = (g) => Object.keys(g.players || {}).length + (+g.friends || 0);
const ST = { open: ['ΑΝΟΙΧΤΟ', 'ok'], full: ['ΓΕΜΑΤΟ 4/4', 'ok'], kept: ['ΚΡΑΤΗΘΗΚΕ', 'pend'], cancelled: ['ΑΚΥΡΩΘΗΚΕ', 'canc'] };
const G = { games: [], unsub: null, showAll: false, open: null, alerts: null, sent: {} };
try { G.sent = JSON.parse(localStorage.getItem('np_og_wa_sent') || '{}'); } catch(_) {}

/* ---------- WhatsApp to matching members (free: opens your own WhatsApp) ---------- */
const lv10 = (u) => (window.npLv10 ? window.npLv10(u) : (+u.level || 1));
const genderOk = (g, u) => !g.gameGender || g.gameGender === 'any' || g.gameGender === 'mixed' || (g.gameGender === 'men' && u.gender === 'M') || (g.gameGender === 'women' && u.gender === 'F');
function waPhone(p){
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && /^(69|2)/.test(d)) d = '30' + d;
  return d.length >= 11 ? d : '';
}
function matching(g){
  let users = [];
  try { users = (typeof CACHE !== 'undefined' && CACHE.users) || []; } catch(_) {}
  const al = G.alerts || {};
  return users.filter(u => u.uid && !(g.players || {})[u.uid] && waPhone(u.phone)
      && lv10(u) >= g.levelMin && lv10(u) <= g.levelMax && genderOk(g, u)
      && !(window.npFB.ADMIN_EMAILS || []).includes((u.email || '').toLowerCase()))
    .map(u => ({ u, alert: !!(al[u.uid] && al[u.uid].on), consent: !!(u.consent && (u.consent.findPlayer || u.consent.marketing)), d: Math.abs(lv10(u) - (g.levelMin + g.levelMax) / 2) }))
    .sort((a, b) => (b.alert - a.alert) || (b.consent - a.consent) || (a.d - b.d));
}
function waText(g, u){
  const need = 4 - count(g);
  const first = (u.name || '').trim().split(' ')[0];
  return `Γεια σου${first ? ' ' + first : ''}! 🎾 Ψάχνουμε ${need} ${need === 1 ? 'παίχτη' : 'παίχτες'} για padel στο North Padel:\n📅 ${fdate(g.date)} ${String(g.time || '').replace('-', '–')}\n🎯 Επίπεδο ${g.levelMin}–${g.levelMax}\n👉 Μπες εδώ: ${location.origin}/#og=${g.id}`;
}
async function loadAlerts(){
  if (G.alerts) return;
  try { const snap = await getDocs(collection(window.npFB.db, 'og_alerts')); G.alerts = {}; snap.docs.forEach(d => { G.alerts[d.id] = d.data(); }); }
  catch(e){ G.alerts = {}; console.warn('og_alerts', e); }
}
function matchRow(g){
  const list = matching(g);
  if (!list.length) return `<tr><td colspan="6" style="background:rgba(37,211,102,0.05);color:rgba(244,249,255,0.5);padding:12px">Κανένα μέλος με τηλέφωνο δεν ταιριάζει (επίπεδο ${g.levelMin}–${g.levelMax}${g.gameGender && g.gameGender !== 'any' && g.gameGender !== 'mixed' ? ', ' + (g.gameGender === 'men' ? 'άνδρες' : 'γυναίκες') : ''}).</td></tr>`;
  return `<tr><td colspan="6" style="background:rgba(37,211,102,0.05);padding:10px 12px">
    <div style="font-size:12px;color:rgba(244,249,255,0.6);margin-bottom:8px">Πάτα «WhatsApp» — ανοίγει το δικό σου WhatsApp με έτοιμο μήνυμα, και πατάς Αποστολή. 🔔 = έχει ζητήσει ειδοποιήσεις.</div>
    <div style="display:flex;flex-direction:column;gap:6px">${list.slice(0, 40).map(({ u, alert, consent }) => {
      const key = g.id + '_' + u.uid, sent = G.sent[key];
      return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="min-width:150px"><b>${esc(((u.name || '') + ' ' + (u.surname || '')).trim() || u.email)}</b> ${alert ? '🔔' : ''}</span>
        <span style="color:#b7ff4a;font-size:12px">Επ. ${lv10(u)}</span>
        <span style="color:rgba(244,249,255,0.5);font-size:12px">${esc(u.phone || '')}</span>
        ${!consent && !alert ? '<span style="color:rgba(244,249,255,0.4);font-size:11px">(παλιό μέλος)</span>' : ''}
        <a class="btn" style="margin-left:auto;text-decoration:none;${sent ? 'opacity:.55' : 'background:rgba(37,211,102,0.15);border-color:rgba(37,211,102,0.5);color:#5ff08f'}" target="_blank" rel="noopener"
           data-wa-sent="${esc(key)}" href="https://wa.me/${waPhone(u.phone)}?text=${encodeURIComponent(waText(g, u))}">📲 ${sent ? 'Στάλθηκε ✓' : 'WhatsApp'}</a>
      </div>`; }).join('')}</div></td></tr>`;
}

function waitFB(){ return new Promise(r => window.npFB ? r() : window.addEventListener('npFBReady', r, { once: true })); }
async function start(){
  await waitFB();
  if (G.unsub) return;
  const go = () => {
    if (G.unsub || !window.npFB.auth.currentUser) return;
    G.unsub = onSnapshot(query(collection(window.npFB.db, 'open_games'), where('date', '>=', todayISO())), (snap) => {
      G.games = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.startsAt || 0) - (b.startsAt || 0));
      paint();
      if (typeof window.renderBookings === 'function') try { window.renderBookings(); } catch(_) {}
    }, (e) => console.warn('admin open games', e));
  };
  window.npFB.onAuth(() => setTimeout(go, 300));
}
function paint(){
  const r = $('ogAdminRoot'); if (!r) return;
  const now = Date.now();
  const upcoming = G.games.filter(g => (g.startsAt || 0) > now - 2 * 3600e3);
  const shown = G.showAll ? upcoming : upcoming.filter(g => g.status === 'open' || g.status === 'full');
  if (!upcoming.length){ r.innerHTML = ''; return; }
  const needDecision = (g) => g.status === 'open' && now >= g.startsAt - 6 * 3600e3 && now < g.startsAt;
  const rows = shown.map(g => {
    const n = count(g), st = ST[g.status] || [g.status, 'pend'];
    const names = Object.entries(g.players || {}).sort((a, b) => (a[1].at || 0) - (b[1].at || 0))
      .map(([uid, p]) => esc(p.name) + ' <span style="color:#b7ff4a;font-size:11px">Επ.' + esc(p.level) + '</span>' + (uid === g.creatorUid ? ' 👑' : '')).join(', ')
      + (g.friends ? ' + ' + g.friends + ' φίλ' + (g.friends > 1 ? 'οι' : 'ος') + ((g.friendNames || []).filter(Boolean).length ? ' (' + esc(g.friendNames.filter(Boolean).join(', ')) + ')' : '') : '');
    return `<tr${needDecision(g) ? ' style="background:rgba(255,193,74,0.08)"' : ''}>
      <td style="white-space:nowrap"><b>${esc(fdate(g.date))}</b> ${esc(g.time)}</td>
      <td style="white-space:nowrap"><b>${n}/4</b>${g.status === 'open' ? ' <span style="color:#ffc14a;font-size:12px">ψάχνει ' + (4 - n) + '</span>' : ''}</td>
      <td>Επ. ${g.levelMin}–${g.levelMax}</td>
      <td style="white-space:normal;min-width:220px">${names}</td>
      <td><span class="pill ${st[1]}">${st[0]}</span>${needDecision(g) ? '<div style="color:#ffc14a;font-size:11px;margin-top:4px">⏰ περιμένει απόφαση διοργανωτή</div>' : ''}</td>
      <td style="text-align:right;white-space:nowrap">${g.status === 'open' ? `<button class="btn" data-ogadm="wa" data-id="${esc(g.id)}" style="background:rgba(37,211,102,0.15);border-color:rgba(37,211,102,0.5);color:#5ff08f">📲 Ποιοι ταιριάζουν${G.open === g.id ? ' ▲' : ''}</button> <button class="btn" data-ogadm="kept" data-id="${esc(g.id)}" title="Κλείσιμο ως έχει">📌 Κράτα</button>` : ''}</td>
    </tr>${G.open === g.id && g.status === 'open' ? matchRow(g) : ''}`;
  }).join('');
  const openN = upcoming.filter(g => g.status === 'open').length, decN = upcoming.filter(needDecision).length;
  r.innerHTML = `<div class="panel">
    <h3>👥 ΑΝΟΙΧΤΑ ΠΑΙΧΝΙΔΙΑ (ΒΡΕΣ ΠΑΙΧΤΗ) <span class="actions">
      <span class="pill ok">${openN} ανοιχτά</span>${decN ? `<span class="pill pend">${decN} για απόφαση</span>` : ''}
      <button class="btn" data-ogadm="all">${G.showAll ? 'Μόνο ενεργά' : 'Όλα'}</button></span></h3>
    ${shown.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Ημέρα</th><th>Παίχτες</th><th>Επίπεδο</th><th>Ποιοι</th><th>Κατάσταση</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div style="text-align:center;color:rgba(244,249,255,0.45);padding:14px">Κανένα ενεργό ανοιχτό παιχνίδι.</div>'}
    <p style="color:rgba(244,249,255,0.45);font-size:12px;margin-top:8px">Το γήπεδο είναι κλεισμένο στο όνομα του διοργανωτή (κανονική κράτηση). Αν διαγράψεις την κράτηση, ακυρώνεται και το παιχνίδι.</p>
  </div>`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-wa-sent]'); if (!a) return;
  G.sent[a.dataset.waSent] = Date.now();
  try { localStorage.setItem('np_og_wa_sent', JSON.stringify(G.sent)); } catch(_) {}
  setTimeout(paint, 300);
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-ogadm]'); if (!el || !$('ogAdminRoot') || !$('ogAdminRoot').contains(el)) return;
  if (el.dataset.ogadm === 'all'){ G.showAll = !G.showAll; paint(); return; }
  if (el.dataset.ogadm === 'wa'){ G.open = G.open === el.dataset.id ? null : el.dataset.id; await loadAlerts(); paint(); return; }
  if (el.dataset.ogadm === 'kept'){
    if (!confirm('Κλείσιμο του παιχνιδιού ως έχει; Δεν θα φαίνεται πια στο «Βρες παίχτη».')) return;
    try { await updateDoc(doc(window.npFB.db, 'open_games', el.dataset.id), { status: 'kept', updatedAt: serverTimestamp() }); }
    catch(err){ alert('Αποτυχία: ' + err.message); }
  }
});
window.npAdminOG = {
  tag(id){
    const g = G.games.find(x => x.id === id); if (!g) return ' <span class="pill" style="background:rgba(74,195,255,0.15);color:#4ac3ff">👥 Ανοιχτό</span>';
    const n = count(g);
    return ` <span class="pill" style="background:rgba(74,195,255,0.15);color:#4ac3ff" title="Ανοιχτό παιχνίδι">👥 ${g.status === 'open' ? n + '/4' : (ST[g.status] || [g.status])[0]}</span>`;
  },
};
start();
