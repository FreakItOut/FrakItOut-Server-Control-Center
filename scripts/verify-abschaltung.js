'use strict'

/*
 * Prueft die Rueckfrage vor dem Herunterfahren.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-abschaltung.js
 *
 * Geprueft wird, was im Fenster passiert - nicht, was im Quelltext steht.
 *
 * Wichtig: Der Test sendet KEINEN Shutdown-Befehl. Der Worldserver waere
 * danach weg, und bei diesem Server ist das nicht so einfach
 * wieder gutzumachen (er stuerzt ohnehin unter Last ab). Der Test prueft
 * nur, dass die Rueckfrage erscheint und dass "Abbrechen" nichts sendet.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'abschaltung.txt')
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
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 90000)

  let f = null
  for (let i = 0; i < 100; i++) {
    if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }
  const re = f.webContents

  await re.executeJavaScript("window.location.hash = '#/console'; 'ok'")
  await warte(3000)

  /*
   * Den Verlauf leeren. Sonst zaehlt ein alter Eintrag mit - der Verlauf
   * liegt im localStorage und ueberlebt einen Neustart des Panels.
   */
  await re.executeJavaScript("localStorage.removeItem('console.history'); 'ok'")
  await re.executeJavaScript("window.location.reload(); 'ok'")
  await warte(3000)

  sag('=== 1. Ein normaler Befehl loest keine Rueckfrage aus ===')
  const normal = await re.executeJavaScript(`
    (function () {
      const feld = document.querySelector('input.mono')
      if (!feld) return 'kein Eingabefeld'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(feld, 'server info')
      feld.dispatchEvent(new Event('input', { bubbles: true }))
      const knopf = [...document.querySelectorAll('button')].find(b => /Senden|Send/i.test(b.textContent))
      if (!knopf) return 'kein Senden-Knopf'
      knopf.click()
      return 'geklickt'
    })()
  `)
  sag('  ' + normal)
  await warte(1200)
  const modalNachNormal = await re.executeJavaScript(`document.querySelectorAll('.modal').length`)
  pruefe(modalNachNormal === 0, 'bei "server info" erscheint keine Rueckfrage')

  sag('')
  sag('=== 2. Ein Shutdown-Befehl loest die Rueckfrage aus ===')
  const shutdown = await re.executeJavaScript(`
    (function () {
      const feld = document.querySelector('input.mono')
      if (!feld) return 'kein Eingabefeld'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(feld, 'server shutdown 1 0')
      feld.dispatchEvent(new Event('input', { bubbles: true }))
      const knopf = [...document.querySelectorAll('button')].find(b => /Senden|Send/i.test(b.textContent))
      if (!knopf) return 'kein Senden-Knopf'
      knopf.click()
      return 'geklickt'
    })()
  `)
  sag('  ' + shutdown)
  await warte(1200)

  const modal = await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.modal')
      if (!m) return JSON.stringify({ vorhanden: false })
      return JSON.stringify({
        vorhanden: true,
        titel: (m.querySelector('h3') || {}).textContent,
        text: m.textContent,
        knoepfe: [...m.querySelectorAll('button')].map(b => b.textContent.trim())
      })
    })()
  `)
  const m = JSON.parse(modal)
  sag('  ' + modal)
  pruefe(m.vorhanden === true, 'die Rueckfrage erscheint')
  if (m.vorhanden) {
    pruefe(/server shutdown 1 0/.test(m.text || ''), 'der Befehl steht in der Rueckfrage')
    pruefe(/herunterfahren|shutdown|shut down/i.test(m.titel || ''), 'die Ueberschrift nennt das Herunterfahren')
    pruefe((m.knoepfe || []).some(k => /Abbrechen|Cancel/i.test(k)), 'es gibt einen Abbrechen-Knopf')
    pruefe((m.knoepfe || []).some(k => /beenden|anyway/i.test(k)), 'es gibt einen Knopf zum Bestaetigen')
  }

  sag('')
  sag('=== 3. Abbrechen schliesst ohne zu senden ===')
  const abgebrochen = await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.modal')
      if (!m) return 'kein Modal'
      const knopf = [...m.querySelectorAll('button')].find(b => /Abbrechen|Cancel/i.test(b.textContent))
      if (!knopf) return 'kein Abbrechen-Knopf'
      knopf.click()
      return 'geklickt'
    })()
  `)
  sag('  ' + abgebrochen)
  await warte(800)
  const modalDanach = await re.executeJavaScript(`document.querySelectorAll('.modal').length`)
  pruefe(modalDanach === 0, 'nach "Abbrechen" ist die Rueckfrage zu')

  // Und: es darf nichts gesendet worden sein. Die Befehlsliste im Verlauf
  // muss unveraendert sein.
  const verlauf = await re.executeJavaScript(`
    (function () {
      const h = JSON.parse(localStorage.getItem('console.history') || '[]')
      return JSON.stringify(h.slice(0, 3).map(x => x.cmd))
    })()
  `)
  sag('  Verlauf (neueste zuerst): ' + verlauf)
  const gesendet = JSON.parse(verlauf).some(c => /shutdown/i.test(c))
  pruefe(!gesendet, 'es wurde kein Shutdown-Befehl gesendet')

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})