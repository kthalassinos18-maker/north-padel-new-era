/**
 * POST /api/notify-game {gameId}
 * Μόλις ανοίξει γήπεδο «Ψάχνω παίχτες», στέλνει email (Brevo) σε μέλη με επίπεδο ±2 από τον διοργανωτή.
 * Secrets: FIREBASE_SERVICE_ACCOUNT, BREVO_API_KEY. Προαιρετικά: MAIL_FROM, EMAIL_AUDIENCE ('all' (default) | 'consent').
 * 'consent' = μόνο όσοι το έχουν αποδεχτεί · 'all' = όλοι, εκτός όσων πάτησαν «Δεν θέλω άλλα».
 */
const RANGE = 2, MAX = 200, FRESH_MS = 30 * 60 * 1000;

export async function onRequestPost({ request, env }){
  try {
    const { gameId } = await request.json().catch(() => ({}));
    if (!gameId || !/^[\w-]{4,64}$/.test(gameId)) return json({ ok: false, error: 'bad-request' }, 400);
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.BREVO_API_KEY) return json({ ok: false, error: 'server-not-configured' }, 503);
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const fs = firestore(sa.project_id, await accessToken(sa));

    const g = await fs.get('open_games/' + gameId);
    if (!g) return json({ ok: false, error: 'not-found' }, 404);
    const game = g.data;
    // Μία φορά ανά παιχνίδι, μόνο για καινούριο και ανοιχτό.
    const created = Date.parse(game.createdAt || '') || 0;
    if (game.status !== 'open' || game.emailed || (created && Date.now() - created > FRESH_MS)) return json({ ok: true, sent: 0, skipped: 'not-eligible' });
    await fs.patch('open_games/' + gameId, { emailed: true });

    const creator = game.creatorUid ? await fs.get('users/' + game.creatorUid) : null;
    const lv = Math.round(Number(creator?.data.level ?? game.levelMin ?? 0));
    if (!lv) return json({ ok: true, sent: 0, skipped: 'no-level' });
    const lo = Math.max(1, lv - RANGE), hi = Math.min(10, lv + RANGE);

    const audience = env.EMAIL_AUDIENCE === 'consent' ? 'consent' : 'all';
    const [users, alerts] = await Promise.all([
      fs.levelRange(lo, hi, 1000),
      audience === 'consent' ? fs.listOn('og_alerts') : Promise.resolve(new Set()),
    ]);
    const inGame = new Set(Object.keys(game.players || {}).concat(game.creatorUid || []));
    const gender = game.gameGender === 'men' ? 'M' : game.gameGender === 'women' ? 'F' : null;
    const to = users.filter(u => {
      const d = u.data;
      if (!d.email || d.emailOptOut || inGame.has(u.id)) return false;
      if (gender && d.gender !== gender) return false;
      if (audience === 'consent' && !(d.consent?.findPlayer || alerts.has(u.id))) return false;
      return true;
    }).slice(0, MAX);
    if (!to.length) return json({ ok: true, sent: 0 });

    const origin = new URL(request.url).origin;
    const key = await hmacKey(sa.private_key_id || sa.client_email);
    const missing = Math.max(0, 4 - Object.keys(game.players || {}).length - (game.friendNames || []).length);
    const versions = await Promise.all(to.map(async u => ({
      to: [{ email: u.data.email, name: [u.data.name, u.data.surname].filter(Boolean).join(' ') || undefined }],
      params: { NAME: u.data.name || '', UNSUB: `${origin}/api/unsubscribe?u=${u.id}&t=${await sign(key, u.id)}` },
    })));
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM || 'info@northpadel.gr', name: 'North Padel' },
        subject: `🎾 Ψάχνουν ${missing || ''} παίχτ${missing === 1 ? 'η' : 'ες'} · ${dayLabel(game.date)} ${game.time || ''}`.replace(/\s+/g, ' '),
        htmlContent: html(game, { lo, hi, missing, link: `${origin}/#og=${gameId}` }),
        headers: { 'List-Unsubscribe': '<{{params.UNSUB}}>' },
        messageVersions: versions,
      }),
    });
    if (!r.ok) return json({ ok: false, error: 'brevo-' + r.status, detail: (await r.text()).slice(0, 300) }, 502);
    return json({ ok: true, sent: to.length });
  } catch (e){
    return json({ ok: false, error: 'server-error', detail: String(e.message || e).slice(0, 200) }, 500);
  }
}

