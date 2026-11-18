'use strict'

/*
 * Prueft, dass jedes API-Modul die Funktionen liefert, die die Routen
 * aufrufen.
 *
 * Aufruf: node scripts/check-api-exporte.js
 *
 * Anlass: Beim Erweitern von module.js ist der Eintrag "list" aus den
 * Exports verschwunden - vermutlich beim Ersetzen eines Blockes. Die
 * Folge: 'modules.list' rief eine nicht vorhandene Funktion auf, die
 * Modul-Seite zeigte nichts mehr. Und es fiel erst auf, als die
 * Uebersicht "0 Module" zeigte.
 *
 * Solche Fehler sind im Betrieb lautlos: "undefined ist keine
 * Funktion" landet als Ablehnung im IPC-Aufruf und wird nur dort
 * angezeigt, wo der Aufruf herkam.
 *
 * Dieser Test geht alle Routen durch und prueft, ob die aufgerufene
 * Funktion im jeweiligen Modul auch exportiert wird.
 */

const fs = require('fs')
const path = require('path')

const wurzel = path.join(__dirname, '..')
const apiDir = path.join(wurzel, 'electron', 'api')
const index = fs.readFileSync(path.join(apiDir, 'index.js'), 'utf8')

/*
 * Welche Datei ist welches Modul?
 *
 * Aus den require-Zeilen in index.js lesen - nicht raten. Die Dateien
 * heissen nicht wie die Variablen: aus "moduleApi" wird "module.js",
 * aus "serverManager" wird "server-manager.js".
 */
const dateiVon = new Map()
for (const m of index.matchAll(/const\s+([a-zA-Z]+)\s*=\s*require\('(\.\.?\/[^']+)'\)/g)) {
  // './x' liegt in electron/api, '../x' in electron.
  const ziel = m[2].startsWith('./')
    ? path.join(apiDir, m[2].slice(2) + '.js')
    : path.join(wurzel, 'electron', m[2].slice(3) + '.js')
  dateiVon.set(m[1], ziel)
}

// Die Routen und das Modul, aus dem sie kommen.
const routen = [...index.matchAll(/'([a-zA-Z]+)\.([a-zA-Z]+)':\s*async\s*\([^)]*\)\s*=>\s*([a-zA-Z]+)\.([a-zA-Z]+)/g)]
  .map(m => ({ route: m[1] + '.' + m[2], modul: m[3], funktion: m[4] }))

console.log(`  ${routen.length} Routen gefunden`)
console.log('')

let fehler = 0
const geprueft = new Set()

for (const r of routen) {
  const schluessel = r.modul + '.' + r.funktion
  if (geprueft.has(schluessel)) continue
  geprueft.add(schluessel)

  const datei = dateiVon.get(r.modul)
  if (!datei) {
    console.log(`  FEHLER: ${schluessel} - Modul ${r.modul} wird nicht eingebunden`)
    fehler++
    continue
  }
  if (!fs.existsSync(datei)) {
    console.log(`  FEHLER: ${schluessel} - Datei ${path.basename(datei)} gibt es nicht`)
    fehler++
    continue
  }

  const text = fs.readFileSync(datei, 'utf8')
  /*
   * Der Export-Block. Manche Dateien schreiben ihn einzeilig
   * ("module.exports = { a, b }"), andere ueber mehrere Zeilen. Beide
   * Formen muessen erkannt werden - sonst meldet der Test faelschlich
   * "kein module.exports gefunden" fuer jede einzeilige Variante.
   */
  const exportBlock = /module\.exports\s*=\s*\{([^}]*)\}/.exec(text)
  if (!exportBlock) {
    console.log(`  FEHLER: ${schluessel} - kein module.exports gefunden`)
    fehler++
    continue
  }

  // Steht die Funktion im Export-Block?
  const exportiert = exportBlock[1]
    .split(',')
    .map(t => t.trim().split(':')[0].trim())
    .filter(Boolean)

  if (!exportiert.includes(r.funktion)) {
    const definiert = new RegExp('function\\s+' + r.funktion + '\\s*\\(').test(text) ||
      new RegExp('const\\s+' + r.funktion + '\\s*=').test(text)
    console.log(`  FEHLER: ${schluessel} wird nicht exportiert` +
      (definiert ? ' (die Funktion gibt es aber)' : ' (die Funktion gibt es nicht)'))
    fehler++
  }
}

console.log('')
console.log(`  ${geprueft.size} Aufrufe geprueft, ${fehler} fehlerhaft`)
process.exit(fehler ? 1 : 0)