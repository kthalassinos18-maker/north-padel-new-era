/* ============ PLAYER MENU — the logged-in panel as a game lobby ============
 * Replaces the old list in the auth panel (index.html → renderAuth) with:
 * player banner (photo, skill level, rank + XP bar), quick stats, a big
 * «ΚΛΕΙΣΕ ΓΗΠΕΔΟ» button (one tap to book), the next match with a countdown,
 * and big tiles for everything else. Settings/log-out live behind ⚙️.
 * The old elements stay hidden in the DOM so their handlers keep working.
 */
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const lang = () => { try { return localStorage.getItem('northPadelLang') || 'el'; } catch(_) { return 'el'; } };
const t = (el, en, de) => { const l = lang(); return l === 'en' ? (en || el) : l === 'de' ? (de || en || el) : el; };
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const lv10 = (u) => (window.npLv10 ? window.npLv10(u) : (+u.level || 1));
const LV = (n) => (window.NP_LEVELS || [])[(n || 1) - 1] || { icon: '🎾', el: '', en: '', de: '' };
const lvName = (n) => { const l = LV(n); return lang() === 'en' ? l.en : lang() === 'de' ? l.de : l.el; };
const upper = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const one = (n, el1, elN, en1, enN, de1, deN) => n === 1 ? t(el1, en1, de1) : t(elN, enN, deN);
const DAYS = { el: ['Κυρ','Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ'], en: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], de: ['So','Mo','Di','Mi','Do','Fr','Sa'] };

/* Rank from games played (like a season tier). */
const TIERS = [
  { min: 0, name: 'BRONZE', icon: '🥉', color: '#d79a63' },
  { min: 10, name: 'SILVER', icon: '🥈', color: '#c9d6e3' },
  { min: 25, name: 'GOLD', icon: '🥇', color: '#ffc14a' },
  { min: 50, name: 'PLATINUM', icon: '💠', color: '#7fe3ff' },
  { min: 100, name: 'DIAMOND', icon: '💎', color: '#b9a4ff' },
];
function rankOf(games){
  let i = 0; while (i < TIERS.length - 1 && games >= TIERS[i + 1].min) i++;
  const cur = TIERS[i], next = TIERS[i + 1];
  const pct = next ? Math.round((games - cur.min) / (next.min - cur.min) * 100) : 100;
  return { ...cur, next, pct, toNext: next ? next.min - games : 0 };
}

const M = { trophies: null, uid: null, photo: null, timer: null };

function closePanel(){ const p = $('authPanel'); if (p){ p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); } }
function openProfileTab(tab){
  if (window.npProfile && window.npProfile.setTab) window.npProfile.setTab(tab);
  const b = $('fullProfileBtn'); if (b) b.click();
}
function countdown(ms){
  const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d >= 1) return [d + t('μ', 'd', 'T') + ' ' + h + t('ώ', 'h', 'h'), t('ΑΠΟΜΕΝΟΥΝ', 'TO GO', 'NOCH')];
  if (h >= 1) return [h + t('ώ', 'h', 'h') + ' ' + pad(mm) + "'", t('ΑΠΟΜΕΝΟΥΝ', 'TO GO', 'NOCH')];
  return [mm + "'", t('ΑΠΟΜΕΝΟΥΝ', 'TO GO', 'NOCH')];
}

