'use strict'

/*
 * Wirtschaftsübersicht: Gold, Auktionen und Post. Alles rein lesend.
 * Geldbeträge stehen in der Datenbank in Kupfer.
 */

const db = require('../db')
const schema = require('../db-schema')

function int (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function uebersicht () {
  const ergebnis = {
    ok: true,
    stand: new Date().toISOString(),
    charaktere: null,
    gold: null,
    top: [],
    stufen: [],
    auktionen: null,
    post: null
  }

  try {
    const rows = await db.query(
      'chars',
      'SELECT COUNT(*) AS n, SUM(money) AS summe, MAX(money) AS max FROM characters'
    )
    const r = rows[0] || {}
    ergebnis.charaktere = int(r.n)
    ergebnis.gold = { summe: int(r.summe), max: int(r.max) }
  } catch (_) {}

  try {
    const rows = await db.query(
      'chars',
      `SELECT guid, name, level, money, online, account
         FROM characters
     ORDER BY money DESC
        LIMIT 20`
    )
    ergebnis.top = rows.map(r => ({
      guid: int(r.guid),
      name: r.name,
      level: int(r.level),
      money: int(r.money),
      online: int(r.online) === 1,
      account: int(r.account)
    }))
  } catch (_) {}

  /*
   * Verteilung nach Stufenbereichen - zeigt, ob Gold nur bei 80ern liegt
   * oder auch im Levelgeschäft steckt.
   */
  try {
    const rows = await db.query(
      'chars',
      `SELECT CASE
                WHEN level < 20 THEN '1-19'
                WHEN level < 40 THEN '20-39'
                WHEN level < 60 THEN '40-59'
                WHEN level < 80 THEN '60-79'
                ELSE '80'
              END AS bereich,
              COUNT(*) AS n,
              SUM(money) AS summe
         FROM characters
     GROUP BY bereich`
    )
    const reihenfolge = ['1-19', '20-39', '40-59', '60-79', '80']
    ergebnis.stufen = reihenfolge
      .map(key => {
        const r = rows.find(x => x.bereich === key)
        return { bereich: key, charaktere: int(r && r.n), gold: int(r && r.summe) }
      })
      .filter(x => x.charaktere > 0)
  } catch (_) {}

  if (!(await schema.tabelleFehlt('chars', 'auctionhouse'))) {
    try {
      const rows = await db.query(
        'chars',
        `SELECT COUNT(*) AS n,
                SUM(startbid) AS start,
                SUM(buyoutprice) AS sofort,
                SUM(deposit) AS kaution,
                SUM(CASE WHEN buyguid > 0 THEN 1 ELSE 0 END) AS verkauft
           FROM auctionhouse`
      )
      const r = rows[0] || {}
      ergebnis.auktionen = {
        anzahl: int(r.n),
        startsumme: int(r.start),
        sofortsumme: int(r.sofort),
        kaution: int(r.kaution),
        verkauft: int(r.verkauft)
      }
    } catch (_) {}
  }

  if (!(await schema.tabelleFehlt('chars', 'mail'))) {
    try {
      const rows = await db.query(
        'chars',
        `SELECT COUNT(*) AS n, SUM(money) AS geld, SUM(cod) AS nachnahme,
                SUM(CASE WHEN has_items > 0 THEN 1 ELSE 0 END) AS mitItems
           FROM mail`
      )
      const r = rows[0] || {}
      ergebnis.post = {
        anzahl: int(r.n),
        geld: int(r.geld),
        nachnahme: int(r.nachnahme),
        mitItems: int(r.mitItems)
      }
    } catch (_) {}
  }

  /*
   * Anteil des reichsten Charakters am Gesamtgold. Ein einzelner Charakter
   * mit mehr als 10 Prozent ist auf einem normalen Server ein Warnsignal
   * (Duping, GM-Geschenk oder Auktionshaus-Bot).
   */
  ergebnis.anteilTop = ergebnis.gold && ergebnis.gold.summe > 0 && ergebnis.top.length
    ? Math.round((ergebnis.top[0].money / ergebnis.gold.summe) * 1000) / 10
    : 0
  return ergebnis
}

module.exports = { uebersicht }
