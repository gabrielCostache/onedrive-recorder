const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

// MSAL handles discovery and token exchange. Loopback callbacks are protected
// by PKCE + state, with cancellation and a bounded authentication window.
async function browserLogin(client, { scopes, openBrowser, signal, timeoutMs = 300000 }) {
  const state = randomBytes(32).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let redirectUri, timer, settled = false, resolveCode, rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  codePromise.catch(() => {});
  const reject = error => { if (!settled) { settled = true; rejectCode(error); } };
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method !== 'GET' || request.url.length > 16384) { response.writeHead(405).end(); return; }
    let url;
    try { url = new URL(request.url, redirectUri); } catch { response.writeHead(400).end(); return; }
    if (url.origin !== redirectUri) { response.writeHead(400).end(); return; }
    if (url.pathname !== '/') { response.writeHead(404).end(); return; }
    const supplied = Buffer.from(url.searchParams.get('state') || '');
    const expected = Buffer.from(state);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || settled) {
      response.writeHead(400).end('Cerere invalida. Revino in aplicatie.'); return;
    }
    if (url.searchParams.has('error')) {
      response.end('Autentificarea nu s-a finalizat. Revino in aplicatie.');
      reject(new Error('Autentificarea a fost refuzată sau anulată în browser.')); return;
    }
    const code = url.searchParams.get('code');
    if (!code) { response.writeHead(400).end('Lipseste codul de autentificare.'); return; }
    settled = true;
    response.end('Confirmare primita. Poti inchide aceasta pagina si reveni in Recorder.');
    resolveCode(code);
  });
  const onAbort = () => { reject(new Error('Autentificare anulată.')); server.close(); };
  try {
    if (signal?.aborted) throw new Error('Autentificare anulată.');
    await new Promise((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolve); });
    redirectUri = `http://localhost:${server.address().port}`;
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return await codePromise; }
    timer = setTimeout(() => { reject(new Error('Autentificarea a expirat. Încearcă din nou.')); server.close(); }, timeoutMs);
    const authorizeUrl = await client.getAuthCodeUrl({ scopes, redirectUri, prompt: 'select_account', responseMode: 'query', state,
      codeChallenge: challenge, codeChallengeMethod: 'S256' });
    if (signal?.aborted || settled) return await codePromise;
    if (new URL(authorizeUrl).origin !== 'https://login.microsoftonline.com') throw new Error('Adresă Microsoft de autentificare invalidă.');
    await openBrowser(authorizeUrl);
    const code = await codePromise;
    const result = await client.acquireTokenByCode({ scopes, redirectUri, code, codeVerifier: verifier });
    if (signal?.aborted) throw new Error('Autentificare anulată.');
    return result;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    server.close(); server.closeAllConnections();
  }
}
module.exports = { browserLogin };
