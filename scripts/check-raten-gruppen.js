'use strict'

/*
 * Prueft die Gruppierung der Server-Raten.
 *
 * Aufruf: node scripts/check-raten-gruppen.js
 *
 * Ohne Datenbank und ohne Fenster. Der Test mit der echten Seite ist
 * scripts/verify-rates-seite.js; der mit der echten Datei ist
 * scripts/verify-rates.js. Das hier faengt den Regress, der sonst erst
 * beim Durchsehen von 96 Zeilen auffaellt.
 *
 * Zwei Dinge, die dabei schiefgehen koennen:
 *
 * 1. Die Reihenfolge. Die steht in electron/api/rates.js als GROUPS.
 *    Aendert jemand die Reihenfolge, wandert die spielerbezogene Gruppe
 *    nach unten - der Nutzer sucht sie dann wieder unter 30 Beute-Zeilen.
 *
 * 2. Die Zuordnung. Faellt ein Schluessel in keine Gruppe, landet er in
 *    "other" und steht am Ende, fern von seinen Verwandten. Bei den 96
 *    Schluesseln des AzerothCore-Repacks darf das nicht vorkommen.
 */

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')
const DATEI = path.join(WURZEL, 'electron', 'api', 'rates.js')
const KONFIG = path.join(
  'C:\\Azerothcore WoTLK Repack (Playerbots + Individual Progression)',
  'configs', 'worldserver.conf'
)

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) { gut++; console.log('  OK   ' + label) } else { schlecht++; console.log('  FAIL ' + label) }
}

const src = fs.readFileSync(DATEI, 'utf8')

/* --------------------------------------------- 1. Aufbau der Gruppen */

console.log('=== Aufbau ===')

pruefe(/const GROUPS = \[/.test(src), 'die Gruppen stehen als benannte Liste im Code')

// Die Reihenfolge aus der Datei lesen, nicht selbst raten
const reihenfolge = [...src.matchAll(
  /^\s*\{\s*\n\s*id:\s*'([a-z]+)'/gm
)].map(m => m[1])

pruefe(reihenfolge.length >= 6, `${reihenfolge.length} Gruppen gefunden`)
console.log(`  Reihenfolge: ${reihenfolge.join(' → ')}`)

const erwartet = ['character', 'reputation', 'combat', 'loot', 'world', 'economy', 'other']
pruefe(JSON.stringify(reihenfolge) === JSON.stringify(erwartet),
  'die Reihenfolge ist: character → reputation → combat → loot → world → economy → other')

pruefe(reihenfolge[0] === 'character',
  'die spielerbezogene Gruppe (character) steht an erster Stelle')

/* --------------------------------------------- 2. Zuordnung der Schluessel */

console.log('')
console.log('=== Zuordnung ===')

// Die echten Schluessel der installierten Config, wenn sie da ist
if (fs.existsSync(KONFIG)) {
  const zeilen = fs.readFileSync(KONFIG, 'utf8').split(/\r?\n/)
  const schluessel = zeilen
    .map(l => (/^\s*(Rates?\.[A-Za-z0-9_.]+)\s*=/).exec(l))
    .filter(Boolean)
    .map(m => m[1])

  console.log(`  ${schluessel.length} Schluessel aus der installierten worldserver.conf`)

  // Die Zuordnung frisst das Modul selbst - keinen zweiten Bauplan
  const rates = require('../electron/api/rates')
  const zaehler = {}
  const ohne = []
  for (const k of schluessel) {
    const g = rates.groupOf(k)
    zaehler[g] = (zaehler[g] || 0) + 1
    if (g === 'other') ohne.push(k)
  }

  for (const id of reihenfolge) {
    console.log(`    ${id.padEnd(12)} ${String(zaehler[id] || 0).padStart(3)}`)
  }

  pruefe(ohne.length === 0,
    `jeder Schluessel landet in einer benannten Gruppe (${ohne.length} ohne)`)
  if (ohne.length) console.log(`    ohne Gruppe: ${ohne.join(', ')}`)

  // Die spielerbezogene Gruppe muss wirklich die XP-Schluessel haben
  const xp = schluessel.filter(k => /^Rates?\.XP\./i.test(k))
  pruefe(xp.length > 0 && xp.every(k => rates.groupOf(k) === 'character'),
    `alle ${xp.length} Erfahrungs-Schluessel liegen in der ersten Gruppe`)

  // Gegner gehoeren NICHT nach vorn - sie betreffen nicht den Spieler
  const gegner = schluessel.filter(k => /^Rates?\.Creature/i.test(k))
  pruefe(gegner.length > 0 && gegner.every(k => rates.groupOf(k) === 'world'),
    `alle ${gegner.length} Gegner-Schluessel liegen erst in der Welt-Gruppe`)
} else {
  console.log(`  (die installierte Config ist nicht da: ${KONFIG})`)
}

/* --------------------------------------------- 3. Teile fuer die Namen */

console.log('')
console.log('=== Die Teile fuer die Anzeigenamen ===')

const rates = require('../electron/api/rates')

// Faellt der Aufbau auseinander, gibt es keine Teile - und die Namen
// werden rohe Schluessel.
const teileProben = [
  'Rate.XP.Kill',
  'Rate.Drop.Item.Uncommon',
  'Rate.Creature.Elite.RARE.HP',
  'Rate.Auction.Deposit'
]
for (const k of teileProben) {
  const p = rates.keyParts(k)
  pruefe(p.length > 1,
    `${k} zerfaellt in ${p.length} Teile (${p.join(', ')})`)
}

// Ein unbekannter Schluessel darf nicht abstuerzen
let keinAbsturz = true
try {
  rates.friendlyName('Rate.Ganz.Neu.Schluessel')
  rates.groupOf('Rate.Ganz.Neu.Schluessel')
} catch (_) {
  keinAbsturz = false
}
pruefe(keinAbsturz, 'ein unbekannter Schluessel bringt das Modul nicht zu Fall')

console.log('')
console.log(schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
process.exit(schlecht ? 1 : 0)
