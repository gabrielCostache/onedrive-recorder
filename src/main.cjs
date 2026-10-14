const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, clipboard, dialog, protocol, net, powerSaveBlocker, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { PublicClientApplication } = require('@azure/msal-node');
const { createGraph } = require('./graph.cjs');
const { browserLogin } = require('./browser-auth.cjs');
const { createSecureStore } = require('./secure-store.cjs');
const appConfig = require('./app-config.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'recording', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let win, dataDir, recordsDir, config = {}, library = [], auth, account, loginController, secureStore, clientId;
let signingIn = false, uploading = false, configuring = false, starting = false, restoring = false, active, captureSource, ready = false, startupNotice = '', uploads = {};
const scopes = ['https://graph.microsoft.com/Files.ReadWrite'];
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function saveJSON(name, value) {
  const destination = path.join(dataDir, name);
  fs.writeFileSync(destination + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(destination + '.tmp', destination);
}
function saveLibrary() { saveJSON('library.json', library); }
function send(channel, value) { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, value); }
function record(id) {
  const item = library.find(row => row.id === id);
  if (!item) throw new Error('Înregistrare inexistentă.');
  if (!account || item.owner !== account.homeAccountId) throw new Error('Această înregistrare aparține altui cont. Reconectează contul folosit la înregistrare.');
  return item;
}
function fileOf(item) { return path.join(recordsDir, `${item.id}.webm`); }
function setupAuth() {
  auth = clientId ? new PublicClientApplication({ auth: { clientId, authority: 'https://login.microsoftonline.com/common' },
    cache: { cachePlugin: {
      beforeCacheAccess: async context => {
        try { const stored = secureStore.read('auth-cache.bin'); if (stored?.clientId === clientId) context.tokenCache.deserialize(stored.cache); }
        catch (error) { startupNotice = error.message; secureStore.remove('auth-cache.bin'); }
      },
      afterCacheAccess: async context => {
        if (context.cacheHasChanged) secureStore.write('auth-cache.bin', { clientId, cache: context.tokenCache.serialize() });
      }
    } },
    system: { networkClient: {
      sendGetRequestAsync: (url, options) => msalRequest(url, 'GET', options),
      sendPostRequestAsync: (url, options) => msalRequest(url, 'POST', options)
    } }
  }) : undefined;
  account = undefined;
  ready = false;
}
async function msalRequest(url, method, options = {}) {
  const response = await fetch(url, { method, headers: options.headers, body: options.body, signal: AbortSignal.timeout(30000) });
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.json() };
}
function requireAccount() { if (!account || !auth) throw new Error('Conectează mai întâi contul Microsoft.'); }
function requireReady() { requireAccount(); if (!ready || config.destination?.owner !== account.homeAccountId) throw new Error('Finalizează configurarea OneDrive înainte de înregistrare.'); }
function requireIdle() { if (restoring || starting || signingIn || uploading || active || configuring) throw new Error('Finalizează operația curentă înainte de a schimba contul sau folderul.'); }
function ownDestination() { return config.destination?.owner === account?.homeAccountId ? config.destination : null; }
function publicState() {
  return { configured: Boolean(clientId), canConfigure: !app.isPackaged, ready,
    account: account?.username || '', destination: ownDestination(), persistentSession: secureStore?.available() || false,
    notice: startupNotice, restoring, signingIn, uploading: Boolean(uploading), uploadId: uploading || null, recordings: library.filter(item => account && item.owner === account.homeAccountId),
    platform: process.platform, shortcut: 'Ctrl/Cmd + Shift + X' };
}
const graph = createGraph(async () => {
  requireAccount();
  try { return (await auth.acquireTokenSilent({ account, scopes })).accessToken; }
  catch (error) {
    if (['interaction_required', 'invalid_grant', 'login_required', 'consent_required'].includes(error.errorCode)) {
      ready = false; send('state-changed', publicState()); throw new Error('Sesiunea Microsoft a expirat. Reconectează contul; fișierele locale sunt păstrate.');
    }
    throw error;
  }
});
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Cerere neautorizată.');
    return fn(...args);
  });
}

