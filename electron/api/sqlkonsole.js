'use strict'

/*
 * Datenbank-Konsole - ausschliesslich lesend.
 *
 * Die Beschraenkung ist Absicht: Das Panel soll schnelle Antworten auf
 * "wie viele ...?", "welche Tabelle ...?" geben, aber keine zweite,
 * ungepruefte Schreibschnittstelle neben Modul-SQL und Konfiguration
 * oeffnen. Erlaubt sind SELECT, SHOW, EXPLAIN, DESCRIBE und WITH-SELECT.
 */

const db = require('../db')

const MAX_ROWS = 200
const TIMEOUT_MS = 10000
const MAX_SQL = 4000
const VERLAUF_MAX = 20

let store = null

function init (storeRef) {
  store = storeRef
}

function ohneKommentar (sql) {
  let s = String(sql || '').trim()
  for (;;) {
    if (s.startsWith('--')) {
      const i = s.indexOf('\n')
      if (i === -1) return ''
      s = s.slice(i + 1).trim()
      continue
    }
    if (s.startsWith('/*')) {
      const i = s.indexOf('*/')
      if (i === -1) return ''
      s = s.slice(i + 2).trim()
      continue
    }
    break
  }
  return s
}

function pruefe (sql) {
  const roh = String(sql || '').trim()
  if (!roh) throw new Error('Die Abfrage ist leer.')
  if (roh.length > MAX_SQL) throw new Error(`Die Abfrage ist zu lang (max. ${MAX_SQL} Zeichen).`)
  const s = ohneKommentar(roh).replace(/;\s*$/, '').trim()
  if (!s) throw new Error('Die Abfrage enthält nur einen Kommentar.')
  if (s.includes(';')) throw new Error('Bitte nur eine Anweisung pro Abfrage.')
  if (!/^(select|show|explain|describe|desc|with)\b/i.test(s)) {
    throw new Error('Nur lesende Abfragen sind erlaubt: SELECT, SHOW, EXPLAIN, DESCRIBE, WITH.')
  }
  if (/^with\b/i.test(s) && /\b(insert|update|delete|replace|drop|alter|truncate|create|grant|revoke)\b/i.test(s)) {
    throw new Error('WITH ist nur für lesende Abfragen erlaubt.')
  }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(s) ||
      /\bload_file\s*\(/i.test(s) ||
      /\bsleep\s*\(/i.test(s) ||
      /\bbenchmark\s*\(/i.test(s) ||
      /\bget_lock\s*\(/i.test(s) ||
      /\bfor\s+update\b/i.test(s) ||
      /\block\s+in\s+share\s+mode\b/i.test(s)) {
    throw new Error('Diese Abfrage ist aus Sicherheitsgründen gesperrt.')
  }
  return s
}

function mitLimit (sql) {
  if (!/^(select|with)\b/i.test(sql)) return sql
  if (/\blimit\s+\d+/i.test(sql)) return sql
  return `${sql} LIMIT ${MAX_ROWS}`
}

function wert (v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return v.toISOString()
  if (Buffer.isBuffer(v)) return v.toString('hex')
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch (_) { return String(v) }
  }
  return v
}

function verlauf () {
  try {
    const l = store.read().sqlHistory
    return Array.isArray(l) ? l : []
  } catch (_) {
    return []
  }
}

function merke (eintrag) {
  try {
    store.write({ sqlHistory: [eintrag, ...verlauf()].slice(0, VERLAUF_MAX) })
  } catch (_) {}
}

async function ausfuehren ({ dbKind = 'world', sql } = {}) {
  const art = ['auth', 'chars', 'world', 'bots'].includes(dbKind) ? dbKind : 'world'
  const abfrage = pruefe(sql)
  const gesendet = mitLimit(abfrage)
  const start = Date.now()
  let rows
  try {
    const pool = await db.pool(art)
    const [ergebnis] = await pool.query({ sql: gesendet, timeout: TIMEOUT_MS })
    rows = Array.isArray(ergebnis) ? ergebnis : []
  } catch (e) {
    merke({ zeit: new Date().toISOString(), dbKind: art, sql: abfrage, ok: false, fehler: e.message, dauerMs: Date.now() - start })
    throw e
  }
  const dauerMs = Date.now() - start
  const spalten = rows.length ? Object.keys(rows[0]) : []
  const daten = rows.slice(0, MAX_ROWS).map(r => {
    const out = {}
    for (const k of spalten) out[k] = wert(r[k])
    return out
  })
  merke({ zeit: new Date().toISOString(), dbKind: art, sql: abfrage, ok: true, anzahl: rows.length, dauerMs })
  return {
    ok: true,
    dbKind: art,
    query: gesendet,
    spalten,
    rows: daten,
    anzahl: rows.length,
    gekuerzt: rows.length >= MAX_ROWS,
    dauerMs
  }
}

function verlaufLeeren () {
  try { store.write({ sqlHistory: [] }) } catch (_) {}
  return { ok: true }
}

module.exports = {
  init,
  ausfuehren,
  verlauf,
  verlaufLeeren,
  // Fuer Pruefskripte: Validierung ohne Datenbank
  __intern: { pruefe, mitLimit }
}
