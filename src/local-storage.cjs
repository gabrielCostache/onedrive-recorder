const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function safeTitle(value) {
  const result = String(value || 'Înregistrare').trim()
    .replace(/[<>:"/\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100);
  return result || 'Înregistrare';
}
function recordingFileName(title, date, id) {
  const stamp = date.replace(/[-:TZ.]/g, '').slice(0, 14);
  return safeTitle(title) + '-' + stamp + '-' + id.slice(0, 8) + '.webm';
}
async function verifyWritableFolder(selected) {
  const resolved = path.resolve(selected);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Alege un folder existent, sincronizat de aplicația OneDrive.');
  const probe = path.join(resolved, '.onedrive-recorder-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(probe, 'wx');
    await handle.writeFile('OneDrive Recorder');
    await handle.sync();
  } catch {
    throw new Error('Nu putem scrie în acest folder. Verifică permisiunile și dacă OneDrive este disponibil.');
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(probe, { force: true }).catch(() => {});
  }
  return resolved;
}
async function rebaseRecordings(records, previousFolder, selectedFolder) {
  if (!previousFolder || path.resolve(previousFolder) === path.resolve(selectedFolder)) return 0;
  const oldFolder = path.resolve(previousFolder);
  if (await fs.stat(oldFolder).then(() => true, () => false)) return 0;
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  let moved = 0;
  for (const item of records) {
    if (!item.fileName || !item.path || normalize(path.dirname(item.path)) !== normalize(oldFolder)) continue;
    const candidate = path.join(selectedFolder, item.fileName);
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat?.isFile() || (item.bytes && stat.size !== item.bytes)) continue;
    item.path = candidate;
    moved++;
  }
  return moved;
}
module.exports = { safeTitle, recordingFileName, verifyWritableFolder, rebaseRecordings };
