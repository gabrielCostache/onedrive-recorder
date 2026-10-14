const { open } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const CHUNK_SIZE = 10 * 320 * 1024;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const enc = encodeURIComponent;
const retryable = status => status === 429 || status >= 500;
async function checked(response) {
  if (!response.ok) {
    let detail;
    try { detail = (await response.json()).error?.message; } catch {}
    throw Object.assign(new Error(`OneDrive (${response.status}): ${detail || response.statusText}`), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}
function assertTarget(target) {
  if (!target || typeof target.driveId !== 'string' || !target.driveId || typeof target.folderId !== 'string' || !target.folderId) throw new Error('Alege mai întâi folderul OneDrive.');
}
function createGraph(getToken, fetcher = fetch, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  async function request(url, options, retry = false) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(45000) });
        if (!retry || !retryable(response.status) || attempt === 3) return response;
        const seconds = Number(response.headers.get('Retry-After'));
        await sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30000) : 1000 * 2 ** attempt);
      } catch (error) {
        if (!retry || attempt === 3) throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  async function api(route, method = 'GET', body, raw = false) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Adresă Graph invalidă.');
    const token = await getToken();
    return checked(await request(`${GRAPH}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'text/plain' : 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    }, ['GET', 'DELETE'].includes(method)));
  }
  const graph = {
    drive: () => api('/me/drive?$select=id,driveType,name,webUrl'),
    folder: id => api(`/me/drive/${id ? `items/${enc(id)}` : 'root'}?$select=id,name,folder,parentReference,remoteItem,webUrl`),
    async folders(parentId) {
      let route = `/me/drive/items/${enc(parentId)}/children?$select=id,name,folder,remoteItem&$top=200`;
      const folders = [];
      while (route) {
        const page = await api(route);
        folders.push(...page.value.filter(item => item.folder && !item.remoteItem));
        const next = page['@odata.nextLink'];
        if (next && !next.startsWith(`${GRAPH}/`)) throw new Error('Paginare OneDrive invalidă.');
        route = next ? next.slice(GRAPH.length) : null;
      }
      return folders.sort((a, b) => a.name.localeCompare(b.name));
    },
    async createFolder(parentId, name) {
      if (typeof name !== 'string' || !name.trim() || name.length > 100 || /["*:<>?\/\\|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^\./.test(name)) throw new Error('Alege un nume de folder valid, fără caractere speciale.');
      return api(`/me/drive/items/${enc(parentId)}/children`, 'POST', { name: name.trim(), folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
    },
    async verifyDestination(target) {
      assertTarget(target);
      const [drive, folder] = await Promise.all([graph.drive(), graph.folder(target.folderId)]);
      if (drive.id !== target.driveId || !folder.folder || folder.remoteItem || folder.parentReference?.driveId && folder.parentReference.driveId !== drive.id) throw new Error('Alege un folder din propriul OneDrive.');
      const name = `recorder-connection-check-${randomUUID()}.txt`;
      const probe = await api(`/drives/${enc(drive.id)}/items/${enc(folder.id)}:/${enc(name)}:/content`, 'PUT', 'Recorder connection check. This temporary file is removed automatically.', true);
      await api(`/drives/${enc(drive.id)}/items/${enc(probe.id)}`, 'DELETE');
      return { driveId: drive.id, folderId: folder.id, name: folder.name || 'OneDrive', driveType: drive.driveType };
    },
    async upload(file, name, target, { onProgress = () => {}, session: saved, saveSession = () => {} } = {}) {
      assertTarget(target);
      const handle = await open(file, 'r');
      try {
        const { size } = await handle.stat();
        if (!size) throw new Error('Înregistrarea este goală.');
        let session = saved, offset = 0;
        const getExisting = async () => {
          try {
            const existing = await api(`/drives/${enc(target.driveId)}/items/${enc(target.folderId)}:/${enc(name)}?$select=id,name,size,parentReference,webUrl`);
            if (existing.size !== size) throw new Error('Există un fișier cu același nume și altă dimensiune. Nu îl suprascriem.');
            return existing;
          } catch (error) { if (error.status === 404) return null; throw error; }
        };
        const readStatus = async () => {
          const response = await request(session.uploadUrl, { method: 'GET' }, true);
          if (response.status === 404 || response.status === 410) return null;
          return checked(response);
        };
        const rangeOffset = status => {
          const ranges = status.nextExpectedRanges;
          if (!Array.isArray(ranges) || !ranges.length || !/^\d+-/.test(ranges[0])) throw new Error('Progres OneDrive invalid. Fișierul local a fost păstrat.');
          const next = Number(ranges[0].split('-')[0]);
          if (!Number.isSafeInteger(next) || next < 0 || next > size || next !== size && next % (320 * 1024) !== 0) throw new Error('Poziție de reluare OneDrive invalidă.');
          return next;
        };
        if (session) {
          if (new URL(session.uploadUrl).protocol !== 'https:') throw new Error('Sesiune de upload invalidă.');
          const status = await readStatus();
          if (status) offset = rangeOffset(status);
          else {
            const existing = await getExisting();
            if (existing) { await saveSession(null); onProgress(100); return existing; }
            session = null;
          }
        }
        if (!session) {
          // UUID filenames and fail-on-conflict prevent duplicate uploads and overwrites.
          const existing = await getExisting();
          if (existing) { await saveSession(null); onProgress(100); return existing; }
          session = await api(`/drives/${enc(target.driveId)}/items/${enc(target.folderId)}:/${enc(name)}:/createUploadSession`, 'POST', {
            item: { '@microsoft.graph.conflictBehavior': 'fail', name }, fileSize: size
          });
          if (!session.uploadUrl || new URL(session.uploadUrl).protocol !== 'https:') throw new Error('Sesiune de upload invalidă.');
          await saveSession(session);
        }
        let failures = 0;
        while (offset < size) {
          const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, size - offset));
          let read = 0;
          while (read < buffer.length) {
            const { bytesRead } = await handle.read(buffer, read, buffer.length - read, offset + read);
            if (!bytesRead) throw new Error('Fișierul local s-a modificat în timpul încărcării.');
            read += bytesRead;
          }
          let response;
          try {
            // Upload URLs are preauthorized. Never attach a Graph bearer token.
            response = await request(session.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(buffer.length),
              'Content-Range': `bytes ${offset}-${offset + buffer.length - 1}/${size}` }, body: buffer });
            if (response.status === 416 || retryable(response.status)) throw new Error('Reverificăm progresul OneDrive.');
          } catch {
            if (++failures > 3) throw new Error('Upload întrerupt. Copia locală este păstrată; apasă Reîncearcă pentru reluare.');
            const retryAfter = Number(response?.headers.get('Retry-After'));
            await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1000 * 2 ** (failures - 1));
            const status = await readStatus();
            if (!status) {
              const existing = await getExisting();
              if (existing) { await saveSession(null); onProgress(100); return existing; }
              throw new Error('Sesiunea OneDrive a expirat. Apasă Reîncearcă.');
            }
            offset = rangeOffset(status); continue;
          }
          const result = await checked(response);
          if (response.status === 200 || response.status === 201) {
            if (!result.id || offset + buffer.length !== size) throw new Error('Răspuns de upload incomplet.');
            await saveSession(null); onProgress(100); return result;
          }
          if (response.status !== 202) throw new Error('Răspuns neașteptat la upload.');
          const next = rangeOffset(result);
          if (next <= offset) { if (++failures > 3) throw new Error('Uploadul nu avansează. Reîncearcă mai târziu.'); }
          else failures = 0;
          offset = next;
          if (result.expirationDateTime) session.expirationDateTime = result.expirationDateTime;
          await saveSession(session); onProgress(Math.min(99, Math.round(offset / size * 100)));
        }
        const existing = await getExisting();
        if (existing) { await saveSession(null); onProgress(100); return existing; }
        throw new Error('OneDrive nu a confirmat finalizarea încărcării.');
      } finally { await handle.close(); }
    },
    async share(driveId, itemId, scope) {
      if (!['anonymous', 'organization'].includes(scope)) throw new Error('Alege cine poate accesa linkul.');
      const result = await api(`/drives/${enc(driveId)}/items/${enc(itemId)}/createLink`, 'POST', { type: 'view', scope });
      const url = result.link?.webUrl;
      if (!url || new URL(url).protocol !== 'https:' || result.link.scope !== scope) throw new Error('OneDrive nu a confirmat tipul de link solicitat.');
      return url;
    }
  };
  return graph;
}
module.exports = { createGraph, CHUNK_SIZE, assertTarget };
