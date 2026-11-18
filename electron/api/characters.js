'use strict'

const db = require('../db')
const schema = require('../db-schema')

function int (v, fallback = 0) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/*
 * Fraktion: AzerothCore fuehrt KEINE faction-Spalte in characters. Die
 * Fraktion wird beim Anmelden aus race abgeleitet. Wer also die Fraktion
 * wechselt, wechselt die Rasse - das ist kein Umweg, sondern so funktioniert
 * es.
 *
 * Das war zuerst anders gebaut (Spalte schreiben). Das Ergebnis waere ein
 * SQL-Fehler beim Speichern und eine Anzeige, die allen Charakteren "Allianz"
 * gemeldet haette, weil die Abfrage ins Leere laeuft.
 */
const RASSEN_FRAKTION = {
  1: 0, // Mensch        -> Allianz
  3: 0, // Zwerg         -> Allianz
  4: 0, // Nachtelf      -> Allianz
  7: 0, // Gnom          -> Allianz
  11: 0, // Dracthyr'     -> Allianz
  12: 0, // Worgen        -> Allianz
  2: 1, // Ork           -> Horde
  5: 1, // Untoter       -> Horde
  6: 1, // Tauren        -> Horde
  8: 1, // Troll         -> Horde
  9: 1, // Goblin        -> Horde
  10: 1 // Blutelf       -> Horde
}

// Gegenstuecke fuer den Wechsel. Nachtelf und Blutelf sind nicht
// symmetrisch - sie haben unterschiedliche Hautfarben, die nach dem Wechsel
// gesetzt werden muessen.
const RASSEN_PAARE = {
  1: 2, // Mensch <-> Ork
  2: 1,
  3: 7, // Zwerg <-> Gnom
  7: 3,
  4: 10, // Nachtelf <-> Blutelf
  10: 4,
  12: 5 // Worgen <-> Untoter
}

const fraktionVon = race => (RASSEN_FRAKTION[int(race)] === 1 ? 1 : 0)

/*
 * Die Spalten, nach denen sortiert werden darf.
 *
 * Fest, weil der Sortierwunsch aus dem Frontend kommt. Jeder Text
 * koennte dort stehen - eine Whitelist ist hier Pflicht.
 */
const SORTIERBAR = {
  name: 'c.name',
  level: 'c.level',
  money: 'c.money',
  totaltime: 'c.totaltime',
  race: 'c.race',
  class: 'c.class',
  account: 'c.account',
  guid: 'c.guid'
}

