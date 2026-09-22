'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buyerLogWorkspace', {
  snapshot: () => ipcRenderer.invoke('buyerlog:workspace-snapshot'),
  showModuleMenu: () => ipcRenderer.invoke('buyerlog:workspace-show-module-menu'),
  activateTab: tabId => ipcRenderer.invoke('buyerlog:workspace-activate', String(tabId || '')),
  openModule: moduleId => ipcRenderer.invoke('buyerlog:workspace-open-module', String(moduleId || '')),
  moveTab: (tabId, index) => ipcRenderer.invoke('buyerlog:workspace-move-tab', { tabId:String(tabId || ''), index:Number(index) }),
  receiveTab: (tabId, index) => ipcRenderer.invoke('buyerlog:workspace-receive-tab', { tabId:String(tabId || ''), index:Number(index) }),
  detachTab: (tabId, sourceWindowId, point) => ipcRenderer.invoke('buyerlog:workspace-detach-tab', { tabId:String(tabId || ''), sourceWindowId:Number(sourceWindowId), point:{ x:Number(point && point.x), y:Number(point && point.y) } }),
  closeTab: tabId => ipcRenderer.invoke('buyerlog:workspace-close-tab', String(tabId || '')),
  onState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('buyerlog:workspace-state', listener);
    return () => ipcRenderer.removeListener('buyerlog:workspace-state', listener);
  },
});
