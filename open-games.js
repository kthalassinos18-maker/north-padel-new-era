/* ============ OPEN GAMES — «Βρες παίχτη» ============
 * A member books a court with 1–3 people and ticks «Ψάχνω παίχτες». The
 * court is held for them (normal booking + /slots marker) and an
 * /open_games doc lists the seats. Other verified members join an empty
 * seat; at 4/4 everybody gets an in-site notification (+ WhatsApp to the
 * owner). From 6h before the start, if still not full, the creator decides
 * to keep the court as is or cancel it. Until then the time is shown on
 * the site as «3/4 · ψάχνουν 4ο» instead of booked.
 *
 * Firestore (see firestore.rules):
 *   open_games/{id}     public read; create by the booking member; join /
 *                       leave / decide guarded field-by-field by rules
 *   notifications/{id}  in-site notifications, readable by the recipient
 */
import {
  collection, doc, query, where, onSnapshot, runTransaction, writeBatch,
  serverTimestamp, getDocs, getDoc, addDoc, deleteDoc, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const DECIDE_H = 6;          // creator decides from 6h before start
const LEAVE_H = 24;          // members may leave until 24h before
const HOUR = 3600 * 1000;

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const lang = () => { try { return localStorage.getItem('northPadelLang') || 'el'; } catch(_) { return 'el'; } };
const t = (el, en, de) => { const l = lang(); return l === 'en' ? (en || el) : l === 'de' ? (de || en || el) : el; };
const DAYS = { el: ['Κυρ','Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ'], en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], de: ['So','Mo','Di','Mi','Do','Fr','Sa'] };
function dayShort(iso){ const [y, m, d] = iso.split('-').map(Number); return (DAYS[lang()] || DAYS.el)[new Date(y, m - 1, d).getDay()]; }
const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const startOf = (time) => (time || '').split('-')[0];
function waitFB(){ return new Promise(r => window.npFB ? r() : window.addEventListener('npFBReady', r, { once: true })); }
const db = () => window.npFB.db;
const me = () => (typeof window.currentUser === 'function' ? window.currentUser() : null);
const lv10 = (u) => (window.npLv10 ? window.npLv10(u) : (+u.level || 1));
function lvBadge(n){
  const L = window.NP_LEVELS && window.NP_LEVELS[(+n || 1) - 1];
  return (L ? L.icon + ' ' : '') + t('Επ. ', 'Lv ', 'Nv ') + n;
}
const price = () => { try { const p = window.__npPrices ? window.__npPrices().p4 : 44; return Math.round(p / 4 * 100) / 100; } catch(_) { return 11; } };
function ago(ms){
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return t('τώρα', 'now', 'jetzt');
  if (m < 60) return m + "'";
  const h = Math.round(m / 60);
  return h < 24 ? h + t(' ώρ.', 'h', ' Std.') : Math.round(h / 24) + t(' μέρ.', 'd', ' T.');
}

/* ---------- game type ---------- */
const GENDER = { any: () => t('Για όλους', 'Open to all', 'Für alle'), mixed: () => t('Μικτό', 'Mixed', 'Mixed'), men: () => t('Ανδρικό', 'Men', 'Herren'), women: () => t('Γυναικείο', 'Women', 'Damen') };
const MODE = { friendly: () => t('Φιλικό', 'Friendly', 'Freundschaftlich'), competitive: () => t('Ανταγωνιστικό', 'Competitive', 'Wettkampf') };
const SIDE_S = { right: () => t('δεξιά', 'right', 'rechts'), left: () => t('αριστερά', 'left', 'links'), both: () => t('και οι 2 πλευρές', 'both sides', 'beide') };
function typeTags(g){
  const a = [];
  if (g.gameGender && g.gameGender !== 'any') a.push((g.gameGender === 'men' ? '♂ ' : g.gameGender === 'women' ? '♀ ' : '⚥ ') + GENDER[g.gameGender]());
  if (g.gameMode) a.push((g.gameMode === 'competitive' ? '🔥 ' : '🙂 ') + MODE[g.gameMode]());
  return a;
}
function genderOk(g, u){
  if (!g.gameGender || g.gameGender === 'any' || g.gameGender === 'mixed') return true;
  return (g.gameGender === 'men' && u.gender === 'M') || (g.gameGender === 'women' && u.gender === 'F');
}
const periodOf = (time) => { const h = +(startOf(time).split(':')[0] || 0), m = +(startOf(time).split(':')[1] || 0), x = h * 60 + m;
  return x >= 450 && x < 810 ? 'morning' : x >= 810 && x < 900 ? 'noon' : x >= 900 && x < 1170 ? 'afternoon' : x >= 1170 && x < 1350 ? 'evening' : 'late'; };
const monIdx = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };

/* ---------- state ---------- */
const OG = { games: [], loaded: false, view: 'list', tab: 'open', gameId: null, notes: [], unsubGames: null, unsubNotes: null, notesUid: null, toastShown: {},
  f: { day: 'all', time: 'all', type: 'all', mine: false }, chat: [], chatFor: null, unsubChat: null };

const playerCount = (g) => Object.keys(g.players || {}).length + (+g.friends || 0);
const isIn = (g, uid) => !!(uid && g.players && g.players[uid]);
const isUpcoming = (g) => (g.startsAt || 0) > Date.now();
const needsDecision = (g) => g.status === 'open' && Date.now() >= g.startsAt - DECIDE_H * HOUR && Date.now() < g.startsAt;

/** The 4 seats in court order: [near-left, near-right, far-left, far-right]. */
function seatsOf(g){
  const s = [];
  const pl = Object.entries(g.players || {}).map(([uid, p]) => ({ uid, ...p })).sort((a, b) => (a.at || 0) - (b.at || 0));
  const creator = pl.find(p => p.uid === g.creatorUid);
  if (creator) s.push({ kind: 'member', ...creator });
  for (let i = 0; i < (+g.friends || 0); i++) s.push({ kind: 'friend', name: (g.friendNames || [])[i] || t('Φίλος', 'Friend', 'Freund') });
  pl.filter(p => p.uid !== g.creatorUid).forEach(p => s.push({ kind: 'member', ...p }));
  while (s.length < 4) s.push({ kind: 'empty' });
  return s.slice(0, 4);
}
function avgLevel(g){
  const lv = Object.values(g.players || {}).map(p => +p.level || 0).filter(Boolean);
  return lv.length ? Math.round(lv.reduce((a, b) => a + b, 0) / lv.length) : null;
}

/* ---------- live data ---------- */
async function startGames(){
  if (OG.unsubGames) return;
  await waitFB();
  OG.unsubGames = onSnapshot(query(collection(db(), 'open_games'), where('date', '>=', todayISO())), (snap) => {
    OG.games = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.startsAt || 0) - (b.startsAt || 0));
    OG.loaded = true;
    paintHeroBtn();
    window.dispatchEvent(new Event('npOGUpdate'));
    if ($('ogOv') && $('ogOv').classList.contains('open')) render();
    maybeDecisionToast();
  }, (e) => { console.warn('open games', e); OG.loaded = true; paintHeroBtn(); });
}
function watchNotes(){
  const u = me();
  const uid = u && u.uid;
  if (uid === OG.notesUid) return;
  if (OG.unsubNotes){ OG.unsubNotes(); OG.unsubNotes = null; }
  OG.notesUid = uid; OG.notes = [];
  if (!uid){ paintHeroBtn(); return; }
  OG.unsubNotes = onSnapshot(query(collection(db(), 'notifications'), where('toUid', '==', uid)), (snap) => {
    const before = new Set(OG.notes.map(n => n.id));
    OG.notes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
    paintHeroBtn();
    const fresh = OG.notes.find(n => !n.read && !before.has(n.id));
    if (fresh && before.size) toast((fresh.icon || '🔔') + ' ' + fresh.title, () => openOverlay('notes'));
    else if (!before.size){ const unread = OG.notes.filter(n => !n.read).length; if (unread) toast('🔔 ' + unread + ' ' + t('νέες ειδοποιήσεις', 'new notifications', 'neue Benachrichtigungen'), () => openOverlay('notes')); }
    if ($('ogOv') && $('ogOv').classList.contains('open')) render();
  }, (e) => console.warn('notifications', e));
}
const openGames = () => OG.games.filter(g => g.status === 'open' && isUpcoming(g));
const unreadCount = () => OG.notes.filter(n => !n.read).length;

