/* ============ AMERICANO (admin section) ============
 * Tournament manager: players roster, Americano scheduling, live scoring,
 * standings, history, photos & trophies. Admin-only.
 *
 * Firestore collections (all admin-only, see firestore.rules):
 *   americano_players/{id}      roster: name, phone, level, notes, photo (small data URL)
 *   americano_tournaments/{id}  name, date, pts, courts, players[], matches[], status, notes, winners[], photoCount
 *   americano_photos/{id}       tournamentId, kind ('photo'|'trophy'), caption, thumb (small data URL)
 *   americano_photo_full/{id}   same id as americano_photos, holds the full-size image (data URL)
 * Photos are stored compressed inside Firestore (no Firebase Storage needed).
 */
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  query, where, orderBy, serverTimestamp, writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const C_PLAYERS = 'americano_players';
const C_TOURS = 'americano_tournaments';
const C_PHOTOS = 'americano_photos';
const C_FULL = 'americano_photo_full';
const PTS_OPTIONS = [8, 11, 16, 21, 24, 32];
const LEVELS = ['', 'Αρχάριος', 'Μέτριος', 'Προχωρημένος'];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tl = (x) => Array.isArray(x) ? x.join(' / ') : String(x || '');
const norm = (s) => String(s || '').trim().toLowerCase();
function today(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fd(s){ if (!s) return ''; const p = s.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }
function waitFB(){
  return new Promise(r => window.npFB ? r() : window.addEventListener('npFBReady', r, { once: true }));
}
const db = () => window.npFB.db;
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(_) { return null; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }
function lsDel(k){ try { localStorage.removeItem(k); } catch(_) {} }

/* ---------- state ---------- */
const A = {
  view: 'list',          // list | new | players | tour
  loaded: false,
  loading: false,
  players: [],
  tours: [],
  tourId: null,
  photos: [],            // photo metadata for the open tournament
  photosFor: null,
  editPlayer: null,      // player being edited (object) or null
  draft: lsGet('np_am_draft') || { name: '', date: today(), pl: Array(8).fill(''), courts: 1, pts: 21 },
};
if (!Array.isArray(A.draft.pl) || A.draft.pl.length !== 8) A.draft.pl = Array(8).fill('');
const saveDraft = () => lsSet('np_am_draft', A.draft);

/* ---------- data access ---------- */
async function loadAll(){
  await waitFB();
  A.loading = true;
  const [ps, ts] = await Promise.all([
    getDocs(collection(db(), C_PLAYERS)),
    getDocs(query(collection(db(), C_TOURS), orderBy('date', 'desc'))),
  ]);
  A.players = ps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'el'));
  A.tours = ts.docs.map(d => ({ id: d.id, ...d.data() }));
  A.loaded = true;
  A.loading = false;
}
const curTour = () => A.tours.find(t => t.id === A.tourId) || null;
async function saveTour(t, patch){
  Object.assign(t, patch);
  await updateDoc(doc(db(), C_TOURS, t.id), { ...patch, updatedAt: serverTimestamp() });
}
async function loadPhotos(tid){
  const snap = await getDocs(query(collection(db(), C_PHOTOS), where('tournamentId', '==', tid)));
  A.photos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));
  A.photosFor = tid;
}

/* ---------- scheduling (same algorithm as the North Padel Tournaments app) ---------- */
function circle(list){
  const l = list.slice(), R = [];
  if (l.length % 2) l.push(null);
  const n = l.length;
  for (let r = 0; r < n - 1; r++){
    const ps = [];
    for (let i = 0; i < n / 2; i++){ const x = l[i], y = l[n - 1 - i]; if (x != null && y != null) ps.push([x, y]); }
    R.push(ps);
    l.splice(1, 0, l.pop());
  }
  return R;
}
function amSched(P, courts){
  const R = circle(P), M = [], left = [], opp = {}, par = {};
  const key = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  const cnt = (o, a, b) => o[key(a, b)] || 0;
  const inc = (o, a, b) => { o[key(a, b)] = cnt(o, a, b) + 1; };
  const cost = (p, q) => { let c = 0; p.forEach(x => q.forEach(y => { c += cnt(opp, x, y); })); return c; };
  const mk = (p, q, g, c) => {
    M.push({ g, c, a: p, b: q, sa: null, sb: null });
    inc(par, p[0], p[1]); inc(par, q[0], q[1]);
    p.forEach(x => q.forEach(y => inc(opp, x, y)));
  };
  R.forEach((ps, ri) => {
    if (ps.length === 4){
      const sp = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
      let best = null, bc = 1e9;
      sp.forEach(z => { const c = cost(ps[z[0]], ps[z[1]]) + cost(ps[z[2]], ps[z[3]]); if (c < bc){ bc = c; best = z; } });
      mk(ps[best[0]], ps[best[1]], ri, 1); mk(ps[best[2]], ps[best[3]], ri, 2);
    } else if (ps.length >= 2){
      mk(ps[0], ps[1], ri, 1);
      if (ps.length === 3) left.push(ps[2]);
    }
  });
  while (left.length){
    const p = left.shift();
    let qi = -1, q = null;
    for (let i = 0; i < left.length; i++){ if (!left[i].some(x => p.indexOf(x) >= 0)){ qi = i; break; } }
    if (qi >= 0) q = left.splice(qi, 1)[0];
    else {
      let bc2 = 1e9;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++){
        if (p.indexOf(P[i]) >= 0 || p.indexOf(P[j]) >= 0) continue;
        const c2 = cnt(par, P[i], P[j]);
        if (c2 < bc2){ bc2 = c2; q = [P[i], P[j]]; }
      }
    }
    mk(p, q);
  }
  M.forEach((m, i) => {
    if (courts === 2 && m.g != null) m.r = m.g + 1; else { m.r = i + 1; m.c = 1; }
    delete m.g;
  });
  return M;
}

