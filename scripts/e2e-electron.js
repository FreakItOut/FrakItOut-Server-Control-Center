'use strict'

/*
 * End-to-End unter Electron: nutzt exakt server-manager.js und start-all.js.
 * Aufruf:  .\node_modules\electron\dist\electron.exe scripts\e2e-electron.js
 */

const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const LOG = 'C:/Users/FreakItOut/AppData/Local/Temp/opencode/e2e-electron.log'
fs.writeFileSync(LOG, '')
const say = m => {
  fs.appendFileSync(LOG, m + '\n')
  console.log(m)
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const alive = name => {
  try {
    return require('child_process')
      .execSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, { encoding: 'utf8', windowsHide: true })
      .includes(name)
  } catch (_) {
    return false
  }
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const cfg = path.join(process.env.APPDATA || '', 'wowpanel')
  const store = require('../electron/store.js')
  store.init(cfg)

  const sm = require('../electron/server-manager.js')
  const startAll = require('../electron/api/start-all.js')
  const { EventEmitter } = require('events')

  const win = new EventEmitter()
  win.isDestroyed = () => false
  win.webContents = { send: (c, p) => {
    if (c === 'server:log') say(`[${p.kind}] ${p.line}`)
    if (c === 'server:startAll' && p.message) say(`[sequenz] ${p.message}`)
  } }

  sm.init(store, win)
  startAll.init(store, win)

  say('=== Umgebung ===')
  say(`Electron ${process.versions.electron}, stdout isTTY=${!!process.stdout.isTTY}`)

  say('\n=== Sequenz: DB -> 10s -> world -> 10s -> auth ===')
  try {
    await startAll.startAll({ delay: 10 })
  } catch (e) {
    say('SEQUENZ-FEHLER: ' + e.message)
  }

  say('\n=== warte 45s ===')
  await wait(45000)

  say('\n=== Ergebnis ===')
  const st = sm.status()
  say('Status: ' + JSON.stringify(st))
  say(`mysqld laeuft     : ${alive('mysqld.exe')}`)
  say(`worldserver laeuft: ${alive('worldserver.exe')}`)
  say(`authserver laeuft : ${alive('authserver.exe')}`)

  say('\n=== Beenden ===')
  await startAll.stopAll({ stopDb: true })
  await wait(12000)
  say(`worldserver danach: ${alive('worldserver.exe')}`)
  say(`authserver danach : ${alive('authserver.exe')}`)
  say(`mysqld danach     : ${alive('mysqld.exe')}`)

  app.quit()
})

app.on('window-all-closed', () => {})