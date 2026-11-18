'use strict'

/*
 * Rechtsklick-Menü mit Ausschneiden, Kopieren und Einfügen.
 *
 * Electron zeigt von sich aus gar nichts. Gerade im Panel ist das
 * unpraktisch: in der Konfiguration, in der Bot-Suche und im
 * Konsolenprotokoll steht Text, den man aus der Zwischenablage braucht -
 * ein Passwort aus dem Passwortmanager, ein Schlüssel aus einer
 * Dokumentation.
 *
 * Aufbau in zwei Teilen:
 *
 *   bauVorlage()  entscheidet, welche Eintraege es gibt. Nimmt drei
 *                 Ja/Nein-Werte und gibt eine Liste von Beschreibungen
 *                 zurück. Kennt Electron nicht, ruft nichts auf und ist
 *                 deshalb ohne Electron pruefbar - so prueft
 *                 scripts/verify-kontextmenue.js die Entscheidung an jeder
 *                 Stelle, ohne je ein Fenster zu oeffnen.
 *
 *   anbinden()     holt die drei Werte aus dem Ereignis, ruft bauVorlage()
 *                 und macht daraus Menüpunkte.
 *
 * Steht bewusst in einer eigenen Datei. Der Test benutzt genau dieses
 * Modul und nicht eine zweite Abschrift - eine Kopie wäre eine zweite
 * Wahrheit, und die laueft irgendwann auseinander.
 */

/**
 * Welche Eintraege soll das Menü haben?
 *
 * @param {boolean} markiert    ist im Feld oder auf der Seite Text markiert
 * @param {boolean} bearbeitbar steht der Cursor in einem Eingabefeld
 * @param {boolean} hatInhalt   liegt etwas in der Zwischenablage
 * @returns {Array} Liste aus { role, label, enabled } und Trennzeilen
 */
function bauVorlage ({ markiert, bearbeitbar, hatInhalt } = {}) {
  const m = !!markiert
  const b = !!bearbeitbar

  // Weder ein Eingabefeld noch eine Auswahl: hier gibt es nichts zu tun.
  // Ein Klick auf einen Knopf oder einen Menüpunkt soll kein Menü zeigen -
  // genau dorthin hat der Nutzer ja geklickt.
  //
  // Diese Regel steht hier und nicht im Aufrufer: sie gehört zur
  // Entscheidung, nicht zur Verdrahtung. An zwei Orten auseinandergesetzt
  // läuft sie irgendwann auseinander.
  if (!b && !m) return []

  const vorlage = []

  // Ausschneiden und Einfuegen nur dort, wo es ein Feld gibt. Auf reiner
  // Textauswahl koennte man nichts ausschneiden und nichts hineinfuegen -
  // die Eintraege wuerden nur grau dastehen und den Nutzer ratlos machen.
  if (b) {
    vorlage.push({ role: 'cut', label: 'Ausschneiden', enabled: m })
  }

  vorlage.push({ role: 'copy', label: 'Kopieren', enabled: m })

  if (b) {
    vorlage.push({ role: 'paste', label: 'Einfuegen', enabled: !!hatInhalt })
  }

  if (m) {
    vorlage.push({ type: 'separator' })
    vorlage.push({ role: 'selectAll', label: 'Alles auswaehlen', enabled: true })
  }

  return vorlage
}

/**
 * Am Fenster anmelden.
 *
 * @param {import('electron').BrowserWindow} fenster
 */
function anbinden (fenster) {
  const { Menu, MenuItem, clipboard } = require('electron')

  fenster.webContents.on('context-menu', (ereignis, param) => {
    let hatInhalt = false
    try {
      hatInhalt = clipboard.readText().length > 0
    } catch (_) {
      hatInhalt = false
    }

    const eintraege = bauVorlage({
      markiert: !!param.selectionText,
      bearbeitbar: !!param.isEditable,
      hatInhalt
    })

    // Leer heisst: hier gibt es nichts anzubieten.
    if (!eintraege.length) return

    Menu.buildFromTemplate(
      eintraege.map(e => (e.type === 'separator' ? new MenuItem({ type: 'separator' }) : new MenuItem(e)))
    ).popup({ window: fenster })
  })
}

module.exports = { anbinden, bauVorlage }