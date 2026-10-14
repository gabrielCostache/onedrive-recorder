const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, dialog, protocol, net, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { recordingFileName, rebaseRecordings, verifyWritableFolder } = require('./local-storage.cjs');

const legacyUserDataDir = app.getPath('userData');
const stableUserDataDir = path.join(app.getPath('appData'), 'OneDrive Recorder');
if (path.resolve(legacyUserDataDir) !== path.resolve(stableUserDataDir)) app.setPath('userData', stableUserDataDir);

protocol.registerSchemesAsPrivileged([{ scheme: 'recording', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let win, dataDir, config = {}, library = [], destinationPath = '', starting = false, active, captureSource, startupNotice = '';
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
function publicState() {
  return { ready: Boolean(destinationPath), destinationPath, notice: startupNotice,
    recordings: library.map(item => ({ id: item.id, title: item.title, createdAt: item.createdAt,
      status: item.status, duration: item.duration, bytes: item.bytes, fileName: item.fileName,
      legacy: !item.fileName })) };
}
function requireReady() {
  if (!destinationPath) throw new Error('Alege mai întâi folderul OneDrive sincronizat pe acest calculator.');
  try {
    if (!fs.statSync(destinationPath).isDirectory()) throw new Error();
  } catch { throw new Error('Folderul OneDrive ales nu mai este disponibil. Alege-l din nou; videoclipurile salvate rămân în bibliotecă.'); }
}
function fileOf(item) { return item.path; }
function record(id) {
  const item = library.find(row => row.id === id);
  if (!item) throw new Error('Înregistrare inexistentă.');
  return item;
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Cerere neautorizată.');
    return fn(...args);
  });
}

handle('state', () => publicState());
handle('choose-folder', async () => {
  if (active || starting) throw new Error('Oprește înregistrarea înainte de a schimba folderul.');
  const result = await dialog.showOpenDialog(win, { title: 'Alege folderul OneDrive sincronizat', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return publicState();
  const selected = await verifyWritableFolder(result.filePaths[0]);
  if (await rebaseRecordings(library, config.destinationPath, selected)) saveLibrary();
  destinationPath = selected;
  config.destinationPath = selected;
  saveJSON('config.json', config);
  startupNotice = '';
  return publicState();
});
handle('sources', async () => {
  requireReady();
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
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
  const disk = fs.statfsSync(destinationPath);
  if (disk.bavail * disk.bsize < 100 * 1024 * 1024) throw new Error('Spațiu insuficient în folderul ales. Eliberează cel puțin 100 MB.');
  starting = true;
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const fileName = recordingFileName(title, createdAt, id);
  const item = { id, title: String(title || 'Înregistrare').trim().slice(0, 120) || 'Înregistrare', createdAt,
    status: 'recording', duration: 0, bytes: 0, fileName, path: path.join(destinationPath, fileName) };
  try {
    const file = await fsp.open(fileOf(item), 'wx', 0o600);
    active = { item, file, queue: Promise.resolve(), failure: null, blocker: powerSaveBlocker.start('prevent-display-sleep') };
    library.unshift(item);
    try { saveLibrary(); }
    catch (error) { library.shift(); await file.close(); powerSaveBlocker.stop(active.blocker); active = undefined; await fsp.rm(item.path, { force: true }); throw error; }
    return item.id;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') throw new Error('Nu putem crea fișierul în folderul ales. Verifică dacă folderul OneDrive este disponibil și permite scrierea.');
    throw error;
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
  try { await current.queue; } catch (error) { current.failure = error; }
  try { await current.file.sync(); } catch (error) { current.failure = error; }
  try { await current.file.close(); } catch (error) { current.failure = error; }
  powerSaveBlocker.stop(current.blocker);
  current.item.status = current.failure || interrupted || !current.item.bytes ? 'interrupted' : 'ready';
  current.item.duration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  active = undefined;
  saveLibrary();
  if (current.failure) throw new Error('Scrierea a eșuat; fișierul parțial a fost păstrat în folderul ales.');
  return publicState();
});
handle('show-file', id => {
  const item = record(id);
  if (!fs.existsSync(fileOf(item))) throw new Error('Fișierul nu mai există în folderul OneDrive ales.');
  shell.showItemInFolder(fileOf(item));
});
handle('share-file', id => {
  const item = record(id);
  if (!fs.existsSync(fileOf(item))) throw new Error('Fișierul nu mai există în folderul OneDrive ales.');
  shell.showItemInFolder(fileOf(item));
  return true;
});
handle('open-folder', async () => {
  requireReady();
  const result = await shell.openPath(destinationPath);
  if (result) throw new Error('Folderul nu s-a putut deschide: ' + result);
  return true;
});

function createWindow() {
  win = new BrowserWindow({ width: 1220, height: 820, minWidth: 950, minHeight: 700, backgroundColor: '#f5f5f2',
    icon: path.join(__dirname, 'french-bulldog-camera.png'),
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
    startupNotice = 'Interfața s-a închis neașteptat. Fișierul parțial a fost păstrat în folderul ales.';
    if (win && !win.isDestroyed()) {
      const crashedWindow = win;
      createWindow();
      crashedWindow.destroy();
    }
  });
  win.on('close', event => {
    if (active || starting) {
      event.preventDefault();
      dialog.showMessageBoxSync(win, { type: 'info', message: 'Înregistrarea este în curs.', detail: 'Oprește înregistrarea înainte de a închide aplicația.' });
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  if (path.resolve(legacyUserDataDir) !== path.resolve(dataDir) && fs.existsSync(legacyUserDataDir)) {
    for (const name of ['config.json', 'library.json']) {
      const oldFile = path.join(legacyUserDataDir, name);
      const newFile = path.join(dataDir, name);
      try { fs.copyFileSync(oldFile, newFile, fs.constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error; }
    }
  }
  config = readJSON(path.join(dataDir, 'config.json'), {});
  library = readJSON(path.join(dataDir, 'library.json'), []);
  for (const item of library) {
    if (!item.path && item.id) item.path = path.join(dataDir, 'recordings', item.id + '.webm');
    if (item.status === 'recording') {
      item.status = 'interrupted';
      try { item.bytes = fs.statSync(fileOf(item)).size; } catch {}
    }
  }
  saveLibrary();
  if (config.destinationPath) {
    try { destinationPath = await verifyWritableFolder(config.destinationPath); }
    catch { startupNotice = 'Folderul OneDrive salvat nu este disponibil. Alege-l din nou; videoclipurile existente nu au fost mutate.'; }
  }
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
  createWindow();
  const { globalShortcut } = require('electron');
  globalShortcut.register('CommandOrControl+Shift+X', () => send('stop-recording'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('Aplicația nu poate porni', error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => require('electron').globalShortcut.unregisterAll());
