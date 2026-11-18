// Prueft die Charakter-Dienste gegen die echte Datenbank.
//
// Arbeitet ausschliesslich auf selbst angelegten Wegwerfcharakteren und
// raeumt sie am Ende wieder auf - die echten 1171 bleiben unberuehrt.
//
// Geprueft wird nicht nur, dass etwas passiert, sondern dass das Richtige
// passiert: ein Panel, das einen laufenden Charakter teleportiert, einen
// doppelten Namen anlegt oder NaN in eine Koordinatenspalte schreibt, ist
// schlimmer als eines, das gar nichts tut.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dienste-'))
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
const ch = require(path.join(__dirname, '..', 'electron', 'api', 'characters.js'))

const schritte = []
const merke = (ok, was, zusatz) => schritte.push({ ok, name: was, zusatz: zusatz || '' })

// Wegwerf-Konten, damit die Zeichen an ein echtes Konto haengen
const KONTO = 900000001
const A = 'DIENSTTESTA'
const B = 'DIENSTTESTB'

/*
 * Wegwerfcharakter anlegen.
 *
 * Zwei Stolperfallen, die beide schon zugeschlagen haben:
 *
 *  1. characters.guid hat den Vorgabewert 0 und ist deshalb NICHT in der
 *     Liste der Pflichtspalten - "SELECT ... IS_NULLABLE='NO' AND
 *     COLUMN_DEFAULT IS NULL" liefert sie nicht. Ohne gezieltes Setzen
 *     vergibt MySQL 0, und weil es bereits eine Zeile mit guid 0 gibt,
 *     bricht der INSERT ab.
 *
 *  2. name und account muessen pro Aufruf neu sein. Deshalb werden sie als
 *     Platzhalter gefuehrt und nicht als fester Wert eingebacken.
 */
/*
 * Wegwerfcharakter anlegen.
 *
 * Zwei Stolperfallen, die beide zugeschlagen haben:
 *
 *  1. characters.guid und auch race, level, gender, money, map, zone,
 *     position_*, orientation, online haben einen Vorgabewert (meist 0).
 *     "IS_NULLABLE='NO' AND COLUMN_DEFAULT IS NULL" liefert sie deshalb NICHT.
 *     Wer nur die Pflichtliste nimmt, bekommt einen Charakter mit race = 0 -
 *     und die Fraktionsroutine sagt dann "kein Gegenstueck".
 *
 *  2. Die Werte muessen in genau derselben Reihenfolge wie die Spalten
 *     gesendet werden. Object.values(eigen) folgt der Objektreihenfolge und
 *     hat dadurch stillschweigend die falschen Werte geschrieben.
 */
let INSERT_SQL = null

// Die Felder, die der Test wirklich braucht - unabhaengig von Vorgabewerten
const EIGEN = {
  account: KONTO, race: 1, gender: 0, level: 60, money: 1000,
  map: 0, zone: 12, position_x: -8959.56, position_y: -133.93, position_z: 83.12,
  orientation: 1.55, online: 0, skin: 1, hairStyle: 1, hairColor: 1
}

// Auch nach einem Abbruch muss nichts liegen bleiben - deshalb wird nicht nur
// nach dem Konto, sondern auch nach den Namen aufgeraeumt. Ein misslungenes
// INSERT kann das Konto falsch setzen, dann greift der Kontofilter nicht.
const aufraeumen = async () => {
  await db.execute('chars',
    'DELETE FROM characters WHERE account = ? OR name IN (?, ?, ?)',
    [KONTO, A, B, 'THRALLTEST'])
}

