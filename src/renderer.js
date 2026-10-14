const api = window.recorder;
const $ = id => document.getElementById(id);
let state, source, mediaRecorder, streams = [], activeId, saving = Promise.resolve(), writeError,
  startedAt = 0, pausedAt = 0, pausedMs = 0, timer, busyRecording = false;
let showSetup = false;

function message(text, error = false) {
  const modal = document.querySelector('dialog[open]');
  if (modal && error) {
    let alert = modal.querySelector('.inline-error');
    if (!alert) { alert = document.createElement('p'); alert.className = 'inline-error'; alert.setAttribute('role', 'alert'); modal.append(alert); }
    alert.textContent = text; alert.hidden = false; return;
  }
  $('status').textContent = text; $('status').classList.toggle('error', error); $('status').hidden = false;
  clearTimeout(message.timeout); message.timeout = setTimeout(() => $('status').hidden = true, error ? 14000 : 7000);
}
function fail(error) { message(error.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || String(error), true); }
function duration(seconds) { return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + Math.floor(seconds % 60).toString().padStart(2, '0'); }
function elapsed() { return (performance.now() - startedAt - pausedMs - (pausedAt ? performance.now() - pausedAt : 0)) / 1000; }
function button(text, action, className = 'secondary') {
  const element = document.createElement('button'); element.textContent = text; element.className = className;
  element.onclick = async () => { element.disabled = true; try { await action(); } catch (error) { fail(error); } finally { element.disabled = false; } };
  return element;
}
function render() {
  const setupVisible = (!state.ready || showSetup) && !busyRecording;
  $('onboarding').hidden = !setupVisible; $('workspace').hidden = setupVisible;
  $('setup-heading').textContent = state.ready ? 'Folderul tău OneDrive' : 'Alege folderul OneDrive sincronizat';
  $('setup-description').textContent = 'Alege folderul OneDrive disponibil pe acest calculator. Recorder salvează videoclipurile aici, iar aplicația OneDrive le sincronizează.';
  $('destination-name').textContent = state.destinationPath || 'Niciun folder selectat';
  $('setup-return').hidden = !state.ready;
  $('setup-open-folder').hidden = !state.ready;
  $('setup-error').hidden = !state.notice;
  if (state.notice) $('setup-error').textContent = state.notice;
  $('workspace-destination').textContent = state.ready ? 'Salvare directă în ' + state.destinationPath + '. Sincronizarea este gestionată de OneDrive.' : 'Alege un folder OneDrive sincronizat.';
  $('count').textContent = state.recordings.length;
  $('library-total').textContent = state.recordings.length + (state.recordings.length === 1 ? ' videoclip' : ' videoclipuri');
  $('recordings').replaceChildren();
  if (!state.recordings.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const title = document.createElement('strong'); title.textContent = 'Prima ta înregistrare începe aici.';
    empty.append(title, 'Alege un ecran, apasă Începe și spune ce ai de spus.'); $('recordings').append(empty);
  }
  for (const item of state.recordings) {
    const row = document.createElement('article'); row.className = 'recording-row';
    const play = button('▶', () => { $('preview-title').textContent = item.title; $('preview').src = 'recording://local/' + item.id; $('preview-dialog').showModal(); }, 'video-icon');
    play.setAttribute('aria-label', 'Previzualizează ' + item.title); play.disabled = item.status === 'recording' || item.status === 'interrupted';
    const info = document.createElement('div'); info.className = 'record-info';
    const title = document.createElement('strong'); title.textContent = item.title;
    const meta = document.createElement('p');
    const status = item.legacy ? 'Înregistrare veche · pe acest dispozitiv' : item.status === 'interrupted' ? 'Întreruptă — fișier parțial' : item.status === 'recording' ? 'Înregistrare în curs' : 'Salvată local în folderul OneDrive';
    meta.textContent = new Date(item.createdAt).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + duration(item.duration) + ' · ' + (item.bytes / 1048576).toFixed(1) + ' MB · ' + status;
    info.append(title, meta);
    const actions = document.createElement('div'); actions.className = 'row-actions';
    actions.append(button('Fișier ↗', () => api.showFile(item.id)));
    if (item.status === 'ready' && !item.legacy) actions.append(button('Partajează în OneDrive ↗', async () => { await api.shareFile(item.id); message('Fișierul este selectat în folderul OneDrive. Folosește Share / Partajare din meniul OneDrive pentru a crea și copia linkul.'); }));
    row.append(play, info, actions); $('recordings').append(row);
  }
  for (const id of ['settings-open', 'connect', 'choose-folder', 'setup-open-folder']) if ($(id)) $(id).disabled = busyRecording;
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
  const finishedId = activeId; const seconds = elapsed(); clearInterval(timer);
  streams.forEach(stream => stream.getTracks().forEach(track => track.stop())); streams = [];
  try {
    await saving; state = await api.finish(activeId, seconds, Boolean(writeError)); render();
    if (writeError) throw writeError;
    message('Videoclipul a fost salvat în folderul OneDrive. Sincronizarea poate dura până când OneDrive îl încarcă în cloud.');
  } catch (error) { fail(error); state = await api.state(); render(); }
  finally {
    activeId = undefined; mediaRecorder = undefined; busyRecording = false;
    $('stop').disabled = false; $('pause').disabled = false; $('pause').textContent = 'Pauză'; recordingUI(false);
  }
}
$('start').onclick = async () => {
  if (busyRecording) return;
  if (!source) return message('Selectează mai întâi ecranul sau fereastra.', true);
  if (!state.ready) return message('Alege mai întâi folderul OneDrive sincronizat.', true);
  busyRecording = true; recordingUI(false); saving = Promise.resolve(); writeError = null;
  try {
    await api.selectSource(source.id);
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
    streams.push(screen); const tracks = [...screen.getVideoTracks()];
    if ($('microphone').checked) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $('mic-device').value ? { exact: $('mic-device').value } : undefined, echoCancellation: true, noiseSuppression: true }, video: false });
      streams.push(mic); tracks.push(...mic.getAudioTracks()); refreshDevices().catch(() => {});
      mic.getAudioTracks().forEach(track => track.onended = () => { writeError = new Error('Microfonul s-a deconectat. Înregistrarea a fost oprită, iar fișierul parțial este păstrat.'); stop(); });
    }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('Înregistrarea WebM nu este disponibilă pe acest sistem.');
    mediaRecorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 4500000 });
    activeId = await api.start($('title').value || 'Înregistrare ' + new Date().toLocaleDateString('ro-RO'));
    mediaRecorder.ondataavailable = event => {
      if (!event.data.size) return;
      saving = saving.then(async () => {
        if (writeError) return;
        const buffer = new Uint8Array(await event.data.arrayBuffer());
        for (let offset = 0; offset < buffer.length; offset += 4 * 1024 * 1024) await api.chunk(activeId, buffer.slice(offset, offset + 4 * 1024 * 1024));
      }).catch(error => { writeError = error; fail(error); stop(); });
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
$('choose-folder').onclick = async () => {
  $('setup-error').hidden = true;
  try { state = await api.chooseFolder(); render(); if (state.ready) { showSetup = false; message('Folder setat. Recorder salvează videoclipurile aici; OneDrive le sincronizează în cloud.'); render(); } }
  catch (error) { $('setup-error').textContent = error.message; $('setup-error').hidden = false; }
};
$('setup-open-folder').onclick = async () => { try { await api.openFolder(); } catch (error) { fail(error); } };
$('settings-open').onclick = $('connect').onclick = () => { showSetup = true; render(); };
$('setup-return').onclick = () => { showSetup = false; render(); };
$('library-nav').onclick = () => $('library').scrollIntoView({ behavior: 'smooth' });
$('new-recording').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
document.querySelectorAll('[data-close]').forEach(element => element.onclick = () => $(element.dataset.close).close());
$('preview-dialog').addEventListener('close', () => { $('preview').pause(); $('preview').removeAttribute('src'); $('preview').load(); });
$('preview').addEventListener('error', () => { if ($('preview').hasAttribute('src')) message('Fișierul local nu poate fi redat. Verifică dacă există; o înregistrare întreruptă poate fi incompletă.', true); });
api.onStateChanged(value => { state = value; render(); });
api.onStop(stop);
window.addEventListener('beforeunload', event => { if (busyRecording) { event.preventDefault(); event.returnValue = ''; } });
async function refreshDevices() {
  const previous = $('mic-device').value; const devices = await navigator.mediaDevices.enumerateDevices();
  $('mic-device').replaceChildren(new Option('Microfonul implicit', ''));
  for (const device of devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')) $('mic-device').add(new Option(device.label || 'Microfon ' + $('mic-device').length, device.deviceId));
  if ([...$('mic-device').options].some(option => option.value === previous)) $('mic-device').value = previous;
}
navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
api.state().then(value => { state = value; render(); if (state.notice) message(state.notice, true); return refreshDevices(); }).catch(fail);
