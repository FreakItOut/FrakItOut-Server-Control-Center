'use strict'
/*
 * Manueller Test des Modul-SQL-Imports gegen eine KOPIE der echten Datenbanken.
 * Schreibt nichts in acore_world/characters/auth; startet/beendet das gebuendelte
 * MySQL nur, wenn Port 3306 frei war. Aufruf:
 *   node scripts/verify-modul-sql-kopie.js [modulname] [git-url]
 * Nicht in 'npm run pruefe' (braucht MySQL und Platz fuer die Kopien).
 *
 * Ablauf:
 *   1. mitgeliefertes mysqld starten (nur wenn Port 3306 frei ist)
 *   2. Kopien der benoetigten Datenbanken anlegen (Groessengrenze 12 GB)
 *   3. Probe-Modul mit einer harmlosen Tabelle einspielen -> muss klappen
 *   4. Modul von GitHub klonen (Standard: individual-progression), SQL auf die Kopien spielen
 *   5. Kopien loeschen, mysqld wieder beenden (nur wenn selbst gestartet)
 *
 * Ergebnis: %TEMP%\wowpanel-modul-sql-kopie-result.json, Log daneben.
 */
const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const { spawn, spawnSync, execFileSync } = require('child_process')

const PROJEKT = process.cwd()
const REAL_CFG = path.join(PROJEKT, 'release', 'win-unpacked')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const LOG = path.join(os.tmpdir(), `wowpanel-modul-sql-kopie-${STAMP}.log`)
const RESULT = path.join(os.tmpdir(), `wowpanel-modul-sql-kopie-result.json`)
const BASE = path.join(os.tmpdir(), `wowpanel-bg33-${STAMP}`)
const KOPIE_MAX_GB = 12
// Aufruf: node scripts/bg33-sql-copy.js [modulname] [git-url]
const MODUL = process.argv[2] || 'individual-progression'
const MODUL_URL = process.argv[3] ||
  (MODUL === 'transmog'
    ? 'https://github.com/azerothcore/mod-transmog.git'
    : 'https://github.com/ZhengPeiRu21/mod-individual-progression.git')

const protokoll = (...a) => {
  const zeile = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
  console.log(zeile)
  try { fs.appendFileSync(LOG, zeile + '\n', 'utf8') } catch (_) {}
}

const store = require('../electron/store')
store.init(REAL_CFG)
const cfg = store.read()
const ms = (cfg.server || {}).mysqlServer || {}
const mysqlCfg = cfg.mysql || {}
const PORT = Number(mysqlCfg.port) || 3306
const ini = require('../electron/api/backup').defaultsDatei()
const werkzeuge = require('../electron/api/backup').werkzeuge()
const MYSQL = werkzeuge.client
const DUMP = werkzeuge.dump
const MYSQLADMIN = path.join(path.dirname(MYSQL), 'mysqladmin.exe')

const ergebnis = {
  gestartet: new Date().toISOString(),
  log: LOG,
  dbGroessen: {},
  kopien: [],
  probe: null,
  individualProgression: null,
  modulTest: null,
  hinweise: [],
  fehler: null
}

const sqlLauf = (args, datenbank) => {
  const a = [`--defaults-extra-file=${ini}`, '--default-character-set=utf8mb4']
  if (datenbank) a.push(datenbank)
  const r = spawnSync(MYSQL, [...a, '-N', '-e', args], { encoding: 'utf8', windowsHide: true, timeout: 15 * 60 * 1000 })
  return { code: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() }
}

function portOffen (port) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port })
    const fertig = ok => { try { s.destroy() } catch (_) {} ; resolve(ok) }
    s.setTimeout(1200)
    s.once('connect', () => fertig(true))
    s.once('timeout', () => fertig(false))
    s.once('error', () => fertig(false))
  })
}