const anlegen = async name => {
  if (!INSERT_SQL) {
    const alle = await db.query('chars', `
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'`)
    const namen = ['`guid`', '`name`']
    const werte = []
    const gesehen = new Set(['guid', 'name'])

    for (const n of Object.keys(EIGEN)) {
      namen.push('`' + n + '`')
      werte.push(EIGEN[n])
      gesehen.add(n)
    }
    // Alles, was zwingend einen Wert braucht und noch nicht gesetzt ist
    for (const s of alle) {
      const n = s.COLUMN_NAME
      if (gesehen.has(n)) continue
      if (s.IS_NULLABLE === 'NO' && s.COLUMN_DEFAULT === null) {
        const zahl = /int|float|double|decimal|bit|bool/i.test(s.DATA_TYPE)
        namen.push('`' + n + '`')
        werte.push(zahl ? 0 : '')
        gesehen.add(n)
      }
    }
    INSERT_SQL = {
      sql: `INSERT INTO characters (${namen.join(', ')}) VALUES (${namen.map(() => '?').join(', ')})`,
      festeWerte: werte
    }
  }
  const frei = await db.query('chars', 'SELECT MAX(guid) AS m FROM characters')
  const parameter = [Number(frei[0].m || 0) + 1, name, ...INSERT_SQL.festeWerte]
  await db.execute('chars', INSERT_SQL.sql, parameter)
  const r = await db.query('chars', 'SELECT guid FROM characters WHERE name = ?', [name])
  return r[0].guid
}