async function listCharacters ({ search = '', limit = 200, offset = 0, sort = '', dir = 'asc', ohneBots = false, nurOnline = false } = {}) {
  /*
   * Bot-Ausschluss: Bei Servern mit Playerbots sind Tausende Bot-Charaktere
   * in der Liste. Der Filter nutzt dieselben Konto-Präfixe wie der
   * Leer-Check; schlägt der JOIN fehl (Auth-DB weg), wird ohne Filter
   * weitergearbeitet.
   *
   * Ohne Filter holt der JOIN trotzdem den Konto-Namen - daraus entsteht
   * die Bot-Kennzeichnung in der Liste. Fehlt die Auth-DB, läuft die
   * Abfrage ohne JOIN (Fallback unten) und die Zeilen kommen ohne
   * Kennzeichnung.
   */
  let join = ''
  let botBedingung = ''
  if (ohneBots) {
    try {
      botBedingung = require('./spieler').botFilterSql('acc')
      join = `LEFT JOIN \`${db.nameOf('auth')}\`.account acc ON acc.id = c.account`
    } catch (_) {}
  } else {
    try {
      const probe = await db.test('auth')
      if (probe && probe.ok) {
        join = `LEFT JOIN \`${db.nameOf('auth')}\`.account acc ON acc.id = c.account`
      }
    } catch (_) {}
  }
  /*
   * Die Reihenfolge. Ohne Angabe bleibt, was bisher galt: online zuerst,
   * dann die hoechste Stufe, dann der Name. Wer anders sortiert, hat das
   * ausdruecklich verlangt.
   *
   * Erlaubt sind nur feste Spaltennamen. Der Sortierwunsch kommt aus dem
   * Frontend, und dort kann jeder beliebige Text stehen - eine
   * Whitelist ist hier Pflicht, sonst waere das ein Loch in die Abfrage.
   */
  let ordnung = 'c.online DESC, c.level DESC, c.name ASC'
  const spalte = SORTIERBAR[String(sort || '').toLowerCase()]
  if (spalte) {
    const richtung = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    ordnung = `${spalte} ${richtung}, c.guid ASC`
  }

  // "logintime" gibt es in modernen Cores nicht mehr (siehe online.js)
  const loginzeit = await schema.erster('chars', 'characters', ['logintime', 'logout_time'])

  /*
   * Suche: Name immer; eine Zahl matcht zusätzlich GUID und Konto-ID, Text
   * zusätzlich den Konto-Namen (nur wenn der JOIN verfügbar ist). So findet
   * man Charaktere auch über "Account 42" oder die Kontobezeichnung.
   * Gilden-Suche über eine Schema-tolerante Unterabfrage (alt:
   * character_guild, modern: guild_member + guild).
   */
  const suchText = String(search || '').trim()
  let gildenSuche = null
  if (suchText) {
    try {
      if (!(await schema.tabelleFehlt('chars', 'guild_member'))) {
        gildenSuche = 'c.guid IN (SELECT m.guid FROM guild_member m JOIN guild g ON g.guildid = m.guildid WHERE g.name LIKE ?)'
      } else if (!(await schema.tabelleFehlt('chars', 'character_guild'))) {
        gildenSuche = 'c.guid IN (SELECT cg.guid FROM character_guild cg WHERE cg.name LIKE ?)'
      }
    } catch (_) {}
  }
  const abfrage = joinText => {
    const bedingungen = []
    const params = []
    if (suchText) {
      const teile = ['c.name LIKE ?']
      params.push(`%${suchText}%`)
      if (/^\d+$/.test(suchText)) {
        teile.push('c.guid = ?')
        params.push(int(suchText))
        teile.push('c.account = ?')
        params.push(int(suchText))
      }
      if (joinText) {
        teile.push('acc.username LIKE ?')
        params.push(`%${suchText}%`)
      }
      if (gildenSuche) {
        teile.push(gildenSuche)
        params.push(`%${suchText}%`)
      }
      bedingungen.push(`(${teile.join(' OR ')})`)
    }
    if (botBedingung) bedingungen.push(`(${botBedingung})`)
    if (nurOnline) bedingungen.push('c.online = 1')
    const where = bedingungen.length ? `WHERE ${bedingungen.join(' AND ')}` : ''
    params.push(int(limit, 200), int(offset, 0))
    return {
      sql: `
    SELECT c.guid, c.account, c.name, c.race, c.class AS classId, c.gender,
           c.level, c.money, c.map, c.zone, c.online, c.totaltime,
           ${loginzeit ? `c.\`${loginzeit}\`` : 'NULL'} AS logintime,
           c.position_x, c.position_y, c.position_z, c.orientation,
           ${joinText ? 'acc.username' : 'NULL'} AS username
    FROM characters c
    ${joinText}
    ${where}
    ORDER BY ${ordnung}
    LIMIT ? OFFSET ?
  `,
      params
    }
  }
  let rows
  try {
    const a = abfrage(join)
    rows = await db.query('chars', a.sql, a.params)
  } catch (e) {
    if (join && !ohneBots) {
      // Auth-DB zwischenzeitlich nicht erreichbar: ohne JOIN noch einmal
      join = ''
      const a = abfrage('')
      rows = await db.query('chars', a.sql, a.params)
    } else {
      throw e
    }
  }

  /*
   * Die Gildenzuordnung liegt je nach Core-Version unterschiedlich:
   * frueher in character_guild (guid, name), heute verteilt auf
   * guild_member (guid, guildid) und guild (guildid, name).
   *
   * Wichtig: die Verknuepfung heisst in beiden Tabellen "guildid" - nicht
   * "id" und nicht "guild", wie man raten wuerde.
   */
  let guilds = {}
  try {
    if (!(await schema.tabelleFehlt('chars', 'character_guild'))) {
      const g = await db.query('chars', 'SELECT guid, name FROM character_guild')
      for (const row of g) guilds[int(row.guid)] = row.name
    } else if (!(await schema.tabelleFehlt('chars', 'guild_member'))) {
      const g = await db.query('chars', `
        SELECT m.guid, g.name
        FROM guild_member m
        LEFT JOIN guild g ON g.guildid = m.guildid
      `)
      for (const row of g) if (row.name) guilds[int(row.guid)] = row.name
    }
  } catch (_) {
    guilds = {}
  }

  return rows.map(r => ({
    guid: int(r.guid),
    account: int(r.account),
    username: r.username || null,
    bot: r.username != null ? require('./spieler').istBotName(r.username) : null,
    name: r.name,
    race: int(r.race),
    classId: int(r.classId),
    gender: int(r.gender),
    level: int(r.level),
    money: int(r.money),
    map: int(r.map),
    zone: int(r.zone),
    online: int(r.online) > 0,
    totaltime: int(r.totaltime),
    logintime: r.logintime ? new Date(r.logintime * 1000).toISOString() : null,
    position: { x: r.position_x, y: r.position_y, z: r.position_z, o: r.orientation },
    guild: guilds[int(r.guid)] || null
  }))
}

async function countCharacters ({ search = '', ohneBots = false, nurOnline = false } = {}) {
  /*
   * Derselbe Filter wie in der Liste - inklusive Konto-Suche: sonst zeigt
   * die Liste mehr Treffer als die Seitenzahl kennt.
   */
  let join = ''
  let botBedingung = ''
  if (ohneBots) {
    try {
      botBedingung = require('./spieler').botFilterSql('acc')
      join = `LEFT JOIN \`${db.nameOf('auth')}\`.account acc ON acc.id = c.account`
    } catch (_) {}
  } else {
    try {
      const probe = await db.test('auth')
      if (probe && probe.ok) {
        join = `LEFT JOIN \`${db.nameOf('auth')}\`.account acc ON acc.id = c.account`
      }
    } catch (_) {}
  }
  const suchText = String(search || '').trim()
  // Gilden-Suche wie in der Liste (Schema-tolerant)
  let gildenSuche = null
  if (suchText) {
    try {
      if (!(await schema.tabelleFehlt('chars', 'guild_member'))) {
        gildenSuche = 'c.guid IN (SELECT m.guid FROM guild_member m JOIN guild g ON g.guildid = m.guildid WHERE g.name LIKE ?)'
      } else if (!(await schema.tabelleFehlt('chars', 'character_guild'))) {
        gildenSuche = 'c.guid IN (SELECT cg.guid FROM character_guild cg WHERE cg.name LIKE ?)'
      }
    } catch (_) {}
  }
  const abfrage = joinText => {
    const bedingungen = []
    const params = []
    if (suchText) {
      const teile = ['c.name LIKE ?']
      params.push(`%${suchText}%`)
      if (/^\d+$/.test(suchText)) {
        teile.push('c.guid = ?')
        params.push(int(suchText))
        teile.push('c.account = ?')
        params.push(int(suchText))
      }
      if (joinText) {
        teile.push('acc.username LIKE ?')
        params.push(`%${suchText}%`)
      }
      if (gildenSuche) {
        teile.push(gildenSuche)
        params.push(`%${suchText}%`)
      }
      bedingungen.push(`(${teile.join(' OR ')})`)
    }
    if (botBedingung) bedingungen.push(`(${botBedingung})`)
    if (nurOnline) bedingungen.push('c.online = 1')
    const where = bedingungen.length ? `WHERE ${bedingungen.join(' AND ')}` : ''
    return { sql: `SELECT COUNT(*) AS n FROM characters c ${joinText} ${where}`, params }
  }
  let rows
  try {
    const a = abfrage(join)
    rows = await db.query('chars', a.sql, a.params)
  } catch (e) {
    if (join && !ohneBots) {
      const a = abfrage('')
      rows = await db.query('chars', a.sql, a.params)
    } else {
      throw e
    }
  }
  return int(rows[0].n)
}

