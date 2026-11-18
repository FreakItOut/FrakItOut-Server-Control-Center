// Prueft, ob der Seitentitel zum Menueeintrag passt.
//
// Hintergrund: In src/i18n/de.js trug '/server' den Titel "Server Console" -
// dieselbe Bezeichnung wie '/console'. Im Menue heisst die Seite aber
// "Server Start / Stop". Kein Test hat es gesehen: check-i18n vergleicht nur
// Schluessel, check-verweise prueft Verweise in Meldungstexten, und keiner der
// beiden fuehrt Code aus.
//
// Deshalb wird hier direkt verglichen: fuer jede Route muss es einen
// Menueeintrag geben, und dessen Beschriftung muss mit dem Seitentitel
// uebereinstimmen. Ausnahmen sind am Ende aufgefuehrt und begruendet.
'use strict'

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

// Navigation aus App.jsx lesen: { to: '/pfad', key: 'schluessel' }
const app = fs.readFileSync(path.join(WURZEL, 'src', 'App.jsx'), 'utf8')
const navStart = app.indexOf('const NAV_GROUPS = [') !== -1
  ? app.indexOf('const NAV_GROUPS = [')
  : app.indexOf('const NAV = [')
const navBlock = app.slice(navStart, navStart + 6000)
const nav = [...navBlock.matchAll(/\{\s*to:\s*'([^']+)'\s*,\s*key:\s*'([^']+)'/g)]
  .map(m => ({ pfad: m[1], key: m[2] }))

if (!nav.length) {
  console.log('Navigation in App.jsx nicht gefunden - Abbruch.')
  process.exit(1)
}

/*
 * Titel aus der Sprachdatei ziehen. Die Eintraege sehen aus wie
 *   '/server': ['Server Start / Stop', 'World- und Authserver ...'],
 * und koennen Zeilenumbrueche enthalten. Deshalb wird der Block um den
 * Schluessel herum gelesen, statt Zeile fuer Zeile.
 */
function titelLesen (datei) {
  const s = fs.readFileSync(path.join(WURZEL, 'src', 'i18n', datei), 'utf8')
  const start = s.indexOf('page: {')
  const ende = s.indexOf('\n  },', start)
  const block = s.slice(start, ende === -1 ? undefined : ende)
  const treffer = {}
  const re = /'([^']+)'\s*:\s*\[\s*'((?:[^'\\]|\\')*)'/g
  let m
  while ((m = re.exec(block))) treffer[m[1]] = m[2]
  return treffer
}

const titelDe = titelLesen('de.js')
const titelEn = titelLesen('en.js')

// Seiten, deren Titel absichtlich vom Menuewort abweichen
const AUSNAHMEN = {
  // Der Menuepunkt heisst knapp, die Seite spricht den ganzen Bereich an
  '/': 'Übersicht ist Dashboard, der Titel nennt denselben Bereich',
  '/accounts': 'Menü: "Acc erstellen", Seite: "Acc erstellen / Account"',
  // Beides bezeichnet dieselbe Seite, nur anders formuliert
  '/gm': 'Menü: "Zeige GM Kommandos", Seite: "GM Kommandos"'
}

const zeilen = []
let fehler = 0

for (const e of nav) {
  const tDe = titelDe[e.pfad]
  const tEn = titelEn[e.pfad]

  if (!tDe) {
    zeilen.push({ ok: false, text: `${e.pfad.padEnd(14)} kein Seitentitel (page.${e.pfad})` })
    fehler++
    continue
  }
  if (!tEn) {
    zeilen.push({ ok: false, text: `${e.pfad.padEnd(14)} kein englischer Titel` })
    fehler++
    continue
  }

  // Menuebeschriftung aus der nav-Sektion holen
  const navDe = navTextLesen('de.js', e.key)
  const navEn = navTextLesen('en.js', e.key)

  if (navDe && tDe !== navDe && !AUSNAHMEN[e.pfad]) {
    zeilen.push({ ok: false, text: `${e.pfad.padEnd(14)} Menü "${navDe}" ≠ Titel "${tDe}"` })
    fehler++
    continue
  }
  if (navEn && tEn !== navEn && !AUSNAHMEN[e.pfad]) {
    zeilen.push({ ok: false, text: `${e.pfad.padEnd(14)} EN Menü "${navEn}" ≠ Titel "${tEn}"` })
    fehler++
    continue
  }

  // Titel doppelt vergeben? Zwei Seiten mit demselben Titel verwirren.
  const doppelt = Object.keys(titelDe).filter(k => titelDe[k] === tDe && k !== e.pfad)
  if (doppelt.length) {
    zeilen.push({ ok: false, text: `${e.pfad.padEnd(14)} Titel "${tDe}" auch bei ${doppelt.join(', ')}` })
    fehler++
    continue
  }

  zeilen.push({ ok: true, text: `${e.pfad.padEnd(14)} ${tDe}` })
}

// Beschriftung aus dem nav-Block einer Sprachdatei
function navTextLesen (datei, key) {
  const s = fs.readFileSync(path.join(WURZEL, 'src', 'i18n', datei), 'utf8')
  const start = s.indexOf('nav: {')
  if (start < 0) return null
  const block = s.slice(start, start + 900)
  const m = new RegExp(`\\b${key}\\s*:\\s*'((?:[^'\\\\]|\\\\')*)'`).exec(block)
  return m ? m[1] : null
}

for (const z of zeilen) {
  console.log(`${z.ok ? 'OK   ' : 'FEHLT'}  ${z.text}`)
}

const ausnahmen = Object.entries(AUSNAHMEN)
if (ausnahmen.length) {
  console.log('\nAusnahmen (bewusst abweichend):')
  ausnahmen.forEach(([p, w]) => console.log(`  ${p.padEnd(14)} ${w}`))
}

console.log(`\n${nav.length - fehler}/${nav.length} Seitentitel passen zum Menü`)
process.exit(fehler ? 1 : 0)