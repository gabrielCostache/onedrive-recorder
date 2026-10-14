const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('recorder', {
  state: invoke('state'), chooseFolder: invoke('choose-folder'), openFolder: invoke('open-folder'),
  sources: invoke('sources'), selectSource: invoke('select-source'), start: invoke('record-start'),
  chunk: invoke('record-chunk'), finish: invoke('record-finish'), showFile: invoke('show-file'), shareFile: invoke('share-file'),
  onStateChanged: listen('state-changed'), onStop: listen('stop-recording')
});
