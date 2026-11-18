'use strict'

/*
 * Testet die Modul-Seite in der echten Anwendung.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-module-seite.js
 *
 * Geklickt wird ueber webContents.sendInputEvent, nicht ueber die Maus:
 * ein Hintergrundprozess darf den Vordergrund nicht uebernehmen, der
 * Klick geht dann ins Leere. Zwei Versuche sind genau so gescheitert.
 *
 * Geschrieben wird NICHT. Geprueft wird, was der Nutzer sieht: die
 * Modulliste, die Einstellungen eines Moduls, die Beschreibungen und
 * die Suche.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'module-seite.txt')
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

async function klickAuf (re, selektor, index = 0) {
  const box = JSON.parse(await re.executeJavaScript(`
    (function () {
      const e = document.querySelectorAll('${selektor}')[${index}]
      if (!e) return 'keine'
      const r = e.getBoundingClientRect()
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
    })()
  `))
  if (box === 'keine') return false
  re.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  re.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await warte(1200)
  return true
}

app.whenReady().then(async () => {
  const schranke = setTimeout(() => {
    sag('ABBRUCH: nach 45 s nicht fertig')
    process.exit(2)
  }, 45000)

  let f = null
  for (let i = 0; i < 100; i++) {
    const alle = BrowserWindow.getAllWindows()
    if (alle.length) { f = alle[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL Fenster nicht erschienen'); clearTimeout(schranke); process.exit(1) }
  sag('  OK   Fenster gefunden')

  const re = f.webContents

  // Was der Renderer meldet, ist hier die schnellste Spur: ein Fehler
  // in der Seite bleibt sonst stumm, weil die Oberflaeche ihn nur als
  // Meldung anzeigt.
  re.on('console-message', (ereignis, stufe, quelle, zeile, nachricht) => {
    if (/error|Error|fehler/i.test(nachricht) || stufe >= 2) {
      sag(`  [Renderer] ${String(nachricht).slice(0, 160)}  (${quelle}:${zeile})`)
    }
  })

  await re.executeJavaScript(`window.location.hash = '#/modules'; 'ok'`)
  await warte(3500)

  sag('')
  sag('=== Modulliste ===')
  // Was steht ueberhaupt auf der Seite? Wenn die Liste fehlt, ist die
  // Frage nicht "welche Module", sondern "was wird angezeigt".
  const inhalt = await re.executeJavaScript(`
    (function () {
      const w = document.querySelector('.content, .app-main, main') || document.body
      return w.innerText.slice(0, 400)
    })()
  `)
  sag('  Anzeige:')
  inhalt.split('\n').filter(Boolean).slice(0, 8).forEach(z => sag('    | ' + z))

  const eintraege = await re.executeJavaScript(
    `document.querySelectorAll('.modules-eintrag').length`)
  sag(`  Module in der Liste: ${eintraege}`)
  pruefe(eintraege > 50, `mehr als 50 Module sichtbar (${eintraege})`)

  const ordnerAnzeige = await re.executeJavaScript(`
    (function () {
      const m = document.querySelector('.card-body .mono')
      return m ? m.textContent : ''
    })()
  `)
  sag(`  Ordner: ${ordnerAnzeige}`)
  pruefe(/modules/i.test(ordnerAnzeige), 'der Modul-Ordner wird angezeigt')

  sag('')
  sag('=== Einstellungen des ersten Moduls ===')
  await klickAuf(re, '.modules-eintrag', 0)

  const detail = await re.executeJavaScript(`
    (function () {
      const zeilen = document.querySelectorAll('.module-setting')
      const mitHilfe = document.querySelectorAll('.module-setting-help')
      return JSON.stringify({
        zeilen: zeilen.length,
        mitHilfe: mitHilfe.length,
        beispiel: zeilen.length
          ? {
              key: (zeilen[0].querySelector('.mono') || {}).textContent,
              help: mitHilfe.length ? mitHilfe[0].textContent.slice(0, 90) : null
            }
          : null
      })
    })()
  `)
  const d = JSON.parse(detail)
  sag(`  Einstellungen: ${d.zeilen}   davon erklaert: ${d.mitHilfe}`)
  pruefe(d.zeilen > 0, `das Modul zeigt Einstellungen (${d.zeilen})`)
  pruefe(d.mitHilfe > 0, `davon haben eine Erklaerung (${d.mitHilfe})`)
  if (d.beispiel) {
    sag(`  Beispiel: ${d.beispiel.key}`)
    sag(`           ${d.beispiel.help || '(keine)'}`)
  }

  sag('')
  sag('=== Suche ===')
  // In das Suchfeld der Einstellungen tippen
  const gesetzt = await re.executeJavaScript(`
    (function () {
      const felder = [...document.querySelectorAll('.module-detail input[type=text]')]
      if (!felder.length) return false
      const f = felder[0]
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(f, 'Enable')
      f.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  pruefe(gesetzt, 'das Suchfeld wurde gefunden')
  await warte(1200)
  const nachSuche = await re.executeJavaScript(`document.querySelectorAll('.module-setting').length`)
  sag(`  nach der Suche: ${nachSuche} Treffer`)
  pruefe(nachSuche > 0, 'die Suche findet Treffer')
  pruefe(nachSuche <= d.zeilen, 'die Suche filtert')

  sag('')
  sag('=== Ein grosses Modul ===')
  // "mod_weather_vibe" in der Modulliste suchen
  await re.executeJavaScript(`
    (function () {
      const felder = [...document.querySelectorAll('.modules-liste input[type=text]')]
      if (!felder.length) return false
      const f = felder[0]
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(f, 'weather')
      f.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await warte(1000)
  const modTreffer = await re.executeJavaScript(`document.querySelectorAll('.modules-eintrag').length`)
  sag(`  Modultreffer fuer "weather": ${modTreffer}`)
  pruefe(modTreffer >= 1, 'das Modul findet sich ueber die Suche')

  await klickAuf(re, '.modules-eintrag', 0)
  const gross = await re.executeJavaScript(`
    (function () {
      const z = document.querySelectorAll('.module-setting').length
      const m = document.querySelector('.card-body .muted')
      return JSON.stringify({ zeilen: z, anzeige: m ? m.textContent : '' })
    })()
  `)
  const g = JSON.parse(gross)
  sag(`  ${g.zeilen} Einstellungen sichtbar`)
  sag(`  ${g.anzeige}`)
  pruefe(g.zeilen > 500, `auch 2000er-Einstellungen sind bedienbar (${g.zeilen})`)

  sag('')
  sag('=== Ein Modul mit uebersetzten Texten ===')
  await re.executeJavaScript(`
    (function () {
      const felder = [...document.querySelectorAll('.modules-liste input[type=text]')]
      if (!felder.length) return false
      const f = felder[0]
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(f, 'transmog')
      f.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await warte(1000)
  await klickAuf(re, '.modules-eintrag', 0)

  const trans = await re.executeJavaScript(`
    (function () {
      const zeilen = document.querySelectorAll('.module-setting')
      const eigen = document.querySelectorAll('.module-setting-help.eigen')
      const marken = document.querySelectorAll('.module-herkunft')
      const beispiel = eigen.length ? eigen[0].textContent.trim() : null
      return JSON.stringify({
        zeilen: zeilen.length, eigen: eigen.length, marken: marken.length, beispiel
      })
    })()
  `)
  const tr = JSON.parse(trans)
  sag(`  Einstellungen: ${tr.zeilen}   mit eigener Uebersetzung: ${tr.eigen}   mit EN-Marke: ${tr.marken}`)
  pruefe(tr.eigen > 0, `das Modul zeigt eigene deutsche Texte (${tr.eigen})`)
  pruefe(tr.marken > 0, `Originaltexte sind als EN gekennzeichnet (${tr.marken})`)
  if (tr.beispiel) sag(`  Beispiel: ${tr.beispiel.slice(0, 110)}`)

  // Und auf Deutsch umstellen
  await re.executeJavaScript(`
    (function () {
      const knopf = [...document.querySelectorAll('select')]
        .find(s => [...s.options].some(o => /Deutsch|English/.test(o.textContent)))
      if (!knopf) return 'kein Sprachwaehler'
      knopf.value = [...knopf.options].find(o => /Deutsch/.test(o.textContent)).value
      knopf.dispatchEvent(new Event('change', { bubbles: true }))
      return 'umgestellt'
    })()
  `)
  await warte(2500)
  const aufDeutsch = await re.executeJavaScript(`
    (function () {
      const e = document.querySelector('.module-setting-help.eigen')
      return e ? e.textContent.trim() : ''
    })()
  `)
  sag(`  auf Deutsch: ${aufDeutsch.slice(0, 110)}`)
  pruefe(/[äöüß]/.test(aufDeutsch), 'auf Deutsch stehen deutsche Uebersetzungen')

  sag('')
  sag('=== Bildschirmfoto ===')
  try {
    const png = await f.webContents.capturePage()
    fs.writeFileSync(path.join(os.tmpdir(), 'module-seite.png'), png.toPNG())
    sag('  gespeichert: ' + path.join(os.tmpdir(), 'module-seite.png'))
  } catch (e) {
    sag('  nicht moeglich: ' + e.message)
  }

  clearTimeout(schranke)
  const rot = zeilen.filter(z => z.startsWith('  FAIL')).length
  sag('')
  sag(rot ? rot + ' FEHLGESCHLAGEN' : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(rot ? 1 : 0)
})