;(async () => {
  await aufraeumen()

  const gA = await anlegen(A)
  const gB = await anlegen(B)
  merke(gA > 0 && gB > 0, 'Wegwerfcharaktere angelegt', `${gA}, ${gB}`)

  // ---------------- Umbenennen ----------------
  let r = await ch.renameCharacter(gA, 'THRALLTEST')
  const nA = await db.query('chars', 'SELECT name FROM characters WHERE guid = ?', [gA])
  merke(r.ok && nA[0].name === 'THRALLTEST', 'Umbenennen funktioniert', nA[0].name)

  // Doppelter Name muss abgelehnt werden - der Client kann zwei gleiche nicht
  let fehler = null
  try { await ch.renameCharacter(gA, B) } catch (e) { fehler = e.message }
  merke(fehler && /vergeben/i.test(fehler), 'doppelter Name wird abgelehnt', fehler || '-')

  // Auch case-insensitiv: die Spalte ist utf8mb4_unicode_ci
  fehler = null
  try { await ch.renameCharacter(gA, 'diensttestb') } catch (e) { fehler = e.message }
  merke(fehler && /vergeben/i.test(fehler), 'auch abweichende Gross-/Kleinschreibung', fehler || '-')

  // Ungueltige Zeichen
  for (const komisch of ['Mit Leer', 'Ziffer1', "Apostroph'", 'A!B']) {
    fehler = null
    try { await ch.renameCharacter(gA, komisch) } catch (e) { fehler = e.message }
    merke(fehler && /Buchstaben/.test(fehler), `Name "${komisch}" wird abgelehnt`, fehler ? 'ja' : 'NEIN')
  }

  // Zu kurz / zu lang
  fehler = null
  try { await ch.renameCharacter(gA, 'X') } catch (e) { fehler = e.message }
  merke(fehler && /2-12/.test(fehler), 'zu kurzer Name wird abgelehnt', fehler || '-')
  fehler = null
  try { await ch.renameCharacter(gA, 'ABCDEFGHIJKLMN') } catch (e) { fehler = e.message }
  merke(fehler && /2-12/.test(fehler), 'zu langer Name wird abgelehnt', fehler || '-')

  // ---------------- Gold und Stufe ----------------
  await ch.updateCharacter(gA, { money: 1234567, level: 70 })
  const g = await db.query('chars', 'SELECT money, level FROM characters WHERE guid = ?', [gA])
  merke(Number(g[0].money) === 1234567, 'Gold setzen funktioniert', String(g[0].money))
  merke(Number(g[0].level) === 70, 'Stufe setzen funktioniert', String(g[0].level))

  await ch.updateCharacter(gA, { level: 999 })
  const g2 = await db.query('chars', 'SELECT level FROM characters WHERE guid = ?', [gA])
  merke(Number(g2[0].level) <= 80, 'Stufe wird begrenzt', `${g2[0].level}`)

  // ---------------- Position: online muss abgelehnt werden ----------------
  await db.execute('chars', 'UPDATE characters SET online = 1 WHERE guid = ?', [gA])
  fehler = null
  try { await ch.updateCharacter(gA, { map: 530, x: 1, y: 2, z: 3 }) } catch (e) { fehler = e.message }
  merke(fehler && /online/i.test(fehler), 'Position wird bei online abgelehnt', fehler || '-')

  fehler = null
  try { await ch.teleport({ guid: gA, map: 530, x: 1, y: 2, z: 3, o: 0 }) } catch (e) { fehler = e.message }
  merke(fehler && /online/i.test(fehler), 'Teleport wird bei online abgelehnt', fehler || '-')

  // Position unveraendert geblieben?
  const p1 = await db.query('chars', 'SELECT map, position_x FROM characters WHERE guid = ?', [gA])
  merke(Number(p1[0].map) === 0 && Number(p1[0].position_x) === -8959.56,
    'Position wurde nicht veraendert', `map=${p1[0].map}`)

  // Gold darf auch bei online geaendert werden - das gehoert dem Server nicht
  await ch.updateCharacter(gA, { money: 500 })
  const g3 = await db.query('chars', 'SELECT money FROM characters WHERE guid = ?', [gA])
  merke(Number(g3[0].money) === 500, 'Gold darf auch online geaendert werden', String(g3[0].money))

  // ---------------- Teleport offline ----------------
  await db.execute('chars', 'UPDATE characters SET online = 0 WHERE guid = ?', [gA])
  const t1 = await ch.teleport({ guid: gA, fromGuid: gB })
  const p2 = await db.query('chars',
    'SELECT map, position_x, position_y, position_z, orientation FROM characters WHERE guid = ?', [gA])
  merke(Number(p2[0].position_x) === Number(t1.x) && Number(p2[0].position_y) === Number(t1.y),
    'Teleport an einen anderen Charakter uebernimmt die Position', `x=${p2[0].position_x}`)

  const t2 = await ch.teleport({ guid: gA, map: 530, x: 1234.5, y: -678.25, z: 99.1, o: 1.25 })
  const p3 = await db.query('chars',
    'SELECT map, position_x, position_y, position_z, orientation FROM characters WHERE guid = ?', [gA])
  merke(Number(p3[0].map) === 530 && Number(p3[0].position_x) === 1234.5 && Number(p3[0].position_z) === 99.1,
    'Teleport nach Koordinaten funktioniert', `map=${p3[0].map}`)

  // NaN muss abgelehnt werden - sonst steht da NaN in einer float-Spalte
  fehler = null
  try { await ch.teleport({ guid: gA, map: 0, x: 'abc', y: 1, z: 1, o: 0 }) } catch (e) { fehler = e.message }
  merke(fehler && /gültige Zahl/.test(fehler), 'Buchstaben als Koordinate werden abgelehnt', fehler || '-')

  fehler = null
  try { await ch.teleport({ guid: gA, map: 0, x: '', y: '', z: '', o: '' }) } catch (e) { fehler = e.message }
  merke(fehler && /leer|gültige Zahl/.test(fehler), 'leere Koordinate wird abgelehnt', fehler || '-')

  // Und dasselbe ueber das freie Bearbeitungsdialog-Feld: dort darf ein leeres X
  // nicht stillschweigend 0 speichern. Realistischer Fall: der Nutzer aendert
  // Gold und laesst die Koordinaten leer - dann wird das Gold gespeichert und
  // die Position bleibt unberuehrt.
  const pVor = await db.query('chars', 'SELECT position_x, money FROM characters WHERE guid = ?', [gA])
  await ch.updateCharacter(gA, { money: 4242, x: '', y: '', z: '' })
  const pNach = await db.query('chars', 'SELECT position_x, money FROM characters WHERE guid = ?', [gA])
  merke(Number(pNach[0].position_x) === Number(pVor[0].position_x),
    'leeres Feld speichert nichts statt 0', `${pVor[0].position_x} -> ${pNach[0].position_x}`)
  merke(Number(pNach[0].money) === 4242, 'die andere Aenderung wird trotzdem gespeichert',
    String(pNach[0].money))

  const p4 = await db.query('chars', 'SELECT position_x FROM characters WHERE guid = ?', [gA])
  merke(Number(p4[0].position_x) === 1234.5, 'Position nach abgelehnten Eingaben unveraendert',
    String(p4[0].position_x))

  fehler = null
  try { await ch.teleport({ guid: gA, fromGuid: gA }) } catch (e) { fehler = e.message }
  merke(fehler && /derselbe/.test(fehler), 'Teleport auf sich selbst wird abgelehnt', fehler || '-')

  // ---------------- Fraktion ----------------
  // Es gibt keine faction-Spalte: die Fraktion folgt race. Der Testcharakter
  // ist Rasse 1 (Mensch) und damit Allianz.
  const f = await ch.getCharacter(gA)
  merke(typeof f.faction === 'number' && f.faction === 0, 'Fraktion wird aus der Rasse abgeleitet', String(f.faction))

  const rasseVor = await db.query('chars', 'SELECT race, gender FROM characters WHERE guid = ?', [gA])
  await ch.updateCharacter(gA, { faction: 1 })
  const nach = await db.query('chars', 'SELECT race, gender FROM characters WHERE guid = ?', [gA])
  merke(Number(nach[0].race) === 2, 'Wechsel zur Horde tauscht die Rasse (Mensch -> Ork)',
    `${rasseVor[0].race} -> ${nach[0].race}`)
  merke(Number(nach[0].gender) === 1 - Number(rasseVor[0].gender), 'Geschlecht wird mitgewechselt',
    `${rasseVor[0].gender} -> ${nach[0].gender}`)
  const f2 = await ch.getCharacter(gA)
  merke(f2.faction === 1, 'Fraktion danach ist Horde', String(f2.faction))

  await ch.updateCharacter(gA, { faction: 0 })
  const zurueck = await db.query('chars', 'SELECT race FROM characters WHERE guid = ?', [gA])
  merke(Number(zurueck[0].race) === 1, 'und wieder zurueck', String(zurueck[0].race))

  fehler = null
  try { await ch.updateCharacter(gA, { faction: 7 }) } catch (e) { fehler = e.message }
  merke(fehler && /Allianz|Horde/.test(fehler), 'ungueltige Fraktion wird abgelehnt', fehler || '-')

  fehler = null
  try { await ch.updateCharacter(gA, { faction: 0 }) } catch (e) { fehler = e.message }
  merke(fehler && /bereits/.test(fehler), 'Wechsel in dieselbe Fraktion wird abgelehnt', fehler || '-')

  fehler = null
  await db.execute('chars', 'UPDATE characters SET online = 1 WHERE guid = ?', [gA])
  try { await ch.updateCharacter(gA, { faction: 1 }) } catch (e) { fehler = e.message }
  merke(fehler && /online/i.test(fehler), 'Fraktionswechsel wird bei online abgelehnt', fehler || '-')
  await db.execute('chars', 'UPDATE characters SET online = 0 WHERE guid = ?', [gA])

  // ---------------- Kartenliste ----------------
  const k = await ch.maps()
  merke(Array.isArray(k.karten) && k.karten.length > 0, 'Kartenliste wird geliefert', `${k.karten.length} Karten`)
  merke(k.karten.every(m => typeof m.map === 'number' && typeof m.name === 'string' || m.name === null),
    'Karteneintraege sind vollstaendig')
  merke(k.karten.some(m => m.map === 0 && m.name === 'Eastern Kingdoms'), 'Karte 0 ist benannt')
  merke(k.karten.some(m => m.map === 530 && m.name === 'The Outland'), '530 ist The Outland, nicht Nether',
    (k.karten.find(m => m.map === 530) || {}).name || '-')
  merke(k.karten.some(m => m.map === 571 && m.name === 'Norsca'), '571 ist Norsca, nicht Outland',
    (k.karten.find(m => m.map === 571) || {}).name || '-')
  merke(k.karten.some(m => m.charaktere > 0), 'Karten mit Charakteren sind dabei')

  console.log('')
  let ok = 0
  for (const s of schritte) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }

  // Aufraeumen
  await aufraeumen()
  const reste = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters WHERE account = ?', [KONTO])
  const weg = Number(reste[0].n) === 0
  console.log(`${weg ? 'OK   ' : 'FEHLT'}  Wegwerfcharaktere entfernt`)
  if (weg) ok++

  const echt = await db.query('chars', 'SELECT COUNT(*) AS n FROM characters')
  console.log(`      Charaktere in der Datenbank: ${echt[0].n}`)

  console.log(`\n${ok}/${schritte.length + 1} bestanden`)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === schritte.length + 1 ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  console.error(e.stack)
  try {
    await aufraeumen()
    await db.closeAll()
  } catch (_) {}
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})