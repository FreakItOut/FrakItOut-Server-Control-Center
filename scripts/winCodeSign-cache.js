'use strict'

/*
 * Bereitet den electron-builder-Cache "winCodeSign" vor.
 *
 * Problem
 * -------
 * electron-builder laedt vor dem Bauen dieses Paket, um die EXE mit dem
 * Programm-Symbol zu versehen und sie zu signieren. Das Paket enthaelt unter
 * darwin\10.12\lib zwei symbolische Verknuepfungen. Windows erlaubt das
 * Anlegen nur mit Entwicklermodus oder Administratorrechten, also bricht der
 * Build ab mit:
 *
 *   ERROR: Cannot create symbolic link : Dem Client fehlt ein erforderliches Recht
 *
 * Loesung
 * -------
 * Die Verknuepfungen liegen ausschliesslich bei den Werkzeugen fuer macOS.
 * Auf Windows werden sie nie benutzt. Wir entpacken dasselbe Archiv also
 * selbst und lassen darwin\ weg - danach ist alles Nötige da, und
 * electron-builder laesst die Nutzlast liegen, weil der Ordner schon steht.
 *
 * Aufruf:  node scripts/winCodeSign-cache.js
 *
 * Danach baut "npm run dist" mit
 *   build.win.signAndEditExecutable = true
 * Das Symbol sitzt dann in beiden EXE-Dateien, ohne dass hier etwas
 * nachgeholt werden muss - und ohne dass eine Nutzlast abgeschnitten wird.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const WURZEL = path.join(__dirname, '..')
const SIEBEN_ZIP = path.join(WURZEL, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')

const cache = path.join(
  process.env.ELECTRON_BUILDER_CACHE ||
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
  'winCodeSign'
)

if (!fs.existsSync(SIEBEN_ZIP)) {
  console.error('FEHLER: 7za.exe nicht gefunden unter ' + SIEBEN_ZIP)
  process.exit(1)
}
if (!fs.existsSync(cache)) {
  console.error('FEHLER: Cache-Verzeichnis ' + cache + ' gibt es nicht.')
  console.error('  Der entsteht beim ersten electron-builder-Lauf.')
  process.exit(1)
}

const archive = fs.readdirSync(cache).filter(n => n.endsWith('.7z'))

if (!archive.length) {
  console.error('FEHLER: keine .7z-Datei in ' + cache)
  console.error('  Einmal "npx electron-builder --win" laufen lassen, damit der')
  console.error('  Download anlegt - danach dieses Skript erneut.')
  process.exit(1)
}

let bereit = 0
let erstellt = 0

for (const name of archive) {
  const ziel = path.join(cache, name.replace(/\.7z$/, ''))
  const rcedit = path.join(ziel, 'rcedit-x64.exe')

  if (fs.existsSync(rcedit)) {
    console.log('  bereits da   ' + name.replace(/\.7z$/, ''))
    bereit++
    continue
  }

  // -x!darwin\*  : die beiden Symlinks auslassen
  // -snld        : Symlinks, falls doch welche kommen, nicht anlegen wollen
  try {
    execFileSync(SIEBEN_ZIP, ['x', path.join(cache, name), `-o${ziel}`, '-x!darwin\\*', '-snld', '-bd'], {
      stdio: 'pipe'
    })
  } catch (e) {
    console.error('  FEHLER bei ' + name + ': ' + String(e.message).split('\n')[0])
    continue
  }

  if (fs.existsSync(rcedit)) {
    console.log('  entpackt     ' + name.replace(/\.7z$/, '') +
      '  (' + fs.readdirSync(ziel).length + ' Eintraege)')
    erstellt++
  } else {
    console.error('  FEHLER: rcedit-x64.exe fehlt nach dem Entpacken von ' + name)
  }
}

console.log('')
console.log(bereit + ' bereits bereit, ' + erstellt + ' neu entpackt.')
console.log(fs.existsSync(path.join(cache, 'winCodeSign', 'rcedit-x64.exe'))
  ? ''
  : 'Hinweis: electron-builder sucht <version>/rcedit-x64.exe, nicht winCodeSign/rcedit-x64.exe.')
console.log('Jetzt "npm run dist" mit signAndEditExecutable = true starten.')
process.exit(0)