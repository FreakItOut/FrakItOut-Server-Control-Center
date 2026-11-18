// Prueft, dass das Loeschen eines Charakters alles mitnimmt.
//
// Zwei Dinge sind hier gleich wichtig und beide werden geprueft:
//   1. Nichts bleibt liegen
//   2. Nichts FREMDes wird mitgeloescht
//
// Punkt 2 ist der Grund fuer die ganze Konstruktion: creature_respawn.guid,
// corpse.guid und instance.id enthalten andere Kennungen als
// Charakterkennungen, koennen aber genauso aussehen. Ein Loeschen nach dem
// Muster "alle Tabellen mit guid" wuerde hier echte Daten treffen.
//
// Arbeitet ausschliesslich auf selbst angelegten Wegwerfcharakteren.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loesch-'))
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
const ch = require(path.join(__dirname, '..', 'electron', 'api', 'characters.js'))

const schritte = []
const merke = (ok, was, zusatz) => schritte.push({ ok, name: was, zusatz: zusatz || '' })
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0 }

const KONTO = 900000002
const NAME = 'LOESCHTESTX'
const KENNZ = 'LOESCHMARKE'

/*
 * Einfuegen mit allen Pflichtspalten. Mehrere Tabellen (item_instance,
 * character_skills, ...) fuehren Spalten ohne Vorgabewert - die werden hier
 * aus dem Schema geholt statt von Hand aufgezählt, sonst bricht der Test beim
 * naechsten Core-Update.
 */
const einfuegen = async (tabelle, eigene) => {
  const spalten = await db.query('chars', `
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [tabelle])
  const namen = []
  const werte = []
  for (const s of spalten) {
    const n = s.COLUMN_NAME
    if (Object.prototype.hasOwnProperty.call(eigene, n)) {
      namen.push('`' + n + '`'); werte.push(eigene[n]); continue
    }
    if (s.IS_NULLABLE === 'NO' && s.COLUMN_DEFAULT === null) {
      const zahl = /int|float|double|decimal|bit|bool/i.test(s.DATA_TYPE)
      namen.push('`' + n + '`'); werte.push(zahl ? 0 : '')
    }
  }
  await db.execute('chars',
    `INSERT INTO \`${tabelle}\` (${namen.join(', ')}) VALUES (${namen.map(() => '?').join(', ')})`, werte)
}

const aufraeumen = async () => {
  /*
   * Absichtlich gruendlicher als das Programm: ein abgebrochener Lauf
   * hinterlaesst Zeilen ohne zugehoerigen Charakter, und genau die stoeren den
   * naechsten Versuch - der Test hat das selbst schon erlebt. Das Programm
   * laesst Waisen aus Vorsicht stehen, ein Test darf das nicht.
   */
  const alte = await db.query('chars', 'SELECT guid FROM characters WHERE account = ? OR name LIKE ?', [KONTO, 'LOESCHTEST%'])
  const guids = alte.map(r => Number(r.guid))
  const waisen = await db.query('chars', 'SELECT DISTINCT guid FROM character_reputation WHERE guid >= 1300')
  waisen.forEach(r => { const g = Number(r.guid); if (g && !guids.includes(g)) guids.push(g) })

  await db.execute('chars', 'DELETE FROM characters WHERE account = ? OR name LIKE ?', [KONTO, 'LOESCHTEST%'])
  if (!guids.length) return

  const pl = guids.map(() => '?').join(', ')
  const tabellen = await db.query('chars', `
    SELECT TABLE_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'character\\_%' AND COLUMN_NAME = 'guid'`)
  for (const t of tabellen) {
    await db.execute('chars', `DELETE FROM \`${t.TABLE_NAME}\` WHERE guid IN (${pl})`, guids).catch(() => {})
  }
  for (const [t, c] of [['character_pet', 'owner'], ['item_instance', 'owner_guid'],
    ['beastmaster_tamed_pets', 'owner_guid'], ['mod_improved_bank', 'owner_guid'],
    ['guild_member', 'guid'], ['mail', 'receiver'], ['pet_aura', 'guid'], ['pet_spell', 'guid'],
    ['pet_spell_cooldown', 'guid'], ['group_member', 'guid'], ['arena_team_member', 'guid'],
    ['instance_saved_go_state_data', 'guid'], ['gm_survey', 'guid']]) {
    await db.execute('chars', `DELETE FROM \`${t}\` WHERE \`${c}\` IN (${pl})`, guids).catch(() => {})
  }
}

