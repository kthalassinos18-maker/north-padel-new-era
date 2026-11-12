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
      ${completionHtml(u)}
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

/* ============ PROFILE COMPLETION + TABS + QUICK SETUP WIZARD ============ */
const DAY_S = { el: ['Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ','Κυρ'], en: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], de: ['Mo','Di','Mi','Do','Fr','Sa','So'] };
const TIMES = [
  ['morning', () => '☀️ ' + t('Πρωί', 'Morning', 'Morgens')], ['noon', () => '🍽️ ' + t('Μεσημέρι', 'Midday', 'Mittags')],
  ['afternoon', () => '🌤️ ' + t('Απόγευμα', 'Afternoon', 'Nachmittags')], ['evening', () => '🌙 ' + t('Βράδυ', 'Evening', 'Abends')],
  ['late', () => '🌌 ' + t('Νύχτα', 'Night', 'Nachts')],
];
/** Profile completeness: photo, level, style, availability, notifications. */
function completion(u){
  const av = u.availability || {};
  const items = [
    ['photo', !!P.photo], ['level', true],
    ['style', !!(P.hand && P.side)],
    ['when', !!((av.days && av.days.length) || (av.times && av.times.length))],
    ['notify', !!P.alertOn || !!(window.npPush && window.npPush.isOn && window.npPush.isOn())],
  ];
  const done = items.filter(x => x[1]).length;
  return { pct: Math.round(done / items.length * 100), missing: items.filter(x => !x[1]).map(x => x[0]) };
}
function completionHtml(u){
  const c = completion(u);
  if (c.pct >= 100) return '';
  return `<button type="button" class="pp-complete" data-pp="wizard">
      <span class="pp-cbar"><i style="width:${c.pct}%"></i></span>
      <span class="pp-ctext"><b>${t('Προφίλ', 'Profile', 'Profil')} ${c.pct}%</b> · ${t('ολοκλήρωσέ το σε 1 λεπτό', 'finish it in 1 minute', 'in 1 Minute fertig')} ➜</span>
    </button>`;
}

/* ---- tabs ---- */
let TAB = null;
const TABS = [['stats', () => '📊 ' + t('Στατιστικά', 'Stats', 'Statistik')], ['info', () => '🪪 ' + t('Στοιχεία', 'Details', 'Daten')], ['game', () => '🎾 ' + t('Παιχνίδι', 'Game', 'Spiel')], ['book', () => '📅 ' + t('Κρατήσεις', 'Bookings', 'Buchungen')]];
function paintTabs(u){
  const bar = $('ppTabs'); if (!bar) return;
  if (!TAB) TAB = completion(u).pct >= 100 ? 'stats' : 'info';
  bar.innerHTML = TABS.map(([k, l]) => `<button type="button" class="pp-tab ${TAB === k ? 'on' : ''}" data-pptab="${k}">${l()}</button>`).join('');
  document.querySelectorAll('#profileFull [data-tab]').forEach(el => { el.style.display = el.dataset.tab.split(' ').includes(TAB) ? '' : 'none'; });
}

