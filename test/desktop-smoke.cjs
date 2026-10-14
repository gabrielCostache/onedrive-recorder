// Real Electron + MediaRecorder; Microsoft and OS encryption use test-only fixtures.
// No private screen, microphone or real Microsoft account is accessed.
const { _electron: electron, expect } = require('@playwright/test');
const { mkdtemp, readFile, rm, mkdir, realpath } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'recorder-desktop-'));
  const root = path.resolve(__dirname, '..');
  const screenshots = path.resolve(root, '../../work/qa-v02');
  await mkdir(screenshots, { recursive: true });
  let desktop;
  const launch = async fixture => {
    desktop = await electron.launch({ args: [fixture ? path.join(__dirname, 'fixtures/desktop-entry.cjs') : root, `--user-data-dir=${profile}`] });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(10000);
    await expect(page.locator('#onboarding')).toBeAttached();
    return page;
  };
  try {
    let page = await launch(false);
    await expect(page.locator('#onboarding')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#setup-login')).toBeDisabled();
    await page.evaluate(async () => {
      for (const action of [() => window.recorder.start('bypass'), () => window.recorder.sources()]) {
        try { await action(); throw new Error('Gate bypassed'); } catch (error) { if (!error.message.includes('Conectează')) throw error; }
      }
    });
    await page.locator('#developer-settings').click();
    await page.locator('#client-id').fill('not-a-uuid');
    await page.locator('#settings-form button[type=submit]').click();
    await expect(page.locator('#settings .inline-error')).toContainText('UUID');
    await desktop.close();

    page = await launch(true);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#setup-login')).toBeEnabled();
    const actualProfile = await desktop.evaluate(({ app }) => app.getPath('userData'));
    if (await realpath(actualProfile) !== await realpath(profile)) throw new Error('Unexpected test profile');
    await page.screenshot({ path: path.join(screenshots, 'onboarding.png') });
    await desktop.evaluate(() => { global.recorderFixture.waitingLogin = true; });
    await page.locator('#setup-login').click();
    await expect(page.locator('#login-wait')).toBeVisible();
    await page.locator('#cancel-auth').click();
    await expect(page.locator('#setup-error')).toContainText('anulată');
    await desktop.evaluate(() => { global.recorderFixture.waitingLogin = false; });
    await page.locator('#setup-login').click();
    await expect(page.locator('#setup-account-name')).toHaveText('alex@example.com');
    await expect(page.locator('#workspace')).toBeHidden();
    await page.evaluate(async () => {
      try { await window.recorder.start('bypass'); throw new Error('Destination gate bypassed'); }
      catch (error) { if (!error.message.includes('configurarea')) throw error; }
    });
    await page.locator('#choose-folder').click();
    await page.getByRole('button', { name: /Fără acces/ }).click();
    await page.locator('#confirm-folder').click();
    await expect(page.locator('#folder-error')).toContainText('403');
    await expect(page.locator('#workspace')).toBeHidden();
    await page.locator('#folder-up').click();
    await page.getByRole('button', { name: /Recordings/ }).click();
    await page.screenshot({ path: path.join(screenshots, 'folder.png') });
    await page.locator('#confirm-folder').click();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#onboarding')).toBeHidden();
    await expect(page.locator('#workspace-destination')).toContainText('Recordings');

    await desktop.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].captureSources = [{ id: 'synthetic', name: 'Synthetic test source' }];
      global.recorderFixture.failUpload = true;
    });
    await page.evaluate(() => {
      source = { id: 'synthetic', name: 'Synthetic test source' };
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext('2d');
        const animate = () => { context.fillStyle = '#365b40'; context.fillRect(0, 0, 640, 360); context.fillStyle = '#dcebc9'; context.font = '30px sans-serif'; context.fillText(`Recorder test ${Math.round(performance.now())}`, 30, 170); };
        animate(); const interval = setInterval(animate, 100);
        const stream = canvas.captureStream(10); stream.getTracks()[0].addEventListener('ended', () => clearInterval(interval)); return stream;
      };
    });
    await page.locator('#microphone').uncheck();
    await page.locator('#title').fill('Test local — înregistrare');
    await page.locator('#start').click();
    await expect(page.locator('#stop')).toBeVisible();
    await expect(page.locator('#timer')).toHaveText('00:02', { timeout: 10000 });
    await page.evaluate(async () => {
      try { await window.recorder.logout(); throw new Error('Logout during recording'); }
      catch (error) { if (!error.message.includes('operația')) throw error; }
    });
    await page.locator('#pause').click(); await expect(page.locator('#pause')).toHaveText('Continuă');
    await page.locator('#pause').click(); await expect(page.locator('#pause')).toHaveText('Pauză');
    await page.locator('#stop').click();
    await expect(page.getByRole('button', { name: 'Reîncearcă ↑' })).toBeEnabled();
    const state = await page.evaluate(() => window.recorder.state());
    const record = state.recordings[0];
    if (record.status !== 'ready' || record.bytes <= 0 || record.destination.folderId !== 'recordings') throw new Error('Invalid saved recording');
    const local = await readFile(path.join(profile, 'recordings', record.id + '.webm'));
    if (local.length !== record.bytes || local.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error('Invalid WebM');
    await page.locator('.video-icon').click();
    await expect.poll(() => page.locator('#preview').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    await page.locator('[data-close=preview-dialog]').click();
    await desktop.evaluate(() => { global.recorderFixture.failUpload = false; });
    await page.getByRole('button', { name: 'Reîncearcă ↑' }).click();
    await expect(page.getByRole('button', { name: 'Creează și copiază link' })).toBeEnabled();
    const upload = await desktop.evaluate(() => ({ count: global.recorderFixture.uploadCount, target: global.recorderFixture.uploadTarget }));
    if (upload.count !== 2 || upload.target.folderId !== 'recordings') throw new Error('Wrong automatic upload target');
    await page.screenshot({ path: path.join(screenshots, 'studio.png') });
    if (errors.length) throw new Error(errors.join('\n'));
    await desktop.close();

    page = await launch(true);
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('.recording-row')).toHaveCount(1);
    await page.locator('#settings-open').click();
    await page.locator('#switch-account').click();
    await expect(page.locator('#setup-login')).toBeVisible();
    await page.evaluate(async () => {
      const state = await window.recorder.state(); if (state.recordings.length) throw new Error('Previous account library leaked after logout');
    });
    await desktop.evaluate(() => { global.recorderFixture.account = 'other@example.com'; });
    await page.locator('#setup-login').click();
    await expect(page.locator('#setup-account-name')).toHaveText('other@example.com');
    await expect(page.locator('#destination-name')).toHaveText('Niciun folder selectat');
    await page.evaluate(async id => {
      try { await window.recorder.showFile(id); throw new Error('Cross-account access'); }
      catch (error) { if (!error.message.includes('altui cont')) throw error; }
    }, record.id);
    const interruptedId = await page.evaluate(async () => {
      await window.recorder.setDestination('recordings');
      const id = await window.recorder.start('Crash recovery fixture');
      await window.recorder.chunk(id, new Uint8Array([1, 2, 3])); return id;
    });
    const recoveredWindow = desktop.waitForEvent('window');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
      return saved.find(item => item.id === interruptedId)?.status;
    }).toBe('interrupted');
    page = await recoveredWindow;
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#start')).toBeEnabled();
    console.log('PASS: mandatory onboarding, browser cancel, denied folder, folder validation, synthetic capture, pause/resume, automatic upload failure/retry, local playback, restart persistence, account isolation and renderer crash recovery. Microsoft and OS encryption were mocked.');
  } finally { if (desktop) await desktop.close().catch(() => {}); await rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
