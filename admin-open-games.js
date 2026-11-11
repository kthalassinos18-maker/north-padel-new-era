/* ============ ADMIN: OPEN GAMES («Βρες παίχτη») ============
 * Live list of upcoming open games in the Κρατήσεις tab: who is in, how many
 * are missing, and which games need the organiser's keep/cancel decision
 * (6h before start). Also tags bookings that are open games.
 */
import { collection, doc, query, where, onSnapshot, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const DAYS = ['Κυρ','Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ'];
const fdate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return DAYS[new Date(y, m - 1, d).getDay()] + ' ' + pad(d) + '/' + pad(m); };
const count = (g) => Object.keys(g.players || {}).length + (+g.friends || 0);
const ST = { open: ['ΑΝΟΙΧΤΟ', 'ok'], full: ['ΓΕΜΑΤΟ 4/4', 'ok'], kept: ['ΚΡΑΤΗΘΗΚΕ', 'pend'], cancelled: ['ΑΚΥΡΩΘΗΚΕ', 'canc'] };
const G = { games: [], unsub: null, showAll: false };

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
      <td style="text-align:right">${g.status === 'open' ? `<button class="btn" data-ogadm="kept" data-id="${esc(g.id)}" title="Κλείσιμο ως έχει">📌 Κράτα</button>` : ''}</td>
    </tr>`;
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
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-ogadm]'); if (!el || !$('ogAdminRoot') || !$('ogAdminRoot').contains(el)) return;
  if (el.dataset.ogadm === 'all'){ G.showAll = !G.showAll; paint(); return; }
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