/* ---------- hero button ---------- */
function mountHeroBtn(){
  if ($('ogBtn')) return;
  const wrap = document.querySelector('.hero'); if (!wrap) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'ogBtn'; b.className = 'og-btn';
  b.setAttribute('aria-label', t('Βρες παίχτη — ανοιχτά παιχνίδια', 'Find a player — open games', 'Spieler finden — offene Spiele'));
  wrap.appendChild(b);
  b.addEventListener('click', () => { if (navigator.vibrate) navigator.vibrate(30); openOverlay(); });
  paintHeroBtn();
}
function paintHeroBtn(){
  const b = $('ogBtn'); if (!b) return;
  const n = openGames().length, un = unreadCount();
  const g = openGames()[0];
  const filled = g ? Math.min(3, playerCount(g)) : 3;
  const dots = [0, 1, 2, 3].map(i => `<i class="${i < filled ? '' : 'e'}"></i>`).join('');
  b.innerHTML = `<span class="og-dots" aria-hidden="true">${dots}</span><span>${t('ΒΡΕΣ ΠΑΙΧΤΗ', 'FIND A PLAYER', 'SPIELER FINDEN')}</span>${n ? `<span class="og-n">${n}</span>` : ''}${un ? `<span class="og-bell">${un}</span>` : ''}`;
}

/* ---------- overlay ---------- */
function ensureOverlay(){
  if ($('ogOv')) return;
  const o = document.createElement('div');
  o.id = 'ogOv'; o.className = 'og-ov'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
  o.innerHTML = `<div class="og-top"><button class="og-back" data-og="back" hidden aria-label="Πίσω">‹</button><h2 id="ogTitle"></h2><button class="og-x" data-og="close" aria-label="Κλείσιμο">×</button></div>
    <div class="og-tabs" id="ogTabs"></div><div class="og-body"><div class="og-wrap" id="ogBody"></div></div>`;
  document.body.appendChild(o);
}
function openOverlay(tab, gameId){
  ensureOverlay(); watchNotes();
  if (tab) OG.tab = tab;
  OG.view = gameId ? 'game' : 'list'; OG.gameId = gameId || null;
  render();
  requestAnimationFrame(() => $('ogOv').classList.add('open'));
  document.body.style.overflow = 'hidden';
  if (OG.tab === 'notes') markNotesRead();
}
function closeOverlay(){
  const o = $('ogOv'); if (!o) return;
  if (OG.unsubChat){ OG.unsubChat(); OG.unsubChat = null; OG.chatFor = null; }
  o.classList.remove('open'); document.body.style.overflow = '';
  if (location.hash.startsWith('#og=')) history.replaceState(null, '', location.pathname + location.search);
}

function render(){
  if (!$('ogBody')) return;
  const u = me();
  $('ogTitle').textContent = OG.view === 'game' ? t('ΑΝΟΙΧΤΟ ΠΑΙΧΝΙΔΙ', 'OPEN GAME', 'OFFENES SPIEL') : t('ΒΡΕΣ ΠΑΙΧΤΗ', 'FIND A PLAYER', 'SPIELER FINDEN');
  document.querySelector('#ogOv [data-og="back"]').hidden = OG.view !== 'game';
  const mine = u ? OG.games.filter(g => isIn(g, u.uid) && isUpcoming(g) && g.status !== 'cancelled') : [];
  const un = unreadCount();
  $('ogTabs').style.display = OG.view === 'game' ? 'none' : '';
  $('ogTabs').innerHTML = `
    <button class="og-tab ${OG.tab === 'open' ? 'on' : ''}" data-og="tab" data-t="open">🎾 ${t('Ανοιχτά', 'Open', 'Offen')} (${openGames().length})</button>
    <button class="og-tab ${OG.tab === 'mine' ? 'on' : ''}" data-og="tab" data-t="mine">👤 ${t('Τα δικά μου', 'Mine', 'Meine')}${mine.length ? ' (' + mine.length + ')' : ''}</button>
    <button class="og-tab ${OG.tab === 'notes' ? 'on' : ''}" data-og="tab" data-t="notes">🔔 ${t('Ειδοποιήσεις', 'Notifications', 'Hinweise')}${un ? `<span class="dot">${un}</span>` : ''}</button>`;
  let html = '';
  if (OG.view === 'game') html = viewGame();
  else if (OG.tab === 'mine') html = viewMine(mine);
  else if (OG.tab === 'notes') html = viewNotes();
  else html = viewOpen();
  $('ogBody').innerHTML = html;
  afterRender();
}
function afterRender(){
  // Photos on the court
  if (window.npAvatar) document.querySelectorAll('#ogBody .og-seat[data-uid]').forEach(el => {
    window.npAvatar(el.dataset.uid).then(ph => { const av = el.querySelector('.av'); if (ph && av){ av.style.background = `url('${ph}') center/cover`; av.textContent = ''; } });
  });
  // Chat (players only)
  const wantChat = OG.view === 'game' && $('ogChatList') ? OG.gameId : null;
  if (wantChat !== OG.chatFor){
    if (OG.unsubChat){ OG.unsubChat(); OG.unsubChat = null; }
    OG.chatFor = wantChat; OG.chat = [];
    if (wantChat) OG.unsubChat = onSnapshot(query(collection(db(), 'open_games', wantChat, 'chat'), orderBy('at'), limit(200)), (snap) => {
      OG.chat = snap.docs.map(d => ({ id: d.id, ...d.data() })); paintChat();
    }, (e) => { const l = $('ogChatList'); if (l) l.innerHTML = `<div class="og-note">${t('Το chat είναι μόνο για τους παίχτες του παιχνιδιού.', 'The chat is for this game’s players only.', 'Der Chat ist nur für die Spieler.')}</div>`; console.warn('chat', e); });
  } else paintChat();
}
function paintChat(){
  const l = $('ogChatList'); if (!l) return;
  const uid = me() && me().uid;
  l.innerHTML = OG.chat.length ? OG.chat.map(m => `<div class="og-msg ${m.uid === uid ? 'mine' : ''}"><b>${esc(m.uid === uid ? t('Εσύ', 'You', 'Du') : m.name)}</b>${esc(m.text)}<small>${esc(ago(m.at || Date.now()))}</small></div>`).join('')
    : `<div class="og-note" style="text-align:center">${t('Γράψτε εδώ για να κανονίσετε λεπτομέρειες (μπαλάκια, ποιος φέρνει τι...).', 'Write here to sort out the details (balls, who brings what...).', 'Hier Details absprechen (Bälle, wer bringt was...).')}</div>`;
  l.scrollTop = l.scrollHeight;
}
async function sendChat(text){
  const u = me(); if (!u || !OG.gameId || !text.trim()) return;
  try { await addDoc(collection(db(), 'open_games', OG.gameId, 'chat'), { uid: u.uid, name: ((u.name || '').trim() || 'Player').slice(0, 40), text: text.trim().slice(0, 500), at: Date.now(), createdAt: serverTimestamp() }); }
  catch(e){ alert(t('Δεν στάλθηκε', 'Not sent', 'Nicht gesendet') + ': ' + e.message); }
}
function shareGame(){
  const g = OG.games.find(x => x.id === OG.gameId); if (!g) return;
  const need = 4 - playerCount(g);
  const url = location.origin + '/#og=' + g.id;
  const txt = '🎾 ' + t('Ψάχνουμε', 'We need', 'Wir suchen') + ' ' + need + ' ' + (need === 1 ? t('παίχτη', 'player', 'Spieler') : t('παίχτες', 'players', 'Spieler')) + ' ' + t('για padel!', 'for padel!', 'für Padel!') + '\n📅 ' + whenTxt(g) + ' · North Padel\n🎯 ' + t('Επίπεδο', 'Level', 'Niveau') + ' ' + g.levelMin + '–' + g.levelMax + (typeTags(g).length ? ' · ' + typeTags(g).join(' · ') : '') + '\n👉 ' + url;
  if (navigator.share){ navigator.share({ text: txt }).catch(() => {}); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
}
document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-og-chat]')) return;
  e.preventDefault();
  const i = $('ogChatIn'); const v = i.value; i.value = ''; sendChat(v);
});

