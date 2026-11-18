'use strict'

/*
 * Testet die Bot-Konfiguration gegen eine Config mit NpcBot.*-Schluesseln
 * (NpcBots-Modul) und gegen eine mit AiPlayerbot.* (PlayerBots-Modul).
 *
 * Aufruf:  node scripts/verify-bots.js <verzeichnis-mit-bin/worldserver>
 */

const path = require('path')
const fs = require('fs')

const BASE = process.argv[2] || path.join(__dirname, '..', '..', 'actest')
const WS = path.join(BASE, 'bin', 'worldserver')

const store = require('../electron/store')
store.init(path.join(BASE, 'cfg'))
store.write({
  server: {
    worldExe: path.join(WS, 'worldserver.exe'),
    authExe: path.join(BASE, 'bin', 'authserver', 'authserver.exe'),
    worldConfDir: WS,
    authConfDir: path.join(BASE, 'bin', 'authserver'),
    mysqlServer: {}
  }
})

const bots = require('../electron/api/bots')
const conf = path.join(WS, 'worldserver.conf')

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

const NPC_CONF = `WorldServerConfig

RealmID = 1
WorldDatabaseInfo = "127.0.0.1;3306;root;root;ac_world"

# --- NpcBots-Modul ---
NpcBot.Enable.All = 1
NpcBot.WanderingBots.Continents.Enable = 1
NpcBot.WanderingBots.Continents.Count = 200
NpcBot.Guards.Enable = 1
NpcBot.Innkeeper.Enable = 0

BindIP = "0.0.0.0"
MaxPingTime = 30
`

const PLAYERBOTS_CONF = `WorldServerConfig

AiPlayerbot.Enable = 1
AiPlayerbot.RandomBots = 5
AiPlayerbot.RandomBotsTotalCount = 150
AiPlayerbot.RandomBotsPerAccount = 0

MaxPingTime = 30
`

async function main () {
  fs.mkdirSync(WS, { recursive: true })

  section('1. NpcBots-Modul (NpcBot.*) wird erkannt')
  fs.writeFileSync(conf, NPC_CONF, 'utf8')
  const npc = await bots.get()
  check(npc.found === true, 'Bot-Einträge gefunden')
  check(npc.file === 'world', 'aus worldserver.conf gelesen')
  const keys = npc.entries.map(e => e.key)
  check(keys.includes('NpcBot.WanderingBots.Continents.Count'), 'Count-Schlüssel vorhanden')
  check(keys.length === 5, `nur NpcBot-Schlüssel, keine Fremdzeilen (${keys.length})`)
  check(!keys.some(k => k === 'BindIP' || k === 'MaxPingTime' || k === 'RealmID'), 'fremde Config-Zeilen ausgefiltert')

  section('2. Wert 200 wird gelesen')
  const countEntry = npc.entries.find(e => e.key === 'NpcBot.WanderingBots.Continents.Count')
  check(countEntry && countEntry.value === '200', `gelesener Wert: ${countEntry && countEntry.value}`)

  section('3. Neuer Wert wird geschrieben')
  await bots.save({
    file: npc.file,
    entries: [{ key: 'NpcBot.WanderingBots.Continents.Count', value: '3500' }]
  })
  const after = await bots.get()
  const c2 = after.entries.find(e => e.key === 'NpcBot.WanderingBots.Continents.Count')
  check(c2 && c2.value === '3500', `neuer Wert: ${c2 && c2.value}`)

  section('4. Uebrige Zeilen unveraendert')
  const raw = fs.readFileSync(conf, 'utf8')
  check(raw.includes('RealmID = 1'), 'RealmID unveraendert')
  check(raw.includes('MaxPingTime = 30'), 'MaxPingTime unveraendert')
  check(raw.includes('BindIP = "0.0.0.0"'), 'BindIP unveraendert')
  check(raw.includes('NpcBot.Guards.Enable = 1'), 'weiterer Bot-Schluessel unveraendert')
  check(raw.includes('WorldDatabaseInfo = "127.0.0.1;3306;root;root;ac_world"'), 'Datenbankzeile unveraendert')

  section('5. Obergrenze 10000 ist zulaessig')
  await bots.save({ file: npc.file, entries: [{ key: 'NpcBot.WanderingBots.Continents.Count', value: '10000' }] })
  const big = await bots.get()
  check(big.entries.find(e => e.key.endsWith('Continents.Count')).value === '10000', '10000 gespeichert')

  section('6. PlayerBots-Modul (AiPlayerbot.*) weiterhin erkannt')
  fs.writeFileSync(conf, PLAYERBOTS_CONF, 'utf8')
  const pb = await bots.get()
  check(pb.found === true, 'Bot-Einträge gefunden')
  check(pb.entries.length === 4, `4 Bot-Schluessel (${pb.entries.length})`)
  const t2 = pb.entries.find(e => e.key === 'AiPlayerbot.RandomBotsTotalCount')
  check(t2 && t2.value === '150', `TotalCount gelesen: ${t2 && t2.value}`)

  section('7. Nicht-Bot-Schluessel werden abgewiesen')
  try {
    await bots.save({ file: 'world', entries: [{ key: 'MaxPingTime', value: '99' }] })
    check(false, 'MaxPingTime haette nicht geschrieben werden duerfen')
  } catch (_) {
    check(true, 'MaxPingTime abgelehnt')
  }
  try {
    await bots.save({ file: 'world', entries: [{ key: 'RealmID', value: '9' }] })
    check(false, 'RealmID haette nicht geschrieben werden duerfen')
  } catch (_) {
    check(true, 'RealmID abgelehnt')
  }

  section('8. Template enthaelt beide Praefixe')
  check(/NpcBot\.WanderingBots\.Continents\.Count/.test(bots.TEMPLATE), 'NpcBot-Schluessel im Template')
  check(/AiPlayerbot\./.test(bots.TEMPLATE), 'AiPlayerbot-Schluessel im Template')
  check(bots.MAX_BOTS === 10000, `MAX_BOTS = ${bots.MAX_BOTS}`)

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})