'use strict'

/*
 * Beweist den GM-Level-Fehler über die echte API des Panels.
 *
 * Aufruf: node scripts/verify-gmlevel-api.js
 * (Datenbank muss laufen.)
 *
 * Was hier passiert ist
 * ---------------------
 * Ein Konto über accounts.createAccount() anlegen, mit GM-Level 3.
 * Danach mit derselben Abfrage nachsehen, mit der AzerothCore den Level
 * beim Einloggen liest (WorldSocket.cpp, struct AccountInfo):
 *
 *   LEFT JOIN account_access aa ON a.id = aa.AccountID
 *                            AND aa.RealmID IN (-1, ?)
 *
 * Der Fehler war: das Panel schrieb RealmID = 0. 0 ist weder -1 noch die
 * ID des Reiches (hier 1), also fand der Join nichts, aa.gmlevel war
 * NULL, und der Account stieg als normaler Spieler ein.
 *
 * Auch die Anzeige wird geprüft: listAccounts() darf keinen GM-Level
 * zeigen, den das Konto ingame nicht hat.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')
const mysql = require('mysql2/promise')

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) { gut++; console.log('  OK   ' + label) } else { schlecht++; console.log('  FAIL ' + label) }
}

// Einen eigenen Zwischenspeicher fern der echten config.json, damit dieser
// Test nicht die Einstellungen des Nutzers anfasst.
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'gmtest-'))
const speicher = {
  daten: {
    mysql: {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'test',
      authDb: 'acore_auth',
      charDb: 'acore_characters',
      worldDb: 'acore_world'
    }
  },
  read: function () { return this.daten },
  write: function (p) { Object.assign(this.daten, p) },
  pfad: () => path.join(ordner, 'config.json')
}

const db = require('../electron/db')
db.init(speicher)

const accounts = require('../electron/api/accounts')

// Die Abfrage des Kerns
const LOGIN_ABFRAGE = `
  SELECT a.id, aa.gmlevel
  FROM account a
  LEFT JOIN account_access aa ON a.id = aa.id AND aa.RealmID IN (-1, ?)
  WHERE a.username = ?
  ORDER BY aa.RealmID DESC
  LIMIT 1`

async function main () {
  const roh = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: 'test', database: 'acore_auth'
  })

  const [realms] = await roh.query('SELECT id FROM realmlist ORDER BY id')
  const realmId = realms[0].id
  console.log(`=== System ===`)
  console.log(`  Reich laut realmlist: id=${realmId}`)
  console.log(`  Core liest: gmlevel WHERE RealmID IN (-1, ${realmId})`)

  const kennung = 'apipruef' + Math.floor(Math.random() * 100000)
  const passwort = 'test1234'
  let accountId = null

  try {
    /* --------- das Konto genau so anlegen, wie das Panel es tut --------- */
    console.log('')
    console.log('=== Konto ueber accounts.createAccount() anlegen ===')
    console.log(`  Benutzername ${kennung}, GM-Level 3`)
    const ergebnis = await accounts.createAccount({
      username: kennung,
      password: passwort,
      gmlevel: 3
    })
    accountId = ergebnis.id
    console.log(`  angelegt mit id=${accountId}`)

    /* --------- was steht in der Datenbank? --------- */
    console.log('')
    console.log('=== Was steht in account_access? ===')
    const [zeilen] = await roh.query(
      'SELECT gmlevel, RealmID, comment FROM account_access WHERE id = ?', [accountId])
    if (!zeilen.length) {
      pruefe(false, 'es wurde ein Eintrag in account_access geschrieben')
    } else {
      const z = zeilen[0]
      console.log(`  gmlevel=${z.gmlevel}  RealmID=${z.RealmID}  comment="${z.comment}"`)
      pruefe(z.gmlevel === 3, 'gmlevel steht als 3 in der Zeile')
      pruefe(z.RealmID === -1 || z.RealmID === realmId,
        `RealmID ist ${z.RealmID} - der Kern fragt nur -1 und ${realmId} ab`)
    }

    /* --------- was liest der Kern beim Einloggen? --------- */
    console.log('')
    console.log('=== Was liest AzerothCore beim Einloggen? ===')
    const [login] = await roh.query(LOGIN_ABFRAGE, [realmId, kennung])
    const fueLogin = login[0]
    const gmlevel = fueLogin && fueLogin.gmlevel !== null ? fueLogin.gmlevel : null
    console.log(`  Core-Abfrage liefert: ${gmlevel === null ? 'NULL (kein GM-Level)' : gmlevel}`)
    pruefe(gmlevel === 3,
      'der Kern findet gmlevel 3 - der Account ist ingame wirklich GM')

    /* --------- was zeigt das Panel an? --------- */
    console.log('')
    console.log('=== Was zeigt das Panel in der Liste? ===')
    const liste = await accounts.listAccounts({ search: kennung })
    const zeile = liste.filter(a => a.username === kennung)[0]
    if (!zeile) {
      pruefe(false, 'das neue Konto erscheint in der Liste')
    } else {
      console.log(`  Liste zeigt: gmlevel=${zeile.gmlevel}`)
      pruefe(zeile.gmlevel === 3,
        'die Liste zeigt GM3 - und ingame stimmt es auch')
    }

    /* --------- Level nachtraeglich aendern (Reparatur-Weg) --------- */
    console.log('')
    console.log('=== Level nachtraeglich aendern: 2 statt 3 ===')
    await accounts.setGmLevel({ accountId, gmlevel: 2 })
    const [login2] = await roh.query(LOGIN_ABFRAGE, [realmId, kennung])
    const gm2 = login2[0] && login2[0].gmlevel
    console.log(`  Core-Abfrage liefert: ${gm2 === null || gm2 === undefined ? 'NULL' : gm2}`)
    pruefe(gm2 === 2, 'auch die Aenderung kommt beim Kern an')

    const liste2 = await accounts.listAccounts({ search: kennung })
    const zeile2 = liste2.filter(a => a.username === kennung)[0]
    pruefe(zeile2 && zeile2.gmlevel === 2, 'die Liste zeigt GM2')

    /* --------- Level auf 0 zurueck --------- */
    console.log('')
    console.log('=== Level auf 0 setzen (wieder normaler Spieler) ===')
    await accounts.setGmLevel({ accountId, gmlevel: 0 })
    const [login3] = await roh.query(LOGIN_ABFRAGE, [realmId, kennung])
    const gm3 = login3[0] && login3[0].gmlevel
    console.log(`  Core-Abfrage liefert: ${gm3 === null || gm3 === undefined ? 'NULL' : gm3}`)
    pruefe(!(gm3 > 0), 'der Kern liest keinen GM-Level mehr')
  } finally {
    /* --------- Aufraeumen --------- */
    if (accountId !== null) {
      console.log('')
      console.log('=== Aufraeumen ===')
      await roh.query('DELETE FROM account_access WHERE id = ?', [accountId])
      await roh.query('DELETE FROM account WHERE id = ?', [accountId])
      const [rest] = await roh.query('SELECT id FROM account WHERE id = ?', [accountId])
      pruefe(rest.length === 0, `Pruefkonto id=${accountId} wieder entfernt`)
      const [restZ] = await roh.query('SELECT id FROM account_access WHERE id = ?', [accountId])
      pruefe(restZ.length === 0, 'account_access-Eintrag wieder entfernt')
    }
    await roh.end()
    fs.rmSync(ordner, { recursive: true, force: true })
  }

  console.log('')
  console.log(schlecht
    ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
    : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
  process.exit(schlecht ? 1 : 0)
}

main().catch(e => {
  console.error('FEHLER: ' + e.message)
  process.exit(1)
})
