'use strict'

/*
 * Regressionstest: Beenden und danach erneut Starten muss wieder gehen.
 * Vorher blieb procs[kind].running nach stop() auf true stehen, wodurch
 * jeder weitere Start mit "laeuft bereits" abgelehnt wurde und die
 * Konsole aus blieb.
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

const BASE = path.join(os.tmpdir(), 'wowpanel-restart')
fs.rmSync(BASE, { recursive: true, force: true })
const bin = path.join(BASE, 'bin')
fs.mkdirSync(bin, { recursive: true })

// node.exe als Platzhalter fuer den Worldserver
const worldExe = path.join(bin, 'worldserver.exe')
fs.copyFileSync(process.execPath, worldExe)

const fakeWin = new EventEmitter()
fakeWin.isDestroyed = () => false
fakeWin.webContents = { send: (ch, p) => fakeWin.emit(ch, p) }

const store = require('../electron/store')
store.init(path.join(BASE, 'cfg'))
store.write({
  server: {
    worldExe,
    authExe: path.join(bin, 'authserver.exe'),
    worldConfDir: bin,
    authConfDir: bin,
    workDir: BASE,
    mysqlServer: {}
  }
})

const sm = require('../electron/server-manager')
sm.init(store, fakeWin)

const logs = []
fakeWin.on('server:log', p => logs.push(p))

const running = () =>
  require('child_process')
    .execSync('tasklist /FI "IMAGENAME eq worldserver.exe" /NH', { encoding: 'utf8', windowsHide: true })
    .includes('worldserver.exe')

async function main () {
  section('1. Erster Start')
  let r = await sm.start('world')
  check(r.ok === true, `Start erfolgreich (${r.ok})`)
  await wait(1500)
  check(sm.status().world.running === true, 'Status: laeuft')
  check(running(), 'Prozess wirklich gestartet')

  section('2. Beenden')
  r = sm.stop('world')
  check(r.ok === true, 'Stop erfolgreich')
  await wait(3000)

  const st1 = sm.status().world
  check(st1.running === false, `Status nach Stop zurueckgesetzt (running=${st1.running})`)
  check(st1.pid === null, `PID zurueckgesetzt (pid=${st1.pid})`)

  section('3. Erneuter Start muss wieder klappen')
  r = await sm.start('world')
  check(r.ok === true, `zweiter Start erfolgreich${r.ok ? '' : ' -> ' + r.error}`)
  await wait(1500)
  check(sm.status().world.running === true, 'Status: laeuft wieder')

  section('4. Beenden und dreiter Start')
  sm.stop('world')
  await wait(3000)
  r = await sm.start('world')
  check(r.ok === true, `dritter Start erfolgreich${r.ok ? '' : ' -> ' + r.error}`)
  await wait(1500)

  section('5. Tail wurde wieder eingerichtet')
  check(
    logs.some(l => l.kind === 'world' && /Ausgabe wird aus|eigenes Konsolenfenster/.test(l.line)),
    'Startmeldung mit Konsolenfenster vorhanden'
  )
  const starts = logs.filter(l => l.kind === 'world' && /gestartet \(PID/.test(l.line))
  check(starts.length === 3, `drei Startmeldungen (${starts.length})`)

  section('6. Doppelter Start wird weiterhin abgelehnt')
  const again = await sm.start('world')
  check(again.ok === false, 'zweiter Start ohne Stop wird abgelehnt')

  section('7. Beenden ohne laufenden Prozess meldet Fehler')
  sm.stop('world')
  await wait(3000)
  const stopAgain = sm.stop('world')
  check(stopAgain.ok === false, 'Stop ohne Prozess meldet Fehler statt Absturz')

  try {
    require('child_process').execSync('taskkill /F /IM worldserver.exe', { windowsHide: true })
  } catch (_) {}
  fs.rmSync(BASE, { recursive: true, force: true })

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('ABBRUCH:', e)
  process.exitCode = 1
})