async function getCharacter (guid) {
  // "logintime" und "mana" gibt es in modernen Cores nicht mehr. Mana
  // heisst dort "power1" - power1..3 koennen je nach Klasse Mana, Rage
  // oder Energie sein.
  const loginzeit = await schema.erster('chars', 'characters', ['logintime', 'logout_time'])
  const mana = await schema.erster('chars', 'characters', ['mana', 'power1'])
  const rows = await db.query('chars', `
    SELECT guid, account, name, race, class AS classId, gender, level, money,
           map, zone, online, totaltime, health,
           ${loginzeit ? `\`${loginzeit}\`` : 'NULL'} AS logintime,
           ${mana ? `\`${mana}\`` : '0'} AS mana,
           position_x, position_y, position_z, orientation
    FROM characters WHERE guid = ?
  `, [int(guid)])
  if (!rows.length) throw new Error('Charakter nicht gefunden.')

  const c = rows[0]

  /*
   * Konto-Name + Bot-Erkennung für die Detailseite. Ohne erreichbare
   * Auth-DB bleibt es bei null (die Detailseite zeigt dann nur die ID).
   */
  let username = null
  let bot = null
  try {
    const probe = await db.test('auth')
    if (probe && probe.ok) {
      const acc = await db.query('auth', 'SELECT username FROM account WHERE id = ?', [int(c.account)])
      username = acc && acc.length ? acc[0].username : null
      if (username != null) bot = require('./spieler').istBotName(username)
    }
  } catch (_) {}

  const inv = await db.query('chars', `
    SELECT ci.item, ci.slot, ci.bag, it.itemEntry, it.owner_guid
    FROM character_inventory ci
    LEFT JOIN item_instance it ON it.guid = ci.item
    WHERE ci.guid = ?
    ORDER BY ci.bag ASC, ci.slot ASC
  `, [int(guid)])

  /*
   * Gilde: je nach Core character_guild (alt) oder guild_member + guild
   * (modern) - dieselbe Erkennung wie in der Charakterliste.
   */
  let guild = null
  try {
    if (!(await schema.tabelleFehlt('chars', 'character_guild'))) {
      const g = await db.query('chars', 'SELECT name FROM character_guild WHERE guid = ?', [int(guid)])
      guild = g && g.length ? g[0].name : null
    } else {
      const g = await db.query(
        'chars',
        'SELECT g.name FROM guild_member m JOIN guild g ON g.guildid = m.guildid WHERE m.guid = ?',
        [int(guid)]
      )
      guild = g && g.length ? g[0].name : null
    }
  } catch (_) {}

  const spells = await db.query('chars', 'SELECT spell FROM character_spell WHERE guid = ?', [int(guid)])

  /*
   * Die Talenttabelle heisst weiterhin character_talent, die Spalten aber
   * nicht mehr: frueher "talent" und "rank", heute "spell" und "specMask".
   *
   * Achtung "rank": das ist seit MySQL 8 ein reserviertes Wort (Fenster-
   * funktionen) und muss in Anfuehrungszeichen stehen, sonst meldet
   * MySQL einen Syntaxfehler statt einer fehlenden Spalte - was voellig
   * irrefuehrend ist.
   */
  let talents = []
  try {
    const tc = await schema.spalten('chars', 'character_talent')
    const talentSpalte = tc.has('talent') ? 'talent' : (tc.has('spell') ? 'spell' : null)
    if (talentSpalte) {
      const rankTeil = tc.has('rank') ? ', `rank`' : ', 1 AS `rank`'
      talents = await db.query(
        'chars',
        `SELECT \`${talentSpalte}\` AS \`talent\`${rankTeil}
         FROM character_talent WHERE guid = ? ORDER BY \`${talentSpalte}\` ASC`,
        [int(guid)]
      )
    }
  } catch (_) {
    talents = []
  }

  return {
    guid: int(c.guid),
    account: int(c.account),
    username,
    bot,
    name: c.name,
    guild,
    race: int(c.race),
    classId: int(c.classId),
    gender: int(c.gender),
    level: int(c.level),
    faction: fraktionVon(c.race),
    money: int(c.money),
    map: int(c.map),
    zone: int(c.zone),
    online: int(c.online) > 0,
    totaltime: int(c.totaltime),
    logintime: c.logintime ? new Date(c.logintime * 1000).toISOString() : null,
    health: int(c.health),
    mana: int(c.mana),
    position: { x: c.position_x, y: c.position_y, z: c.position_z, o: c.orientation },
    inventory: inv.map(i => ({
      guid: int(i.item),
      slot: int(i.slot),
      bag: int(i.bag),
      itemEntry: int(i.itemEntry)
    })),
    spells: spells.map(s => int(s.spell)),
    talents: talents.map(t => ({ talent: int(t.talent), rank: int(t.rank) }))
  }
}

