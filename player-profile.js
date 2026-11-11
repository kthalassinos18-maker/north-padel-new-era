/* ============ PLAYER PROFILE v2 ============
 * Adds to the member profile (index.html → renderFullProfile):
 *  - Player card (photo, level, style, numbers) that can be shared as an image
 *  - Profile photo  → /avatars/{uid} (small JPEG, public: shown on the open-game court)
 *  - Play style: hand, court side, friendly/competitive → saved on /users/{uid}
 *  - Stats: bookings, hours on court, favourite day/time, open games, Americano trophies
 *  - Badges
 *  - «Ειδοποίησέ με»: /og_alerts/{uid} (days/times from availability + level)
 */
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const lang = () => { try { return localStorage.getItem('northPadelLang') || 'el'; } catch(_) { return 'el'; } };
const t = (el, en, de) => { const l = lang(); return l === 'en' ? (en || el) : l === 'de' ? (de || en || el) : el; };
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const db = () => window.npFB.db;
const lv10 = (u) => (window.npLv10 ? window.npLv10(u) : (+u.level || 1));
const LV = (n) => (window.NP_LEVELS || [])[(n || 1) - 1] || { icon: '🎾', el: '', en: '', de: '' };
const lvName = (n) => { const l = LV(n); return lang() === 'en' ? l.en : lang() === 'de' ? l.de : l.el; };
const DAYS = { el: ['Δευτέρα','Τρίτη','Τετάρτη','Πέμπτη','Παρασκευή','Σάββατο','Κυριακή'], en: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], de: ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'] };
const monIdx = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };

const HAND = [['R', () => t('Δεξί χέρι', 'Right-handed', 'Rechtshänder')], ['L', () => t('Αριστερό χέρι', 'Left-handed', 'Linkshänder')]];
const SIDE = [['right', () => t('Δεξιά (drive)', 'Right (drive)', 'Rechts (Drive)')], ['left', () => t('Αριστερά (revés)', 'Left (revés)', 'Links (Revés)')], ['both', () => t('Και τα δύο', 'Both', 'Beides')]];
const MODE = [['friendly', () => t('Φιλικό', 'Friendly', 'Freundschaftlich')], ['competitive', () => t('Ανταγωνιστικό', 'Competitive', 'Wettkampf')], ['both', () => t('Και τα δύο', 'Both', 'Beides')]];
const label = (list, v) => { const x = list.find(a => a[0] === v); return x ? x[1]() : ''; };

/* ---------- avatars (shared with open-games.js) ---------- */
const AV = window.__npAvatars || (window.__npAvatars = {});
window.npAvatar = async function(uid){
  if (!uid) return null;
  if (!(uid in AV)) AV[uid] = getDoc(doc(db(), 'avatars', uid)).then(s => (s.exists() ? s.data().photo || null : null)).catch(() => null);
  return AV[uid];
};
function resizeSquare(file, size){
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const im = new Image(); im.onload = () => {
      const s = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, size, size);
      res(c.toDataURL('image/jpeg', 0.8));
    }; im.onerror = () => rej(new Error('Μη έγκυρη εικόνα')); im.src = rd.result; };
    rd.onerror = () => rej(new Error('Αποτυχία ανάγνωσης')); rd.readAsDataURL(file);
  });
}

/* ---------- state ---------- */
const P = { uid: null, hand: '', side: '', mode: '', alertOn: false, photo: null, stats: null };

