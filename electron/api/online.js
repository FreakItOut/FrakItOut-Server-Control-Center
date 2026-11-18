'use strict'

const db = require('../db')
const schema = require('../db-schema')

function int (v, fallback = 0) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/*
 * Das GM-Level stand frueher direkt in "account". Heute liegt es in
 * "account_access", dort je nach Fork mit "RealmID" oder "realm_id" und
 * einem Verweis auf den Account unter "account" oder "id".
 *
 * Ohne diese Anpassung scheitert die Abfrage mit "Unknown column
 * 'gmlevel'" - und die Seite zeigt eine leere Liste, obwohl Spieler
 * online sind.
 */
async function gmlevelAusdruck (authDb) {
  try {
    if (await schema.hat('auth', 'account', 'gmlevel')) {
      return `(SELECT gmlevel FROM \`${authDb}\`.account WHERE id = c.account)`
    }
    if (await schema.hat('auth', 'account_access', 'gmlevel')) {
      const ref = await schema.erster('auth', 'account_access', ['account', 'id'])
      if (!ref) return '0'
      // Je Realm ein Eintrag - der hoechste gilt.
      return `(SELECT MAX(gmlevel) FROM \`${authDb}\`.account_access WHERE \`${ref}\` = c.account)`
    }
  } catch (_) {}
  return '0'
}

/*
 * Wann war der Charakter zuletzt online?
 *
 * Die Spalte hiess frueher "logintime"; moderne Cores fuehren sie nicht
 * mehr. Dort gibt es "logout_time" und in der Auth-Datenbank
 * "account.last_login". Fuer einen gerade angemeldeten Charakter liefert
 * keine davon etwas Brauchbares - dann bleibt die Spalte leer, statt einen
 * erfundenen Wert anzuzeigen.
 */
async function loginzeitAusdruck () {
  const spalte = await schema.erster('chars', 'characters', ['logintime', 'logout_time'])
  return spalte ? `c.\`${spalte}\`` : 'NULL'
}

// GM-Befehle laufen entweder per SOAP (wenn in worldserver.conf aktiviert)
// oder direkt in die Console des Worldserver-Prozesses geschrieben.
let serverManagerRef = null
function setServerManager (sm) {
  serverManagerRef = sm
}

async function listOnline ({ includeBots = true } = {}) {
  // "account" liegt in der Auth-Datenbank, "characters" in der
  // Character-Datenbank. Ohne vollstaendigen Namen findet MySQL die Tabelle
  // nicht, auch wenn beide im selben Server stehen.
  const authDb = db.nameOf('auth')
  const gmlevel = await gmlevelAusdruck(authDb)
  const loginzeit = await loginzeitAusdruck()
  // Bot-Ausschluss ueber die zentrale Praefix-Liste (Wartungs-Einstellung)
  const botFilter = require('./spieler').botFilterSql('a')
  const rows = await db.query('chars', `
    SELECT c.guid, c.account, c.name, c.race, c.class AS classId, c.level,
           c.map, c.zone, c.totaltime,
           a.username,
           ${gmlevel} AS gmlevel,
           ${loginzeit} AS logintime
    FROM characters c
    LEFT JOIN \`${authDb}\`.account a ON a.id = c.account
    WHERE c.online = 1
    ${includeBots ? '' : `AND ${botFilter}`}
    ORDER BY c.level DESC
  `)
  return {
    includeBots,
    rows: rows.map(r => ({
      guid: int(r.guid),
      account: int(r.account),
      username: r.username || null,
      name: r.name,
      race: int(r.race),
      classId: int(r.classId),
      level: int(r.level),
      map: int(r.map),
      zone: int(r.zone),
      gmlevel: int(r.gmlevel),
      logintime: r.logintime ? new Date(r.logintime * 1000).toISOString() : null,
      totaltime: int(r.totaltime),
      bot: /^RNDBOT/i.test(r.username || '')
    }))
  }
}

async function dashboard () {
  const counts = {}
  try {
    const ch = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters')
    counts.characters = int(ch[0].n)
  } catch (_) {
    counts.characters = 0
  }
  /*
   * Online-Zähler: einmal mit, einmal ohne Bots. Die Übersicht zeigt die
   * echte Zahl (mit Bots), damit die Warnung "Worldserver läuft nicht"
   * richtig einordnet; der Online-Zähler-Kontext in der Statistik kann
   * beide brauchen.
   */
  try {
    const on = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters WHERE online = 1')
    counts.online = int(on[0].n)
  } catch (_) {
    counts.online = 0
  }
  try {
    const botFilter = require('./spieler').botFilterSql('a')
    const onEchte = await db.query('chars', `
      SELECT COUNT(*) AS n FROM characters c
      LEFT JOIN \`${db.nameOf('auth')}\`.account a ON a.id = c.account
      WHERE c.online = 1 AND ${botFilter}
    `)
    counts.onlineEchte = int(onEchte[0].n)
  } catch (_) {
    counts.onlineEchte = null
  }
  try {
    const ac = await db.query('auth', 'SELECT COUNT(*) AS n FROM account')
    counts.accounts = int(ac[0].n)
  } catch (_) {
    counts.accounts = 0
  }
  try {
    const rl = await db.query('auth', 'SELECT COUNT(*) AS n FROM realmlist')
    counts.realms = int(rl[0].n)
  } catch (_) {
    counts.realms = 0
  }
  /*
   * Wartungsmodus: realmlist OFFLINE-Bit (2). Wer ihn vergisst, wundert
   * sich über "niemand kann sich einloggen" - die Übersicht warnt deshalb.
   */
  try {
    const liste = await require('./realms').listRealms()
    counts.realmWartung = Array.isArray(liste) && liste.some(r => (Number(r.realmflags) & 2) === 2)
  } catch (_) {
    counts.realmWartung = false
  }

  /*
   * Wie viel ist im Panel eingestellt?
   *
   * Ohne diese Angabe sieht man auf der Uebersicht nur "1500 online" -
   * und nicht, dass alle 96 Raten auf Standard stehen und von 76 Modulen
   * nur 38 laufen. Das sind die Zahlen, die man am ehesten braucht,
   * wenn man den Server ueberblickt.
   */
  try {
    const rates = require('./rates').get()
    const r = await rates
    counts.ratenGesamt = (r.entries || []).length
    counts.ratenGeaendert = (r.veraenderung || {}).abweichend || 0
  } catch (_) {
    counts.ratenGesamt = 0
    counts.ratenGeaendert = 0
  }
  try {
    const moduleApi = require('./module')
    const liste = moduleApi.list()
    counts.moduleGesamt = liste.module.length
    counts.moduleAktiv = liste.module.filter(m => m.status === 'aktiv').length
    counts.moduleAus = liste.module.filter(m => m.status === 'aus').length
  } catch (_) {
    counts.moduleGesamt = 0
    counts.moduleAktiv = 0
    counts.moduleAus = 0
  }

  return counts
}

module.exports = { listOnline, dashboard, setServerManager }