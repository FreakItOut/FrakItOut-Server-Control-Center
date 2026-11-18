'use strict'

const db = require('../db')
const schema = require('../db-schema')

function int (v, fallback = 0) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/*
 * Bans - und hier hat sich nicht nur ein Name geaendert, sondern die ganze
 * Bedeutung:
 *
 *   frueher:  account_banned(account, bannedate, bantime, banby, banreason, active)
 *             ip_banned(id, entry, bannedate, bantime, bandby, active)
 *             -> bantime war eine Dauer in Sekunden
 *
 *   heute:    account_banned(id, bandate, unbandate, bannedby, banreason, active)
 *             ip_banned(ip, bandate, unbandate, bannedby, banreason)
 *             -> "id" IST die Account-ID, und "unbandate" ist ein Zeitpunkt,
 *                keine Dauer. 0 heisst "unbefristet".
 *
 * Die Oberflaeche kennt nach wie vor "bantime" als Restdauer in Sekunden -
 * das wird hier aus dem Zeitpunkt berechnet.
 */

const jetzt = () => Math.floor(Date.now() / 1000)

// Restdauer aus einem unbandate-Zeitpunkt; 0 = unbefristet
function restdauer (unbandate) {
  const u = int(unbandate, 0)
  if (u <= 0) return 0
  return Math.max(0, u - jetzt())
}

// Eine IP-Sperre gilt, solange kein Ablaufdatum in der Vergangenheit liegt.
// In der alten Fassung stand das in der Spalte "active".
function istAktiv (unbandate) {
  const u = int(unbandate, 0)
  return u <= 0 || u > jetzt()
}

async function accountBans () {
  const alt = await schema.hat('auth', 'account_banned', 'account')
  if (alt) {
    const rows = await db.query('auth', `
      SELECT b.id, b.account, b.bannedate, b.bantime, b.banby, b.banreason,
             b.active, a.username
      FROM account_banned b
      LEFT JOIN account a ON a.id = b.account
      ORDER BY b.bannedate DESC
    `)
    return rows.map(r => ({
      id: int(r.id),
      account: int(r.account),
      username: r.username || null,
      bannedate: r.bannedate ? new Date(int(r.bannedate) * 1000).toISOString() : null,
      bantime: int(r.bantime),
      banby: r.banby || '',
      banreason: r.banreason || '',
      active: int(r.active) === 1
    }))
  }

  // Neu: "id" ist die Account-ID
  const rows = await db.query('auth', `
    SELECT b.id AS account, b.bandate, b.unbandate, b.bannedby, b.banreason,
           b.active, a.username
    FROM account_banned b
    LEFT JOIN account a ON a.id = b.id
    ORDER BY b.bandate DESC
  `)
  return rows.map(r => ({
    id: int(r.account),
    account: int(r.account),
    username: r.username || null,
    bannedate: r.bandate ? new Date(int(r.bandate) * 1000).toISOString() : null,
    bantime: restdauer(r.unbandate),
    banby: r.bannedby || '',
    banreason: r.banreason || '',
    active: int(r.active) === 1
  }))
}

async function ipBans () {
  const alt = await schema.hat('auth', 'ip_banned', 'entry')
  if (alt) {
    const rows = await db.query('auth', `
      SELECT id, entry, bannedate, bantime, bandby, banreason, active
      FROM ip_banned ORDER BY bannedate DESC
    `)
    return rows.map(r => ({
      id: int(r.id),
      entry: r.entry,
      bannedate: r.bannedate ? new Date(int(r.bannedate) * 1000).toISOString() : null,
      bantime: int(r.bantime),
      banby: r.bandby || '',
      banreason: r.banreason || '',
      active: int(r.active) === 1
    }))
  }

  // Neu: die IP selbst ist der Schluessel, "active" gibt es nicht mehr
  const rows = await db.query('auth', `
    SELECT ip, bandate, unbandate, bannedby, banreason
    FROM ip_banned ORDER BY bandate DESC
  `)
  return rows.map(r => ({
    id: r.ip,
    entry: r.ip,
    bannedate: r.bandate ? new Date(int(r.bandate) * 1000).toISOString() : null,
    bantime: restdauer(r.unbandate),
    banby: r.bannedby || '',
    banreason: r.banreason || '',
    active: istAktiv(r.unbandate)
  }))
}

async function listBans () {
  return { accounts: await accountBans(), ips: await ipBans() }
}

/*
 * Seitenweise Liste fuer die Bans-Seite. Suche und "nur aktive" werden
 * hier angewendet; die Datenmengen sind ueberschaubar (Sperren, keine
 * Charaktere), deshalb bleibt die Schema-Toleranz der bestehenden
 * accountBans()/ipBans()-Abfragen erhalten.
 */
async function listBansPage ({ bereich = 'accounts', search = '', aktiv = '1', limit = 100, offset = 0 } = {}) {
  const alle = bereich === 'ips' ? await ipBans() : await accountBans()
  const s = String(search || '').trim().toLowerCase()
  const nurAktiv = String(aktiv) !== 'all' && aktiv !== false
  let gefiltert = alle.filter(b => {
    if (nurAktiv && !b.active) return false
    if (!s) return true
    return [b.username, b.account, b.entry, b.banreason, b.banby, b.id]
      .some(v => String(v == null ? '' : v).toLowerCase().includes(s))
  })
  const total = gefiltert.length
  const grenze = Math.max(1, Math.min(500, Number(limit) || 100))
  const start = Math.max(0, Number(offset) || 0)
  gefiltert = gefiltert.slice(start, start + grenze)
  return { rows: gefiltert, total }
}

