'use strict'

/*
 * Prueft das Rechtsklick-Menue (Ausschneiden, Kopieren, Einfuegen).
 *
 * Drei Fehler, die man sonst erst beim Klicken bemerkt:
 *
 * 1. Eine falsche Rolle. Electron nimmt "kopieren" nicht, sondern nur
 *    "copy" - der Eintrag erscheint zwar, tut aber nichts. Der Name wird
 *    hier gegen die Liste aus electron.d.ts geprueft, nicht gegen eine
 *    eigene.
 *
 * 2. Ein Menue, das ueberall aufgeht, auch auf Knoepfen und Menuepunkten.
 *    Dort soll nichts erscheinen - der Nutzer hat ja dorthin geklickt,
 *    um die Seite zu wechseln.
 *
 * 3. Die Entscheidung doppelt vorhanden - einmal in main.js und einmal
 *    im Modul. Aendert sich nur eine Stelle, laeuft die andere hinterher.
 *    Deshalb steht alles in electron/api/kontextmenue.js und main.js macht
 *    nur den Aufruf.
 */

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')
const MAIN = path.join(WURZEL, 'electron', 'main.js')
const MODUL = path.join(WURZEL, 'electron', 'api', 'kontextmenue.js')
const TYPEN = path.join(WURZEL, 'node_modules', 'electron', 'electron.d.ts')

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) {
    gut++
    console.log('  OK   ' + label)
  } else {
    schlecht++
    console.log('  FAIL ' + label)
  }
}

const main = fs.readFileSync(MAIN, 'utf8')
const src = fs.readFileSync(MODUL, 'utf8')

/* --------------------------------------------------- Verdrahtung und Aufteilung */

console.log('=== Verdrahtung ===')
// main.js darf nichts vom Menue selber machen - nur anbinden.
pruefe(/kontextmenue\.anbinden\(mainWindow\)/.test(main),
  'main.js ruft das Modul auf')
pruefe(!/Menu\.buildFromTemplate/.test(main),
  'main.js baut kein Menue - nur das Modul')
pruefe(!/webContents\.on\(['"]context-menu['"]/.test(main),
  'kein zweiter context-menu-Handler in main.js')

console.log('')
console.log('=== Modul ===')
pruefe(/webContents\.on\(['"]context-menu['"]/.test(src),
  'context-menu wird im Modul abgehoert')
pruefe(/Menu\.buildFromTemplate/.test(src),
  'Menue wird aus einer Vorlage gebaut')
pruefe(/\.popup\(\{\s*window: fenster\s*\}\)/.test(src),
  'Menue am richtigen Fenster eingeblendet')
pruefe(/bauVorlage/.test(src),
  'die Entscheidung steckt in bauVorlage - pruefbar ohne Fenster')
pruefe(/module\.exports\s*=\s*\{\s*anbinden\s*,\s*bauVorlage\s*\}/.test(src),
  'beide Funktionen werden exportiert')

/* ------------------------------------- Rollen gegen Electron selbst pruefen */

console.log('')
console.log('=== Rollen ===')

// Die gueltigen Rollen stehen in electron.d.ts als Union hinter
// "role?: ('undo' | 'redo' | ...)". Eine eigene Liste waere eine zweite
// Wahrheit, die irgendwann auseinanderlaeuft.
let erlaubt = new Set()
if (fs.existsSync(TYPEN)) {
  const d = fs.readFileSync(TYPEN, 'utf8')
  const m = d.match(/role\?:\s*\(([^)]+)\)/)
  if (m) {
    for (const roh of m[1].split('|')) {
      const name = roh.trim().replace(/^['"]|['"]$/g, '')
      if (/^[a-zA-Z]+$/.test(name)) erlaubt.add(name)
    }
  }
}
pruefe(erlaubt.size > 20, `Rollenliste aus electron.d.ts gelesen (${erlaubt.size} Eintraege)`)

// Nur echter Code, nicht der Kommentar darueber - sonst zaehlt cut zweimal.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const verwendet = [...new Set([...code.matchAll(/role:\s*'([a-zA-Z]+)'/g)].map(m => m[1]))]
pruefe(verwendet.length >= 3, `Rollen im Code gefunden (${verwendet.join(', ')})`)
for (const r of verwendet) {
  pruefe(erlaubt.has(r), `Rolle '${r}' ist Electron bekannt`)
}
for (const pflicht of ['cut', 'copy', 'paste']) {
  pruefe(verwendet.includes(pflicht), `${pflicht} ist dabei`)
}

/* --------------------------------------------------- Bedingungen sinnvoll */

console.log('')
console.log('=== Bedingungen ===')

// Nur wo es etwas zu tun gibt: weder Feld noch Auswahl -> keine Vorlage.
// Wichtig: das ist genau DIE Bedingung, die in bauVorlage steckt.
// Wenn sie verschwindet, geht das Menue ueberall auf.
pruefe(/if\s*\(!b\s*&&\s*!m\)\s*return\s*\[\s*\]/.test(src),
  'leere Vorlage ohne Feld und ohne Auswahl')

// Einfuegen nur bei Inhalt in der Zwischenablage - sonst ist der Eintrag
// tot und man klickt vergeblich darauf.
pruefe(/clipboard\.readText\(\)\.length > 0/.test(src),
  '"Einfuegen" nur bei Inhalt in der Zwischenablage')

// Beschriftungen
for (const wort of ['Ausschneiden', 'Kopieren', 'Einfuegen']) {
  pruefe(src.includes(wort), `Beschriftung "${wort}" vorhanden`)
}

/* --------------------------- nicht auf der ganzen Flaeche, nur wo noetig */

console.log('')
console.log('=== Reichweite ===')
pruefe(!/context-menu[\s\S]{0,400}preventDefault\(\)/.test(src),
  'kein pauschales Unterdruecken des Rechtsklicks')

console.log('')
console.log(schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
process.exit(schlecht ? 1 : 0)
