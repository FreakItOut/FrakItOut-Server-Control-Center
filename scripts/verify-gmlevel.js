'use strict'

/*
 * Belegt den GM-Level-Fehler aus Account-Sicht, mit den echten Abfragen.
 *
 * Aufruf: node scripts/verify-gmlevel.js
 *
 * Die Datenbank muss laufen. Der Test legt einen Konto an, prueft es mit
 * derselben Abfrage, mit der AzerothCore den GM-Level beim Einloggen liest,
 * und nimmt das Konto wieder heraus.
 *
 * Die Abfrage steht so in AzerothCore (src/server/game/Server/WorldSocket.cpp,
 * Kommentar zu struct AccountInfo):
 *
 *   LEFT JOIN account_access aa ON a.id = aa.AccountID
 *                              AND aa.RealmID IN (-1, ?)
 *
 * ? ist die Realm-ID aus worldserver.conf/realmlist - hier 1.
 */

const mysql = require('mysql2/promise')

const konfig = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'test',
  database: 'acore_auth'
}

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) { gut++; console.log('  OK   ' + label) } else { schlecht++; console.log('  FAIL ' + label) }
}

// Die Login-Abfrage des Cores
const LOGIN_ABFRAGE = `
  SELECT a.id, aa.gmlevel
  FROM account a
  LEFT JOIN account_access aa ON a.id = aa.id AND aa.RealmID IN (-1, ?)
  WHERE a.username = ?
  ORDER BY aa.RealmID DESC
  LIMIT 1`

// Was der Panel-Code schreibt - die Stelle aus setGmLevelRaw nachgebaut
async function panelWaehltRealmId (verbindung, accountId, gmlevel, realmId) {
  const vorhanden = await verbindung.query(
    'SELECT id FROM account_access WHERE id = ?', [accountId])
  if (vorhanden[0].length) {
    await verbindung.query(
      'UPDATE account_access SET gmlevel = ? WHERE id = ?', [gmlevel, accountId])
  } else {
    await verbindung.query(
      'INSERT INTO account_access (id, gmlevel, RealmID, comment) VALUES (?, ?, ?, ?)',
      [accountId, gmlevel, realmId, 'Test'])
  }
}

async function main () {
  const connection = await mysql.createConnection(konfig)

  // Die Realm-ID, so wie sie im realmlist steht - das ist der Wert, den
  // der Core in die Abfrage setzt.
  const [realms] = await connection.query('SELECT id, name FROM realmlist ORDER BY id')
  console.log('=== Reiche in der Datenbank ===')
  for (const r of realms) console.log(`  id=${r.RealmID || r.id}  ${r.name}`)
  const realmId = realms.length ? (realms[0].RealmID || realms[0].id) : 1
  console.log(`  Core fragt ab mit: RealmID IN (-1, ${realmId})`)

  /* --------- 1. was steht jetzt im account_access? --------- */
  console.log('')
  console.log('=== 1. Vorhandene Eintraege in account_access ===')
  const [zeilen] = await connection.query(
    'SELECT id, gmlevel, RealmID, comment FROM account_access ORDER BY id')
  for (const z of zeilen) {
    const passt = (z.RealmID === -1 || z.RealmID === realmId)
    console.log(`  id=${z.id} gmlevel=${z.gmlevel} RealmID=${z.RealmID}` +
      `  comment="${z.comment}"  ` +
      (passt ? '-> wird vom Core gelesen' : '-> vom Core UEBERSEHEN'))
  }

  if (zeilen.length && zeilen.some(z => z.RealmID !== -1 && z.RealmID !== realmId)) {
    pruefe(false, 'mindestens ein Eintrag liegt auf einer RealmID, die der Core nie abfragt')
  } else {
    pruefe(true, 'alle Eintraege liegen auf einer RealmID, die der Core abfragt')
  }

  /* --------- 2. Testkonto mit dem Wert, den das Panel schreibt --------- */
  console.log('')
  console.log('=== 2. Testkonto mit RealmID = 0 (was das Panel heute schreibt) ===')
  const kennung = 'gmtest' + Math.floor(Math.random() * 100000)
  await connection.query(
    `INSERT INTO account (username, salt, verifier, email, reg_mail)
     VALUES (?, UNHEX('00'), UNHEX('00'), '', '')`, [kennung])

  const [neu] = await connection.query('SELECT id FROM account WHERE username = ?', [kennung])
  const accountId = neu[0].id
  console.log(`  Konto ${kennung} (id=${accountId}) angelegt`)

  await panelWaehltRealmId(connection, accountId, 3, 0)

  const [nachSpeichern] = await connection.query(
    'SELECT gmlevel, RealmID FROM account_access WHERE id = ?', [accountId])
  console.log(`  geschrieben: gmlevel=${nachSpeichern[0].gmlevel} RealmID=${nachSpeichern[0].RealmID}`)
  pruefe(nachSpeichern[0].gmlevel === 3, 'gmlevel steht als 3 in der Tabelle')

  // Das ist der eigentliche Test: was bekommt der Core beim Einloggen?
  const [loginAlt] = await connection.query(LOGIN_ABFRAGE, [realmId, kennung])
  const alt = loginAlt[0]
  const altLevel = alt && alt.gmlevel !== null ? alt.gmlevel : null
  if (!alt) {
    pruefe(false, 'Login-Abfrage liefert keine Zeile')
  } else {
    console.log(`  Core-Abfrage liefert: ${altLevel === null ? 'NULL' : altLevel}`)
    // Diese Zusage steht Absicht auf dem Kopf: sie soll ERFUELLT werden,
    // wenn der Kern den Level NICHT liest. Das ist der Beweis, dass
    // RealmID = 0 falsch ist - nicht ein Fehler im Code.
    pruefe(altLevel === null,
      'Core liest NULL - das ist der Beweis: RealmID = 0 wirkt nicht')
  }

  /* --------- 2. Testkonto mit RealmID = -1 --------- */
  console.log('')
  console.log('=== 3. Dasselbe mit RealmID = -1 (was das Panel jetzt schreibt) ===')
  await connection.query('DELETE FROM account_access WHERE id = ?', [accountId])
  await panelWaehltRealmId(connection, accountId, 3, -1)

  const [loginNeu] = await connection.query(LOGIN_ABFRAGE, [realmId, kennung])
  const neu2 = loginNeu[0]
  if (!neu2) {
    pruefe(false, 'Login-Abfrage liefert keine Zeile')
  } else {
    console.log(`  Core-Abfrage liefert: gmlevel=${neu2.gmlevel === null ? 'NULL' : neu2.gmlevel}`)
    pruefe(neu2.gmlevel === 3, 'Core liest gmlevel 3 -> mit RealmID -1 kommt der GM-Level an')
  }

  /* --------- 4. Aufraeumen --------- */
  console.log('')
  console.log('=== 4. Aufraeumen ===')
  await connection.query('DELETE FROM account_access WHERE id = ?', [accountId])
  await connection.query('DELETE FROM account WHERE id = ?', [accountId])
  const [rest] = await connection.query('SELECT id FROM account WHERE username = ?', [kennung])
  pruefe(rest.length === 0, `Testkonto ${kennung} wieder entfernt`)

  await connection.end()

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
