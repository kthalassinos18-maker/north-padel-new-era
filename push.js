/* ============ PUSH NOTIFICATIONS (phone) — free, Firebase Cloud Messaging ============
 * - Profile section «🔔 Ειδοποιήσεις στο κινητό»: enable/disable on this device
 * - Device tokens in /push_tokens/{token} (owner writes, nobody reads but admin)
 * - window.npPush.send(ids): asks /api/push to deliver just-created
 *   /notifications to the recipients' phones
 * iPhone: web push works only when the site is added to the Home Screen (iOS 16.4+).
 */
import { getApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Firebase console → Project settings → Cloud Messaging → Web Push certificates → Key pair (public key)
const VAPID_KEY = 'BOzdwyNbymPJetFJOqCEKJtaVdedu8ew8cSLH0-cc1mqSxs85-EWZEJfuNJlQKL3YlTS8q6gJTCPXWPHN8BcVUk';

const $ = (id) => document.getElementById(id);
const lang = () => { try { return localStorage.getItem('northPadelLang') || 'el'; } catch(_) { return 'el'; } };
const t = (el, en, de) => { const l = lang(); return l === 'en' ? (en || el) : l === 'de' ? (de || en || el) : el; };
const LS = 'np_push_token';
const lsGet = () => { try { return localStorage.getItem(LS); } catch(_) { return null; } };
const lsSet = (v) => { try { v ? localStorage.setItem(LS, v) : localStorage.removeItem(LS); } catch(_) {} };
const me = () => (typeof window.currentUser === 'function' ? window.currentUser() : null);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let SUPPORTED = null;
async function supported(){
  if (SUPPORTED !== null) return SUPPORTED;
  try { SUPPORTED = !!VAPID_KEY && 'serviceWorker' in navigator && 'Notification' in window && await isSupported(); } catch(_) { SUPPORTED = false; }
  return SUPPORTED;
}
// Register the background worker and wait until it is ACTIVE — the first time
// it needs a moment to install, and subscribing before that fails with
// "Subscription failed - no active Service Worker".
async function register(){
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  if (reg.active) return reg;
  const sw = reg.installing || reg.waiting;
  await new Promise((res, rej) => {
    if (!sw) return res();
    const to = setTimeout(() => rej(new Error(t('ο service worker δεν ξεκίνησε', 'service worker did not start', 'Service Worker startete nicht'))), 15000);
    const check = () => { if (sw.state === 'activated'){ clearTimeout(to); res(); } else if (sw.state === 'redundant'){ clearTimeout(to); rej(new Error('service worker install failed')); } };
    sw.addEventListener('statechange', check); check();
  });
  return reg.active ? reg : (await navigator.serviceWorker.ready);
}
async function saveToken(u){
  const reg = await register();
  const token = await getToken(getMessaging(getApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('no token');
  await setDoc(doc(window.npFB.db, 'push_tokens', token), { uid: u.uid, ua: navigator.userAgent.slice(0, 200), platform: isIOS ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'web', createdAt: serverTimestamp() });
  lsSet(token);
  return token;
}

/* ---------- actions ---------- */
async function enable(){
  const u = me(); if (!u) return;
  const msg = (txt, ok) => { const m = $('pushMsg'); if (m){ m.style.color = ok ? '#b7ff4a' : '#ffc14a'; m.innerHTML = txt; } };
  if (isIOS && !standalone()){ msg(iosHelp()); return; }
  if (!(await supported())){ msg(t('Αυτή η συσκευή ή ο browser δεν υποστηρίζει ειδοποιήσεις.', 'This device/browser does not support notifications.', 'Dieses Gerät unterstützt keine Benachrichtigungen.')); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted'){ msg(t('Δεν δόθηκε άδεια. Μπορείς να την ενεργοποιήσεις από τις ρυθμίσεις του browser για το site.', 'Permission was not granted. You can allow it in the browser’s site settings.', 'Keine Erlaubnis. In den Website-Einstellungen des Browsers erlauben.')); return; }
  try { msg(t('Ενεργοποίηση...', 'Enabling...', 'Aktivieren...'), true); await saveToken(u); render(); flash(t('✅ Θα σε ειδοποιούμε στο κινητό!', '✅ We’ll notify you on your phone!', '✅ Wir benachrichtigen dich auf dem Handy!')); }
  catch(e){ msg(t('Δεν ενεργοποιήθηκε', 'Could not enable', 'Nicht aktiviert') + ': ' + e.message); }
}
async function disable(){
  const tok = lsGet();
  try { await deleteToken(getMessaging(getApp())); } catch(_) {}
  if (tok) try { await deleteDoc(doc(window.npFB.db, 'push_tokens', tok)); } catch(_) {}
  lsSet(null); render();
}
function iosHelp(){
  return t('Στο iPhone οι ειδοποιήσεις δουλεύουν όταν το site είναι στην αρχική οθόνη: πάτα <b>Κοινοποίηση</b> ⬆️ → <b>Προσθήκη στην οθόνη Αφετηρίας</b>, άνοιξε το North Padel από εκεί και πάτα ξανά «Ενεργοποίηση».',
    'On iPhone, notifications work when the site is on your Home Screen: tap <b>Share</b> ⬆️ → <b>Add to Home Screen</b>, open North Padel from there and tap “Enable” again.',
    'Auf dem iPhone funktionieren Benachrichtigungen, wenn die Seite auf dem Home-Bildschirm ist: <b>Teilen</b> ⬆️ → <b>Zum Home-Bildschirm</b>, von dort öffnen und erneut „Aktivieren“.');
}
let flashT;
function flash(text){
  let el = $('pushFlash');
  if (!el){ el = document.createElement('div'); el.id = 'pushFlash'; el.className = 'og-toast'; document.body.appendChild(el); }
  el.textContent = text; requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('show'), 4000);
}

/* ---------- profile section ---------- */
async function render(){
  const box = $('ppPush'); if (!box) return;
  const on = !!lsGet() && 'Notification' in window && Notification.permission === 'granted';
  const sup = await supported();
  box.innerHTML = `<h3><span class="ico">📲</span>${t('ΕΙΔΟΠΟΙΗΣΕΙΣ ΣΤΟ ΚΙΝΗΤΟ', 'PHONE NOTIFICATIONS', 'HANDY-BENACHRICHTIGUNGEN')}</h3>
    <p style="font-size:13px;color:rgba(244,249,255,0.7);line-height:1.5;margin-bottom:12px">${t('Μάθε αμέσως όταν γεμίζει το παιχνίδι σου, όταν μπαίνει κάποιος ή όταν ψάχνουν παίχτη για σένα — ακόμα κι αν το site είναι κλειστό.', 'Know instantly when your game fills up, someone joins, or a game needs you — even with the site closed.', 'Sofort wissen, wenn dein Spiel voll ist, jemand beitritt oder ein Spiel dich sucht — auch bei geschlossener Seite.')}</p>
    ${!VAPID_KEY ? `<div style="font-size:13px;color:rgba(244,249,255,0.5)">${t('Ενεργοποιείται σύντομα.', 'Coming soon.', 'Bald verfügbar.')}</div>`
      : on ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="color:#b7ff4a;font-weight:700">✅ ${t('Ενεργές σε αυτή τη συσκευή', 'On for this device', 'Auf diesem Gerät aktiv')}</span><button type="button" class="pf-cta outline" data-push="off" style="font-size:12px;padding:8px 12px">${t('Απενεργοποίηση', 'Turn off', 'Ausschalten')}</button></div>`
      : `<button type="button" class="pf-save-btn" data-push="on" style="margin-top:0">🔔 ${t('ΕΝΕΡΓΟΠΟΙΗΣΗ', 'ENABLE', 'AKTIVIEREN')}</button>`}
    <div id="pushMsg" style="font-size:12px;line-height:1.5;margin-top:8px">${VAPID_KEY && isIOS && !standalone() && !on ? iosHelp() : (VAPID_KEY && !sup && !isIOS ? t('Ο browser σου δεν υποστηρίζει ειδοποιήσεις.', 'Your browser does not support notifications.', 'Dein Browser unterstützt keine Benachrichtigungen.') : '')}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-push]'); if (!b) return;
  if (b.dataset.push === 'on') enable(); else disable();
});

