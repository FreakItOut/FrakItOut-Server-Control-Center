'use strict'

/*
 * Prueft den Hinweis beim Ueberfahren der Menuepunkte.
 *
 * Der Hinweis zeigt den Eintrag "page.<pfad>" aus dem Sprachpaket:
 *   [ Titel, Beschreibung ]
 *
 * Fehlt die Beschreibung, zeigt der Hinweis nichts. Das faellt beim
 * Benutzen nicht auf - man merkt es nur, wenn man genau die Seite
 * ansteuert, fuer die es keine gibt. Deshalb diese Pruefung: sie meldet
 * jede Seite in der Leiste ohne Beschreibung, gleich in beiden Sprachen.
 */

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) {
    gut++
    console.log('  OK   ' + label)
  } else {
    schlecht++
    console.log('  FAIL ' + label)
  }
}

/* ---------------------------------------- Menuepunkte aus App.jsx ziehen */

// NAV_GROUPS steht als Liste von Gruppen mit { to: '/pfad', key: ... }.
// Nur die to-Felder werden gebraucht.
const app = fs.readFileSync(path.join(WURZEL, 'src', 'App.jsx'), 'utf8')
const navStart = app.indexOf('const NAV_GROUPS = [') !== -1
  ? app.indexOf('const NAV_GROUPS = [')
  : app.indexOf('const NAV = [')
const navBlock = app.slice(navStart, navStart + 6000)
const routen = []
for (const m of navBlock.matchAll(/\{\s*to:\s*'([^']+)'/g)) {
  if (!routen.includes(m[1])) routen.push(m[1])
}

console.log('=== Menuepunkte ===')
console.log('  ' + routen.length + ' gefunden')
pruefe(routen.length >= 15, 'mindestens 15 Menuepunkte erwartet')
pruefe(routen.includes('/'), 'Startpunkt vorhanden')

/* ------------------------------------- Beschreibungen aus den Sprachpaketen */

/*
 * Die Sprachpakete sind JavaScript mit einem Objektliteral. Sie werden
 * nicht ausgefuehrt - die enthaelt eine Menge, die es im Kontext nicht gibt.
 * Stattdessen wird der Block "page: { ... }" herausgeschnitten und die
 * Eintraege mit einem Muster gelesen.
 */
function liesPage (datei) {
  const s = fs.readFileSync(path.join(WURZEL, 'src', 'i18n', datei), 'utf8')
  const i = s.indexOf('page: {')
  if (i < 0) return null
  const block = s.slice(i, s.indexOf('\n    },', i))
  const treffer = new Map()
  for (const m of block.matchAll(/'([^']+)'\s*:\s*\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)) {
    treffer.set(m[1], { titel: m[2], text: m[3] })
  }
  return treffer
}

const de = liesPage('de.js')
const en = liesPage('en.js')

console.log('')
console.log('=== Beschreibungen je Sprache ===')
pruefe(!!de, 'deutsches Sprachpaket hat einen page-Block')
pruefe(!!en, 'englisches Sprachpaket hat einen page-Block')

for (const [sprache, tabelle] of [['de', de], ['en', en]]) {
  console.log('')
  console.log('  --- ' + sprache + ' ---')
  for (const r of routen) {
    const e = tabelle && tabelle.get(r)
    const hatTitel = !!(e && e.titel && e.titel.length)
    const hatText = !!(e && e.text && e.text.length > 10)
    pruefe(hatTitel && hatText,
      (hatTitel && hatText ? 'OK   ' : 'FEHLT ') + r + (e && e.text ? '  "' + e.text + '"' : '  <ohne Beschreibung>'))
  }
}

/* --------------------------------------- keine Leichen im Sprachpaket */

console.log('')
console.log('=== Eintraege mit Liste, aber ohne Beschreibung ===')
for (const [sprache, tabelle] of [['de', de], ['en', en]]) {
  const leichen = tabelle
    ? [...tabelle.entries()].filter(([, e]) => !e.text)
    : []
  pruefe(leichen.length === 0,
    sprache + ': ' + (leichen.length ? leichen.map(([k]) => k).join(', ') : 'keine'))
}

console.log('')
console.log(schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
process.exit(schlecht ? 1 : 0)