/*
 * Loeschen mit Aufraeumen.
 *
 * Ausgangsproblem: deleteCharacter hat nur die Zeile aus characters geloescht.
 * Alles andere blieb stehen - im Durchschnitt 98 Zeilen je Charakter, im
 * Extremfall 581, dazu die Gegenstaende.
 *
 * Warum hier eine halbe Handvoll Tabellen fest steht und der Rest zur Laufzeit
 * geholt wird: Ein Muster ueber "alle Tabellen mit guid-Spalte" waere
 * bequem und waere falsch. creature_respawn.guid und corpse.guid enthalten
 * Spawn- beziehungsweise Leichenkennungen, und die koennen zufaellig genau so
 * aussehen wie eine Charakterkennung. Ein solches Loeschen traegt echte Daten
 * mit. Die character_-Tabellen sind dagegen eindeutig, die werden erkannt;
 * alles andere wird einzeln aufgefuehrt.
 *
 * Reihenfolge: erst die Kinder, zuletzt characters. Ein Abbruch dazwischen
 * laesst den Charakter zurueck und nur seine Zusatzzeilen fehlen - das ist
 * heilbar. Der umgekehrte Weg wuerde Waisen erzeugen, die niemand mehr zuordnet.
 */

const SONDER_TABELLEN = [
  { tabelle: 'character_pet', spalte: 'owner' },
  { tabelle: 'character_pet_declinedname', spalte: 'owner' },
  { tabelle: 'guild_member', spalte: 'guid' },
  { tabelle: 'guild_member_withdraw', spalte: 'guid' },
  { tabelle: 'item_instance', spalte: 'owner_guid' },
  { tabelle: 'beastmaster_tamed_pets', spalte: 'owner_guid' },
  { tabelle: 'mod_improved_bank', spalte: 'owner_guid' },
  { tabelle: 'mail', spalte: 'receiver' },
  { tabelle: 'mail_server_character', spalte: 'guid' },
  { tabelle: 'arena_team_member', spalte: 'guid' },
  { tabelle: 'battleground_deserters', spalte: 'guid' },
  { tabelle: 'group_member', spalte: 'guid' },
  { tabelle: 'gm_survey', spalte: 'guid' },
  { tabelle: 'lag_reports', spalte: 'guid' },
  { tabelle: 'lfg_data', spalte: 'guid' },
  { tabelle: 'log_arena_memberstats', spalte: 'guid' },
  { tabelle: 'instance_saved_go_state_data', spalte: 'guid' },
  { tabelle: 'mythic_plus_char_level', spalte: 'guid' },
  { tabelle: 'mythic_plus_keystone_timer', spalte: 'guid' },
  { tabelle: 'dm_player_stats', spalte: 'guid' },
  { tabelle: 'dm_roguelike_player_stats', spalte: 'guid' }
  /*
   * custom_transmogrification ist bewusst NICHT dabei: sie fuehrt sowohl GUID
   * als auch Owner und ist auf diesem Server leer. Welche Spalte den
   * Charakter meint, laesst sich ohne Zeilen nicht feststellen - und eine
   * falsch geratene Spalte loescht fremde Daten. Lieber stehen lassen.
   */
]

// Haustier-Zeilen tragen die Kennung des Haustiers, nicht des Charakters
const HAUSTIER_TABELLEN = ['pet_aura', 'pet_spell', 'pet_spell_cooldown']

/*
 * Alle Tabellen sammeln, die diesem Charakter gehoeren - mit der Angabe, wie
 * viele Zeilen darin stehen. Wird fuer die Vorschau und fuer das Loeschen
 * benutzt, damit beide garantiert dieselbe Liste sehen.
 */
