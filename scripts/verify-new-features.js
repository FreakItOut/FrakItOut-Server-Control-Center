'use strict'

/*
 * Testet die neuen Bot- und Pfad-Funktionen gegen eine kuenstliche
 * AzerothCore-artige Verzeichnisstruktur.
 *
 * Aufruf:  node scripts/verify-new-features.js [eigenes basisverzeichnis]
 *
 * Wichtig: der Test legt sein Verzeichnis selbst an und schreibt niemals in
 * eine echte Serverinstallation. Grund: er setzt Bot-Werte und legt .bak-
 * Dateien an - gegen den echten Server aufgerufen wuerde er die Bot-Anzahl
 * des Nutzers ueberschreiben.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

const store = require('../electron/store')
const bots = require('../electron/api/bots')
const configEditor = require('../electron/api/config-editor')

const BASE = process.argv[2] || path.join(os.tmpdir(), 'wowpanel-verify-new-features')

function section (title) {
  console.log('\n=== ' + title + ' ===')
}

function assert (cond, label) {
  console.log((cond ? '  OK   ' : '  FAIL ') + label)
  if (!cond) process.exitCode = 1
}

/*
 * Sicherheitsnetz. Der Test schreibt in worldserver.conf. Zeigt BASE auf
 * eine echte Installation, wuerde er deren Bot-Anzahl veraendern - das
 * waere ein Schaden, den kein Test zuruecknimmt. Also abbruch statt
 * Verzeichnis leeren.
 */
function pruefeZiel (ziel) {
  const unbedenklich = /wowpanel-verify/i
  if (unbedenklich.test(ziel)) return
  const bekannteZeichen = /azeroth|acore|repack|worldserver\.exe/i
  if (bekannteZeichen.test(ziel)) {
    console.error('ABBRUCH: "' + ziel + '" sieht nach einer echten Serverinstallation aus.')
    console.error('Dieser Test schreibt Bot-Werte. Bitte eigenes Verzeichnis angeben:')
    console.error('  node scripts/verify-new-features.js <eigenes verzeichnis>')
    process.exit(1)
  }
}

/*
 * Die Fixture. Sie bildet bewusst einen Server ab, bei dem die Bot-Eintraege
 * in der worldserver.conf stehen - der haeufigste Aufbau bei frischen
 * Installationen. Ein echtes Repack kann davon abweichen (Playerbots liegen
 * oft in einer eigenen modules\playerbots.conf), und genau diese Abweichung
 * soll hier nicht getestet werden.
 */
const WORLDSERVER_CONF = [
  'WorldServerConfig',
  'RealmID = 1',
  'MaxPingTime = 30',
  'LoginDatabaseInfo = "127.0.0.1;3306;root;test;acore_acore"',
  '',
  '# SOAP gehoert zu den Nicht-Bot-Zeilen und darf nie mitgespeichert werden',
  'SOAP.enable = 0',
  'SOAP.port = 8080',
  'SOAP.bindIP = "127.0.0.1"',
  '',
  '# Bot-Eintraege',
  'AiPlayerbot.Enable = 0',
  'AiPlayerbot.RandomBotsTotalCount = 0',
  'AiPlayerbot.RandomBots = 1',
  'AiPlayerbot.LoginDelayMin = 0',
  'AiPlayerbot.LoginDelayMax = 0',
  ''
].join('\r\n')

const AUTHSERVER_CONF = [
  'AuthServerConfig',
  'RealmID = 1',
  'LoginDatabaseInfo = "127.0.0.1;3306;root;test;acore_acore"',
  'BindIP = "127.0.0.1"',
  ''
].join('\r\n')

function legeFixtureAn () {
  const worldDir = path.join(BASE, 'bin', 'worldserver')
  const authDir = path.join(BASE, 'bin', 'authserver')

  /*
   * Reste vom letzten Lauf muessen weg, sonst ist der Test nicht wiederholbar.
   * Abschnitt 7 legt eine playerbots.conf an; laesst man sie liegen, meldet
   * Abschnitt 1 sie als vorhanden, und Abschnitt 2 nimmt die Bot-Werte dann
   * aus der falschen Datei. Genau das ist beim zweiten Lauf passiert.
   *
   * Geloescht wird nur im eigenen Temp-Verzeichnis. Ein selbst uebergebenes
   * Verzeichnis bleibt unangetastet - dort weiss niemand, was liegt.
   */
  const imTemp = path.resolve(BASE).startsWith(path.resolve(os.tmpdir()))
  if (imTemp && fs.existsSync(BASE)) fs.rmSync(BASE, { recursive: true, force: true })

  fs.mkdirSync(worldDir, { recursive: true })
  fs.mkdirSync(authDir, { recursive: true })
  fs.writeFileSync(path.join(worldDir, 'worldserver.conf'), WORLDSERVER_CONF, 'utf8')
  fs.writeFileSync(path.join(authDir, 'authserver.conf'), AUTHSERVER_CONF, 'utf8')
  if (imTemp) return
  console.log('  Hinweis: eigenes Verzeichnis "' + BASE + '" - vorhandene Dateien wurden nur ergaenzt, nicht geloescht.')
}