function render(u){
  const panel = $('authPanel'), prof = $('authProfile');
  if (!panel || !prof || !u) return;
  panel.classList.add('gm-on');
  let root = $('gmRoot');
  if (!root){ root = document.createElement('div'); root.id = 'gmRoot'; root.className = 'gm'; prof.prepend(root); }
  if (M.uid !== u.uid){ M.uid = u.uid; M.trophies = null; M.photo = null; }

  const today = todayISO();
  const all = (u.bookings || []).filter(b => b.status !== 'cancelled');
  const past = all.filter(b => (b.date || '') < today || ((b.date || '') === today && (b.startsAt || 0) < Date.now()));
  const games = Math.max(past.length, 0);
  const upcoming = all.filter(b => (b.startsAt || new Date((b.date || '') + 'T' + ((b.time || '00:00').split('-')[0]) + ':00').getTime()) > Date.now())
    .map(b => ({ ...b, at: b.startsAt || new Date(b.date + 'T' + (b.time || '00:00').split('-')[0] + ':00').getTime() }))
    .sort((a, b) => a.at - b.at);
  const next = upcoming[0];
  const rk = rankOf(games);
  const lv = lv10(u), L = LV(lv);
  const nm = ((u.name || '') + ' ' + (u.surname || '')).trim() || t('Παίχτης', 'Player', 'Spieler');
  const first = (u.name || '').trim().split(' ')[0];
  const og = window.npOG || {};
  const openN = og.openCount ? og.openCount() : 0, unread = og.unread ? og.unread() : 0;
  const offers = (u.welcomeCoupon ? 1 : 0) + ((u.couponPct || 0) > 0 ? 1 : 0) + ((u.freeCourts || 0) > 0 ? 1 : 0);
  const isAdmin = window.npFB && window.npFB.isAdmin && window.npFB.isAdmin(u);
  const R = 34, C = 2 * Math.PI * R;
  const dn = next ? new Date(next.at) : null;
  const [cdv, cdl] = next ? countdown(next.at - Date.now()) : ['', ''];

  root.innerHTML = `
    <div class="gm-bar gm-in">
      <span class="gm-hi">${t('ΚΑΛΩΣ ΗΡΘΕΣ', 'WELCOME BACK', 'WILLKOMMEN')}${first ? ', ' + esc(upper(first)) : ''}</span>
      <button type="button" class="gm-ico" data-gm="notes" aria-label="${t('Ειδοποιήσεις', 'Notifications', 'Hinweise')}">🔔${unread ? `<span class="dot">${unread}</span>` : ''}</button>
      <button type="button" class="gm-ico" data-gm="settings" aria-label="${t('Ρυθμίσεις', 'Settings', 'Einstellungen')}">⚙️</button>
    </div>

    <button type="button" class="gm-player gm-in" style="animation-delay:.05s" data-gm="card">
      <span class="gm-ava">
        <svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="${R}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="4"/><circle cx="38" cy="38" r="${R}" fill="none" stroke="${rk.color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - rk.pct / 100)}"/></svg>
        <span class="ph" id="gmPh">${esc(nm.charAt(0).toUpperCase())}</span>
        <span class="lvl" title="${t('Επίπεδο', 'Level', 'Niveau')}">${lv}</span>
      </span>
      <span style="min-width:0;flex:1">
        <span class="gm-name">${esc(nm)}</span>
        <span class="gm-rank" style="color:${rk.color}">${rk.icon} ${rk.name} · <span style="color:#b7ff4a">${L.icon} ${esc(lvName(lv))}</span></span>
        <span class="gm-xp"><span class="bar"><i style="width:${rk.pct}%"></i></span>
          <small>${rk.next ? games + ' ' + t('ΠΑΙΧΝΙΔΙΑ', 'GAMES', 'SPIELE') + ' · ' + rk.toNext + ' ' + t('ΓΙΑ', 'TO', 'BIS') + ' ' + rk.next.icon + ' ' + rk.next.name : t('ΑΝΩΤΑΤΟ RANK!', 'MAX RANK!', 'MAX RANG!')}</small></span>
      </span>
    </button>

    <div class="gm-stats gm-in" style="animation-delay:.1s">
      <div><b>${games}</b><small>${t('ΠΑΙΧΝΙΔΙΑ', 'GAMES', 'SPIELE')}</small></div>
      <div><b>${Math.round(games * 1.5)}</b><small>${t('ΩΡΕΣ', 'HOURS', 'STUNDEN')}</small></div>
      <div><b id="gmTro">${M.trophies == null ? '–' : M.trophies}</b><small>${t('ΤΡΟΠΑΙΑ', 'TROPHIES', 'POKALE')}</small></div>
      <div><b>${upcoming.length}</b><small>${t('ΕΠΟΜΕΝΑ', 'UPCOMING', 'KOMMEND')}</small></div>
    </div>

    <button type="button" class="gm-play gm-in" style="animation-delay:.15s" data-gm="book">
      <span class="pi">▶</span>
      <span><b>${t('ΚΛΕΙΣΕ ΓΗΠΕΔΟ', 'BOOK A COURT', 'PLATZ BUCHEN')}</b><small>${t('Διάλεξε μέρα & ώρα — σε 3 πατήματα', 'Pick day & time — 3 taps', 'Tag & Zeit wählen — 3 Tipps')}</small></span>
    </button>

    ${next ? `<button type="button" class="gm-next gm-in" style="animation-delay:.2s" data-gm="mygames">
      <span><span class="k">⚡ ${t('ΕΠΟΜΕΝΟΣ ΑΓΩΝΑΣ', 'NEXT MATCH', 'NÄCHSTES SPIEL')}</span>
        <b>${esc((DAYS[lang()] || DAYS.el)[dn.getDay()])} ${pad(dn.getDate())}/${pad(dn.getMonth() + 1)} · ${esc((next.time || '').replace('-', '–'))}</b>
        <span style="font-size:11px;color:rgba(244,249,255,0.55)">${esc(next.court || '')}${next.openGameId ? ' · 👥 ' + t('ανοιχτό παιχνίδι', 'open game', 'offenes Spiel') : ''}</span></span>
      <span class="cd">${cdv}<small>${cdl}</small></span>
    </button>` : ''}

    <div class="gm-grid gm-in" style="animation-delay:.25s">
      <button type="button" class="gm-tile blue" data-gm="find"><span class="ti">👥</span><b>${t('ΒΡΕΣ ΠΑΙΧΤΗ', 'FIND A PLAYER', 'SPIELER FINDEN')}</b><small> ${openN ? openN + ' ' + one(openN, 'ανοιχτό παιχνίδι', 'ανοιχτά παιχνίδια', 'open game', 'open games', 'offenes Spiel', 'offene Spiele') : t('Μπες σε παιχνίδι ή βρες 4ο', 'Join a game or find a 4th', 'Spiel beitreten')}</small>${openN ? `<span class="badge">${openN}</span>` : ''}</button>
      <button type="button" class="gm-tile" data-gm="mygames"><span class="ti">🎾</span><b>${t('ΤΑ ΠΑΙΧΝΙΔΙΑ ΜΟΥ', 'MY GAMES', 'MEINE SPIELE')}</b><small> ${upcoming.length ? upcoming.length + ' ' + one(upcoming.length, 'επόμενο', 'επόμενα', 'upcoming', 'upcoming', 'kommend', 'kommend') : t('Κρατήσεις & ιστορικό', 'Bookings & history', 'Buchungen & Verlauf')}</small></button>
      <button type="button" class="gm-tile" data-gm="card"><span class="ti">🃏</span><b>${t('Η ΚΑΡΤΑ ΜΟΥ', 'MY CARD', 'MEINE KARTE')}</b><small>${t('Στατιστικά & επιτεύγματα', 'Stats & achievements', 'Statistik & Erfolge')}</small></button>
      <button type="button" class="gm-tile" data-gm="notes"><span class="ti">🔔</span><b>${t('ΕΙΔΟΠΟΙΗΣΕΙΣ', 'NOTIFICATIONS', 'HINWEISE')}</b><small> ${unread ? unread + ' ' + one(unread, 'νέα', 'νέες', 'new', 'new', 'neu', 'neu') : t('Όλα ήσυχα', 'All quiet', 'Alles ruhig')}</small>${unread ? `<span class="badge red">${unread}</span>` : ''}</button>
      ${offers ? `<button type="button" class="gm-tile gold" data-gm="offers"><span class="ti">🎁</span><b>${t('ΠΡΟΣΦΟΡΕΣ', 'OFFERS', 'ANGEBOTE')}</b><small>${u.welcomeCoupon ? t('−10% στην πρώτη κράτηση', '−10% on your first booking', '−10% auf die erste Buchung') : (u.freeCourts || 0) > 0 ? u.freeCourts + ' ' + t('δωρεάν γήπεδα', 'free courts', 'Gratis-Plätze') : '−' + u.couponPct + '%'}</small><span class="badge">${offers}</span></button>` : ''}
      <button type="button" class="gm-tile" data-gm="edit"><span class="ti">✏️</span><b>${t('ΤΑ ΣΤΟΙΧΕΙΑ ΜΟΥ', 'MY DETAILS', 'MEINE DATEN')}</b><small>${t('Επίπεδο, στυλ, πότε παίζω', 'Level, style, when I play', 'Niveau, Stil, Zeiten')}</small></button>
      ${isAdmin ? `<a class="gm-tile wide gold" href="admin.html" style="text-decoration:none"><span class="ti">🔐</span><b>ADMIN PANEL</b></a>` : ''}
    </div>

    ${!u.emailVerified ? `<div class="gm-note gm-in"><b>⚠ ${t('Επιβεβαίωσε το email σου', 'Verify your email', 'Bestätige deine E-Mail')}</b><br>${t('Στείλαμε σύνδεσμο στο', 'We sent a link to', 'Link gesendet an')} ${esc(u.email)}.<br><button type="button" data-gm="verify">📧 ${t('Ξαναστείλε', 'Resend', 'Erneut senden')}</button></div>` : ''}
    ${u.emailVerified && !u.welcomeCoupon && !((u.couponPct || 0) > 0) && !((u.freeCourts || 0) > 0) && !(u.bookingsCount > 0) ? `<div class="gm-note gm-in"><b>⏳ ${t('Κουπόνι σε αναμονή', 'Coupon pending', 'Gutschein ausstehend')}</b><br>${t('Το −10% της πρώτης κράτησης ενεργοποιείται σύντομα.', 'Your −10% first-booking coupon will be activated soon.', 'Dein −10% Gutschein wird bald aktiviert.')}</div>` : ''}

    <div class="gm-sheet" id="gmSheet"><div class="in">
      <h4>⚙️ ${t('ΡΥΘΜΙΣΕΙΣ', 'SETTINGS', 'EINSTELLUNGEN')}</h4>
      <button type="button" class="gm-row" data-gm="wizard"><span class="ri">✨</span>${t('Γρήγορο στήσιμο προφίλ', 'Quick profile setup', 'Profil schnell einrichten')}</button>
      <button type="button" class="gm-row" data-gm="pw"><span class="ri">🔒</span>${t('Αλλαγή κωδικού', 'Change password', 'Passwort ändern')}</button>
      <a class="gm-row" href="/legal" target="_blank" rel="noopener" style="text-decoration:none"><span class="ri">📄</span>${t('Όροι & Απόρρητο', 'Terms & Privacy', 'AGB & Datenschutz')}</a>
      <button type="button" class="gm-row out" data-gm="logout"><span class="ri">⏻</span>${t('Αποσύνδεση', 'Log out', 'Abmelden')}</button>
      <button type="button" class="gm-row" data-gm="sheetclose" style="justify-content:center;color:rgba(244,249,255,0.6)">${t('Κλείσιμο', 'Close', 'Schließen')}</button>
    </div></div>`;

  // Photo + trophies arrive asynchronously.
  const paintPh = (ph) => { const el = $('gmPh'); if (el && ph){ el.style.backgroundImage = `url('${ph}')`; el.textContent = ''; } };
  if (M.photo) paintPh(M.photo);
  else if (window.npAvatar) window.npAvatar(u.uid).then(ph => { M.photo = ph; paintPh(ph); });
  if (M.trophies == null && window.npFB && window.npFB.db){
    getDocs(query(collection(window.npFB.db, 'trophies'), where('uids', 'array-contains', u.uid)))
      .then(s => { M.trophies = s.size; const el = $('gmTro'); if (el) el.textContent = M.trophies; }).catch(() => { M.trophies = 0; });
  }
  clearInterval(M.timer);
  if (next) M.timer = setInterval(() => { const p = $('authPanel'); if (p && p.classList.contains('open')) render(u); }, 60000);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-gm]'); if (!el || !$('gmRoot') || !$('gmRoot').contains(el)) return;
  const sheet = $('gmSheet');
  switch (el.dataset.gm){
    case 'book': closePanel(); setTimeout(() => { const b = $('ctaBtn'); if (b) b.click(); }, 250); break;
    case 'find': closePanel(); setTimeout(() => { if (window.npOG && window.npOG.show) window.npOG.show('open'); }, 250); break;
    case 'notes': closePanel(); setTimeout(() => { if (window.npOG && window.npOG.show) window.npOG.show('notes'); }, 250); break;
    case 'mygames': openProfileTab('book'); break;
    case 'card': openProfileTab('stats'); break;
    case 'offers': openProfileTab('book'); break;
    case 'edit': openProfileTab('info'); break;
    case 'settings': if (sheet) sheet.classList.add('open'); break;
    case 'sheetclose': if (sheet) sheet.classList.remove('open'); break;
    case 'wizard': if (sheet) sheet.classList.remove('open'); closePanel(); if (window.npProfile && window.npProfile.openWizard) setTimeout(() => window.npProfile.openWizard(), 250); break;
    case 'pw': if (sheet) sheet.classList.remove('open'); { const b = $('changePwBtn'); if (b) b.click(); } break;
    case 'verify': { const b = $('resendVerifyBtn'); if (b) b.click(); } break;
    case 'logout': if (sheet) sheet.classList.remove('open'); { const b = $('authLogout'); if (b) b.click(); } break;
  }
});
// Tap outside the settings card closes it.
document.addEventListener('click', (e) => { const s = $('gmSheet'); if (s && s.classList.contains('open') && e.target === s) s.classList.remove('open'); });
// Live counters (open games, unread notifications).
window.addEventListener('npOGUpdate', () => { const p = $('authPanel'); const u = window.currentUser && window.currentUser(); if (p && p.classList.contains('gm-on') && u) render(u); });

window.npMenu = {
  render,
  off(){ const p = $('authPanel'); if (p) p.classList.remove('gm-on'); const r = $('gmRoot'); if (r) r.remove(); clearInterval(M.timer); M.uid = null; },
};

// The module may load after the first renderAuth(): draw now if a member is signed in.
(function boot(){
  const u = window.currentUser && window.currentUser();
  const prof = $('authProfile');
  if (u && prof && prof.style.display !== 'none') render(u);
})();
