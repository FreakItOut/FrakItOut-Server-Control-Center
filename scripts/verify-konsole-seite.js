'use strict'

/*
 * Prueft die Seite "Konsolen Befehl" im laufenden Fenster.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-konsole-seite.js
 *
 * Geprueft wird der Text, der wirklich angezeigt wird - nicht die Quellen.
 * Grund: der Fehler, den dieser Test verhindern soll, ist genau in die
 * Oberflaeche geraten. Ein Test auf die Quelldateien haette ihn gesehen;
 * ein Test auf den Bildschirm sagt auch, dass er nicht mehr dasteht.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'konsole-seite.txt')
fs.writeFileSync(BERICHT, '', 'utf8')
const sag = z => fs.appendFileSync(BERICHT, String(z) + '\n', 'utf8')
let schlecht = 0
const pruefe = (c, l) => {
  if (c) sag('  OK   ' + l)
  else { schlecht++; sag('  FAIL ' + l) }
}

require('../electron/main')
const { app, BrowserWindow } = require('electron')
const warte = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 60000)

  let f = null
  for (let i = 0; i < 100; i++) {
    if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }
  const re = f.webContents

  await re.executeJavaScript("window.location.hash = '#/console'; 'ok'")
  await warte(3000)

  const text = await re.executeJavaScript('document.body.innerText')

  sag('=== Was die Seite anzeigt ===')
  const zeilen = text.split('\n').filter(z => /SOAP/i.test(z))
  for (const z of zeilen) sag(`  ${z.trim()}`)
  sag('')

  sag('=== Pruefungen ===')
  // Die drei Schluessel, die es wirklich gibt
  pruefe(/SOAP\.Enabled/.test(text), 'SOAP.Enabled wird genannt')
  pruefe(/SOAP\.IP/.test(text), 'SOAP.IP wird genannt')
  pruefe(/SOAP\.Port/.test(text), 'SOAP.Port wird genannt')

  // Und die, die es nicht gibt
  const falsch = []
  for (const k of ['SOAP.enable', 'SOAP.login', 'SOAP.password', 'SOAP.port']) {
    // Gross-/Kleinschreibung beachten: SOAP.Port ist erlaubt, SOAP.port nicht.
    const m = new RegExp(k.replace('.', '\\.')).exec(text)
    if (m) {
      // SOAP.Port enthaelt die Zeichenfolge "SOAP.Po"; die Pruefung muss
      // die exakte Schreibweise treffen.
      const exakt = new RegExp(k.replace('.', '\\.') + '(?![A-Za-z])')
      if (!exakt.test(text)) falsch.push(k)
    }
  }
  pruefe(falsch.length === 0, `keine nicht existierenden Schluessel (${falsch.join(', ') || 'keine'})`)

  // Der Port muss der des Cores sein
  const port = /SOAP\.Port\s*=\s*(\d+)/.exec(text)
  sag(`  angezeigter Port: ${port ? port[1] : 'keiner'}`)
  pruefe(port && port[1] === '7878', 'der angezeigte Port ist der des Cores (7878)')

  // Und die Einstellungen
  sag('')
  sag('=== Seite Einstellungen ===')
  await re.executeJavaScript("window.location.hash = '#/options'; 'ok'")
  await warte(3000)
  const opts = await re.executeJavaScript('document.body.innerText')
  sag(`  nennt SOAP.Enabled : ${/SOAP\.Enabled/.test(opts)}`)
  sag(`  nennt SOAP.login   : ${/SOAP\.login/.test(opts)}`)
  /*
   * Einmal rechnen und ueberall verwenden. Zwei verschiedene Muster an
   * zwei Stellen ergaben zuerst oben "true" und eine Zeile darunter
   * "FAIL" - der Test widersprach sich selbst.
   *
   * Beide Sprachen kommen in das Muster: die Oberflaeche laeuft in der
   * gerade eingestellten Sprache, und die wechselt der Anwender.
   */
  const neustart = /neu gestartet|must be restarted/i.test(opts)
  sag(`  nennt Neustart-Hinweis: ${neustart}`)
  pruefe(/SOAP\.Enabled/.test(opts), 'die Einstellungen nennen SOAP.Enabled')
  pruefe(!/SOAP\.login/.test(opts), 'die Einstellungen nennen SOAP.login nicht')
  pruefe(neustart, 'die Einstellungen sagen, dass der Server neu starten muss')

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})