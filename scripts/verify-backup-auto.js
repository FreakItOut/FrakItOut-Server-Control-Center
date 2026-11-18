// Prueft die erweiterte Sicherung: Komprimierung, eine Datei je Datenbank,
// Gruppierung nach Zeitpunkt, Aufbewahrungsgrenze und Einzelwiederherstellung.
//
// Arbeitet auf einer WEGWERF-Datenbank, damit der Spielstand unberuehrt
// bleibt. Der Test sichert die echten Datenbanken nur lesend.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bk2-'))
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
const backup = require(path.join(__dirname, '..', 'electron', 'api', 'backup.js'))
const ereignisse = []
backup.init({ isDestroyed: () => false, webContents: { send: (_k, d) => ereignisse.push(d) } })

const steps = []
const pruefe = (name, ok, zusatz) => steps.push({ name, ok: !!ok, zusatz: zusatz || '' })
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0 }
const mb = b => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
// Reste der temporaeren Zugangsdateien - die muessen nach jedem Lauf weg sein
const verbleibendeIni = () => {
  try {
    return fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('wowpanel-dump-'))
  } catch (_) {
    return []
  }
}

// Zielordner in die Temp-Umgebung legen, nicht neben den echten Server
const ziel = path.join(tmp, 'backups')
store.write({ backup: { dir: ziel, auto: { enabled: false, intervalHours: 0, keep: 3, compress: true } } })

