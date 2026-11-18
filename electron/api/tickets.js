'use strict'

/*
 * Support-Tickets aus der Character-Datenbank (Tabelle "gm_ticket").
 *
 * Die Tabelle gehoert dem Core. Das Panel liest sie nur und schreibt
 * ausschliesslich in die Spalten, die der Kern selbst benutzt:
 * assignedTo, comment, response, completed, closedBy, resolvedBy,
 * lastModifiedTime. Es werden keine Tickets angelegt oder geloescht -
 * das bleibt Sache des Spiels.
 */

const db = require('../db')
const schema = require('../db-schema')

const MAX_TEXT = 2000

function int (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function text (wert) {
  const s = String(wert == null ? '' : wert).trim()
  if (!s) throw new Error('Der Text ist leer.')
  return s.slice(0, MAX_TEXT)
}

/*
 * Spielernamen zur Ticket-GUID nachschlagen. Ein JOIN ueber zwei
 * Datenbanken waere hier nicht noetig und wuerde bei abweichenden
 * Datenbanknamen brechen.
 */
async function charaktere (guids) {
  const liste = [...new Set(guids.map(int).filter(Boolean))]
  if (!liste.length) return new Map()
  const rows = await db.query(
    'chars',
    `SELECT guid, name, account, level, online FROM characters WHERE guid IN (${liste.map(() => '?').join(',')})`,
    liste
  )
  return new Map(rows.map(r => [int(r.guid), r]))
}

async function liste ({ status = 'offen', suche = '' } = {}) {
  const bedingungen = []
  const params = []
  if (status === 'offen') bedingungen.push('t.completed = 0')
  if (status === 'geschlossen') bedingungen.push('t.completed = 1')
  const q = String(suche || '').trim()
  if (q) {
    bedingungen.push('(t.name LIKE ? OR t.description LIKE ? OR t.response LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like)
  }
  const where = bedingungen.length ? `WHERE ${bedingungen.join(' AND ')}` : ''
  const rows = await db.query(
    'chars',
    `SELECT t.id, t.type, t.playerGuid, t.name, t.description, t.createTime,
            t.mapId, t.posX, t.posY, t.posZ, t.lastModifiedTime,
            t.closedBy, t.assignedTo, t.comment, t.response,
            t.completed, t.escalated, t.viewed, t.needMoreHelp, t.resolvedBy
       FROM gm_ticket t
       ${where}
   ORDER BY t.completed ASC, t.lastModifiedTime DESC
      LIMIT 500`,
    params
  )
  const chars = await charaktere(rows.map(r => r.playerGuid).concat(rows.map(r => r.assignedTo)))
  const ergebnis = rows.map(r => {
    const c = chars.get(int(r.playerGuid))
    const gm = chars.get(int(r.assignedTo))
    return {
      id: int(r.id),
      type: int(r.type),
      playerGuid: int(r.playerGuid),
      name: r.name || (c && c.name) || '',
      description: r.description || '',
      createTime: r.createTime ? new Date(int(r.createTime) * 1000).toISOString() : null,
      lastModified: r.lastModifiedTime ? new Date(int(r.lastModifiedTime) * 1000).toISOString() : null,
      mapId: int(r.mapId),
      posX: Number(r.posX) || 0,
      posY: Number(r.posY) || 0,
      posZ: Number(r.posZ) || 0,
      assignedTo: int(r.assignedTo),
      assignedName: gm ? gm.name : null,
      comment: r.comment || '',
      response: r.response || '',
      completed: int(r.completed) === 1,
      escalated: int(r.escalated) === 1,
      viewed: int(r.viewed) === 1,
      needMoreHelp: int(r.needMoreHelp) === 1,
      character: c ? { guid: int(c.guid), name: c.name, account: int(c.account), level: int(c.level), online: int(c.online) === 1 } : null
    }
  })
  return {
    liste: ergebnis,
    offen: ergebnis.filter(x => !x.completed).length,
    gesamt: ergebnis.length
  }
}

/*
 * GM-Charaktere fuer die Zuweisung. Der Kern speichert in assignedTo eine
 * Charakter-GUID, keine Account-ID.
 */
async function gmCharaktere () {
  const ids = new Set()
  try {
    if (await schema.hat('auth', 'account', 'gmlevel')) {
      const rows = await db.query('auth', 'SELECT id FROM account WHERE gmlevel > 0')
      for (const r of rows) ids.add(int(r.id))
    }
  } catch (_) {}
  if (!ids.size) {
    try {
      const spalte = await schema.erster('auth', 'account_access', ['accountId', 'AccountID', 'account', 'id'])
      if (spalte) {
        const rows = await db.query('auth', `SELECT DISTINCT \`${spalte}\` AS id FROM account_access WHERE gmlevel > 0`)
        for (const r of rows) ids.add(int(r.id))
      }
    } catch (_) {}
  }
  if (!ids.size) return { liste: [] }
  const liste = [...ids]
  const rows = await db.query(
    'chars',
    `SELECT guid, name, account, level FROM characters
      WHERE account IN (${liste.map(() => '?').join(',')})
   ORDER BY name
      LIMIT 200`,
    liste
  )
  return { liste: rows.map(r => ({ guid: int(r.guid), name: r.name, account: int(r.account), level: int(r.level) })) }
}

async function ticket (id) {
  const rows = await db.query('chars', 'SELECT * FROM gm_ticket WHERE id = ?', [int(id)])
  if (!rows.length) throw new Error(`Ticket ${id} wurde nicht gefunden.`)
  return rows[0]
}

async function antworten ({ id, text: inhalt }) {
  await ticket(id)
  await db.execute(
    'chars',
    'UPDATE gm_ticket SET response = ?, viewed = 0, lastModifiedTime = UNIX_TIMESTAMP() WHERE id = ?',
    [text(inhalt), int(id)]
  )
  return { ok: true }
}

async function kommentar ({ id, text: inhalt }) {
  await ticket(id)
  await db.execute(
    'chars',
    'UPDATE gm_ticket SET comment = ?, lastModifiedTime = UNIX_TIMESTAMP() WHERE id = ?',
    [text(inhalt), int(id)]
  )
  return { ok: true }
}

async function zuweisen ({ id, guid }) {
  await ticket(id)
  const zielGuid = int(guid)
  const rows = await db.query('chars', 'SELECT guid FROM characters WHERE guid = ?', [zielGuid])
  if (!rows.length) throw new Error('Der gewählte Charakter wurde nicht gefunden.')
  await db.execute(
    'chars',
    'UPDATE gm_ticket SET assignedTo = ?, lastModifiedTime = UNIX_TIMESTAMP() WHERE id = ?',
    [zielGuid, int(id)]
  )
  return { ok: true }
}

/*
 * Abschliessen: closedBy/resolvedBy sind Account-IDs. Solange das Ticket
 * niemandem zugewiesen ist, bleibt 0 stehen - der Kern zeigt dann keinen
 * Bearbeiter, was ehrlicher ist als ein falscher Name.
 */
async function schliessen ({ id }) {
  const t = await ticket(id)
  let accountId = 0
  if (int(t.assignedTo)) {
    try {
      const rows = await db.query('chars', 'SELECT account FROM characters WHERE guid = ?', [int(t.assignedTo)])
      if (rows.length) accountId = int(rows[0].account)
    } catch (_) {}
  }
  await db.execute(
    'chars',
    `UPDATE gm_ticket
        SET completed = 1, closedBy = ?, resolvedBy = ?, lastModifiedTime = UNIX_TIMESTAMP()
      WHERE id = ?`,
    [accountId, accountId, int(id)]
  )
  return { ok: true }
}

async function oeffnen ({ id }) {
  await ticket(id)
  await db.execute(
    'chars',
    `UPDATE gm_ticket
        SET completed = 0, closedBy = 0, resolvedBy = 0, lastModifiedTime = UNIX_TIMESTAMP()
      WHERE id = ?`,
    [int(id)]
  )
  return { ok: true }
}

module.exports = { liste, gmCharaktere, antworten, kommentar, zuweisen, schliessen, oeffnen }
