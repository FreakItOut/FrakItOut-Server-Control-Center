// Vergleicht alle call('route') im Renderer mit den Routen im Backend.
// Findet Aufrufe, deren Route es nicht gibt - die fallen im Betrieb mit
// "x.y is not a function" auf, nicht beim Start.
const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

// --- Routen im Backend einsammeln ---
const apiIndex = fs.readFileSync(path.join(WURZEL, 'electron', 'api', 'index.js'), 'utf8')
const routen = new Set()
for (const m of apiIndex.matchAll(/^\s*'([a-zA-Z]+\.[a-zA-Z]+)':/gm)) routen.add(m[1])

// --- Aufrufe im Renderer einsammeln ---
function walk (dir, treffer = []) {
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, eintrag.name)
    if (eintrag.isDirectory()) walk(f, treffer)
    else if (/\.jsx?$/.test(eintrag.name)) {
      const zeilen = fs.readFileSync(f, 'utf8').split(/\r?\n/)
      zeilen.forEach((zeile, i) => {
        for (const m of zeilenMatch(zeile)) treffer.push({ datei: f, zeile: i + 1, route: m })
      })
    }
  }
  return treffer
}
function zeilenMatch (zeile) {
  const out = []
  const rx = /\bcall\(\s*'([a-zA-Z]+\.[a-zA-Z]+)'/g
  let m
  while ((m = rx.exec(zeile))) out.push(m[1])
  return out
}

const aufrufe = walk(path.join(WURZEL, 'src'))
const fehlend = aufrufe.filter(a => !routen.has(a.route))

// --- Umgekehrt: Routen ohne Aufruf (nur Hinweis, kein Fehler) ---
const benutzt = new Set(aufrufe.map(a => a.route))
const unbenutztRouten = [...routen].filter(r => !benutzt.has(r))

console.log(`Routen im Backend : ${routen.size}`)
console.log(`Aufrufe im Renderer: ${aufrufe.length} (${benutzt.size} verschiedene)`)

if (fehlend.length) {
  console.log(`\n--- ${fehlend.length} Aufrufe OHNE passende Backend-Route ---`)
  for (const f of fehlend) console.log(`  ${f.route}  ${path.relative(WURZEL, f.datei)}:${f.zeile}`)
} else {
  console.log('\nAlle Renderer-Aufrufe haben eine Backend-Route.')
}

if (unbenutztRouten.length) {
  console.log(`\n--- ${unbenutztRouten.length} Routen ohne Aufruf im Renderer (nur Hinweis) ---`)
  for (const r of unbenutztRouten) console.log('  ' + r)
}

if (fehlend.length) process.exitCode = 1