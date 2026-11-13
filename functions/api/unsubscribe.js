/** GET /api/unsubscribe?u=<uid>&t=<sig> — «Δεν θέλω άλλα email» με ένα κλικ (και POST για List-Unsubscribe-Post). */
import { accessToken, firestore, hmacKey, sign } from './notify-game.js';

async function handle({ request, env }){
  const url = new URL(request.url), uid = url.searchParams.get('u') || '', t = url.searchParams.get('t') || '';
  try {
    if (!/^[\w-]{1,128}$/.test(uid) || !env.FIREBASE_SERVICE_ACCOUNT) return page('Ο σύνδεσμος δεν είναι σωστός.', 400);
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (t !== await sign(await hmacKey(sa.private_key_id || sa.client_email), uid)) return page('Ο σύνδεσμος δεν είναι σωστός.', 400);
    await firestore(sa.project_id, await accessToken(sa)).patch('users/' + uid, { emailOptOut: true });
    return page('Έγινε ✓<br>Δεν θα σου ξαναστείλουμε email για ανοιχτά παιχνίδια.');
  } catch (e){ return page('Κάτι πήγε στραβά. Δοκίμασε ξανά σε λίγο.', 500); }
}
export const onRequestGet = handle, onRequestPost = handle;

function page(msg, status = 200){
  return new Response(`<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>North Padel</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#08172a;color:#f4f9ff;font-family:Arial,sans-serif;text-align:center;padding:20px">
<div><div style="letter-spacing:3px;color:#b7ff4a;font-weight:bold;font-size:12px">NORTH PADEL</div><p style="font-size:20px;line-height:1.5">${msg}</p>
<a href="/" style="color:#b7ff4a">Πίσω στο site</a></div></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
