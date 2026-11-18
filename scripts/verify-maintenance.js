'use strict'

/*
 * Testet die Nachts-Wartung: Uhrzeitlogik, Einstellungen, Lauf-Sperre und
 * Ausfuehrung mit gemocktem Installer. Kein echter Build, keine Datenbank.
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
  store.init(path.join(os.tmpdir(), 'wowpanel-maintenance'))

  const maintenance = require('../electron/api/maintenance')
  const installer = require('../electron/api/installer')
  maintenance.init(store, fakeWin)

  const ereignisse = []
  fakeWin.on('maintenance:progress', p => ereignisse.push(p))

  section('1. Standardplan aus, geaenderte Einstellungen werden geklemmt')
  check(maintenance.plan().enabled === false, 'Standard: aus')
  maintenance.einstellungenSetzen({ enabled: false, stunde: -5, minute: 999 })
  check(maintenance.plan().stunde === 0, 'Stunde wird auf 0 geklemmt (-5)')
  check(maintenance.plan().minute === 59, 'Minute wird auf 59 geklemmt (999)')

  section('2. Aktivieren: Plan vorhanden, naechster Lauf liegt in der Zukunft')
  maintenance.einstellungenSetzen({ enabled: true, stunde: 3, minute: 0 })
  const p = maintenance.plan()
  check(p.enabled === true && p.stunde === 3 && p.minute === 0, 'Plan aktiv 03:00')

  const { naechsterLauf } = maintenance.__intern
  const jetzt = new Date()
  const next = new Date(naechsterLauf(3, 0))
  check(!isNaN(next.getTime()), 'naechsterLauf liefert ein Datum')
  check(next.getTime() > jetzt.getTime(), 'naechster Lauf liegt nach jetzt')
  // 03:00 - wenn wir vor 3 Uhr sind, heute; sonst morgen.
  const heutigesZiel = new Date(jetzt)
  heutigesZiel.setHours(3, 0, 0, 0)
  const erwartetHeute = jetzt.getTime() < heutigesZiel.getTime()
  const gleichesDatumHeute = next.getFullYear() === heutigesZiel.getFullYear() &&
    next.getMonth() === heutigesZiel.getMonth() &&
    next.getDate() === heutigesZiel.getDate()
  check(erwartetHeute ? gleichesDatumHeute : !gleichesDatumHeute, 'naechster Lauf: heute, wenn 03:00 noch kommt, sonst morgen')

  section('3. Ausfuehren mit gemocktem Installer')
  let updateAufrufe = 0
  installer.update = async () => {
    updateAufrufe++
    return { ok: true }
  }
  const r2 = await maintenance.ausfuehren()
  check(r2.ok === true, 'ausfuehren meldet Erfolg')
  check(updateAufrufe === 1, 'installer.update genau einmal aufgerufen')
  check(ereignisse.some(e => e.phase === 'fertig'), 'Ereignis "fertig" an das Fenster')

  section('4. Parallel-Sperre: laufender Aufruf wird uebersprungen')
  updateAufrufe = 0
  installer.update = async () => {
    await new Promise(r => setTimeout(r, 400))
    updateAufrufe++
    return { ok: true }
  }
  const parallel = maintenance.ausfuehren()
  const zweite = await maintenance.ausfuehren()
  check(zweite.uebersprungen === true, 'zweiter Aufruf waehrend des Laufs wird uebersprungen')
  await parallel
  check(updateAufrufe === 1, 'trotz zweitem Aufruf nur ein Update')

  section('5. Fehler werden als Ereignis gemeldet')
  installer.update = async () => { throw new Error('Bau fehlgeschlagen') }
  const r3 = await maintenance.ausfuehren()
  check(r3.ok === false && /Bau fehlgeschlagen/.test(r3.error), 'Fehler durchgereicht')
  check(ereignisse.some(e => e.phase === 'fehler'), 'Ereignis "fehler" an das Fenster')

  section('6. Deaktivieren raeumt den Plan auf')
  maintenance.einstellungenSetzen({ enabled: false, stunde: 3, minute: 0 })
  check(maintenance.plan().enabled === false, 'Plan wieder aus')

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})