async function loeschplan (guid) {
  const g = int(guid)

  // character_-Tabellen zur Laufzeit: der Name ist eindeutig, die Spalte nicht
  const gefunden = await db.query('chars', `
    SELECT TABLE_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME LIKE 'character\\_%'
      AND COLUMN_NAME = 'guid'
    ORDER BY TABLE_NAME`)

  const plan = gefunden.map(r => ({ tabelle: r.TABLE_NAME, spalte: 'guid' }))
  const vorhanden = new Set(plan.map(p => p.tabelle))

  for (const s of SONDER_TABELLEN) {
    if (vorhanden.has(s.tabelle)) continue
    // Gibt es die Spalte ueberhaupt? Bei Modulen kann sie fehlen.
    const sp = await db.query('chars', `
      SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [s.tabelle, s.spalte])
    if (!Number(sp[0].n)) continue
    plan.push(s)
  }

  // Haustiere zuerst ermitteln - ihre Zeilen haengen an der Haustierkennung
  let haustiere = []
  try {
    const h = await db.query('chars', 'SELECT id FROM character_pet WHERE owner = ?', [g])
    haustiere = h.map(r => int(r.id))
  } catch (_) {
    haustiere = []
  }
  for (const t of HAUSTIER_TABELLEN) {
    if (!haustiere.length) break
    plan.push({ tabelle: t, spalte: 'guid', werte: haustiere })
  }

  // Stueckzahlen ermitteln, damit die Oberflaeche sagen kann, was betroffen ist
  const mitZahlen = []
  for (const p of plan) {
    let rows = 0
    try {
      if (p.werte) {
        const pl = p.werte.map(() => '?').join(', ')
        const r = await db.query('chars', `SELECT COUNT(*) AS n FROM \`${p.tabelle}\` WHERE \`${p.spalte}\` IN (${pl})`, p.werte)
        rows = Number(r[0].n)
      } else {
        const r = await db.query('chars', `SELECT COUNT(*) AS n FROM \`${p.tabelle}\` WHERE \`${p.spalte}\` = ?`, [g])
        rows = Number(r[0].n)
      }
    } catch (_) {
      rows = 0
    }
    if (rows > 0) mitZahlen.push({ ...p, rows })
  }

  /*
   * Die Haustierkennungen werden ausdruecklich gesetzt statt ueber die
   * Kurzschreibweise "{ haustiere }" - die lieferte hier zufaellig undefined,
   * waehrend derselbe Wert eine Zeile spaeter noch korrekt war. Ursache nicht
   * gefunden, deshalb nicht weiter darauf vertraut.
   */
  const petGuids = Array.isArray(haustiere) ? haustiere : []
  return { guid: g, haustiere: petGuids, eintraege: mitZahlen }
}

/* Vorschau fuer die Rueckfrage: was wuerde beim Loeschen mitgenommen? */
async function deletePreview (guid) {
  const g = int(guid)
  const c = await db.query('chars', 'SELECT name, online, level FROM characters WHERE guid = ?', [g])
  if (!c.length) throw new Error('Charakter nicht gefunden.')

  const plan = await loeschplan(g)
  const summe = plan.eintraege.reduce((a, e) => a + e.rows, 0) + 1

  return {
    name: c[0].name,
    level: int(c[0].level),
    online: int(c[0].online) > 0,
    guid: g,
    zeilen: summe,
    tabellen: plan.eintraege.length,
    haustiere: (plan.hustiere || []).length,
    posten: plan.eintraege
      .sort((a, b) => b.rows - a.rows)
      .slice(0, 12)
      .map(e => ({ tabelle: e.tabelle, rows: e.rows }))
  }
}

/*
 * Endgueltig loeschen. Ohne "bestaetigt" passiert nichts - die Vorschau und
 * dieser Aufruf sollen nicht versehentlich aus einem Klick entstehen.
 */
async function deleteCharacter (guid, { bestaetigt = false } = {}) {
  const g = int(guid)
  const c = await db.query('chars', 'SELECT name, online FROM characters WHERE guid = ?', [g])
  if (!c.length) throw new Error('Charakter nicht gefunden.')
  if (int(c[0].online) > 0) {
    throw new Error(`${c[0].name} ist gerade online. Bitte erst ausloggen.`)
  }
  if (!bestaetigt) {
    throw new Error('Das Loeschen muss bestaetigt werden.')
  }

  const plan = await loeschplan(g)
  const entfernt = []
  let fehler = null

  for (const p of plan.eintraege) {
    try {
      const r = p.werte
        ? await db.execute('chars', `DELETE FROM \`${p.tabelle}\` WHERE \`${p.spalte}\` IN (${p.werte.map(() => '?').join(', ')})`, p.werte)
        : await db.execute('chars', `DELETE FROM \`${p.tabelle}\` WHERE \`${p.spalte}\` = ?`, [g])
      if (r && r.affectedRows) entfernt.push({ tabelle: p.tabelle, rows: r.affectedRows })
    } catch (e) {
      // Ein fehlgeschlagener Nebenschritt darf den Hauptschritt nicht verhindern -
      // aber sichtbar werden muss er trotzdem.
      fehler = `${p.tabelle}: ${e.message}`
    }
  }

  // Zuletzt und einzeln die Hauptzeile
  const r = await db.execute('chars', 'DELETE FROM characters WHERE guid = ?', [g])

  return {
    ok: true,
    name: c[0].name,
    entfernt,
    zeilen: entfernt.reduce((a, e) => a + e.rows, 0) + (r && r.affectedRows ? r.affectedRows : 0),
    fehler
  }
}