function card(g){
  const n = playerCount(g), need = 4 - n;
  const dots = [0, 1, 2, 3].map(i => `<i class="${i < n ? '' : 'e'}"></i>`).join('');
  const st = g.status === 'open'
    ? `<div class="need">${need === 1 ? t('ψάχνουν 4ο', 'need 1 more', 'suchen 1') : t('ψάχνουν ', 'need ', 'suchen ') + need}</div>`
    : `<span class="og-status ${g.status}">${statusLabel(g.status)}</span>`;
  return `<button class="og-card" data-og="game" data-id="${esc(g.id)}">
      <div class="when"><small>${esc(dayShort(g.date))} ${esc(dm(g.date))}</small><b>${esc(startOf(g.time))}</b></div>
      <div class="mid"><div class="t">${n}/4 · ${t('Επίπεδο', 'Level', 'Niveau')} ${g.levelMin}–${g.levelMax}</div>
        <div class="s">${esc(g.creatorName || '')}${avgLevel(g) ? ' · ' + t('μ.ό. ', 'avg ', 'Ø ') + avgLevel(g) : ''} · ${esc(g.court || '')}</div>
        ${typeTags(g).length ? `<div class="og-tags">${typeTags(g).map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        <span class="og-mini">${dots}</span></div>
      ${st}
    </button>`;
}
function statusLabel(s){
  return s === 'full' ? t('ΓΕΜΑΤΟ', 'FULL', 'VOLL') : s === 'kept' ? t('ΚΡΑΤΗΘΗΚΕ', 'KEPT', 'BEHALTEN') : s === 'cancelled' ? t('ΑΚΥΡΩΘΗΚΕ', 'CANCELLED', 'STORNIERT') : t('ΑΝΟΙΧΤΟ', 'OPEN', 'OFFEN');
}
function passFilter(g){
  const F = OG.f, today = todayISO();
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const tomorrow = tm.getFullYear() + '-' + pad(tm.getMonth() + 1) + '-' + pad(tm.getDate());
  if (F.day === 'today' && g.date !== today) return false;
  if (F.day === 'tomorrow' && g.date !== tomorrow) return false;
  if (F.day === 'weekend' && monIdx(g.date) < 5) return false;
  const p = periodOf(g.time);
  if (F.time === 'morning' && !(p === 'morning' || p === 'noon')) return false;
  if (F.time === 'afternoon' && p !== 'afternoon') return false;
  if (F.time === 'evening' && !(p === 'evening' || p === 'late')) return false;
  if (F.type !== 'all' && (g.gameGender || 'any') !== F.type && !(F.type === 'mixed' && (g.gameGender || 'any') === 'any')) return false;
  if (F.mine){ const u = me(); if (u){ const lv = lv10(u); if (lv < g.levelMin || lv > g.levelMax || !genderOk(g, u)) return false; } }
  return true;
}
function filtersHtml(){
  const F = OG.f;
  const chip = (k, v, l) => `<button class="og-fchip ${F[k] === v ? 'on' : ''}" data-og="f" data-k="${k}" data-v="${v}">${l}</button>`;
  return `<div class="og-filters">
    <div class="og-frow">${chip('day', 'all', t('Όλες οι μέρες', 'Any day', 'Alle Tage'))}${chip('day', 'today', t('Σήμερα', 'Today', 'Heute'))}${chip('day', 'tomorrow', t('Αύριο', 'Tomorrow', 'Morgen'))}${chip('day', 'weekend', t('Σαββατοκύριακο', 'Weekend', 'Wochenende'))}</div>
    <div class="og-frow">${chip('time', 'all', t('Κάθε ώρα', 'Any time', 'Jederzeit'))}${chip('time', 'morning', '☀️ ' + t('Πρωί', 'Morning', 'Morgens'))}${chip('time', 'afternoon', '🌤️ ' + t('Απόγευμα', 'Afternoon', 'Nachmittags'))}${chip('time', 'evening', '🌙 ' + t('Βράδυ', 'Evening', 'Abends'))}</div>
    <div class="og-frow">${chip('type', 'all', t('Όλα', 'All', 'Alle'))}${chip('type', 'men', '♂ ' + GENDER.men())}${chip('type', 'women', '♀ ' + GENDER.women())}${chip('type', 'mixed', '⚥ ' + GENDER.mixed())}
      ${me() ? `<button class="og-fchip ${F.mine ? 'on' : ''}" data-og="fmine">🎯 ${t('Για εμένα', 'For me', 'Für mich')}</button>` : ''}</div>
  </div>`;
}
function viewOpen(){
  if (!OG.loaded) return `<div class="og-empty">${t('Φόρτωση...', 'Loading...', 'Laden...')}</div>`;
  const all = openGames();
  if (all.length){
    const list = all.filter(passFilter);
    return `<p class="og-note" style="margin:0 0 10px">${t('Παιχνίδια που ψάχνουν παίχτη. Πάτα ένα και πάρε μια άδεια θέση στο γήπεδο.', 'Games looking for players. Tap one and take a free spot on the court.', 'Spiele, die Mitspieler suchen. Tippe eins an und nimm einen freien Platz.')}</p>`
      + filtersHtml()
      + (list.length ? '<div class="og-list">' + list.map(card).join('') + '</div>' : `<div class="og-empty">${t('Κανένα παιχνίδι με αυτά τα φίλτρα.', 'No games match these filters.', 'Keine Spiele mit diesen Filtern.')}</div>`);
  }
  const list = all;
  const intro = `<p class="og-note" style="margin:0 0 12px">${t('Παιχνίδια που ψάχνουν παίχτη. Πάτα ένα και πάρε μια άδεια θέση στο γήπεδο.', 'Games looking for players. Tap one and take a free spot on the court.', 'Spiele, die Mitspieler suchen. Tippe eins an und nimm einen freien Platz.')}</p>`;
  if (!list.length) return `<div class="og-empty">🎾<br><b>${t('Κανένα ανοιχτό παιχνίδι αυτή τη στιγμή.', 'No open games right now.', 'Gerade keine offenen Spiele.')}</b><br>${t('Είστε λιγότεροι από 4; Κλείσε γήπεδο και τσέκαρε «Ψάχνω παίχτες» — θα εμφανιστεί εδώ.', 'Fewer than 4? Book a court and tick “Looking for players” — it will show up here.', 'Weniger als 4? Buche einen Platz und wähle „Suche Mitspieler“ — es erscheint hier.')}<br><button class="og-main" data-og="book">${t('ΚΛΕΙΣΕ ΓΗΠΕΔΟ', 'BOOK A COURT', 'PLATZ BUCHEN')}</button></div>`;
  return intro + '<div class="og-list">' + list.map(card).join('') + '</div>';
}
function viewMine(mine){
  const u = me();
  if (!u) return `<div class="og-empty">${t('Συνδέσου για να βλέπεις τα παιχνίδια σου.', 'Log in to see your games.', 'Melde dich an, um deine Spiele zu sehen.')}<br><button class="og-main" data-og="login">${t('ΣΥΝΔΕΣΗ', 'LOG IN', 'ANMELDEN')}</button></div>`;
  if (!mine.length) return `<div class="og-empty">${t('Δεν είσαι σε κάποιο ανοιχτό παιχνίδι.', 'You are not in any open game.', 'Du bist in keinem offenen Spiel.')}</div>`;
  return mine.map(g => (g.creatorUid === u.uid && needsDecision(g) ? decideBanner(g) : '')).join('') + '<div class="og-list">' + mine.map(card).join('') + '</div>';
}
function decideBanner(g){
  return `<div class="og-decide">⏰ <b>${t('Χρειάζεται απόφαση', 'Decision needed', 'Entscheidung nötig')}</b> — ${esc(dayShort(g.date))} ${esc(dm(g.date))} ${esc(startOf(g.time))}: ${playerCount(g)}/4.
      ${t('Δεν βρέθηκαν ακόμα όλοι. Κρατάς το γήπεδο όπως είναι ή το ακυρώνεις;', 'Not everyone has been found yet. Keep the court as it is, or cancel?', 'Noch nicht alle gefunden. Platz so behalten oder stornieren?')}
      <div class="row"><button class="og-main" style="margin:0" data-og="keep" data-id="${esc(g.id)}">${t('ΤΟ ΚΡΑΤΑΩ', 'KEEP IT', 'BEHALTEN')}</button><button class="og-sec og-danger" data-og="cancel" data-id="${esc(g.id)}">${t('Ακύρωση', 'Cancel', 'Stornieren')}</button></div></div>`;
}
function viewNotes(){
  const u = me();
  if (!u) return `<div class="og-empty">${t('Συνδέσου για να βλέπεις τις ειδοποιήσεις σου.', 'Log in to see your notifications.', 'Melde dich an, um deine Hinweise zu sehen.')}<br><button class="og-main" data-og="login">${t('ΣΥΝΔΕΣΗ', 'LOG IN', 'ANMELDEN')}</button></div>`;
  if (!OG.notes.length) return `<div class="og-empty">${t('Καμία ειδοποίηση.', 'No notifications.', 'Keine Hinweise.')}</div>`;
  return OG.notes.map(n => `<button class="og-nt ${n.read ? '' : 'unread'}" data-og="note" data-id="${esc(n.gameId || '')}">
      <span class="ic">${esc(n.icon || '🔔')}</span>
      <span class="tx"><b>${esc(n.title)}</b><span>${esc(n.text)}</span><small>${esc(ago(n.createdMs || Date.now()))}</small></span></button>`).join('');
}

/* ---------- the panoramic court ---------- */
const SEAT_POS = [ // [x, y, scale] in the 360×300 court drawing
  [113, 252, 1], [247, 252, 1], [138, 128, 0.82], [222, 128, 0.82],
];
function courtSvg(){
  const xl = (y) => 105 - 90 * ((y - 70) / 215), xr = (y) => 360 - xl(y);
  const yN = 152, yS1 = 98, yS2 = 222;
  const line = (y) => `<line x1="${xl(y)}" y1="${y}" x2="${xr(y)}" y2="${y}" stroke="#fff" stroke-opacity=".85" stroke-width="${y > 150 ? 2 : 1.4}"/>`;
  let mesh = '';
  for (let x = 110; x < 255; x += 10) mesh += `<line x1="${x}" y1="10" x2="${x}" y2="34" stroke="#cfe3ff" stroke-opacity=".18"/>`;
  for (let y = 12; y < 34; y += 6) mesh += `<line x1="105" y1="${y}" x2="255" y2="${y}" stroke="#cfe3ff" stroke-opacity=".18"/>`;
  return `<svg viewBox="0 0 360 300" aria-hidden="true" class="og-in">
    <defs>
      <linearGradient id="ogFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a4fb8"/><stop offset="1" stop-color="#2c6be6"/></linearGradient>
      <linearGradient id="ogGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3ff" stop-opacity=".22"/><stop offset="1" stop-color="#bfe3ff" stop-opacity=".06"/></linearGradient>
      <radialGradient id="ogLight" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe0" stop-opacity=".9"/><stop offset="1" stop-color="#fffbe0" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="70" cy="18" r="34" fill="url(#ogLight)"/><circle cx="290" cy="18" r="34" fill="url(#ogLight)"/>
    <line x1="70" y1="18" x2="70" y2="120" stroke="#2a3b52" stroke-width="3"/><line x1="290" y1="18" x2="290" y2="120" stroke="#2a3b52" stroke-width="3"/>
    ${mesh}
    <polygon points="105,34 255,34 255,70 105,70" fill="url(#ogGlass)" stroke="#d8ecff" stroke-opacity=".35"/>
    <polygon points="105,34 105,70 15,285 15,205" fill="url(#ogGlass)" stroke="#d8ecff" stroke-opacity=".3"/>
    <polygon points="255,34 255,70 345,285 345,205" fill="url(#ogGlass)" stroke="#d8ecff" stroke-opacity=".3"/>
    <polygon points="105,70 255,70 345,285 15,285" fill="url(#ogFloor)"/>
    <polygon points="105,70 255,70 345,285 15,285" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2"/>
    ${line(yS1)}${line(yS2)}
    <line x1="180" y1="${yS1}" x2="180" y2="${yS2}" stroke="#fff" stroke-opacity=".85" stroke-width="1.6"/>
    <polygon points="${xl(yN)},${yN} ${xr(yN)},${yN} ${xr(yN)},${yN - 15} ${xl(yN)},${yN - 15}" fill="#0b1626" fill-opacity=".55"/>
    <line x1="${xl(yN)}" y1="${yN - 15}" x2="${xr(yN)}" y2="${yN - 15}" stroke="#fff" stroke-width="2.4"/>
    <line x1="${xl(yN)}" y1="${yN}" x2="${xl(yN)}" y2="${yN - 17}" stroke="#d8ecff" stroke-width="2"/><line x1="${xr(yN)}" y1="${yN}" x2="${xr(yN)}" y2="${yN - 17}" stroke="#d8ecff" stroke-width="2"/>
    <text x="180" y="${yN - 4}" text-anchor="middle" font-family="Oswald,sans-serif" font-size="7" letter-spacing="2" fill="#b7ff4a">NORTH PADEL</text>
  </svg>`;
}
function viewGame(){
  const g = OG.games.find(x => x.id === OG.gameId);
  if (!g) return `<div class="og-empty">${t('Το παιχνίδι δεν βρέθηκε ή έχει λήξει.', 'This game was not found or has ended.', 'Spiel nicht gefunden oder beendet.')}</div>`;
  const u = me(), uid = u && u.uid;
  const seats = seatsOf(g), n = playerCount(g);
  const inGame = isIn(g, uid), creator = uid && uid === g.creatorUid;
  const ulv = u ? lv10(u) : null;
  const fitsLevel = !u || (ulv >= g.levelMin && ulv <= g.levelMax);
  const fitsGender = !u || genderOk(g, u);
  const canJoin = g.status === 'open' && isUpcoming(g) && !inGame && n < 4;
  const seatHtml = seats.map((s, i) => {
    const [x, y, k] = SEAT_POS[i];
    const style = `left:${x / 3.6}%;top:${y / 3}%;--k:${k};--dl:${0.15 + i * 0.08}s`;
    if (s.kind === 'empty'){
      return `<button class="og-seat empty" style="${style}" data-og="join" ${canJoin ? '' : 'disabled'} aria-label="${t('Άδεια θέση — μπες', 'Free spot — join', 'Freier Platz — mitspielen')}"><span class="av">＋</span><span class="nm">${canJoin ? t('ΜΠΕΣ', 'JOIN', 'MITSPIELEN') : t('Άδεια', 'Free', 'Frei')}</span></button>`;
    }
    const nm = s.kind === 'friend' ? s.name : (s.name || '').split(' ')[0];
    return `<div class="og-seat ${s.kind === 'friend' ? 'friend' : ''} ${s.uid && s.uid === uid ? 'me' : ''}" style="${style}" ${s.uid ? `data-uid="${esc(s.uid)}"` : ''}>
        <span class="av">${esc((nm || '?').charAt(0).toUpperCase())}</span><span class="nm">${esc(nm)}${s.uid === g.creatorUid ? ' 👑' : ''}</span>
        ${s.level ? `<span class="lv">${esc(lvBadge(s.level))}${s.side && SIDE_S[s.side] ? ' · ' + esc(SIDE_S[s.side]()) : ''}</span>` : s.kind === 'friend' ? `<span class="lv" style="color:rgba(244,249,255,0.6)">${t('παρέα', 'with', 'dabei')}</span>` : ''}
      </div>`;
  }).join('');
  let acts = '';
  if (g.status === 'full') acts += `<div class="og-full-banner">✅ ${t('Η τετράδα έκλεισε! Τα λέμε στο γήπεδο.', 'The four is complete! See you on court.', 'Die Vierer-Runde steht! Bis auf dem Platz.')}</div>`;
  if (g.status === 'kept') acts += `<div class="og-full-banner">${t('Το γήπεδο κρατήθηκε με', 'Court kept with', 'Platz behalten mit')} ${n} ${t('παίχτες.', 'players.', 'Spielern.')}</div>`;
  if (g.status === 'cancelled') acts += `<div class="og-full-banner" style="border-color:rgba(255,107,107,0.5);background:rgba(255,107,107,0.08)">${t('Το παιχνίδι ακυρώθηκε.', 'This game was cancelled.', 'Dieses Spiel wurde storniert.')}</div>`;
  if (creator && needsDecision(g)) acts += decideBanner(g);
  if (canJoin){
    if (!u) acts += `<button class="og-main" data-og="login">${t('ΣΥΝΔΕΣΟΥ ΓΙΑ ΝΑ ΜΠΕΙΣ', 'LOG IN TO JOIN', 'ZUM MITSPIELEN ANMELDEN')}</button>`;
    else if (!fitsLevel) acts += `<p class="og-note" style="text-align:center">${t('Το παιχνίδι είναι για επίπεδο', 'This game is for level', 'Dieses Spiel ist für Niveau')} ${g.levelMin}–${g.levelMax} · ${t('το δικό σου είναι', 'yours is', 'deins ist')} ${ulv}.</p>`;
    else if (!fitsGender) acts += `<p class="og-note" style="text-align:center">${t('Το παιχνίδι είναι', 'This game is', 'Dieses Spiel ist')} ${esc(GENDER[g.gameGender]().toLowerCase())}.${u.gender ? '' : ' ' + t('Συμπλήρωσε το φύλο σου στο προφίλ.', 'Set your gender in your profile.', 'Geschlecht im Profil angeben.')}</p>`;
    else acts += `<button class="og-main" data-og="join">${t('ΜΠΑΙΝΩ ΣΤΟ ΠΑΙΧΝΙΔΙ', 'I’M IN', 'ICH SPIELE MIT')}</button>`;
  }
  if (inGame && !creator && (g.status === 'open' || g.status === 'full') && Date.now() < g.startsAt - LEAVE_H * HOUR){
    acts += `<button class="og-sec" data-og="leave">${t('Αποχώρηση από το παιχνίδι', 'Leave this game', 'Spiel verlassen')}</button>`;
  }
  if (creator && g.status === 'open' && !needsDecision(g)){
    acts += `<button class="og-sec" data-og="keep" data-id="${esc(g.id)}">${t('Βρήκα παρέα — κλείσε το όπως είναι', 'Found players — close it as is', 'Mitspieler gefunden — so schließen')}</button>
      <button class="og-sec og-danger" data-og="cancel" data-id="${esc(g.id)}">${t('Ακύρωση παιχνιδιού και κράτησης', 'Cancel game and booking', 'Spiel und Buchung stornieren')}</button>`;
  }
  return `
    <div class="og-head"><div class="d">${esc(dayShort(g.date))} ${esc(dm(g.date))} · ${esc((g.time || '').replace('-', ' – '))}</div>
      <div class="i">${esc(g.court || '')} · ${t('Επίπεδο', 'Level', 'Niveau')} ${g.levelMin}–${g.levelMax}${g.note ? ' · ' + esc(g.note) : ''}</div>
      ${typeTags(g).length ? `<div class="og-tags" style="justify-content:center;margin-top:8px">${typeTags(g).map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div>
    <div class="og-stage">${courtSvg()}${seatHtml}</div>
    <div class="og-facts">
      <div class="og-fact"><b>${n}/4</b><small>${t('ΠΑΙΧΤΕΣ', 'PLAYERS', 'SPIELER')}</small></div>
      <div class="og-fact"><b>${avgLevel(g) || '—'}</b><small>${t('ΜΕΣΟ ΕΠΙΠΕΔΟ', 'AVG LEVEL', 'Ø NIVEAU')}</small></div>
      <div class="og-fact"><b>${price()}€</b><small>${t('Ο ΚΑΘΕΝΑΣ', 'EACH', 'PRO PERSON')}</small></div>
    </div>
    <div class="og-acts">${acts}${g.status === 'open' && isUpcoming(g) ? `<button class="og-sec og-wa" data-og="share">📤 ${t('Στείλε σε φίλους (WhatsApp)', 'Send to friends (WhatsApp)', 'An Freunde senden (WhatsApp)')}</button>` : ''}</div>
    ${inGame || (window.npFB && u && window.npFB.isAdmin && window.npFB.isAdmin(u)) ? `<div class="og-chat"><div class="og-chat-h">💬 ${t('ΣΥΖΗΤΗΣΗ ΠΑΙΧΤΩΝ', 'PLAYERS CHAT', 'SPIELER-CHAT')}</div><div class="og-chat-list" id="ogChatList"><div class="og-note">${t('Φόρτωση...', 'Loading...', 'Laden...')}</div></div>
      <form class="og-chat-in" data-og-chat><input id="ogChatIn" maxlength="500" autocomplete="off" placeholder="${t('Γράψε στους παίχτες...', 'Write to the players...', 'Schreib den Spielern...')}"><button type="submit">➤</button></form></div>` : ''}
    <p class="og-note">${t('Πληρωμή στο γήπεδο. Μόλις συμπληρωθούν 4, ειδοποιούνται όλοι. Αποχώρηση έως 24 ώρες πριν.', 'Pay at the court. Everyone is notified when the game is full. You can leave up to 24h before.', 'Bezahlung am Platz. Alle werden benachrichtigt, sobald 4 Spieler da sind. Austritt bis 24 Std. vorher.')}</p>`;
}

/* ---------- actions ---------- */
// Notifications written by an action are also pushed to the recipients' phones.
let PENDING = [];
function nref(){ const r = doc(collection(db(), 'notifications')); PENDING.push(r.id); return r; }
function flushPush(){ const ids = PENDING; PENDING = []; if (window.npPush) window.npPush.send(ids); }
function note(toUid, g, icon, title, text, type){
  return { toUid, fromUid: me().uid, gameId: g.id, type, icon, title, text, read: false, createdMs: Date.now(), createdAt: serverTimestamp() };
}
const whenTxt = (g) => dayShort(g.date) + ' ' + dm(g.date) + ' ' + startOf(g.time);
function requireMember(){
  const u = me();
  if (!u){ closeOverlay(); setTimeout(() => $('playerBtn') && $('playerBtn').click(), 250); return null; }
  if (!u.emailVerified){ alert(t('Πρέπει πρώτα να επιβεβαιώσεις το email σου (δες το προφίλ σου).', 'Please verify your email first (see your profile).', 'Bitte bestätige zuerst deine E-Mail (siehe Profil).')); return null; }
  return u;
}
async function join(){
  const u = requireMember(); if (!u) return;
  const g0 = OG.games.find(x => x.id === OG.gameId); if (!g0) return;
  const lv = lv10(u);
  if (lv < g0.levelMin || lv > g0.levelMax){ alert(t('Το επίπεδό σου δεν ταιριάζει σε αυτό το παιχνίδι.', 'Your level does not match this game.', 'Dein Niveau passt nicht zu diesem Spiel.')); return; }
  if (!genderOk(g0, u)){
    alert(!u.gender ? t('Αυτό το παιχνίδι είναι ' + GENDER[g0.gameGender]().toLowerCase() + '. Συμπλήρωσε το φύλο σου στο προφίλ σου.', 'This is a ' + GENDER[g0.gameGender]().toLowerCase() + ' game. Please set your gender in your profile.', 'Dies ist ein ' + GENDER[g0.gameGender]() + '-Spiel. Bitte Geschlecht im Profil angeben.')
      : t('Αυτό το παιχνίδι είναι ' + GENDER[g0.gameGender]().toLowerCase() + '.', 'This is a ' + GENDER[g0.gameGender]().toLowerCase() + ' game.', 'Dies ist ein ' + GENDER[g0.gameGender]() + '-Spiel.'));
    return;
  }
  if (!confirm(t('Μπαίνεις στο παιχνίδι', 'Join the game on', 'Am Spiel teilnehmen am') + ' ' + whenTxt(g0) + '?\n' + t('Πληρωμή στο γήπεδο', 'Pay at the court', 'Bezahlung am Platz') + ': ' + price() + '€.')) return;
  const ref = doc(db(), 'open_games', g0.id);
  let becameFull = false, gAfter = null;
  PENDING = [];
  try {
    await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(t('Το παιχνίδι δεν υπάρχει πια.', 'The game no longer exists.', 'Das Spiel existiert nicht mehr.'));
      const g = { id: snap.id, ...snap.data() };
      if (g.status !== 'open') throw new Error(t('Το παιχνίδι δεν είναι πια ανοιχτό.', 'The game is no longer open.', 'Das Spiel ist nicht mehr offen.'));
      if (isIn(g, u.uid)) throw new Error(t('Είσαι ήδη μέσα.', 'You are already in.', 'Du bist schon dabei.'));
      const count = playerCount(g) + 1;
      if (count > 4) throw new Error(t('Δεν υπάρχει άδεια θέση.', 'No free spot.', 'Kein freier Platz.'));
      const players = { ...g.players, [u.uid]: { name: (u.name || '').trim() || t('Παίχτης', 'Player', 'Spieler'), level: lv, at: Date.now(), ...(u.side ? { side: u.side } : {}) } };
      becameFull = count === 4;
      tx.update(ref, { players, count, status: becameFull ? 'full' : 'open', updatedAt: serverTimestamp() });
      gAfter = { ...g, players, count };
      const others = Object.keys(g.players || {});
      const who = (u.name || '').trim() || t('Ένας παίχτης', 'A player', 'Ein Spieler');
      if (becameFull){
        others.forEach(id => tx.set(nref(), note(id, g, '✅',
          t('Η τετράδα έκλεισε!', 'Your four is complete!', 'Eure Vierer-Runde steht!'),
          whenTxt(g) + ' · ' + (g.court || '') + ' — ' + who + t(' συμπλήρωσε το παιχνίδι. Τα λέμε στο γήπεδο!', ' completed the game. See you on court!', ' hat das Spiel vervollständigt. Bis auf dem Platz!'), 'full')));
      } else if (g.creatorUid && g.creatorUid !== u.uid){
        tx.set(nref(), note(g.creatorUid, g, '👋',
          who + t(' μπήκε στο παιχνίδι σου', ' joined your game', ' ist deinem Spiel beigetreten'),
          whenTxt(g) + ' · ' + count + '/4 · ' + t('ψάχνετε ακόμα ', 'still need ', 'noch gesucht: ') + (4 - count), 'join'));
      }
    });
  } catch(e){
    alert(t('Δεν έγινε', 'Could not join', 'Nicht möglich') + ': ' + (e.code === 'permission-denied' ? t('δεν επιτρέπεται (μήπως έκλεισε στο μεταξύ;)', 'not allowed (was it filled meanwhile?)', 'nicht erlaubt (inzwischen voll?)') : e.message));
    return;
  }
  flushPush();
  if (window.npPush) window.npPush.suggest();
  if (becameFull){
    const names = seatsOf(gAfter).map(s => s.name).join(', ');
    try { window.npFB.notifyAdminWhatsApp('✅ Ανοιχτό παιχνίδι ΓΕΜΙΣΕ (4/4)\n📅 ' + gAfter.date + ' · ' + gAfter.time + '\n🏟️ ' + (gAfter.court || '') + '\n👥 ' + names); } catch(_) {}
    toast('✅ ' + t('Η τετράδα έκλεισε! Ειδοποιήθηκαν όλοι.', 'The four is complete! Everyone was notified.', 'Die Runde steht! Alle wurden benachrichtigt.'));
  } else toast('🎾 ' + t('Μπήκες στο παιχνίδι!', 'You joined the game!', 'Du bist dabei!'));
}
async function leave(){
  const u = me(); const g0 = OG.games.find(x => x.id === OG.gameId); if (!u || !g0) return;
  if (!confirm(t('Σίγουρα αποχωρείς από το παιχνίδι;', 'Leave this game?', 'Spiel wirklich verlassen?'))) return;
  const ref = doc(db(), 'open_games', g0.id);
  PENDING = [];
  try {
    await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref); const g = { id: snap.id, ...snap.data() };
      if (!isIn(g, u.uid)) return;
      const players = { ...g.players }; delete players[u.uid];
      tx.update(ref, { players, count: playerCount(g) - 1, status: 'open', updatedAt: serverTimestamp() });
      if (g.creatorUid && g.creatorUid !== u.uid){
        tx.set(nref(), note(g.creatorUid, g, '↩️',
          ((u.name || '').trim() || t('Ένας παίχτης', 'A player', 'Ein Spieler')) + t(' αποχώρησε', ' left your game', ' hat das Spiel verlassen'),
          whenTxt(g) + ' · ' + t('το παιχνίδι ξαναψάχνει παίχτη.', 'the game is looking for a player again.', 'das Spiel sucht wieder Mitspieler.'), 'leave'));
      }
    });
    flushPush();
    toast(t('Αποχώρησες από το παιχνίδι.', 'You left the game.', 'Du hast das Spiel verlassen.'));
  } catch(e){ alert(t('Δεν έγινε', 'Failed', 'Fehlgeschlagen') + ': ' + e.message); }
}
async function keep(id){
  const g = OG.games.find(x => x.id === id); if (!g) return;
  if (!confirm(t('Το γήπεδο μένει κλεισμένο με', 'The court stays booked with', 'Der Platz bleibt gebucht mit') + ' ' + playerCount(g) + ' ' + t('άτομα και η κράτηση ισχύει κανονικά (44€ για το γήπεδο). Συνέχεια;', 'people and the booking stands as normal. Continue?', 'Personen und die Buchung gilt normal. Weiter?'))) return;
  PENDING = [];
  try {
    const b = writeBatch(db());
    b.update(doc(db(), 'open_games', id), { status: 'kept', updatedAt: serverTimestamp() });
    Object.keys(g.players || {}).filter(x => x !== me().uid).forEach(x => b.set(nref(), note(x, g, '📌',
      t('Το παιχνίδι κρατήθηκε', 'The game was kept', 'Das Spiel wurde behalten'), whenTxt(g) + ' · ' + playerCount(g) + '/4 — ' + t('παίζετε κανονικά.', 'you play as planned.', 'ihr spielt wie geplant.'), 'kept')));
    await b.commit();
    flushPush();
    try { window.npFB.notifyAdminWhatsApp('📌 Ανοιχτό παιχνίδι: ΚΡΑΤΗΘΗΚΕ με ' + playerCount(g) + ' άτομα\n📅 ' + g.date + ' · ' + g.time + '\n👤 ' + (g.creatorName || '')); } catch(_) {}
    toast('📌 ' + t('Το γήπεδο κρατήθηκε.', 'Court kept.', 'Platz behalten.'));
  } catch(e){ alert(t('Δεν έγινε', 'Failed', 'Fehlgeschlagen') + ': ' + e.message); }
}
async function cancelGame(id){
  const g = OG.games.find(x => x.id === id); if (!g) return;
  if (!confirm(t('Ακύρωση του παιχνιδιού και της κράτησης; Το γήπεδο θα ελευθερωθεί και θα ενημερωθούν οι υπόλοιποι.', 'Cancel the game and the booking? The court will be freed and the others notified.', 'Spiel und Buchung stornieren? Der Platz wird frei und die anderen werden benachrichtigt.'))) return;
  PENDING = [];
  try {
    const b = writeBatch(db());
    b.update(doc(db(), 'open_games', id), { status: 'cancelled', updatedAt: serverTimestamp() });
    if (g.bookingId) b.update(doc(db(), 'bookings', g.bookingId), { status: 'cancelled', cancelledAt: serverTimestamp() });
    if (g.slotId) b.delete(doc(db(), 'slots', g.slotId));
    Object.keys(g.players || {}).filter(x => x !== me().uid).forEach(x => b.set(nref(), note(x, g, '❌',
      t('Το παιχνίδι ακυρώθηκε', 'The game was cancelled', 'Das Spiel wurde storniert'), whenTxt(g) + ' · ' + t('ο διοργανωτής το ακύρωσε.', 'the organiser cancelled it.', 'der Organisator hat storniert.'), 'cancelled')));
    await b.commit();
    flushPush();
    try { window.npFB.notifyAdminWhatsApp('❌ Ανοιχτό παιχνίδι ΑΚΥΡΩΘΗΚΕ από τον διοργανωτή\n📅 ' + g.date + ' · ' + g.time + '\n👤 ' + (g.creatorName || '') + '\n✅ Η ώρα είναι ξανά διαθέσιμη online.'); } catch(_) {}
    toast(t('Το παιχνίδι ακυρώθηκε.', 'Game cancelled.', 'Spiel storniert.'));
    if (typeof window.renderAuth === 'function') try { window.renderAuth(); } catch(_) {}
  } catch(e){ alert(t('Δεν έγινε', 'Failed', 'Fehlgeschlagen') + ': ' + e.message); }
}
async function markNotesRead(){
  const unread = OG.notes.filter(n => !n.read); if (!unread.length) return;
  try { const b = writeBatch(db()); unread.forEach(n => b.update(doc(db(), 'notifications', n.id), { read: true })); await b.commit(); } catch(e){ console.warn('mark read', e); }
}

