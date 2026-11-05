// Arayüze açılan küçük köprü: ekran kaynakları, pencere, kısayol ve güncelleme olayları.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dnative', {
  platform: process.platform,
  version: ipcRenderer.sendSync('d:version'),
  getSources: () => ipcRenderer.invoke('d:sources'),
  selectSource: (id, audio) => ipcRenderer.invoke('d:select-source', id, audio),
  flash: () => ipcRenderer.send('d:flash'),
  focus: () => ipcRenderer.send('d:focus'),
  setUnread: (n) => ipcRenderer.send('d:unread', n),
  onShortcut: (cb) => ipcRenderer.on('d:shortcut', (_e, name) => cb(name)),
  setShortcuts: (map) => ipcRenderer.invoke('d:shortcuts', map),
  // Güncelleme durumu: { state: idle|checking|downloading|ready|latest|error, version, percent, current }
  updateState: () => ipcRenderer.invoke('d:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('d:update-check'),
  installUpdate: () => ipcRenderer.send('d:update-install'),
  onUpdate: (cb) => ipcRenderer.on('d:update', (_e, state) => cb(state)),
});
