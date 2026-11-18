'use strict'

/*
 * Testet den kompletten Weg einer Logzeile: server-manager -> IPC-Kanal.
 * Frueher hat der Renderer auf window.addEventListener gewartet, was bei
 * aktivem contextIsolation nie ausgeloest wird. Dieser Test faellt darum
 * zuverlaessig, wenn die Branche im preload fehlt.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const { EventEmitter } = require('events')

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

// --- Fenster-Simulation, wie sie main.js verwendet ---
const fakeWin = new EventEmitter()
fakeWin.isDestroyed = () => false
fakeWin.webContents = { send: (ch, p) => fakeWin.emit(ch, p) }

const BASE = path.join(os.tmpdir(), 'wowpanel-events')
fs.mkdirSync(path.join(BASE, 'bin'), { recursive: true })

const store = require('../electron/store')
store.init(path.join(BASE, 'cfg'))

// Als "mysqld" eine Kopie von node.exe - startet und beendet sich wieder
const exe = path.join(BASE, 'bin', 'stub.exe')
fs.copyFileSync(process.execPath, exe)

store.write({
  server: {
    worldExe: path.join(BASE, 'bin', 'world.exe'),
    authExe: path.join(BASE, 'bin', 'auth.exe'),
    worldConfDir: path.join(BASE, 'bin'),
    authConfDir: path.join(BASE, 'bin'),
    workDir: BASE,
    mysqlServer: { exe, dataDir: '', extraArgs: '' }
  }
})

const serverManager = require('../electron/server-manager')
serverManager.init(store, fakeWin)

section('1. Kanaele, die der preload freigibt')
const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8')
check(/exposeInMainWorld/.test(preloadSrc), 'contextBridge.exposeInMainWorld vorhanden')
check(/\bon\s*:\s*\(/.test(preloadSrc), 'Funktion "on" wird exportiert')
check(preloadSrc.includes('server:log'), '"server:log" im Kanal-Layer')
check(preloadSrc.includes('server:status'), '"server:status" im Kanal-Layer')
check(preloadSrc.includes('server:startAll'), '"server:startAll" im Kanal-Layer')
check(/ipcRenderer\.on\(channel/.test(preloadSrc), 'ipcRenderer.on wird abonniert')

section('2. Kein Listener mehr auf window im Renderer')
const files = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.jsx$/.test(e.name)) files.push(p)
  }
}
walk(path.join(__dirname, '..', 'src'))

const offenders = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  if (/window\.addEventListener\(\s*['"]server:/.test(src)) {
    offenders.push(path.basename(f))
  }
}
check(offenders.length === 0, `kein window.addEventListener('server:..') mehr ${offenders.length ? offenders.join(',') : ''}`)

const users = files.filter(f => /window\.api\.on\(/.test(fs.readFileSync(f, 'utf8')))
check(users.length >= 2, `window.api.on wird genutzt (${users.length} Dateien)`)

section('3. Logzeile erreicht den abonnierten Kanal')
const received = []
// So abonniert es der Renderer laut preload: handler(payload) ohne event-Objekt
fakeWin.on('server:log', payload => received.push(payload))

serverManager.start('db')
require('child_process')
setTimeout(() => {
  check(received.length > 0, `Logzeilen angekommen (${received.length})`)
  const start = received.find(r => r.kind === 'db' && /gestartet/.test(r.line || ''))
  check(!!start, 'Startmeldung vorhanden')
  if (start) {
    console.log('      ->', start.line)
    check(start.line.includes('PID'), 'Meldung enthaelt die PID')
  }
  check(
    received.every(r => typeof r.kind === 'string' && typeof r.line === 'string'),
    'jede Meldung hat kind und line'
  )
  check(
    received.every(r => !('_event' in r) && !('sender' in r)),
    'kein IPC-Event-Objekt durchgereicht'
  )

  serverManager.stop('db')
  setTimeout(() => {
    fs.rmSync(BASE, { recursive: true, force: true })
    console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
    process.exitCode = failures ? 1 : 0
  }, 1500)
}, 1200)