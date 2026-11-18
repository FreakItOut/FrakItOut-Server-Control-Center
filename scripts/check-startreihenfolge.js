'use strict'

/*
 * Die Startreihenfolge steht an vier Stellen: im Code, im Kopfkommentar,
 * im Oberflaechentext (deutsch und englisch) und im Pruefskript.
 *
 * Genau daraus ist schon ein Fehler entstanden: der Code startete
 * db -> world -> auth, waehrend Kommentar, Text und Test db -> auth -> world
 * behaupteten. Drei von vier Stellen hatten unrecht, und nichts hat es
 * gemerkt - verify-startall.js prueft gegen sein eigenes假 Erwartung, nicht
 * gegen den Code.
 *
 * Dieser Test vergleicht die vier Stellen miteinander. Wer die Reihenfolge
 * bewusst aendert, aendert sie hier an allen vieren; dieser Test sagt einem
 * dann, welche noch fehlen.
 */

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

let gut = 0
let schlecht = 0

function check (cond, label) {
  if (cond) {
    gut++
    console.log('  OK   ' + label)
  } else {
    schlecht++
    console.log('  FAIL ' + label)
  }
}

function lies (rel) {
  return fs.readFileSync(path.join(WURZEL, rel), 'utf8')
}

/* ------------------------------------------------ 1) der Code ist die Wahrheit */

const code = lies('electron/api/start-all.js')

// Nur der Startteil, nicht stopAll. startAll beginnt mit "async function
// startAll" und endet vor "async function stopAll".
const startTeil = code.slice(
  code.indexOf('async function startAll'),
  code.indexOf('async function stopAll')
)

const schritte = []
for (const m of startTeil.matchAll(/step:\s*'(db|world|auth)'/g)) {
  if (schritte[schritte.length - 1] !== m[1]) schritte.push(m[1])
}

console.log('\n=== 1. Code ===')
console.log('  Reihenfolge im Code: ' + schritte.join(' -> '))
check(schritte.join(',') === 'db,world,auth', 'Code startet db -> world -> auth')

/* ------------------------------------------ 2) Oberflaechentext folgt dem Code */

// Welches Wort steht fuer welche Komponente. Beide Sprachen benutzen fuer
// World- und Authserver dieselben Bezeichner, nur die Datenbank unterscheidet
// sich - deshalb steht hier kein "World server".
const WORT = {
  de: { db: 'Datenbank', world: 'Worldserver', auth: 'Authserver' },
  en: { db: 'Database', world: 'Worldserver', auth: 'Authserver' }
}

const i18n = lies('src/i18n/parts/serverControl.js')

// Die Datei hat die Form { de: {...}, en: {...} }. Erst an dieser Grenze
// trennen, sonst prueft man die englische Zeile mit der deutschen Wortliste
// und vice versa - das meldet dann Faellalarme an beiden Zeilen.
const deTeil = i18n.slice(i18n.indexOf('\n  de: {'), i18n.indexOf('\n  en: {'))
const enTeil = i18n.slice(i18n.indexOf('\n  en: {'))

console.log('\n=== 2. Oberflaechentext ===')
for (const [sprache, teil] of [['de', deTeil], ['en', enTeil]]) {
  check(teil.length > 100, `${sprache}: eigener Sprachblock gefunden`)
  // "sequence:" gibt es in mehreren Seitenbereichen. Gesucht ist nur die
  // Zeile, die auch den Pfeil und die Komponenten nennt - die
  // Startsequenz. Sonst wuerde ein Datenbank-Sequenztext mitgezaehlt.
  const zeilen = teil.split(/\r?\n/).filter(l =>
    /^\s*sequence:\s*'/.test(l) && /→/.test(l))
  check(zeilen.length >= 1, `${sprache}: sequence-Zeile gefunden (${zeilen.length})`)

  for (const zeile of zeilen) {
    // Position jedes Komponentenworts bestimmen, dann nach Position sortieren
    const treffer = []
    for (const [kurz, wort] of Object.entries(WORT[sprache])) {
      // Worldserver enthaelt "server", Authserver auch - deshalb muss der
      // Vergleich case-insensitiv gegen das ganze Wort laufen.
      const i = zeile.toLowerCase().indexOf(wort.toLowerCase())
      if (i >= 0) treffer.push({ kurz, i })
    }
    treffer.sort((a, b) => a.i - b.i)
    const gefunden = treffer.map(t => t.kurz).join(',')
    check(gefunden === 'db,world,auth',
      `${sprache}: Text nennt ${gefunden || '(nichts)'} - erwartet db,world,auth`)
  }
}

/* --------------------------------------------------- 3) Pruefskript folgt dem Code */

console.log('\n=== 3. Pruefskript ===')
const test = lies('scripts/verify-startall.js')
check(test.includes("=== 'db -> world -> auth'"),
  'verify-startall.js erwartet db -> world -> auth')
check(!test.includes("=== 'db -> auth -> world'"),
  'keine alte Erwartung db -> auth -> world mehr im Test')

/* ---------------------------------------------------------- 4) Kopfkommentar */

console.log('\n=== 4. Kopfkommentar ===')
// Der Kopfkommentar ist der erste Blockkommentar der Datei. "const net"
  // steht darueber, deshalb darf man nicht bis dorthin schneiden.
const kopf = code.slice(0, code.indexOf('*/') + 2)
check(/->\s*Worldserver/.test(kopf) && /->\s*Authserver/.test(kopf),
  'Kopfkommentar nennt Worldserver vor Authserver')

console.log('\n' + (schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`))

process.exit(schlecht ? 1 : 0)