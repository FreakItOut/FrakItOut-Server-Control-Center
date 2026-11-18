// Sucht nach der Falle "zwei Schreibzugriffe auf denselben Schluessel".
//
// In einem Objektliteral ueberschreibt ein spaeterer Spread denselben
// Schluessel stillschweigend:
//   { server: {...a}, ...(x ? { server: {...a, b:1} } : {}) }
// Der zweite Teil gewinnt - und macht dabei die zuerst gesetzten Werte
// wieder rueckgaengig. Genau das ist im Assistenten passiert.
const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

function walk (dir, treffer = []) {
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, eintrag.name)
    if (eintrag.isDirectory()) walk(f, treffer)
    else if (/\.jsx?$/.test(eintrag.name)) treffer.push(f)
  }
  return treffer
}

const dateien = walk(path.join(WURZEL, 'src'))
let befunde = 0

for (const datei of dateien) {
  const zeilen = fs.readFileSync(datei, 'utf8').split(/\r?\n/)

  zeilen.forEach((zeile, i) => {
    // Ein Objectliteral, das sich ueber mehrere Zeilen erstreckt
    const start = /set\w*\(\s*\w*\s*=>\s*\(\{|=\s*\{/.exec(zeile)
    if (!start) return

    // Bis zur schliessenden Klammer zusammensammeln (maximal 60 Zeilen)
    let tiefe = 0
    let Text = ''
    let endZeile = i
    for (let j = i; j < Math.min(i + 60, zeilen.length); j++) {
      Text += zeilen[j] + '\n'
      for (const c of zeilen[j]) {
        if (c === '{') tiefe++
        else if (c === '}') tiefe--
      }
      endZeile = j
      if (tiefe <= 0 && j > i) break
    }

    // Alle Schluessel einsammeln. Nur Schluessel mit Doppelpunkt zaehlen -
    // sonst greift das Muster auch auf Destrukturierung wie { a, b }.
    const direkt = new Set()
    for (const m of Text.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)) direkt.add(m[1])

    const spreads = []
    for (const m of Text.matchAll(/\.\.\.\(([^)]*)\?\s*\{([\s\S]{0,400}?)\}\s*:\s*\{\}\)/g)) {
      for (const k of (m[2].match(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g) || [])) {
        const name = k.replace(/[{,:\s]/g, '')
        if (name) spreads.push(name)
      }
    }

    // Schluessel, die sowohl direkt als auch ueber einen Spread gesetzt werden
    const doppelt = [...direkt].filter(k => spreads.includes(k))
    if (doppelt.length) {
      befunde++
      console.log(`\n  ${path.relative(WURZEL, datei)}:${i + 1}-${endZeile + 1}`)
      console.log(`    doppelt gesetzt: ${doppelt.join(', ')}`)
      console.log('    -> der spaetere Eintrag gewinnt, der fruehere wird verworfen')
      console.log('    ' + zeilen[i].trim().slice(0, 100))
    }
  })
}

console.log(befunde ? `\n${befunde} Fundstellen mit mehrfacher Schluesselvergabe` : '\nKeine mehrfache Schluesselvergabe gefunden')
process.exitCode = befunde ? 1 : 0