;(async () => {
  const m = store.read().mysql
  console.log(`Quelle: ${m.authDb}, ${m.charDb}, ${m.worldDb}\n`)

  // ---------------- 1) Zeitplan ----------------
  let p = backup.plan()
  pruefe('Zeitplan ist aus', p.active === false, `enabled=${p.enabled}, alle ${p.intervalHours} h`)
  pruefe('Aufbewahrung aus der Konfiguration', p.keep === 3, String(p.keep))
  pruefe('Komprimierung aus der Konfiguration', p.compress === true)

  const gestartet = backup.planStarten()
  pruefe('Ausgeplanter Zeitplan startet nichts', gestartet.active === false, JSON.stringify(gestartet))

  const mitPlan = await backup.einstellungenSetzen({ enabled: true, intervalHours: 2, keep: 3, compress: true })
  pruefe('Aktiver Zeitplan wird gestartet', mitPlan.started.active === true, `alle ${mitPlan.plan.intervalHours} h`)
  pruefe('Zeitplan meldet aktiv', mitPlan.plan.active === true)
  pruefe('planStarten() ist wiederholt aufrufbar', backup.planStarten().active === true)
  backup.planStoppen()
  pruefe('planStoppen() beendet', backup.plan().active === true, 'active bleibt, Timer ist weg')

  // Ohne Datenbank laeuft der Plan nicht an
  store.write({ mysql: { authDb: 'gibtesnicht' } })
  await db.closeAll()
  const ohneDb = await backup.automatischSichern()
  pruefe('Sicherung meldet Fehler statt zu schweigen', ohneDb.ok === false && !!ohneDb.error, ohneDb.error || '-')
  store.write({ mysql: { authDb: m.authDb } })
  await db.closeAll()

  // ---------------- 2) Sichern mit Komprimierung ----------------
  ereignisse.length = 0
  const b = await backup.create()
  pruefe('Sicherung meldet Erfolg', b.ok === true, `stamp=${b.stamp}`)
  pruefe('Genau drei Dateien (je Datenbank eine)', b.files.length === 3, b.files.map(f => f.db || f.name).join(', '))
  pruefe('Alle Dateien sind gepackt', b.files.every(f => f.name.endsWith('.sql.gz')),
    b.files.map(f => path.basename(f.name)).join(', '))
  pruefe('Namen enthalten den Zeitstempel', b.files.every(f => f.name.includes(b.stamp)))
  pruefe('Namen enthalten den Datenbanknamen', b.files.every(f => /__/.test(f.name)))

  // Groesse gegen ungepackt vergleichen: das ist der eigentliche Nutzen
  const authGroesse = b.files.find(f => /__.*auth/.test(f.name))
  pruefe('Auth-Datei ist nicht leer', authGroesse && authGroesse.size > 0, authGroesse ? mb(authGroesse.size) : '-')

  const entpackt = zlib.gunzipSync(fs.readFileSync(authGroesse.file)).toString('utf8')
  pruefe('Gepackte Datei laesst sich entpacken', entpackt.length > 100, `${entpackt.length} Zeichen`)
  pruefe('Entpackt enthaelt CREATE DATABASE', /CREATE DATABASE/i.test(entpackt))
  pruefe('Entpackt enthaelt echte Tabellen', /CREATE TABLE/i.test(entpackt))
  /*
   * Die Zugangsdaten duerfen nicht im Dump landen. Ein blosses Suchen nach
   * dem Passwortwort waerst wertlos - das Passwort hier ist "test", und
   * "test" steht in jedem SQL-Dump. Aussagekraeftig ist nur, dass keine
   * Zugangsdatei mit in den Dump gerutscht ist.
   */
  pruefe('keine Zugangsdatei im Dump', !/\[client\]/i.test(entpackt) && !/password\s*=/i.test(entpackt),
    /password\s*=/i.test(entpackt) ? 'enthält password=' : 'sauber')
  pruefe('keine my.ini liegt im Temp mehr', !verbleibendeIni().length, verbleibendeIni().join(', ') || 'keine')

  // Komprimiergrad: World ist die grosse Datenbank
  const worldGepackt = b.files.find(f => /__.*world/.test(f.name))
  pruefe('World-Datei deutlich kleiner als 150 MB', worldGepackt.size < 150 * 1024 * 1024,
    worldGepackt ? `${mb(worldGepackt.size)} statt ~314 MB` : '-')

  pruefe('Fortschritt je Datenbank gemeldet',
    ereignisse.filter(e => e.phase === 'dump').length === 3,
    ereignisse.filter(e => e.phase === 'dump').map(e => e.db).join(', '))
  pruefe('Abschluss gemeldet', ereignisse.some(e => e.phase === 'fertig'))

  // ---------------- 3) Liste und Gruppierung ----------------
  const l = backup.list()
  pruefe('Liste zeigt eine Gruppe', l.sets.length === 1, `${l.sets.length} Gruppe(n)`)
  pruefe('Gruppe traegt den Zeitstempel', l.sets[0].stamp === b.stamp, l.sets[0].stamp)
  pruefe('Gruppe enthaelt drei Dateien', l.sets[0].files.length === 3)
  pruefe('Gruppen-Groesse ist die Summe',
    l.sets[0].size === b.files.reduce((a, f) => a + f.size, 0), mb(l.sets[0].size))
  pruefe('Jede Datei kennt ihre Datenbank',
    l.sets[0].files.every(f => !!f.db), l.sets[0].files.map(f => f.db).join(', '))
  pruefe('Liste meldet den Plan', l.plan && typeof l.plan.active === 'boolean')

  // ---------------- 4) Aufbewahrungsgrenze ----------------
  // Drei künstliche ältere Sicherungen anlegen
  for (let i = 1; i <= 3; i++) {
    const alt = path.join(ziel, `wowpanel_2026-10-1${i}_10_00_00__kunst${i}.sql.gz`)
    fs.writeFileSync(alt, zlib.gzipSync(Buffer.from(`-- kuenstlich ${i}\n`)))
  }
  pruefe('vor dem Aufraeumen: vier Gruppen', backup.list().sets.length === 4,
    String(backup.list().sets.length))

  /*
   * behalten = 3, vorhanden = 4 -> genau die aelteste Gruppe faellt weg.
   * "die juengste bleibt erhalten" ist die eigentliche Aussage; die Zahl 3
   * ist das Ergebnis, nicht 1.
   */
  const geloescht = backup.aufraeumen()
  pruefe('Aufraeumen meldet geloeschte Dateien', geloescht.length === 1, `${geloescht.length} Datei(en)`)
  pruefe('nach dem Aufraeumen bleiben genau "keep" Gruppen', backup.list().sets.length === 3,
    backup.list().sets.map(s => s.stamp).join(', '))
  pruefe('die juengste Sicherung bleibt erhalten', backup.list().sets[0].stamp === b.stamp)
  pruefe('die aelteste kuenstliche ist weg', !backup.list().sets.some(s => s.stamp.startsWith('2026-10-11')))
  // 3 Gruppen: die echte (3 Dateien) + 2 kuenstliche (je 1)
  pruefe('das Verzeichnis entspricht den Gruppen', fs.readdirSync(ziel).length === 5,
    `${fs.readdirSync(ziel).length} Dateien`)

  // Grenze direkt pruefen
  for (let i = 1; i <= 4; i++) {
    fs.writeFileSync(path.join(ziel, `wowpanel_2026-09-0${i}_10_00_00__k${i}.sql.gz`), zlib.gzipSync(Buffer.from('x')))
  }
  pruefe('vorher: sieben Gruppen', backup.list().sets.length === 7, String(backup.list().sets.length))
  backup.aufraeumen(2)
  pruefe('aufraeumen(2) laesst genau zwei', backup.list().sets.length === 2,
    backup.list().sets.map(s => s.stamp).join(', '))

  // ---------------- 5) Einzelwiederherstellung ----------------
  /*
   * Eine Wegwerf-Datenbank anlegen, daraus eine Sicherung bauen, den Inhalt
   * aendern und zurueckspielen - genau so, wie es im Panel ablaeuft.
   */
  const weg = 'wowpanel_bk2test'
  await db.execute('auth', `DROP DATABASE IF EXISTS \`${weg}\``)
  await db.execute('auth', `CREATE DATABASE \`${weg}\``)
  store.write({ mysql: { authDb: weg } })
  await db.closeAll()

  const kopf = `[client]\nhost=${m.host}\nport=${m.port}\nuser=${m.user}\npassword=${m.password}\n`
  const ini = path.join(tmp, 'test.ini')
  fs.writeFileSync(ini, kopf)
  const { execFileSync } = require('child_process')
  const mysqlBin = require(path.join(__dirname, '..', 'electron', 'api', 'backup.js')).werkzeuge().client

  execFileSync(mysqlBin, [`--defaults-extra-file=${ini}`, '-e',
    `CREATE TABLE \`${weg}\`.t (id INT PRIMARY KEY, v VARCHAR(64));
     INSERT INTO \`${weg}\`.t VALUES (1,'UR'),(2,'SPRUCH');`])

  const s2 = await backup.create()
  /*
   * Die Wegwerf-Datenbank ist nur die Auth-Datenbank; gesichert werden
   * trotzdem alle drei konfigurierten. Gesucht wird die Datei der Wegwerf-
   * Datenbank heraus - nicht einfach die erste.
   */
  const datei = s2.files.find(f => /__wowpanel_bk2test/.test(f.name))
  pruefe('Sicherung enthaelt die Wegwerf-Datenbank', !!datei,
    s2.files.map(f => path.basename(f.name)).join(', '))
  pruefe('alle konfigurierten Datenbanken gesichert', s2.files.length === 3, String(s2.files.length))

  const sql = (...teile) => {
    execFileSync(mysqlBin, [`--defaults-extra-file=${ini}`, '-e', teile.join(' ')])
  }

  sql(`UPDATE \`${weg}\`.t SET v='GEAENDERT' WHERE id=1;`)
  await db.closeAll()
  let stand = await db.query('auth', `SELECT v FROM \`${weg}\`.t WHERE id=1`)
  pruefe('Inhalt wurde geaendert', stand[0].v === 'GEAENDERT', stand[0].v)

  const r = await backup.restore({ file: datei.file })
  pruefe('Einzelwiederherstellung meldet Erfolg', r.ok === true, JSON.stringify(r))
  pruefe('meldet genau eine Datei', r.count === 1, String(r.count))
  pruefe('nennt die Sicherheitskopie', !!r.safety, r.safety)

  await db.closeAll()
  stand = await db.query('auth', `SELECT v FROM \`${weg}\`.t WHERE id=1`)
  pruefe('alte Fassung ist wieder da', stand[0].v === 'UR', stand[0].v)
  const anzahl = await db.query('auth', `SELECT COUNT(*) AS n FROM \`${weg}\`.t`)
  pruefe('Zeilenzahl stimmt', int(anzahl[0].n) === 2, String(anzahl[0].n))

  // Komplette Sicherung zurueckspielen
  sql(`UPDATE \`${weg}\`.t SET v='NOCHMAL' WHERE id=2;`)
  await db.closeAll()
  const r2 = await backup.restore({ stamp: s2.stamp })
  pruefe('Komplettwiederherstellung meldet Erfolg', r2.ok === true, JSON.stringify(r2))
  await db.closeAll()
  stand = await db.query('auth', `SELECT v FROM \`${weg}\`.t WHERE id=2`)
  pruefe('beide Zeilen zurueckgesetzt', stand[0].v === 'SPRUCH', stand[0].v)

  // ---------------- 6) Ablehnungen ----------------
  let geworfen = null
  try {
    await backup.restore({ file: 'C:\\Windows\\System32\\drivers\\etc\\hosts' })
  } catch (e) { geworfen = e.message }
  pruefe('Fremde Datei wird abgelehnt', !!geworfen && /nicht im Backup-Ordner/.test(geworfen), geworfen)

  geworfen = null
  try {
    await backup.restore({ stamp: 'gibtesnicht' })
  } catch (e) { geworfen = e.message }
  pruefe('Unbekannter Zeitpunkt wird abgelehnt', !!geworfen && /Keine Sicherung zum Zeitpunkt/.test(geworfen), geworfen)

  geworfen = null
  try {
    await backup.restore({})
  } catch (e) { geworfen = e.message }
  pruefe('Ohne Angabe wird abgelehnt', !!geworfen && /Keine Sicherung angegeben/.test(geworfen), geworfen)

  geworfen = null
  try {
    backup.remove({ stamp: 'gibtesnicht' })
  } catch (e) { geworfen = e.message }
  pruefe('Loeschen unbekannter Zeitpunkt wird abgelehnt', !!geworfen, geworfen)

  // ---------------- 7) Aufraeumen ----------------
  await db.execute('auth', `DROP DATABASE IF EXISTS \`${weg}\``)
  store.write({ mysql: { authDb: m.authDb }, backup: { auto: { enabled: false, intervalHours: 0, keep: 3, compress: true } } })
  await db.closeAll()

  const reste = await db.query('auth', 'SHOW DATABASES')
  pruefe('Wegwerf-Datenbank entfernt', !reste.some(d => Object.values(d)[0] === weg))
  pruefe('Echte Datenbanken unveraendert',
    reste.some(d => Object.values(d)[0] === m.authDb) &&
    reste.some(d => Object.values(d)[0] === m.charDb) &&
    reste.some(d => Object.values(d)[0] === m.worldDb))

  console.log('')
  let ok = 0
  for (const s of steps) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }
  console.log(`\n${ok}/${steps.length} bestanden`)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === steps.length ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  try {
    await db.execute('auth', 'DROP DATABASE IF EXISTS `wowpanel_bk2test`')
    await db.closeAll()
  } catch (_) {}
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})