/* ---------- stats ---------- */
async function loadStats(u){
  const today = todayISO();
  const all = (u.bookings || []).filter(b => b.status !== 'cancelled');
  const past = all.filter(b => (b.date || '') <= today);
  const dayCount = [0, 0, 0, 0, 0, 0, 0], timeCount = {};
  past.forEach(b => { if (b.date) dayCount[monIdx(b.date)]++; if (b.time) timeCount[b.time] = (timeCount[b.time] || 0) + 1; });
  const favDay = past.length ? dayCount.indexOf(Math.max(...dayCount)) : -1;
  const favTime = Object.entries(timeCount).sort((a, b) => b[1] - a[1])[0];
  const startH = (b) => +((b.time || '').split(':')[0] || 0);
  const morning = past.filter(b => startH(b) >= 6 && startH(b) < 12).length;
  const night = past.filter(b => startH(b) >= 21 || startH(b) < 3).length;
  const weekend = past.filter(b => b.date && monIdx(b.date) >= 5).length;
  let games = 0, trophies = [];
  try {
    const s = await getDocs(query(collection(db(), 'open_games'), where('players.' + u.uid + '.at', '>', 0)));
    games = s.docs.map(d => d.data()).filter(g => (g.status === 'full' || g.status === 'kept') && (g.startsAt || 0) < Date.now()).length;
  } catch(e){ console.warn('profile open games', e); }
  try {
    const s = await getDocs(query(collection(db(), 'trophies'), where('uids', 'array-contains', u.uid)));
    trophies = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } catch(e){ console.warn('profile trophies', e); }
  const rankOf = (tr) => { const p = (tr.players || []).find(x => x.uid === u.uid); return p ? p.rank : null; };
  return {
    bookings: past.length, upcoming: all.length - past.length, hours: Math.round(past.length * 1.5),
    favDay, favTime: favTime ? favTime[0] : null, morning, night, weekend, games, trophies,
    wins: trophies.filter(tr => rankOf(tr) === 1).length, podiums: trophies.filter(tr => (rankOf(tr) || 9) <= 3).length, rankOf,
  };
}
function badges(s){
  return [
    ['🎾', t('Πρώτο παιχνίδι', 'First game', 'Erstes Spiel'), s.bookings >= 1],
    ['🔟', t('10 κρατήσεις', '10 bookings', '10 Buchungen'), s.bookings >= 10],
    ['🥉', t('25 κρατήσεις', '25 bookings', '25 Buchungen'), s.bookings >= 25],
    ['💎', t('50 κρατήσεις', '50 bookings', '50 Buchungen'), s.bookings >= 50],
    ['🌅', t('Πρωινός', 'Early bird', 'Frühaufsteher'), s.morning >= 3],
    ['🦉', t('Νυχτοπούλι', 'Night owl', 'Nachteule'), s.night >= 3],
    ['📅', t('Σαββατοκύριακο', 'Weekender', 'Wochenende'), s.weekend >= 5],
    ['🤝', t('Βρήκε παρέα', 'Team player', 'Teamplayer'), s.games >= 1],
    ['🏆', t('Τουρνουά', 'Tournament', 'Turnier'), s.trophies.length >= 1],
    ['🥇', t('Νικητής', 'Champion', 'Sieger'), s.wins >= 1],
    ['🎖️', t('Βάθρο', 'Podium', 'Podium'), s.podiums >= 1],
    ['🔥', t('100 ώρες', '100 hours', '100 Stunden'), s.hours >= 100],
  ];
}

