'use strict'

/*
 * Prueft, dass die Programmversion nirgends mehr angezeigt wird.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-startmeldung.js
 *
 * Geprueft wird nicht der Quelltext, sondern das, was tatsaechlich auf dem
 * Bildschirm steht - Titelleiste, Uebersicht-Dashboard und alle Seiten. Ein
 * Rest im Build oder in der anderen Sprache wuerde hier auffallen.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'startmeldung.txt')
const zeilen = []
fs.writeFileSync(BERICHT, '', 'utf8')
const sag = z => {
  zeilen.push(String(z))
  fs.appendFileSync(BERICHT, String(z) + '\n', 'utf8')
}
let schlecht = 0
const pruefe = (c, l) => {
  if (c) sag('  OK   ' + l)
  else { schlecht++; sag('  FAIL ' + l) }
}

/*
 * Nach welcher Version wird gesucht?
 *
 * Drei Ansaetze, drei Fehlschlaege - jeder erst am echten Bildschirm:
 *
 *   /\d+\.\d+\.\d+/              traf das Datum "16.10.2026" in der
 *                                Titelleiste und meldete 16 Funde auf
 *                                16 Seiten
 *   /\b\d+\.\d+\.\d{1,2}\b/      fand "v2.7.1" nicht (keine Wortgrenze
 *                                zwischen v und 2) und traf "127.0.0.1"
 *   /(?<![\d.])\d+\.\d+\.\d{1,2}(?![.\d])/
 *                                besser, aber weiterhin zu breit: es
 *                                meldete "15.10.26" aus dem Login-Protokoll
 *                                und die Client-Version "3.3.5" aus einem
 *                                Kommentar der worldserver.conf
 *
 * Diese drei Treffer sind echter, richtiger Text. Eine Datumsanzeige und
 * ein Kommentar aus der Serverkonfiguration sollen keine Versionsnummer
 * sein - sie sind es auch nicht, und kein Muster kann das unterscheiden.
 *
 * Deshalb wird gezielt gesucht: nach der Version dieses Programms. Die
 * steht in package.json, wird also nicht fest verdrahtet - erhoeht der
 * Entwickler auf 1.1.0, sucht derselbe Test danach.
 */
const VERSION = require('../package.json').version

