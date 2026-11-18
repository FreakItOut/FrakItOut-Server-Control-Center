'use strict'

/*
 * Testet die Serverprofile: speichern, aktivieren, loeschen - mit
 * gemocktem Server-Manager, ohne echte Prozesse und ohne echte Server.
 */

const path = require('path')
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
  const base = path.join(os.tmpdir(), 'wowpanel-profiles')
  store.init(base)
  store.write({
    server: {
      rootDir: 'C:\\Server A',
      worldExe: 'C:\\Server A\\worldserver.exe',
      mysqlServer: { exe: 'C:\\Server A\\mysql\\bin\\mysqld.exe', port: 3306 }
    },
    mysql: { host: '127.0.0.1', port: 3306, user: 'a', password: 'pw-a' },
    soap: { user: 'SOAP', password: 'pw-a', port: 7878 }
  })

  const profile = require('../electron/api/profile')
  const serverManager = require('../electron/server-manager')

  // Server-Manager mocken: laeuft nie, Start zaehlt nur mit.
  let stopAufrufe = 0
  serverManager.status = () => ({ world: { running: true, pid: 111 }, auth: { running: false, pid: null }, db: { running: false, pid: null } })
  serverManager.stop = () => { stopAufrufe++; return { ok: true } }

  profile.init(store, fakeWin)

  section('1. Profil speichern: Liste und aktiv-Namen stimmen')
  await profile.speichern({ name: 'Server A' })
  let l = profile.liste()
  check(l.length === 1 && l[0].name === 'Server A', 'ein Profil "Server A" vorhanden')
  check(profile.aktiverName() === 'Server A', 'aktiv = "Server A"')
  check(l[0].daten.server.rootDir === 'C:\\Server A', 'Profil enthaelt die Serverwurzel')
  check(l[0].daten.soap.password === 'pw-a', 'Profil enthaelt den SOAP-Zugang')

  section('2. Gleicher Name ueberschreibt statt zu verdoppeln')
  await profile.speichern({ name: 'Server A' })
  check(profile.liste().length === 1, 'weiterhin nur ein Profil')

  section('3. Zweites Profil anlegen und umschalten')
  store.write({
    server: { rootDir: 'C:\\Server B', worldExe: 'C:\\Server B\\worldserver.exe' },
    mysql: { host: '127.0.0.1', port: 3307, user: 'b', password: 'pw-b' },
    soap: { user: 'SOAP', password: 'pw-b', port: 7878 }
  })
  await profile.speichern({ name: 'Server B' })
  check(profile.liste().length === 2, 'zwei Profile vorhanden')
  check(profile.aktiverName() === 'Server B', 'aktiv = "Server B"')

  await profile.aktivieren({ name: 'Server A' })
  const cfg = store.read()
  check(cfg.server.rootDir === 'C:\\Server A', 'Umschalten: rootDir von A aktiv')
  check(cfg.mysql.password === 'pw-a', 'Umschalten: MySQL-Zugang von A aktiv')
  check(cfg.soap.password === 'pw-a', 'Umschalten: SOAP von A aktiv')
  check(profile.aktiverName() === 'Server A', 'aktiv = "Server A"')
  check(stopAufrufe >= 1, 'laufender Worldserver wurde fuer den Wechsel beendet')
  // "Server B" bleibt als Profil erhalten
  check(profile.liste().some(p => p.name === 'Server B'), '"Server B" bleibt erhalten')

  section('4. Umschalten auf unbekanntes Profil bricht ab')
  let fehler = null
  try {
    await profile.aktivieren({ name: 'Nirgendwo' })
  } catch (e) {
    fehler = e
  }
  check(!!fehler, 'unbekanntes Profil wirft')
  check(cfg.server.rootDir === 'C:\\Server A', 'Konfiguration unveraendert nach dem Abbruch')

  section('5. Loeschen')
  await profile.loeschen({ name: 'Server B' })
  check(!profile.liste().some(p => p.name === 'Server B'), '"Server B" geloescht')
  check(profile.aktiverName() === 'Server A', 'aktiv bleibt "Server A"')

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})
