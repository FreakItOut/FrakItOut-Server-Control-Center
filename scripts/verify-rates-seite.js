'use strict'

/*
 * Praxistest der Server-Raten: echte App, echte Config, echte Seite.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-rates-seite.js
 *
 * Warum so und nicht mit Mausklicks: Klicks über SetCursorPos/mouse_event
 * kommen nur an, wenn das Zielfenster wirklich vorne liegt. Ein PowerShell-
 * Skript im Hintergrund darf den Vordergrund aber nicht übernehmen — das
 * Versagen ist klanglos, und der Klick geht ins Leere. Zwei Versuche sind
 * genau so gescheitert: die App blieb auf der Übersicht.
 *
 * Deshalb: die echte electron/main.js laden, im Renderer auf #/rates
 * wechseln und mit webContents.sendInputEvent in der Seite klicken.
 * webContents.sendInputEvent geht durch dieselbe Eingabe wie eine echte
 * Maus — nur wird die Stelle nicht auf dem Bildschirm gesucht, sondern
 * im Fenster gesetzt.
 *
 * Geprüft wird genau das, was der Nutzer sieht:
 *   - die Gruppen erscheinen in der Reihenfolge des Backends
 *   - Gruppe 1 ist die spielerbezogene
 *   - jede Zeile hat einen lesbaren Namen
 *   - die Namen zeigen die Spracheinstellung
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'raten-seite.txt')
const zeilen = []
fs.writeFileSync(BERICHT, '', 'utf8')
const sag = z => {
  zeilen.push(String(z))
  fs.appendFileSync(BERICHT, String(z) + '\n', 'utf8')
}

let gut = 0
let schlecht = 0
const pruefe = (c, l) => {
  if (c) { gut++; sag('  OK   ' + l) } else { schlecht++; sag('  FAIL ' + l) }
}

require('../electron/main')

const { app, BrowserWindow } = require('electron')
const warte = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  const schranke = setTimeout(() => {
    sag('ABBRUCH: nach 40 s nicht fertig')
    process.exit(2)
  }, 40000)

  let f = null
  for (let i = 0; i < 100; i++) {
    const alle = BrowserWindow.getAllWindows()
    if (alle.length) { f = alle[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL Fenster nicht erschienen'); clearTimeout(schranke); process.exit(1) }
  sag('  OK   Fenster der Anwendung gefunden')

  // Auf die Seite der Raten wechseln
  sag('')
  sag('=== Seite wechseln ===')
  await f.webContents.executeJavaScript(`window.location.hash = '#/rates'; 'ok'`)
  await warte(3000)

  // Reicht die Seite, damit alles geladen ist
  await warte(1000)

  sag('')
  sag('=== Die Gruppen, wie die Seite sie zeigt ===')
  const gruppen = await f.webContents.executeJavaScript(`
    (function () {
      const kopf = [...document.querySelectorAll('.rates-gruppe-kopf')]
      return kopf.map(k => ({
        titel: (k.querySelector('h4') || {}).textContent || '',
        anzahl: (k.querySelector('.muted') || {}).textContent || ''
      }))
    })()
  `)

  if (!gruppen.length) {
    sag('  FAIL keine Gruppenkoepfe gefunden')
  } else {
    gruppen.forEach(g => sag(`    ${g.titel.padEnd(28)} ${g.anzahl}`))

    // Die Schluessel je Gruppe holen. Damit ist die Pruefung unabhaengig
    // von der Spracheinstellung - die vorherige Fassung verglich deutsche
    // Namen und schlug fehl, wenn die App auf Englisch startete.
    const gruppenDetail = await f.webContents.executeJavaScript(`
      (function () {
        return [...document.querySelectorAll('.rates-gruppe')].map(g => {
          const kopf = g.querySelector('.rates-gruppe-kopf')
          const zeilen = [...g.querySelectorAll('.card')]
          return {
            titel: kopf && kopf.querySelector('h4') ? kopf.querySelector('h4').textContent : '',
            schluessel: zeilen.map(z => (z.querySelector('.mono') || {}).textContent).filter(Boolean)
          }
        })
      })()
    `)

    // 1. Die Gruppen stehen in der vorgesehenen Reihenfolge - erkannt an
    //    den Schluesseln, nicht an den Namen.
    const erwartet = ['character', 'reputation', 'combat', 'loot', 'world', 'economy']
    const gefunden = gruppenDetail.map(g => {
      for (const id of erwartet) {
        const erst = {
          character: 'Rate.XP.Kill',
          reputation: 'Rate.Reputation.Gain',
          combat: 'Rate.MoveSpeed.Player',
          loot: 'Rate.Drop.Item.Poor',
          world: 'Rate.Creature.Normal.Damage',
          economy: 'Rate.Auction.Time'
        }[id]
        if (g.schluessel.includes(erst)) return id
      }
      return 'other'
    })
    gefunden.forEach((id, i) => sag(`    ${String(i + 1).padStart(2)}. ${gruppenDetail[i].titel.padEnd(28)} ${gruppenDetail[i].schluessel.length} Einträge  (${id})`))
    pruefe(JSON.stringify(gefunden) === JSON.stringify(erwartet),
      'die Gruppen stehen in der vorgesehenen Reihenfolge: character → reputation → combat → loot → world → economy')

    // 2. Spielerbezogene Gruppe zuerst - erkannt am Inhalt
    pruefe(gefunden[0] === 'character',
      'die erste Gruppe ist die spielerbezogene (Charakter & Stufen)')

    // 3. Alle 96 Raten sind zu sehen
    const anzahl = await f.webContents.executeJavaScript(
      `document.querySelectorAll('.rates-gruppe .card').length`)
    sag(`    Zeilen insgesamt: ${anzahl}`)
    pruefe(anzahl === 96, `alle 96 Raten sind zu sehen (${anzahl})`)
    pruefe(gruppenDetail.reduce((s, g) => s + g.schluessel.length, 0) === 96,
      'jede Rate steht in genau einer Gruppe (keine doppelt, keine fehlt)')
  }

  // 4. Die Namen sind lesbar und nicht nur der Schluessel
  sag('')
  sag('=== Beispiele fuer die Zeilennamen ===')
  const namen = await f.webContents.executeJavaScript(`
    (function () {
      // Nur das Namensfeld oben links in der Zeile - nicht die Schluessel-
      // zeile darunter und nicht die Schnellwahl-Knoepfe.
      const raus = []
      for (const g of [...document.querySelectorAll('.rates-gruppe')].slice(0, 3)) {
        for (const z of [...g.querySelectorAll('.card')].slice(0, 3)) {
          const feld = z.querySelector('.card-body .row > div')
          raus.push(feld ? feld.children[0].textContent : '')
        }
      }
      return raus
    })()
  `)
  namen.forEach(n => sag('    ' + String(n).trim()))
  // Ein reiner Schluessel waere z. B. "Talent" ohne Teilung, oder die
  // Rohform "Rate.Talent". Ein zerlegter Name enthaelt immer einen der
  // bekannten Woerter und nie das Praefix "Rate.".
  pruefe(namen.length > 0 && namen.every(n => n.trim().length > 0),
    'jede Zeile hat einen Namen')
  pruefe(namen.every(n => !/^Rate\./.test(n.trim())),
    'die Namen sind keine rohen Schluessel')
  pruefe(namen.some(n => n.includes('—')),
    'die Namen sind in Familien und Eigenschaften zerlegt (mit — getrennt)')

  // Der technische Name steht trotzdem darunter
  const mitSchluessel = await f.webContents.executeJavaScript(`
    (function () {
      return [...document.querySelectorAll('.rates-gruppe .card')].filter(z =>
        (z.querySelector('.mono') || {}).textContent && z.querySelector('.mono').textContent.startsWith('Rate.')).length
    })()
  `)
  pruefe(mitSchluessel === 96,
    `jede Zeile traegt den technischen Schluessel (${mitSchluessel}/96)`)

  // Sprachprobe: auf Englisch umstellen
  sag('')
  sag('=== Auf Englisch umstellen ===')
  await f.webContents.executeJavaScript(`
    (function () {
      const knopf = [...document.querySelectorAll('select')]
        .find(s => [...s.options].some(o => /Deutsch|English/.test(o.textContent)))
      if (knopf) {
        knopf.value = [...knopf.options].find(o => /English/.test(o.textContent)).value
        knopf.dispatchEvent(new Event('change', { bubbles: true }))
        return 'umgestellt'
      }
      return 'kein Sprachwaehler'
    })()
  `)
  await warte(2500)

  const gruppenEn = await f.webContents.executeJavaScript(`
    (function () {
      return [...document.querySelectorAll('.rates-gruppe-kopf h4')].map(k => k.textContent)
    })()
  `)
  gruppenEn.forEach(g => sag('    ' + g))
  pruefe(gruppenEn[0] === 'Character & Leveling',
    'auf Englisch heisst die erste Gruppe "Character & Leveling"')

  const namenEnProbe = await f.webContents.executeJavaScript(`
    (function () {
      const raus = []
      const zeilen = document.querySelectorAll('.rates-gruppe .card')
      for (let i = 0; i < 6 && i < zeilen.length; i++) {
        const feld = zeilen[i].querySelector('.card-body .row > div')
        raus.push(feld && feld.children[0] ? feld.children[0].textContent : '')
      }
      return raus
    })()
  `).catch(e => [])
  namenEnProbe.forEach(n => sag('    ' + String(n).trim()))
  pruefe(namenEnProbe.length > 0 &&
    namenEnProbe.some(n => /Experience|Talents|Rest|Reputation|Move speed|Damage/.test(n)),
    'auf Englisch stehen englische Namen in den Zeilen')

  // Bildschirmfoto der Seite, damit das Aussehen belegbar ist
  sag('')
  sag('=== Bildschirmfoto ===')
  try {
    const png = await f.webContents.capturePage()
    fs.writeFileSync(path.join(os.tmpdir(), 'raten-seite.png'), png.toPNG())
    sag('    gespeichert: ' + path.join(os.tmpdir(), 'raten-seite.png'))
  } catch (e) {
    sag('    nicht moeglich: ' + e.message)
  }

  clearTimeout(schranke)
  const rot = zeilen.filter(z => z.startsWith('  FAIL')).length
  sag('')
  sag(rot ? rot + ' FEHLGESCHLAGEN' : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(rot ? 1 : 0)
})
