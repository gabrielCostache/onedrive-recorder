const api = window.recorder;
const $ = id => document.getElementById(id);
let state, source, mediaRecorder, streams = [], activeId, saving = Promise.resolve(), writeError,
  startedAt = 0, pausedAt = 0, pausedMs = 0, timer, busyRecording = false, uploadId;
let showSetup = false, loginBusy = false, folderBusy = false, folderView, folderTrail = [], queuedBytes = 0, drainingUploads = false;
const uploadQueue = [];

function message(text, error = false) {
  const modal = document.querySelector('dialog[open]');
  if (modal && error) {
    let alert = modal.querySelector('.inline-error');
    if (!alert) { alert = document.createElement('p'); alert.className = 'inline-error'; alert.setAttribute('role', 'alert'); modal.append(alert); }
    alert.textContent = text; alert.hidden = false;
    return;
  }
  if (!$('onboarding').hidden && error) { $('setup-error').textContent = text; $('setup-error').hidden = false; }
  $('status').textContent = text; $('status').classList.toggle('error', error); $('status').hidden = false;
  clearTimeout(message.timeout); message.timeout = setTimeout(() => $('status').hidden = true, error ? 14000 : 6500);
}
function fail(error) { message(error.name === 'NotAllowedError' ? 'Accesul la ecran sau microfon a fost refuzat. Verifică permisiunile aplicației în setările sistemului.' : error.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || String(error), true); }
function duration(seconds) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
function elapsed() { return (performance.now() - startedAt - pausedMs - (pausedAt ? performance.now() - pausedAt : 0)) / 1000; }
function button(text, action, className = 'secondary') {
  const element = document.createElement('button'); element.textContent = text; element.className = className;
  element.onclick = async () => { element.disabled = true; try { await action(); } catch (error) { fail(error); } finally { element.disabled = false; } };
  return element;
}
function render() {
  const currentUpload = uploadId || state.uploadId;
  const setupVisible = (!state.ready || showSetup) && !busyRecording;
  $('onboarding').hidden = !setupVisible; $('workspace').hidden = setupVisible;
  $('setup-account').hidden = !state.account;
  $('setup-account-name').textContent = state.account;
  $('missing-config').hidden = state.configured;
  $('setup-login').hidden = Boolean(state.account) || loginBusy;
  $('setup-login').disabled = !state.configured || loginBusy || state.restoring;
  $('setup-login').textContent = state.restoring ? 'Restaurăm sesiunea…' : 'Conectează OneDrive ↗';
  $('login-wait').hidden = !loginBusy;
  $('setup-folder').hidden = !state.account || loginBusy;
  $('setup-heading').textContent = state.account ? 'O casă pentru videoclipurile tale.' : 'Unde vrei să te conectezi?';
  $('setup-description').textContent = state.account ? 'Alege folderul în care trimitem automat înregistrările.' : 'Conectează contul Microsoft în care vrei să păstrezi înregistrările.';
  $('destination-name').textContent = state.destination?.name || 'Niciun folder selectat';
  $('verify-saved').hidden = !state.destination || state.ready;
  $('setup-return').hidden = !state.ready;
  $('developer-settings').hidden = state.configured || !state.canConfigure;
  $('step-account').classList.toggle('complete', Boolean(state.account));
  $('step-folder').classList.toggle('complete', Boolean(state.destination));
  $('step-ready').classList.toggle('complete', state.ready);
  $('session-note').textContent = state.persistentSession ? 'Conectarea este reținută în siguranță pe acest dispozitiv.' : 'Pe acest dispozitiv va fi necesară reconectarea după închiderea aplicației.';
  $('workspace-destination').textContent = `Salvare automată în OneDrive / ${state.destination?.name || ''}`;
  $('account-label').textContent = state.account || 'Conectează OneDrive';
  $('connect').classList.toggle('connected', Boolean(state.account));
  $('count').textContent = state.recordings.length;
  $('library-total').textContent = `${state.recordings.length} ${state.recordings.length === 1 ? 'videoclip' : 'videoclipuri'}`;
  $('recordings').replaceChildren();
  if (!state.recordings.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const title = document.createElement('strong'); title.textContent = 'Prima ta înregistrare începe aici.';
    empty.append(title, 'Alege un ecran, apasă Începe și spune ce ai de spus.'); $('recordings').append(empty);
  }
  for (const item of state.recordings) {
    const row = document.createElement('article'); row.className = 'recording-row';
    const play = button('▶', () => {
      $('preview-title').textContent = item.title; $('preview').src = `recording://local/${item.id}`; $('preview-dialog').showModal();
    }, 'video-icon'); play.setAttribute('aria-label', `Previzualizează ${item.title}`); play.disabled = item.status === 'recording';
    const info = document.createElement('div'); info.className = 'record-info';
    const title = document.createElement('strong'); title.textContent = item.title;
    const meta = document.createElement('p'); meta.textContent = `${new Date(item.createdAt).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })} · ${duration(item.duration)} · ${(item.bytes / 1048576).toFixed(1)} MB · ${item.status === 'interrupted' ? 'Întreruptă — fișier parțial' : item.remoteId ? 'În OneDrive' : item.uploadError ? 'Upload de reluat' : 'Pe acest dispozitiv'}`;
    info.append(title, meta);
    const actions = document.createElement('div'); actions.className = 'row-actions';
    actions.append(button('Fișier ↗', () => api.showFile(item.id)));
    if (item.remoteId) {
      const scope = document.createElement('select'); scope.setAttribute('aria-label', 'Cine poate accesa linkul');
      const audiences = item.destination?.driveType === 'personal' ? [['anonymous', 'Oricine are linkul']] : [['organization', 'Doar organizația'], ['anonymous', 'Oricine are linkul']];
      const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = 'Acces la videoclip…'; scope.append(prompt);
      for (const [value, label] of audiences) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; scope.append(option);
      }
      // The user explicitly chooses the audience before creating a sharing link.
      const share = button('Creează și copiază link', async () => {
        if (!scope.value) throw new Error('Alege cine poate accesa linkul.');
        await api.share(item.id, scope.value); message('Link creat și copiat.');
      }); share.disabled = !state.account;
      actions.append(scope, share);
    } else {
      const upload = button(currentUpload === item.id ? 'Se încarcă…' : item.uploadError ? 'Reîncearcă ↑' : 'Încarcă în OneDrive ↑', () => enqueueUpload(item.id));
      upload.disabled = !state.ready || Boolean(currentUpload) || item.status !== 'ready';
      actions.append(upload);
      if (currentUpload === item.id) { const progress = document.createElement('progress'); progress.max = 100; progress.id = `progress-${item.id}`; progress.setAttribute('aria-label', 'Progres upload'); actions.append(progress); }
    }
    row.append(play, info, actions); $('recordings').append(row);
  }
  for (const id of ['settings-open', 'connect', 'switch-account', 'choose-folder', 'verify-saved']) $(id).disabled = busyRecording || Boolean(currentUpload) || loginBusy || state.restoring;
}