/* ---------- render ---------- */
function cardHtml(u){
  const lv = lv10(u), l = LV(lv), s = P.stats;
  const nm = ((u.name || '') + ' ' + (u.surname || '')).trim() || t('Παίχτης', 'Player', 'Spieler');
  const tags = [label(HAND, P.hand), label(SIDE, P.side), label(MODE, P.mode)].filter(Boolean);
  const since = u.createdAt && u.createdAt.toDate ? u.createdAt.toDate().getFullYear() : new Date().getFullYear();
  return `<div class="pp-card" id="ppCardEl">
      <div class="pp-top">
        <div class="pp-photo" data-pp="photo" style="${P.photo ? `background-image:url('${P.photo}')` : ''}" title="${t('Αλλαγή φωτογραφίας', 'Change photo', 'Foto ändern')}">${P.photo ? '' : esc(nm.charAt(0).toUpperCase())}<span class="cam">📷</span></div>
        <div style="min-width:0">
          <div class="pp-name">${esc(nm)}</div>
          <div class="pp-lv">${l.icon} <b>${lv}</b> · ${esc(lvName(lv))}</div>
          ${tags.length ? `<div class="pp-tags">${tags.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="pp-nums">
        <div><b>${s ? s.bookings : '–'}</b><small>${t('ΠΑΙΧΝΙΔΙΑ', 'GAMES', 'SPIELE')}</small></div>
        <div><b>${s ? s.hours : '–'}</b><small>${t('ΩΡΕΣ', 'HOURS', 'STUNDEN')}</small></div>
        <div><b>${s ? s.trophies.length : '–'}</b><small>${t('ΤΟΥΡΝΟΥΑ', 'TOURNAMENTS', 'TURNIERE')}</small></div>
      </div>
      <div class="pp-foot"><span class="brand">NORTH PADEL</span><span>${t('ΜΕΛΟΣ ΑΠΟ', 'MEMBER SINCE', 'MITGLIED SEIT')} ${since}</span></div>
    </div>
    <div class="pp-actions">
      <button type="button" data-pp="photo">📷 ${t('Φωτογραφία', 'Photo', 'Foto')}</button>
      <button type="button" class="solid" data-pp="share">📤 ${t('Κοινοποίηση κάρτας', 'Share card', 'Karte teilen')}</button>
    </div>
    <input type="file" id="ppFile" accept="image/*" hidden>
    <div id="ppMsg" style="font-size:12px;min-height:14px;margin-top:6px;text-align:center"></div>`;
}
function chips(name, list, cur){
  return `<div class="pp-chips">${list.map(([v, l]) => `<button type="button" class="pp-chip ${cur === v ? 'on' : ''}" data-ppc="${name}" data-v="${v}">${esc(l())}</button>`).join('')}</div>`;
}
function styleHtml(){
  return `<h3><span class="ico">🏓</span>${t('ΣΤΥΛ ΠΑΙΧΝΙΔΙΟΥ', 'PLAYING STYLE', 'SPIELSTIL')}</h3>
    <span class="pp-q">${t('ΧΕΡΙ', 'HAND', 'HAND')}</span>${chips('hand', HAND, P.hand)}
    <span class="pp-q">${t('ΘΕΣΗ ΣΤΟ ΓΗΠΕΔΟ', 'COURT SIDE', 'SEITE')}</span>${chips('side', SIDE, P.side)}
    <span class="pp-q">${t('ΤΙ ΠΑΙΧΝΙΔΙ ΘΕΛΩ', 'GAME I PREFER', 'BEVORZUGTES SPIEL')}</span>${chips('mode', MODE, P.mode)}`;
}
function statsHtml(){
  const s = P.stats;
  if (!s) return `<h3><span class="ico">📊</span>${t('ΣΤΑΤΙΣΤΙΚΑ', 'STATS', 'STATISTIK')}</h3><div style="color:rgba(244,249,255,0.5);font-size:13px">${t('Φόρτωση...', 'Loading...', 'Laden...')}</div>`;
  const medal = (r) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '🏅';
  return `<h3><span class="ico">📊</span>${t('ΣΤΑΤΙΣΤΙΚΑ', 'STATS', 'STATISTIK')}</h3>
    <div class="pp-stats">
      <div class="pp-stat"><b>${s.bookings}</b><small>${t('παιχνίδια στο North Padel', 'games at North Padel', 'Spiele bei North Padel')}</small></div>
      <div class="pp-stat"><b>${s.hours}</b><small>${t('ώρες στο γήπεδο', 'hours on court', 'Stunden auf dem Platz')}</small></div>
      <div class="pp-stat"><b>${s.favDay >= 0 ? esc((DAYS[lang()] || DAYS.el)[s.favDay]) : '—'}</b><small>${t('αγαπημένη μέρα', 'favourite day', 'Lieblingstag')}</small></div>
      <div class="pp-stat"><b>${s.favTime ? esc(s.favTime.split('-')[0]) : '—'}</b><small>${t('αγαπημένη ώρα', 'favourite time', 'Lieblingszeit')}</small></div>
      <div class="pp-stat"><b>${s.games}</b><small>${t('ανοιχτά παιχνίδια που έπαιξες', 'open games played', 'offene Spiele gespielt')}</small></div>
      <div class="pp-stat"><b>${s.upcoming}</b><small>${t('επόμενες κρατήσεις', 'upcoming bookings', 'kommende Buchungen')}</small></div>
    </div>
    ${s.trophies.length ? `<span class="pp-q" style="margin-top:16px">🏆 AMERICANO</span>${s.trophies.slice(0, 6).map(tr => { const r = s.rankOf(tr); return `<div class="pp-trophy"><span class="m">${medal(r)}</span><div><b>${esc(tr.name || 'Americano')}</b><small>${esc((tr.date || '').split('-').reverse().join('/'))}${r ? ' · ' + r + t('η θέση', '. place', '. Platz') + ' / ' + (tr.players || []).length : ''}</small></div></div>`; }).join('')}` : ''}`;
}
function badgesHtml(){
  if (!P.stats) return '';
  const b = badges(P.stats), n = b.filter(x => x[2]).length;
  return `<h3><span class="ico">🎖️</span>${t('ΕΠΙΤΕΥΓΜΑΤΑ', 'ACHIEVEMENTS', 'ERFOLGE')} · ${n}/${b.length}</h3>
    <div class="pp-badges">${b.map(([i, nm, ok]) => `<div class="pp-badge ${ok ? '' : 'off'}" title="${esc(nm)}"><div class="i">${i}</div><div class="n">${esc(nm)}</div></div>`).join('')}</div>`;
}
function alertsHtml(){
  return `<h3><span class="ico">🔔</span>${t('ΕΙΔΟΠΟΙΗΣΕ ΜΕ', 'NOTIFY ME', 'BENACHRICHTIGE MICH')}</h3>
    <div class="pf-lfg-row">
      <label class="sw"><input type="checkbox" id="ppAlertOn" ${P.alertOn ? 'checked' : ''}><span class="sw-slider"></span></label>
      <div class="pf-lfg-text"><strong>${t('Όταν ανοίγει παιχνίδι για εμένα', 'When a game opens for me', 'Wenn ein Spiel für mich öffnet')}</strong>
        <small>${t('Θα σου έρχεται ειδοποίηση όταν κάποιος ψάχνει παίχτη στο επίπεδό σου, τις μέρες και ώρες της «Διαθεσιμότητας» σου (αν δεν διαλέξεις, για όλες).', 'You get a notification when someone needs a player at your level, on the days and times of your “Availability” (none selected = any).', 'Du wirst benachrichtigt, wenn jemand auf deinem Niveau einen Spieler sucht — an den Tagen/Zeiten deiner „Verfügbarkeit“ (keine Auswahl = immer).')}</small></div>
    </div>`;
}
function paintAll(u){
  const set = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
  set('ppCard', cardHtml(u)); set('ppStyle', styleHtml()); set('ppStats', statsHtml()); set('ppBadges', badgesHtml()); set('ppAlerts', alertsHtml());
  const f = $('ppFile'); if (f) f.onchange = () => uploadPhoto(u, f.files && f.files[0]);
}
function paintHeroAvatar(){
  const a = document.querySelector('#profileHero .pf-avatar'); if (!a) return;
  if (P.photo){ a.style.background = `url('${P.photo}') center/cover`; a.textContent = ''; }
}

/* ---------- actions ---------- */
async function uploadPhoto(u, file){
  if (!file) return;
  const msg = $('ppMsg');
  try {
    msg.style.color = 'rgba(244,249,255,0.6)'; msg.textContent = t('Ανέβασμα...', 'Uploading...', 'Hochladen...');
    const photo = await resizeSquare(file, 256);
    await setDoc(doc(db(), 'avatars', u.uid), { photo, updatedAt: serverTimestamp() });
    P.photo = photo; AV[u.uid] = Promise.resolve(photo);
    paintAll(u); paintHeroAvatar();
    const m = $('ppMsg'); if (m){ m.style.color = '#b7ff4a'; m.textContent = '✅ ' + t('Η φωτογραφία αποθηκεύτηκε.', 'Photo saved.', 'Foto gespeichert.'); }
  } catch(e){ msg.style.color = '#ff6b6b'; msg.textContent = t('Αποτυχία', 'Failed', 'Fehler') + ': ' + e.message; }
}
async function shareCard(u){
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts.load('700 80px Oswald'); await document.fonts.load('600 40px Inter'); } catch(_) {}
  const g = x.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, '#174478'); g.addColorStop(0.6, '#0b1f38'); g.addColorStop(1, '#0a1929');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const rg = x.createRadialGradient(W * 0.9, 0, 10, W * 0.9, 0, 700); rg.addColorStop(0, 'rgba(183,255,74,0.35)'); rg.addColorStop(1, 'rgba(183,255,74,0)');
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#b7ff4a'; x.lineWidth = 6; x.strokeRect(30, 30, W - 60, H - 60);
  x.fillStyle = '#b7ff4a'; x.font = '700 54px Oswald, sans-serif'; x.textAlign = 'center'; x.fillText('NORTH PADEL', W / 2, 140);
  const cx = W / 2, cy = 420, r = 190;
  x.save(); x.beginPath(); x.arc(cx, cy, r + 14, 0, Math.PI * 2); x.fillStyle = '#b7ff4a'; x.fill();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
  const nm = ((u.name || '') + ' ' + (u.surname || '')).trim() || 'Player';
  if (P.photo){ const im = new Image(); await new Promise(res => { im.onload = res; im.onerror = res; im.src = P.photo; }); x.drawImage(im, cx - r, cy - r, r * 2, r * 2); }
  else { x.fillStyle = '#0f2540'; x.fillRect(cx - r, cy - r, r * 2, r * 2); x.fillStyle = '#b7ff4a'; x.font = '700 200px Oswald, sans-serif'; x.textBaseline = 'middle'; x.fillText(nm.charAt(0).toUpperCase(), cx, cy + 10); x.textBaseline = 'alphabetic'; }
  x.restore();
  x.fillStyle = '#f4f9ff'; x.font = '700 92px Oswald, sans-serif'; x.fillText(upper(nm), W / 2, 720, W - 120);
  const lv = lv10(u), l = LV(lv), pill = l.icon + '  ' + t('ΕΠΙΠΕΔΟ', 'LEVEL', 'NIVEAU') + ' ' + lv + ' · ' + upper(lvName(lv));
  x.font = '700 46px Inter, sans-serif'; const pw = x.measureText(pill).width + 80;
  x.fillStyle = '#b7ff4a'; roundRect(x, (W - pw) / 2, 760, pw, 84, 42); x.fill();
  x.fillStyle = '#0a1929'; x.fillText(pill, W / 2, 818);
  const tags = [label(HAND, P.hand), label(SIDE, P.side), label(MODE, P.mode)].filter(Boolean).join('   ·   ');
  if (tags){ x.fillStyle = 'rgba(244,249,255,0.75)'; x.font = '600 36px Inter, sans-serif'; x.fillText(tags, W / 2, 910, W - 120); }
  const s = P.stats || { bookings: 0, hours: 0, trophies: [] };
  [[s.bookings, t('ΠΑΙΧΝΙΔΙΑ', 'GAMES', 'SPIELE')], [s.hours, t('ΩΡΕΣ', 'HOURS', 'STUNDEN')], [s.trophies.length, t('ΤΟΥΡΝΟΥΑ', 'TOURNAMENTS', 'TURNIERE')]].forEach(([v, lb], i) => {
    const bx = 90 + i * 310, by = 980;
    x.fillStyle = 'rgba(10,25,41,0.7)'; roundRect(x, bx, by, 280, 190, 28); x.fill();
    x.fillStyle = '#f4f9ff'; x.font = '700 90px Oswald, sans-serif'; x.fillText(String(v), bx + 140, by + 110);
    x.fillStyle = 'rgba(244,249,255,0.6)'; x.font = '700 28px Inter, sans-serif'; x.fillText(lb, bx + 140, by + 160);
  });
  x.fillStyle = 'rgba(244,249,255,0.5)'; x.font = '600 30px Inter, sans-serif'; x.fillText('Νέα Καλλικράτεια · Χαλκιδική', W / 2, 1265);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'north-padel-' + (u.name || 'player') + '.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })){ await navigator.share({ files: [file], title: 'North Padel', text: t('Η κάρτα παίχτη μου στο North Padel 🎾', 'My North Padel player card 🎾', 'Meine North Padel Spielerkarte 🎾') }); return; }
  } catch(e){ if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// Greek capitals are written without accents (ΕΛΕΝΗ, not ΕΛΈΝΗ).
const upper = (str) => String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
function roundRect(x, X, Y, w, h, r){ x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const u = typeof window.currentUser === 'function' ? window.currentUser() : null; if (!u) return;
  const a = e.target.closest('[data-pp]');
  if (a){
    if (a.dataset.pp === 'photo'){ const f = $('ppFile'); if (f) f.click(); }
    if (a.dataset.pp === 'share') shareCard(u).catch(err => alert(err.message));
    return;
  }
  const c = e.target.closest('[data-ppc]');
  if (c){
    const k = c.dataset.ppc, v = c.dataset.v;
    P[k] = P[k] === v ? '' : v;
    const st = $('ppStyle'); if (st) st.innerHTML = styleHtml();
    const card = $('ppCard'); if (card) card.innerHTML = cardHtml(u);
    const f = $('ppFile'); if (f) f.onchange = () => uploadPhoto(u, f.files && f.files[0]);
  }
});
document.addEventListener('change', (e) => { if (e.target.id === 'ppAlertOn') P.alertOn = e.target.checked; });

/* ---------- public hooks (index.html) ---------- */
window.npProfile = {
  async render(u){
    if (!u || !u.uid) return;
    P.uid = u.uid; P.hand = u.hand || ''; P.side = u.side || ''; P.mode = u.playMode || '';
    P.photo = await window.npAvatar(u.uid);
    paintAll(u); paintHeroAvatar();
    try { const s = await getDoc(doc(db(), 'og_alerts', u.uid)); P.alertOn = s.exists() && !!s.data().on; const el = $('ppAlertOn'); if (el) el.checked = P.alertOn; } catch(_) {}
    P.stats = await loadStats(u);
    if (P.uid === u.uid){ paintAll(u); paintHeroAvatar(); }
  },
  /** Extra fields saved together with the profile. */
  patch(){ return { hand: P.hand, side: P.side, playMode: P.mode }; },
  /** After the profile save: keep «Ειδοποίησέ με» in sync with availability / level. */
  async afterSave(u){
    if (!u || !u.uid) return;
    const ref = doc(db(), 'og_alerts', u.uid);
    try {
      if (P.alertOn){
        await setDoc(ref, { on: true, name: ((u.name || '').trim() || 'Player').slice(0, 30), level: lv10(u), gender: u.gender || '',
          days: (u.availability && u.availability.days) || [], times: (u.availability && u.availability.times) || [], updatedAt: serverTimestamp() });
      } else await deleteDoc(ref).catch(() => {});
    } catch(e){ console.warn('og_alerts', e); }
  },
  hero(){ if (P.photo) paintHeroAvatar(); else if (window.currentUser && window.currentUser()) window.npAvatar(window.currentUser().uid).then(p => { if (p){ P.photo = p; paintHeroAvatar(); } }); },
};
