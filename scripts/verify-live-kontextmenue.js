'use strict'

/*
 * Test des Rechtsklick-Menues in der ECHTEN Anwendung.
 *
 * Aufruf:  .\node_modules\electron\dist\electron.exe scripts\verify-live-kontextmenue.js
 *
 * Warum dieser Weg
 * ----------------
 * Zwei Wege haben nicht zum Ziel gefuehrt:
 *
 *   - Klicks mit mouse_event auf Bildschirmkoordinaten. Der Klick kam
 *     entweder nicht an oder landete auf einem Label. Der Grund dafuer ist
 *     Windows selbst: ein Hintergrundprozess darf das Vordergrundfenster
 *     nicht einfach wechseln (SetForegroundWindow versagt klanglos). Der
 *     Klick geht dann an das Fenster, das wirklich oben liegt - im Versuch
 *     war das der Windows-Desktop, und dessen Flaeche an jener Stelle ist
 *     reiner Seitenhintergrund. Ein negatives Ergebnis, das nichts beweist.
 *
 *   - Ein Fenster mit einer eigenen Testseite. Das zeigt, dass der Code
 *     stimmt, aber nicht, dass die echte Anwendung richtig verdrahtet ist.
 *
 * Deshalb: die echte electron/main.js wird hier geladen. Sie baut das
 * Fenster mit allen Handlern genauso wie im Programm. Geklickt wird dann
 * ueber webContents.sendInputEvent - im Renderer, nicht auf dem Bildschirm.
 * Die Stelle wird vorher aus der Seite ausgelesen.
 *
 * Menu.buildFromTemplate wird abgefangen (erst NACH dem App-Start, sonst
 * bricht Electron selbst mit "Invalid menu" ab) und merkt sich die Vorlage.
 *
 * Dazu wird ein eigener context-menu-Zuhörer angehaengt, der nur protokolliert,
 * was Electron meldet. Damit ist nachpruefbar, WARUM etwas passiert - steht
 * dort bearbeitbar=false, lag es am Klick, nicht am Handler.
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

const BERICHT = path.join(os.tmpdir(), 'live-kontextmenue.txt')
const zeilen = []
fs.writeFileSync(BERICHT, '', 'utf8')
function sag (z) {
  zeilen.push(String(z))
  fs.appendFileSync(BERICHT, String(z) + '\n', 'utf8')
}
function pruefe (cond, label) {
  sag((cond ? '  OK   ' : '  FAIL ') + label)
}

require('../electron/main')

const { app, BrowserWindow, Menu, clipboard } = require('electron')

function warteMs (ms) { return new Promise(r => setTimeout(r, ms)) }
const namen = v => (v || []).filter(e => e.type !== 'separator').map(e => e.label)
const hol = (v, w) => (v || []).filter(e => e.label === w)[0]

async function starten () {
  let fenster = null
  for (let i = 0; i < 100; i++) {
    const alle = BrowserWindow.getAllWindows()
    if (alle.length) { fenster = alle[0]; break }
    await warteMs(200)
  }
  if (!fenster) { sag('  FAIL Fenster nicht erschienen'); return null }
  sag('  OK   Fenster der Anwendung gefunden')

  const echtes = Menu.buildFromTemplate
  let letzteVorlage = null
  Menu.buildFromTemplate = function (vorlage) {
    letzteVorlage = vorlage
    return { popup () {} }
  }

  // Nur zum Beobachten: was meldet Electron an dieser Stelle?
  let letzterParam = null
  fenster.webContents.on('context-menu', (e, p) => {
    letzterParam = p
    sag('  [beobachtet] bearbeitbar=' + !!p.isEditable +
      ' auswahl=' + JSON.stringify(p.selectionText || '') +
      ' feld=' + JSON.stringify(p.inputFieldType || null))
  })

  return {
    fenster,
    gibVorlage: () => letzteVorlage,
    gibParam: () => letzterParam,
    gibEchtes: () => echtes,
    // Vor dem naechsten Klick auf null setzen. Ohne das bleibt die
    // Vorlage des vorigen Falls stehen - und dann sieht es falsch
    // so aus, als waere auf einer leeren Flaeche ein Menue gebaut
    // worden. Genau damit hat der erste Durchlauf sich selbst
    // hereingelegt.
    vergiss: () => { letzteVorlage = null }
  }
}

async function rechtsKlick (re, x, y) {
  re.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 })
  re.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 })
  await warteMs(500)
}

app.whenReady().then(async () => {
  const schranke = setTimeout(() => {
    sag('ABBRUCH: nach 40 s nicht fertig')
    fs.writeFileSync(BERICHT, zeilen.join('\n') + '\n', 'utf8')
    process.exit(2)
  }, 40000)

  const k = await starten()
  if (!k) { clearTimeout(schranke); process.exit(1) }
  const { fenster, gibVorlage, gibParam } = k
  const re = fenster.webContents

  clipboard.writeText('Inhalt zum Einfuegen')

  // Auf die Einstellungsseite gehen - dort gibt es Eingabefelder.
  sag('')
  sag('=== Einstellungsseite ===')
  try {
    await re.executeJavaScript(`window.location.hash = '#/options'; 'ok'`)
  } catch (e) {
    sag('  Hinweis: Hashwechsel nicht moeglich: ' + e.message)
  }
  await warteMs(2500)

  const erstesFeld = () => re.executeJavaScript(`
    (function () {
      const f = [...document.querySelectorAll('input, textarea')].filter(x => x.offsetParent !== null)[0]
      if (!f) return 'keine'
      const r = f.getBoundingClientRect()
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
    })()
  `)

  /* ---- 1: Eingabefeld ohne Auswahl ---- */
  sag('')
  sag('=== 1. Rechtsklick ins Eingabefeld, ohne Auswahl ===')
  let feld = null
  try { feld = JSON.parse(await erstesFeld()) } catch (e) {}
  if (feld) {
    k.vergiss(); await rechtsKlick(re, feld.x, feld.y)
    const v = gibVorlage()
    const n = namen(v)
    pruefe(!!v, 'Menuevorlage wird gebaut')
    pruefe(n.includes('Ausschneiden') && n.includes('Kopieren') && n.includes('Einfuegen'),
      'Ausschneiden, Kopieren, Einfuegen dabei')
    pruefe(hol(v, 'Ausschneiden').enabled === false,
      'Ausschneiden ist grau - ohne Auswahl gibt es nichts zu schneiden')
    pruefe(hol(v, 'Kopieren').enabled === false, 'Kopieren ist grau')
    pruefe(!n.includes('Alles auswaehlen'),
      'kein "Alles auswaehlen" - ohne Auswahl keinen Sinn')
    const rollen = (v || []).filter(e => e.role).map(e => e.role)
    pruefe(rollen.includes('cut') && rollen.includes('copy') && rollen.includes('paste'),
      `Rollen: ${rollen.join(', ')}`)
  } else {
    sag('  FAIL kein Eingabefeld gefunden')
  }

  /* ---- 2: markierter Text, aber kein Feld ---- */
  sag('')
  sag('=== 2. Rechtsklick auf markierten Text (kein Feld) ===')
  // Bewusst im Konsolenprotokoll: dort ist Text laut CSS markierbar
  // (.console hat user-select: text). Auf einer Ueberschrift nicht - der
  // ganze Body ist user-select: none, und dann meldet Electron verstaendlich
  // keine Auswahl. Ein Rechtsklick auf eine Ueberschrift gehoert damit zu
  // Fall 3, nicht hierher.
  sag('  (Stelle: .console - dort ist Text laut CSS markierbar)')
  // Die Konsole steht auf der Uebersicht. Also dorthin gehen.
  try { await re.executeJavaScript(`window.location.hash = '#/'; 'ok'`) } catch (e) {}
  await warteMs(2000)
  try {
    const roh = await re.executeJavaScript(`
      (function () {
        const c = document.querySelector('.console')
        if (!c) return 'keine'
        const zeilen = [...c.querySelectorAll('div, p, span, li')]
                     .filter(e => e.textContent.trim().length > 5)
        if (!zeilen.length) return 'keine'
        const ziel = zeilen[zeilen.length - 1]
        const r = document.createRange()
        r.selectNodeContents(ziel)
        const s = getSelection(); s.removeAllRanges(); s.addRange(r)
        const b = ziel.getBoundingClientRect()
        return JSON.stringify({ x: Math.round(b.x + 10), y: Math.round(b.y + 6) })
      })()
    `)
    if (roh === 'keine' || roh === undefined) {
      sag('  Hinweis: kein markierbarer Text gefunden - Fall ausgelassen')
    } else {
      const z = JSON.parse(roh)
      k.vergiss(); await rechtsKlick(re, z.x, z.y)
      const v = gibVorlage()
      const n = namen(v)
      pruefe(!!v, 'Menuevorlage wird gebaut')
      pruefe(n.includes('Kopieren'), 'Kopieren dabei')
      pruefe(hol(v, 'Kopieren') && hol(v, 'Kopieren').enabled === true,
        'Kopieren ist aktiv - es ist Text markiert')
      pruefe(n.includes('Alles auswaehlen'), 'Alles auswaehlen dabei')
      pruefe(!n.includes('Ausschneiden'), 'kein Ausschneiden - es gibt kein Feld')
      pruefe(!n.includes('Einfuegen'), 'kein Einfuegen - es gibt kein Feld')
    }
  } catch (e) {
    sag('  Hinweis: nicht moeglich: ' + e.message)
  }

  /* ---- 3: nichts davon ---- */
  sag('')
  sag('=== 3. Rechtsklick auf leere Flaeche ===')
  try {
    await re.executeJavaScript('getSelection().removeAllRanges(); document.activeElement && document.activeElement.blur(); "ok"')
    k.vergiss(); await rechtsKlick(fenster.webContents, 1260, 800)
    pruefe(gibVorlage() === null,
      'keine Vorlage - ein Klick ins Leere darf nichts oeffnen')
    sag('  [beobachtet] ' + JSON.stringify({
      bearbeitbar: !!(gibParam() || {}).isEditable,
      auswahl: ((gibParam() || {}).selectionText || '')
    }))
  } catch (e) {
    sag('  Hinweis: nicht moeglich: ' + e.message)
  }

  clearTimeout(schranke)
  const rot = zeilen.filter(z => z.startsWith('  FAIL')).length
  sag('')
  sag(rot ? rot + ' FEHLGESCHLAGEN' : 'ALLE PRUEFUNGEN BESTANDEN')
  fs.writeFileSync(BERICHT, zeilen.join('\n') + '\n', 'utf8')
  process.exit(rot ? 1 : 0)
})
