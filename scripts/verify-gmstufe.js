// Prueft die GM-Stufe gegen die echte Datenbank.
//
// Warum ueberhaupt: auf dieser Datenbank hat account_access NULL Zeilen. Der
// Code sieht richtig aus, ist aber nie gelaufen - ein Fehler darin waere
// unbemerkt geblieben und wuerde sich erst zeigen, wenn jemand einem Admin
// den GM-Status geben will und es nicht funktioniert.
//
// Geprueft wird, was AzerothCore wirklich erwartet:
//   account_access (id, gmlevel, RealmID, comment)
//   - die Referenzspalte heisst hier "id", nicht "account_id"
//   - RealmID 0 bedeutet "alle Realms" und ist der uebliche Wert
//
// Am Ende wird das Testkonto wieder entfernt - inklusive der Zuordnungszeile.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmstufe-'))
const echte = path.join(os.homedir(), 'AppData', 'Roaming', 'wowpanel', 'config.json')
if (!fs.existsSync(echte)) {
  console.log('Keine Panel-Konfiguration gefunden - Abbruch.')
  process.exit(1)
}
fs.copyFileSync(echte, path.join(tmp, 'config.json'))

const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(tmp)
const db = require(path.join(__dirname, '..', 'electron', 'db.js'))
db.init(store)
const accounts = require(path.join(__dirname, '..', 'electron', 'api', 'accounts.js'))

const NAME = 'PANEL_GMSTUFE'
const PASS = 'Test1234'

const schritte = []
const merke = (ok, was, zusatz) => schritte.push({ ok, name: was, zusatz: zusatz || '' })

const zeilen = id => db.query('auth', 'SELECT * FROM account_access WHERE id = ?', [id])

;(async () => {
  await db.execute('auth', 'DELETE FROM account WHERE username = ?', [NAME])
  await db.execute('auth', 'DELETE FROM account_access WHERE comment = ?', ['Panel'])

  // Ausgangslage festhalten
  const vorher = await db.query('auth', 'SELECT COUNT(*) AS n FROM account_access')
  merke(Number(vorher[0].n) === 0, 'Ausgangslage: account_access ist leer', `${vorher[0].n} Zeilen`)

  // ---------------- 1) Beim Anlegen ----------------
  const neu = await accounts.createAccount({ username: NAME, password: PASS, email: '', gmlevel: 3 })
  merke(neu && neu.id > 0, 'Konto angelegt', `id=${neu && neu.id}`)
  const id = neu.id

  let z = await zeilen(id)
  merke(z.length === 1, 'GM-Stufe 3 hat genau eine Zeile erzeugt', `${z.length} Zeile(n)`)
  if (z.length) {
    merke(Number(z[0].id) === id, 'Referenzspalte zeigt auf das Konto', `id=${z[0].id}`)
    merke(Number(z[0].gmlevel) === 3, 'gmlevel = 3', String(z[0].gmlevel))
    merke(Number(z[0].RealmID) === 0, 'RealmID = 0 (alle Realms)', String(z[0].RealmID))
    merke(z[0].comment === 'Panel', 'Kommentar gesetzt', JSON.stringify(z[0].comment))
  }

  // ---------------- 2) Nachtraeglich aendern ----------------
  await accounts.setGmLevel({ accountId: id, gmlevel: 1 })
  z = await zeilen(id)
  merke(z.length === 1, 'Aendern erzeugt keine zweite Zeile', `${z.length} Zeile(n)`)
  merke(Number(z[0].gmlevel) === 1, 'gmlevel auf 1 geaendert', String(z[0].gmlevel))

  // Und nochmal, um sicherzugehen, dass der UPDATE-Zweig haelt
  await accounts.setGmLevel({ accountId: id, gmlevel: 2 })
  z = await zeilen(id)
  merke(z.length === 1 && Number(z[0].gmlevel) === 2, 'zweiter Wechsel haelt', `gmlevel=${z[0].gmlevel}`)

  // ---------------- 3) Auf 0 zuruecksetzen ----------------
  await accounts.setGmLevel({ accountId: id, gmlevel: 0 })
  z = await zeilen(id)
  merke(Number(z[0].gmlevel) === 0, 'auf 0 gesetzt', `gmlevel=${z[0].gmlevel}`)

  // ---------------- 4) Wird es auch angezeigt? ----------------
  const liste = await accounts.listAccounts({ search: NAME })
  merke(liste.length >= 1, 'Konto steht in der Liste', `${liste.length} Treffer`)
  const treffer = liste.find(a => a.username === NAME)
  merke(treffer && treffer.gmlevel === 3 || treffer && treffer.gmlevel === 0,
    'Liste liefert ein GM-Feld', treffer ? JSON.stringify(treffer.gmlevel) : 'kein Treffer')

  // ---------------- 5) Schemaerkennung ----------------
  const s = await accounts.accountSchema()
  merke(s.access === true, 'account_access wird erkannt', String(s.access))
  merke(s.accessAccountCol === 'id', 'Referenzspalte korrekt als "id" erkannt', String(s.accessAccountCol))
  merke(s.accessGm === true, 'gmlevel-Spalte erkannt', String(s.accessGm))
  merke(s.accessRealmCol === 'RealmID', 'RealmID-Spalte erkannt', String(s.accessRealmCol))

  // ---------------- 6) Aufraeumen ----------------
  await db.execute('auth', 'DELETE FROM account WHERE username = ?', [NAME])
  await db.execute('auth', 'DELETE FROM account_access WHERE comment = ?', ['Panel'])

  const reste = await db.query('auth', 'SELECT COUNT(*) AS n FROM account WHERE username = ?', [NAME])
  merke(Number(reste[0].n) === 0, 'Testkonto entfernt')

  const access = await db.query('auth', 'SELECT COUNT(*) AS n FROM account_access')
  merke(Number(access[0].n) === Number(vorher[0].n), 'account_access wieder auf dem Ausgangsstand',
    `${vorher[0].n} -> ${access[0].n}`)

  const konten = await db.query('auth', 'SELECT COUNT(*) AS n FROM account')
  console.log(`\nKonten in der Datenbank: ${konten[0].n}`)

  console.log('')
  let ok = 0
  for (const s2 of schritte) {
    console.log(`${s2.ok ? 'OK   ' : 'FEHLT'}  ${s2.name}${s2.zusatz ? '   [' + s2.zusatz + ']' : ''}`)
    if (s2.ok) ok++
  }
  console.log(`\n${ok}/${schritte.length} bestanden`)

  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === schritte.length ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  console.error(e.stack)
  try {
    await db.execute('auth', 'DELETE FROM account WHERE username = ?', [NAME])
    await db.execute('auth', 'DELETE FROM account_access WHERE comment = ?', ['Panel'])
    await db.closeAll()
  } catch (_) {}
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})