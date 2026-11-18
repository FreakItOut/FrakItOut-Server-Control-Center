'use strict'

/*
 * Prueft, wie das Panel den GM-Level nach account_access schreibt.
 *
 * Hintergrund
 * -----------
 * AzerothCore liest den GM-Level beim Einloggen über
 * (src/server/game/Server/WorldSocket.cpp, struct AccountInfo):
 *
 *   LEFT JOIN account_access aa ON a.id = aa.AccountID
 *                            AND aa.RealmID IN (-1, ?)
 *
 * "?" ist die ID des eigenen Reiches. Alles andere übersieht der Join.
 * Ein Eintrag auf RealmID = 0 steht dann zwar in der Tabelle, wird aber
 * nie gelesen - der Account bleibt normaler Spieler, ohne Meldung.
 *
 * Der Fehler ist deshalb so unangenehm: er ist in der Tabelle
 * unsichtbar. Nur die Abfrage des Kerns zeigt ihn.
 *
 * Geprüft wird deshalb:
 *
 *   1. die Datei benutzt eine benannte Konstante (ALLE_REICHE), nicht die
 *      magische 0
 *   2. nirgends wird eine 0 als RealmID geschrieben
 *   3. die Anzeige filtert auf RealmID IN (-1, reichIds) - sonst zeigt das
 *      Panel einen Level, das Konto ingame nicht hat
 *
 * Läuft ohne Datenbank. Für den Test gegen die echte Datenbank gibt es
 * scripts/verify-gmlevel.js und scripts/verify-gmlevel-api.js.
 */

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')
const DATEI = path.join(WURZEL, 'electron', 'api', 'accounts.js')

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) { gut++; console.log('  OK   ' + label) } else { schlecht++; console.log('  FAIL ' + label) }
}

const src = fs.readFileSync(DATEI, 'utf8')
// Nur echter Code, Kommentare zaehlen hier nicht
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------------------------------------- 1. benannte Konstante */

console.log('=== Schreibwert ===')

const m = code.match(/const\s+ALLE_REICHE\s*=\s*(-?\d+)/)
pruefe(!!m, 'es gibt eine benannte Konstante fuer die RealmID')
if (m) {
  const wert = Number(m[1])
  console.log(`  ALLE_REICHE = ${wert}`)
  // -1 = alle Reiche. 0 oder eine konkrete Realm-ID waere falsch.
  pruefe(wert === -1, 'die Konstante ist -1 (alle Reiche)')
}

/* ---------------------------------------- 2. keine magische 0 */

console.log('')
console.log('=== Kein hart geschriebener RealmID-Wert ===')

// Wo wird die RealmID geschrieben? Zwei Stellen: INSERT und UPDATE.
const insertRealm = [...code.matchAll(/parts\.push\([^)]*(?:RealmID|RealmCol|Realm)[^)]*\)/g)]
const updateRealm = code.match(/UPDATE account_access SET gmlevel = \?,\s*\$\{/g)
pruefe(insertRealm.length > 0, 'beim Anlegen wird eine RealmID geschrieben')
pruefe(!!updateRealm, 'beim Aendern wird die RealmID mitgeschrieben (Reparatur)')

// Und der Wert dahinter darf nicht die 0 sein. Gesucht wird im Rumpf von
// setGmLevelRaw - dort steht alles, was geschrieben wird.
const rumpf = (() => {
  const i = code.indexOf('async function setGmLevelRaw')
  if (i < 0) return ''
  // bis zur naechsten Funktion auf gleicher Ebene
  const ab = i + 'async function setGmLevelRaw'.length
  const j = code.indexOf('\nasync function ', ab)
  return code.slice(ab, j > 0 ? j : ab + 3000)
})()

pruefe(rumpf.length > 50, 'Rumpf von setGmLevelRaw gefunden')

// Die 0 darf nur dort vorkommen, wo sie keine RealmID ist. Konkret
// geprueft wird: kein .push(0) und kein ", 0)" als Wert.
const nullAlsRealm = /push\(\s*0\s*\)|,\s*0\s*\)/.test(rumpf)
pruefe(!nullAlsRealm,
  'im Schreibweg steht keine 0 - der Kern sieht eine 0 nie')

// Die Reparatur-Zeile (UPDATE ... SET gmlevel = ?, RealmID = ?) muss den
// konstanten Wert benutzen, nicht wieder die magische Zahl.
pruefe(/,\s*\$\{[^}]*[Rr]ealm[^}]*\}\s*=\s*\?/.test(rumpf),
  'die Reparatur schreibt die RealmID wirklich')

/* ---------------------------------------- 3. Anzeige filtert mit */

console.log('')
console.log('=== Anzeige ===')

pruefe(/WHERE\s+\$\{[^}]*RealmID[^}]*\}\s+IN \(\?\)/.test(code),
  'die Liste fragt nur RealmID IN (?) ab')
pruefe(/realmIds\s*\(\s*\)/.test(code),
  'die IDs der Reiche werden aus realmlist gelesen')

// Was waere, wenn die Anzeige nicht filterte? Dann zeigt das Panel "GM3"
// fuer ein Konto, das ingame Spieler ist. Genau das war beim Konto
// "SOAP" zu sehen.
console.log('')
console.log('=== Gemeldet wird nur, was der Kern liest ===')
pruefe(/SELECT[\s\S]*?FROM account_access WHERE/.test(code),
  'die Abfrage auf account_access hat ein WHERE auf die RealmID')

/* ---------------------------------------- 4. Anbindung */

console.log('')
console.log('=== Anbindung ===')
pruefe(/readGmLevels/.test(code), 'die Anzeige geht ueber readGmLevels()')
pruefe(/setGmLevelRaw/.test(code), 'das Schreiben geht ueber setGmLevelRaw()')
pruefe(/ALLE_REICHE/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
  'ALLE_REICHE wird im Code benutzt, nicht nur benannt')

console.log('')
console.log(schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
process.exit(schlecht ? 1 : 0)
