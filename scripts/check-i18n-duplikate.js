'use strict'

/*
 * Sucht doppelte Schluessel in den Sprachpaketen.
 *
 * Aufruf: node scripts/check-i18n-duplikate.js
 *
 * Warum ueberhaupt: Ein Schluessel, der zweimal im selben Objekt steht,
 * ist kein Fehler, den der Browser meldet - JavaScript nimmt einfach den
 * letzten. Im Panel heisst das: der erste Eintrag wird stillschweigend
 * verworfen.
 *
 * Genau das ist passiert. Bei einer Ergaenzung mit replaceAll wurden die
 * Schluessel zweimal eingefuegt - einmal mit, einmal ohne Einrueckung. Der
 * zweite Eintrag gewann, und ein Platzhalter-Fragment blieb sichtbar im
 * Fenster:
 *
 *   1500 Bot-Charakter{count, plural, one{} other{e}} online
 *
 * Denn die Syntax "{count, plural, ...}" kennt das Projekt gar nicht -
 * t() ersetzt nur "{name}".
 *
 * Warum der Quelltext und nicht das geladene Objekt
 * --------------------------------------------------
 * Zuerst war die Idee, das Modul zu laden und das fertige Objekt zu
 * untersuchen. Das geht nicht: JavaScript loest einen doppelten Schluessel
 * BEIM LADEN auf. {a: 1, a: 2} ergibt {a: 2} - es gibt nichts mehr zu
 * sehen. Die Gegenprobe zeigte: der Test meldete "keine Duplikate",
 * obwohl gerade eines drin stand.
 *
 * Also bleibt der Quelltext. Entscheidend ist, dass zwei Schluessel nur
 * dann als Duplikat gelten, wenn sie im SELBEN Objekt stehen:
 *
 *   - "world" in check.world und in dbName.world ist erlaubt.
 *   - "world" in de.console und in en.console ist erlaubt.
 *   - "world" zweimal in de.console ist ein Fehler.
 *
 * Wie die Verschachtelung erkannt wird
 * ------------------------------------
 * Ueber die Klammern. Jedes Objekt merkt sich, bei welcher Tiefe es
 * geoeffnet wurde; geschlossen wird es, wenn die Tiefe wieder auf
 * diesen Wert zurueckgeht.
 *
 * Zwei Fallen, die beide im ersten Versuch passiert sind und durch
 * Tests aufgedeckt wurden:
 *
 *   1. "export default {" ist zwar ein Objekt, hat aber keinen Namen und
 *      wird von keinem Muster fuer einen Blockanfang erfasst. Dadurch
 *      liefen Zaehler und Stapel auseinander, und am Ende wurde ein
 *      Block mit dem falschen Pfad gemeldet.
 *
 *   2. Die Klammern in Strings duerfen nicht mitzaehlen - sonst
 *      verschiebt ein Text mit geschweiften Klammern die Zaehlung.
 */

const fs = require('fs')
const path = require('path')

const wurzel = path.join(__dirname, '..', 'src', 'i18n')
const dateien = []
;(function sammle (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sammle(p)
    else if (e.name.endsWith('.js')) dateien.push(p)
  }
})(wurzel)

function klammern (zeile) {
  let inString = false
  let auf = 0
  let zu = 0
  for (const ch of zeile) {
    if (ch === "'") { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') auf++
    else if (ch === '}') zu++
  }
  return { auf, zu }
}

function bloeckeErfassen (text) {
  const zeilen = text.split(/\r?\n/)
  const bloecke = []
  const stack = []   // { name, pfad, tiefeBeiStart, schluessel: [] }
  let tiefe = 0

  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i]
    const nr = i + 1

    // Schlüsselzeile? Sie gehoert zu allen gerade offenen Objekten.
    const schluesselMatch = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(z)
    const istBlockanfang = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{/.test(z)

    if (schluesselMatch && !istBlockanfang) {
      /*
       * Nur dem INNERSTEN offenen Block zuordnen. Sonst wuerde ein
       * Schluessel auch im aeusseren Objekt gezaehlt, und "auth" in
       * app.auth und in app.db.auth waere ein Schein-Duplikat.
       */
      const innerster = stack[stack.length - 1]
      if (innerster) innerster.schluessel.push({ name: schluesselMatch[1], nr })
    }

    // Klammern dieser Zeile verarbeiten
    const { auf, zu } = klammern(z)
    for (let k = 0; k < auf; k++) {
      tiefe++
      // Ein Blockanfang? Dann bekommt dieses Object einen Namen.
      // "export default {" hat keinen - das ist der Wurzelblock und
      // bekommt keinen Pfadnamen.
      const anfang = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{/.exec(z)
      if (anfang && k === 0) {
        const pfad = stack.map(o => o.name).concat(anfang[1]).join('.')
        stack.push({ name: anfang[1], pfad, tiefeBeiStart: tiefe, schluessel: [] })
      } else {
        stack.push({ name: null, pfad: stack.map(o => o.name).filter(Boolean).join('.'), tiefeBeiStart: tiefe, schluessel: [] })
      }
    }
    for (let k = 0; k < zu; k++) {
      const b = stack.pop()
      if (b && b.name !== null) {
        b.bis = nr
        bloecke.push(b)
      }
      tiefe--
    }
  }
  return bloecke
}

let fehler = 0

for (const datei of dateien) {
  const text = fs.readFileSync(datei, 'utf8')
  for (const block of bloeckeErfassen(text)) {
    const zaehler = new Map()
    for (const s of block.schluessel) {
      if (!zaehler.has(s.name)) zaehler.set(s.name, [])
      zaehler.get(s.name).push(s.nr)
    }
    for (const [name, nr] of zaehler) {
      if (nr.length > 1) {
        fehler++
        console.log('  ' + path.relative(wurzel, datei) + ': ' + block.pfad + '.' + name +
          ' steht ' + nr.length + '-mal (Zeilen ' + nr.join(', ') + ')')
      }
    }
  }
}

console.log('')
console.log('  ' + (fehler ? fehler + ' doppelte Schluessel' : 'keine doppelten Schluessel'))

/*
 * Zweiter Fehler aus derselben Baustelle: die Syntax "{count, plural, ...}".
 *
 * t() macht nur eins: "{name}" durch den Wert ersetzen. Die Plural-
 * Form wird nicht ausgewertet - sie bleibt als Text stehen und landet
 * buendstaendlich im Fenster:
 *
 *   1500 Bot-Charakter{count, plural, one{} other{e}} online
 *
 * Das Projekt schreibt Mehrzahl anders: "{count} Charaktere". Also wird
 * hier geprueft, dass niemand eine Plural-Syntax benutzt.
 */
let pluralFehler = 0
for (const datei of dateien) {
  const text = fs.readFileSync(datei, 'utf8')
  text.split(/\r?\n/).forEach((z, i) => {
    if (/\{[a-zA-Z]+,\s*plural/.test(z)) {
      pluralFehler++
      console.log('  ' + path.relative(wurzel, datei) + ':' + (i + 1) + ': Plural-Syntax, die das Projekt nicht kennt')
      console.log('      ' + z.trim())
    }
  })
}

if (pluralFehler) {
  console.log('')
  console.log('  ' + pluralFehler + ' unzulaessige Plural-Syntaxen')
}

process.exit(fehler || pluralFehler ? 1 : 0)