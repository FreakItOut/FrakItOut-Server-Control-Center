'use strict'

const db = require('../db')

/*
 * Die Tabelle realmlist hat mit der Zeit zwei Namen bekommen:
 *
 *   frueher:  realmflags, realmbuilds      (TrinityCore / AzerothCore 3.3.5)
 *   heute:   flag, gamebuild               (modernes AzerothCore)
 *
 * Ausserdem kam localAddress/localSubnetMask dazu. Wer die alten Namen
 * fest verdrahtet, bekommt bei jedem modernen Core einen SQL-Fehler -
 * und das Menue zeigt dann ohne erkennbaren Grund "Keine Realms".
 * Darum wird das Schema einmalig gelesen und gemerkt.
 */
let schemaCache = null

async function schema () {
  // Mit der Verbindung verknuepft: zeigt der Nutzer auf eine andere
  // Datenbank, wird das Schema neu gelesen statt weiterverwendet.
  const schluessel = db.keyOf()
  if (schemaCache && schemaCache.schluessel === schluessel) return schemaCache
  const rows = await db.query('auth', 'SHOW COLUMNS FROM realmlist')
  const vorhanden = new Set(
    (rows || []).map(r => String(r.Field || r.field || '').toLowerCase())
  )
  const nimm = (alt, neu) => (vorhanden.has(neu) ? neu : alt)
  schemaCache = {
    schluessel,
    spalten: vorhanden,
    flags: nimm('realmflags', 'flag'),
    builds: nimm('realmbuilds', 'gamebuild'),
    // Schreiben nur auf Spalten, die es in diesem Schema wirklich gibt
    insertierbar: ['name', 'address', 'port', 'icon', 'timezone', 'allowedSecurityLevel', 'population']
      .filter(c => vorhanden.has(c.toLowerCase()))
  }
  return schemaCache
}

// Frische erzwingen, wenn der Nutzer die Datenbank wechselt
function schemaZuruecksetzen () {
  schemaCache = null
}

async function listRealms () {
  const s = await schema()
  return db.query('auth', `
    SELECT id, name, address, port, icon,
           ${s.flags} AS realmflags, timezone,
           allowedSecurityLevel, population, ${s.builds} AS realmbuilds
    FROM realmlist ORDER BY id ASC
  `)
}

async function createRealm (data) {
  const { name, address, port = 8085, icon = 0, timezone = 1, security = 0, population = 0 } = data || {}
  if (!name || !address) throw new Error('Name und Adresse sind Pflicht.')
  const s = await schema()

  /*
   * Nur die Spalten, die es wirklich gibt. flag/gamebuild bekommen ihren
   * Standardwert - sie nicht zu nennen ist robuster, als ihnen einen
   * Wert zu geben, der im anderen Schema keinen Sinn ergibt ('' in einem
   * int-Feld etwa).
   */
  const werte = {
    name,
    address,
    port: Number(port),
    icon: Number(icon),
    timezone: Number(timezone),
    allowedSecurityLevel: Number(security),
    population: Number(population)
  }
  const spalten = s.insertierbar
  const res = await db.execute(
    'auth',
    `INSERT INTO realmlist (${spalten.join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`,
    spalten.map(k => werte[k])
  )
  return { ok: true, id: res.insertId }
}

async function updateRealm (data) {
  const { id, name, address, port, icon, timezone, security, population, flags } = data || {}
  if (!id) throw new Error('Realm-ID fehlt.')
  const s = await schema()
  const sets = []
  const params = []
  const push = (col, val) => {
    if (val !== undefined && val !== null && val !== '') {
      sets.push(`${col} = ?`)
      params.push(val)
    }
  }
  push('name', name)
  push('address', address)
  push('port', Number(port))
  push('icon', Number(icon))
  push('timezone', Number(timezone))
  push('allowedSecurityLevel', security !== undefined ? Number(security) : undefined)
  push('population', population !== undefined ? Number(population) : undefined)
  // flag/realmflags: 0 = normal, Bit 2 = OFFLINE (Wartungsmodus)
  push(s.flags, flags !== undefined ? Number(flags) : undefined)
  if (!sets.length) throw new Error('Keine Aenderungen uebergeben.')
  params.push(Number(id))
  await db.execute('auth', `UPDATE realmlist SET ${sets.join(', ')} WHERE id = ?`, params)
  return { ok: true }
}

/*
 * Wartungsmodus: setzt/entfernt das OFFLINE-Bit (2) in realmlist.flags.
 * Der Authserver liest die Realm-Liste nur beim Start - deshalb wird er
 * hier neu gestartet. Laufende Spiel-Sessions hängen am Worldserver und
 * bleiben unberührt; nur neue Logins pausieren kurz.
 */
async function wartung ({ id, offline } = {}) {
  const s = await schema()
  const rows = await db.query('auth', `SELECT id, ${s.flags} AS flags FROM realmlist WHERE id = ?`, [Number(id)])
  if (!Array.isArray(rows) || !rows.length) throw new Error('Realm nicht gefunden.')
  const alt = Number(rows[0].flags) || 0
  const neu = offline ? (alt | 2) : (alt & ~2)
  await db.execute('auth', `UPDATE realmlist SET ${s.flags} = ? WHERE id = ?`, [neu, Number(id)])

  let authNeu = false
  try {
    const sm = require('../server-manager')
    if (sm.status().auth && sm.status().auth.running) {
      await sm.restart('auth')
      authNeu = true
    }
  } catch (_) {}
  return { ok: true, offline: (neu & 2) === 2, flags: neu, authNeu }
}

async function deleteRealm (id) {
  await db.execute('auth', 'DELETE FROM realmlist WHERE id = ?', [Number(id)])
  return { ok: true }
}

module.exports = { listRealms, createRealm, updateRealm, deleteRealm, wartung, schema, schemaZuruecksetzen }