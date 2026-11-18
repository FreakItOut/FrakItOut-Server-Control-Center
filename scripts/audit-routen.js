// Ruft jede Lese-Route des Panels einmal gegen die echte Datenbank auf und
// meldet, welche davon fehlschlagen.
//
// Zweck: Finden, was im Panel noch kaputt ist, ohne jedes Menue von Hand
// durchzuklicken. Reine Leseoperationen - es wird nichts geschrieben.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))
const echte = path.join(os.homedir(), 'AppData', 'Roaming', 'wowpanel', 'config.json')
if (!fs.existsSync(echte)) {
  console.log('Keine Panel-Konfiguration gefunden - Abbruch.')
  process.exit(1)
}
fs.copyFileSync(echte, path.join(tmp, 'config.json'))

const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(tmp)
const db = require(path.join(__dirname, '..', 'electron', 'db.js'))
db.init(store)

// Nur Routen, die nichts veraendern.
const ROUTEN = [
  ['dashboard.stats', () => require(path.join(__dirname, '..', 'electron', 'api', 'online.js')).dashboard()],
  ['online.list', () => require(path.join(__dirname, '..', 'electron', 'api', 'online.js')).listOnline()],
  ['realms.list', () => require(path.join(__dirname, '..', 'electron', 'api', 'realms.js')).listRealms()],
  ['bans.list', () => require(path.join(__dirname, '..', 'electron', 'api', 'bans.js')).listBans()],
  ['accounts.list', () => require(path.join(__dirname, '..', 'electron', 'api', 'accounts.js')).listAccounts({})],
  ['characters.list', () => require(path.join(__dirname, '..', 'electron', 'api', 'characters.js')).listCharacters({})],
  ['characters.count', () => require(path.join(__dirname, '..', 'electron', 'api', 'characters.js')).countCharacters({})],
  ['bots.get', () => require(path.join(__dirname, '..', 'electron', 'api', 'bots.js')).get()],
  ['rates.get', () => require(path.join(__dirname, '..', 'electron', 'api', 'rates.js')).get()],
  ['backup.status', () => require(path.join(__dirname, '..', 'electron', 'api', 'backup.js')).status()],
  ['network.get', () => require(path.join(__dirname, '..', 'electron', 'api', 'network.js')).get()],
  ['gm.items', () => require(path.join(__dirname, '..', 'electron', 'api', 'gm.js')).lookupItems('')],
  ['gm.creatures', () => require(path.join(__dirname, '..', 'electron', 'api', 'gm.js')).lookupCreatures('')],
  ['gm.gameobjects', () => require(path.join(__dirname, '..', 'electron', 'api', 'gm.js')).lookupGameObjects('')],
  ['config.available', () => require(path.join(__dirname, '..', 'electron', 'api', 'config-editor.js')).available()]
]

;(async () => {
  console.log(`Auth ${store.read().mysql.authDb} · Chars ${store.read().mysql.charDb} · World ${store.read().mysql.worldDb}\n`)
  const zeilen = []
  for (const [name, fn] of ROUTEN) {
    const t0 = Date.now()
    try {
      const r = await fn()
      const menge = Array.isArray(r) ? `${r.length} Zeilen` : (r && typeof r === 'object' ? `${Object.keys(r).length} Felder` : 'ok')
      zeilen.push({ name, ok: true, zusatz: `${menge} (${Date.now() - t0} ms)` })
    } catch (e) {
      zeilen.push({ name, ok: false, zusatz: e.message.slice(0, 110) })
    }
  }

  let ok = 0
  for (const z of zeilen) {
    console.log(`${z.ok ? 'OK   ' : 'FEHLT'}  ${z.name.padEnd(20)} ${z.zusatz}`)
    if (z.ok) ok++
  }
  console.log(`\n${ok}/${zeilen.length} Routen funktionieren`)

  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === zeilen.length ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})
