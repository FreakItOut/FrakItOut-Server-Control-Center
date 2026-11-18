'use strict'

/*
 * Gleicht den SOAP-Zugang im Entwicklungsordner an den der ausgelieferten
 * EXE an.
 *
 * Aufruf: node scripts/gleicht-soap-ab.js
 *
 * Warum: Die Konfiguration unter %APPDATA% ist die, die der Start aus dem
 * Quelltext benutzt. Sie zeigte auf das Konto "adm", das in der Datenbank
 * nicht existiert - mit ihm antwortet der Core "401 Unauthorized", und
 * beim Pruefen der Oberflaeche sah es danach aus, als waere die Anzeige
 * der Befehlsausgabe kaputt.
 *
 * Kopiert wird nur der SOAP-Block. Alles andere bleibt, wie es ist. Das
 * Passwort wird nirgends ausgegeben.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const desktop = path.join(os.homedir(), 'Desktop', 'config.json')
const entwicklung = path.join(process.env.APPDATA, 'wowpanel', 'config.json')

function lies (p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (_) { return null }
}

const a = lies(desktop)
const b = lies(entwicklung)

if (!a) { console.log(`  FEHLER: ${desktop} nicht lesbar.`); process.exit(1) }
if (!b) { console.log(`  FEHLER: ${entwicklung} nicht lesbar.`); process.exit(1) }

console.log(`  Vorher  (Entwicklung): Port ${b.soap?.port}  Benutzer ${b.soap?.user}`)
console.log(`  Soll     (Desktop)   : Port ${a.soap?.port}  Benutzer ${a.soap?.user}`)
console.log('')

const gleich = JSON.stringify(a.soap) === JSON.stringify(b.soap)
if (gleich) {
  console.log('  Beide sind bereits gleich - nichts zu tun.')
  process.exit(0)
}

b.soap = { ...a.soap }
if (fs.existsSync(entwicklung)) {
  try { fs.copyFileSync(entwicklung, entwicklung + '.bak') } catch (_) {}
}
fs.writeFileSync(entwicklung, JSON.stringify(b, null, 2) + '\n', 'utf8')

const nach = lies(entwicklung)
console.log(`  Nachher (Entwicklung): Port ${nach.soap.port}  Benutzer ${nach.soap.user}`)
console.log(`  Sicherung: ${path.basename(entwicklung)}.bak`)
console.log('')
console.log('  Nur der SOAP-Block wurde angefasst. Alle anderen Eintraege unveraendert.')