// Woertliches Vorkommen. "{version}" waere der Platzhalter, den die
// Uebersetzung vor der Aenderung bekommen hat.
function versionGefunden (text) {
  if (!text) return null
  if (text.includes('{' + 'version}')) return 'Platzhalter {version}'
  const i = text.indexOf(VERSION)
  if (i < 0) return null
  // Nicht den Client 3.3.5 oder ein Datum als Version lesen: es muss
  // wirklich diese drei Ziffern hintereinander stehen.
  return text.slice(Math.max(0, i - 40), i + VERSION.length + 40).replace(/\s+/g, ' ').trim()
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
  sag(`  Fenster gefunden. Gesucht wird nach Version ${VERSION}.`)

  const re = f.webContents

  // ---------- 1. Titelleiste ----------
  sag('')
  sag('=== 1. Titelleiste ===')
  const titel = f.getTitle()
  sag(`  "${titel}"`)
  const inTitel = versionGefunden(titel)
  pruefe(!inTitel, 'die Titelleiste nennt keine Version')
  if (inTitel) sag(`    gefunden: ${inTitel}`)

  // ---------- 2. Startmeldung ----------
  sag('')
  sag('=== 2. Startmeldung auf dem Uebersicht-Dashboard ===')
  await re.executeJavaScript("window.location.hash = '#/'; 'ok'")
  await warte(3000)
  const protokoll = await re.executeJavaScript(`
    (function () {
      return [...document.querySelectorAll('.console *')]
        .map(e => (e.childElementCount === 0 ? e.textContent : ''))
        .filter(t => t && t.trim())
    })()
  `)
  const erste = (protokoll[0] || '').trim()
  sag(`  erste Zeile: "${erste}"`)
  pruefe(/gestartet|started/.test(erste), 'die Startmeldung steht da')
  const treffer = protokoll.map(z => versionGefunden(z)).filter(Boolean)
  pruefe(treffer.length === 0, `keine Zeile des Protokolls nennt die Version (${treffer.length})`)
  treffer.forEach(t => sag(`    gefunden: ${t}`))

  // ---------- 3. ganze Uebersicht ----------
  sag('')
  sag('=== 3. Die ganze Uebersicht ===')
  const uebersicht = await re.executeJavaScript('document.body.innerText')
  const iu = versionGefunden(uebersicht)
  pruefe(!iu, 'die Uebersicht nennt die Version nicht')
  if (iu) sag(`    gefunden: ${iu}`)

  // ---------- 4. Seitenleiste ----------
  sag('')
  sag('=== 4. Seitenleiste ===')
  const leiste = await re.executeJavaScript(`
    [...document.querySelectorAll('.sidebar *')].map(e => e.textContent).join(' | ')
  `)
  const ile = versionGefunden(leiste)
  pruefe(!ile, 'die Seitenleiste nennt keine Version')
  if (ile) sag(`    gefunden: ${ile}`)

  // ---------- 5. alle Seiten, beide Sprachen ----------
  sag('')
  sag('=== 5. Alle Seiten ===')
  const seiten = ['/', '/server', '/realms', '/accounts', '/characters', '/online',
    '/bots', '/rates', '/modules', '/bans', '/gm', '/console', '/config',
    '/backup', '/settings', '/options']
  const funde = []
  for (const s of seiten) {
    await re.executeJavaScript(`window.location.hash = '#${s}'; 'ok'`)
    await warte(800)
    const text = await re.executeJavaScript('document.body.innerText')
    const t = versionGefunden(text)
    if (t) funde.push({ s, t })
  }
  pruefe(funde.length === 0, `keine der ${seiten.length} Seiten nennt die Version (${funde.length})`)
  funde.forEach(x => sag(`    ${x.s}: ${x.t}`))

  // ---------- 6. die andere Sprache ----------
  sag('')
  sag('=== 6. Englische Oberflaeche ===')
  /*
   * Die Startmeldung gibt es zweimal, in de.js und in en.js. Ein Test,
   * der nur Deutsch sieht, haelt einen englischen Rest fuer gruen -
   * so ist das hier schon einmal passiert, bei den Modultexten.
   */
  const umgestellt = await re.executeJavaScript(`
    (function () {
      const waehler = [...document.querySelectorAll('select')]
        .find(s => [...s.options].some(o => /Deutsch|English/.test(o.textContent)))
      if (!waehler) return 'kein Sprachwaehler'
      const en = [...waehler.options].find(o => /English/.test(o.textContent))
      if (!en) return 'keine englische Option'
      waehler.value = en.value
      waehler.dispatchEvent(new Event('change', { bubbles: true }))
      return 'umgestellt'
    })()
  `)
  sag(`  ${umgestellt}`)
  await warte(2500)
  await re.executeJavaScript("window.location.hash = '#/'; 'ok'")
  await warte(2500)
  const enProtokoll = await re.executeJavaScript(`
    (function () {
      return [...document.querySelectorAll('.console *')]
        .map(e => (e.childElementCount === 0 ? e.textContent : ''))
        .filter(t => t && t.trim())
    })()
  `)
  const enErste = (enProtokoll[0] || '').trim()
  sag(`  erste Zeile: "${enErste}"`)
  pruefe(/started/i.test(enErste), 'die englische Startmeldung steht da')
  const enTreffer = enProtokoll.map(z => versionGefunden(z)).filter(Boolean)
  pruefe(enTreffer.length === 0, `keine englische Protokollzeile nennt die Version (${enTreffer.length})`)
  enTreffer.forEach(t => sag(`    gefunden: ${t}`))

  const enUebersicht = await re.executeJavaScript('document.body.innerText')
  const ien = versionGefunden(enUebersicht)
  pruefe(!ien, 'die englische Uebersicht nennt die Version nicht')
  if (ien) sag(`    gefunden: ${ien}`)

  // ---------- 7. Gegenprobe ----------
  sag('')
  sag('=== 7. Gegenprobe ===')
  /*
   * Ein Test, der nur deshalb gruen ist, weil er nichts findet, beweist
   * nichts. Also nachsehen, ob dieselbe Suche einen eingebauten Text
   * findet - und dass sie echte Versionsnummern erkennt.
   */
  const echteFassung = 'FrakItOut Server Control Center 1.0.0 für Azeroth-Core gestartet ... OK'
  const gef = versionGefunden(echteFassung)
  pruefe(Boolean(gef), `eine echte Anzeige mit Version wird erkannt (${gef ? 'gefunden' : 'uebersehen'})`)
  if (!gef) sag(`    Muster erkennt "${echteFassung}" nicht`)

  const harmlos = [
    'Letzte Anmeldung: 15.10.26, 16:30',
    'On 3.3.5 client always shows log message',
    'Datenbank 127.0.0.1:3306',
    '16.10.2026 04:34:05'
  ]
  const faelsch = harmlos.filter(t => versionGefunden(t))
  pruefe(faelsch.length === 0, `Datumsangaben und Client-Version gelten nicht als Panel-Version (${faelsch.length})`)
  faelsch.forEach(t => sag(`    faelschlich gemeldet: ${t}`))

  const platzhalter = versionGefunden('gestartet {version} ... OK')
  pruefe(Boolean(platzhalter), `ein vergessener Platzhalter wird erkannt (${platzhalter || 'uebersehen'})`)

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})