// Prueft, ob Fehlermeldungen auf die RICHTIGE Menue-Seite verweisen.
//
// Das ist keine Kosmetik: ein Hinweis, der ins Leere zeigt, kostet den
// Nutzer eine Suche. Ausgangsproblem war eine Meldung, die auf
// "Connect Optionen -> Datenbank-Server" verwies, obwohl das Feld unter
// "Einstellungen" liegt.
//
// Warum das leicht falsch geht: Connect Optionen (/settings) enthaelt
// bewusst NUR die IP-Adresse. Alles andere - Datenbankverbindung,
// Server-Pfade, mysqld.exe, SOAP - liegt unter Einstellungen (/options).
const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

// Wo liegt was wirklich? Aus der Navigation in src/App.jsx abgeleitet.
const SEITEN = {
  settings: {
    alias: ['connect optionen', 'connect options'],
    inhalt: /\bip\b|adresse|realm.*adresse|bindip/i
  },
  options: {
    alias: ['einstellungen', 'settings'],
    inhalt: /datenbank|mysql|maria|mysqld|server-pfade|server paths|weltordner|worldserver\.exe|authserver\.exe|seifen|soap|arbeitsverzeichnis/i
  }
}

// Themen, die eindeutig zu "Einstellungen" gehoeren
const NUR_OPTIONS = /mysqld?\b|mysqldump|maria|datenbank|database|server-pfade|server paths|worldserver\.exe|authserver\.exe|arbeitsverzeichnis|working directory|seifen|soap/i
// Themen, die eindeutig zu "Connect Optionen" gehoeren
const NUR_SETTINGS = /\bip\b|ip-adresse|ip address|bindip/i

/*
 * Erkennt den Seitennamen nur als eigenes Wort - und nicht, wenn er Teil
 * eines zusammengesetzten Begriffs ist. Sonst haelt der Pruefer
 * "Lade IP-Einstellungen" fuer einen Verweis auf die Menue-Seite
 * "Einstellungen", obwohl die IP-Seite gemeint ist.
 */
function nennt (text, alias) {
  for (const a of alias) {
    const m = new RegExp(`(^|[^\\w-])${a}\\b`, 'i').exec(text)
    if (!m) continue
    // Unmittelbar davor darf kein "IP" stehen
    const davor = text.slice(Math.max(0, m.index - 4), m.index).toLowerCase()
    if (/\bip[\s-]?$/.test(davor)) continue
    return true
  }
  return false
}

const MUSTER = /(['"`])([^'"`\n]{12,300})\1/g

function sammle (datei) {
  const out = []
  const z = fs.readFileSync(datei, 'utf8').split(/\r?\n/)
  z.forEach((zeile, i) => {
    for (const m of zeile.matchAll(MUSTER)) {
      const text = m[2]
      // Kommentare ausblenden
      if (/^\s*(\/\/|\*|#)/.test(zeile) && !/throw|:\s*$/.test(zeile)) {
        // Kommentarzeilen duerfen Text enthalten, werden aber nicht geprueft
        const istNurKommentar = /^\s*(\/\/|\*|\/\*)/.test(zeile)
        if (istNurKommentar && !/=\s*['"`]/.test(zeile)) continue
      }
      out.push({ datei, zeile: i + 1, text })
    }
  })
  return out
}

function walk (dir, endungen, treffer = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'release') continue
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, endungen, treffer)
    else if (endungen.some(x => e.name.endsWith(x))) treffer.push(f)
  }
  return treffer
}

const dateien = [
  ...walk(path.join(WURZEL, 'src', 'i18n'), ['.js']),
  ...walk(path.join(WURZEL, 'electron'), ['.js'])
]

const befunde = []

for (const datei of dateien) {
  const relativ = path.relative(WURZEL, datei)
  const istBackend = relativ.startsWith('electron')

  for (const { zeile, text } of sammle(datei)) {
    // Seitentitel und Navigationsbeschriftungen selbst sind keine Verweise
    if (/^(Connect Optionen|Connect Options|Einstellungen|Settings)$/.test(text.trim())) continue
    if (/\/(settings|options)'?\]?\s*$/.test(text)) continue

    const nenntConnect = nennt(text, SEITEN.settings.alias)
    const nenntOptions = nennt(text, SEITEN.options.alias)
    if (!nenntConnect && !nenntOptions) continue

    // "Einstellungen -> MySQL-Verbindung" ist korrekt, "Connect Optionen ->
    // Datenbank-Server" nicht.
    if (nenntConnect && NUR_OPTIONS.test(text)) {
      befunde.push({
        datei: relativ,
        zeile,
        text,
        grund: 'verweist auf Connect Optionen, nennt aber etwas aus "Einstellungen"'
      })
    }
    if (nenntOptions && NUR_SETTINGS.test(text)) {
      befunde.push({
        datei: relativ,
        zeile,
        text,
        grund: 'verweist auf Einstellungen, nennt aber etwas aus "Connect Optionen"'
      })
    }
  }
}

console.log('Gepruefte Dateien: ' + dateien.length)
console.log('Connect Optionen = nur IP · Einstellungen = Datenbank, Pfade, mysqld, SOAP\n')

if (!befunde.length) {
  console.log('Alle Verweise zeigen auf die richtige Seite.')
  process.exitCode = 0
} else {
  for (const b of befunde) {
    console.log(`  ${b.datei}:${b.zeile}`)
    console.log(`    ${b.grund}`)
    console.log(`    "${b.text.replace(/\s+/g, ' ').slice(0, 160)}"`)
    console.log('')
  }
  console.log(`${befunde.length} Verweis(e) auf die falsche Seite`)
  process.exitCode = 1
}
