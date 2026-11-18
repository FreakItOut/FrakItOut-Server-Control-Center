// Prueft die showOpenDialog-Optionen im Projekt gegen die echten
// Electron-Typen. Ungueltige properties werden von Electron stillschweigend
// ignoriert - dann zeigt der Ordnerdialog stattdessen einen Dateidialog.
const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')
const TYPEN = path.join(WURZEL, 'node_modules', 'electron', 'electron.d.ts')

if (!fs.existsSync(TYPEN)) {
  console.error('electron.d.ts nicht gefunden - Pruefung uebersprungen.')
  process.exit(0)
}

// Zulaessige properties aus den Typen ziehen
const dts = fs.readFileSync(TYPEN, 'utf8')
const roh = /properties\??:\s*Array<([\s\S]*?)>/.exec(dts)
if (!roh) {
  console.error('Property-Liste in den Typen nicht gefunden.')
  process.exit(0)
}
const erlaubt = new Set(
  (roh[1].match(/'([^']+)'/g) || []).map(m => m.replace(/'/g, ''))
)
if (!erlaubt.size) {
  console.error('Property-Liste leer - Pruefung uebersprungen.')
  process.exit(0)
}
console.log('Zulaessige properties laut Electron: ' + [...erlaubt].join(', '))

// Im Projekt verwendete properties einsammeln
function walk (dir, treffer = []) {
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, eintrag.name)
    if (eintrag.isDirectory()) walk(f, treffer)
    else if (eintrag.name.endsWith('.js')) treffer.push(f)
  }
  return treffer
}

const dateien = walk(path.join(WURZEL, 'electron'))
let fehler = 0
let geprueft = 0

for (const datei of dateien) {
  const zeilen = fs.readFileSync(datei, 'utf8').split(/\r?\n/)
  zeilen.forEach((zeile, i) => {
    const m = /properties:\s*\[([^\]]*)\]/.exec(zeile)
    if (!m) return
    const werte = (m[1].match(/'([^']+)'/g) || []).map(x => x.replace(/'/g, ''))
    if (!werte.length) return
    geprueft++
    const ungueltig = werte.filter(w => !erlaubt.has(w))
    if (ungueltig.length) {
      fehler++
      console.log(`  FEHLER  ${path.relative(WURZEL, datei)}:${i + 1}`)
      console.log(`          verwendet: ${werte.join(', ')}`)
      console.log(`          ungueltig: ${ungueltig.join(', ')}`)
    } else {
      console.log(`  OK      ${path.relative(WURZEL, datei)}:${i + 1}  ${werte.join(', ')}`)
    }
  })
}

console.log(`\n${geprueft} properties-Angaben geprueft, ${fehler} fehlerhaft`)
process.exitCode = fehler ? 1 : 0