/* ---------- toast ---------- */
let toastT;
function toast(text, onClick){
  let el = $('ogToast');
  if (!el){ el = document.createElement('div'); el.id = 'ogToast'; el.className = 'og-toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.onclick = () => { el.classList.remove('show'); if (onClick) onClick(); };
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 5200);
}
function maybeDecisionToast(){
  const u = me(); if (!u) return;
  const g = OG.games.find(x => x.creatorUid === u.uid && needsDecision(x));
  if (g && !OG.toastShown[g.id]){ OG.toastShown[g.id] = 1; toast('⏰ ' + t('Το παιχνίδι σου', 'Your game', 'Dein Spiel') + ' ' + whenTxt(g) + ' ' + t('είναι', 'is', 'ist') + ' ' + playerCount(g) + '/4 — ' + t('πάτα για απόφαση', 'tap to decide', 'tippen zum Entscheiden'), () => openOverlay('mine', g.id)); }
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-og]'); if (!el || !$('ogOv') || !$('ogOv').contains(el)) return;
  switch (el.dataset.og){
    case 'close': closeOverlay(); break;
    case 'back': OG.view = 'list'; OG.gameId = null; render(); break;
    case 'f': OG.f[el.dataset.k] = el.dataset.v; render(); break;
    case 'fmine': OG.f.mine = !OG.f.mine; render(); break;
    case 'share': shareGame(); break;
    case 'tab': OG.tab = el.dataset.t; OG.view = 'list'; render(); if (OG.tab === 'notes') markNotesRead(); break;
    case 'game': OG.view = 'game'; OG.gameId = el.dataset.id; render(); $('ogOv').querySelector('.og-body').scrollTop = 0; break;
    case 'note': if (el.dataset.id && OG.games.some(g => g.id === el.dataset.id)){ OG.view = 'game'; OG.gameId = el.dataset.id; render(); } break;
    case 'join': if (!el.disabled) join(); break;
    case 'leave': leave(); break;
    case 'keep': keep(el.dataset.id); break;
    case 'cancel': cancelGame(el.dataset.id); break;
    case 'login': closeOverlay(); setTimeout(() => $('playerBtn') && $('playerBtn').click(), 250); break;
    case 'book': closeOverlay(); setTimeout(() => $('ctaBtn') && $('ctaBtn').click(), 250); break;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('ogOv') && $('ogOv').classList.contains('open')) closeOverlay(); });