async function updateCharacter (guid, patch) {
  const g = int(guid)
  const sets = []
  const params = []
  let fraktionGewechselt = false
  const add = (col, val) => {
    if (val !== undefined && val !== null && val !== '') {
      sets.push(`${col} = ?`)
      params.push(val)
    }
  }

  // Zahl Felder: Number() liefert NaN bei leeren oder verdrehten Eingaben.
  // "NaN" in eine float-Spalte geschrieben ist ein stiller Datenverlust - der
  // Charakter steht danach in einer Masse, die der Server beim Start nicht mehr
  // lesen kann. Deshalb wird vorher geprueft statt danach.
  const zahl = (v, was) => {
    if (v === undefined || v === null || String(v).trim() === '') return null
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`${was} ist keine gültige Zahl.`)
    return n
  }

  /*
   * Position und Karte gehoeren dem Worldserver, sobald der Charakter online
   * ist: er schreibt sie bei jeder Bewegung neu. Ein UPDATE von aussen wird
   * beim naechsten Tick ueberschrieben - oder der Charakter landet mitten in
   * einer Wand, weil Zone, Karte und Position nicht zueinander passen. Deshalb
   * nur bei offlineen Charakteren.
   */
  const bewegt = ['x', 'y', 'z', 'o', 'map', 'zone'].some(k => patch[k] !== undefined)
  if (bewegt) {
    const c = await db.query('chars', 'SELECT name, online FROM characters WHERE guid = ?', [g])
    if (!c.length) throw new Error('Charakter nicht gefunden.')
    if (int(c[0].online) > 0) {
      throw new Error(`${c[0].name} ist gerade online. Position und Karte lassen sich nur bei offlineen Charakteren ändern.`)
    }
  }

  if (patch.level !== undefined) add('level', Math.min(80, Math.max(1, int(patch.level, 1))))
  if (patch.money !== undefined) add('money', Math.max(0, int(patch.money, 0)))
  if (patch.zone !== undefined) add('zone', Math.max(0, int(patch.zone, 0)))
  if (patch.map !== undefined) add('map', Math.max(0, int(patch.map, 0)))
  if (patch.x !== undefined) { const n = zahl(patch.x, 'X'); if (n !== null) add('position_x', n) }
  if (patch.y !== undefined) { const n = zahl(patch.y, 'Y'); if (n !== null) add('position_y', n) }
  if (patch.z !== undefined) { const n = zahl(patch.z, 'Z'); if (n !== null) add('position_z', n) }
  if (patch.o !== undefined) { const n = zahl(patch.o, 'Blickrichtung'); if (n !== null) add('orientation', n) }
  if (patch.flags !== undefined) add('flags', Math.max(0, int(patch.flags, 0)))

  /*
   * Fraktionswechsel.
   *
   * Es gibt keine faction-Spalte - der Wechsel ist ein Rassenwechsel auf das
   * Gegenstueck. Haut, Haar und Haarfarbe bleiben dabei, wie sie sind: sichere
   * Standardwerte je Rasse gibt es nicht zuverlaessig, und eine erfundene
   * Zahl sieht schlimmer aus als eine vorhandene. Wer das Angleichen will,
   * setzt die Felder danach von Hand.
   */
  if (patch.faction !== undefined) {
    // Dieser Zweig schreibt selbst und fuellt "sets" nicht - deshalb wird das
    // unten als "es gab eine Aenderung" vermerkt.
    fraktionGewechselt = true
    const gewuenscht = int(patch.faction, 0)
    if (gewuenscht !== 0 && gewuenscht !== 1) {
      throw new Error('Fraktion muss 0 (Allianz) oder 1 (Horde) sein.')
    }
    const c = await db.query('chars', 'SELECT name, race, gender, online FROM characters WHERE guid = ?', [g])
    if (!c.length) throw new Error('Charakter nicht gefunden.')
    if (int(c[0].online) > 0) {
      throw new Error(`${c[0].name} ist gerade online. Bitte erst ausloggen.`)
    }
    const alt = int(c[0].race)
    if (fraktionVon(alt) === gewuenscht) {
      throw new Error(`${c[0].name} ist bereits in dieser Fraktion.`)
    }
    const neu = RASSEN_PAARE[alt]
    if (!neu) {
      throw new Error(`Für die Rasse ${alt} gibt es kein Gegenstück in der anderen Fraktion.`)
    }
    // Geschlecht mitwechseln - so wird es auch ohne eigenes Servermodul gemacht.
    const neuGender = patch.gender !== undefined
      ? int(patch.gender, 0)
      : 1 - int(c[0].gender)
    await db.execute('chars', 'UPDATE characters SET race = ?, gender = ? WHERE guid = ?', [neu, neuGender, g])
  }

  if (!sets.length && !fraktionGewechselt) throw new Error('Keine Aenderungen uebergeben.')
  // Nur senden, wenn wirklich Felder in sets stehen. Beim reinen
  // Fraktionswechsel ist sets leer und "SET  WHERE guid = ?" waere ein
  // Syntaxfehler.
  if (sets.length) {
    params.push(g)
    await db.execute('chars', `UPDATE characters SET ${sets.join(', ')} WHERE guid = ?`, params)
  }
  return { ok: true }
}

/*
 * Umbenennen.
 *
 * Zwei Dinge, die vorher fehlten und im Spiel richtig teuer werden:
 *
 * 1. Doppelte Namen. Die Spalte username in characters ist mit utf8mb4_unicode_ci
 *    case-insensitiv, "Thrall" und "thrall" gelten also als gleich. Ohne
 *    Pruefung legt das Panel zwei Charaktere an, die es im Spiel nicht
 *    gleichzeitig gibt - einer verschwindet beim Login.
 *
 * 2. Erlaubte Zeichen. Der Client stellt nur Buchstaben dar. Ein Name mit
 *    Leerzeichen, Ziffer oder Apostroph wird beim Betreten unsichtbar oder
 *    gar nicht akzeptiert. AzerothCore prueft das beim Anlegen ebenfalls.
 */
