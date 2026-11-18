'use strict'

/*
 * Setzt Programm-Symbol und Datei-Angaben in die fertig gebauten EXE-Dateien.
 *
 * Warum es dieses Skript ueberhaupt gibt
 * -------------------------------------
 * electron-builder kann Symbol einbetten und signieren - aber beides haengt
 * an "win.signAndEditExecutable". Ist die Option aus, holt electron-builder
 * das winCodeSign-Paket nicht, und rcedit.exe fehlt auf der Platte.
 *
 * Ist sie an, holt er es - und scheitert daran, dass sich das Paket nur mit
 * Symlinks entpacken laesst. Ohne Entwicklermodus verweigert Windows das.
 * (Stand: 15.10.2026 - der Weg mit der Option aus funktioniert.)
 *
 * WICHTIG - nur die entpackte Anwendung anfassen
 * ----------------------------------------------
 * Die portable EXE ist ein selbstentpackendes Archiv: die eigentliche
 * Programmdatei haengt als Nutzlast hinter dem PE-Dateiende. rcedit
 * schreibt den Ressourcenblock um und schneidet dabei genau diese Nutzlast
 * ab - aus 71,9 MB wurden 177 KB, und die Datei startet nicht mehr.
 *
 * Deshalb wird die portable Datei hier nie angefasst. Das Symbol der
 * eigentlichen Anwendung reicht fuer die Taskleiste; die das Symbol der
 * portablen Datei setzt electron-builder selbst, sofern man die Rechte fuer
 * das Entpacken des Pakets hat.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const WURZEL = path.join(__dirname, '..')
const PKG = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8'))

const SYMBOL = path.join(WURZEL, 'build', 'icon.ico')
const RELEASE = path.join(WURZEL, 'release')

// electron-builder-Metadaten an der EXE, die Windows im Explorer zeigt.
// rcedit erwartet sie paarweise: --set-version-string <name> <wert>
const VERSION_STRINGS = {
  FileDescription: `${PKG.build.productName} fuer AzerothCore`,
  ProductName: PKG.build.productName,
  CompanyName: 'FrakItOut'
}

/*
 * Selbstentpackende Dateien. electron-builder erzeugt sie aus dem
 * Verzeichnis release\win-unpacked und legt sie eine Ebene hoeher ab.
 */
function istSelbstentpackend (datei) {
  const imEntpackten = path.join(RELEASE, 'win-unpacked')
  return path.dirname(datei).toLowerCase() !== imEntpackten.toLowerCase()
}

/* --------------------------------------------------- rcedit im Cache suchen */