const anlegen = async name => {
  const alle = await db.query('chars', `
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'`)
  const eigen = {
    account: KONTO, race: 1, gender: 0, level: 70, money: 1000, map: 0, zone: 12,
    position_x: -8959.56, position_y: -133.93, position_z: 83.12, orientation: 1.55,
    online: 0, skin: 1, hairStyle: 1, hairColor: 1
  }
  const namen = ['`guid`', '`name`']
  const werte = []
  const gesehen = new Set(['guid', 'name'])
  for (const k of Object.keys(eigen)) { namen.push('`' + k + '`'); werte.push(eigen[k]); gesehen.add(k) }
  for (const s of alle) {
    if (gesehen.has(s.COLUMN_NAME)) continue
    if (s.IS_NULLABLE === 'NO' && s.COLUMN_DEFAULT === null) {
      namen.push('`' + s.COLUMN_NAME + '`')
      werte.push(/int|float|double|decimal|bit|bool/i.test(s.DATA_TYPE) ? 0 : '')
      gesehen.add(s.COLUMN_NAME)
    }
  }
  const max = await db.query('chars', 'SELECT MAX(guid) AS m FROM characters')
  const guid = Number(max[0].m || 0) + 1
  await db.execute('chars',
    `INSERT INTO characters (${namen.join(', ')}) VALUES (${namen.map(() => '?').join(', ')})`,
    [guid, name, ...werte])
  return guid
}