async function renameCharacter (guid, newName) {
  const alt = String(newName || '').trim()
  if (alt.length < 2 || alt.length > 12) throw new Error('Name muss 2-12 Zeichen haben.')
  if (!/^[A-Za-zÄÖÜäöüß]+$/.test(alt)) {
    throw new Error('Der Name darf nur Buchstaben enthalten - keine Leerzeichen, Ziffern oder Sonderzeichen.')
  }

  const g = int(guid)
  // MySQL vergleicht hier bereits case-insensitiv, deshalb genuegt LOWER().
  const belegt = await db.query(
    'chars',
    'SELECT guid, name FROM characters WHERE LOWER(name) = LOWER(?) AND guid <> ? LIMIT 1',
    [alt, g]
  )
  if (belegt.length) {
    throw new Error(`Der Name "${belegt[0].name}" ist bereits vergeben.`)
  }

  await db.execute('chars', 'UPDATE characters SET name = ? WHERE guid = ?', [alt, g])
  return { ok: true, name: alt }
}

async function resetTalents (guid) {
  await db.execute('chars', 'DELETE FROM character_talent WHERE guid = ?', [int(guid)])
  return { ok: true }
}

/*
 * Teleportieren - bewusst eine eigene Funktion und nicht nur ein Schreiben
 * von position_x.
 *
 * Zwei Betriebsarten:
 *   nach Koordinaten  { guid, map, x, y, z, o }
 *   an ein Zeichen    { guid, fromGuid }  - uebernimmt Karte und Position
 *
 * Die zweite ist im Alltag die nuetzlichere: sie braucht keine Zahlen aus dem
 * Kopf und ist damit auch nicht versehentlich falsch.
 *
 * In beiden Faellen muss der Zielcharakter offline sein - ein laufender
 * Worldserver schreibt Position und Karte bei jeder Bewegung neu und wuerde
 * den Wert ungenutzt ueberschreiben.
 */
/*
 * Zahl aus einem Eingabefeld.
 *
 * Wichtig: Number('') ist 0 und Number('  ') ist ebenfalls 0 - NICHT NaN.
 * Eine leere Eingabe als Koordinate zu pruefen reicht also nicht, sie wird
 * sonst stillschweigend zu 0 und schickt den Charakter nach (0,0,0).
 */