// Re-label when the visitor switches language.
document.addEventListener('click', (e) => { if (e.target.closest('[data-lang], .lang-btn, .lang-opt')) setTimeout(() => { paintHeroBtn(); if ($('ogOv') && $('ogOv').classList.contains('open')) render(); paintFormBox(); }, 50); });

/* ============ BOOKING FORM: «Ψάχνω παίχτες» ============ */
const FORM = { on: false, have: 2, range: 2, friendNames: [], gender: 'any', mode: 'friendly' };
function paintFormBox(){
  const box = $('ogFormBox'); if (!box) return;
  const u = me();
  const four = !!document.querySelector('.seg-opt.active[data-players="4"]');
  if (!four){ box.style.display = 'none'; FORM.on = false; return; }
  box.style.display = '';
  if (!u){
    box.innerHTML = `<div class="og-form"><label class="check-line" style="opacity:.7"><input type="checkbox" disabled><span>👥 ${t('Ψάχνω παίχτες για την τετράδα', 'Looking for players to complete the four', 'Suche Mitspieler für die Vierer-Runde')} <em class="label-hint">(${t('μόνο για μέλη — συνδέσου', 'members only — log in', 'nur für Mitglieder — anmelden')})</em></span></label></div>`;
    return;
  }
  const lv = lv10(u);
  box.innerHTML = `<div class="og-form ${FORM.on ? 'on' : ''}">
      <label class="check-line"><input type="checkbox" id="ogOn" ${FORM.on ? 'checked' : ''}><span>👥 <b>${t('Ψάχνω παίχτες', 'Looking for players', 'Suche Mitspieler')}</b> — ${t('δεν είμαστε 4', 'we are not 4 yet', 'wir sind noch keine 4')}</span></label>
      <div class="og-opts">
        <label class="sm">${t('ΠΟΣΟΙ ΕΙΣΤΕ ΜΑΖΙ ΜΕ ΕΣΕΝΑ', 'HOW MANY OF YOU (INCL. YOU)', 'WIE VIELE SEID IHR (MIT DIR)')}</label>
        <div class="og-row">${[1, 2, 3].map(k => `<button type="button" class="og-chip ${FORM.have === k ? 'on' : ''}" data-ogf="have" data-k="${k}">${k} → ${t('ψάχνω', 'need', 'suche')} ${4 - k}</button>`).join('')}</div>
        ${FORM.have > 1 ? `<label class="sm">${t('ΟΝΟΜΑΤΑ ΤΗΣ ΠΑΡΕΑΣ ΣΟΥ (ΠΡΟΑΙΡΕΤΙΚΟ)', 'YOUR FRIENDS’ NAMES (OPTIONAL)', 'NAMEN DEINER FREUNDE (OPTIONAL)')}</label>
          <div class="og-row">${Array.from({ length: FORM.have - 1 }, (_, i) => `<input type="text" maxlength="20" data-ogf="fname" data-i="${i}" value="${esc(FORM.friendNames[i] || '')}" placeholder="${t('Φίλος', 'Friend', 'Freund')} ${i + 1}" style="flex:1;min-width:120px">`).join('')}</div>` : ''}
        <label class="sm">${t('ΤΥΠΟΣ ΠΑΙΧΝΙΔΙΟΥ', 'GAME TYPE', 'SPIELART')}</label>
        <div class="og-row">${['any', 'mixed', 'men', 'women'].map(k => `<button type="button" class="og-chip ${FORM.gender === k ? 'on' : ''}" data-ogf="gender" data-v="${k}">${esc(GENDER[k]())}</button>`).join('')}</div>
        <div class="og-row">${['friendly', 'competitive'].map(k => `<button type="button" class="og-chip ${FORM.mode === k ? 'on' : ''}" data-ogf="mode" data-v="${k}">${k === 'competitive' ? '🔥 ' : '🙂 '}${esc(MODE[k]())}</button>`).join('')}</div>
        <label class="sm">${t('ΕΠΙΠΕΔΟ ΠΑΙΧΤΩΝ ΠΟΥ ΨΑΧΝΕΙΣ', 'LEVEL YOU ARE LOOKING FOR', 'GESUCHTES NIVEAU')}</label>
        <div class="og-row">${[1, 2, 3].map(r => `<button type="button" class="og-chip ${FORM.range === r ? 'on' : ''}" data-ogf="range" data-r="${r}">${Math.max(1, lv - r)}–${Math.min(10, lv + r)}</button>`).join('')}</div>
        <p class="hint">${t('Το γήπεδο κλείνεται για σένα και φαίνεται στο «Βρες παίχτη». Μόλις γεμίσει, ειδοποιούνται όλοι. 6 ώρες πριν, αν δεν έχει γεμίσει, αποφασίζεις αν το κρατάς ή το ακυρώνεις.', 'The court is held for you and shown in “Find a player”. When it fills up, everyone is notified. 6 hours before, if not full, you decide to keep or cancel.', 'Der Platz wird für dich reserviert und unter „Spieler finden“ gezeigt. Wenn voll, werden alle benachrichtigt. 6 Std. vorher entscheidest du, ob du behältst oder stornierst.')}</p>
      </div></div>`;
}
document.addEventListener('change', (e) => { if (e.target.id === 'ogOn'){ FORM.on = e.target.checked; paintFormBox(); } });
document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.ogf === 'fname') FORM.friendNames[+e.target.dataset.i] = e.target.value; });
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-ogf]');
  if (c && c.dataset.ogf === 'have'){ FORM.have = +c.dataset.k; paintFormBox(); }
  if (c && c.dataset.ogf === 'range'){ FORM.range = +c.dataset.r; paintFormBox(); }
  if (c && c.dataset.ogf === 'gender'){ FORM.gender = c.dataset.v; paintFormBox(); }
  if (c && c.dataset.ogf === 'mode'){ FORM.mode = c.dataset.v; paintFormBox(); }
  if (e.target.closest('.seg-opt')) setTimeout(paintFormBox, 0);
});

