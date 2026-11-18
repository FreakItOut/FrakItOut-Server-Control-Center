'use strict'

/*
 * Gilden-Übersicht. Rein lesend: guild, guild_member, guild_rank und die
 * Charaktertabelle. Der Kern speichert die Gildenbank in guild.BankMoney
 * (Kupfer).
 */

const db = require('../db')
const schema = require('../db-schema')

function int (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function liste ({ suche = '' } = {}) {
  if (await schema.tabelleFehlt('chars', 'guild')) {
    return { verfuegbar: false, liste: [] }
  }
  const params = []
  let where = ''
  const q = String(suche || '').trim()
  if (q) {
    where = 'WHERE g.name LIKE ?'
    params.push(`%${q}%`)
  }
  const rows = await db.query(
    'chars',
    `SELECT g.guildid, g.name, g.createdate, g.BankMoney, g.motd, g.info, g.leaderguid,
            l.name AS leaderName,
            (SELECT COUNT(*) FROM guild_member m WHERE m.guildid = g.guildid) AS mitglieder,
            (SELECT ROUND(AVG(c.level), 1)
               FROM guild_member m JOIN characters c ON c.guid = m.guid
              WHERE m.guildid = g.guildid) AS schnitt
       FROM guild g
       LEFT JOIN characters l ON l.guid = g.leaderguid
       ${where}
   ORDER BY mitglieder DESC, g.name ASC`,
    params
  )
  return {
    verfuegbar: true,
    liste: rows.map(r => ({
      id: int(r.guildid),
      name: r.name || '',
      leaderGuid: int(r.leaderguid),
      leaderName: r.leaderName || null,
      mitglieder: int(r.mitglieder),
      schnitt: Number(r.schnitt) || 0,
      bankGold: int(r.BankMoney),
      erstellt: r.createdate ? new Date(int(r.createdate) * 1000).toISOString() : null,
      motd: r.motd || '',
      info: r.info || ''
    }))
  }
}

async function detail ({ id } = {}) {
  const gid = int(id)
  if (!gid) throw new Error('Keine Gilde angegeben.')
  const rows = await db.query(
    'chars',
    `SELECT g.guildid, g.name, g.createdate, g.BankMoney, g.motd, g.info, g.leaderguid,
            l.name AS leaderName
       FROM guild g
       LEFT JOIN characters l ON l.guid = g.leaderguid
      WHERE g.guildid = ?`,
    [gid]
  )
  if (!rows.length) throw new Error(`Gilde ${gid} wurde nicht gefunden.`)
  const g = rows[0]
  const zeitspalte = await schema.erster('chars', 'characters', ['logout_time', 'logintime'])
  const mitglieder = await db.query(
    'chars',
    `SELECT m.guid, m.rank, gr.rname AS rankName,
            c.name, c.level, c.race, c.class, c.online, c.totaltime,
            ${zeitspalte ? `c.\`${zeitspalte}\`` : 'NULL'} AS letzteZeit
       FROM guild_member m
       JOIN characters c ON c.guid = m.guid
       LEFT JOIN guild_rank gr ON gr.guildid = m.guildid AND gr.rid = m.rank
      WHERE m.guildid = ?
   ORDER BY c.level DESC, c.name ASC`,
    [gid]
  )
  return {
    gilde: {
      id: int(g.guildid),
      name: g.name || '',
      leaderGuid: int(g.leaderguid),
      leaderName: g.leaderName || null,
      bankGold: int(g.BankMoney),
      erstellt: g.createdate ? new Date(int(g.createdate) * 1000).toISOString() : null,
      motd: g.motd || '',
      info: g.info || ''
    },
    mitglieder: mitglieder.map(m => ({
      guid: int(m.guid),
      name: m.name,
      level: int(m.level),
      race: int(m.race),
      classId: int(m.class),
      rank: int(m.rank),
      rankName: m.rankName || null,
      online: int(m.online) === 1,
      totaltime: int(m.totaltime),
      zuletzt: m.letzteZeit ? new Date(int(m.letzteZeit) * 1000).toISOString() : null
    }))
  }
}

module.exports = { liste, detail }
