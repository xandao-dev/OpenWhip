const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  claudeReply: () => ipcRenderer.invoke('claude-reply'),
  onToggleWhip: (fn) => ipcRenderer.on('toggle-whip', (_e, x, y, ground) => fn(x, y, ground)),
});