async function mysqlStarten () {
  if (await portOffen(PORT)) {
    ergebnis.hinweise.push(`Port ${PORT} war bereits belegt - MySQL wurde NICHT gestartet oder beendet.`)
    protokoll('MySQL laeuft bereits, wird nicht angefasst.')
    return { selbst: false }
  }
  const exe = ms.exe
  if (!exe || !fs.existsSync(exe)) throw new Error(`mysqld.exe nicht gefunden: ${exe}`)
  const args = String(ms.extraArgs || '').split(/\s+/).filter(a => a && a !== '--console')
  if (ms.dataDir && fs.existsSync(ms.dataDir)) {
    args.push(`--datadir=${ms.dataDir}`)
    args.push(`--log-error=${path.join(ms.dataDir, 'wowpanel-modul-sql-kopie.err')}`)
  }
  args.push(`--port=${PORT}`)
  protokoll(`Starte MySQL: ${exe} ${args.join(' ')}`)
  const p = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore', detached: true })
  p.unref()
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (await portOffen(PORT)) {
      const t = sqlLauf('SELECT VERSION()')
      if (t.code === 0) {
        protokoll('MySQL erreichbar:', t.out)
        return { selbst: true, pid: p.pid }
      }
    }
  }
  // Nicht erreichbar: den gestarteten Prozess nicht liegen lassen
  try {
    if (fs.existsSync(MYSQLADMIN)) spawnSync(MYSQLADMIN, [`--defaults-extra-file=${ini}`, 'shutdown'], { windowsHide: true, timeout: 60000 })
  } catch (_) {}
  try { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }) } catch (_) {}
  throw new Error('MySQL wurde gestartet, ist aber nach 90 s nicht erreichbar.')
}

async function mysqlBeenden (info) {
  if (!info || !info.selbst) {
    protokoll('MySQL wurde nicht von diesem Test gestartet - bleibt unangetastet.')
    return
  }
  protokoll('Beende das fuer den Test gestartete MySQL ...')
  try {
    if (fs.existsSync(MYSQLADMIN)) {
      spawnSync(MYSQLADMIN, [`--defaults-extra-file=${ini}`, 'shutdown'], { windowsHide: true, timeout: 120000 })
    }
  } catch (_) {}
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (!(await portOffen(PORT))) { protokoll('MySQL beendet.'); return }
  }
  // Letzter Ausweg: die selbst gestartete Instanz beenden (nur dann!)
  if (info.pid) {
    protokoll('mysqladmin-Shutdown wirkte nicht - beende Prozessbaum', info.pid)
    try { spawnSync('taskkill', ['/PID', String(info.pid), '/T', '/F'], { windowsHide: true }) } catch (_) {}
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (!(await portOffen(PORT))) { protokoll('MySQL beendet (taskkill).'); return }
    }
  }
  ergebnis.hinweise.push('MySQL liess sich nicht sauber beenden - bitte pruefen.')
}

function datenbankGroesse (db) {
  const r = sqlLauf(`SELECT ROUND((SUM(data_length+index_length))/1024/1024) FROM information_schema.tables WHERE table_schema='${db}'`)
  return r.code === 0 ? Number(r.out) || 0 : null
}