function findeRcedit () {
  // ELECTRON_BUILDER_CACHE kann umgeleitet sein, sonst der Standardpfad.
  const wurzeln = [
    process.env.ELECTRON_BUILDER_CACHE,
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache')
  ].filter(Boolean)

  const gefunden = []
  for (const wurzel of wurzeln) {
    // "<wurzel>/winCodeSign/<version>/rcedit-x64.exe"
    const winCodeSign = path.join(wurzel, 'winCodeSign')
    if (!fs.existsSync(winCodeSign)) continue
    for (const e of fs.readdirSync(winCodeSign, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const kandidat = path.join(winCodeSign, e.name, 'rcedit-x64.exe')
      if (fs.existsSync(kandidat)) gefunden.push(kandidat)
    }
  }
  // Der Cache enthaelt mehrere Versionen. Die neueste zuerst probieren.
  gefunden.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return gefunden
}

/* -------------------------------------------------------------- EXE-Dateien */

function exeDateien () {
  const liste = []
  const entpackt = path.join(RELEASE, 'win-unpacked')
  if (fs.existsSync(entpackt)) {
    for (const e of fs.readdirSync(entpackt)) {
      if (e.toLowerCase().endsWith('.exe')) liste.push(path.join(entpackt, e))
    }
  }
  // Das portable Zieldatei: "<productName> <version>.exe"
  if (fs.existsSync(RELEASE)) {
    for (const e of fs.readdirSync(RELEASE)) {
      if (e.toLowerCase().endsWith('.exe')) liste.push(path.join(RELEASE, e))
    }
  }
  return liste
}

/* -------------------------------------------------------------------- Lauf */

if (!fs.existsSync(SYMBOL)) {
  console.error('FEHLER: ' + SYMBOL + ' fehlt. Erst scripts/make-icon.js laufen lassen.')
  process.exit(1)
}
if (!fs.existsSync(RELEASE)) {
  console.error('FEHLER: ' + RELEASE + ' fehlt. Erst "npm run dist" ausfuehren.')
  process.exit(1)
}

const rcedit = findeRcedit()
if (!rcedit.length) {
  console.error('FEHLER: rcedit-x64.exe nicht im electron-builder-Cache gefunden.')
  console.error('  Der Pfad laesst sich mit ELECTRON_BUILDER_CACHE setzen.')
  console.error('  Ohne rcedit bekommen die EXE-Dateien kein eigenes Symbol.')
  process.exit(1)
}

const ziele = exeDateien()
if (!ziele.length) {
  console.error('FEHLER: keine EXE-Datei in ' + RELEASE + ' gefunden.')
  process.exit(1)
}

console.log('rcedit: ' + rcedit[0])
console.log('Symbol : ' + path.relative(WURZEL, SYMBOL))
console.log('')

let geaendert = 0
let fehlgeschlagen = 0
let uebersprungen = 0

for (const ziel of ziele) {
  /*
   * Zwei Dinge merken, nicht nur die Aenderungszeit:
   *  - die Groesse, weil rcedit bei selbstentpackenden Dateien die Nutzlast
   *    abschneidet (71,9 MB wurden 177 KB) und trotzdem Erfolg meldet;
   *  - den PE-Kopf, damit erkennbar bleibt, ob es noch dieselbe Datei ist.
   */
  const vorher = fs.statSync(ziel)
  const groesseVorher = vorher.size
  const kopfVorher = fs.readFileSync(ziel).subarray(0, 2).toString('latin1')

  if (istSelbstentpackend(ziel)) {
    console.log('  uebersprungen  ' + path.relative(WURZEL, ziel))
    console.log('                selbstentpackend - rcedit wuerde die Nutzlast abschneiden')
    uebersprungen++
    continue
  }

  const args = [ziel, '--set-icon', SYMBOL]
  for (const [schluessel, wert] of Object.entries(VERSION_STRINGS)) {
    args.push('--set-version-string', schluessel, wert)
  }

  try {
    execFileSync(rcedit[0], args, { stdio: 'pipe' })
  } catch (e) {
    const ausgabe = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '')
    console.log('  FEHLER        ' + path.relative(WURZEL, ziel))
    console.log('                ' + ausgabe.trim().split(/\r?\n/).slice(0, 3).join(' | '))
    fehlgeschlagen++
    continue
  }

  const nachher = fs.statSync(ziel)
  const kopfNachher = fs.readFileSync(ziel).subarray(0, 2).toString('latin1')

  if (kopfNachher !== kopfVorher) {
    console.log('  ZERSTOERT     ' + path.relative(WURZEL, ziel) +
      '  (kein MZ-Kopf mehr)')
    fehlgeschlagen++
  } else if (nachher.size < groesseVorher) {
    // Genau der Fehler von 15.10.2026: rcedit behauptet Erfolg und liefert
    // eine abgeschnittene Datei.
    console.log('  ZERSTOERT     ' + path.relative(WURZEL, ziel) +
      '  (' + (groesseVorher / 1048576).toFixed(1) + ' MB -> ' +
      (nachher.size / 1048576).toFixed(1) + ' MB)')
    fehlgeschlagen++
  } else if (nachher.mtimeMs === vorher.mtimeMs) {
    console.log('  unveraendert  ' + path.relative(WURZEL, ziel))
    fehlgeschlagen++
  } else {
    console.log('  OK            ' + path.relative(WURZEL, ziel) +
      '  (' + (nachher.size / 1048576).toFixed(1) + ' MB)')
    geaendert++
  }
}

console.log('')
console.log(geaendert + ' EXE-Datei(en) mit Symbol versehen, ' +
  uebersprungen + ' uebersprungen, ' + fehlgeschlagen + ' problematisch.')
process.exit(fehlgeschlagen ? 1 : 0)