function zahlAusFeld (v, was) {
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`${was} darf nicht leer sein.`)
  }
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${was} ist keine gültige Zahl.`)
  return n
}

async function teleport (params = {}) {
  const g = int(params.guid)
  const ziel = await db.query('chars',
    'SELECT guid, name, online FROM characters WHERE guid = ?', [g])
  if (!ziel.length) throw new Error('Charakter nicht gefunden.')
  if (int(ziel[0].online) > 0) {
    throw new Error(`${ziel[0].name} ist gerade online. Bitte erst ausloggen.`)
  }

  let karte
  let x
  let y
  let z
  let o

  if (params.fromGuid !== undefined && params.fromGuid !== null && params.fromGuid !== '') {
    const q = int(params.fromGuid)
    if (q === g) throw new Error('Quelle und Ziel sind derselbe Charakter.')
    const quelle = await db.query('chars',
      'SELECT name, map, position_x, position_y, position_z, orientation FROM characters WHERE guid = ?', [q])
    if (!quelle.length) throw new Error('Der Quellcharakter wurde nicht gefunden.')
    karte = int(quelle[0].map)
    x = Number(quelle[0].position_x)
    y = Number(quelle[0].position_y)
    z = Number(quelle[0].position_z)
    o = Number(quelle[0].orientation)
  } else {
    karte = int(params.map)
    x = zahlAusFeld(params.x, 'X')
    y = zahlAusFeld(params.y, 'Y')
    z = zahlAusFeld(params.z, 'Z')
    o = params.o === undefined || params.o === null || String(params.o).trim() === '' ? 0 : zahlAusFeld(params.o, 'Blickrichtung')
  }

  // Ein leeres Feld ergibt NaN. Das waere ein stiller Datenverlust.
  for (const [wert, was] of [[x, 'X'], [y, 'Y'], [z, 'Z'], [o, 'Blickrichtung']]) {
    if (!Number.isFinite(wert)) throw new Error(`${was} ist keine gültige Zahl.`)
  }
  if (karte < 0) throw new Error('Karte ist ungültig.')

  await db.execute('chars',
    'UPDATE characters SET map = ?, position_x = ?, position_y = ?, position_z = ?, orientation = ? WHERE guid = ?',
    [karte, x, y, z, o, g])
  return { ok: true, map: karte, x, y, z, o }
}

/*
 * Karten fuer die Auswahl im Teleport-Dialog.
 *
 * Bewusst aus der Datenbank geholt statt aus einer festen Liste: so stehen
 * genau die Karten drin, auf denen dieser Server tatsaechlich etwas hat.
 * Namen gibt es nur, wo sie eindeutig sind - ein falscher Kartenname waere
 * schlimmer als eine reine Zahl.
 */
async function maps () {
  const chars = await db.query('chars', 'SELECT map, COUNT(*) AS n FROM characters GROUP BY map')
  const crea = await db.query('world', 'SELECT map, COUNT(*) AS n FROM creature GROUP BY map')
  const alle = new Map()
  for (const r of chars) alle.set(int(r.map), { map: int(r.map), charaktere: int(r.n), creatures: 0 })
  for (const r of crea) {
    const k = int(r.map)
    if (!alle.has(k)) alle.set(k, { map: k, charaktere: 0, creatures: 0 })
    alle.get(k).creatures = int(r.n)
  }

  // Nur diese vier sind eindeutig; der Rest bleibt eine Zahl.
  const NAMEN = {
    0: 'Eastern Kingdoms',
    1: 'Kalimdor',
    530: 'The Outland',
    571: 'Norsca'
  }

  const liste = [...alle.values()]
    .map(k => ({ ...k, name: NAMEN[k.map] || null }))
    .sort((a, b) => b.charaktere - a.charaktere || b.creatures - a.creatures)
  return { karten: liste, chars: chars.length }
}

/*
 * Postfach eines Charakters: Mails plus angehaengte Items. Rein lesend.
 * Genau die Ansicht fuer "mein Item ist nicht angekommen".
 */
async function postfach (guid) {
  const gid = Number(guid)
  if (!gid) throw new Error('Keine Charakter-GUID angegeben.')
  if (await schema.tabelleFehlt('chars', 'mail')) {
    return { verfuegbar: false, liste: [], anzahl: 0 }
  }
  const mails = await db.query(
    'chars',
    `SELECT id, messageType, stationery, mailTemplateId, sender, subject, body,
            has_items, expire_time, deliver_time, money, cod, checked
       FROM mail
      WHERE receiver = ?
   ORDER BY deliver_time DESC, id DESC
      LIMIT 100`,
    [gid]
  )
  const ids = mails.map(m => Number(m.id)).filter(Boolean)
  let items = []
  if (ids.length && !(await schema.tabelleFehlt('chars', 'mail_items'))) {
    const welt = db.nameOf('world')
    try {
      items = await db.query(
        'chars',
        `SELECT mi.mail_id, mi.item_guid,
                ii.itemEntry AS entry, ii.\`Count\` AS anzahl,
                it.name, it.Quality AS quality, it.ItemLevel AS itemLevel
           FROM mail_items mi
           JOIN item_instance ii ON ii.guid = mi.item_guid
      LEFT JOIN \`${welt}\`.item_template it ON it.entry = ii.itemEntry
          WHERE mi.mail_id IN (${ids.map(() => '?').join(',')})`,
        ids
      )
    } catch (_) {
      items = []
    }
  }
  const itemMap = new Map()
  for (const it of items) {
    const key = Number(it.mail_id)
    if (!itemMap.has(key)) itemMap.set(key, [])
    itemMap.get(key).push({
      entry: Number(it.entry) || 0,
      anzahl: Number(it.anzahl) || 1,
      name: it.name || `Item ${it.entry}`,
      quality: Number(it.quality) || 0,
      itemLevel: Number(it.itemLevel) || 0
    })
  }
  const senderIds = [...new Set(mails.map(m => Number(m.sender)).filter(Boolean))]
  const sender = new Map()
  if (senderIds.length) {
    try {
      const rows = await db.query(
        'chars',
        `SELECT guid, name FROM characters WHERE guid IN (${senderIds.map(() => '?').join(',')})`,
        senderIds
      )
      for (const r of rows) sender.set(Number(r.guid), r.name)
    } catch (_) {}
  }
  return {
    verfuegbar: true,
    anzahl: mails.length,
    liste: mails.map(m => ({
      id: Number(m.id),
      typ: Number(m.messageType) || 0,
      sender: Number(m.sender) || 0,
      senderName: sender.get(Number(m.sender)) || null,
      subject: m.subject || '',
      body: m.body || '',
      geld: Number(m.money) || 0,
      nachnahme: Number(m.cod) || 0,
      gelesen: Number(m.checked) === 1,
      express: Number(m.deliver_time) > 0,
      gesendet: m.deliver_time ? new Date(Number(m.deliver_time) * 1000).toISOString() : null,
      laeuftAb: m.expire_time ? new Date(Number(m.expire_time) * 1000).toISOString() : null,
      items: itemMap.get(Number(m.id)) || []
    }))
  }
}

module.exports = {
  listCharacters,
  countCharacters,
  getCharacter,
  deleteCharacter,
  updateCharacter,
  renameCharacter,
  resetTalents,
  teleport,
  maps,
  deletePreview,
  loeschplan,
  itemNamen,
  postfach
}

/*
 * Item-Namen für das Inventar: die Charakter-DB kennt nur itemEntry-IDs,
 * die Namen liegen in der Welt-DB (item_template). Gebündelt und begrenzt -
 * ein Inventar hat selten mehr als 100 Slots.
 */
async function itemNamen ({ entries = [] } = {}) {
  const liste = [...new Set((Array.isArray(entries) ? entries : []).map(n => int(n)).filter(n => n > 0))].slice(0, 500)
  if (!liste.length) return []
  const platzhalter = liste.map(() => '?').join(', ')
  const rows = await db.execute(
    'world',
    `SELECT entry, name, Quality AS quality, ItemLevel AS itemLevel FROM item_template WHERE entry IN (${platzhalter})`,
    liste
  )
  return Array.isArray(rows)
    ? rows.map(r => ({ entry: int(r.entry), name: r.name, quality: int(r.quality), itemLevel: int(r.itemLevel) }))
    : []
}