/* ---------- public ---------- */
window.npPush = {
  render,
  enable,
  isOn: () => !!lsGet() && 'Notification' in window && Notification.permission === 'granted',
  /** Deliver these just-created notifications to the recipients' phones (fire-and-forget). */
  send(ids){
    ids = (ids || []).filter(Boolean); if (!ids.length) return;
    fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), keepalive: true }).catch(() => {});
  },
  /** After joining/creating a game: suggest turning phone notifications on. */
  async suggest(){
    if (!VAPID_KEY || lsGet() || !me()) return;
    if ('Notification' in window && Notification.permission === 'denied') return;
    try { if (sessionStorage.getItem('np_push_suggested')) return; sessionStorage.setItem('np_push_suggested', '1'); } catch(_) {}
    let el = $('pushAsk');
    if (!el){ el = document.createElement('div'); el.id = 'pushAsk'; el.className = 'og-toast'; document.body.appendChild(el); }
    el.innerHTML = `📲 ${t('Να σε ειδοποιούμε στο κινητό για αυτό το παιχνίδι;', 'Get phone notifications for this game?', 'Benachrichtigungen fürs Handy?')} <b style="color:#b7ff4a;margin-left:6px">${t('ΝΑΙ', 'YES', 'JA')}</b>`;
    el.onclick = () => { el.classList.remove('show'); if (isIOS && !standalone()){ alert(iosHelp().replace(/<[^>]+>/g, '')); return; } enable(); };
    setTimeout(() => el.classList.add('show'), 1500);
    setTimeout(() => el.classList.remove('show'), 12000);
  },
};
// Keep this device's token fresh (tokens can rotate).
if (VAPID_KEY) (function(){
  const go = () => { const u = me(); if (u && lsGet() && 'Notification' in window && Notification.permission === 'granted') saveToken(u).catch(() => {}); };
  const wait = () => window.npFB ? window.npFB.onAuth(() => setTimeout(go, 1500)) : window.addEventListener('npFBReady', wait, { once: true });
  wait();
})();