function kopiereDb (quelle, ziel) {
  return new Promise((resolve, reject) => {
    const zeichensatz = sqlLauf(`SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${quelle}'`)
    const [cs, co] = zeichensatz.out.split(/\s+/)
    sqlLauf(`DROP DATABASE IF EXISTS \`${ziel}\``)
    const an = sqlLauf(`CREATE DATABASE \`${ziel}\` CHARACTER SET ${cs || 'utf8mb4'} COLLATE ${co || 'utf8mb4_unicode_ci'}`)
    if (an.code !== 0) return reject(new Error('CREATE DATABASE: ' + an.err))

    protokoll(`Kopiere ${quelle} -> ${ziel} ...`)
    const dump = spawn(DUMP, [
      `--defaults-extra-file=${ini}`, '--single-transaction', '--quick', '--triggers',
      '--default-character-set=utf8mb4', quelle
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const imp = spawn(MYSQL, [`--defaults-extra-file=${ini}`, '--default-character-set=utf8mb4', ziel], {
      windowsHide: true, stdio: ['pipe', 'ignore', 'pipe']
    })
    let fehler = ''
    dump.stderr.on('data', d => { fehler += d.toString() })
    imp.stderr.on('data', d => { fehler += d.toString() })
    dump.stdout.pipe(imp.stdin)
    imp.stdin.on('error', () => {})
    let dcode = null
    let icode = null
    let fertig = false
    const abschluss = () => {
      if (fertig || dcode === null || icode === null) return
      fertig = true
      if (dcode === 0 && icode === 0) resolve()
      else reject(new Error(`Kopie ${quelle} fehlgeschlagen (dump ${dcode}, import ${icode}): ${fehler.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`))
    }
    dump.on('close', c => { dcode = c; abschluss() })
    imp.on('close', c => { icode = c; abschluss() })
    dump.on('error', reject)
    imp.on('error', reject)
  })
}

function sqlDateien (basis) {
  const moduleApi = require('../electron/api/module')
  return moduleApi.sammleSqlDateien(basis)
}

async function main () {
  fs.mkdirSync(BASE, { recursive: true })
  fs.writeFileSync(LOG, '')
  protokoll('Start. Konfiguration:', REAL_CFG, '| DB:', mysqlCfg.worldDb, mysqlCfg.charDb, mysqlCfg.authDb)
  const mysqlInfo = await mysqlStarten()
  const tempDb = n => `wowpanel_bg33_${n}`
  try {
    const dbs = [mysqlCfg.worldDb, mysqlCfg.charDb, mysqlCfg.authDb].filter(Boolean)
    let summe = 0
    for (const db of dbs) {
      const mb = datenbankGroesse(db)
      ergebnis.dbGroessen[db] = mb
      summe += Number(mb) || 0
      protokoll(`Groesse ${db}: ${mb == null ? 'unbekannt' : mb + ' MB'}`)
    }
    ergebnis.dbGroessen.summeMb = summe
    if (summe > KOPIE_MAX_GB * 1024) {
      throw new Error(`Datenbanken zusammen ${summe} MB - ueber der Grenze von ${KOPIE_MAX_GB} GB fuer eine Kopie.`)
    }

    // ---- Probe-Modul (harmlos) ----
    const probeBasis = path.join(BASE, 'probe')
    const probeSql = path.join(probeBasis, 'data', 'sql', 'world')
    fs.mkdirSync(probeSql, { recursive: true })
    fs.writeFileSync(path.join(probeSql, '01_probe.sql'), [
      'CREATE TABLE wowpanel_import_probe (id INT PRIMARY KEY, text VARCHAR(32));',
      "INSERT INTO wowpanel_import_probe VALUES (1, 'ok');"
    ].join('\n'), 'utf8')

    const kopieWorld = tempDb('world')
    await kopiereDb(mysqlCfg.worldDb, kopieWorld)
    ergebnis.kopien.push(kopieWorld)

    // Modul-Ablage fuer moduleApi vorbereiten (Wegwerf-Wurzel)
    const testRoot = path.join(BASE, 'root')
    const testModule = path.join(testRoot, 'source', 'modules')
    fs.mkdirSync(testModule, { recursive: true })

    store.init(path.join(BASE, 'cfg'))
    store.write({
      server: { rootDir: testRoot, mysqlServer: ms },
      mysql: { host: mysqlCfg.host, port: PORT, user: mysqlCfg.user, password: mysqlCfg.password, worldDb: kopieWorld }
    })
    const backup = require('../electron/api/backup')
    backup.create = async () => ({ ok: true, stamp: 'BG-TEST (Sicherung im Test uebersprungen)' })

    const moduleApi = require('../electron/api/module')
    fs.cpSync(probeBasis, path.join(testModule, 'probe'), { recursive: true })
    protokoll('Spiele Probe-Modul ein ...')
    const probe = await moduleApi.sqlEinspielen({ name: 'probe' })
    const z = sqlLauf('SELECT COUNT(*) FROM wowpanel_import_probe', kopieWorld)
    ergebnis.probe = {
      ok: probe.ok,
      gespielt: probe.gespielt,
      gesamt: probe.gesamt,
      zeilen: z.out,
      fehler: probe.fehler.map(f => f.fehler)
    }
    protokoll('Probe:', JSON.stringify(ergebnis.probe))

    // ---- zu testendes Modul ----
    const ipPfad = path.join(testModule, MODUL)
    protokoll(`Klone ${MODUL} ...`)
    execFileSync('git', ['clone', '--depth', '1', MODUL_URL, ipPfad], {
      stdio: 'inherit', timeout: 45 * 60 * 1000, windowsHide: true
    })
    const dateien = sqlDateien(ipPfad)
    const schluessel = [...new Set(dateien.map(d => d.db).filter(Boolean))]
    protokoll(`${dateien.length} SQL-Dateien, Ziel-DBs: ${schluessel.join(', ') || 'keine'}`)

    const zielDb = { worldDb: kopieWorld }
    for (const key of schluessel) {
      if (key === 'worldDb') continue
      const quelle = key === 'charDb' ? mysqlCfg.charDb : mysqlCfg.authDb
      if (!quelle) {
        ergebnis.hinweise.push(`Keine ${key}-Datenbank eingestellt - betroffene Dateien werden uebersprungen.`)
        continue
      }
      const ziel = tempDb(key.replace('Db', '').toLowerCase())
      await kopiereDb(quelle, ziel)
      ergebnis.kopien.push(ziel)
      zielDb[key] = ziel
    }
    store.write({
      mysql: { host: mysqlCfg.host, port: PORT, user: mysqlCfg.user, password: mysqlCfg.password, ...zielDb }
    })

    protokoll(`Spiele ${MODUL} ein (Abbruch beim ersten Fehler) ...`)
    const ip = await moduleApi.sqlEinspielen({ name: MODUL })
    ergebnis.modulTest = {
      name: MODUL,
      ok: ip.ok,
      gesamt: ip.gesamt,
      gespielt: ip.gespielt,
      dateien: ip.dateien,
      abgelehnt: ip.abgelehnt,
      uebersprungen: ip.uebersprungen.length,
      fehler: ip.fehler,
      offen: ip.offen.length
    }
    if (MODUL === 'individual-progression') ergebnis.individualProgression = ergebnis.modulTest
    protokoll(`${MODUL}:`, JSON.stringify({
      ok: ip.ok, gespielt: ip.gespielt, gesamt: ip.gesamt,
      fehler: ip.fehler.map(f => ({ datei: f.datei, fehler: f.fehler.split(/\r?\n/)[0] })),
      abgelehnt: ip.abgelehnt.length, offen: ip.offen.length
    }))
  } finally {
    for (const db of ergebnis.kopien.reverse()) {
      protokoll('Loesche Kopie', db)
      sqlLauf(`DROP DATABASE IF EXISTS \`${db}\``)
    }
    await mysqlBeenden(mysqlInfo)
    try { fs.unlinkSync(ini) } catch (_) {}
    ergebnis.beendet = new Date().toISOString()
    fs.writeFileSync(RESULT, JSON.stringify(ergebnis, null, 2), 'utf8')
    protokoll('Fertig. Ergebnis:', RESULT)
    try { fs.rmSync(BASE, { recursive: true, force: true }) } catch (_) {}
  }
}

main().catch(async e => {
  ergebnis.fehler = e.message
  protokoll('ABBRUCH:', e.message)
  try { fs.writeFileSync(RESULT, JSON.stringify(ergebnis, null, 2), 'utf8') } catch (_) {}
  console.error(e.stack || e.message)
  process.exit(1)
})
