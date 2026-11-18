'use strict'

/*
 * Zentrale Spieler-Zählung: Wie viele ECHTE Spieler sind online?
 *
 * Wichtig: Bot-Charaktere (mod-playerbots) sind während ihrer Laufzeit
 * ebenfalls characters-Zeilen mit online = 1 - ohne Ausnahme würde der
 * "nur bei leerem Server"-Schutz der Nachts-Wartung auf einem Server mit
 * Bots NIE zuschlagen. Bots werden deshalb über ihre Konto-Namen
 * ausgeschlossen: Bot-Konten tragen in der Praxis Präfixe (mod-playerbots
 * Standard "rndbot" bzw. "RNDBOT1", Auctionhouse-Bot "ahbot", Panel-Bot-
 * zählt ebenfalls nicht als Spieler.
 *
 * Konfiguration: maintenance.botKontoPraefixe (Kommazeile) + soap.user.
 * Standard-Präfixe: mod-playerbots erzeugt Konten wie "RNDBOT1" (rndbot),
 * der Auctionhouse-Bot heißt "ahbot", das Panel-Bot-Konto "playerbots".
 */

let store = null

function init (storeRef) {
  store = storeRef
}

const STANDARD_PRAEFIXE = 'rndbot, ahbot, playerbots'

function botPraefixe () {
  try {
    const w = String((store.read().maintenance || {}).botKontoPraefixe || STANDARD_PRAEFIXE)
    return w.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  } catch (_) {
    return ['rndbot', 'ahbot', 'playerbots']
  }
}

/*
 * JS-seitige Bot-Erkennung für Listen (Charakterliste): dieselben Präfixe
 * wie botFilterSql in SQL - eine Quelle für beide Welten.
 */
function istBotName (name) {
  const n = String(name || '').toLowerCase()
  if (!n) return false
  let soapUser = 'soap'
  try {
    soapUser = String((store.read().soap || {}).user || 'SOAP').toLowerCase()
  } catch (_) {}
  if (n === soapUser) return true
  return botPraefixe().some(p => n.startsWith(p))
}

async function zaehleEchteSpieler () {
  try {
    const cfg = store.read()
    const m = cfg.mysql || {}
    const authDb = String(m.authDb || 'acore_auth').replace(/`/g, '')
    const soapUser = String((cfg.soap || {}).user || 'SOAP').replace(/'/g, "''")

    const ausnahmen = ["LOWER(acc.username) = '" + soapUser.toLowerCase() + "'"]
    for (const p of botPraefixe()) {
      ausnahmen.push("LOWER(acc.username) LIKE '" + p.replace(/'/g, "''") + "%'")
    }

    const sql =
      'SELECT COUNT(*) AS c FROM characters ch ' +
      `JOIN \`${authDb}\`.\`account\` acc ON acc.id = ch.account ` +
      `WHERE ch.online = 1 AND NOT (${ausnahmen.join(' OR ')})`

    const db = require('../db')
    const rows = await db.execute('chars', sql)
    return Array.isArray(rows) && rows.length ? Number(rows[0].c) : 0
  } catch (_) {
    // DB nicht erreichbar etc.: als "leer" gelten lassen - die Wartung
    // scheitert dann ohnehin am Update, nicht an der Zählung.
    return 0
  }
}

/*
 * SQL-Fragment zum Ausschluss von Bot-Konten (JOIN vorausgesetzt: acc =
 * Alias auf auth.account). Auf der Online-Seite und in der Charakterliste
 * nutzen, damit überall dieselben Präfixe gelten.
 */
function botFilterSql (alias) {
  const a = alias || 'acc'
  const soapUser = String((store.read().soap || {}).user || 'SOAP').replace(/'/g, "''")
  const teile = [`LOWER(${a}.username) = '${soapUser.toLowerCase()}'`]
  for (const p of botPraefixe()) {
    teile.push(`LOWER(${a}.username) LIKE '${p.replace(/'/g, "''")}%'`)
  }
  return `NOT (${teile.join(' OR ')})`
}

module.exports = { init, zaehleEchteSpieler, botPraefixe, istBotName, botFilterSql }
