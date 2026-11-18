'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/*
 * Die einzige Branche zwischen Haupt- und Rendererprozess.
 *
 * Wichtig: Bei aktivem contextIsolation erzeugt webContents.send() im
 * Renderer KEIN window-Event - es kommt nur bei ipcRenderer an. Deshalb
 * werden hier die Kanäle ausdrücklich abonniert und über contextBridge
 * an React weitergereicht.
 */

const EVENTS = [
  'server:log',
  'server:status',
  'server:startAll',
  'config:changed',
  'backup:progress',
  'installer:progress',
  'maintenance:progress',
  'modules:progress',
  'notify:event'
]

contextBridge.exposeInMainWorld('api', {
  call: (route, payload) => ipcRenderer.invoke('api', route, payload),

  on: (channel, handler) => {
    if (!EVENTS.includes(channel)) {
      throw new Error(`Unbekannter Ereigniskanal: ${channel}`)
    }
    // Der erste Parameter (_event) darf nicht in den Renderer durchgereicht werden.
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on(channel, listener)
    // Rueckgabe zum Abbestellen
    return () => ipcRenderer.removeListener(channel, listener)
  }
})