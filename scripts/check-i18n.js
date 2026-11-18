// Prueft, ob Deutsch und Englisch dieselben Schluessel enthalten.
//
//   node scripts/check-i18n.js
//
// Beendet sich mit Code 1, wenn Schluessel fehlen oder zu viel vorhanden sind -
// damit laesst es sich als Qualitaetssicherung in den Build haengen.
const fs = require('fs')
const path = require('path')
const os = require('os')
const esbuild = require('esbuild')

const WURZEL = path.join(__dirname, '..')
const I18N = path.join(WURZEL, 'src', 'i18n')
const TEILE = path.join(I18N, 'parts')

// Eine ESM-Datei nach CJS uebersetzen und auswerten
function lade (datei) {
  const queltext = fs.readFileSync(datei, 'utf8')
  const { code } = esbuild.transformSync(queltext, { loader: 'js', format: 'cjs', target: 'node18' })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'))
  const tmp = path.join(tmpDir, path.basename(datei))
  fs.writeFileSync(tmp, code)
  try {
    delete require.cache[tmp]
    return require(tmp).default || require(tmp)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function merge (ziel, quelle) {
  for (const key of Object.keys(quelle || {})) {
    const q = quelle[key]
    if (q && typeof q === 'object' && !Array.isArray(q)) {
      if (!ziel[key] || typeof ziel[key] !== 'object' || Array.isArray(ziel[key])) ziel[key] = {}
      merge(ziel[key], q)
    } else if (q !== undefined) {
      ziel[key] = q
    }
  }
  return ziel
}

// Arrays zaehlen als EIN Schluessel - ihr Inhalt wird nur ueber die Laenge
// verglichen, damit derselbe Schluessel in beiden Sprachen als gleich gilt.
function flatten (obj, prefix = '', out = [], laengen = new Map()) {
  for (const key of Object.keys(obj || {})) {
    const wert = obj[key]
    const p = prefix ? `${prefix}.${key}` : key
    if (wert && typeof wert === 'object' && !Array.isArray(wert)) flatten(wert, p, out, laengen)
    else {
      out.push(p)
      laengen.set(p, Array.isArray(wert) ? wert.length : 0)
    }
  }
  return { keys: out, laengen }
}

const dicts = { de: merge({}, lade(path.join(I18N, 'de.js'))), en: merge({}, lade(path.join(I18N, 'en.js'))) }

if (fs.existsSync(TEILE)) {
  const dateien = fs.readdirSync(TEILE).filter(f => f.endsWith('.js'))
  for (const datei of dateien) {
    const teil = lade(path.join(TEILE, datei))
    if (!teil || (!teil.de && !teil.en)) {
      console.error(`FEHLER  ${datei}: exportiert weder 'de' noch 'en'.`)
      process.exitCode = 1
      continue
    }
    if (teil.de) merge(dicts.de, teil.de)
    if (teil.en) merge(dicts.en, teil.en)
    if (!teil.de || !teil.en) {
      console.error(`FEHLER  ${datei}: nur eine Sprache vorhanden.`)
      process.exitCode = 1
    }
  }
  console.log(`Teildateien: ${dateien.length}`)
}

const de = flatten(dicts.de)
const en = flatten(dicts.en)
const deKeys = new Set(de.keys)
const enKeys = new Set(en.keys)

const nurDe = [...deKeys].filter(k => !enKeys.has(k))
const nurEn = [...enKeys].filter(k => !deKeys.has(k))

console.log(`Schluessel gesamt:  de=${deKeys.size}  en=${enKeys.size}`)
console.log(`Nur auf Deutsch:    ${nurDe.length}`)
console.log(`Nur auf Englisch:   ${nurEn.length}`)

if (nurDe.length) {
  console.log('\n--- fehlende englische Uebersetzungen ---')
  for (const k of nurDe) console.log('  ' + k)
}
if (nurEn.length) {
  console.log('\n--- Schluessel ohne deutschen Gegenwert ---')
  for (const k of nurEn) console.log('  ' + k)
}

// Arrays muessen gleich viele Eintraege haben, sonst fehlen Optionen
let laengenFehler = 0
for (const k of deKeys) {
  if (!enKeys.has(k)) continue
  const a = de.laengen.get(k)
  const b = en.laengen.get(k)
  if (a !== b) {
    console.log(`  ACHTUNG  ${k}: de hat ${a} Eintraege, en hat ${b}`)
    laengenFehler++
  }
}

if (nurDe.length || nurEn.length || laengenFehler) {
  console.log('\nERGEBNIS: inkonsistent')
  process.exitCode = 1
} else {
  console.log('\nERGEBNIS: konsistent - beide Sprachen decken sich')
}

// ---------- Aufrufstellen pruefen ----------
// Jedes t('…') und t(`…`) im Quelltext muss in BEIDEN Sprachen aufloesbar
// sein. Sonst steht im Bildschirm ein roher Schluessel.
function sammleAufrufe (dir, gefundene = [], praefixe = new Set(), literale = new Set()) {
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, eintrag.name)
    if (eintrag.isDirectory()) {
      // Das i18n-Verzeichnis selbst enthaelt nur Beispiele, keine Aufrufe
      if (eintrag.name === 'i18n') continue
      sammleAufrufe(f, gefundene, praefixe, literale)
    } else if (/\.jsx?$/.test(eintrag.name)) {
      const zeilen = fs.readFileSync(f, 'utf8').split(/\r?\n/)
      zeilen.forEach((zeile, i) => {
        const rx = /\bt\(\s*'([^']+)'/g
        let m
        while ((m = rx.exec(zeile))) gefundene.push({ datei: f, zeile: i + 1, key: m[1] })
        // Dynamische Aufrufe t(`prefix.${x}`) - den statischen Anfang merken
        const dyn = /\bt\(\s*`([^`$]*)\$\{/g
        while ((m = dyn.exec(zeile))) praefixe.add(m[1])
        // Schluessel, die als vollstaendiger String in einer Datenstruktur
        // stehen und spaeter ueber t(variable) aufgeloest werden:
        //   { labelKey: 'console.presetInfo' }
        //   const stateKey = { idle: 'serverControl.stateWaiting' }
        //   txt(t, `constants.class.${id}`) in constants.js
        for (const lit of zeile.matchAll(/'([a-zA-Z][\w]*(?:\.[\w]+){1,4})'/g)) {
          literale.add(lit[1])
        }
        const dyn2 = /`([a-zA-Z][\w]*(?:\.[\w]+)*)\.\$\{/g
        while ((m = dyn2.exec(zeile))) praefixe.add(m[1] + '.')
      })
    }
  }
  return { aufrufe: gefundene, praefixe, literale }
}

function loeseSchluessel (dict, key) {
  let cur = dict
  for (const teil of String(key).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = cur[teil]
  }
  return cur
}

const { aufrufe, praefixe, literale } = sammleAufrufe(path.join(WURZEL, 'src'))
const fehlend = []
const unbenutzt = new Set([...deKeys, ...enKeys])

for (const a of aufrufe) {
  unbenutzt.delete(a.key)
  const inDe = loeseSchluessel(dicts.de, a.key)
  const inEn = loeseSchluessel(dicts.en, a.key)
  if (inDe === undefined) fehlend.push(`${a.key}  (fehlt in de)  ${path.relative(WURZEL, a.datei)}:${a.zeile}`)
  else if (inEn === undefined) fehlend.push(`${a.key}  (fehlt in en)  ${path.relative(WURZEL, a.datei)}:${a.zeile}`)
}

// Schluessel, die als String (oder als dessen Praefix, etwa 'constants.class')
// in einer Datenstruktur stehen, gelten als benutzt
for (const key of [...unbenutzt]) {
  if ([...literale].some(lit => key === lit || key.startsWith(lit + '.'))) unbenutzt.delete(key)
}

console.log(`\nt()-Aufrufstellen: ${aufrufe.length}   dynamische Praefixe: ${[...praefixe].join(', ') || 'keine'}`)
if (fehlend.length) {
  console.log(`\n--- ${fehlend.length} Aufrufstellen ohne Aufloesung ---`)
  for (const f of fehlend) console.log('  ' + f)
}

// Ungenutzt: nur melden, wenn der Schluessel zu KEINER dynamischen Stelle
// passt - t(`constants.class.${id}`) sieht der Scanner nicht als Aufruf.
const praefixListe = [...praefixe]
const dynamisch = k => praefixListe.some(pre => k.startsWith(pre))
const rahmen = ['common.', 'app.', 'page.', 'nav.']
const tot = [...unbenutzt].filter(k => !rahmen.some(r => k.startsWith(r)) && !dynamisch(k))
if (tot.length) {
  console.log(`\n--- ${tot.length} Schluessel ohne erkennbare Verwendung ---`)
  for (const k of tot) console.log('  ' + k)
}

if (fehlend.length || nurDe.length || nurEn.length || laengenFehler) {
  process.exitCode = 1
}