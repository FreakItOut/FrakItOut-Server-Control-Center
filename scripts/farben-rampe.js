'use strict'

/*
 * Farbgebung an das Logo anpassen.
 *
 * Das Logo ist fast schwarz (#040404, #202020) mit einem heissen Rot
 * (#FD0F0F) und etwas Weiss. Die bisherige Panel-Rampe war ein helles,
 * blau getoentes Grau mit gruenem Akzent - dazu passt das Bild nicht.
 *
 * Hier wird ausschliesslich die NEUTRALE Rampe umgerechnet:
 *
 *   - Jeder Grauton wird ueber seine Helligkeit auf die neue Rampe gelegt.
 *     Die relative Reihenfolge bleibt erhalten, sonst versaegt die 3D-Fase.
 *   - Die neuen Toene sind echtes Grau (R=G=B). Das alte Blau war eine
 *     bewusste Nuancierung des WinForms-Looks; zum Logo passt sie nicht,
 *     weil das Logo selbst neutral ist.
 *   - Die Kurve ist mit einem Exponenten > 1 leicht S-foermig: Schatten
 *     werden deutlicher tiefer, Lichter bleiben fast unveraendert. Das
 *     gibt Tiefe, ohne die Beschriftungen unlesbar zu machen.
 *
 * Farbige Toene (Gruen, Rot, Blau, Gold, Konsolenfarben) bleiben unberuehrt.
 * Die bedeutungstragenden Farben sind nicht Dekoration - "Online" muss
 * gruen bleiben, "Gefahr" rot. Der Akzent wird an anderer Stelle bewusst
 * gesetzt (scripts/farben-akzent.js).
 *
 * Aufruf:  node scripts/farben-rampe.js [--probe]
 *   --probe  nur anzeigen, nichts schreiben
 */

const fs = require('fs')
const path = require('path')

const CSS = path.join(__dirname, '..', 'src', 'styles.css')
const NUR_PROBE = process.argv.includes('--probe')

/*
 * Ist der Ton ein neutrales Blaugrau?
 *
 * Nicht ueber die Spreizung des Farbkanals: die alten Toene tragen einen
 * kleinen Blauanteil, der mit der Helligkeit waechst (#6d747c hat 15,
 * #98a0aa hat 18). Eine feste Grenze faengt die hellen also nicht und
 * haelt die dunklen - genau verkehrt herum, weil dort derselbe absolute
 * Anteil relativ groesser ist.
 *
 * Stattdessen wird der Farbton geprueft. Diese Toene liegen alle bei
 * etwa 210 Grad, mitten im Blau. Ein echtes Blau (#4d9bf0) ist mit 163
 * Kanalspreizung zu weit weg; ein helles Blau (#a8cbf0) ebenfalls.
 */
function istNeutral (r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min > 22) return false
  if (max === min) return true // echtes Grau

  // Farbton aus dem groessten und kleinsten Kanal
  let h
  if (max === r) h = ((g - b) / (max - min)) % 6
  else if (max === g) h = (b - r) / (max - min) + 2
  else h = (r - g) / (max - min) + 4
  h *= 60
  if (h < 0) h += 360

  // Der alte WinForms-Look ist ein Blaugrau; alles dort ist umgewandelt.
  return h >= 195 && h <= 230
}

/*
 * Alte Helligkeit -> neue Helligkeit.
 *   newL = 255 * (L/255)^1.12
 *
 * L=22  -> 16      (fast Schwarz, wie das Logo)
 * L=64  -> 54
 * L=116 -> 106
 * L=189 -> 182
 * L=245 -> 244     (Lichter bleiben)
 */
function neueHelligkeit (L) {
  return Math.round(255 * Math.pow(L / 255, 1.12))
}

function aufloesen (hex) {
  let h = hex.slice(1)
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

function alsHex (r, g, b) {
  const z = v => v.toString(16).padStart(2, '0')
  return '#' + z(r) + z(g) + z(b)
}

const vorher = fs.readFileSync(CSS, 'utf8')

/*
 * Nur einmal anwendbar.
 *
 * Die Kurve ist nicht idempotent: sie zieht jede Helligkeit nach unten,
 * ein zweiter Durchlauf macht dasselbe noch einmal. Danach waeren die
 * Flaechen zu dunkel - und weil es immer noch "funktioniert", faellt es
 * beim Ansehen nicht sofort auf.
 *
 * Erkennbar ist der Zustand an den Markenfarben: die sind im Original noch
 * nicht vorhanden. Also: sobald --brand im Blatt steht, ist die Umrechnung
 * erledigt.
 */
if (/--brand\s*:/.test(vorher)) {
  console.log('ABBRUCH: Die neutrale Rampe wurde bereits umgerechnet.')
  console.log('  Das Blatt enthaelt die Markenfarben aus :root.')
  console.log('  Ein zweiter Durchlauf wuerde die Toene noch einmal abdunkeln.')
  console.log('')
  console.log('  Neu anfangen? Original zuruecklegen und die Markenfarben')
  console.log('  entfernen, dann erneut laufen lassen.')
  process.exit(1)
}

const aenderungen = new Map()

const nachher = vorher.replace(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/g, (treffer) => {
  const { r, g, b } = aufloesen(treffer)
  if (!istNeutral(r, g, b)) return treffer

  const L = Math.round((r + g + b) / 3)
  const neu = neueHelligkeit(L)
  // Von 63 auf 60 - beide gerundet gleich. Dann waere die Aenderung
  // unsichtbar und der ganze Durchgang sinnlos.
  const neuerWert = neu === L ? Math.max(0, neu - 1) : neu

  const neuHex = alsHex(neuerWert, neuerWert, neuerWert)
  if (neuHex === treffer.toLowerCase()) return treffer

  aenderungen.set(treffer.toLowerCase(), { alt: treffer, neu: neuHex, altL: L, neuL: neuerWert })
  return neuHex
})

console.log('=== umgerechnete neutrale Toene ===')
console.log('  alt          L    ->  neu          L')
const sortiert = [...aenderungen.values()].sort((a, b) => a.altL - b.altL)
for (const a of sortiert) {
  console.log('  ' + a.alt.padEnd(12) + String(a.altL).padStart(3) + '  ->  ' + a.neu.padEnd(12) + String(a.neuL).padStart(3))
}

const farbigGeblieben = [...nachher.matchAll(/#[0-9a-fA-F]{3,6}\b/g)]
  .map(m => m[0].toLowerCase())
  .filter(h => {
    const { r, g, b } = aufloesen(h)
    return !istNeutral(r, g, b)
  })
const eigene = new Set(farbigGeblieben)

console.log('')
console.log(aenderungen.size + ' neutrale Toene umgerechnet')
console.log(eigene.size + ' farbige Toene unveraendert: ' + [...eigene].sort().join(' '))

if (NUR_PROBE) {
  console.log('')
  console.log('--probe: nichts geschrieben.')
  process.exit(0)
}

fs.writeFileSync(CSS, nachher, 'utf8')
console.log('')
console.log('geschrieben: ' + path.relative(path.join(__dirname, '..'), CSS))
process.exit(0)