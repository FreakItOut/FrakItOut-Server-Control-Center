'use strict'
/*
 * Modul-SQL-Import: Zuordnung, Schutz und Abbruch (kein Netz, keine echte DB).
 * Laeuft in 'npm run pruefe' mit.
 *  - SQL-Dateien nach world/characters/auth einsortieren
 *  - updates/archive überspringen, USE/DROP DATABASE ablehnen
 *  - Sicherung vor dem Einspielen, Fortschritt, Abbruch beim ersten Fehler
 *  - Konfigurations-Abgleich (individual-progression -> individualProgression)
 */
const os = require('os')
const fs = require('fs')
const path = require('path')

const base = path.join(os.tmpdir(), 'wowpanel-r33-' + Date.now())
const root = path.join(base, 'root')
const source = path.join(root, 'source', 'modules')
const configs = path.join(root, 'build', 'bin', 'configs')
const modConfigs = path.join(configs, 'modules')

let fehler = 0
const check = (ok, text) => {
  console.log((ok ? '  OK   ' : '  FAIL ') + text)
  if (!ok) fehler++
}
const schreibe = (p, inhalt) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, inhalt, 'utf8')
}

async function main () {
  fs.mkdirSync(modConfigs, { recursive: true })
  schreibe(path.join(modConfigs, 'individualProgression.conf'), '# x\n')
  schreibe(path.join(modConfigs, 'transmog.conf'), '# x\n')
  schreibe(path.join(modConfigs, 'worldserver.conf'), '# x\n')

  const store = require('../electron/store')
  store.init(path.join(base, 'cfg'))
  store.write({
    server: { rootDir: root, worldExe: path.join(root, 'build', 'bin', 'worldserver.exe'), worldConfDir: configs },
    mysql: { worldDb: 'w_world', charDb: 'w_char', authDb: 'w_auth' }
  })

  const moduleApi = require('../electron/api/module')
  const backupApi = require('../electron/api/backup')

  // Sicherung/Import abfangen - keine echte Datenbank im Test
  let sicherungen = 0
  const gespielt = []
  let fehlerBei = null
  backupApi.create = async () => { sicherungen++; return { ok: true, stamp: 'TEST-STAMP' } }
  backupApi.defaultsDatei = () => path.join(base, 'fake.ini')
  backupApi.spieleEinInDb = async (datei, ini, datenbank) => {
    if (fehlerBei && datei.endsWith(fehlerBei)) throw new Error('Testfehler in ' + path.basename(datei))
    gespielt.push({ datei: path.basename(datei), db: datenbank })
  }

  // Modul mit gemischten SQL-Ordnern
  const modul = path.join(source, 'individual-progression')
  fs.mkdirSync(path.join(modul, '.git'), { recursive: true })
  schreibe(path.join(modul, 'data', 'sql', 'world', '01_base.sql'), 'CREATE TABLE x (id INT);\n')
  schreibe(path.join(modul, 'data', 'sql', 'world', '02_bad.sql'), '-- erklärt USE\nUSE `fremd`;\nCREATE TABLE y (id INT);\n')
  schreibe(path.join(modul, 'data', 'sql', 'characters', '03_char.sql'), 'ALTER TABLE characters ADD z INT;\n')
  schreibe(path.join(modul, 'data', 'sql', 'auth', '04_auth.sql'), 'ALTER TABLE account ADD z INT;\n')
  schreibe(path.join(modul, 'data', 'sql', 'world', 'updates', '05_alt.sql'), 'DROP TABLE x;\n')
  schreibe(path.join(modul, 'data', 'sql', 'world', '06_dropdb.sql'), 'DROP DATABASE `w_world`;\n')
  // Falsch-Positiv-Falle: englischer Text mit "Use ..." in einer Zeichenkette
  schreibe(path.join(modul, 'data', 'sql', 'world', '07_text.sql'),
    "-- erklaert: USE ist hier nur Text\nINSERT INTO probe VALUES ('Frostwolf - Out of Combat - Use Random movement');\n")

  console.log('\n=== 1. sammleSqlDateien: Zuordnung ===')
  const dateien = moduleApi.sammleSqlDateien(modul)
  const db = rel => (dateien.find(d => d.rel.endsWith(rel)) || {}).db
  check(dateien.length === 7, '7 SQL-Dateien gefunden (' + dateien.length + ')')
  check(db('01_base.sql') === 'worldDb', 'world -> worldDb')
  check(db('03_char.sql') === 'charDb', 'characters -> charDb')
  check(db('04_auth.sql') === 'authDb', 'auth -> authDb')
  check(!db('05_alt.sql'), 'updates/ wird nicht zugeordnet')

  console.log('\n=== 2. konfFuer: Namens-Abgleich ===')
  const konf = moduleApi.konfFuer('individual-progression')
  check(konf.length === 1 && konf[0].datei === 'individualProgression.conf',
    'individual-progression -> individualProgression.conf (' + JSON.stringify(konf.map(k => k.datei)) + ')')
  check(moduleApi.konfFuer('gibtsnicht').length === 0, 'unbekanntes Modul -> keine Conf')

  console.log('\n=== 3. installierte(): sqlAnzahl/konf ===')
  const inst = moduleApi.installierte()
  const eintrag = inst.module.find(m => m.name === 'individual-progression')
  check(!!eintrag && eintrag.sqlAnzahl === 7, 'sqlAnzahl = 7')
  check(!!eintrag && eintrag.konf[0] === 'individualProgression.conf', 'konf erkannt')
  check(!!eintrag && !!eintrag.konfPfad, 'konfPfad gesetzt')

  console.log('\n=== 4. sqlEinspielen: Sicherung, Schutz, Zuordnung ===')
  const r = await moduleApi.sqlEinspielen({ name: 'individual-progression' })
  console.log('  Ergebnis:', JSON.stringify({
    gesamt: r.gesamt, gespielt: r.gespielt, abgelehnt: r.abgelehnt.map(a => path.basename(a.datei)),
    uebersprungen: r.uebersprungen.map(a => path.basename(a.datei)), sicherung: r.sicherung
  }))
  check(sicherungen === 1, 'genau eine Sicherung vor dem Einspielen')
  check(r.ok === true, 'Lauf ohne Fehler')
  check(r.gespielt === 4, '4 Dateien eingespielt (01, 03, 04, 07)')
  check(gespielt.find(g => g.datei === '01_base.sql').db === 'w_world', '01 -> w_world')
  check(gespielt.find(g => g.datei === '03_char.sql').db === 'w_char', '03 -> w_char')
  check(gespielt.find(g => g.datei === '04_auth.sql').db === 'w_auth', '04 -> w_auth')
  check(!!gespielt.find(g => g.datei === '07_text.sql'), '"Use ..." im Text wird NICHT abgelehnt')
  check(r.abgelehnt.length === 2, 'USE und DROP DATABASE abgelehnt')
  check(r.uebersprungen.length === 1, 'updates/ übersprungen')
  check(r.sicherung === 'TEST-STAMP', 'Sicherungsstempel zurückgegeben')

  console.log('\n=== 5. sqlEinspielen: Abbruch beim ersten Fehler ===')
  gespielt.length = 0
  fehlerBei = '03_char.sql'
  const r2 = await moduleApi.sqlEinspielen({ name: 'individual-progression' })
  console.log('  Ergebnis:', JSON.stringify({ ok: r2.ok, gespielt: r2.gespielt, fehler: r2.fehler.map(f => path.basename(f.datei)), offen: r2.offen.map(o => path.basename(o)) }))
  check(r2.ok === false, 'Fehler wird gemeldet')
  check(r2.gespielt === 1, 'nur die Datei davor wurde gespielt')
  check(r2.offen.length === 2, 'weitere Dateien als offen gemeldet')

  console.log('\n=== 6. Modul ohne SQL / unbekanntes Modul ===')
  fs.mkdirSync(path.join(source, 'leer', '.git'), { recursive: true })
  let e1 = ''
  try { await moduleApi.sqlEinspielen({ name: 'leer' }) } catch (e) { e1 = e.message }
  check(/Keine SQL-Dateien/.test(e1), 'Modul ohne SQL wird klar abgelehnt')
  let e2 = ''
  try { await moduleApi.sqlEinspielen({ name: '../boese' }) } catch (e) { e2 = e.message }
  check(/Ungültiger Modulname/.test(e2), 'Pfad-Ausbruch abgelehnt')

  console.log('\n' + (fehler ? fehler + ' Prüfung(en) fehlgeschlagen.' : 'RUNDE-33-TEST: alle Prüfungen bestanden.'))
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_) {}
  process.exitCode = fehler ? 1 : 0
}

main().catch(e => {
  console.error('ABBRUCH:', e.message)
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_) {}
  process.exit(1)
})