handle('state', () => publicState());
handle('configure', value => {
  requireIdle();
  if (app.isPackaged) throw new Error('Conectarea Microsoft este configurată de editorul aplicației.');
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Client ID trebuie să fie un UUID Microsoft valid.');
  clientId = value; config = { clientId }; secureStore.remove('auth-cache.bin');
  saveJSON('config.json', config); setupAuth();
  return publicState();
});
handle('login', async () => {
  if (!auth) throw new Error('Conectarea Microsoft nu a fost configurată în această versiune. Contactează editorul aplicației.');
  requireIdle();
  signingIn = true;
  loginController = new AbortController();
  try {
    const result = await browserLogin(auth, { scopes, signal: loginController.signal, openBrowser: url => shell.openExternal(url) });
    if (!result?.account) throw new Error('Autentificarea nu s-a finalizat.');
    account = result.account;
    ready = false; config.accountId = account.homeAccountId; saveJSON('config.json', config);
    await graph.drive();
    startupNotice = '';
    return publicState();
  } finally { signingIn = false; loginController = undefined; send('state-changed', publicState()); }
});
handle('cancel-login', () => { loginController?.abort(); });
handle('logout', () => {
  requireIdle(); secureStore.remove('auth-cache.bin');
  delete config.accountId; saveJSON('config.json', config); setupAuth();
  return publicState();
});
handle('folders', async folderId => {
  requireAccount();
  const [drive, folder] = await Promise.all([graph.drive(), graph.folder(folderId)]);
  if (!folder.folder || folder.remoteItem) throw new Error('Alege un folder din propriul OneDrive.');
  return { drive, folder, folders: await graph.folders(folder.id) };
});
handle('create-folder', async (parentId, name) => {
  requireAccount(); requireIdle(); configuring = true;
  try { return await graph.createFolder(parentId, name); } finally { configuring = false; }
});
handle('set-destination', async folderId => {
  requireAccount(); requireIdle(); configuring = true;
  try {
    const drive = await graph.drive();
    const destination = await graph.verifyDestination({ driveId: drive.id, folderId });
    config.destination = { ...destination, owner: account.homeAccountId }; saveJSON('config.json', config);
    ready = true; startupNotice = ''; return publicState();
  } finally { configuring = false; }
});
handle('reconnect-check', async () => {
  requireAccount(); requireIdle(); configuring = true;
  try { await validateSavedDestination(); return publicState(); }
  finally { configuring = false; }
});
handle('sources', async () => {
  requireReady();
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  // Keep the original objects: PipeWire must not open a second source chooser.
  win.captureSources = sources;
  return sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
});
handle('select-source', id => {
  requireReady();
  captureSource = win.captureSources?.find(source => source.id === id);
  if (!captureSource) throw new Error('Selectează din nou ecranul sau fereastra.');
});
handle('record-start', async title => {
  requireReady();
  if (active || starting) throw new Error('Există deja o înregistrare activă.');
  if (configuring || signingIn) throw new Error('Așteaptă finalizarea configurării.');
  const disk = fs.statfsSync(recordsDir);
  if (disk.bavail * disk.bsize < 100 * 1024 * 1024) throw new Error('Spațiu insuficient pe disc. Eliberează cel puțin 100 MB.');
  const item = { id: randomUUID(), title: String(title || 'Înregistrare').trim().slice(0, 120) || 'Înregistrare',
    createdAt: new Date().toISOString(), status: 'recording', duration: 0, bytes: 0, owner: account.homeAccountId, destination: { ...config.destination } };
  starting = true;
  try {
    const file = await fsp.open(fileOf(item), 'wx', 0o600);
    active = { item, file, queue: Promise.resolve(), failure: null, blocker: powerSaveBlocker.start('prevent-display-sleep') };
    library.unshift(item);
    try { saveLibrary(); }
    catch (error) { library.shift(); await file.close(); powerSaveBlocker.stop(active.blocker); active = undefined; throw error; }
    return item.id;
  } finally { starting = false; }
});
handle('record-chunk', (id, bytes) => {
  if (!active || active.item.id !== id || !(bytes instanceof Uint8Array) || bytes.byteLength > 32 * 1024 * 1024) throw new Error('Fragment de înregistrare invalid.');
  const current = active;
  current.queue = current.queue.then(async () => {
    if (current.failure) throw current.failure;
    const buffer = Buffer.from(bytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await current.file.write(buffer, offset, buffer.length - offset);
      if (!bytesWritten) throw new Error('Nu s-a putut scrie pe disc.');
      offset += bytesWritten;
    }
    current.item.bytes += bytes.length;
  });
  return current.queue.catch(error => { current.failure = error; throw error; });
});
handle('record-finish', async (id, duration, interrupted = false) => {
  if (!active || active.item.id !== id) throw new Error('Înregistrare inactivă.');
  const current = active;
  try { await current.queue; }
  catch (error) { current.failure = error; }
  try { await current.file.sync(); } catch (error) { current.failure = error; }
  try { await current.file.close(); } catch (error) { current.failure = error; }
  powerSaveBlocker.stop(current.blocker);
  current.item.status = current.failure || interrupted || !current.item.bytes ? 'interrupted' : 'ready';
  current.item.duration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  active = undefined; saveLibrary();
  if (current.failure) throw new Error('Scrierea a eșuat; fișierul parțial a fost păstrat.');
  return publicState();
});
handle('upload', async id => {
  requireReady();
  if (uploading) throw new Error('Există deja un upload în curs.');
  const item = record(id);
  if (item.status !== 'ready') throw new Error('Înregistrarea trebuie finalizată înainte de upload.');
  if (item.remoteId) throw new Error('Această înregistrare este deja încărcată.');
  uploading = id;
  try {
    item.uploadError = ''; saveLibrary();
    const safeTitle = item.title.replace(/["*:<>?\/\\|#%\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 90) || 'Înregistrare';
    const remote = await graph.upload(fileOf(item), `${safeTitle}-${item.id}.webm`, item.destination, {
      onProgress: percent => send('upload-progress', { id, percent }), session: uploads[id],
      saveSession: value => { if (value) uploads[id] = value; else delete uploads[id]; secureStore.write('upload-sessions.bin', uploads); }
    });
    Object.assign(item, { remoteId: remote.id, remoteUrl: remote.webUrl });
    saveLibrary(); return publicState();
  } catch (error) { item.uploadError = 'Upload întrerupt. Reîncearcă pentru a continua.'; saveLibrary(); throw error; }
  finally { uploading = false; send('state-changed', publicState()); }
});
handle('share', async (id, scope) => {
  const item = record(id);
  if (!item.remoteId || account?.homeAccountId !== item.owner) throw new Error('Conectează contul folosit pentru acest upload.');
  const url = await graph.share(item.destination.driveId, item.remoteId, scope);
  clipboard.writeText(url); return url;
});
handle('show-file', id => { shell.showItemInFolder(fileOf(record(id))); });

function createWindow() {
  win = new BrowserWindow({ width: 1220, height: 820, minWidth: 950, minHeight: 700, backgroundColor: '#f5f5f2',
    title: 'OneDrive Recorder', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', async () => {
    const interrupted = active;
    if (interrupted) {
      await interrupted.queue.catch(() => {});
      await interrupted.file.close().catch(() => {});
      powerSaveBlocker.stop(interrupted.blocker);
      interrupted.item.status = 'interrupted'; active = undefined;
      try { saveLibrary(); } catch {}
    }
    startupNotice = 'Interfața s-a închis neașteptat. Copiile locale au fost păstrate; verifică înregistrarea înainte de a continua.';
    if (win && !win.isDestroyed()) {
      const crashedWindow = win;
      createWindow();
      crashedWindow.destroy();
    }
  });
  win.on('close', event => {
    if (active || starting || uploading || signingIn || configuring) {
      event.preventDefault();
      dialog.showMessageBoxSync(win, { type: 'info', message: 'Există o operație în curs.', detail: 'Oprește înregistrarea sau așteaptă finalizarea uploadului / autentificării înainte de a închide aplicația.' });
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

async function validateSavedDestination() {
  ready = false;
  const destination = ownDestination();
  if (!destination) return;
  const [drive, folder] = await Promise.all([graph.drive(), graph.folder(destination.folderId)]);
  if (drive.id !== destination.driveId || !folder.folder || folder.remoteItem) throw new Error('Folderul salvat nu mai este disponibil. Alege un alt folder OneDrive.');
  config.destination.name = folder.name || 'OneDrive'; saveJSON('config.json', config); ready = true; startupNotice = '';
}

app.whenReady().then(async () => {
  dataDir = app.getPath('userData'); recordsDir = path.join(dataDir, 'recordings');
  fs.mkdirSync(recordsDir, { recursive: true });
  config = readJSON(path.join(dataDir, 'config.json'), {});
  library = readJSON(path.join(dataDir, 'library.json'), []);
  for (const item of library) if (item.status === 'recording') {
    item.status = 'interrupted';
    try { item.bytes = fs.statSync(fileOf(item)).size; } catch {}
  }
  saveLibrary();
  secureStore = createSecureStore(dataDir, safeStorage);
  clientId = appConfig.clientId || process.env.ONEDRIVE_CLIENT_ID || (!app.isPackaged && config.clientId) || '';
  setupAuth();
  try { uploads = secureStore.read('upload-sessions.bin') || {}; }
  catch { startupNotice = 'Sesiunile de upload nu pot fi restaurate. Copiile locale sunt păstrate.'; }
  protocol.handle('recording', request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'local' || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
      const item = record(url.pathname.slice(1));
      return net.fetch(pathToFileURL(fileOf(item)).href, { method: request.method, headers: request.headers });
    } catch { return new Response('', { status: 404 }); }
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === win?.webContents && ['media', 'display-capture'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === win?.webContents && ['media', 'display-capture'].includes(permission)));
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (request.frame !== win?.webContents.mainFrame || !captureSource) return callback({});
    const source = captureSource; captureSource = undefined;
    callback({ video: source });
  });
  restoring = Boolean(auth && config.accountId);
  createWindow();
  if (auth && config.accountId) {
    try {
      const accounts = await auth.getTokenCache().getAllAccounts();
      account = accounts.find(item => item.homeAccountId === config.accountId);
      if (account) await validateSavedDestination();
    } catch (error) { startupNotice = 'Nu am putut verifica sesiunea OneDrive. Verifică internetul sau reconectează contul.'; }
    restoring = false; send('state-changed', publicState());
  }
  const { globalShortcut } = require('electron');
  globalShortcut.register('CommandOrControl+Shift+X', () => send('stop-recording'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('Aplicația nu poate porni', error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => require('electron').globalShortcut.unregisterAll());