/* ---------- standings ---------- */
function standings(T){
  const st = {}; let done = 0;
  (T.players || []).forEach(x => { st[x] = { n: x, g: 0, w: 0, f: 0 }; });
  (T.matches || []).forEach(m => {
    if (m.sa == null) return;
    done++;
    m.a.forEach(x => { if (!st[x]) return; st[x].g++; st[x].f += m.sa; if (m.sa > m.sb) st[x].w++; });
    m.b.forEach(x => { if (!st[x]) return; st[x].g++; st[x].f += m.sb; if (m.sb > m.sa) st[x].w++; });
  });
  const rows = Object.values(st);
  const eq = rows.every(r => r.g === (rows[0] ? rows[0].g : 0));
  const av = (r) => r.g ? r.f / r.g : 0;
  rows.sort((x, y) => eq ? (y.f - x.f || y.w - x.w) : (av(y) - av(x) || y.w - x.w));
  return { rows, done, total: (T.matches || []).length, eq, av };
}

/* ---------- images ---------- */
function readImage(file){
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Μη έγκυρη εικόνα')); im.src = rd.result; };
    rd.onerror = () => rej(new Error('Αποτυχία ανάγνωσης αρχείου'));
    rd.readAsDataURL(file);
  });
}
function drawScaled(im, maxSide, square){
  const c = document.createElement('canvas');
  if (square){
    const s = Math.min(im.width, im.height);
    c.width = c.height = maxSide;
    c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, maxSide, maxSide);
  } else {
    const k = Math.min(1, maxSide / Math.max(im.width, im.height));
    c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  }
  return c;
}
// Full image must fit comfortably inside a 1 MiB Firestore document.
function fullDataUrl(im){
  const tries = [[1600, 0.82], [1600, 0.7], [1280, 0.7], [1024, 0.65], [800, 0.6]];
  for (const [side, q] of tries){
    const u = drawScaled(im, side, false).toDataURL('image/jpeg', q);
    if (u.length < 700000) return u;
  }
  return drawScaled(im, 640, false).toDataURL('image/jpeg', 0.55);
}

