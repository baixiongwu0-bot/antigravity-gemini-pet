'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  setBounds: (bounds) => ipcRenderer.send('pet:set-bounds', bounds),
  setInputBusy: (busy) => ipcRenderer.send('pet:input-busy', Boolean(busy)),
  setInputState: (state) => ipcRenderer.send('pet:input-state', state),
  focusWindow: () => ipcRenderer.send('pet:focus-window'),
  sendFlightUpdate: (state) => ipcRenderer.send('pet:flight-update', state),
  getCursorPoint: () => ipcRenderer.invoke('pet:cursor-point'),
  serverPost: (pathname, body) => ipcRenderer.invoke('pet:server-post', pathname, body),
  onFlightStates: (cb) => {
    const fn = (_e, states) => cb(states);
    ipcRenderer.on('pet:flight-states', fn);
    return () => ipcRenderer.removeListener('pet:flight-states', fn);
  },
  onPointerLeft: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('pet:pointer-left', fn);
    return () => ipcRenderer.removeListener('pet:pointer-left', fn);
  },
  onDisplays: (cb) => {
    const fn = (_e, displays) => cb(displays);
    ipcRenderer.on('pet:displays', fn);
    return () => ipcRenderer.removeListener('pet:displays', fn);
  },
  onCursorProximity: (cb) => {
    const fn = (_e, info) => cb(info);
    ipcRenderer.on('pet:cursor-proximity', fn);
    return () => ipcRenderer.removeListener('pet:cursor-proximity', fn);
  },
  onActiveWindow: (cb) => {
    const fn = (_e, winRect) => cb(winRect);
    ipcRenderer.on('pet:active-window', fn);
    return () => ipcRenderer.removeListener('pet:active-window', fn);
  },
});
