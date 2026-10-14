// Test-only dependency substitutes. This directory is excluded from all builds.
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
const main = path.resolve(__dirname, '../../src/main.cjs');
const appConfig = require('../../src/app-config.json');
appConfig.clientId = '11111111-1111-1111-1111-111111111111';
global.recorderFixture = { failProbe: false, failUpload: false, waitingLogin: false, account: 'alex@example.com', uploadCount: 0 };
class MockMSAL {
  constructor(config) {
    this.config = config; this.accounts = [];
    this.cache = {
      serialize: () => JSON.stringify(this.accounts), deserialize: value => { this.accounts = JSON.parse(value); },
      getAllAccounts: async () => { await config.cache.cachePlugin.beforeCacheAccess({ tokenCache: this.cache }); return this.accounts; }
    };
  }
  getTokenCache() { return this.cache; }
  async acquireTokenSilent() { return { accessToken: 'TEST-TOKEN' }; }
  async login() {
    const account = { username: global.recorderFixture.account, homeAccountId: global.recorderFixture.account, tenantId: 'test' };
    this.accounts = [account];
    await this.config.cache.cachePlugin.afterCacheAccess({ cacheHasChanged: true, tokenCache: this.cache });
    return { account };
  }
}
const folder = id => ({ id: id || 'root', name: !id || id === 'root' ? 'OneDrive' : id === 'restricted' ? 'Fără acces' : 'Recordings', folder: {}, parentReference: { driveId: 'drive' } });
const mockGraph = {
  drive: async () => ({ id: 'drive', driveType: 'business' }),
  folder: async id => folder(id),
  folders: async id => id === 'root' ? [folder('recordings'), folder('restricted')] : [],
  createFolder: async () => folder('recordings'),
  verifyDestination: async target => {
    if (global.recorderFixture.failProbe || target.folderId === 'restricted') throw new Error('OneDrive (403): Nu ai dreptul de salvare în acest folder.');
    return { ...target, name: folder(target.folderId).name, driveType: 'business' };
  },
  upload: async (_file, _name, target, options) => {
    global.recorderFixture.uploadCount++;
    global.recorderFixture.uploadTarget = target;
    if (global.recorderFixture.failUpload) throw new Error('Conexiune întreruptă. Reîncearcă uploadul.');
    options.onProgress(50); await new Promise(resolve => setTimeout(resolve, 150));
    options.onProgress(100); options.saveSession(null); return { id: 'remote', webUrl: 'https://example.com/test-video' };
  },
  share: async () => 'https://example.com/test-share'
};
Module._load = function(request, parent, isMain) {
  if (parent?.filename === main) {
    if (request === '@azure/msal-node') return { PublicClientApplication: MockMSAL };
    if (request === './browser-auth.cjs') return { browserLogin: async (client, options) => {
      if (global.recorderFixture.waitingLogin) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('Autentificare anulată.')), { once: true }));
      return client.login();
    } };
    if (request === './graph.cjs') return { createGraph: () => mockGraph };
    if (request === 'electron') {
      const electron = originalLoad.apply(this, arguments);
      const codec = bytes => Buffer.from(bytes).map(byte => byte ^ 90);
      return { ...electron, safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: value => codec(Buffer.from(value)), decryptString: value => codec(value).toString() } };
    }
  }
  return originalLoad.apply(this, arguments);
};
require(main);
