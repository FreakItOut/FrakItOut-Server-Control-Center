// Sucht Reste, die im Produktivcode nichts zu tun haben:
//   - Exporte, die nirgends aufgerufen werden
//   - console.log/console.debug in Electron- und Seitencode
//   - fest verdrahtete absolute Pfade
//
// Kein Ersatz fuer einen Test - eher eine Checkliste, die man vor dem
// Ausliefern abhakt.
'use strict'

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

const lauf = (dir, end) => {
  const r = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'release', '.git'].includes(e.name)) continue
      r.push(...lauf(p, end))
    } else if (end.test(e.name)) r.push(p)
  }
  return r
}

const relativ = f => f.replace(WURZEL + path.sep, '')

const treffer = []
const merke = (art, wo, was) => treffer.push({ art, wo, was })

// ---------------------------------------------------------- 1) tote Exporte
const backend = lauf(path.join(WURZEL, 'electron'), /\.js$/)
const allesBackend = backend.map(f => fs.readFileSync(f, 'utf8')).join('\n')
// auch index.js und preload.js als Aufrufer mitzaehlen
const aufrufer = backend
  .filter(f => !f.endsWith(path.join('api', 'index.js')))
  .map(f => fs.readFileSync(f, 'utf8')).join('\n')
const renderer = lauf(path.join(WURZEL, 'src'), /\.(js|jsx)$/).map(f => fs.readFileSync(f, 'utf8')).join('\n')
// Die Pruefskripte unter scripts/ sind auch Aufrufer. Ohne sie meldet der
// Pruefer Konstanten als tot, die nur ein verify-*.js benutzt - etwa
// TEMPLATE und MAX_BOTS aus bots.js.
// Ein Pruefskript, das das Modul selbst laedt, zaehlt als Aufrufer.
// Geprueft wird je Datei und ueber den ganzen Rest der Datei, nicht nur
// bis zum naechsten require - "bots.MAX_BOTS" steht hundert Zeilen unter
// dem require, nicht darunter.
const testDateien = lauf(path.join(WURZEL, 'scripts'), /\.js$/)
  .filter(f => f !== __filename)
  .map(f => ({ f, s: fs.readFileSync(f, 'utf8') }))

const vonTestGenutzt = (modulName, name) => testDateien.some(({ f, s }) => {
  // "require('../electron/api/bots')" ohne Endung ist genauso ueblich wie
  // "require('...bots.js')" - deshalb ist die Endung optional.
  const laedt = new RegExp('\\brequire\\([^)]*/?' + modulName.replace(/\.js$/, '') + '(?:\\.js)?[\'"]')
  if (!laedt.test(s)) return false
  return new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b').test(s)
})

for (const f of backend) {
  const s = fs.readFileSync(f, 'utf8')
  const m = s.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\}/)
  if (!m) continue
  for (const roh of m[1].split(',')) {
    const name = roh.split(':')[0].trim()
    if (!name || name.startsWith('//')) continue
    // Verschachtelte Objekte (z.B. __intern: { ... }) ueberspringen - sonst
    // meldet der Pruefer den Inhalt eines Wertes als eigenen Export und
    // faehrt Fehlalarme wie bei "cwdFor }".
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
    const eigenerName = path.basename(f, '.js')
    // Aufruf als x(...) oder als Objekt-Schluessel
    const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\s*\\(')
    const alsSchluessel = new RegExp('["\']?' + name + '["\']?\\s*:')
    // Ein Pruefskript, das das Modul selbst laedt, zaehlt als Aufrufer.
    // Dort reicht schon eine Nennung des Namens - der Zugriff laeuft meist
    // ueber "bots.TEMPLATE" statt ueber einen Objekt-Schluessel.
    if (re.test(aufrufer) || alsSchluessel.test(aufrufer) || alsSchluessel.test(renderer)) continue
    if (vonTestGenutzt(eigenerName, name)) continue
    if (new RegExp('\\b' + name + '\\b').test(allesBackend.replace(s, ''))) continue
    merke('Export ohne Aufruf', relativ(f), name)
  }
}

// ---------------------------------------------------------- 2) Debug-Ausgaben
for (const f of [...backend, ...lauf(path.join(WURZEL, 'src'), /\.(js|jsx)$/)]) {
  const z = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  z.forEach((zeile, i) => {
    // console.log ist in Electron vertretbar (Protokoll), console.debug nicht
    if (/console\.(debug|dir|trace)\s*\(/.test(zeile)) {
      merke('Debug-Ausgabe', relativ(f), `Z${i + 1}: ${zeile.trim().slice(0, 70)}`)
    }
    if (/debugger\b/.test(zeile)) {
      merke('debugger', relativ(f), `Z${i + 1}`)
    }
  })
}

// ---------------------------------------------------------- 3) absolute Pfade
for (const f of backend) {
  const z = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  z.forEach((zeile, i) => {
    const m = /(['"])([A-Za-z]:\\[^'"]*)\1/.exec(zeile)
    if (m) merke('Absoluter Pfad', relativ(f), `Z${i + 1}: ${m[2]}`)
  })
}

// ---------------------------------------------------------- 4) TODO/FIXME
for (const f of [...backend, ...lauf(path.join(WURZEL, 'src'), /\.(js|jsx)$/)]) {
  const z = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  z.forEach((zeile, i) => {
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(zeile)) {
      merke('TODO', relativ(f), `Z${i + 1}: ${zeile.trim().slice(0, 70)}`)
    }
  })
}

if (!treffer.length) {
  console.log('Keine toten Exporte, keine Debug-Reste, keine absoluten Pfade, keine TODOs.')
} else {
  let letzteArt = ''
  for (const t of treffer) {
    if (t.art !== letzteArt) { console.log(`\n=== ${t.art} ===`); letzteArt = t.art }
    console.log(`  ${t.wo.padEnd(30)} ${t.was}`)
  }
  console.log(`\n${treffer.length} Fundstellen`)
}
process.exit(0)