const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('recorder', {
  state: invoke('state'), configure: invoke('configure'), login: invoke('login'), cancelLogin: invoke('cancel-login'), logout: invoke('logout'),
  folders: invoke('folders'), createFolder: invoke('create-folder'), setDestination: invoke('set-destination'), reconnectCheck: invoke('reconnect-check'),
  sources: invoke('sources'), selectSource: invoke('select-source'), start: invoke('record-start'),
  chunk: invoke('record-chunk'), finish: invoke('record-finish'), upload: invoke('upload'), share: invoke('share'),
  showFile: invoke('show-file'), onStateChanged: listen('state-changed'), onUploadProgress: listen('upload-progress'), onStop: listen('stop-recording')
});
