// Real Electron and MediaRecorder with a temporary local folder; no real OneDrive account is accessed.
const { _electron: electron, expect } = require('@playwright/test');
const { mkdtemp, readFile, readdir, rm, mkdir, stat } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'recorder-desktop-'));
  const folder = path.join(profile, 'OneDrive', 'Videos');
  await mkdir(folder, { recursive: true });
  let desktop;
  const launch = async () => {
    desktop = await electron.launch({ args: [path.join(__dirname, 'fixtures/desktop-entry.cjs'), '--user-data-dir=' + path.join(profile, 'profile')], env: { ...process.env, RECORDER_TEST_FOLDER: folder } });
    const page = await desktop.firstWindow(); page.setDefaultTimeout(10000); return page;
  };
  try {
    let page = await launch();
    await expect(page.locator('#onboarding')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#choose-folder')).toBeEnabled();
    await page.locator('#choose-folder').click();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#workspace-destination')).toContainText(folder);
    await page.evaluate(() => { source = { id: 'synthetic', name: 'Synthetic test source' }; });
    await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].captureSources = [{ id: 'synthetic', name: 'Synthetic test source' }]; });
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext('2d');
        const draw = () => { context.fillStyle = '#365b40'; context.fillRect(0, 0, 640, 360); context.fillStyle = '#dcebc9'; context.font = '26px sans-serif'; context.fillText('Recorder local test', 30, 170); };
        draw(); const interval = setInterval(draw, 100); const stream = canvas.captureStream(10);
        stream.getTracks()[0].addEventListener('ended', () => clearInterval(interval)); return stream;
      };
    });
    await page.locator('#microphone').uncheck();
    await page.locator('#title').fill('Test local — înregistrare');
    await page.locator('#start').click();
    await expect(page.locator('#stop')).toBeVisible();
    await expect(page.locator('#timer')).toHaveText('00:02', { timeout: 10000 });
    await page.locator('#stop').click();
    await expect(page.getByText(/Salvată local în folderul OneDrive/)).toBeVisible();
    const state = await page.evaluate(() => window.recorder.state());
    const item = state.recordings[0];
    if (item.status !== 'ready' || item.bytes <= 0 || item.path !== undefined) throw new Error('Recording metadata leaked a local absolute path');
    const names = await readdir(folder);
    if (names.length !== 1 || names[0] !== item.fileName) throw new Error('Recording was not saved to the selected folder');
    const localPath = path.join(folder, names[0]);
    const file = await readFile(localPath);
    if (file.length !== item.bytes || file.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error('Invalid WebM recording');
    await page.locator('.video-icon').click();
    await expect.poll(() => page.locator('#preview').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    await page.locator('[data-close=preview-dialog]').click();
    await page.getByRole('button', { name: /Partajează în OneDrive/ }).click();
    await expect(page.locator('#status')).toContainText('Folosește Share');
    const selected = await desktop.evaluate(() => global.recorderFixture.shownFile);
    if (selected !== localPath) throw new Error('Share handoff did not select the recording');
    await desktop.close();
    page = await launch();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('.recording-row')).toHaveCount(1);
    console.log('PASS: folder setup and persistence, synthetic capture, pause-independent stop, WebM saved in selected folder, local playback and OneDrive share handoff. Cloud sync and link creation are intentionally handled by OneDrive.');
  } finally { if (desktop) await desktop.close().catch(() => {}); await rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
