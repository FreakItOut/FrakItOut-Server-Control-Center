'use strict'

/*
 * Testet die Server-Raten: Lesen der Rates.*-Schluessel, Schreiben,
 * Schutz fremder Eintraege und die Gueltigkeitspruefung von Werten.
 *
 * Aufruf:  node scripts/verify-rates.js <verzeichnis-mit-bin/worldserver>
 */

const path = require('path')
const fs = require('fs')

const BASE = process.argv[2] || path.join(__dirname, '..', '..', 'actest')
const WS = path.join(BASE, 'bin', 'worldserver')

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

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

const rates = require('../electron/api/rates')
const conf = path.join(WS, 'worldserver.conf')

// worldserver.conf im AzerothCore-Stil: Rate-Schluessel mit Punkt am Ende
const CONF = `WorldServerConfig

RealmID = 1
WorldDatabaseInfo = "127.0.0.1;3306;root;root;ac_world"
BindIP = "0.0.0.0"

# --- RATES ---
Rates.Loot.        = 1.0
Rates.Health.      = 1.0
Rates.Craft.       = 1.0
Rates.Quest.       = 1.0
Rates.Reputation.  = 1.0
Rates.Honor.       = 1.0
Rates.Dungeon.     = 1.0
Rates.Battle.      = 1.0
Rates.Whisper.     = 1.0

# Kommentar darunter
AiPlayerbot.Enable = 0
NpcBot.WanderingBots.Continents.Count = 200
MaxPingTime = 30
`

async function main () {
  fs.mkdirSync(WS, { recursive: true })

  section('1. Raten werden gelesen')
  fs.writeFileSync(conf, CONF, 'utf8')
  const r = await rates.get()
  check(r.found === true, 'Raten gefunden')
  check(r.entries.length === 9, `9 Raten gelesen (${r.entries.length})`)
  const keys = r.entries.map(e => e.key)
  check(keys.includes('Rates.Loot.'), 'Rates.Loot. vorhanden')
  check(keys.every(k => /^Rates\./i.test(k)), 'nur Rates.-Schluessel geliefert')
  check(!keys.includes('MaxPingTime'), 'MaxPingTime nicht enthalten')
  check(!keys.includes('AiPlayerbot.Enable'), 'Bot-Schluessel nicht enthalten')
  check(!keys.includes('RealmID'), 'RealmID nicht enthalten')

  section('2. Anzeigenamen')
  const loot = r.entries.find(e => e.key === 'Rates.Loot.')
  check(loot.label === 'Loot', `Loot -> "${loot.label}"`)
  const rep = r.entries.find(e => e.key === 'Rates.Reputation.')
  check(rep.label === 'Ruf', `Reputation -> "${rep.label}"`)
  const hon = r.entries.find(e => e.key === 'Rates.Honor.')
  check(hon.label === 'Ehre', `Honor -> "${hon.label}"`)
  check(rates.friendlyName('Rates.Health.') === 'Regeneration', 'Health -> Regeneration')

  section('3. Zahlen werden geparst')
  check(loot.number === 1, `Wert als Zahl: ${loot.number}`)

  section('4. Raten werden geschrieben')
  await rates.save({
    entries: [
      { key: 'Rates.Loot.', value: '5' },
      { key: 'Rates.Quest.', value: '2.5' },
      { key: 'Rates.Honor.', value: '0.5' }
    ]
  })
  const after = await rates.get()
  const get = k => (after.entries.find(e => e.key === k) || {}).value
  check(get('Rates.Loot.') === '5.0', `Loot = ${get('Rates.Loot.')} (aus "5" formatiert)`)
  check(get('Rates.Quest.') === '2.5', `Quest = ${get('Rates.Quest.')}`)
  check(get('Rates.Honor.') === '0.5', `Honor = ${get('Rates.Honor.')}`)

  section('5. Uebrige Zeilen unveraendert')
  const raw = fs.readFileSync(conf, 'utf8')
  check(raw.includes('RealmID = 1'), 'RealmID unveraendert')
  check(raw.includes('BindIP = "0.0.0.0"'), 'BindIP unveraendert')
  check(raw.includes('MaxPingTime = 30'), 'MaxPingTime unveraendert')
  check(raw.includes('# Kommentar darunter'), 'Kommentar unveraendert')
  check(raw.includes('AiPlayerbot.Enable = 0'), 'Bot-Eintrag unveraendert')
  check(raw.includes('NpcBot.WanderingBots.Continents.Count = 200'), 'NpcBot-Eintrag unveraendert')
  check(raw.includes('Rates.Dungeon.') && /Rates\.Dungeon\.\s*= 1\.0/.test(raw), 'nicht angefasste Rate unveraendert')

  section('6. Fremde Schluessel werden abgewiesen')
  for (const bad of ['MaxPingTime', 'RealmID', 'AiPlayerbot.Enable']) {
    let threw = false
    try {
      await rates.save({ entries: [{ key: bad, value: '9' }] })
    } catch (_) {
      threw = true
    }
    check(threw, `${bad} abgelehnt`)
  }
  check(fs.readFileSync(conf, 'utf8').includes('MaxPingTime = 30'), 'MaxPingTime wirklich unveraendert')

  section('7. Wertebereiche')
  for (const v of ['0', '0.5', '1', '2.5', '100']) {
    check(rates.isValidRate(v), `zulaessig: ${v}`)
  }
  for (const v of ['-1', 'abc', '', '101']) {
    check(!rates.isValidRate(v), `abgelehnt: "${v}"`)
  }
  await rates.save({ entries: [{ key: 'Rates.Loot.', value: '-5' }] })
    .then(() => check(false, 'negativer Wert haette abgelehnt werden muessen'))
    .catch(() => check(true, 'negativer Wert abgelehnt'))

  section('8. Komma als Dezimaltrenner')
  check(rates.formatRate('0,5') === '0.5', '0,5 -> 0.5')
  check(rates.formatRate('3') === '3.0', '3 -> 3.0')
  check(rates.formatRate('2.5') === '2.5', '2.5 bleibt')

  section('9. Ohne Raten: Standardwerte koennen ergaenzt werden')
  fs.writeFileSync(conf, 'WorldServerConfig\nRealmID = 1\nMaxPingTime = 30\n', 'utf8')
  const empty = await rates.get()
  check(empty.found === false, 'keine Raten gefunden')
  check(empty.entries.length === 0, 'leere Liste')

  const added = await rates.createDefaults()
  check(added.added === 9, `9 Eintraege ergaenzt (${added.added})`)
  const now = await rates.get()
  check(now.entries.length === 9, `jetzt ${now.entries.length} Raten lesbar`)
  check(fs.readFileSync(conf, 'utf8').includes('RealmID = 1'), 'RealmID weiterhin da')

  const again = await rates.createDefaults()
  check(again.added === 0, 'zweites Mal wird nichts doppelt ergaenzt')

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})