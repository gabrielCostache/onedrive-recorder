const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { browserLogin } = require('../src/browser-auth.cjs');
const scope = ['Files.ReadWrite'];
test('browser authentication validates state and exchanges the code with its PKCE verifier', async () => {
  let request;
  const client = {
    getAuthCodeUrl: async options => { request = options; return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'; },
    acquireTokenByCode: async options => {
      assert.equal(options.code, 'valid-code');
      assert.equal(createHash('sha256').update(options.codeVerifier).digest('base64url'), request.codeChallenge);
      return { account: { username: 'test@example.com' } };
    }
  };
  const result = await browserLogin(client, { scopes: scope, openBrowser: async () => {
    const bad = await fetch(`${request.redirectUri}/?state=wrong&code=attacker`); assert.equal(bad.status, 400);
    const good = await fetch(`${request.redirectUri}/?state=${request.state}&code=valid-code`); assert.equal(good.status, 200);
  } });
  assert.equal(result.account.username, 'test@example.com');
  await assert.rejects(fetch(request.redirectUri));
});
test('cancellation closes the listener and does not accept a late result', async () => {
  const controller = new AbortController(); let uri;
  const client = { getAuthCodeUrl: async options => { uri = options.redirectUri; return 'https://login.microsoftonline.com/auth'; }, acquireTokenByCode: () => { throw new Error('Should not exchange'); } };
  await assert.rejects(browserLogin(client, { scopes: scope, signal: controller.signal, openBrowser: async () => controller.abort() }), /anulată/);
  await assert.rejects(fetch(uri));
});
test('abandoned browser login times out', async () => {
  const client = { getAuthCodeUrl: async () => 'https://login.microsoftonline.com/auth' };
  await assert.rejects(browserLogin(client, { scopes: scope, timeoutMs: 20, openBrowser: async () => {} }), /expirat/);
});
test('unexpected browser destination is rejected', async () => {
  const client = { getAuthCodeUrl: async () => 'https://attacker.invalid/' };
  await assert.rejects(browserLogin(client, { scopes: scope, openBrowser: async () => assert.fail('Must not open') }), /invalidă/);
});