async function enqueueUpload(id) {
  if (!uploadQueue.includes(id) && uploadId !== id) uploadQueue.push(id);
  if (drainingUploads || state.uploading || !state.ready) return;
  drainingUploads = true;
  try {
    while (uploadQueue.length && state.ready) {
      uploadId = uploadQueue.shift(); render();
      try { await api.upload(uploadId); message('Videoclip încărcat. Alege accesul și copiază linkul pentru a-l trimite.'); }
      catch (error) { fail(error); }
      finally { state = await api.state(); uploadId = undefined; render(); }
    }
  } finally { drainingUploads = false; uploadId = undefined; }
}

async function refreshDevices() {
  const previous = $('mic-device').value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  $('mic-device').replaceChildren(new Option('Microfonul implicit', ''));
  for (const device of devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')) $('mic-device').add(new Option(device.label || `Microfon ${$('mic-device').length}`, device.deviceId));
  if ([...$('mic-device').options].some(option => option.value === previous)) $('mic-device').value = previous;
}
function recordingUI(isRecording) {
  $('start').hidden = isRecording; $('stop').hidden = !isRecording; $('pause').hidden = !isRecording;
  for (const id of ['choose-source', 'title', 'microphone', 'mic-device', 'start']) $(id).disabled = busyRecording || !state.ready;
  render();
}
function stop() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    $('stop').disabled = true; $('pause').disabled = true; mediaRecorder.stop();
  }
}
async function finish() {
  const finishedId = activeId;
  const seconds = elapsed(); clearInterval(timer);
  streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); streams = [];
  try {
    await saving; state = await api.finish(activeId, seconds, Boolean(writeError)); render();
    if (writeError) throw writeError;
    message('Înregistrarea a fost salvată. Se pregătește uploadul în OneDrive.');
  } catch (error) { fail(error); state = await api.state(); render(); }
  finally {
    activeId = undefined; mediaRecorder = undefined; busyRecording = false;
    $('stop').disabled = false; $('pause').disabled = false; $('pause').textContent = 'Pauză'; recordingUI(false);
    if (state.recordings.find(item => item.id === finishedId)?.status === 'ready' && !writeError) enqueueUpload(finishedId).catch(fail);
  }
}
$('start').onclick = async () => {
  if (busyRecording) return;
  if (!source) return message('Selectează mai întâi ecranul sau fereastra.', true);
  if (!state.ready) return message('Finalizează mai întâi conectarea la OneDrive.', true);
  busyRecording = true; recordingUI(false); saving = Promise.resolve(); writeError = null; queuedBytes = 0;
  try {
    await api.selectSource(source.id);
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
    streams.push(screen);
    const tracks = [...screen.getVideoTracks()];
    if ($('microphone').checked) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $('mic-device').value ? { exact: $('mic-device').value } : undefined, echoCancellation: true, noiseSuppression: true }, video: false });
      streams.push(mic); tracks.push(...mic.getAudioTracks()); refreshDevices().catch(() => {});
      mic.getAudioTracks().forEach(track => track.onended = () => { writeError = new Error('Microfonul s-a deconectat. Înregistrarea a fost oprită și copia locală este păstrată.'); stop(); });
    }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('Înregistrarea WebM nu este disponibilă pe acest sistem.');
    mediaRecorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 4500000 });
    activeId = await api.start($('title').value || `Înregistrare ${new Date().toLocaleDateString('ro-RO')}`);
    mediaRecorder.ondataavailable = event => {
      if (!event.data.size) return;
      queuedBytes += event.data.size;
      if (queuedBytes > 64 * 1024 * 1024) { writeError = new Error('Discul nu ține pasul cu înregistrarea. Copia parțială a fost păstrată.'); stop(); }
      saving = saving.then(async () => {
        if (writeError) return;
        const buffer = new Uint8Array(await event.data.arrayBuffer());
        // Bound every IPC payload even if Chromium emits a large final chunk.
        for (let offset = 0; offset < buffer.length; offset += 4 * 1024 * 1024) await api.chunk(activeId, buffer.slice(offset, offset + 4 * 1024 * 1024));
      }).catch(error => { writeError = error; fail(error); stop(); }).finally(() => { queuedBytes -= event.data.size; });
    };
    mediaRecorder.onstop = finish;
    mediaRecorder.onerror = event => { writeError = event.error || new Error('Captura a eșuat.'); stop(); };
    screen.getVideoTracks()[0].onended = stop;
    startedAt = performance.now(); pausedAt = 0; pausedMs = 0;
    mediaRecorder.start(2000); recordingUI(true); $('timer').textContent = '00:00';
    timer = setInterval(() => $('timer').textContent = duration(elapsed()), 500);
    message('Înregistrare pornită. Poți trece în fereastra pe care vrei să o prezinți.');
  } catch (error) {
    streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); streams = [];
    if (activeId) { try { state = await api.finish(activeId, 0, true); render(); } catch {} }
    activeId = undefined; busyRecording = false; mediaRecorder = undefined; recordingUI(false); fail(error);
  }
};
$('stop').onclick = stop;
$('pause').onclick = () => {
  if (mediaRecorder?.state === 'recording') { mediaRecorder.pause(); pausedAt = performance.now(); $('pause').textContent = 'Continuă'; }
  else if (mediaRecorder?.state === 'paused') { pausedMs += performance.now() - pausedAt; pausedAt = 0; mediaRecorder.resume(); $('pause').textContent = 'Pauză'; }
};
$('choose-source').onclick = async () => {
  $('choose-source').disabled = true;
  try {
    const sources = await api.sources(); $('sources').replaceChildren();
    if (!sources.length) throw new Error('Nu am găsit surse. Verifică permisiunea Screen Recording și repornește aplicația.');
    for (const item of sources) {
      const choice = button('', () => { source = item; $('source-label').textContent = item.name; $('source-dialog').close(); }, 'source');
      const thumbnail = document.createElement('img'); thumbnail.src = item.thumbnail; thumbnail.alt = '';
      const label = document.createElement('span'); label.textContent = item.name; choice.append(thumbnail, label); $('sources').append(choice);
    }
    $('source-dialog').showModal();
  } catch (error) { fail(error); } finally { $('choose-source').disabled = false; }
};
$('settings-open').onclick = $('connect').onclick = () => { showSetup = true; $('setup-error').hidden = true; render(); };
$('developer-settings').onclick = () => { $('settings').querySelectorAll('.inline-error').forEach(element => element.hidden = true); $('settings').showModal(); };
$('setup-return').onclick = () => { showSetup = false; render(); };
$('setup-login').onclick = async () => {
  if (loginBusy) return;
  loginBusy = true; $('setup-error').hidden = true; render();
  try { await api.login(); message('Cont conectat. Alege folderul pentru înregistrări.'); }
  catch (error) { fail(error); }
  finally { state = await api.state(); loginBusy = false; render(); }
};
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  try { state = await api.configure($('client-id').value.trim()); render(); $('settings').close(); $('setup-error').hidden = true; message('Conectarea Microsoft este configurată.'); } catch (error) { fail(error); }
};
$('switch-account').onclick = async () => { try { state = await api.logout(); uploadQueue.length = 0; source = undefined; $('source-label').textContent = 'Alege ce vrei să arăți'; render(); } catch (error) { fail(error); } };
$('cancel-auth').onclick = async () => { try { await api.cancelLogin(); } catch (error) { fail(error); } };
function folderControls(disabled) {
  folderBusy = disabled;
  $('confirm-folder').disabled = disabled || !folderView;
  $('folder-up').disabled = disabled || folderTrail.length < 2;
  $('new-folder-form').querySelector('button').disabled = disabled;
  $('folder-dialog').querySelector('[data-close]').disabled = disabled;
  $('folder-list').querySelectorAll('button').forEach(element => element.disabled = disabled);
}
async function loadFolder(id, trail = []) {
  folderControls(true); $('folder-error').hidden = true; $('status').hidden = true;
  try {
    const result = await api.folders(id);
    folderView = result; folderTrail = [...trail, result.folder];
    $('folder-path').textContent = folderTrail.map((item, index) => index ? item.name : 'OneDrive').join(' / ');
    $('folder-list').replaceChildren();
    for (const folder of result.folders) $('folder-list').append(button(`▤  ${folder.name}  ›`, () => loadFolder(folder.id, folderTrail), 'folder-option'));
    if (!result.folders.length) { const empty = document.createElement('p'); empty.textContent = 'Acest folder nu conține alte foldere.'; $('folder-list').append(empty); }
  } catch (error) { fail(error); }
  finally { folderControls(false); }
}
$('choose-folder').onclick = async () => {
  folderView = undefined; folderTrail = []; $('folder-dialog').showModal(); $('folder-list').textContent = 'Se încarcă folderele…'; await loadFolder();
};
$('folder-up').onclick = () => { if (!folderBusy && folderTrail.length > 1) loadFolder(folderTrail.at(-2).id, folderTrail.slice(0, -2)); };
$('new-folder-form').onsubmit = async event => {
  event.preventDefault(); if (folderBusy || !folderView) return; folderControls(true);
  try { const folder = await api.createFolder(folderView.folder.id, $('new-folder-name').value.trim()); $('new-folder-name').value = ''; await loadFolder(folder.id, folderTrail); }
  catch (error) { fail(error); } finally { folderControls(false); }
};
$('confirm-folder').onclick = async () => {
  if (folderBusy || !folderView) return; folderControls(true); $('confirm-folder').textContent = 'Verificăm conexiunea…';
  try { await api.setDestination(folderView.folder.id); state = await api.state(); showSetup = false; $('folder-dialog').close(); render(); message('OneDrive este configurat. Poți începe prima înregistrare.'); }
  catch (error) { fail(error); }
  finally { folderControls(false); $('confirm-folder').textContent = 'Folosește acest folder'; }
};
$('verify-saved').onclick = async () => {
  $('verify-saved').disabled = true; $('setup-error').hidden = true;
  try { await api.reconnectCheck(); state = await api.state(); showSetup = false; render(); }
  catch (error) { fail(error); } finally { $('verify-saved').disabled = false; }
};
$('library-nav').onclick = () => $('library').scrollIntoView({ behavior: 'smooth' });
$('new-recording').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
document.querySelectorAll('[data-close]').forEach(element => element.onclick = () => $(element.dataset.close).close());
$('preview-dialog').addEventListener('close', () => { $('preview').pause(); $('preview').removeAttribute('src'); $('preview').load(); });
$('preview').addEventListener('error', () => { if ($('preview').hasAttribute('src')) message('Fișierul local nu poate fi redat. Verifică dacă există; o înregistrare întreruptă poate fi incompletă.', true); });
$('folder-dialog').addEventListener('cancel', event => { if (folderBusy) event.preventDefault(); });
api.onStateChanged(value => {
  state = value; render(); if (state.notice) message(state.notice, true);
  if (state.ready && !state.uploading && uploadQueue.length && !drainingUploads) enqueueUpload(uploadQueue[0]).catch(fail);
});
api.onUploadProgress(({ id, percent }) => { const progress = $(`progress-${id}`); if (progress) progress.value = percent; });
api.onStop(stop);
window.addEventListener('beforeunload', event => { if (busyRecording) { event.preventDefault(); event.returnValue = ''; } });
navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
api.state().then(value => { state = value; render(); if (state.notice) message(state.notice, true); return refreshDevices(); }).catch(fail);