/* ---------- email ---------- */
const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
function dayLabel(iso){
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]} ${d}/${m}`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function html(g, { lo, hi, missing, link }){
  const mode = { men: 'Ανδρικό', women: 'Γυναικείο', mixed: 'Μικτό' }[g.gameGender] || '';
  return `<!doctype html><html><body style="margin:0;background:#08172a;font-family:Arial,sans-serif;color:#f4f9ff">
<div style="max-width:480px;margin:0 auto;padding:28px 20px">
  <div style="font-size:12px;letter-spacing:3px;color:#b7ff4a;font-weight:bold">NORTH PADEL</div>
  <h1 style="font-size:24px;margin:10px 0 6px">Γεια σου{% if params.NAME %} {{ params.NAME }}{% endif %}! Άνοιξε γήπεδο στο επίπεδό σου 🎾</h1>
  <p style="color:#a9b8c9;margin:0 0 18px">${esc(g.creatorName || 'Ένα μέλος')} ψάχνει παίχτες.</p>
  <div style="background:#0f2540;border:1px solid #2d4a6b;border-radius:14px;padding:16px;font-size:15px;line-height:1.8">
    📅 <b>${esc(dayLabel(g.date))}</b> · 🕒 <b>${esc(g.time || '')}</b><br>
    📈 Επίπεδο <b>${lo}–${hi}</b>${mode ? ` · ${mode}` : ''}<br>
    👥 Λείπ${missing === 1 ? 'ει' : 'ουν'} <b>${missing}</b> παίχτ${missing === 1 ? 'ης' : 'ες'}
  </div>
  <a href="${esc(link)}" style="display:block;margin:20px 0;padding:16px;border-radius:14px;background:#b7ff4a;color:#0a1929;text-align:center;font-weight:bold;font-size:17px;text-decoration:none">Μπαίνω στο παιχνίδι →</a>
  <p style="font-size:11px;color:#6f8399;line-height:1.5">Το λαμβάνεις επειδή είσαι μέλος του North Padel. <a href="{{params.UNSUB}}" style="color:#6f8399">Δεν θέλω άλλα τέτοια email</a></p>
</div></body></html>`;
}

/* ---------- unsubscribe signing (shared with unsubscribe.js) ---------- */
export async function hmacKey(secret){ return crypto.subtle.importKey('raw', new TextEncoder().encode('np-unsub:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); }
export async function sign(key, uid){
  const b = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(uid)));
  return btoa(String.fromCharCode(...b.slice(0, 16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- Google auth + Firestore REST ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(new TextEncoder().encode(s));
export async function accessToken(sa){
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64uStr(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const jwt = unsigned + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(unsigned)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  if (!r.ok) throw new Error('oauth ' + r.status);
  return (await r.json()).access_token;
}
const val = (v) => v == null ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'timestampValue' in v ? v.timestampValue : 'mapValue' in v ? flat(v.mapValue.fields)
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : null;
const flat = (fields) => { const o = {}; for (const k in (fields || {})) o[k] = val(fields[k]); return o; };
export function firestore(project, token){
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const doc = (d) => ({ id: d.name.split('/').pop(), data: flat(d.fields) });
  const run = async (q) => {
    const r = await fetch(`${base}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify({ structuredQuery: q }) });
    if (!r.ok) throw new Error('firestore query ' + r.status);
    return (await r.json()).filter(x => x.document).map(x => doc(x.document));
  };
  return {
    async get(path){
      const r = await fetch(`${base}/${path}`, { headers: H });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('firestore get ' + r.status);
      return doc(await r.json());
    },
    async patch(path, obj){
      const fields = {}, mask = [];
      for (const k in obj){ mask.push('updateMask.fieldPaths=' + encodeURIComponent(k)); fields[k] = typeof obj[k] === 'boolean' ? { booleanValue: obj[k] } : { stringValue: String(obj[k]) }; }
      const r = await fetch(`${base}/${path}?${mask.join('&')}&currentDocument.exists=true`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error('firestore patch ' + r.status);
    },
    levelRange: (lo, hi, limit) => run({ from: [{ collectionId: 'users' }], where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'level' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(lo) } } },
      { fieldFilter: { field: { fieldPath: 'level' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(hi) } } } ] } }, limit }),
    async listOn(collection){
      const docs = await run({ from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: 'on' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: 1000 });
      return new Set(docs.map(d => d.id));
    },
  };
}
export function json(o, status = 200){ return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
