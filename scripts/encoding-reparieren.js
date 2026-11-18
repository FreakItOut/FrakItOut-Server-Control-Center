'use strict'

/*
 * Repariert eine durch PowerShell zerstoerte UTF-8-Datei.
 *
 * Was passiert war: Get-Content las die Datei als Windows-1252, Set-Content
 * schrieb sie wieder - jedes Sonderzeichen wurde dabei zweimal kodiert.
 * Aus einem echten "ä" (UTF-8: C3 A4) wurde "Ã¤" (zwei Zeichen).
 *
 * Rueckwaerts: die Zeichenkette als Windows-1252-Bytes nehmen und als
 * UTF-8 lesen. Das macht jede betroffene Zeile in einem Rutsch wieder
 * richtig, statt sie einzeln anzufassen.
 *
 * Aufruf: node scripts/encoding-reparieren.js <datei> [<nochmal>]
 *   --probe  nur anzeigen, nichts schreiben
 */

const fs = require('fs')
const path = require('path')

const datei = process.argv[2]
const PROBE = process.argv.includes('--probe')

if (!datei) {
  console.error('Aufruf: node scripts/encoding-reparieren.js <datei> [--probe]')
  process.exit(1)
}

const absolut = path.isAbsolute(datei) ? datei : path.join(__dirname, '..', datei)
if (!fs.existsSync(absolut)) {
  console.error('FEHLER: ' + absolut + ' gibt es nicht.')
  process.exit(1)
}

const roh = fs.readFileSync(absolut)
const hatBom = roh.length >= 3 && roh[0] === 0xef && roh[1] === 0xbb && roh[2] === 0xbf

// Windows-1252 nach UTF-8 zurueckdrehen
let inhalt = roh.toString('utf8')
if (hatBom) inhalt = inhalt.slice(1)
const verdacht = /Ã.|Â.|â€/
const warDefekt = verdacht.test(inhalt)

const repariert = Buffer.from(inhalt, 'latin1').toString('utf8')
const immerNochDefekt = verdacht.test(repariert)

console.log('=== ' + path.relative(path.join(__dirname, '..'), absolut) + ' ===')
console.log('  Byte-Order-Mark am Anfang : ' + (hatBom ? 'ja (wird entfernt)' : 'nein'))
console.log('  Sonderzeichen zerstoert   : ' + (warDefekt ? 'ja' : 'nein'))
console.log('  nach der Reparatur noch   : ' + (immerNochDefekt ? 'ja - nicht sauber' : 'nein'))

// Gegenprobe: ist danach noch lesbarer Text da?
const zeilen = repariert.split(/\r?\n/)
const lesbar = zeilen.filter(l => l.trim() && !verdacht.test(l)).length
console.log('  Zeilen gesamt             : ' + zeilen.length)
console.log('  Zeilen ohne Sonderzeichen : ' + lesbar)

if (!warDefekt && !hatBom) {
  console.log('')
  console.log('  Nichts zu tun.')
  process.exit(0)
}

if (immerNochDefekt) {
  console.error('')
  console.error('  ABBRUCH: nach der Reparatur sind noch Sonderzeichen kaputt.')
  console.error('  Das waere ein anderer Schaden als die Doppelkodierung.')
  process.exit(1)
}

if (PROBE) {
  console.log('')
  console.log('  --probe: nichts geschrieben.')
  process.exit(0)
}

fs.writeFileSync(absolut, Buffer.from(repariert, 'utf8'))
console.log('')
console.log('  geschrieben, ohne Byte-Order-Mark.')
process.exit(0)