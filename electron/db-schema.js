'use strict'

const db = require('./db')

/*
 * Ein Ort, an dem das Datenbankschema nachgelesen wird.
 *
 * Warum es das braucht: AzerothCore hat die Namen mehrerer Spalten und
 * Tabellen geaendert. Wer sie fest verdrahtet, bekommt bei jedem modernen
 * Core einen SQL-Fehler - und im Panel sieht das nach einer leeren Liste
 * aus, nicht nach einem Fehler:
 *
 *   gmlevel          frueher in "account", jetzt in "account_access"
 *   account_banned   "account"/"bantime"/"banby" entfallen,
 *                    dafuer "id" (= Account-ID) und "unbandate"
 *   ip_banned        "entry"/"id"/"active" entfallen, dafuer "ip" als Schluessel
 *   character_guild  heisst jetzt guild + guild_member (ueber "guildid")
 *
 * Statt das je Modul zu loesen, fragt man hier einmal nach und merkt sich
 * die Antwort. Der Schluessel enthaelt die Verbindungsdaten, damit ein
 * Wechsel der Datenbank automatisch neu gelesen wird.
 */

const cache = new Map()

// Bezeichner stammen aus unserem Code, nicht aus Eingaben. Trotzdem
// abgesichert: ein ungepruefter Name landet sonst im SQL.
function pruefe (name) {
  const s = String(name || '')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    throw new Error(`Ungueltiger Tabellenname: ${name}`)
  }
  return s
}

// Namen der Spalten einer Tabelle, klein geschrieben
async function spalten (kind, tabelle) {
  const t = pruefe(tabelle)
  const key = `${db.keyOf()}|${kind}|${t}`
  if (cache.has(key)) return cache.get(key)
  const rows = await db.query(kind, `SHOW COLUMNS FROM \`${t}\``)
  const set = new Set((rows || []).map(r => String(r.Field || r.field || '').toLowerCase()))
  cache.set(key, set)
  return set
}

/*
 * Ist mindestens einer dieser Spaltennamen vorhanden?
 *   await hat('auth', 'account', 'gmlevel')
 */
async function hat (kind, tabelle, ...namen) {
  const s = await spalten(kind, tabelle)
  return namen.some(n => s.has(String(n).toLowerCase()))
}

/*
 * Der erste Name aus der Liste, den es wirklich gibt.
 * Damit laesst sich eine Abfrage so bauen, dass sie auf beiden
 * Core-Generationen laeuft, ohne zwei Abfragen zu pflegen.
 */
async function erster (kind, tabelle, namen) {
  const s = await spalten(kind, tabelle)
  for (const n of namen) if (s.has(String(n).toLowerCase())) return n
  return null
}

async function tabelleFehlt (kind, tabelle) {
  try {
    await spalten(kind, tabelle)
    return false
  } catch (_) {
    return true
  }
}

// Vergleiche brauchen die Typen (z. B. binary(16) gegen binary(32))
async function typen (kind, tabelle) {
  const t = pruefe(tabelle)
  const key = `${db.keyOf()}|typ|${kind}|${t}`
  if (cache.has(key)) return cache.get(key)
  const rows = await db.query(kind, `SHOW COLUMNS FROM \`${t}\``)
  const map = {}
  for (const r of rows || []) map[String(r.Field || r.field || '').toLowerCase()] = String(r.Type || r.type || '')
  cache.set(key, map)
  return map
}

// Nach einem anderen Server auswerfen (z. B. wenn der Assistent etwas aendert)
function leeren () {
  cache.clear()
}

module.exports = { spalten, typen, hat, erster, tabelleFehlt, leeren }
