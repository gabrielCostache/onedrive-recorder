const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeTitle, recordingFileName, rebaseRecordings, verifyWritableFolder } = require('../src/local-storage.cjs');

test('recording titles become valid cross-platform filenames', () => {
  assert.equal(safeTitle('  Review: v2?*  '), 'Review- v2--');
  assert.equal(safeTitle('... '), 'Înregistrare');
  assert.ok(safeTitle('x'.repeat(150)).length <= 100);
});

test('recording names include a unique suffix and WebM extension', () => {
  const date = '2026-10-14T12:34:56.789Z';
  const first = recordingFileName('Demo / Plan', date, '12345678-aaaa');
  const second = recordingFileName('Demo / Plan', date, '87654321-bbbb');
  assert.match(first, /^Demo - Plan-20261014123456-12345678\.webm$/);
  assert.notEqual(first, second);
});

test('folder validation checks write access and removes its probe file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-folder-'));
  try {
    assert.equal(await verifyWritableFolder(root), path.resolve(root));
    assert.deepEqual(await fs.readdir(root), []);
    await assert.rejects(verifyWritableFolder(path.join(root, 'missing')), /folder existent/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a renamed destination can reconnect history to matching videos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-rename-'));
  const oldFolder = path.join(root, 'Recordings');
  const newFolder = path.join(root, 'Videos');
  await fs.mkdir(oldFolder);
  const fileName = 'Demo-20261014123456-12345678.webm';
  const oldFile = path.join(oldFolder, fileName);
  await fs.writeFile(oldFile, 'saved-video');
  const records = [{ fileName, path: oldFile, bytes: 11 }];
  try {
    await fs.rename(oldFolder, newFolder);
    assert.equal(await rebaseRecordings(records, oldFolder, newFolder), 1);
    assert.equal(records[0].path, path.join(newFolder, fileName));
    assert.equal(await fs.readFile(records[0].path, 'utf8'), 'saved-video');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
