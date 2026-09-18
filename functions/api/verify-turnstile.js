// Cloudflare Pages Function — verifies a Turnstile client token server-side.
//
// Setup:
// 1) In Cloudflare dashboard → Turnstile → Add widget → copy the SITE KEY into
//    <meta name="turnstile-sitekey" content="…"> in index.html.
// 2) Copy the SECRET KEY into Cloudflare Pages → Settings → Environment
//    variables → Production → Add: TURNSTILE_SECRET_KEY = <secret>. Also add
//    it under Preview if you use preview deployments.
// 3) Re-deploy the site (a push to main is enough).
//
// The client posts { token } to /api/verify-turnstile after the widget
// callback fires. This function forwards the token + secret to Cloudflare's
// siteverify endpoint and returns the verdict.

export async function onRequestPost(ctx){
  try {
    const { token } = await ctx.request.json();
    if (!token || typeof token !== 'string'){
      return json({ success: false, error: 'missing-token' }, 400);
    }
    const secret = ctx.env.TURNSTILE_SECRET_KEY;
    if (!secret){
      // Not configured — refuse (so bookings can't slip through when the
      // gate is expected to be armed but isn't).
      return json({ success: false, error: 'server-not-configured' }, 503);
    }
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    // Best-effort: include the visitor's IP so Cloudflare can factor it in.
    const ip = ctx.request.headers.get('CF-Connecting-IP');
    if (ip) body.set('remoteip', ip);

    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = await r.json();
    // Cloudflare returns { success: bool, "error-codes": [...], hostname, action, ... }
    return json({
      success: !!data.success,
      errorCodes: data['error-codes'] || [],
    }, data.success ? 200 : 403);
  } catch (e){
    return json({ success: false, error: 'bad-request' }, 400);
  }
}

// Reject anything that isn't POST.
export async function onRequest(ctx){
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
