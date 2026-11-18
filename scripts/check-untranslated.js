// Findet deutsche Texte, die NICHT uebersetzt wurden.
//
// Ansatz: aus jeder Zeile zuerst alle t(...)-Aufrufe entfernen. Was danach
// noch deutsche Woerter enthaelt, wird vermutlich fest angezeigt.
const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

const WOERTER = /\b(Speichern|Abbrechen|Zurücksetzen|Suchen|Übersicht|Anlegen|Ändern|Löschen|Aktualisieren|Serverstatus|Aktuell|Spieler|Charaktere|Klasse|Rasse|Stufe|Spielzeit|Zone|Abstand|Standard|Wert|Typ|Fehler|Erfolg|Verbindung|Testen|Bitte|Keine|Einstellung|Datenbank|Nicht|nicht|ist|werden|müssen|können|läuft|gelöst|gefunden|erreichbar|Abmelden|Sperre|Gebannt|Grund|Dauer|Gültig|Meldung|Bestätigen|Weiter|Zurück|Alle|Einstellungen|Bot|Raten|Konfiguration|Zeilen|Erklärung)\b/g

// Kommentare entfernen - auch mehrzeilige.
//
// Wichtig: das muss ueber den GANZEN Dateitext laufen, nicht zeilenweise.
// Ein JSX-Kommentar {/\* ... \*/} steht ueber mehrere Zeilen; wenn man ihn
// Zeile fuer Zeile prueft, passt das Muster nie und die mittleren Zeilen
// werden faelschlich als deutscher Festtext gemeldet.
//
// Kommentarinhalt wird durch Leerzeichen ersetzt, Newlines bleiben - so
// stimmen die Zeilennummern in der Ausgabe weiterhin.
function ohneKommentare (text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const zwei = text.substr(i, 2)
    if (zwei === '/*') {
      const ende = text.indexOf('*/', i + 2)
      const stop = ende === -1 ? text.length : ende + 2
      for (let k = i; k < stop; k++) out += text[k] === '\n' ? '\n' : ' '
      i = stop
    } else if (zwei === '//') {
      const nl = text.indexOf('\n', i)
      const stop = nl === -1 ? text.length : nl
      out += ' '.repeat(stop - i)
      i = stop
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

// Woerter, die als technische Bezeichner erlaubt sind
const TECHNIK = /^(Spieler)$/ // Kommando-Syntax in GmTools

function walk (dir, treffer = []) {
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, eintrag.name)
    if (eintrag.isDirectory()) walk(f, treffer)
    else if (/\.jsx$/.test(eintrag.name)) treffer.push(f)
  }
  return treffer
}

// t('...' , {...}) und t(`...`) inkl. Argumenten entfernen
function ohneT (zeile) {
  let out = zeile
  let gewechselt = true
  while (gewechselt) {
    gewechselt = false
    const m = /\bt\((['"`])/.exec(out)
    if (!m) break
    const start = m.index
    const quote = m[1]
    let i = start + 2
    let tiefe = 1
    while (i < out.length) {
      const c = out[i]
      if (c === '(') tiefe++
      else if (c === ')') { tiefe--; if (tiefe === 0) { i++; break } }
      i++
    }
    out = out.slice(0, start) + ' '.repeat(i - start) + out.slice(i)
    gewechselt = true
  }
  return out
}

const dateien = walk(path.join(WURZEL, 'src'))
let anzahl = 0
const proDatei = {}

for (const datei of dateien) {
  // Kommentare einmal ueber die ganze Datei entfernen, dann zeilenweise pruefen
  const zeilen = ohneKommentare(fs.readFileSync(datei, 'utf8')).split(/\r?\n/)
  zeilen.forEach((zeile, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(zeile)) return
    const rest = ohneT(zeile)
    const gefunden = (rest.match(WOERTER) || []).filter(w => !TECHNIK.test(w))
    if (gefunden.length) {
      anzahl++
      proDatei[path.relative(WURZEL, datei)] = proDatei[path.relative(WURZEL, datei)] || []
      proDatei[path.relative(WURZEL, datei)].push({
        zeile: i + 1,
        woerter: [...new Set(gefunden)],
        text: zeile.trim().slice(0, 120)
      })
    }
  })
}

for (const [datei, funde] of Object.entries(proDatei)) {
  console.log('\n=== ' + datei + ' (' + funde.length + ' Zeilen) ===')
  for (const f of funde) {
    console.log('  ' + String(f.zeile).padStart(4) + '  ' + f.woerter.join(', '))
    console.log('        ' + f.text)
  }
}

console.log('\nGESAMT: ' + anzahl + ' Zeilen mit vermutlich deutschem Festtext')
process.exitCode = anzahl ? 1 : 0