/*
 * Aufheben loescht in der neuen Fassung die Zeile (das entspricht dem
 * Verhalten des Servers); in der alten wird "active" auf 0 gesetzt.
 */
async function unbanAccount (accountId) {
  if (await schema.hat('auth', 'account_banned', 'account')) {
    await db.execute('auth', 'UPDATE account_banned SET active = 0 WHERE account = ?', [int(accountId)])
  } else {
    await db.execute('auth', 'DELETE FROM account_banned WHERE id = ?', [int(accountId)])
  }
  return { ok: true }
}

async function unbanIp (id) {
  // In der neuen Fassung ist die IP selbst der Schluessel, in der alten eine
  // Zahl. Das Schema entscheidet, was uebergeben werden muss - geraten werden
  // darf hier nicht, sonst loescht man die falsche Zeile.
  const schluessel = await schema.erster('auth', 'ip_banned', ['id', 'ip', 'entry'])
  if (!schluessel) throw new Error('Die Tabelle ip_banned hat keine erkennbare Schlüsselspalte.')
  const wert = schluessel === 'id' ? int(id) : String(id)
  await db.execute('auth', `DELETE FROM ip_banned WHERE \`${schluessel}\` = ?`, [wert])
  return { ok: true }
}

async function banAccount ({ account, bantime = 0, banby = 'Panel', banreason = 'Gebannt ueber Panel' }) {
  if (await schema.hat('auth', 'account_banned', 'account')) {
    const res = await db.execute(
      'auth',
      `INSERT INTO account_banned (account, bannedate, bantime, banby, banreason, active)
       VALUES (?, UNIX_TIMESTAMP(), ?, ?, ?, 1)`,
      [int(account), int(bantime), banby, banreason]
    )
    return { ok: true, id: res.insertId }
  }
  const res = await db.execute(
    'auth',
    `INSERT INTO account_banned (id, bandate, unbandate, bannedby, banreason, active)
     VALUES (?, UNIX_TIMESTAMP(), ?, ?, ?, 1)`,
    [int(account), int(bantime) > 0 ? jetzt() + int(bantime) : 0, banby, banreason]
  )
  return { ok: true, id: int(account) }
}

async function banIp ({ entry, bantime = 0, banby = 'Panel', banreason = 'Gebannt ueber Panel' }) {
  if (await schema.hat('auth', 'ip_banned', 'entry')) {
    const res = await db.execute(
      'auth',
      `INSERT INTO ip_banned (entry, bannedate, bantime, bandby, banreason, active)
       VALUES (?, UNIX_TIMESTAMP(), ?, ?, ?, 1)`,
      [entry, int(bantime), banby, banreason]
    )
    return { ok: true, id: res.insertId }
  }
  await db.execute(
    'auth',
    `INSERT INTO ip_banned (ip, bandate, unbandate, bannedby, banreason)
     VALUES (?, UNIX_TIMESTAMP(), ?, ?, ?)`,
    [entry, int(bantime) > 0 ? jetzt() + int(bantime) : 0, banby, banreason]
  )
  return { ok: true, id: entry }
}

/*
 * Abgelaufene Bans entfernen: Einträge, deren unbandate (bzw. bannedate +
 * bantime in der alten Fassung) in der Vergangenheit liegt. Die UI zeigt
 * sie ohnehin nur als "nicht aktiv" - hier wird die Tabelle sauber.
 * Schema-tolerant: nicht passende DELETE-Formen scheitern still.
 */
async function zaehleAbgelaufene () {
  const jetzt = Math.floor(Date.now() / 1000)
  const abfragen = [
    'SELECT COUNT(*) AS c FROM account_banned WHERE unbandate > 0 AND unbandate < ?',
    'SELECT COUNT(*) AS c FROM account_banned WHERE bantime > 0 AND bannedate + bantime < ?',
    'SELECT COUNT(*) AS c FROM ip_banned WHERE unbandate > 0 AND unbandate < ?',
    'SELECT COUNT(*) AS c FROM ip_banned WHERE bantime > 0 AND bannedate + bantime < ?'
  ]
  let anzahl = 0
  for (const sql of abfragen) {
    try {
      const rows = await db.query('auth', sql, [jetzt])
      anzahl += Number(rows && rows[0] ? rows[0].c : 0) || 0
    } catch (_) {}
  }
  return anzahl
}

async function aufraeumen ({ nurMelden = false } = {}) {
  const jetzt = Math.floor(Date.now() / 1000)
  if (nurMelden) {
    const betroffen = await zaehleAbgelaufene()
    return { ok: true, entfernt: 0, betroffen, nurGemeldet: true }
  }
  const versuche = [
    'DELETE FROM account_banned WHERE unbandate > 0 AND unbandate < ?',
    'DELETE FROM account_banned WHERE bantime > 0 AND bannedate + bantime < ?',
    'DELETE FROM ip_banned WHERE unbandate > 0 AND unbandate < ?',
    'DELETE FROM ip_banned WHERE bantime > 0 AND bannedate + bantime < ?'
  ]
  let entfernt = 0
  for (const sql of versuche) {
    try {
      const r = await db.execute('auth', sql, [jetzt])
      entfernt += Number(r && r.affectedRows ? r.affectedRows : 0) || 0
    } catch (_) {}
  }
  return { ok: true, entfernt }
}

module.exports = { listBans, listBansPage, unbanAccount, unbanIp, banAccount, banIp, aufraeumen, zaehleAbgelaufene }
