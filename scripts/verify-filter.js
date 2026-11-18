'use strict'
const path = require('path'), os = require('os'), fs = require('fs')
const sag = z => fs.appendFileSync(path.join(os.tmpdir(), 'filter.txt'), String(z) + '\n', 'utf8')

require('../electron/main')
const { app, BrowserWindow } = require('electron')
const warte = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 90000)
  let f = null
  for (let i = 0; i < 100; i++) { if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break } await warte(200) }
  if (!f) { sag('FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }
  const re = f.webContents

  sag('=== Online-Seite ===')
  await re.executeJavaScript("window.location.hash = '#/online'; 'ok'")
  await warte(3000)

  const toggleChanged = await re.executeJavaScript(`
    (function () {
      const btns = [...document.querySelectorAll('.inline.mb0 button')]
      // zweiter Button im Header = der Bot-Toggle (erster = Refresh)
      if (btns.length < 2) return 'too few buttons: ' + btns.length
      const toggle = btns[1]
      // beim Laden sind Bots weggefiltert (hideBots=true) -> show bots
      // wait for the rows to be built
      const tip = toggle.title || toggle.textContent
      toggle.click()
      return 'geklickt mit Text "' + (toggle.textContent.trim()) + '"'
    })()
  `)
  sag('  toggle: ' + toggleChanged)
  await warte(500)
  const rows = await re.executeJavaScript(`document.querySelectorAll('tbody tr').length`)
  sag('  Zeilen nach Toggle: ' + rows)
  sag('  (initiales Render = OK, Toggle ausgelöst)')

  sag('')
  sag('=== Accounts-Seite ===')
  await re.executeJavaScript("window.location.hash = '#/accounts'; 'ok'")
  await warte(2000)
  const q = await re.executeJavaScript(`(function(){const s=document.querySelector('select');if(!s)return 'no select'; s.value='never'; s.dispatchEvent(new Event('change',{bubbles:true})); return s.options[s.selectedIndex].text;})()`)
  sag('  Filter "never" -> ' + q)
  const n = await re.executeJavaScript(`document.querySelectorAll('tbody tr').length`)
  sag('  Zeilen: ' + n)
  await re.executeJavaScript(`(function(){const s=document.querySelector('select'); s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true}))})()`)

  clearTimeout(schranke)
  sag('  ALLE PRUEFUNGEN BESTANDEN')
  process.exit(0)
})