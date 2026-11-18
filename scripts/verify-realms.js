// Prueft das Realms-Menü gegen die echte Auth-Datenbank.
// Liest das echte Schema und fuehrt die Abfrage aus - schreibt aber nichts.
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-'))

// Die echte Konfiguration des Panels verwenden, nicht eine erfundene.
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
const realms = require(path.join(__dirname, '..', 'electron', 'api', 'realms.js'))

const steps = []
const pruefe = (name, ok, zusatz) => steps.push({ name, ok: !!ok, zusatz: zusatz || '' })

;(async () => {
  const m = store.read().mysql
  console.log(`Auth-DB: ${m.user}@${m.host}:${m.port}/${m.authDb}\n`)

  // 1) Das Schema, das tatsaechlich vorhanden ist
  const cols = await db.query('auth', 'SHOW COLUMNS FROM realmlist')
  const vorhanden = cols.map(c => c.Field)
  console.log('realmlist: ' + vorhanden.join(', ') + '\n')
  pruefe('alte Spalte realmflags fehlt', !vorhanden.includes('realmflags'))
  pruefe('alte Spalte realmbuilds fehlt', !vorhanden.includes('realmbuilds'))

  // 2) Genau die Abfrage ausführen, die das Menü absetzt
  let liste = null
  try {
    liste = await realms.listRealms()
    pruefe('listRealms liefert kein SQL-Fehler', true)
  } catch (e) {
    pruefe('listRealms liefert kein SQL-Fehler', false, e.message)
  }

  if (liste) {
    const echteZeilen = await db.query('auth', 'SELECT COUNT(*) AS n FROM realmlist')
    pruefe('alle Realms werden gelistet', liste.length === Number(echteZeilen[0].n),
      `${liste.length} von ${echteZeilen[0].n}`)
    pruefe('Liste ist nicht leer (Realm existiert)', liste.length > 0)
    pruefe('Name vorhanden', !!liste[0] && !!liste[0].name, liste[0] ? liste[0].name : '')
    pruefe('Adresse/Port vorhanden', !!liste[0] && !!liste[0].address && !!liste[0].port,
      liste[0] ? `${liste[0].address}:${liste[0].port}` : '')
    // Die Oberflaeche erwartet die ALTEN Feldnamen - die kommen per AS
    pruefe('realmflags ist als Alias vorhanden', 'realmflags' in (liste[0] || {}),
      liste[0] ? String(liste[0].realmflags) : '')
    pruefe('realmbuilds ist als Alias vorhanden', 'realmbuilds' in (liste[0] || {}),
      liste[0] ? String(liste[0].realmbuilds) : '')
  }

  // 3) Das INSERT pruefen, ohne etwas einzufuegen.
  //    MySQL parst und validiert das mit EXPLAIN vollstaendig - es schreibt nicht.
  const s = await realms.schema()
  const werte = { name: 'x', address: 'y', port: 1, icon: 0, timezone: 1, allowedSecurityLevel: 0, population: 0 }
  const spalten = s.insertierbar
  const sql = `EXPLAIN INSERT INTO realmlist (${spalten.join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`
  try {
    await db.query('auth', sql, spalten.map(k => werte[k]))
    pruefe('INSERT wird von der Datenbank akzeptiert', true, spalten.join(', '))
  } catch (e) {
    pruefe('INSERT wird von der Datenbank akzeptiert', false, e.message)
  }

  // 4) Keine Spalte ohne Standardwert darf fehlen
  const fehlend = spalten.filter(c => {
    const info = cols.find(x => x.Field.toLowerCase() === c.toLowerCase())
    return !info || (info.Null === 'NO' && (info.Default === null || info.Default === undefined))
  })
  // "name" und "address" liefern wir selbst; alles andere braucht einen Standard
  const problem = fehlend.filter(c => !['name', 'address'].includes(c))
  pruefe('jede NOT-NULL-Spalte ohne Standard wird befüllt', problem.length === 0,
    problem.join(', ') || 'keine')

  // 5) Das Schema wird gemerkt - aber bei Datenbankwechsel neu gelesen
  const nochmal = await realms.schema()
  pruefe('Schema wird zwischengespeichert', nochmal === s)
  realms.schemaZuruecksetzen()
  const frisch = await realms.schema()
  pruefe('Schema laesst sich zuruecksetzen', frisch !== s && frisch.flags === s.flags,
    `${frisch.flags} / ${frisch.builds}`)

  console.log('')
  let ok = 0
  for (const st of steps) {
    console.log(`${st.ok ? 'OK   ' : 'FEHLT'}  ${st.name}${st.zusatz ? '   [' + st.zusatz + ']' : ''}`)
    if (st.ok) ok++
  }
  console.log(`\n${ok}/${steps.length} bestanden`)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exitCode = ok === steps.length ? 0 : 1
})().catch(async e => {
  console.error('Abbruch:', e.message)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exitCode = 1
})
