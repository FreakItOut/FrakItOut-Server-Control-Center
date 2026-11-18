'use strict'

/*
 * Prueft die Entscheidung des Rechtsklick-Menüs.
 *
 * Aufruf:  node scripts/verify-kontextmenue.js
 *
 * Geprüft wird bauVorlage() aus electron/api/kontextmenue.js - dieselbe
 * Funktion, die auch läuft.
 *
 * Warum kein Fenster aufgeht: der erste Versuch dieser Prüfung hat das
 * echte Menü aufpoppen lassen und ist beim zweiten Fall hängen geblieben.
 * Nach dem context-menu-Ereignis antwortet der Renderer auf executeJavaScript
 * nicht mehr; ein zweites Menü bleibt offen und wartet auf einen Klick.
 * Zwei Versuche mit Bildschirmkoordinaten waren ebenfalls unbrauchbar - sie
 * trafen daneben und meldeten dadurch das falsche Ergebnis.
 *
 * Die Entscheidung braucht aber gar kein Fenster. Deshalb steht sie in
 * bauVorlage() und wird hier direkt aufgerufen.
 */

const { bauVorlage } = require('../electron/api/kontextmenue')

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) { gut++; console.log('  OK   ' + label) } else { schlecht++; console.log('  FAIL ' + label) }
}

const namen = v => v.filter(e => e.type !== 'separator').map(e => e.label)
const hol = (v, wort) => v.filter(e => e.label === wort)[0]
const rollen = v => v.filter(e => e.role).map(e => e.role)

/* ------------------------------------------- 1: Feld mit Auswahl */
console.log('=== 1. Eingabefeld, Text ist markiert ===')
{
  const v = bauVorlage({ markiert: true, bearbeitbar: true, hatInhalt: true })
  const n = namen(v)
  pruefe(n.includes('Ausschneiden'), 'Ausschneiden dabei')
  pruefe(n.includes('Kopieren'), 'Kopieren dabei')
  pruefe(n.includes('Einfuegen'), 'Einfügen dabei')
  pruefe(n.includes('Alles auswaehlen'), 'Alles auswählen dabei')
  pruefe(hol(v, 'Ausschneiden').enabled === true, 'Ausschneiden aktiv')
  pruefe(hol(v, 'Kopieren').enabled === true, 'Kopieren aktiv')
  pruefe(hol(v, 'Einfuegen').enabled === true, 'Einfügen aktiv (Zwischenablage voll)')
  pruefe(rollen(v).includes('cut'), 'Rolle cut')
  pruefe(rollen(v).includes('copy'), 'Rolle copy')
  pruefe(rollen(v).includes('paste'), 'Rolle paste')
  pruefe(rollen(v).includes('selectAll'), 'Rolle selectAll')
  pruefe(v.some(e => e.type === 'separator'), 'Trennlinie vor "Alles auswählen"')
}

/* --------------------------------------- 2: Feld ohne Auswahl */
console.log('')
console.log('=== 2. Eingabefeld, nichts markiert ===')
{
  const v = bauVorlage({ markiert: false, bearbeitbar: true, hatInhalt: true })
  pruefe(hol(v, 'Ausschneiden').enabled === false, 'Ausschneiden deaktiviert')
  pruefe(hol(v, 'Kopieren').enabled === false, 'Kopieren deaktiviert')
  pruefe(hol(v, 'Einfuegen').enabled === true, 'Einfügen bleibt aktiv')
  pruefe(!namen(v).includes('Alles auswaehlen'), 'kein "Alles auswählen"')
}

/* ------------------------------- 3: Feld, Zwischenablage leer */
console.log('')
console.log('=== 3. Eingabefeld, Zwischenablage leer ===')
{
  const v = bauVorlage({ markiert: false, bearbeitbar: true, hatInhalt: false })
  pruefe(hol(v, 'Einfuegen').enabled === false,
    'Einfügen deaktiviert - sonst klickt man ins Leere')
}

/* ---------------------------- 4: Auswahl auf reinem Text, kein Feld */
console.log('')
console.log('=== 4. Text markiert, aber kein Eingabefeld ===')
{
  const v = bauVorlage({ markiert: true, bearbeitbar: false, hatInhalt: true })
  const n = namen(v)
  pruefe(n.includes('Kopieren'), 'Kopieren dabei')
  pruefe(hol(v, 'Kopieren').enabled === true, 'Kopieren aktiv')
  pruefe(!n.includes('Ausschneiden'), 'kein Ausschneiden - es gibt kein Feld')
  pruefe(!n.includes('Einfuegen'), 'kein Einfügen - es gibt kein Feld')
  pruefe(n.includes('Alles auswaehlen'), 'Alles auswählen dabei')
}

/* ------------------------------------ 5: weder Feld noch Auswahl */
console.log('')
console.log('=== 5. Weder Feld noch Auswahl ===')
{
  const v = bauVorlage({ markiert: false, bearbeitbar: false, hatInhalt: true })
  pruefe(v.length === 0, 'leere Vorlage - das Menü wird gar nicht erst gebaut')
}

console.log('')
console.log(schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
process.exit(schlecht ? 1 : 0)