/* ---------- modal plumbing ---------- */
function modal(html, cls){
  const prev = $('amModal'); if (prev) prev.remove();
  const m = document.createElement('div');
  m.className = 'mem-modal open';
  m.id = 'amModal';
  m.innerHTML = `<div class="mem-card ${cls || ''}"><button class="mem-close" type="button" data-am="close" aria-label="Κλείσιμο">×</button>${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  document.body.appendChild(m);
  return m;
}
function closeModal(){
  const m = $('amModal'); if (m) m.remove();
  // Closing the scoreboard re-renders so an unfinished score shows in the match list.
  const wasScore = SB.cur != null;
  SB.cur = null;
  if (wasScore && A.view === 'tour') render();
}

/* ============ RENDER ============ */
function root(){ return $('amRoot'); }

function render(){
  const r = root(); if (!r) return;
  const tabs = `<div class="am-tabs">
      <button class="am-tab ${A.view === 'list' || A.view === 'tour' ? 'on' : ''}" data-am="view" data-v="list">🏆 Τουρνουά</button>
      <button class="am-tab ${A.view === 'new' ? 'on' : ''}" data-am="view" data-v="new">➕ Νέο Americano</button>
      <button class="am-tab ${A.view === 'players' ? 'on' : ''}" data-am="view" data-v="players">👥 Παίχτες</button>
    </div>`;
  if (!A.loaded){
    r.innerHTML = tabs + `<div class="panel"><div class="am-empty">${A.loadError ? '<span style="color:#ff6b6b">Αποτυχία φόρτωσης: ' + esc(A.loadError) + '</span>' : 'Φόρτωση...'}</div></div>`;
    return;
  }
  let body = '';
  if (A.view === 'list') body = viewList();
  else if (A.view === 'new') body = viewNew();
  else if (A.view === 'players') body = viewPlayers();
  else if (A.view === 'tour') body = viewTour();
  r.innerHTML = tabs + body;
  if (A.view === 'tour') afterTour();
}

/* ---------- list ---------- */
function tourRow(t){
  const s = standings(t);
  const fin = t.status === 'finished';
  const win = (t.winners && t.winners.length) ? t.winners[0] : (fin && s.rows[0] ? s.rows[0].n : '');
  const sub = [fd(t.date), (t.players || []).length + ' παίχτες', (t.pts || 21) + ' πόντοι', (t.courts === 2 ? '2 γήπεδα' : '1 γήπεδο'), s.done + '/' + s.total + ' αγώνες']
    .concat(t.photoCount ? ['📸 ' + t.photoCount] : []).join(' · ');
  return `<button class="am-row" data-am="open" data-id="${esc(t.id)}">
      <div class="am-row-main">
        <div class="am-row-t">${fin ? '' : '<span class="am-live-dot"></span>'}${esc(t.name || 'Americano')}</div>
        <div class="am-row-s">${esc(sub)}</div>
      </div>
      <div class="am-row-r">${fin ? (win ? '🏆 ' + esc(win) : 'ΟΛΟΚΛΗΡΩΘΗΚΕ') : 'ΣΕ ΕΞΕΛΙΞΗ'}</div>
    </button>`;
}
function viewList(){
  const active = A.tours.filter(t => t.status !== 'finished');
  const done = A.tours.filter(t => t.status === 'finished');
  const stats = `<div class="stat-grid am-stats">
      <div class="stat"><div class="stat-label">ΤΟΥΡΝΟΥΑ</div><div class="stat-value">${A.tours.length}</div></div>
      <div class="stat"><div class="stat-label">ΣΕ ΕΞΕΛΙΞΗ</div><div class="stat-value">${active.length}</div></div>
      <div class="stat"><div class="stat-label">ΠΑΙΧΤΕΣ</div><div class="stat-value">${A.players.length}</div></div>
    </div>`;
  return stats + `
    <div class="panel"><h3>🟢 ΣΕ ΕΞΕΛΙΞΗ</h3>
      ${active.length ? '<div class="am-list">' + active.map(tourRow).join('') + '</div>'
        : '<div class="am-empty">Κανένα τουρνουά σε εξέλιξη.<br><br><button class="am-btn-main" data-am="view" data-v="new">➕ ΝΕΟ AMERICANO</button></div>'}
    </div>
    <div class="panel"><h3>📚 ΙΣΤΟΡΙΚΟ</h3>
      ${done.length ? '<div class="am-list">' + done.map(tourRow).join('') + '</div>'
        : '<div class="am-empty">Τα ολοκληρωμένα τουρνουά θα εμφανίζονται εδώ.</div>'}
    </div>`;
}

/* ---------- new tournament ---------- */
function draftNames(){ return A.draft.pl.map(x => (x || '').trim()).filter(Boolean); }
function viewNew(){
  const D = A.draft, n = draftNames().length;
  if (n !== 8 && D.courts === 2) D.courts = 1;
  const inputs = D.pl.map((v, i) => `<input class="am-in" data-am-pl="${i}" maxlength="24" placeholder="Παίχτης ${i + 1}" value="${esc(v)}">`).join('');
  const lowSel = D.pl.map(norm);
  const chips = A.players.length ? A.players.map(p => {
    const on = lowSel.indexOf(norm(p.name)) >= 0;
    return `<button type="button" class="am-chip ${on ? 'on' : ''}" data-am="pick" data-name="${esc(p.name)}">${avatar(p, 'sm')}${esc(p.name)}</button>`;
  }).join('') : '<span class="am-muted">Δεν υπάρχουν αποθηκευμένοι παίχτες. Πρόσθεσε στην καρτέλα «Παίχτες» για να τους επιλέγεις με ένα πάτημα.</span>';
  const note = (n !== 8 ? 'Τα 2 γήπεδα θέλουν ακριβώς 8 παίχτες. ' : '') + ((n === 6 || n === 7) ? 'Με ' + n + ' παίχτες κάποιος θα παίξει έναν αγώνα παραπάνω.' : '');
  return `<div class="panel">
      <h3>➕ ΝΕΟ AMERICANO</h3>
      <div class="form-grid">
        <div class="field"><label>ΤΙΤΛΟΣ</label><input class="am-in" id="amName" maxlength="60" placeholder="π.χ. Friday Night Americano" value="${esc(D.name)}"></div>
        <div class="field"><label>ΗΜΕΡΟΜΗΝΙΑ</label><input class="am-in" id="amDate" type="date" value="${esc(D.date || today())}"></div>
      </div>
      <div class="am-lab">ΠΑΙΧΤΕΣ (4 ΕΩΣ 8) · ${n}/8</div>
      <div class="am-pgrid">${inputs}</div>
      <div class="am-lab">ΑΠΟΘΗΚΕΥΜΕΝΟΙ ΠΑΙΧΤΕΣ (ΠΑΤΑ ΓΙΑ ΕΠΙΛΟΓΗ)</div>
      <div class="am-chips">${chips}</div>
      <div class="am-lab">ΓΗΠΕΔΑ</div>
      <div class="am-chips">
        <button type="button" class="am-chip txt ${D.courts === 1 ? 'on' : ''}" data-am="courts" data-n="1">1 γήπεδο</button>
        <button type="button" class="am-chip txt ${D.courts === 2 ? 'on' : ''}" data-am="courts" data-n="2" ${n !== 8 ? 'disabled' : ''}>2 γήπεδα</button>
      </div>
      <div class="am-muted" style="margin-top:6px">${esc(note)}</div>
      <div class="am-lab">ΠΟΝΤΟΙ ΑΝΑ ΑΓΩΝΑ</div>
      <div class="am-chips">${PTS_OPTIONS.map(p => `<button type="button" class="am-chip txt ${D.pts === p ? 'on' : ''}" data-am="pts" data-n="${p}">${p}</button>`).join('')}</div>
      <div class="am-muted" style="margin-top:6px">Στο Americano συνήθως παίζουν 16, 21, 24 ή 32 πόντους ανά αγώνα. Κάθε πόντος μετράει στον καθένα από το ζευγάρι.</div>
      <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
        <button class="am-btn-main" data-am="create" style="flex:1">ΔΗΜΙΟΥΡΓΙΑ AMERICANO</button>
        <button class="btn" data-am="cleardraft">Καθαρισμός</button>
      </div>
      <div class="am-err" id="amNewErr"></div>
    </div>`;
}
async function createTour(btn){
  const D = A.draft, err = $('amNewErr');
  const ns = draftNames(), low = ns.map(norm);
  if (ns.length < 4){ err.textContent = 'Βάλε τουλάχιστον 4 παίχτες.'; return; }
  if (low.some((x, i) => low.indexOf(x) !== i)){ err.textContent = 'Υπάρχουν ίδια ονόματα. Βάλε διαφορετικά.'; return; }
  const courts = (ns.length === 8 && D.courts === 2) ? 2 : 1;
  const t = {
    name: (D.name || '').trim() || 'Americano',
    date: D.date || today(),
    pts: D.pts || 21,
    courts,
    players: ns,
    matches: amSched(ns, courts),
    status: 'active',
    notes: '',
    winners: [],
    photoCount: 0,
  };
  btn.disabled = true; err.textContent = 'Δημιουργία...';
  try {
    const ref = await addDoc(collection(db(), C_TOURS), { ...t, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    A.tours.unshift({ id: ref.id, ...t });
    A.draft = { name: '', date: today(), pl: Array(8).fill(''), courts: 1, pts: D.pts || 21 };
    saveDraft();
    openTour(ref.id);
  } catch(e){
    btn.disabled = false;
    err.textContent = 'Αποτυχία: ' + e.message + (e.code === 'permission-denied' ? ' — χρειάζεται ενημέρωση των Firestore Rules.' : '');
  }
}

/* ---------- players ---------- */
function avatar(p, cls){
  if (p && p.photo) return `<img class="am-av ${cls || ''}" src="${esc(p.photo)}" alt="">`;
  const ch = ((p && p.name) || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="am-av ${cls || ''}">${esc(ch)}</span>`;
}
const playerByName = (n) => A.players.find(p => norm(p.name) === norm(n)) || null;
function playerStats(name){
  let played = 0, titles = 0, pts = 0;
  A.tours.forEach(t => {
    if (!(t.players || []).some(x => norm(x) === norm(name))) return;
    played++;
    const s = standings(t);
    const r = s.rows.find(x => norm(x.n) === norm(name));
    if (r) pts += r.f;
    if (t.status === 'finished' && s.rows[0] && norm(s.rows[0].n) === norm(name)) titles++;
  });
  return { played, titles, pts };
}
function viewPlayers(){
  const rows = A.players.map(p => {
    const s = playerStats(p.name);
    const sub = [p.level, p.phone, s.played ? s.played + ' τουρνουά' : '', s.titles ? '🏆 ' + s.titles : ''].filter(Boolean).join(' · ');
    return `<button class="am-row" data-am="editplayer" data-id="${esc(p.id)}">
        ${avatar(p)}
        <div class="am-row-main"><div class="am-row-t">${esc(p.name)}</div>${sub ? `<div class="am-row-s">${esc(sub)}</div>` : ''}</div>
        <div class="am-row-r">✎</div>
      </button>`;
  }).join('');
  return `<div class="panel">
      <h3>👥 ΠΑΙΧΤΕΣ <span class="actions"><span class="pill" style="background:rgba(255,255,255,0.08);color:rgba(244,249,255,0.6)">${A.players.length}</span>
        <button class="btn" data-am="newplayer">+ ΝΕΟΣ ΠΑΙΧΤΗΣ</button></span></h3>
      ${A.players.length ? '<div class="am-list">' + rows + '</div>' : '<div class="am-empty">Δεν υπάρχουν αποθηκευμένοι παίχτες.</div>'}
    </div>`;
}
function openPlayerEditor(p){
  A.editPlayer = p ? { ...p } : { id: null, name: '', phone: '', level: '', notes: '', photo: '' };
  const E = A.editPlayer;
  const st = p ? playerStats(p.name) : null;
  modal(`
    <h2 class="mem-title">${p ? 'Επεξεργασία Παίχτη' : 'Νέος Παίχτης'}</h2>
    <div style="text-align:center;margin-bottom:12px"><span id="amPAv" data-am="pickphoto">${avatar(E, 'big')}</span></div>
    <input type="file" id="amPFile" accept="image/*" hidden>
    <div style="display:flex;gap:8px;justify-content:center;margin-bottom:14px">
      <button class="btn" data-am="pickphoto">📷 Φωτογραφία</button>
      <button class="btn" data-am="rmphoto">Αφαίρεση φωτό</button>
    </div>
    ${st && st.played ? `<p class="am-muted" style="text-align:center;margin-bottom:12px">${st.played} τουρνουά · ${st.titles} τίτλοι 🏆 · ${st.pts} πόντοι συνολικά</p>` : ''}
    <div class="form-grid">
      <div class="field"><label>ΟΝΟΜΑ *</label><input class="am-in" id="amPName" maxlength="24" value="${esc(E.name)}"></div>
      <div class="field"><label>ΤΗΛΕΦΩΝΟ</label><input class="am-in" id="amPPhone" type="tel" maxlength="20" value="${esc(E.phone)}"></div>
      <div class="field"><label>ΕΠΙΠΕΔΟ</label><select class="am-in" id="amPLevel">${LEVELS.map(l => `<option value="${esc(l)}" ${l === (E.level || '') ? 'selected' : ''}>${esc(l || '—')}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-top:14px"><label>ΣΗΜΕΙΩΣΕΙΣ</label><textarea class="am-in" id="amPNotes" rows="3" maxlength="300" placeholder="π.χ. αριστερόχειρας, διαθεσιμότητα">${esc(E.notes)}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
      <button class="am-btn-main" data-am="saveplayer" style="flex:1">💾 ΑΠΟΘΗΚΕΥΣΗ</button>
      ${p ? '<button class="btn danger" data-am="delplayer">Διαγραφή</button>' : ''}
    </div>
    <div class="am-err" id="amPErr"></div>`);
  $('amPFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const im = await readImage(f); E.photo = drawScaled(im, 160, true).toDataURL('image/jpeg', 0.78); $('amPAv').innerHTML = avatar(E, 'big'); }
    catch(ex){ $('amPErr').textContent = ex.message; }
  });
}
async function savePlayer(btn){
  const E = A.editPlayer, err = $('amPErr');
  E.name = $('amPName').value.trim();
  E.phone = $('amPPhone').value.trim();
  E.level = $('amPLevel').value;
  E.notes = $('amPNotes').value.trim();
  if (!E.name){ err.textContent = 'Γράψε όνομα.'; return; }
  if (A.players.some(p => p.id !== E.id && norm(p.name) === norm(E.name))){ err.textContent = 'Υπάρχει ήδη παίχτης με αυτό το όνομα.'; return; }
  const data = { name: E.name, phone: E.phone, level: E.level, notes: E.notes, photo: E.photo || '' };
  btn.disabled = true; err.textContent = 'Αποθήκευση...';
  try {
    if (E.id){
      await updateDoc(doc(db(), C_PLAYERS, E.id), { ...data, updatedAt: serverTimestamp() });
      Object.assign(A.players.find(p => p.id === E.id), data);
    } else {
      const ref = await addDoc(collection(db(), C_PLAYERS), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      A.players.push({ id: ref.id, ...data });
    }
    A.players.sort((a, b) => a.name.localeCompare(b.name, 'el'));
    closeModal(); render();
  } catch(e){ btn.disabled = false; err.textContent = 'Αποτυχία: ' + e.message; }
}
async function delPlayer(){
  const E = A.editPlayer;
  if (!confirm('Διαγραφή παίχτη "' + E.name + '"; (Τα τουρνουά όπου έπαιξε δεν επηρεάζονται.)')) return;
  try {
    await deleteDoc(doc(db(), C_PLAYERS, E.id));
    A.players = A.players.filter(p => p.id !== E.id);
    closeModal(); render();
  } catch(e){ $('amPErr').textContent = 'Αποτυχία: ' + e.message; }
}

/* ---------- tournament view ---------- */
function openTour(id){
  A.tourId = id; A.view = 'tour';
  if (A.photosFor !== id){ A.photos = []; A.photosFor = null; }
  render();
  window.scrollTo(0, 0);
  const main = document.querySelector('.main'); if (main) main.scrollTop = 0;
}
function standingsTable(T, s){
  const head = ['Παίχτης', 'Αγ.', 'Νίκες', 'Πόντοι'].concat(s.eq ? [] : ['Μ.Ο.']);
  const lead = s.done > 0;
  return `<div class="tbl-scroll" style="margin:0"><table class="am-tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${s.rows.map((r, i) => `<tr class="${lead && i === 0 ? 'top' : ''}"><td>${i + 1}. ${avatar(playerByName(r.n) || { name: r.n }, 'sm')}${esc(r.n)}</td><td>${r.g}</td><td>${r.w}</td><td>${r.f}</td>${s.eq ? '' : `<td>${s.av(r).toFixed(1)}</td>`}</tr>`).join('')}
  </tbody></table></div>`;
}
function matchesHtml(T){
  let last = -1, out = '';
  const fin = T.status === 'finished';
  (T.matches || []).forEach((m, i) => {
    if (m.r !== last){
      last = m.r;
      const rest = (T.players || []).filter(x => !(T.matches || []).some(z => z.r === m.r && (z.a.indexOf(x) >= 0 || z.b.indexOf(x) >= 0)));
      out += `<div class="am-round">ΓΥΡΟΣ ${m.r}${rest.length ? ' · Ξεκουράζονται: ' + esc(rest.join(', ')) : ''}</div>`;
    }
    const played = m.sa != null;
    const live = !played && lsGet(liveKey(T.id, i));
    out += `<div class="am-match ${played ? 'done' : ''}">
        ${T.courts === 2 ? `<span class="am-court">Γ${m.c}</span>` : ''}
        <div class="am-team ${played && m.sa > m.sb ? 'win' : ''}">${esc(tl(m.a))}</div>
        <div class="am-sc">${played ? m.sa + ' – ' + m.sb : (live ? '<span style="color:#ffc14a">' + live.sa + ' – ' + live.sb + '</span>' : 'vs')}</div>
        <div class="am-team r ${played && m.sb > m.sa ? 'win' : ''}">${esc(tl(m.b))}</div>
        ${fin ? '' : `<button class="btn" data-am="play" data-i="${i}">${played ? 'Αλλαγή' : (live ? '↩ Συνέχεια' : 'Παίξε')}</button>`}
      </div>`;
  });
  return out;
}
function viewTour(){
  const T = curTour();
  if (!T){ A.view = 'list'; return viewList(); }
  const s = standings(T);
  const fin = T.status === 'finished';
  const info = [fd(T.date), (T.players || []).length + ' παίχτες', (T.pts || 21) + ' πόντοι', T.courts === 2 ? '2 γήπεδα' : '1 γήπεδο'].join(' · ');
  const winnerName = (T.winners && T.winners[0]) || (s.rows[0] && s.rows[0].n);
  const winner = fin && winnerName ? `<div class="am-winner">
      <div style="font-size:34px">🏆</div>
      <div class="w1">${esc(winnerName)}</div>
      <div class="w2">${(T.winners || []).slice(1, 3).map((w, k) => (k ? '🥉 ' : '🥈 ') + esc(w)).join(' &nbsp; ')}</div>
    </div>` : '';
  return `
    <div class="panel">
      <div class="am-head">
        <div>
          <button class="btn" data-am="view" data-v="list" style="margin-bottom:10px">← Όλα τα τουρνουά</button>
          <div class="am-title">${esc(T.name || 'Americano')}</div>
          <div class="am-muted" style="margin-top:4px">${esc(info)} · ${fin ? '✔ Ολοκληρώθηκε' : '<span class="am-live-dot"></span>Σε εξέλιξη'}</div>
        </div>
        <div class="am-actions">
          <button class="btn" data-am="edittour">✎ Στοιχεία</button>
          ${fin ? '<button class="btn" data-am="reopen">↺ Άνοιγμα ξανά</button>' : '<button class="btn" data-am="finish">✔ Ολοκλήρωση</button>'}
          <button class="btn danger" data-am="deltour">Διαγραφή</button>
        </div>
      </div>
      ${T.notes ? `<p style="margin-top:12px;white-space:pre-wrap;color:rgba(244,249,255,0.75);font-size:14px">${esc(T.notes)}</p>` : ''}
    </div>
    ${winner}
    <div class="panel"><h3>📊 ΒΑΘΜΟΛΟΓΙΑ <span class="am-muted" style="letter-spacing:0">${s.done}/${s.total} αγώνες</span></h3>${standingsTable(T, s)}</div>
    <div class="panel"><h3>🎾 ΑΓΩΝΕΣ</h3>${matchesHtml(T)}</div>
    <div class="panel"><h3>🏆 ΤΡΟΠΑΙΑ & ΝΙΚΗΤΕΣ</h3><div class="am-gal" id="amGalTrophy"><div class="am-muted">Φόρτωση...</div></div></div>
    <div class="panel"><h3>📸 ΦΩΤΟΓΡΑΦΙΕΣ</h3><div class="am-gal" id="amGalPhoto"><div class="am-muted">Φόρτωση...</div></div></div>
    <input type="file" id="amPhFile" accept="image/*" multiple hidden>`;
}
function galleryHtml(kind){
  const list = A.photos.filter(p => (p.kind || 'photo') === kind);
  return list.map(p => `<button class="am-ph" data-am="photo" data-id="${esc(p.id)}"><img src="${esc(p.thumb)}" alt="" loading="lazy">${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ''}</button>`).join('')
    + `<label class="am-upl" data-am="upload" data-kind="${kind}"><span>＋</span>${kind === 'trophy' ? 'Τρόπαιο' : 'Φωτογραφίες'}</label>`;
}
function paintGalleries(){
  const a = $('amGalTrophy'), b = $('amGalPhoto');
  if (a) a.innerHTML = galleryHtml('trophy');
  if (b) b.innerHTML = galleryHtml('photo');
}
async function afterTour(){
  const T = curTour(); if (!T) return;
  const f = $('amPhFile');
  if (f) f.addEventListener('change', (e) => uploadPhotos(Array.from(e.target.files || []), f.dataset.kind || 'photo'));
  if (A.photosFor === T.id){ paintGalleries(); return; }
  try { await loadPhotos(T.id); if (A.tourId === T.id) paintGalleries(); }
  catch(e){ const a = $('amGalPhoto'); if (a) a.innerHTML = `<div style="color:#ff6b6b;font-size:13px">Αποτυχία φόρτωσης: ${esc(e.message)}</div>`; }
}
async function uploadPhotos(files, kind){
  const T = curTour(); if (!T || !files.length) return;
  const gal = kind === 'trophy' ? $('amGalTrophy') : $('amGalPhoto');
  let ok = 0, fail = 0;
  for (let k = 0; k < files.length; k++){
    if (gal){ const lbl = gal.querySelector('.am-upl'); if (lbl) lbl.innerHTML = `<span>⏳</span>${k + 1}/${files.length}`; }
    try {
      const im = await readImage(files[k]);
      const thumb = drawScaled(im, 360, false).toDataURL('image/jpeg', 0.72);
      const full = fullDataUrl(im);
      const meta = { tournamentId: T.id, kind, caption: '', thumb, createdMs: Date.now(), createdAt: serverTimestamp() };
      const ref = doc(collection(db(), C_PHOTOS));
      const batch = writeBatch(db());
      batch.set(ref, meta);
      batch.set(doc(db(), C_FULL, ref.id), { tournamentId: T.id, data: full });
      batch.update(doc(db(), C_TOURS, T.id), { photoCount: increment(1) });
      await batch.commit();
      A.photos.push({ id: ref.id, ...meta });
      T.photoCount = (T.photoCount || 0) + 1;
      ok++;
    } catch(e){ fail++; console.warn('photo upload', e); if (fail === 1) alert('Αποτυχία ανεβάσματος: ' + e.message); }
  }
  if (A.tourId === T.id) paintGalleries();
  const f = $('amPhFile'); if (f) f.value = '';
}
async function openPhoto(id){
  const p = A.photos.find(x => x.id === id); if (!p) return;
  modal(`
    <h2 class="mem-title">${p.kind === 'trophy' ? '🏆 Τρόπαιο' : '📸 Φωτογραφία'}</h2>
    <img class="am-lb-img" id="amLbImg" src="${esc(p.thumb)}" alt="">
    <div class="field" style="margin-top:14px"><label>ΛΕΖΑΝΤΑ</label><input class="am-in" id="amCap" maxlength="120" value="${esc(p.caption)}" placeholder="π.χ. Οι νικητές με το κύπελλο"></div>
    <div class="am-chips" style="margin-top:10px">
      <button class="am-chip txt ${p.kind !== 'trophy' ? 'on' : ''}" data-am="phkind" data-kind="photo">📸 Φωτογραφία</button>
      <button class="am-chip txt ${p.kind === 'trophy' ? 'on' : ''}" data-am="phkind" data-kind="trophy">🏆 Τρόπαιο</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="am-btn-main" data-am="savephoto" data-id="${esc(p.id)}" style="flex:1">💾 ΑΠΟΘΗΚΕΥΣΗ</button>
      <a class="btn" id="amDl" download="north-padel-${esc(p.id)}.jpg" href="${esc(p.thumb)}" style="text-decoration:none;display:inline-flex;align-items:center">⬇ Λήψη</a>
      <button class="btn danger" data-am="delphoto" data-id="${esc(p.id)}">Διαγραφή</button>
    </div>
    <div class="am-err" id="amPhErr"></div>`, 'am-score-card');
  $('amModal').dataset.kind = p.kind || 'photo';
  try {
    const s = await getDoc(doc(db(), C_FULL, id));
    if (s.exists() && $('amLbImg')){ $('amLbImg').src = s.data().data; $('amDl').href = s.data().data; }
  } catch(e){ console.warn('full photo', e); }
}
async function savePhoto(id, btn){
  const p = A.photos.find(x => x.id === id); if (!p) return;
  const patch = { caption: $('amCap').value.trim(), kind: $('amModal').dataset.kind || 'photo' };
  btn.disabled = true;
  try { await updateDoc(doc(db(), C_PHOTOS, id), patch); Object.assign(p, patch); closeModal(); paintGalleries(); }
  catch(e){ btn.disabled = false; $('amPhErr').textContent = 'Αποτυχία: ' + e.message; }
}
async function delPhoto(id){
  const T = curTour(); if (!T || !confirm('Διαγραφή φωτογραφίας;')) return;
  try {
    const batch = writeBatch(db());
    batch.delete(doc(db(), C_PHOTOS, id));
    batch.delete(doc(db(), C_FULL, id));
    batch.update(doc(db(), C_TOURS, T.id), { photoCount: increment(-1) });
    await batch.commit();
    A.photos = A.photos.filter(x => x.id !== id);
    T.photoCount = Math.max(0, (T.photoCount || 1) - 1);
    closeModal(); paintGalleries();
  } catch(e){ $('amPhErr').textContent = 'Αποτυχία: ' + e.message; }
}
function editTour(){
  const T = curTour(); if (!T) return;
  modal(`
    <h2 class="mem-title">Στοιχεία τουρνουά</h2>
    <div class="form-grid">
      <div class="field"><label>ΤΙΤΛΟΣ</label><input class="am-in" id="amTName" maxlength="60" value="${esc(T.name)}"></div>
      <div class="field"><label>ΗΜΕΡΟΜΗΝΙΑ</label><input class="am-in" id="amTDate" type="date" value="${esc(T.date)}"></div>
    </div>
    <div class="field" style="margin-top:14px"><label>ΣΗΜΕΙΩΣΕΙΣ</label><textarea class="am-in" id="amTNotes" rows="4" maxlength="1000" placeholder="π.χ. έπαθλα, χορηγοί, σχόλια">${esc(T.notes)}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:18px"><button class="am-btn-main" data-am="savetour" style="flex:1">💾 ΑΠΟΘΗΚΕΥΣΗ</button></div>
    <div class="am-err" id="amTErr"></div>`);
}
async function saveTourInfo(btn){
  const T = curTour(); if (!T) return;
  const patch = { name: $('amTName').value.trim() || 'Americano', date: $('amTDate').value || T.date, notes: $('amTNotes').value.trim() };
  btn.disabled = true;
  try { await saveTour(T, patch); A.tours.sort((a, b) => (b.date || '').localeCompare(a.date || '')); closeModal(); render(); }
  catch(e){ btn.disabled = false; $('amTErr').textContent = 'Αποτυχία: ' + e.message; }
}
async function finishTour(){
  const T = curTour(); if (!T) return;
  const s = standings(T);
  const left = s.total - s.done;
  if (!confirm(left ? `Υπάρχουν ακόμα ${left} αγώνες χωρίς σκορ. Ολοκλήρωση τουρνουά παρ' όλα αυτά;` : 'Ολοκλήρωση τουρνουά και αποθήκευση στο ιστορικό;')) return;
  try { await saveTour(T, { status: 'finished', winners: s.rows.slice(0, 3).map(r => r.n) }); render(); }
  catch(e){ alert('Αποτυχία: ' + e.message); }
}
async function reopenTour(){
  const T = curTour(); if (!T) return;
  try { await saveTour(T, { status: 'active', winners: [] }); render(); }
  catch(e){ alert('Αποτυχία: ' + e.message); }
}
async function delTour(){
  const T = curTour(); if (!T) return;
  if (!confirm('Διαγραφή του τουρνουά "' + T.name + '" μαζί με όλες τις φωτογραφίες του; Δεν αναιρείται.')) return;
  try {
    const snap = await getDocs(query(collection(db(), C_PHOTOS), where('tournamentId', '==', T.id)));
    const ids = snap.docs.map(d => d.id);
    for (let i = 0; i < ids.length; i += 200){
      const b = writeBatch(db());
      ids.slice(i, i + 200).forEach(id => { b.delete(doc(db(), C_PHOTOS, id)); b.delete(doc(db(), C_FULL, id)); });
      await b.commit();
    }
    await deleteDoc(doc(db(), C_TOURS, T.id));
    (T.matches || []).forEach((_, i) => lsDel(liveKey(T.id, i)));
    A.tours = A.tours.filter(t => t.id !== T.id);
    A.tourId = null; A.view = 'list'; render();
  } catch(e){ alert('Αποτυχία: ' + e.message); }
}

/* ---------- live scoreboard ---------- */
const SB = { cur: null, sa: 0, sb: 0 };
const liveKey = (tid, i) => 'np_am_live_' + tid + '_' + i;
function openScore(i){
  const T = curTour(); if (!T) return;
  const m = T.matches[i];
  const live = lsGet(liveKey(T.id, i));
  SB.cur = i;
  SB.sa = live ? live.sa : (m.sa == null ? 0 : m.sa);
  SB.sb = live ? live.sb : (m.sb == null ? 0 : m.sb);
  modal(`
    <h2 class="mem-title" style="text-align:center">Γύρος ${m.r}${T.courts === 2 ? ' · Γήπεδο ' + m.c : ''}</h2>
    <div class="am-sb-total">Σύνολο: <b id="amSbTot">0</b> / ${T.pts || 21}</div>
    <div class="am-sb-row">
      <div class="am-sb a"><div class="am-sb-name">${esc(tl(m.a))}</div><div class="am-sb-score" id="amSbA">0</div>
        <button class="plus" data-am="sb" data-k="sa" data-d="1">+1</button><button class="minus" data-am="sb" data-k="sa" data-d="-1">−1</button></div>
      <div class="am-sb b"><div class="am-sb-name">${esc(tl(m.b))}</div><div class="am-sb-score" id="amSbB">0</div>
        <button class="plus" data-am="sb" data-k="sb" data-d="1">+1</button><button class="minus" data-am="sb" data-k="sb" data-d="-1">−1</button></div>
    </div>
    <div class="am-sb-acts">
      <button class="am-btn-main" data-am="sbfinish">✔ ΤΕΛΟΣ ΑΓΩΝΑ</button>
    </div>
    <div class="am-sb-acts">
      <button class="btn" data-am="sbreset">Μηδενισμός</button>
      ${m.sa != null ? '<button class="btn danger" data-am="sbclear">Διαγραφή σκορ</button>' : ''}
      <button class="btn" data-am="close">Κλείσιμο</button>
    </div>
    <div class="am-err" id="amSbErr"></div>`, 'am-score-card');
  paintScore();
}
function paintScore(){
  const T = curTour(); if (!T || SB.cur == null) return;
  const MX = T.pts || 21, tot = SB.sa + SB.sb;
  $('amSbA').textContent = SB.sa; $('amSbB').textContent = SB.sb; $('amSbTot').textContent = tot;
  document.querySelectorAll('#amModal .plus').forEach(b => { b.disabled = tot >= MX; });
  document.querySelector('#amModal [data-k="sa"][data-d="-1"]').disabled = SB.sa <= 0;
  document.querySelector('#amModal [data-k="sb"][data-d="-1"]').disabled = SB.sb <= 0;
}
function bump(k, d){
  const T = curTour(); if (!T || SB.cur == null) return;
  const tot = SB.sa + SB.sb;
  if (d > 0 && tot >= (T.pts || 21)) return;
  if (d < 0 && SB[k] <= 0) return;
  SB[k] += d;
  // Survives a page reload / closed tab — the score is only written to the
  // database when the match is finished.
  lsSet(liveKey(T.id, SB.cur), { sa: SB.sa, sb: SB.sb });
  paintScore();
}
async function finishMatch(btn){
  const T = curTour(); if (!T || SB.cur == null) return;
  const i = SB.cur, MX = T.pts || 21, tot = SB.sa + SB.sb;
  if (tot === 0){ $('amSbErr').textContent = 'Δεν υπάρχει σκορ.'; return; }
  if (tot < MX && !confirm(`Το σύνολο είναι ${tot}/${MX}. Τέλος αγώνα παρ' όλα αυτά;`)) return;
  const matches = T.matches.map((m, k) => k === i ? { ...m, sa: SB.sa, sb: SB.sb } : m);
  btn.disabled = true;
  try {
    await saveTour(T, { matches });
    lsDel(liveKey(T.id, i));
    closeModal(); render();
  } catch(e){ btn.disabled = false; $('amSbErr').textContent = 'Αποτυχία αποθήκευσης: ' + e.message; }
}
async function clearMatch(){
  const T = curTour(); if (!T || SB.cur == null) return;
  if (!confirm('Διαγραφή του σκορ αυτού του αγώνα;')) return;
  const i = SB.cur;
  const matches = T.matches.map((m, k) => k === i ? { ...m, sa: null, sb: null } : m);
  try { await saveTour(T, { matches }); lsDel(liveKey(T.id, i)); closeModal(); render(); }
  catch(e){ $('amSbErr').textContent = 'Αποτυχία: ' + e.message; }
}

/* ============ EVENTS ============ */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-am]');
  if (!el) return;
  const inRoot = root() && root().contains(el);
  const inModal = $('amModal') && $('amModal').contains(el);
  if (!inRoot && !inModal) return;
  const a = el.dataset.am;
  switch (a){
    case 'view': A.view = el.dataset.v; if (A.view !== 'tour') A.tourId = null; render(); break;
    case 'open': openTour(el.dataset.id); break;
    case 'pick': {
      const name = el.dataset.name, D = A.draft;
      const idx = D.pl.findIndex(x => norm(x) === norm(name));
      if (idx >= 0) D.pl[idx] = '';
      else { const free = D.pl.findIndex(x => !(x || '').trim()); if (free < 0) return; D.pl[free] = name; }
      saveDraft(); render(); break;
    }
    case 'courts': if (!el.disabled){ A.draft.courts = +el.dataset.n; saveDraft(); render(); } break;
    case 'pts': A.draft.pts = +el.dataset.n; saveDraft(); render(); break;
    case 'create': createTour(el); break;
    case 'cleardraft': A.draft = { name: '', date: today(), pl: Array(8).fill(''), courts: 1, pts: A.draft.pts || 21 }; saveDraft(); render(); break;
    case 'newplayer': openPlayerEditor(null); break;
    case 'editplayer': openPlayerEditor(A.players.find(p => p.id === el.dataset.id)); break;
    case 'pickphoto': $('amPFile') && $('amPFile').click(); break;
    case 'rmphoto': if (A.editPlayer){ A.editPlayer.photo = ''; $('amPAv').innerHTML = avatar(A.editPlayer, 'big'); } break;
    case 'saveplayer': savePlayer(el); break;
    case 'delplayer': delPlayer(); break;
    case 'play': openScore(+el.dataset.i); break;
    case 'sb': bump(el.dataset.k, +el.dataset.d); break;
    case 'sbreset': SB.sa = SB.sb = 0; { const T = curTour(); if (T) lsSet(liveKey(T.id, SB.cur), { sa: 0, sb: 0 }); } paintScore(); break;
    case 'sbfinish': finishMatch(el); break;
    case 'sbclear': clearMatch(); break;
    case 'close': closeModal(); break;
    case 'edittour': editTour(); break;
    case 'savetour': saveTourInfo(el); break;
    case 'finish': finishTour(); break;
    case 'reopen': reopenTour(); break;
    case 'deltour': delTour(); break;
    case 'upload': { e.preventDefault(); const f = $('amPhFile'); if (f){ f.dataset.kind = el.dataset.kind; f.click(); } break; }
    case 'photo': openPhoto(el.dataset.id); break;
    case 'phkind': $('amModal').dataset.kind = el.dataset.kind; document.querySelectorAll('#amModal [data-am="phkind"]').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'savephoto': savePhoto(el.dataset.id, el); break;
    case 'delphoto': delPhoto(el.dataset.id); break;
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!root() || !root().contains(t)) return;
  if (t.dataset.amPl != null){ A.draft.pl[+t.dataset.amPl] = t.value; saveDraft(); }
  else if (t.id === 'amName'){ A.draft.name = t.value; saveDraft(); }
  else if (t.id === 'amDate'){ A.draft.date = t.value; saveDraft(); }
});
// When a player field loses focus, refresh the counter / chips / courts.
document.addEventListener('change', (e) => {
  const t = e.target;
  if (root() && root().contains(t) && t.dataset.amPl != null) render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('amModal')) closeModal(); });

/* ============ PUBLIC ============ */
async function open(){
  render();
  if (A.loaded || A.loading) return;
  try { A.loadError = null; await loadAll(); }
  catch(e){
    A.loading = false;
    A.loadError = e.code === 'permission-denied'
      ? 'Δεν υπάρχει άδεια πρόσβασης. Πρέπει να ενημερωθούν τα Firestore Rules (δες οδηγίες).'
      : e.message;
  }
  render();
}
window.npAmericano = { open, _test: { amSched, standings } };
