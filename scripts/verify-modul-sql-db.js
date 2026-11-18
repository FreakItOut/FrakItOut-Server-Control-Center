'use strict'
/*
 * Manueller Echt-Test des Modul-SQL-Imports (braucht laufende MySQL).
 * Nicht in 'npm run pruefe' - legt eine Wegwerf-Datenbank an und raeumt sie wieder weg.
 *
 *  - legt eine Wegwerf-Datenbank an
 *  - spielt eine echte SQL-Datei ueber spieleEinInDb ein
 *  - prueft den Inhalt
 *  - raeumt Datenbank und temporaere my.ini wieder weg
 * Es wird KEINE bestehende Datenbank angefasst.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const dir = path.join(process.cwd(), 'release', 'win-unpacked')
const store = require('../electron/store')
store.init(dir)
const backup = require('../electron/api/backup')

const DB = 'wowpanel_r33_import_test'
let fehler = 0
const check = (ok, text) => {
  console.log((ok ? '  OK   ' : '  FAIL ') + text)
  if (!ok) fehler++
}

function mysql (args, ini) {
  const r = spawnSync(backup.werkzeuge().client, [`--defaults-extra-file=${ini}`, ...args], { encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() }
}

async function main () {
  const ini = backup.defaultsDatei()
  try {
    const weg = mysql(['-e', `DROP DATABASE IF EXISTS \`${DB}\``], ini)
    check(weg.code === 0, 'Wegwerf-Datenbank ggf. entfernt' + (weg.code ? ': ' + weg.err : ''))
    const an = mysql(['-e', `CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`], ini)
    check(an.code === 0, 'Wegwerf-Datenbank angelegt' + (an.code ? ': ' + an.err : ''))

    const datei = path.join(os.tmpdir(), 'wowpanel-r33-import.sql')
    fs.writeFileSync(datei, [
      'CREATE TABLE probe (id INT PRIMARY KEY, name VARCHAR(32));',
      "INSERT INTO probe VALUES (1, 'welt'), (2, 'chars');",
      ''
    ].join('\n'), 'utf8')

    await backup.spieleEinInDb(datei, ini, DB)
    const z = mysql(['--database=' + DB, '-N', '-e', 'SELECT COUNT(*) FROM probe'], ini)
    check(z.code === 0 && z.out === '2', 'SQL-Datei eingespielt, 2 Zeilen gelesen (' + z.out + ')')

    // Fehlerfall: kaputtes SQL muss als Fehler ankommen
    const kaputt = path.join(os.tmpdir(), 'wowpanel-r33-kaputt.sql')
    fs.writeFileSync(kaputt, 'CREATE TABLE ;\n', 'utf8')
    let e = ''
    try { await backup.spieleEinInDb(kaputt, ini, DB) } catch (err) { e = err.message }
    check(/ERROR|Fehler|SQL/i.test(e), 'kaputtes SQL meldet einen Fehler (' + e.split('\n')[0].slice(0, 80) + ')')

    /*
     * Grosser Fehlerfall: mysql bricht nach der ersten Zeile ab, waehrend
     * die Datei noch geschrieben wird. Ohne EPIPE-Handler beendet das den
     * gesamten Node-Prozess - der Test waere dann hart abgebrochen.
     */
    const gross = path.join(os.tmpdir(), 'wowpanel-r33-gross.sql')
    fs.writeFileSync(gross,
      `USE \`${DB}\`;\nCREATE TABLE ;\n` + "INSERT INTO probe VALUES (1,'x');\n".repeat(400000), 'utf8')
    let e2 = ''
    try { await backup.spieleEinInDb(gross, ini, DB) } catch (err) { e2 = err.message }
    check(/ERROR|Fehler|SQL/i.test(e2), 'grosser Abbruch (EPIPE) wird als Fehler gemeldet - kein Absturz')
    let e3 = ''
    try { await backup.spieleEin(gross, ini) } catch (err) { e3 = err.message }
    check(/ERROR|Fehler|SQL/i.test(e3), 'spieleEin faengt EPIPE ebenfalls ab')

    fs.rmSync(datei, { force: true })
    fs.rmSync(kaputt, { force: true })
    fs.rmSync(gross, { force: true })
  } finally {
    try { mysql(['-e', `DROP DATABASE IF EXISTS \`${DB}\``], ini) } catch (_) {}
    try { fs.unlinkSync(ini) } catch (_) {}
  }

  console.log('\n' + (fehler ? fehler + ' Prüfung(en) fehlgeschlagen.' : 'ECHTERTEST SQL-IMPORT: alle Prüfungen bestanden.'))
  process.exitCode = fehler ? 1 : 0
}

main().catch(e => {
  console.error('ABBRUCH:', e.message)
  process.exit(1)
})
