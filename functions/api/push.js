// Cloudflare Pages Function — sends a phone push (Firebase Cloud Messaging)
// for in-site notifications that were just created in /notifications.
//
// Setup (once):
//   Cloudflare dashboard → Workers & Pages → north-padel-new-era → Settings →
//   Variables and Secrets → Add → Type: Secret →
//     FIREBASE_SERVICE_ACCOUNT = the whole service-account JSON
//   (the same key that is stored on GitHub). Add it for Production and Preview,
//   then re-deploy (any push).
//
// The browser posts { ids: [notificationId, ...] } right after writing the
// notifications. Nothing is trusted from the caller: each notification is read
// from Firestore, must be younger than 15 minutes and not pushed before; it
// is then pushed to the recipient's devices (/push_tokens) and marked
// pushed:true, so a notification can never be pushed twice or spoofed.

const MAX_IDS = 60;
const MAX_AGE_MS = 15 * 60 * 1000;

export async function onRequestPost(ctx){
  try {
    const raw = ctx.env.FIREBASE_SERVICE_ACCOUNT;
    const sa = parseSA(raw);
    // Tell missing vs. wrong content apart (never echoes the secret).
    if (!raw) return json({ ok: false, error: 'server-not-configured', detail: 'secret-missing' }, 503);
    if (!sa) return json({ ok: false, error: 'server-not-configured', detail: /^\s*\{/.test(raw) ? 'secret-not-a-service-account' : 'secret-not-json' }, 503);
    const body = await ctx.request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(x)))].slice(0, MAX_IDS) : [];
    if (!ids.length) return json({ ok: false, error: 'no-ids' }, 400);

    const token = await accessToken(sa);
    const fs = firestore(sa.project_id, token);
    const origin = new URL(ctx.request.url).origin;
    let sent = 0, skipped = 0;
    const tokenCache = {};

    for (const id of ids){
      const n = await fs.get('notifications/' + id);
      if (!n){ skipped++; continue; }
      const d = n.data;
      if (d.pushed || !d.toUid || Date.now() - (+d.createdMs || 0) > MAX_AGE_MS){ skipped++; continue; }
      // Mark first, so concurrent calls can't double-send.
      await fs.patch('notifications/' + id, { pushed: true });
      const devices = tokenCache[d.toUid] || (tokenCache[d.toUid] = await fs.query('push_tokens', 'uid', d.toUid));
      for (const dev of devices){
        const r = await fcmSend(sa.project_id, token, {
          token: dev.id,
          webpush: {
            notification: {
              title: String(d.title || 'North Padel').slice(0, 120),
              body: String(d.text || '').slice(0, 300),
              icon: origin + '/assets/icon-192.png',
              badge: origin + '/assets/icon-192.png',
              tag: 'np-' + (d.gameId || id),
            },
            fcm_options: { link: origin + '/' + (d.gameId ? '#og=' + d.gameId : '') },
          },
        });
        if (r.ok) sent++;
        else if (r.gone) await fs.del('push_tokens/' + dev.id).catch(() => {});
      }
    }
    return json({ ok: true, sent, skipped });
  } catch(e){
    return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500);
  }
}

/* ---------- Google auth (service account → OAuth access token) ---------- */
function parseSA(raw){
  try { const j = JSON.parse(raw || ''); return j.client_email && j.private_key && j.project_id ? j : null; } catch(_) { return null; }
}
let cached = null;
async function accessToken(sa){
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
  });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(new Uint8Array(sig)) }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('auth failed: ' + (j.error_description || j.error || res.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}
function b64url(bytes){ let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/* ---------- Firestore REST (only the few calls we need) ---------- */
function firestore(project, token){
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const val = (v) => v == null ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : null;
  const flat = (fields) => { const o = {}; for (const k in (fields || {})) o[k] = val(fields[k]); return o; };
  return {
    async get(path){
      const r = await fetch(`${base}/${path}`, { headers: H });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('firestore get ' + r.status);
      const j = await r.json(); return { id: j.name.split('/').pop(), data: flat(j.fields) };
    },
    async patch(path, obj){
      const fields = {}, mask = [];
      for (const k in obj){ mask.push('updateMask.fieldPaths=' + encodeURIComponent(k)); fields[k] = typeof obj[k] === 'boolean' ? { booleanValue: obj[k] } : { stringValue: String(obj[k]) }; }
      const r = await fetch(`${base}/${path}?${mask.join('&')}&currentDocument.exists=true`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error('firestore patch ' + r.status);
    },
    async del(path){ await fetch(`${base}/${path}`, { method: 'DELETE', headers: H }); },
    async query(collection, field, equals){
      const r = await fetch(`${base}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: equals } } }, limit: 10 } }) });
      if (!r.ok) throw new Error('firestore query ' + r.status);
      return (await r.json()).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), data: flat(x.document.fields) }));
    },
  };
}

/* ---------- FCM HTTP v1 ---------- */
async function fcmSend(project, token, message){
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
  if (r.ok) return { ok: true };
  const t = await r.text();
  return { ok: false, gone: r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(t) };
}

function json(o, status = 200){ return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
