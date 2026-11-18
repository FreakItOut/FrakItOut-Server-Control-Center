// Prueft, ob die gebaute EXE wirklich den aktuellen Stand enthaelt.
//
// Nur ein Abgleich auf der Platte beweist nichts: electron-builder packt das
// Backend in ein app.asar und den Renderer als Minified-Bundle. Beides wird
// hier direkt aus dem FERTIGEN Paket gelesen, nicht aus dem Quellverzeichnis.
//
// extractFile() verweigert hier jede Pfadform (mit und ohne fuehrenden
// Schraegstrich), deshalb wird das Archiv einmal komplett in ein
// Temp-Verzeichnis entpackt und von dort gelesen.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const asar = require('@electron/asar')

const asarPfad = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar')

if (!fs.existsSync(asarPfad)) {
  console.log(`Paket nicht gefunden: ${asarPfad}`)
  console.log('Zuerst "npm run dist" ausfuehren.')
  process.exit(1)
}

const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-'))
const schritte = []
const merke = (ok, name, zusatz) => schritte.push({ ok, name, zusatz: zusatz || '' })

try {
  asar.extractAll(asarPfad, ziel)
} catch (e) {
  console.log(`Entpacken fehlgeschlagen: ${e.message}`)
  process.exit(1)
}

const lies = (...teile) => {
  const p = path.join(ziel, ...teile)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

// ---------- Backend: echter Quelltext, Zeile fuer Zeile pruefbar ----------
const backend = {
  'backup.js': lies('electron', 'api', 'backup.js'),
  'store.js': lies('electron', 'store.js'),
  'index.js': lies('electron', 'api', 'index.js'),
  'main.js': lies('electron', 'main.js')
}

const PRUEFUNGEN = [
  ['backup.js', /require\('zlib'\)/, 'Backend laedt zlib'],
  ['backup.js', /const TRENNER = '__'/, 'Dateinamen-Trenner fuer die Datenbank'],
  ['backup.js', /createGzip/, 'Komprimierung beim Sichern'],
  ['backup.js', /createGunzip/, 'Entpacken beim Wiederherstellen'],
  ['backup.js', /planStarten/, 'Zeitplan wird gestartet'],
  ['backup.js', /planStoppen/, 'Zeitplan wird gestoppt'],
  ['backup.js', /function aufraeumen/, 'Aufraeumen vorhanden'],
  ['backup.js', /automatischSichern/, 'automatischer Lauf vorhanden'],
  ['store.js', /intervalHours/, 'Intervall in der Konfiguration'],
  ['store.js', /compress/, 'Komprimierung in der Konfiguration'],
  ['store.js', /keep/, 'Aufbewahrung in der Konfiguration'],
  ['index.js', /backup\.runNow/, 'Route fuer sofortigen Lauf'],
  ['index.js', /backup\.prune/, 'Route fuer Aufraeumen'],
  ['main.js', /planStarten/, 'Zeitplan haengt am Programmstart']
]

for (const [datei, muster, was] of PRUEFUNGEN) {
  const inhalt = backend[datei]
  if (inhalt === null) { merke(false, was, `${datei} nicht im Paket`); continue }
  merke(muster.test(inhalt), was, datei)
}

// Der Renderer liegt als EINE riesige Zeile im Bundle. Zeilenweise pruefen
// bringt hier nichts - der ganze Text wird durchsucht.
const assetOrdner = path.join(ziel, 'renderer', 'assets')
const bundles = fs.existsSync(assetOrdner)
  ? fs.readdirSync(assetOrdner).filter(n => /^index-.*\.js$/.test(n))
  : []

if (!bundles.length) {
  merke(false, 'Renderer-Bundle im Paket', 'kein renderer/assets/index-*.js')
} else {
  const inhalt = bundles.map(n => fs.readFileSync(path.join(assetOrdner, n), 'utf8')).join('\n')
  /*
   * Wichtig: das Bundle maskiert Umlaute (\u00fc). Deshalb werden keine
   * deutschen Texte mit Umlaut gesucht - die stehen im Bundle nicht als "ü".
   * Das war schon einmal die Ursache eines Fehlalarms.
   */
  const rendererMuster = [
    [/Automatische Sicherung/, 'Zeitplan-Karte'],
    [/Vorhandene Sicherungen/, 'Sicherungsliste'],
    [/Alles wiederherstellen/, 'Komplett-Wiederherstellen'],
    [/Nur diese/, 'Einzel-Wiederherstellen'],
    [/Aufbewahren/, 'Aufbewahrungsgrenze'],
    [/Komprimieren/, 'Komprimierung'],
    // steht so in beiden Sprachfassungen, ohne Umlaut
    [/\(Auth, Characters/, 'neuer Sicherungstext (je Datei)'],
    [/Nur die Datenbank \{db\} wird wiederhergestellt/, 'Einzel-Wiederherstellen benennt die Datenbank']
  ]
  for (const [muster, was] of rendererMuster) {
    merke(muster.test(inhalt), 'Renderer: ' + was)
  }
  // Der lesbare Zeitstempel wird zur Laufzeit zusammengesetzt, steht also
  // nicht als Text im Bundle. Beweisbar ist hier nur das Gegenteil: die
  // alte Ersetzung "Unterstriche durch Leerzeichen" darf nicht mehr drin sein,
  // denn genau die hat den Roh-Zeitstempel hinten angehaengt.
  merke(!/replace\(_\/g/.test(inhalt), 'Renderer: Zeitstempel nicht mehr roh angehaengt')
  merke(!/3 Datei\b/.test(inhalt), 'Renderer: Plural bei Dateianzahl sauber')
}

let ok = 0
for (const s of schritte) {
  console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
  if (s.ok) ok++
}
console.log(`\n${ok}/${schritte.length} Kennzeichen im fertigen Paket gefunden`)

fs.rmSync(ziel, { recursive: true, force: true })
process.exit(ok === schritte.length ? 0 : 1)