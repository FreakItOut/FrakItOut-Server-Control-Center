'use strict'

/*
 * Testet die Startsequenz-Logik: Reihenfolge, Zeitabstaende, Abbruch und
 * Fehlerbehandlung.
 *
 * Der Prozessstart wird gemockt, damit der Test deterministisch ist -
 * er prueft genau das, was neu ist: die Orchestrierung.
 * Der Prozessstart selbst wird am Ende separat mit echter .exe geprueft.
 *
 * Aufruf:  node scripts/verify-startall.js
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
const wait = ms => new Promise(r => setTimeout(r, ms))

const fakeWin = new EventEmitter()
fakeWin.isDestroyed = () => false
fakeWin.webContents = { send: (ch, p) => fakeWin.emit(ch, p) }

const BASE = path.join(os.tmpdir(), 'wowpanel-startall')

const store = require('../electron/store')
store.init(path.join(BASE, 'cfg'))
store.write({
  mysql: { host: '127.0.0.1', port: 3307 },
  server: {
    worldExe: 'C:\\x\\worldserver.exe',
    authExe: 'C:\\x\\authserver.exe',
    worldConfDir: 'C:\\x\\world',
    authConfDir: 'C:\\x\\auth',
    mysqlServer: {}
  }
})

const serverManager = require('../electron/server-manager')
const mysqlService = require('../electron/api/mysql-service')
const startAll = require('../electron/api/start-all')
serverManager.init(store, fakeWin)
startAll.init(store, fakeWin)

// ---- Prozessmanager mocken (Reihenfolge/Delays pruefen) ----
// Originalfunktionen sichern, damit Abschnitt 8 sie echt testen kann
const realStart = serverManager.start.bind(serverManager)
const realStop = serverManager.stop.bind(serverManager)

let started = []
let failOn = null
let statusMap = { db: false, auth: false, world: false }

serverManager.start = async kind => {
  started.push({ kind, at: Date.now() })
  if (kind === failOn) return { ok: false, error: `simulierter Fehler bei ${kind}` }
  statusMap[kind] = true
  return { ok: true, pid: 1000 + started.length }
}
serverManager.stop = async kind => {
  statusMap[kind] = false
  return { ok: true }
}
mysqlService.listServices = async () => []

function collect () {
  const ev = []
  fakeWin.on('server:startAll', p => ev.push(p))
  return ev
}

async function main () {
  section('1. Reihenfolge und Zeitabstaende (2 s statt 20)')
  started = []
  const t0 = Date.now()
  const ev = collect()
  await startAll.startAll({ delay: 2 })
  const dur = Date.now() - t0

  check(started.map(s => s.kind).join(' -> ') === 'db -> world -> auth',
    `Reihenfolge: ${started.map(s => s.kind).join(' -> ')}`)
  check(dur >= 4000, `2 x 2 s gewartet (${(dur / 1000).toFixed(1)} s)`)
  check(dur < 9000, `nicht zu lang (${(dur / 1000).toFixed(1)} s)`)

  const gaps = [
    started[1].at - started[0].at,
    started[2].at - started[1].at
  ]
  check(gaps.every(g => g >= 1900), `Abstaende je ~2 s: ${gaps.map(g => Math.round(g / 1000)).join('s, ')}s`)

  const msgs = ev.map(e => e.message).filter(Boolean)
  console.log('    Protokoll:')
  msgs.forEach(m => console.log('      ' + m))
  check(msgs.some(m => /^\+\d+s /.test(m)), 'Zeitstempel im Protokoll')

  section('2. Abschlussmeldung')
  const done = ev.find(e => e.step === 'done' && e.state === 'ok')
  check(!!done, 'Abschluss gemeldet')
  check(ev.some(e => e.step === 'state' && e.running === false), 'Status zurueck auf idle')
  check(!startAll.isRunning(), 'nicht mehr aktiv')

  section('3. Abbruch waehrend der Wartezeit nach der Datenbank')
  started = []
  const ev3 = collect()
  const p = startAll.startAll({ delay: 30 })
  await wait(1200)
  await startAll.stopAll({ stopDb: false })
  await p.catch(() => {})
  await wait(300)
  check(ev3.some(e => e.step === 'cancelled'), 'Abbruch gemeldet')
  check(started.length === 1 && started[0].kind === 'db', `nur Datenbank gestartet (${started.map(s => s.kind).join(',')})`)
  check(!startAll.isRunning(), 'Sequenz beendet')

  section('4. Abbruch waehrend der Wartezeit nach dem Worldserver')
  // Reihenfolge ist Datenbank -> Worldserver -> Authserver (so schreibt es
  // die Repack-Anleitung vor). Bei 2 s Abstand faengt DB bei 0 s an, der
  // Worldserver bei 2 s; nach 3 s ist der Authserver noch nicht dran.
  started = []
  const p4 = startAll.startAll({ delay: 2 })
  await wait(3000)
  await startAll.stopAll({ stopDb: false })
  await p4.catch(() => {})
  await wait(300)
  check(started.map(s => s.kind).join(',') === 'db,world', `Authserver noch nicht gestartet (${started.map(s => s.kind).join(',')})`)
  check(!statusMap.world, 'Worldserver nicht gestartet')
  statusMap.world = false

  section('5. Fehler beim Worldserver bricht sauber ab')
  started = []
  failOn = 'world'
  const ev5 = collect()
  let threw = false
  try {
    await startAll.startAll({ delay: 0 })
  } catch (_) {
    threw = true
  }
  failOn = null
  check(threw, 'Fehler weitergereicht')
  check(ev5.some(e => e.step === 'world' && e.state === 'fail'), 'Worldserver-Fehler gemeldet')
  check(ev5.some(e => e.step === 'error'), 'Abbruch der Sequenz gemeldet')
  check(ev5.some(e => e.step === 'state' && e.running === false), 'Status zurueck auf idle')

  section('6. Fehler bei der Datenbank stoppt die Sequenz sofort')
  started = []
  // Ein Dienst, der wirklich die konfigurierte mysqld.exe startet, gehoert
  // zum Panel. Schlägt sein Start fehl, muss der Fehler durchgereicht werden.
  store.write({ server: { mysqlServer: { exe: 'C:\\x\\mysql\\bin\\mysqld.exe' } } })
  const dienstPfad = '"C:\\x\\mysql\\bin\\mysqld.exe" --defaults-file=C:\\x\\my.ini'
  mysqlService.listServices = async () => [{
    name: 'PanelDB', displayName: 'PanelDB', status: 'Stopped', running: false, imagePath: dienstPfad
  }]
  mysqlService.serviceAction = async () => { throw new Error('Zugriff verweigert') }
  const ev6 = collect()
  let threw6 = false
  try {
    await startAll.startAll({ delay: 0 })
  } catch (_) {
    threw6 = true
  }
  check(threw6, 'Fehler geworfen')
  check(ev6.some(e => e.step === 'db' && e.state === 'fail'), 'DB-Fehler gemeldet')
  check(ev6.some(e => e.message && e.message.includes('Zugriff verweigert')), 'Originalmeldung sichtbar')
  check(started.length === 0, 'kein Authserver gestartet')

  // Ein FREMDER Dienst (andere mysqld) darf nicht benutzt werden: dort fehlen
  // die Datenbanken des Servers, und das Panel meldete "bereit", obwohl alle
  // Seiten danach mit Zugriffsfehlern brechen. Stattdessen mysqld direkt.
  started = []
  mysqlService.listServices = async () => [{
    name: 'MySQL80', displayName: 'MySQL80', status: 'Stopped', running: false,
    imagePath: '"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe" --defaults-file="C:\\ProgramData\\MySQL\\my.ini"'
  }]
  let fremdAngeworfen = false
  mysqlService.serviceAction = async () => { fremdAngeworfen = true; return { ok: true } }
  const ev6b = collect()
  await startAll.startAll({ delay: 0 })
  check(!fremdAngeworfen, 'fremder Dienst nicht angeschaltet')
  check(ev6b.some(e => e.step === 'db' && e.state === 'ok' && /direkt gestartet/.test(e.message)), 'stattdessen mysqld direkt gestartet')
  check(started.map(s => s.kind).join(',') === 'db,world,auth', 'Sequenz läuft normal weiter')
  mysqlService.listServices = async () => []
  mysqlService.serviceAction = async () => ({ ok: true })

  section('7. Doppelter Start wird abgelehnt')
  const p7 = startAll.startAll({ delay: 20 })
  let second = false
  try {
    await startAll.startAll({ delay: 20 })
  } catch (_) {
    second = true
  }
  check(second, 'zweiter Start abgelehnt')
  await startAll.stopAll({ stopDb: false })
  await p7.catch(() => {})
  await wait(300)

  // ---- Echter Prozessstart als Zusatzpruefung ----
  section('8. Echter Prozessstart (PID wird vergeben und registriert)')
  // hier die unverfälschte Originalfunktion verwenden
  serverManager.start = realStart
  serverManager.stop = realStop
  // Auf diesem Rechner koennen echte Serverprozesse laufen (worldserver.exe,
  // mysqld.exe). Die Uebernahme würde sie als "laeuft bereits" behandeln und
  // den Testfall verfaelschen - deshalb hier aus, danach wieder an.
  serverManager.setzeUebernahme(false)
  serverManager.setzePortPruefung(false)

  const dir = path.join(BASE, 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const exe = path.join(dir, 'stub.exe')
  fs.copyFileSync(process.execPath, exe) // node.exe dient als Platzhalter
  store.write({ server: { mysqlServer: { exe } } })

  const logLines = []
  fakeWin.removeAllListeners('server:log')
  fakeWin.on('server:log', p => logLines.push(p))

  const res = await serverManager.start('db')
  check(res.ok === true, 'Start meldet Erfolg')
  check(typeof res.pid === 'number' && res.pid > 0, `PID vergeben: ${res.pid}`)

  // Direkt nach dem Start pruefen: das exit-Event kann noch nicht gelaufen sein
  const stNow = serverManager.status().db
  check(stNow.pid === res.pid, `Status fuehrt dieselbe PID (${stNow.pid})`)
  check(
    logLines.some(l => l.kind === 'db' && l.line.includes(String(res.pid))),
    'Log meldet den Start mit PID'
  )

  const stopped = await serverManager.stop('db')
  check(stopped && stopped.ok === true, 'Stop meldet Erfolg')
  await wait(800)

  fs.rmSync(BASE, { recursive: true, force: true })
  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})