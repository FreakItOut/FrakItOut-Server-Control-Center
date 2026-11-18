'use strict'

/*
 * Testet die Modul-Verwaltung gegen die echten Dateien der Repack.
 *
 * Aufruf: node scripts/verify-module.js
 *
 * Geschrieben wird nur in eine Kopie im Temp-Ordner - die echten
 * Modul-Configs des Nutzers bleiben unberuehrt. Sonst waere ein Test
 * ein Aenderungswerkzeug.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const REPACK = 'C:\\Azerothcore WoTLK Repack (Playerbots + Individual Progression)'
const MODULE_QUELLE = path.join(REPACK, 'configs', 'modules')

let gut = 0
let schlecht = 0
function pruefe (c, l) {
  if (c) { gut++; console.log('  OK   ' + l) } else { schlecht++; console.log('  FAIL ' + l) }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'module-'))
const configOrdner = path.join(temp, 'cfg')
fs.mkdirSync(configOrdner, { recursive: true })

// Die Konfiguration zeigt auf die echte Repack - gelesen wird von dort
fs.writeFileSync(path.join(configOrdner, 'config.json'), JSON.stringify({
  server: {
    worldExe: path.join(REPACK, 'worldserver.exe'),
    worldConfDir: path.join(REPACK, 'configs')
  }
}, null, 2), 'utf8')

const store = require('../electron/store')
store.init(configOrdner)

const moduleApi = require('../electron/api/module')

async function main () {
  console.log('=== 1. Module finden ===')
  const l = moduleApi.list()
  console.log(`  Ordner: ${l.ordner}`)
  console.log(`  Module: ${l.module.length}`)
  pruefe(!!l.ordner, 'Modul-Ordner gefunden')
  pruefe(l.module.length > 50, `mehr als 50 Modul-Configs gefunden (${l.module.length})`)

  const mitSicherung = l.module.filter(m => m.hatSicherung)
  console.log(`  davon mit Sicherung: ${mitSicherung.length}`)

  console.log('')
  console.log('=== 2. Einstellungen lesen ===')
  const ip = l.module.find(m => m.datei === 'individualProgression.conf')
  if (!ip) {
    pruefe(false, 'individualProgression.conf gefunden')
  } else {
    const r = moduleApi.read({ pfad: ip.pfad })
    console.log(`  ${r.datei}: ${r.gesamt} Schluessel, ${r.mitBeschreibung} mit Beschreibung`)
    pruefe(r.gesamt > 50, `individualProgression.conf hat Schluessel (${r.gesamt})`)
    pruefe(r.mitBeschreibung > 10, `davon sind ${r.mitBeschreibung} beschrieben`)

    console.log('  Beispiele:')
    r.eintraege.slice(0, 4).forEach(e => {
      console.log(`    ${e.key} = ${e.value}`)
      console.log(`        [${e.quelle || '-'}] ${e.help || '(keine Beschreibung)'}`)
    })
    pruefe(r.eintraege.every(e => typeof e.key === 'string' && e.key.length > 0),
      'jeder Eintrag hat einen Schluessel')
    pruefe(r.eintraege.some(e => e.quelle === 'description'),
      'mindestens eine Description aus der Datei gelesen')
  }

  console.log('')
  console.log('=== 3. Die groessten Dateien sind lesbar ===')
  const gross = l.module.slice().sort((a, b) => b.groesse - a.groesse).slice(0, 5)
  for (const m of gross) {
    const r = moduleApi.read({ pfad: m.pfad })
    const anteil = r.gesamt ? ((100 * r.mitBeschreibung) / r.gesamt) : 0
    console.log(`  ${String(r.gesamt).padStart(5)} Schluessel, ${String(r.mitBeschreibung).padStart(4)} beschrieben (${anteil.toFixed(0)} %)  ${m.datei}`)
    pruefe(r.gesamt > 0, `${m.datei} wurde gelesen`)
  }

  console.log('')
  console.log('=== 4. Suchen ===')
  if (ip) {
    const r = moduleApi.read({ pfad: ip.pfad, suche: 'enable' })
    console.log(`  "enable" findet ${r.eintraege.length} von ${r.gesamt}`)
    pruefe(r.eintraege.length > 0, 'die Suche findet etwas')
    pruefe(r.eintraege.length < r.gesamt, 'die Suche filtert wirklich')
  }

  console.log('')
  console.log('=== 5. Schreiben - nur in einer Kopie ===')
  // Kopie der Datei anlegen und dort schreiben
  const kopieOrdner = path.join(temp, 'modules')
  fs.mkdirSync(kopieOrdner, { recursive: true })
  const quelle = path.join(MODULE_QUELLE, 'individualProgression.conf')
  const kopie = path.join(kopieOrdner, 'individualProgression.conf')
  fs.copyFileSync(quelle, kopie)

  // Config auf den Kopie-Ordner zeigen lassen.
  //
  // Wichtig: store.reload(). Sonst liefert der Store weiter die alte
  // Konfiguration aus seinem Zwischenspeicher, und der Test schreibt
  // plötzlich in die echten Modul-Configs des Nutzers.
  fs.writeFileSync(path.join(configOrdner, 'config.json'), JSON.stringify({
    server: {
      worldExe: path.join(REPACK, 'worldserver.exe'),
      worldConfDir: temp
    }
  }, null, 2), 'utf8')
  store.reload()

  const l2 = moduleApi.list()
  pruefe(l2.module.length === 1, `nur die Kopie wird gefunden (${l2.module.length})`)
  pruefe(l2.ordner === kopieOrdner, `der Ordner ist der Kopie-Ordner (${l2.ordner})`)

  const vorher = fs.readFileSync(kopie, 'utf8')
  const r = moduleApi.read({ pfad: l2.module[0].pfad })
  const ziel = r.eintraege.find(e => /Enable$/.test(e.key))
  const alterWert = ziel.value
  console.log(`  ${ziel.key} ist ${alterWert}, setze auf 0`)

  moduleApi.save({ pfad: l2.module[0].pfad, eintraege: [{ key: ziel.key, value: '0' }] })
  const nachher = moduleApi.read({ pfad: l2.module[0].pfad })
  const jetzt = nachher.eintraege.find(e => e.key === ziel.key)
  pruefe(jetzt.value === '0', `der Wert steht jetzt auf ${jetzt.value}`)
  pruefe(fs.existsSync(kopie + '.bak'), 'eine Sicherung wurde angelegt')
  pruefe(nachher.sicherung !== null, 'die Sicherung wird gemeldet')

  // Alles andere unveraendert?
  const a = vorher.split(/\r?\n/).filter(l => !l.startsWith(ziel.key))
  const b = fs.readFileSync(kopie, 'utf8').split(/\r?\n/).filter(l => !l.startsWith(ziel.key))
  pruefe(a.join('\n') === b.join('\n'), 'alle anderen Zeilen sind unveraendert')

  console.log('')
  console.log('=== 6. Zuruecksetzen ===')
  moduleApi.zuruecksetzen({ pfad: l2.module[0].pfad })
  const wieder = moduleApi.read({ pfad: l2.module[0].pfad })
  const zurueck = wieder.eintraege.find(e => e.key === ziel.key)
  pruefe(zurueck.value === alterWert, `der Wert steht wieder auf ${alterWert}`)
  pruefe(fs.readFileSync(kopie, 'utf8') === vorher, 'die Datei ist bitweise wieder die alte')

  console.log('')
  console.log('=== 7. Fremder Pfad wird abgewiesen ===')
  // Der Ordner zeigt jetzt auf die Kopie - eine Datei aus der echten
  // Repack liegt ausserhalb und muss abgelehnt werden.
  let abgelehnt = false
  try {
    moduleApi.read({ pfad: path.join(MODULE_QUELLE, 'playerbots.conf') })
  } catch (_) { abgelehnt = true }
  pruefe(abgelehnt, 'eine Datei ausserhalb des Modul-Ordners wird abgelehnt')

  let unbekanntAbgelehnt = false
  try {
    moduleApi.save({ pfad: l2.module[0].pfad, eintraege: [{ key: 'GibtEsNicht.Schluessel', value: '1' }] })
  } catch (_) { unbekanntAbgelehnt = true }
  pruefe(unbekanntAbgelehnt, 'ein unbekannter Schluessel wird abgelehnt')

  let fremdPfadAbgelehnt = false
  try {
    moduleApi.save({ pfad: 'C:/Windows/System32/drivers/etc/hosts', eintraege: [{ key: 'a', value: 'b' }] })
  } catch (_) { fremdPfadAbgelehnt = true }
  pruefe(fremdPfadAbgelehnt, 'ein beliebiger Systempfad wird abgelehnt')
}

main()
  .then(() => {
    fs.rmSync(temp, { recursive: true, force: true })
    console.log('')
    console.log(schlecht ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN` : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
    process.exit(schlecht ? 1 : 0)
  })
  .catch(e => {
    console.error('FEHLER: ' + e.message)
    console.error(e.stack)
    fs.rmSync(temp, { recursive: true, force: true })
    process.exit(1)
  })