/* ---- wizard ---- */
const W = { step: 0, level: 1, hand: '', side: '', mode: '', days: new Set(), times: new Set(), alertOn: true, busy: false };
const STEPS = 5;
function openWizard(){
  const u = window.currentUser && window.currentUser(); if (!u) return;
  const av = u.availability || {};
  Object.assign(W, { step: 0, level: lv10(u), hand: P.hand || u.hand || '', side: P.side || u.side || '', mode: P.mode || u.playMode || '',
    days: new Set(av.days || []), times: new Set(av.times || []), alertOn: P.alertOn || !P.uid ? true : P.alertOn, busy: false });
  if (P.uid === u.uid && P.alertOn === false) W.alertOn = true;
  let o = $('pwOv');
  if (!o){ o = document.createElement('div'); o.id = 'pwOv'; o.className = 'pw-ov'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); document.body.appendChild(o); }
  paintWizard();
  requestAnimationFrame(() => o.classList.add('open'));
  document.body.style.overflow = 'hidden';
}
function closeWizard(markDone){
  const o = $('pwOv'); if (o) o.classList.remove('open');
  document.body.style.overflow = '';
  const u = window.currentUser && window.currentUser();
  if (markDone && u && !u.onboarded){ u.onboarded = true; window.npFB.updateProfile(u.uid, { onboarded: true }).catch(() => {}); }
  if (u && $('profileFull') && $('profileFull').children.length){ paintAll(u); paintTabs(u); }
}
function wChips(list, isOn, attr){ return list.map(([k, l]) => `<button type="button" class="pw-chip ${isOn(k) ? 'on' : ''}" ${attr}="${k}">${esc(typeof l === 'function' ? l() : l)}</button>`).join(''); }
function paintWizard(){
  const o = $('pwOv'); if (!o) return;
  const u = window.currentUser && window.currentUser(); if (!u) return;
  const st = W.step;
  let title = '', sub = '', body = '';
  if (st === 0){
    title = t('Βάλε φωτογραφία', 'Add a photo', 'Foto hinzufügen'); sub = t('Για να σε αναγνωρίζουν οι άλλοι στο γήπεδο.', 'So others recognise you on court.', 'Damit dich andere erkennen.');
    body = `<div class="pw-photo" data-pw="photo" style="${P.photo ? `background-image:url('${P.photo}')` : ''}">${P.photo ? '' : '📷'}</div>
      <button type="button" class="pw-btn2" data-pw="photo">${P.photo ? t('Αλλαγή φωτογραφίας', 'Change photo', 'Foto ändern') : t('Επίλεξε φωτογραφία', 'Choose a photo', 'Foto wählen')}</button>
      <input type="file" id="pwFile" accept="image/*" hidden><div class="pw-msg" id="pwMsg"></div>`;
  } else if (st === 1){
    title = t('Ποιο είναι το επίπεδό σου;', 'What’s your level?', 'Dein Niveau?'); sub = t('Για να βρίσκεις παίχτες στα μέτρα σου.', 'To find players that match you.', 'Um passende Spieler zu finden.');
    body = `<div class="pw-levels">${(window.NP_LEVELS || []).map((l, i) => `<button type="button" class="pw-lv ${W.level === i + 1 ? 'on' : ''}" data-pwlv="${i + 1}"><span class="i">${l.icon}</span><span class="n">${i + 1}</span><span class="tx"><b>${esc(lang() === 'en' ? l.en : lang() === 'de' ? l.de : l.el)}</b><small>${esc(lang() === 'en' ? l.d_en : lang() === 'de' ? l.d_de : l.d_el)}</small></span></button>`).join('')}</div>`;
  } else if (st === 2){
    title = t('Πώς παίζεις;', 'How do you play?', 'Wie spielst du?'); sub = t('Τρία γρήγορα πατήματα.', 'Three quick taps.', 'Drei schnelle Tipps.');
    body = `<div class="pw-q">${t('Χέρι', 'Hand', 'Hand')}</div><div class="pw-chips">${wChips(HAND, k => W.hand === k, 'data-pwhand')}</div>
      <div class="pw-q">${t('Πλευρά στο γήπεδο', 'Court side', 'Seite')}</div><div class="pw-chips">${wChips(SIDE, k => W.side === k, 'data-pwside')}</div>
      <div class="pw-q">${t('Τι παιχνίδι θέλεις', 'Game you prefer', 'Bevorzugtes Spiel')}</div><div class="pw-chips">${wChips(MODE, k => W.mode === k, 'data-pwmode')}</div>`;
  } else if (st === 3){
    title = t('Πότε παίζεις συνήθως;', 'When do you usually play?', 'Wann spielst du meist?'); sub = t('Διάλεξε όσα θες — μπορείς να τα αλλάξεις όποτε θέλεις.', 'Pick as many as you like — change them any time.', 'Wähle beliebig viele — jederzeit änderbar.');
    const ds = DAY_S[lang()] || DAY_S.el;
    body = `<div class="pw-chips">
        <button type="button" class="pw-chip ${[0,1,2,3,4].every(d => W.days.has(d)) && !W.days.has(5) ? 'on' : ''}" data-pwpreset="week">${t('Καθημερινές', 'Weekdays', 'Werktags')}</button>
        <button type="button" class="pw-chip ${W.days.has(5) && W.days.has(6) && W.days.size === 2 ? 'on' : ''}" data-pwpreset="weekend">${t('Σαββατοκύριακο', 'Weekend', 'Wochenende')}</button>
        <button type="button" class="pw-chip ${W.days.size === 7 ? 'on' : ''}" data-pwpreset="all">${t('Όλες', 'Any day', 'Alle')}</button></div>
      <div class="pw-chips pw-days">${ds.map((d, i) => `<button type="button" class="pw-chip sm ${W.days.has(i) ? 'on' : ''}" data-pwday="${i}">${d}</button>`).join('')}</div>
      <div class="pw-q">${t('Ώρες', 'Times', 'Zeiten')}</div><div class="pw-chips">${wChips(TIMES, k => W.times.has(k), 'data-pwtime')}</div>`;
  } else if (st === 4){
    title = t('Να σε ειδοποιούμε;', 'Shall we notify you?', 'Benachrichtigen?'); sub = t('Μόνο για ό,τι σε αφορά — όχι spam.', 'Only what matters to you — no spam.', 'Nur was dich betrifft — kein Spam.');
    const pushOn = window.npPush && window.npPush.isOn && window.npPush.isOn();
    body = `<button type="button" class="pwz-toggle ${W.alertOn ? 'on' : ''}" data-pw="alert"><span class="sw2"></span><span><b>🎾 ${t('Όταν ψάχνουν παίχτη για εμένα', 'When a game needs a player like me', 'Wenn ein Spiel mich sucht')}</b><small>${t('Στο επίπεδό σου, τις μέρες και ώρες που διάλεξες.', 'At your level, on the days and times you picked.', 'Auf deinem Niveau, zu deinen Zeiten.')}</small></span></button>
      ${window.npPush ? `<button type="button" class="pwz-toggle ${pushOn ? 'on' : ''}" data-pw="push" ${pushOn ? 'disabled' : ''}><span class="sw2"></span><span><b>📲 ${t('Ειδοποιήσεις στο κινητό', 'Phone notifications', 'Handy-Benachrichtigungen')}</b><small>${pushOn ? t('Ενεργές σε αυτή τη συσκευή ✓', 'On for this device ✓', 'Auf diesem Gerät aktiv ✓') : t('Για να τις βλέπεις ακόμα κι αν το site είναι κλειστό.', 'See them even with the site closed.', 'Auch bei geschlossener Seite.')}</small></span></button>` : ''}
      <div class="pw-msg" id="pushMsg"></div>`;
  } else {
    title = '🎉 ' + t('Έτοιμο!', 'All set!', 'Fertig!'); sub = t('Το προφίλ σου είναι στημένο. Τα λέμε στο γήπεδο!', 'Your profile is ready. See you on court!', 'Dein Profil ist fertig. Bis auf dem Platz!');
    body = `<div class="pw-done"><div class="pw-photo big" style="${P.photo ? `background-image:url('${P.photo}')` : ''}">${P.photo ? '' : '🎾'}</div>
      <div class="pw-lvbig">${LV(W.level).icon} ${t('Επίπεδο', 'Level', 'Niveau')} ${W.level} · ${esc(lvName(W.level))}</div></div>`;
  }
  const dots = Array.from({ length: STEPS }, (_, i) => `<i class="${i < st ? 'done' : i === st ? 'cur' : ''}"></i>`).join('');
  o.innerHTML = `<div class="pw-box">
      <div class="pw-top"><div class="pw-dots">${st < STEPS ? dots : ''}</div><button type="button" class="pw-x" data-pw="close" aria-label="${t('Κλείσιμο', 'Close', 'Schließen')}">×</button></div>
      <div class="pw-body"><h2>${title}</h2><p class="pw-sub">${sub}</p>${body}</div>
      <div class="pw-foot">
        ${st > 0 && st < STEPS ? `<button type="button" class="pw-back" data-pw="back">‹ ${t('Πίσω', 'Back', 'Zurück')}</button>` : '<span></span>'}
        ${st < STEPS ? `<button type="button" class="pw-skip" data-pw="skip">${t('Παράλειψη', 'Skip', 'Überspringen')}</button>` : ''}
        <button type="button" class="pw-next" data-pw="${st < STEPS ? 'next' : 'finish'}" ${W.busy ? 'disabled' : ''}>${st < STEPS - 1 ? t('Επόμενο', 'Next', 'Weiter') + ' ›' : st === STEPS - 1 ? t('Τέλος', 'Finish', 'Fertig') + ' ✓' : t('Δες την κάρτα μου', 'See my card', 'Meine Karte')}</button>
      </div></div>`;
  const f = $('pwFile');
  if (f) f.onchange = async () => {
    const file = f.files && f.files[0]; if (!file) return;
    const m = $('pwMsg'); if (m) m.textContent = t('Ανέβασμα...', 'Uploading...', 'Hochladen...');
    try {
      const photo = await resizeSquare(file, 256);
      await setDoc(doc(db(), 'avatars', u.uid), { photo, updatedAt: serverTimestamp() });
      P.photo = photo; AV[u.uid] = Promise.resolve(photo); paintHeroAvatar(); paintWizard();
    } catch(e){ const m2 = $('pwMsg'); if (m2) m2.textContent = e.message; }
  };
}
/** Save what the current step collected, then move on. */
async function wizardSave(st){
  const u = window.currentUser && window.currentUser(); if (!u) return;
  let patch = null;
  if (st === 1) patch = { level: W.level, levelScale: 10 };
  if (st === 2) patch = { hand: W.hand, side: W.side, playMode: W.mode };
  if (st === 3) patch = { availability: { days: [...W.days].sort(), times: TIMES.map(x => x[0]).filter(k => W.times.has(k)) } };
  if (st === 4) patch = { onboarded: true };
  if (patch){
    await window.npFB.updateProfile(u.uid, patch);
    Object.assign(u, patch);
    if (st === 2){ P.hand = W.hand; P.side = W.side; P.mode = W.mode; }
    if (st === 1 && u.lookingForGame) window.npFB.upsertPublicProfile(u.uid, { level: W.level }).catch(() => {});
  }
  if (st === 4 || (st === 3 && P.alertOn)){
    if (st === 4) P.alertOn = W.alertOn;
    await window.npProfile.afterSave(u);
  }
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const tb = e.target.closest('[data-pptab]');
  if (tb){ TAB = tb.dataset.pptab; const u = window.currentUser && window.currentUser(); if (u) paintTabs(u); return; }
  const o = $('pwOv'); if (!o || !o.contains(e.target)) return;
  const el = e.target.closest('[data-pw],[data-pwlv],[data-pwhand],[data-pwside],[data-pwmode],[data-pwday],[data-pwtime],[data-pwpreset]'); if (!el) return;
  const d = el.dataset;
  if (d.pwlv){ W.level = +d.pwlv; return paintWizard(); }
  if (d.pwhand){ W.hand = W.hand === d.pwhand ? '' : d.pwhand; return paintWizard(); }
  if (d.pwside){ W.side = W.side === d.pwside ? '' : d.pwside; return paintWizard(); }
  if (d.pwmode){ W.mode = W.mode === d.pwmode ? '' : d.pwmode; return paintWizard(); }
  if (d.pwday != null){ const n = +d.pwday; W.days.has(n) ? W.days.delete(n) : W.days.add(n); return paintWizard(); }
  if (d.pwtime){ W.times.has(d.pwtime) ? W.times.delete(d.pwtime) : W.times.add(d.pwtime); return paintWizard(); }
  if (d.pwpreset){ W.days = new Set(d.pwpreset === 'week' ? [0,1,2,3,4] : d.pwpreset === 'weekend' ? [5,6] : [0,1,2,3,4,5,6]); return paintWizard(); }
  switch (d.pw){
    case 'photo': { const f = $('pwFile'); if (f) f.click(); break; }
    case 'alert': W.alertOn = !W.alertOn; paintWizard(); break;
    case 'push': if (window.npPush && window.npPush.enable){ await window.npPush.enable(); paintWizard(); } break;
    case 'close': closeWizard(true); break;
    case 'back': W.step = Math.max(0, W.step - 1); paintWizard(); break;
    case 'skip': if (W.step === STEPS - 1){ W.alertOn = P.alertOn; } W.step++; if (W.step >= STEPS) await wizardSave(4).catch(() => {}); paintWizard(); break;
    case 'next':
      W.busy = true; paintWizard();
      try { await wizardSave(W.step); W.step++; }
      catch(err){ alert(t('Δεν αποθηκεύτηκε', 'Not saved', 'Nicht gespeichert') + ': ' + err.message); }
      W.busy = false; paintWizard(); break;
    case 'finish': closeWizard(true);
      if (typeof window.renderFullProfile === 'function'){ TAB = 'stats'; try { window.renderFullProfile(); } catch(_) {} }
      break;
  }
});
document.addEventListener('click', (e) => {
  const u = typeof window.currentUser === 'function' ? window.currentUser() : null; if (!u) return;
  const a = e.target.closest('[data-pp]');
  if (a){
    if (a.dataset.pp === 'photo'){ const f = $('ppFile'); if (f) f.click(); }
    if (a.dataset.pp === 'share') shareCard(u).catch(err => alert(err.message));
    if (a.dataset.pp === 'wizard') openWizard();
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
    paintTabs(u);
    P.photo = await window.npAvatar(u.uid);
    paintAll(u); paintHeroAvatar();
    try { const s = await getDoc(doc(db(), 'og_alerts', u.uid)); P.alertOn = s.exists() && !!s.data().on; const el = $('ppAlertOn'); if (el) el.checked = P.alertOn; } catch(_) {}
    P.stats = await loadStats(u);
    if (P.uid === u.uid){ paintAll(u); paintHeroAvatar(); paintTabs(u); }
  },
  openWizard,
  setTab(tab){ TAB = tab; },
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
  hero(){
    const u = window.currentUser && window.currentUser();
    if (P.photo) paintHeroAvatar(); else if (u) window.npAvatar(u.uid).then(p => { if (p){ P.photo = p; paintHeroAvatar(); } });
    // First login after signup (or members who never did it): quick setup, once per visit.
    if (u && !u.onboarded && u.emailVerified){
      let shown = false; try { shown = !!sessionStorage.getItem('np_wiz'); sessionStorage.setItem('np_wiz', '1'); } catch(_) {}
      if (!shown) setTimeout(async () => { P.uid = u.uid; P.photo = await window.npAvatar(u.uid); try { const s = await getDoc(doc(db(), 'og_alerts', u.uid)); P.alertOn = s.exists() && !!s.data().on; } catch(_) {} openWizard(); }, 1200);
    }
  },
};
