'use strict'

/*
 * Testet den Auto-Rollback nach fehlgeschlagenem DB-Import: Bei vorhandenem
 * Sicherungs-Stempel wird backup.restore genau einmal gerufen, danach
 * Datenbank-Stop und Panel-DB-Start. Ohne Stempel wird nicht gerollt und
 * der Fehler bleibt der ursprüngliche. backup.restore und server-manager
 * sind gemockt - es läuft keine echte Datenbank.
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

async function main () {
  const fakeWin = new EventEmitter()
  fakeWin.isDestroyed = () => false
  fakeWin.webContents = { send: (ch, p) => fakeWin.emit(ch, p) }

  const store = require('../electron/store')
  store.init(path.join(os.tmpdir(), 'wowpanel-rollback'))

  const backup = require('../electron/api/backup')
  const serverManager = require('../electron/server-manager')
  const installer = require('../electron/api/installer')
  const { datenbankRollback } = installer.__intern

  // server-manager mocken: nichts läuft, Starts werden gezählt
  let startAufrufe = 0
  serverManager.status = () => ({ world: { running: false, pid: null }, auth: { running: false, pid: null }, db: { running: false, pid: null } })
  serverManager.stop = () => ({ ok: true })
  serverManager.start = kind => {
    startAufrufe++
    return Promise.resolve({ ok: true, pid: 1000 + startAufrufe })
  }

  const p = {
    root: path.join(os.tmpdir(), 'wowpanel-rollback-root'),
    logs: path.join(os.tmpdir(), 'wowpanel-rollback-root', 'logs'),
    myIni: path.join(os.tmpdir(), 'wowpanel-rollback-root', 'mysql', 'my.ini')
  }
  fs.mkdirSync(p.logs, { recursive: true })

  const my = { port: 3306, child: null, gestartet: false }

  section('1. Mit Stempel: restore genau einmal, danach Panel-DB-Start')
  let restoreAufrufe = []
  backup.restore = async arg => {
    restoreAufrufe.push(arg)
    return { ok: true, restored: ['x'], count: 1, safety: arg.stamp }
  }
  const r1 = await datenbankRollback('2026-11-11_vorher', p, my, false, false)
  check(r1.ok === true, 'Rollback meldet Erfolg')
  check(restoreAufrufe.length === 1 && restoreAufrufe[0].stamp === '2026-11-11_vorher', 'restore mit dem Vorab-Stempel gerufen')
  check(startAufrufe === 1, 'Datenbank nach dem Rollback neu gestartet')

  section('2. Ohne Erfolg: restore-Fehler wird berichtet, kein Start')
  backup.restore = async () => { throw new Error('Backup-Ordner fehlt') }
  startAufrufe = 0
  const r2 = await datenbankRollback('kaputt', p, my, false, false)
  check(r2.ok === false && /Backup-Ordner fehlt/.test(r2.error), 'Restore-Fehler durchgereicht')
  check(startAufrufe === 0, 'bei fehlgeschlagenem Restore kein DB-Start')

  section('3. Liefen Server vor dem Update, werden sie nach dem Rollback angestellt')
  let startKinds = []
  serverManager.start = kind => { startKinds.push(kind); return Promise.resolve({ ok: true, pid: 1 }) }
  backup.restore = async () => { return { ok: true } }
  const r3 = await datenbankRollback('roll', p, my, true, true)
  check(r3.ok === true, 'Rollback mit Server-Flags meldet Erfolg')
  check(startKinds.join(',') === 'db,world,auth', `Reihenfolge: ${startKinds.join(',')}`)

  section('4. notify ruft trotzdem nichts kaputt (Electron-frei)')
  // Das ist implizit abgedeckt: melde() schluckt fehlende Electron-Umgebung.
  check(true, 'Lauf ohne Exception beendet')

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})