/* ---------- «Ειδοποίησέ με»: tell members whose day/time/level/gender match ---------- */
async function sendAlerts(gameId){
  const u = me(); if (!u) return;
  const gs = await getDoc(doc(db(), 'open_games', gameId)); if (!gs.exists()) return;
  const g = { id: gs.id, ...gs.data() };
  const day = monIdx(g.date), per = periodOf(g.time);
  const subs = (await getDocs(query(collection(db(), 'og_alerts'), where('on', '==', true)))).docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(a => a.uid !== u.uid && !isIn(g, a.uid)
      && (!a.days || !a.days.length || a.days.includes(day))
      && (!a.times || !a.times.length || a.times.includes(per))
      && a.level >= g.levelMin && a.level <= g.levelMax
      && genderOk(g, { gender: a.gender }))
    .slice(0, 60);
  const need = 4 - playerCount(g);
  for (let i = 0; i < subs.length; i += 15){
    PENDING = [];
    const b = writeBatch(db());
    subs.slice(i, i + 15).forEach(a => b.set(nref(), {
      toUid: a.uid, fromUid: u.uid, gameId: g.id, type: 'alert', icon: '🎾', read: false, createdMs: Date.now(), createdAt: serverTimestamp(),
      title: t('Ψάχνουν παίχτη για εσένα!', 'A game needs you!', 'Ein Spiel sucht dich!'),
      text: whenTxt(g) + ' · ' + t('Επίπεδο', 'Level', 'Niveau') + ' ' + g.levelMin + '–' + g.levelMax + ' · ' + t('λείπ' + (need === 1 ? 'ει 1' : 'ουν ' + need), need + ' missing', need + ' fehlen') + (typeTags(g).length ? ' · ' + typeTags(g).join(' · ') : ''),
    }));
    await b.commit();
    flushPush();
  }
}