pruefeZiel(BASE)
legeFixtureAn()

// store auf die Testinstallation zeigen
store.init(BASE + '/cfg')
store.write({
  server: {
    worldExe: path.join(BASE, 'bin', 'worldserver', 'worldserver.exe'),
    authExe: path.join(BASE, 'bin', 'authserver', 'authserver.exe'),
    worldConfDir: path.join(BASE, 'bin', 'worldserver'),
    authConfDir: path.join(BASE, 'bin', 'authserver')
  }
})

async function main () {
  section('1. Konfigurationsdateien werden gefunden')
  const avail = configEditor.available()
  for (const a of avail) {
    console.log(`  ${a.key.padEnd(12)} ${a.exists ? a.path : '(nicht gefunden)'}`)
  }
  assert(avail.find(a => a.key === 'world').exists, 'worldserver.conf gefunden')
  assert(avail.find(a => a.key === 'auth').exists, 'authserver.conf gefunden')
  assert(!avail.find(a => a.key === 'playerbots').exists, 'playerbots.conf korrekt als fehlend gemeldet')

  section('2. Bot-Einstellungen werden aus worldserver.conf gelesen')
  const before = await bots.get()
  console.log(`  Quelle: ${before.file}  (${before.path})`)
  assert(before.file === 'world', 'fällt auf worldserver.conf zurück')
  assert(before.found === true, 'Bot-Einträge gefunden')
  const keys = before.entries.map(e => e.key)
  assert(keys.includes('AiPlayerbot.Enable'), 'AiPlayerbot.Enable vorhanden')
  assert(keys.includes('AiPlayerbot.RandomBotsTotalCount'), 'AiPlayerbot.RandomBotsTotalCount vorhanden')
  assert(
    !keys.some(k => !k.startsWith('AiPlayerbot.')),
    'nur Bot-Schlüssel werden geliefert (kein SOAP.enable usw.)'
  )

  section('3. Bot-Werte werden gespeichert')
  const entries = before.entries.map(e =>
    e.key === 'AiPlayerbot.RandomBotsTotalCount' ? { ...e, value: '150' }
      : e.key === 'AiPlayerbot.Enable' ? { ...e, value: '1' }
      : e.key === 'AiPlayerbot.RandomBots' ? { ...e, value: '3' }
      : e
  )
  const saved = await bots.save({ file: before.file, entries })
  assert(saved.ok === true, 'Schreiben erfolgreich')

  const after = await bots.get()
  const find = k => (after.entries.find(e => e.key === k) || {}).value
  assert(find('AiPlayerbot.RandomBotsTotalCount') === '150', 'Gesamt-Anzahl auf 150 gesetzt')
  assert(find('AiPlayerbot.Enable') === '1', 'Bots aktiviert')
  assert(find('AiPlayerbot.RandomBots') === '3', 'Bots pro Gebiet auf 3 gesetzt')

  section('4. Andere Zeilen bleiben unangetastet')
  const raw = fs.readFileSync(before.path, 'utf8')
  assert(raw.includes('RealmID = 1'), 'RealmID unveraendert')
  assert(raw.includes('SOAP.port = 8080'), 'SOAP-Eintraege unveraendert')
  assert(raw.includes('MaxPingTime = 30'), 'MaxPingTime unveraendert')

  section('5. Backup wurde angelegt')
  assert(fs.existsSync(before.path + '.bak'), '.bak-Datei vorhanden')

  section('6. Ungültige Schlüssel werden abgewiesen')
  try {
    await bots.save({ file: 'world', entries: [{ key: 'RealmID', value: '999' }] })
    console.log('  FAIL RealmID wurde nicht abgefangen')
    process.exitCode = 1
  } catch (e) {
    console.log('  OK   Nicht-Bot-Schlüssel abgelehnt: ' + e.message)
  }

  section('7. playerbots.conf anlegen und verwenden')
  const created = await bots.createFile()
  assert(created.created === true, 'playerbots.conf erstellt: ' + created.path)
  const nowFile = await bots.get()
  assert(nowFile.file === 'playerbots', 'nutzt jetzt playerbots.conf')
  assert(nowFile.primary === true, 'als primäre Quelle markiert')
  assert(nowFile.entries.length >= 4, 'Vorlagen-Schlüssel vorhanden (' + nowFile.entries.length + ')')

  console.log('\n' + (process.exitCode ? 'FEHLGESCHLAGEN' : 'ALLE PRUEFUNGEN BESTANDEN'))
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})