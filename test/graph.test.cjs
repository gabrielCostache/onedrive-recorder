const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGraph, CHUNK_SIZE } = require('../src/graph.cjs');
const target = { driveId: 'drive', folderId: 'folder' };
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
const missing = () => json({ error: { message: 'Not found' } }, 404);
const session = { uploadUrl: 'https://upload.example/session' };
const make = fetcher => createGraph(async () => 'SECRET-TOKEN', fetcher, { sleep: async () => {} });
async function withVideo(bytes, callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'recorder-'));
  try { const file = path.join(dir, 'video.webm'); await writeFile(file, bytes); return await callback(file); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
test('chunks preserve bytes and target the selected folder without leaking bearer tokens', () => withVideo(Buffer.alloc(CHUNK_SIZE + 123, 42), async file => {
  const chunks = [], progress = [], saved = []; let body;
  const graph = make(async (url, options) => {
    if (url.includes('graph.microsoft.com')) {
      assert.equal(options.headers.Authorization, 'Bearer SECRET-TOKEN');
      if (options.method === 'GET') return missing();
      assert.ok(url.includes('/drives/drive/items/folder:/video.webm:/createUploadSession'));
      body = JSON.parse(options.body); return json(session);
    }
    assert.equal(options.headers.Authorization, undefined); chunks.push(options);
    return chunks.length === 1 ? json({ nextExpectedRanges: [`${CHUNK_SIZE}-`] }, 202) : json({ id: 'remote' }, 201);
  });
  const item = await graph.upload(file, 'video.webm', target, { onProgress: p => progress.push(p), saveSession: s => saved.push(s) });
  assert.equal(item.id, 'remote'); assert.equal(body.item['@microsoft.graph.conflictBehavior'], 'fail');
  assert.equal(chunks[0].headers['Content-Range'], `bytes 0-${CHUNK_SIZE - 1}/${CHUNK_SIZE + 123}`);
  assert.equal(chunks[1].headers['Content-Range'], `bytes ${CHUNK_SIZE}-${CHUNK_SIZE + 122}/${CHUNK_SIZE + 123}`);
  assert.deepEqual(Buffer.concat(chunks.map(chunk => chunk.body)), Buffer.alloc(CHUNK_SIZE + 123, 42));
  assert.equal(progress.at(-1), 100); assert.equal(saved.at(-1), null);
}));
test('saved upload resumes from the server-confirmed offset', () => withVideo(Buffer.alloc(CHUNK_SIZE + 123), async file => {
  let puts = 0;
  const graph = make(async (_url, options) => {
    assert.equal(options.headers?.Authorization, undefined);
    if (options.method === 'GET') return json({ nextExpectedRanges: [`${CHUNK_SIZE}-`] });
    puts++; assert.equal(options.body.length, 123); return json({ id: 'remote' }, 201);
  });
  await graph.upload(file, 'video.webm', target, { session }); assert.equal(puts, 1);
}));
test('a lost response recovers without resending an accepted fragment', () => withVideo(Buffer.alloc(CHUNK_SIZE + 23), async file => {
  let puts = 0;
  const graph = make(async (url, options) => {
    if (url.includes('graph.microsoft.com')) return options.method === 'GET' ? missing() : json(session);
    if (options.method === 'GET') return json({ nextExpectedRanges: [`${CHUNK_SIZE}-`] });
    if (++puts === 1) throw new TypeError('Network disconnected after upload');
    assert.match(options.headers['Content-Range'], new RegExp(`^bytes ${CHUNK_SIZE}-`));
    return json({ id: 'remote' }, 201);
  });
  assert.equal((await graph.upload(file, 'video.webm', target)).id, 'remote'); assert.equal(puts, 2);
}));
test('lost final response resolves the already committed file without a duplicate', () => withVideo('video', async file => {
  let lookup = 0, creates = 0;
  const graph = make(async (url, options) => {
    if (url.includes('graph.microsoft.com')) {
      if (options.method === 'GET') return ++lookup === 1 ? missing() : json({ id: 'committed', size: 5 });
      creates++; return json(session);
    }
    if (options.method === 'GET') return missing();
    throw new TypeError('Lost final response');
  });
  assert.equal((await graph.upload(file, 'video.webm', target)).id, 'committed'); assert.equal(creates, 1);
}));
test('quota errors are surfaced, not reported as success', () => withVideo('video', async file => {
  const graph = make(async (_url, options) => options.method === 'GET' ? missing() : json({ error: { message: 'Quota exceeded' } }, 507));
  await assert.rejects(graph.upload(file, 'video.webm', target), /507.*Quota exceeded/);
}));
test('permission denied is not retried indefinitely', () => withVideo('video', async file => {
  let puts = 0;
  const graph = make(async (url, options) => {
    if (url.includes('graph.microsoft.com')) return options.method === 'GET' ? missing() : json(session);
    puts++; return json({ error: { message: 'Access denied' } }, 403);
  });
  await assert.rejects(graph.upload(file, 'video.webm', target), /403/); assert.equal(puts, 1);
}));
test('different-sized existing files are never overwritten', () => withVideo('video', async file => {
  const graph = make(async () => json({ id: 'existing', size: 99 }));
  await assert.rejects(graph.upload(file, 'video.webm', target), /Nu îl suprascriem/);
}));
test('a 202 response alone never produces a completed upload', () => withVideo('video', async file => {
  const graph = make(async (url, options) => url.includes('graph.microsoft.com') ? options.method === 'GET' ? missing() : json(session) : json({ nextExpectedRanges: ['5-'] }, 202));
  await assert.rejects(graph.upload(file, 'video.webm', target), /nu a confirmat/);
}));
test('sharing requires an explicit audience and verifies the audience returned by Microsoft', async () => {
  const bodies = [];
  const graph = make(async (_url, options) => { bodies.push(JSON.parse(options.body)); return json({ link: { scope: 'organization', webUrl: 'https://example.com/share' } }); });
  await assert.rejects(graph.share('drive', 'id', ''), /Alege/); assert.equal(bodies.length, 0);
  assert.equal(await graph.share('drive', 'id', 'organization'), 'https://example.com/share');
  assert.deepEqual(bodies[0], { type: 'view', scope: 'organization' });
  await assert.rejects(graph.share('drive', 'id', 'anonymous'), /nu a confirmat/);
});
test('folder paging excludes files and shared shortcuts and keeps Graph tokens on Graph', async () => {
  let calls = 0;
  const graph = make(async () => ++calls === 1 ? json({ value: [{ id: 'a', name: 'A', folder: {} }, { id: 'file', name: 'File' }, { id: 'shortcut', name: 'External', folder: {}, remoteItem: {} }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' }) : json({ value: [{ id: 'b', name: 'B', folder: {} }] }));
  assert.deepEqual((await graph.folders('root')).map(item => item.id), ['a', 'b']);
  const hostile = make(async () => json({ value: [], '@odata.nextLink': 'https://attacker.invalid/' }));
  await assert.rejects(hostile.folders('root'), /Paginare/);
});
test('destination verification proves write and delete access before saving setup', async () => {
  const methods = [];
  const graph = make(async (url, options) => {
    methods.push(options.method);
    if (url.includes('/me/drive?')) return json({ id: 'drive', driveType: 'personal' });
    if (url.includes('/me/drive/items')) return json({ id: 'folder', name: 'Recordings', folder: {}, parentReference: { driveId: 'drive' } });
    if (options.method === 'PUT') return json({ id: 'probe' }, 201);
    if (options.method === 'DELETE') return json(null, 204);
    throw new Error(url);
  });
  assert.equal((await graph.verifyDestination(target)).name, 'Recordings'); assert.deepEqual(methods.sort(), ['DELETE', 'GET', 'GET', 'PUT']);
});