/* ---------- public hooks used by index.html ---------- */
window.npOG = {
  /** Called by the booking submit: null, or the open-game data to create with the booking. Throws a readable Error if not allowed. */
  formPayload(){
    if (!FORM.on) return null;
    const u = me();
    if (!u) throw new Error(t('Το «Ψάχνω παίχτες» είναι μόνο για μέλη.', '“Looking for players” is for members only.', '„Suche Mitspieler“ nur für Mitglieder.'));
    if (!document.querySelector('.seg-opt.active[data-players="4"]')) return null;
    const lv = lv10(u), friends = FORM.have - 1;
    if (FORM.gender === 'men' && u.gender !== 'M' || FORM.gender === 'women' && u.gender !== 'F')
      throw new Error(t('Για ' + GENDER[FORM.gender]().toLowerCase() + ' παιχνίδι συμπλήρωσε σωστά το φύλο σου στο προφίλ.', 'For a ' + GENDER[FORM.gender]().toLowerCase() + ' game, please set your gender in your profile.', 'Für ein ' + GENDER[FORM.gender]() + '-Spiel bitte Geschlecht im Profil angeben.'));
    return {
      gameGender: FORM.gender, gameMode: FORM.mode,
      creatorName: ((u.name || '').trim() || 'Παίχτης'),
      players: { [u.uid]: { name: (u.name || '').trim() || 'Παίχτης', level: lv, at: Date.now(), ...(u.side ? { side: u.side } : {}) } },
      friends, friendNames: FORM.friendNames.slice(0, friends).map(s => (s || '').trim().slice(0, 20)),
      count: 1 + friends,
      levelMin: Math.max(1, lv - FORM.range), levelMax: Math.min(10, lv + FORM.range),
    };
  },
  afterCreate(gameId){ if (window.npPush) window.npPush.suggest(); FORM.on = false; FORM.friendNames = []; paintFormBox(); setTimeout(() => openOverlay('mine', gameId), 600); sendAlerts(gameId).catch(e => console.warn('alerts', e)); },
  /** {time: game} for open games on a date (court 1) — the booking calendar shows them as joinable. */
  forDate(iso, court){ const o = {}; OG.games.filter(g => g.date === iso && g.court === court && g.status === 'open' && isUpcoming(g)).forEach(g => { o[g.time] = g; }); return o; },
  /** {date: n} open games per day in a month — they don't count as taken. */
  openByMonth(ym, court){ const o = {}; OG.games.filter(g => (g.date || '').startsWith(ym) && g.court === court && g.status === 'open').forEach(g => { o[g.date] = (o[g.date] || 0) + 1; }); return o; },
  count: playerCount,
  open: (id) => openOverlay('open', id),
  refreshUser(){ watchNotes(); paintFormBox(); maybeDecisionToast(); },
};

/* ---------- boot ---------- */
mountHeroBtn();
startGames();
waitFB().then(() => window.npFB.onAuth(() => setTimeout(() => window.npOG.refreshUser(), 800)));
// Deep link: /#og=<id>
if (location.hash.startsWith('#og=')){ const id = location.hash.slice(4); const tryOpen = () => { if (OG.loaded) openOverlay('open', id); else setTimeout(tryOpen, 300); }; tryOpen(); }
