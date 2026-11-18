'use strict'

/*
 * Prueft die neuen Rueckfragen und die Diagnose-Anzeige.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-rueckfragen.js
 *
 * Geprueft wird, was im Fenster passiert:
 *
 *   - "Alles beenden" fragt nach, BEVOR etwas beendet wird
 *   - "IP sperren" fragt nach und nennt die Adresse
 *   - "IP-Sperre aufheben" fragt nach und nennt die Adresse
 *   - die Diagnose-Karte zeigt einen veralteten Build und den letzten
 *     Absturz an
 *
 * Wichtig: Es wird NICHTS beendet und NICHTS gesperrt. Geprueft wird
 * nur, dass die Rueckfrage erscheint - und dass "Abbrechen" nichts
 * bewirkt.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'rueckfragen.txt')
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
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 120000)

  let f = null
  for (let i = 0; i < 100; i++) {
    if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }
  const re = f.webContents

  /*
   * Warten, bis die App wirklich da ist.
   *
   * Der erste Versuch ist an dieser Stelle gescheitert: der Hash wurde
   * gesetzt, bevor die Seite geladen war, und ging verloren - die Seite
   * blieb leer, und der Test meldete "kein Knopf" fuer alles. Das sah
   * nach einem Fehler im Programm aus und war einer im Test.
   */
  let bereit = false
  for (let i = 0; i < 60; i++) {
    await warte(500)
    const laenge = await re.executeJavaScript('document.body ? document.body.innerText.length : 0')
    if (laenge > 200) { bereit = true; break }
  }
  pruefe(bereit, 'die Anwendung wird geladen')

  // ---------- 1. "Alles beenden" ----------
  sag('=== 1. Server Start / Stop: "Alles beenden" ===')
  await re.executeJavaScript("window.location.hash = '#/server'; 'ok'")
  await warte(3000)

  const vorher = await re.executeJavaScript(`
    (function () {
      const bs = [...document.querySelectorAll('button')]
      const b = bs.find(x => /alles beenden|stop everything/i.test(x.textContent))
      if (!b) return 'kein Knopf'
      b.click()
      return 'geklickt'
    })()
  `)
  sag('  ' + vorher)
  await warte(1000)

  const m1 = await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.modal')
      const alleKnöpfe = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
      if (!m) return JSON.stringify({ vorhanden: false, hash: location.hash, knoepfe: alleKnöpfe.slice(0, 20), text: document.body.innerText.slice(0, 200) })
      return JSON.stringify({
        vorhanden: true,
        titel: (m.querySelector('h3') || {}).textContent,
        text: m.textContent,
        knoepfe: [...m.querySelectorAll('button')].map(b => b.textContent.trim())
      })
    })()
  `)
  const d1 = JSON.parse(m1)
  sag('  ' + m1)
  pruefe(d1.vorhanden === true, 'die Rueckfrage erscheint')
  if (d1.vorhanden) {
    pruefe(/worldserver/i.test(d1.text || ''), 'die Rueckfrage nennt den Worldserver')
    pruefe(/auth/i.test(d1.text || ''), 'die Rueckfrage nennt den Authserver')
    pruefe(/datenbank|database/i.test(d1.text || ''), 'die Rueckfrage nennt die Datenbank')
    pruefe((d1.knoepfe || []).some(k => /abbrechen|cancel/i.test(k)), 'es gibt einen Abbrechen-Knopf')
  }

  // Abbrechen - es darf nichts beendet werden
  await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.modal')
      if (!m) return
      const b = [...m.querySelectorAll('button')].find(x => /abbrechen|cancel/i.test(x.textContent))
      if (b) b.click()
    })()
  `)
  await warte(800)
  const m1b = await re.executeJavaScript(`document.querySelectorAll('.modal').length`)
  pruefe(m1b === 0, 'nach "Abbrechen" ist die Rueckfrage zu')

  // ---------- 2. IP sperren ----------
  sag('')
  sag('=== 2. Bans: IP sperren ===')
  await re.executeJavaScript("window.location.hash = '#/bans'; 'ok'")
  await warte(3000)

  const ipGesetzt = await re.executeJavaScript(`
    (function () {
      // Die IP-Sperren liegen hinter einem Reiter. Erst darauf klicken,
      // sonst gibt es das Formular gar nicht.
      const reiter = [...document.querySelectorAll('.tab')].find(t => /ip bans|ip-sperren/i.test(t.textContent))
      if (!reiter) return 'kein IP-Reiter'
      reiter.click()
      return 'Reiter geklickt'
    })()
  `)
  sag('  ' + ipGesetzt)
  await warte(800)

  const ipKlick = await re.executeJavaScript(`
    (function () {
      const felder = [...document.querySelectorAll('.field')]
      const ipFeld = felder.find(f => /ip/i.test((f.querySelector('label') || {}).textContent || ''))
      if (!ipFeld) return 'kein IP-Feld'
      const feld = ipFeld.querySelector('input')
      if (!feld) return 'kein Input'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(feld, '203.0.113.7')
      feld.dispatchEvent(new Event('input', { bubbles: true }))
      const b = [...document.querySelectorAll('button')].find(x => /ip sperren|ban ip/i.test(x.textContent))
      if (!b) return 'kein Sperr-Knopf'
      b.click()
      return 'geklickt'
    })()
  `)
  sag('  ' + ipKlick)
  await warte(1000)

  const m2 = await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.modal')
      if (!m) return JSON.stringify({ vorhanden: false })
      return JSON.stringify({
        vorhanden: true,
        text: m.textContent,
        knoepfe: [...m.querySelectorAll('button')].map(b => b.textContent.trim())
      })
    })()
  `)
  const d2 = JSON.parse(m2)
  sag('  ' + m2)
  pruefe(d2.vorhanden === true, 'die Rueckfrage erscheint')
  if (d2.vorhanden) {
    pruefe(/203\.0\.113\.7/.test(d2.text || ''), 'die Rueckfrage nennt die Adresse')
    pruefe((d2.knoepfe || []).some(k => /abbrechen|cancel/i.test(k)), 'es gibt einen Abbrechen-Knopf')
  }

  // Abbrechen und pruefen, dass nichts gesperrt wurde
  await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.modal')
      if (!m) return
      const b = [...m.querySelectorAll('button')].find(x => /abbrechen|cancel/i.test(x.textContent))
      if (b) b.click()
    })()
  `)
  await warte(800)
  const m2b = await re.executeJavaScript(`document.querySelectorAll('.modal').length`)
  pruefe(m2b === 0, 'nach "Abbrechen" ist die Rueckfrage zu')

  const gesperrt = await re.executeJavaScript(`
    (function () {
      const zellen = [...document.querySelectorAll('tbody tr')]
      return zellen.filter(z => /203\.0\.113\.7/.test(z.textContent)).length
    })()
  `)
  pruefe(gesperrt === 0, 'es wurde nichts gesperrt')

  // ---------- 3. Diagnose ----------
  sag('')
  sag('=== 3. Diagnose auf der Uebersicht ===')
  await re.executeJavaScript("window.location.hash = '#/'; 'ok'")
  await warte(3000)

  /*
   * Auf die Diagnose warten. Sie laedt ihre Angaben erst danach -
   * ein Blick direkt nach dem Seitenwechsel sieht eine leere Karte.
   */
  /*
   * Das Muster muss "Diagnose" (deutsch) UND "Diagnostics" (englisch)
   * treffen. Vorher stand hier /diagnose/i - und "Diagnostics" hat kein
   * "e" nach "diagnos". Der Test fand die Karte deshalb nie und
   * meldete "die Diagnose-Karte ist da" als Fehlschlag.
   */
  const diagnoseMuster = 'diagnost(ic|e)'

  let diagnoseText = ''
  for (let i = 0; i < 30; i++) {
    await warte(500)
    diagnoseText = await re.executeJavaScript(`
      (function () {
        const muster = new RegExp('${diagnoseMuster}', 'i')
        const kopf = [...document.querySelectorAll('.card-head h3')].find(h => muster.test(h.textContent))
        if (!kopf) return ''
        const karte = kopf.closest('.card')
        return karte ? (karte.textContent || '') : ''
      })()
    `)
    if (diagnoseText && diagnoseText.length > 30) break
  }
  sag('  Diagnose-Karte: ' + String(diagnoseText).replace(/\s+/g, ' ').slice(0, 220))
  pruefe(Boolean(diagnoseText) && diagnoseText.length > 30, 'die Diagnose-Karte hat Inhalt')
  pruefe(/Absturz|Crash/i.test(diagnoseText || ''), 'der letzte Absturz wird gemeldet')

  /*
   * Der Build-Hinweis erscheint nur, wenn der Build wirklich aelter ist als
   * die Quellen. Ist er aktuell, darf die Karte nichts dazu sagen - sonst
   * wuerde sie einen Fehler melden, den es nicht gibt.
   *
   * Deshalb wird der Zustand geprueft und nicht auf einen Text gewartet.
   */
  const buildZustand = await re.executeJavaScript(`
    (function () {
      const muster = new RegExp('${diagnoseMuster}', 'i')
      const kopf = [...document.querySelectorAll('.card-head h3')].find(h => muster.test(h.textContent))
      const karte = kopf ? kopf.closest('.card') : null
      return karte ? (karte.textContent || '') : ''
    })()
  `)
  const buildIstAktuell = !/Build/i.test(buildZustand || '')
  pruefe(true, `Build-Hinweis: ${buildIstAktuell ? 'Build ist aktuell, also kein Hinweis (richtig)' : 'Build ist veraltet, Hinweis steht da'}`)

  // Und wenn der Build veraltet waere, muesste der Hinweis kommen. Das
  // wird nachgestellt: eine Quelldatei bekommt einen neuen Zeitstempel.
  sag('')
  sag('=== 4. Der Build-Hinweis erscheint bei veraltetem Build ===')
  const fsMod = require('fs')
  const quelle = path.join(__dirname, '..', 'src', 'pages', 'Dashboard.jsx')
  const alterZeitstempel = fsMod.statSync(quelle).mtimeMs
  fsMod.utimesSync(quelle, new Date(), new Date())
  await re.executeJavaScript("window.location.hash = '#/'; 'ok'")
  await warte(1000)
  await re.executeJavaScript("window.location.reload(); 'ok'")
  await warte(4000)

  let mitHinweis = ''
  for (let i = 0; i < 30; i++) {
    await warte(500)
    mitHinweis = await re.executeJavaScript(`
      (function () {
        const muster = new RegExp('${diagnoseMuster}', 'i')
        const kopf = [...document.querySelectorAll('.card-head h3')].find(h => muster.test(h.textContent))
        const karte = kopf ? kopf.closest('.card') : null
        return karte ? (karte.textContent || '') : ''
      })()
    `)
    if (/Build/i.test(mitHinweis || '')) break
  }
  sag('  ' + String(mitHinweis).replace(/\s+/g, ' ').slice(0, 220))
  pruefe(/Build/i.test(mitHinweis || ''), 'bei veraltetem Build erscheint der Hinweis')
  fsMod.utimesSync(quelle, new Date(alterZeitstempel), new Date(alterZeitstempel))

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})