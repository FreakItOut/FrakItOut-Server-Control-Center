'use strict'

/*
 * Prueft die sechs neuen Funktionen in der echten Anwendung.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-neue-funktionen.js
 *
 *   1. Raten: nur verstellte Werte zeigen
 *   2. Module: An/Aus-Markierung und Filter
 *   3. Backup: "es wurde noch nie gesichert"
 *   4. Module: versionierte Sicherungen im Detail
 *   5. Zeichen: sortierbare Spalten
 *   6. Uebersicht: Kacheln fuer Raten und Module
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'neue-funktionen.txt')
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
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 180000)

  let f = null
  for (let i = 0; i < 100; i++) {
    if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }
  const re = f.webContents

  // Auf die App warten
  let bereit = false
  for (let i = 0; i < 80; i++) {
    await warte(500)
    const laenge = await re.executeJavaScript('document.body ? document.body.innerText.length : 0')
    if (laenge > 200) { bereit = true; break }
  }
  pruefe(bereit, 'die Anwendung ist geladen')

  // ---------- 1. Raten: nur verstellte Werte ----------
  sag('')
  sag('=== 1. Raten: nur verstellte Werte zeigen ===')
  await re.executeJavaScript("window.location.hash = '#/rates'; 'ok'")
  await warte(3500)

  const raten1 = await re.executeJavaScript(`
    (function () {
      const zeilen = document.querySelectorAll('.rates-gruppe .rate-zeile, .rates-gruppe input').length
      const schalter = [...document.querySelectorAll('input[type=checkbox]')].map(c => ({
        text: (c.closest('label') || {}).textContent || ''
      }))
      return JSON.stringify({ zeilen, schalter })
    })()
  `)
  sag('  ' + raten1)
  const r1 = JSON.parse(raten1)
  const filterDa = r1.schalter.some(s => /nur verstellte|only changed/i.test(s.text))
  pruefe(filterDa, 'der Schalter "nur verstellte Werte" ist da')

  const umgeschaltet = await re.executeJavaScript(`
    (function () {
      const c = [...document.querySelectorAll('input[type=checkbox]')].find(x => /nur verstellte|only changed/i.test((x.closest('label')||{}).textContent || ''))
      if (!c) return 'kein Schalter'
      if (!c.checked) c.click()
      return c.checked ? 'eingeschaltet' : 'nicht eingeschaltet'
    })()
  `)
  sag('  ' + umgeschaltet)
  await warte(800)
  const leer = await re.executeJavaScript(`
    (function () {
      const gruppen = document.querySelectorAll('.rates-gruppe')
      const eintraege = document.querySelectorAll('.rates-gruppe input[type=text]').length
      return JSON.stringify({ gruppen: gruppen.length, eintraege })
    })()
  `)
  sag('  ' + leer)
  const r1b = JSON.parse(leer)
  // Bei 96 Raten, alle auf Standard, muss der Filter alles ausblenden.
  pruefe(r1b.eintraege < 96, `der Filter blendet die Standardwerte aus (${r1b.eintraege} von 96 sichtbar)`)

  // ---------- 2. Module: An/Aus ----------
  sag('')
  sag('=== 2. Module: An/Aus-Markierung und Filter ===')
  await re.executeJavaScript("window.location.hash = '#/modules'; 'ok'")
  await warte(3500)

  const module1 = await re.executeJavaScript(`
    (function () {
      const aktive = document.querySelectorAll('.modules-status.aktiv').length
      const aus = document.querySelectorAll('.modules-status.aus').length
      const filter = document.querySelector('select')
      const optionen = filter ? [...filter.options].map(o => o.textContent.trim()) : []
      return JSON.stringify({ aktive, aus, optionen })
    })()
  `)
  sag('  ' + module1)
  const r2 = JSON.parse(module1)
  pruefe(r2.aktive > 0, `aktive Module sind markiert (${r2.aktive})`)
  pruefe(r2.aus > 0, `ausgeschaltete Module sind markiert (${r2.aus})`)
  pruefe(r2.optionen.length === 3, `der Filter hat drei Optionen (${r2.optionen.join(' | ')})`)

  // Filter auf "aus"
  await re.executeJavaScript(`
    (function () {
      const s = document.querySelector('select')
      if (!s) return
      const opt = [...s.options].find(o => /Ausgeschaltet|Disabled/i.test(o.textContent))
      if (!opt) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(s, opt.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })()
  `)
  await warte(700)
  const nachFilter = await re.executeJavaScript(`
    (function () {
      const eintraege = document.querySelectorAll('.modules-eintrag')
      const aktive = document.querySelectorAll('.modules-status.aktiv').length
      return JSON.stringify({ eintraege: eintraege.length, aktive })
    })()
  `)
  sag('  ' + nachFilter)
  const r2b = JSON.parse(nachFilter)
  pruefe(r2b.eintraege > 0 && r2b.aktive === 0,
    `nach dem Filter auf "aus" sind nur inaktive Module da (${r2b.eintraege}, davon aktiv ${r2b.aktive})`)

  // ---------- 3. Backup: nie gesichert ----------
  sag('')
  sag('=== 3. Backup: der Hinweis "noch nie gesichert" ===')
  await re.executeJavaScript("window.location.hash = '#/backup'; 'ok'")
  await warte(3500)
  const backup1 = await re.executeJavaScript(`
    (function () {
      const text = document.body.innerText
      return JSON.stringify({
        hatWarnung: /noch nie eine Sicherung|no backup has ever/i.test(text),
        hatMeldung: /automatische Sicherungsplan|automatic backup schedule/i.test(text),
        auszug: text.slice(0, 260)
      })
    })()
  `)
  sag('  ' + backup1)
  const r3 = JSON.parse(backup1)
  pruefe(r3.hatWarnung, 'die Seite sagt, dass noch nie gesichert wurde')
  pruefe(r3.hatMeldung, 'die Seite nennt den Grund (Zeitplan aus)')

  // ---------- 4. Module: Sicherungen im Detail ----------
  sag('')
  sag('=== 4. Module: Sicherungen im Detailbereich ===')
  await re.executeJavaScript("window.location.hash = '#/modules'; 'ok'")
  await warte(2500)
  const sicherungen = await re.executeJavaScript(`
    (function () {
      const text = document.body.innerText
      return JSON.stringify({
        hatSicherungen: /Sicherungen|Backups/i.test(text),
        hatHinweis: /Einzel-Sicherung|single backup/i.test(text)
      })
    })()
  `)
  sag('  ' + sicherungen)
  const r4 = JSON.parse(sicherungen)
  pruefe(r4.hatSicherungen, 'der Detailbereich zeigt die Sicherungen an')

  // ---------- 5. Zeichenliste: sortieren ----------
  sag('')
  sag('=== 5. Zeichenliste: sortieren ===')
  await re.executeJavaScript("window.location.hash = '#/characters'; 'ok'")
  await warte(4000)

  const sortierbar = await re.executeJavaScript(`
    (function () {
      const koepfe = [...document.querySelectorAll('th.sortable')]
      return JSON.stringify({
        anzahl: koepfe.length,
        namen: koepfe.map(k => k.textContent.trim())
      })
    })()
  `)
  sag('  ' + sortierbar)
  const r5 = JSON.parse(sortierbar)
  pruefe(r5.anzahl >= 6, `es sind ${r5.anzahl} sortierbare Spalten`)

  /*
   * Die Spalte "Stufe" anhand ihrer Ueberschrift suchen - nicht an
   * einer festen Nummer. Die Tabelle hat sieben Spalten, und die
   * Geschlechtsspalte sitzt zwischen Rasse und Stufe.
   *
   * "startsWith" statt "exakt": nach dem Klick steht der Sortierpfeil in
   * der Ueberschrift ("Stufe ▲").
   */
  const vorher = await re.executeJavaScript(`
    (function () {
      const koepfe = [...document.querySelectorAll('thead th')]
      const idx = koepfe.findIndex(k => /^(Stufe|Level)/i.test(k.textContent.trim()))
      if (idx < 0) return JSON.stringify({ fehler: 'keine Stufenspalte', koepfe: koepfe.map(k => k.textContent.trim()) })
      const z = [...document.querySelectorAll('tbody tr')].slice(0, 4).map(r => (r.querySelectorAll('td')[idx]||{}).textContent)
      return JSON.stringify({ idx, werte: z })
    })()
  `)
  await re.executeJavaScript(`
    (function () {
      const k = [...document.querySelectorAll('th.sortable')].find(x => /Stufe|Level/i.test(x.textContent))
      if (!k) return
      k.click()
    })()
  `)
  // Auf das Neuladen warten - die Liste wird neu geholt.
  let nachher = { werte: [] }
  for (let i = 0; i < 30; i++) {
    await warte(400)
    nachher = JSON.parse(await re.executeJavaScript(`
      (function () {
        const koepfe = [...document.querySelectorAll('thead th')]
        const idx = koepfe.findIndex(k => /^(Stufe|Level)/i.test(k.textContent.trim()))
        if (idx < 0) return JSON.stringify({ werte: [] })
        const z = [...document.querySelectorAll('tbody tr')].slice(0, 4).map(r => (r.querySelectorAll('td')[idx]||{}).textContent)
        return JSON.stringify({ idx, werte: z })
      })()
    `))
    if (nachher.werte && nachher.werte.length) break
  }
  sag('  vorher: ' + vorher)
  sag('  nachher: ' + JSON.stringify(nachher))
  const r5b = nachher
  const stufen = (r5b.werte || []).map(z => parseInt(String(z).replace(/\D/g, ''), 10)).filter(n => !isNaN(n))
  const sortiert = stufen.length > 0 && stufen.every((w, i) => i === 0 || stufen[i - 1] >= w)
  pruefe(sortiert, 'nach dem Klick auf "Stufe" ist absteigend sortiert')

  // ---------- 6. Uebersicht: Kacheln ----------
  sag('')
  sag('=== 6. Uebersicht: Kacheln fuer Raten und Module ===')
  await re.executeJavaScript("window.location.hash = '#/'; 'ok'")
  await warte(4000)
  const uebersicht = await re.executeJavaScript(`
    (function () {
      const text = document.body.innerText
      const kacheln = [...document.querySelectorAll('.stat')].map(s => s.innerText.replace(/\\n/g, ' | '))
      return JSON.stringify({ kacheln, hatRaten: /Server Raten|Server rates/i.test(text), hatModule: /Module/i.test(text) })
    })()
  `)
  sag('  ' + uebersicht)
  const r6 = JSON.parse(uebersicht)
  pruefe(r6.hatRaten, 'die Uebersicht zeigt die Raten-Kachel')
  pruefe(r6.hatModule, 'die Uebersicht zeigt die Modul-Kachel')
  sag('  Kacheln: ' + (r6.kacheln || []).join('  //  '))

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})