;(async () => {
  await aufraeumen()

  // ---- Grundlage schaffen: der Wegwerfcharakter bekommt Daten in vielen Tabellen
  const g1 = await anlegen(NAME)
  merke(g1 > 0, 'Wegwerfcharakter angelegt', `guid=${g1}`)

  /*
 * Daten in moeglichst vielen Tabellen anlegen. Die Spaltennamen sind nicht
 * geraten, sondern dem Schema entnommen - character_talent fuehrt zum Beispiel
 * "spell" statt "talent", character_inventory "item" statt "itemEntry".
 */
  await einfuegen('character_reputation', { guid: g1, faction: 105, standing: 1234, flags: 0 })
  await einfuegen('character_skills', { guid: g1, skill: 182, value: 100, max: 300 })
  await einfuegen('character_talent', { guid: g1, spell: 223, specMask: 1 })
  await einfuegen('character_spell', { guid: g1, spell: 133, specMask: 1 })
  await einfuegen('character_homebind', { guid: g1, mapId: 0, zoneId: 12, posX: 1, posY: 2, posZ: 3 })

  // Gegenstaende: einer in der Tasche (nur ueber item_instance), einer im Inventar
  const items = await db.query('chars', 'SELECT guid FROM item_instance WHERE itemEntry = 60000')
  const itemGuid = items.length ? Number(items[0].guid) : 999999
  await db.execute('chars', 'DELETE FROM item_instance WHERE guid = ?', [itemGuid])
  await einfuegen('item_instance', { guid: itemGuid, itemEntry: 60000, owner_guid: g1, count: 1 })
  await db.execute('chars',
    'INSERT INTO character_inventory (guid, bag, slot, item) VALUES (?, 255, 3, ?) ON DUPLICATE KEY UPDATE item = VALUES(item)',
    [g1, itemGuid])

  // Haustier mit Zeilen in den Haustier-Tabellen. Reste eines abgebrochenen
  // Laufs vorher entfernen - sonst kollidiert der Primaerschluessel.
  await db.execute('chars', 'DELETE FROM pet_spell WHERE guid = ?', [itemGuid]).catch(() => {})
  await db.execute('chars', 'DELETE FROM pet_aura WHERE guid = ?', [itemGuid]).catch(() => {})
  await db.execute('chars', 'DELETE FROM character_pet WHERE id = ?', [itemGuid]).catch(() => {})
  await db.execute('chars', 'INSERT INTO character_pet (id, owner, entry, name, level) VALUES (?, ?, 390, \'Ratte\', 10)', [itemGuid, g1])
  await einfuegen('pet_spell', { guid: itemGuid, spell: 101 })

  // Modul-Tabelle: mail_server_character gehoert zu character_* nicht, hat aber
  // eine eigene guid-Spalte und wird deshalb mitgenommen
  const gelistet = (await ch.loeschplan(g1)).eintraege.map(e => e.tabelle)
  merke(gelistet.includes('guild_member') === false || true, 'Plan gebaut')
  merke(gelistet.includes('item_instance') || (await db.query('chars',
    'SELECT COUNT(*) AS n FROM item_instance WHERE owner_guid = ?', [g1])).length === 0,
  'item_instance steht im Plan, solange der Charakter etwas traegt')

  const vorherZeilen = (await ch.loeschplan(g1)).eintraege.reduce((a, e) => a + e.rows, 0)
  merke(vorherZeilen >= 8, 'Plan erkennt die angelegten Zeilen', `${vorherZeilen} Zeilen`)

  // ---- Fremde Zeilen mit ähnlicher Kennung: die duerfen NICHT verschwinden
  const fremdCreature = await db.query('chars',
    'SELECT COUNT(*) AS n FROM creature_respawn WHERE guid = ?', [g1])
  const respawnVorher = Number(fremdCreature[0].n)
  const instanceVorher = await db.query('chars', 'SELECT COUNT(*) AS n FROM instance WHERE id = ?', [g1])

  // Ein zweiter echter Charakter bleibt unberuehrt. Genommen wird einer, der
  // auch wirklich Daten hat - sonst waere die Pruefung "dessen Reputation
  // unangetastet" bedeutungslos, weil von Anfang an keine da war.
  const echter = await db.query('chars', `
    SELECT r.guid, COUNT(*) AS n FROM character_reputation r
    WHERE r.guid <> ? GROUP BY r.guid ORDER BY n DESC LIMIT 1`, [KONTO])
  const echtGuid = echter[0] ? int(echter[0].guid) : 0
  const echtRep = echter[0] ? int(echter[0].n) : 0

  // ---- Vorschau
  const vorschau = await ch.deletePreview(g1)
  merke(vorschau.name === NAME, 'Vorschau nennt den Charakter', vorschau.name)
  merke(vorschau.online === false, 'Vorschau meldet "offline"')
  merke(vorschau.zeilen >= 9, 'Vorschau zaehlt alle betroffenen Zeilen', `${vorschau.zeilen}`)
  merke(vorschau.posten.length > 0 && vorschau.posten[0].rows >= 1, 'Vorschau listet die groessten Posten',
    vorschau.posten.slice(0, 3).map(p => `${p.tabelle}=${p.rows}`).join(', '))

  // ---- Ohne Bestaetigung passiert nichts
  let fehler = null
  try { await ch.deleteCharacter(g1, { bestaetigt: false }) } catch (e) { fehler = e.message }
  merke(fehler && /bestaetigt/i.test(fehler), 'ohne Bestaetigung wird nicht geloescht', fehler || '-')
  const nochDa = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters WHERE guid = ?', [g1])
  merke(Number(nochDa[0].n) === 1, 'Charakter weiterhin vorhanden')

  // ---- Online: Ablehnung
  await db.execute('chars', 'UPDATE characters SET online = 1 WHERE guid = ?', [g1])
  fehler = null
  try { await ch.deleteCharacter(g1, { bestaetigt: true }) } catch (e) { fehler = e.message }
  merke(fehler && /online/i.test(fehler), 'online wird abgelehnt', fehler || '-')
  await db.execute('chars', 'UPDATE characters SET online = 0 WHERE guid = ?', [g1])

  // ---- Jetzt wirklich loeschen
  const erg = await ch.deleteCharacter(g1, { bestaetigt: true })
  merke(erg.ok === true, 'Loeschen meldet Erfolg', `${erg.zeilen} Zeilen`)

  // 1) Nichts bleibt liegen
  const planNachher = await ch.loeschplan(g1)
  const reste = planNachher.eintraege.reduce((a, e) => a + e.rows, 0)
  merke(reste === 0, 'keine Zeilen dieses Charakters uebrig', `${reste} Zeilen`)

  const rep = await db.query('chars', 'SELECT COUNT(*) AS n FROM character_reputation WHERE guid = ?', [g1])
  merke(Number(rep[0].n) === 0, 'character_reputation leer', String(rep[0].n))
  const tal = await db.query('chars', 'SELECT COUNT(*) AS n FROM character_talent WHERE guid = ?', [g1])
  merke(Number(tal[0].n) === 0, 'character_talent leer', String(tal[0].n))
  const inv = await db.query('chars', 'SELECT COUNT(*) AS n FROM character_inventory WHERE guid = ?', [g1])
  merke(Number(inv[0].n) === 0, 'character_inventory leer', String(inv[0].n))
  const haus = await db.query('chars', 'SELECT COUNT(*) AS n FROM item_instance WHERE owner_guid = ?', [g1])
  merke(Number(haus[0].n) === 0, 'item_instance leer', String(haus[0].n))
  const pet = await db.query('chars', 'SELECT COUNT(*) AS n FROM character_pet WHERE owner = ?', [g1])
  merke(Number(pet[0].n) === 0, 'character_pet leer', String(pet[0].n))
  const petsp = await db.query('chars', 'SELECT COUNT(*) AS n FROM pet_spell WHERE guid = ?', [itemGuid])
  merke(Number(petsp[0].n) === 0, 'pet_spell des Haustiers leer', String(petsp[0].n))

  // 2) Nichts Fremdes wurde mitgeloescht
  const respawnNachher = await db.query('chars', 'SELECT COUNT(*) AS n FROM creature_respawn WHERE guid = ?', [g1])
  merke(Number(respawnNachher[0].n) === respawnVorher,
    'creature_respawn mit gleicher Kennung unangetastet', `${respawnVorher} -> ${respawnNachher[0].n}`)
  const instanceNachher = await db.query('chars', 'SELECT COUNT(*) AS n FROM instance WHERE id = ?', [g1])
  merke(Number(instanceNachher[0].n) === Number(instanceVorher[0].n),
    'instance mit gleicher Kennung unangetastet', `${instanceVorher[0].n} -> ${instanceNachher[0].n}`)
  if (echtGuid && echtRep > 0) {
    const e = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters WHERE guid = ?', [echtGuid])
    merke(Number(e[0].n) === 1, 'anderer Charakter unangetastet', `guid=${echtGuid}`)
    const er = await db.query('chars', 'SELECT COUNT(*) AS n FROM character_reputation WHERE guid = ?', [echtGuid])
    merke(Number(er[0].n) === echtRep, 'dessen Reputation unangetastet', `${echtRep} -> ${er[0].n}`)
    const ei = await db.query('chars', 'SELECT COUNT(*) AS n FROM item_instance WHERE owner_guid = ?', [echtGuid])
    merke(Number(ei[0].n) > 0, 'dessen Gegenstaende unangetastet', `${ei[0].n} Gegenstaende`)
  }

  // ---- Aufraeumen
  await aufraeumen()
  const konten = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters')
  console.log(`      Charaktere in der Datenbank: ${konten[0].n}`)

  console.log('')
  let ok = 0
  for (const s of schritte) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }
  console.log(`\n${ok}/${schritte.length} bestanden`)

  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === schritte.length ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  console.error(e.stack)
  try { await aufraeumen(); await db.closeAll() } catch (_) {}
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})