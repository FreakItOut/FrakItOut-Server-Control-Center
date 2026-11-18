'use strict'

const mysql = require('mysql2/promise')

let store = null
const pools = { auth: null, chars: null, world: null }
let cfgKey = ''

function init (storeRef) {
  store = storeRef
}

function currentCfg () {
  const m = store.read().mysql || {}
  // Port kann durch fehlerhafte Eingaben 0 oder NaN sein -> auf 3306 zurueckfallen
  const port = Number(m.port)
  return {
    ...m,
    host: m.host || '127.0.0.1',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3306
  }
}

function buildPool (kind, db) {
  const m = currentCfg()
  return mysql.createPool({
    host: m.host,
    port: m.port,
    user: m.user,
    password: m.password,
    database: db,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    multipleStatements: false,
    charset: 'utf8mb4_general_ci'
  })
}

function keyOf () {
  const m = currentCfg()
  return [m.host, m.port, m.user, m.password, m.authDb, m.charDb, m.worldDb].join('|')
}

/*
 * Name der Datenbank fuer eine Art. Noetig, wenn eine Abfrage ueber
 * Datenbankgrenzen hinweg laeuft: "account" liegt in der Auth-Datenbank,
 * "characters" in der Character-Datenbank. MySQL findet sie sonst nicht,
 * auch wenn beide im selben Server stehen.
 */
function nameOf (kind) {
  const m = currentCfg()
  const name = kind === 'auth' ? m.authDb : kind === 'chars' ? m.charDb : m.worldDb
  // Kommt aus der Konfiguration, geht aber direkt in SQL - absichern.
  if (!/^[A-Za-z0-9_$-]+$/.test(String(name || ''))) {
    throw new Error(`Ungueltiger Datenbankname: ${name}`)
  }
  return name
}

async function pool (kind) {
  const m = currentCfg()
  const db = kind === 'auth' ? m.authDb : kind === 'chars' ? m.charDb : m.worldDb
  const key = keyOf()
  if (key !== cfgKey) {
    // Konfiguration geaendert -> alte Pools schliessen
    await closeAll()
    cfgKey = key
    pools.auth = pools.chars = pools.world = null
  }
  if (!pools[kind]) {
    pools[kind] = buildPool(kind, db)
  }
  return pools[kind]
}

async function query (kind, sql, params = []) {
  const p = await pool(kind)
  const [rows] = await p.query(sql, params)
  return rows
}

async function execute (kind, sql, params = []) {
  const p = await pool(kind)
  const [result] = await p.query(sql, params)
  return result
}

async function closeAll () {
  for (const k of Object.keys(pools)) {
    if (pools[k]) {
      try {
        await pools[k].end()
      } catch (_) {}
      pools[k] = null
    }
  }
}

async function test (kind = 'world') {
  try {
    await query(kind, 'SELECT 1 AS ok')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

module.exports = { init, query, execute, closeAll, test, pool, keyOf, nameOf }