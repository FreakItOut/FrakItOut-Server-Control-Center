'use strict'

/*
 * Zaehlt die Haustiere im Spiel.
 *
 * Aufruf: node scripts/zaehlt-haustiere.js
 *
 * Anlass: Der Worldserver ist beim Bot-Reiten abgestuerzt:
 *
 *   AuraEffect::HandleAuraMounted -> Unit::Mount
 *     -> Player::UnsummonPetTemporaryIfAny -> Player::RemovePet
 *       -> Pet::SavePetToDB -> Pet::_SaveAuras -> Unit::IsPetAura
 *
 * RCX war 0000000000000000, also ein Nullzeiger. Wie viele Haustiere
 * vorhanden sind, erklaert, wie oft das passieren kann.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const mysql = require('mysql2/promise')

const cfg = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), 'Desktop', 'config.json'), 'utf8')
).mysql

;(async () => {
  const db = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: 'acore_characters'
  })

  // SHOW TABLES LIKE kennt keine Platzhalter - anders als SELECT.
const [tabellen] = await db.query(
  "SHOW TABLES LIKE '%pet%'"
)
  console.log('  Tabellen mit "pet":')
  for (const t of tabellen) console.log('    ' + Object.values(t)[0])

  for (const name of ['pet', 'pets', 'character_pet']) {
    try {
      const [r] = await db.execute(`SELECT COUNT(*) n FROM \`${name}\``)
      console.log(`  ${name}: ${r[0].n} Eintraege`)
    } catch (e) {
      console.log(`  ${name}: ${e.code === 'ER_NO_SUCH_TABLE' ? 'gibt es nicht' : e.message}`)
    }
  }

  await db.end()
})().catch(e => {
  console.log('  FEHLER: ' + e.message)
  process.exit(1)
})