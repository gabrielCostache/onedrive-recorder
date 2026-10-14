const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecureStore } = require('../src/secure-store.cjs');
test('Linux basic_text and missing OS encryption never persist credentials', () => {
  for (const enabled of [true, false]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-secure-'));
    try {
      const store = createSecureStore(dir, { isEncryptionAvailable: () => enabled, getSelectedStorageBackend: () => 'basic_text', encryptString: () => assert.fail('No plaintext fallback') }, 'linux');
      assert.equal(store.write('cache', { token: 'secret' }), false); assert.deepEqual(fs.readdirSync(dir), []);
    } finally { fs.rmSync(dir, { recursive: true }); }
  }
});
test('credential persistence uses the supplied OS encryption API and can be cleared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-secure-'));
  const values = new Map(); let next = 0;
  try {
    const store = createSecureStore(dir, { isEncryptionAvailable: () => true,
      encryptString: value => { const key = `encrypted-${++next}`; values.set(key, value); return Buffer.from(key); },
      decryptString: buffer => values.get(buffer.toString()) }, 'darwin');
    store.write('cache', { token: 'secret' });
    assert.ok(!fs.readFileSync(path.join(dir, 'cache'), 'utf8').includes('secret'));
    assert.deepEqual(store.read('cache'), { token: 'secret' });
    store.remove('cache'); assert.equal(store.read('cache'), null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
