'use strict'

/*
 * Prueft, dass die Antwort des Worldserver im Fenster erscheint.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-befehlsausgabe.js
 *
 * Anlass: Das Panel holte die Antwort des Servers und zeigte stattdessen
 * nur "gesendet (HTTP 200)". Drei Seiten waren betroffen:
 *
 *   Konsolen Befehl   - vollstaendige Ausgabe fehlt
 *   Schnellaktionen   - nur "Gesendet"
 *   GM-Werkzeuge      - nur "Gesendet"
 *
 * Geprueft wird der sichtbare Text, nicht der Quelltext. Ein Test auf die
 * Quellen wuerde bestehen, auch wenn die Ausgabe im Fenster wieder
 * verschwaende.
 *
 * Voraussetzung: der Worldserver laeuft. Gesendet wird ausschliesslich
 * "server info", das nichts veraendert.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'befehlsausgabe.txt')
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

// Zeichen, die nur im Wortlaut des Servers stehen. "AzerothCore" kommt in
// keinem Bedienelement vor und kann deshalb nicht von einem Label
// stammen.
const SERVERTEXT = /AzerothCore rev\./

app.whenReady().then(async () => {
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 90000)

  let f = null
  for (let i = 0; i < 100; i++) {
    if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }
  const re = f.webContents

  // ---------- 1. Befehl wirklich senden ----------
  sag('=== 1. Befehl senden ===')
  await re.executeJavaScript("window.location.hash = '#/console'; 'ok'")
  await warte(3000)

  const gesendet = await re.executeJavaScript(`
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
  sag(`  ${gesendet}`)
  pruefe(gesendet === 'geklickt', 'der Befehl wurde abgeschickt')

  // Warten, bis die Antwort da ist
  let gefunden = false
  for (let i = 0; i < 40; i++) {
    await warte(500)
    const hat = await re.executeJavaScript(`
      (function () {
        const p = document.querySelector('.befehl-ausgabe')
        return p ? p.textContent.length : 0
      })()
    `)
    if (hat > 20) { gefunden = true; break }
  }

  sag('')
  sag('=== 2. Die Ausgabe im Fenster ===')
  const ausgabe = await re.executeJavaScript(`
    (function () {
      const p = document.querySelector('.befehl-ausgabe')
      if (!p) return null
      return JSON.stringify({
        text: p.textContent,
        zeilen: p.textContent.split('\\n').length,
        whiteSpace: getComputedStyle(p).whiteSpace
      })
    })()
  `)

  if (ausgabe) {
    const a = JSON.parse(ausgabe)
    sag(`  Zeilen: ${a.zeilen}   white-space: ${a.whiteSpace}`)
    for (const z of a.text.split('\n').slice(0, 7)) sag(`    ${z}`)
    pruefe(SERVERTEXT.test(a.text), 'der Wortlaut des Servers steht im Fenster')
    pruefe(a.zeilen >= 2, `die Ausgabe behält ihre Zeilenumbrüche (${a.zeilen} Zeilen)`)
    pruefe(/pre-wrap/.test(a.whiteSpace),
      'die Zeilenumbrüche werden angezeigt und nicht zusammengezogen')
  } else {
    pruefe(false, 'die Ausgabe erscheint im Fenster')
  }

  // Gegenprobe: die Meldung ohne Ausgabe waere genug gewesen
  sag('')
  sag('=== 3. Gegenprobe ===')
  const text = await re.executeJavaScript('document.body.innerText')
  pruefe(SERVERTEXT.test(text), 'der Servertext steht irgendwo im Fenster')
  pruefe(/HTTP 200/.test(text), 'die Erfolgsmeldung steht weiterhin da')

  // ---------- 4. Verlauf ----------
  sag('')
  sag('=== 4. Verlauf ===')
  const verlauf = await re.executeJavaScript(`
    (function () {
      const zeilen = [...document.querySelectorAll('tbody tr')]
      const mitAntwort = zeilen.filter(z => z.querySelectorAll('td').length === 3)
      const letzte = mitAntwort[0]
      return JSON.stringify({
        zeilen: mitAntwort.length,
        koepfe: [...document.querySelectorAll('thead th')].map(t => t.textContent),
        antwort: letzte ? (letzte.querySelectorAll('td')[2] || {}).textContent : null
      })
    })()
  `)
  const v = JSON.parse(verlauf)
  sag(`  Verlaufszeilen mit drei Spalten: ${v.zeilen}`)
  sag(`  Spaltenköpfe: ${v.koepfe.join(' | ')}`)
  sag(`  Antwort der letzten Zeile: ${(v.antwort || '').slice(0, 80)}`)
  pruefe(v.zeilen > 0, 'der Verlauf hat die neue Spalte')
  pruefe(SERVERTEXT.test(v.antwort || ''), 'der Verlauf merkt sich die Antwort')

  // Und gespeichert, nicht nur angezeigt
  const gespeichert = await re.executeJavaScript(`
    (function () {
      try {
        const h = JSON.parse(localStorage.getItem('console.history') || '[]')
        return JSON.stringify(h.length ? { n: h.length, out: String(h[0].out || '').slice(0, 60), ok: h[0].ok } : { n: 0 })
      } catch (e) { return '{"n":-1}' }
    })()
  `)
  const g = JSON.parse(gespeichert)
  sag(`  in localStorage: ${g.n} Eintraege, erste Antwort "${g.out || ''}"`)
  pruefe(g.n > 0 && SERVERTEXT.test(g.out || ''), 'die Antwort ueberlebt bis zum naechsten Start')

  // ---------- 5. Kuerzung auf eine Zeile ----------
  sag('')
  sag('=== 5. Ausgabe wird fuer den Verlauf auf eine Zeile gekuerzt ===')
  /*
   * Die vollstaendige Ausgabe hat 11 Zeilen. In der Verlaufsspalte darf
   * davon nur eine stehen - sonst waere die Tabelle unlesbar.
   *
   * Das prueft zugleich den Helfer ersteZeile: er bekommt hier eine
   * mehrzeilige Ausgabe und muss daraus eine Zeile machen.
   */
  const zellen = await re.executeJavaScript(`
    (function () {
      const z = [...document.querySelectorAll('tbody tr')]
        .map(r => r.querySelectorAll('td')[2])
        .filter(Boolean)
        .map(td => td.textContent)
      return JSON.stringify({ erste: z[0] || '', voll: z })
    })()
  `)
  const zz = JSON.parse(zellen)
  const zeilenInZelle = (zz.erste || '').split('\n').length
  sag(`  Zeilen in der Zelle: ${zeilenInZelle}`)
  sag(`  Inhalt: ${(zz.erste || '').slice(0, 80)}`)
  pruefe(zeilenInZelle === 1, `die Ausgabe steht als eine Zeile in der Spalte (${zeilenInZelle})`)
  pruefe(SERVERTEXT.test(zz.erste || ''), 'die gekuerzte Zelle nennt den Server')

  // ---------- 6. Was der Test nicht deckt ----------
  sag('')
  sag('=== 6. Was dieser Test nicht abdeckt ===')
  /*
   * Der Kurzhinweis der Schnellaktionen und der GM-Werkzeuge wird hier
   * nicht ausgeloest: dafuer braucht es einen eingeloggten Spieler, und
   * auf diesem Server ist gerade niemand angemeldet.
   *
   * Statt zu raten wird deshalb nachgesehen, ob beide Stellen den Helfer
   * ueberhaupt benutzen. Das ist schwaecher als eine Bildschirmpruefung
   * und wird auch so benannt.
   */
  const wurzel = path.join(__dirname, '..')
  for (const [datei, muster] of [
    ['src/pages/Online.jsx', /ersteZeile\(res\.antwort\)/],
    ['src/pages/GmTools.jsx', /ersteZeile\(res\.antwort\)/]
  ]) {
    const inhalt = fs.readFileSync(path.join(wurzel, datei), 'utf8')
    const ok = muster.test(inhalt)
    sag(`  ${ok ? 'OK  ' : 'FEHLT'}  ${datei} ruft ersteZeile(res.antwort)`)
    pruefe(ok, `${datei} zeigt die erste Zeile der Antwort im Kurzhinweis`)
  }
  sag('  Die Anzeige des Kurzhinweises selbst ist damit nicht geprueft - dafuer')
  sag('  muesste ein Spieler angemeldet sein.')

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})