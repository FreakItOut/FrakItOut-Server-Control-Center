'use strict'

const path = require('path')
const fs = require('fs')
const net = require('net')
const { dialog } = require('electron')

// Datei waehlen (z. B. worldserver.exe)
async function pickFile ({ title, filters, defaultPath, startDir } = {}) {
  const res = await dialog.showOpenDialog({
    title: title || 'Datei auswählen',
    defaultPath: startDir || defaultPath,
    filters: filters || [{ name: 'Ausführbare Datei', extensions: ['exe'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
}

// Ordner waehlen (z. B. das Worldserver-Verzeichnis)
async function pickFolder ({ title, defaultPath } = {}) {
  const res = await dialog.showOpenDialog({
    title: title || 'Ordner auswählen',
    defaultPath,
    // Achtung: der Wert heisst "openDirectory". "openFolder" ist kein
    // gueltiger Electron-Wert - Electron ignoriert ihn kommentarlos und
    // zeigt einen Datei-Dialog, in dem sich nur Dateien auswaehlen lassen.
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
}

// Mehrere Konfigurationsdateien eines Ordners auflisten
async function listConf (dir) {
  if (!dir || !fs.existsSync(dir)) return []
  try {
    return fs
      .readdirSync(dir)
      .filter(f => /\.(conf|dist)$/i.test(f))
      .sort()
  } catch (_) {
    return []
  }
}

// Pruefen, ob angegebene Pfade existieren - fuer die Einstellungen hilfreich
async function checkPaths (paths) {
  const out = {}
  for (const p of paths || []) {
    out[p] = {
      exists: fs.existsSync(p),
      isDir: (() => {
        try { return fs.statSync(p).isDirectory() } catch (_) { return false }
      })()
    }
  }
  return out
}

/*
 * Erkennt die Ordnerstruktur eines fertigen Servers (Repack).
 *
 * Es gibt zwei gaengige Aufbauten:
 *  a) Standard AzerothCore-Quellbuild
 *       bin\worldserver\worldserver.exe  + worldserver.conf daneben
 *  b) Fertiger Repack (alles in einem Ordner)
 *       worldserver.exe + configs\worldserver.conf + gebuendelte MySQL
 *
 * Aus der worldserver.conf werden zusaetzlich die Datenbankdaten gelesen,
 * damit der Nutzer sie nicht abtippen muss.
 */

const readDbInfo = confPath => {
  if (!fs.existsSync(confPath)) return null
  let text
  try {
    text = fs.readFileSync(confPath, 'utf8')
  } catch (_) {
    return null
  }
  const out = {
    host: null,
    port: null,
    user: null,
    password: null,
    authDb: null,
    charDb: null,
    worldDb: null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const m = line.match(/^(Login|Character|World)DatabaseInfo\s*=\s*"([^"]*)"/i)
    if (!m) continue
    const parts = m[2].split(';')
    if (parts.length < 5) continue

    if (!out.host) out.host = parts[0]
    if (!out.port) out.port = Number(parts[1])
    if (!out.user) out.user = parts[2]
    if (!out.password) out.password = parts[3]

    if (/^login/i.test(m[1])) out.authDb = parts[4]
    else if (/^character/i.test(m[1])) out.charDb = parts[4]
    else if (/^world/i.test(m[1])) out.worldDb = parts[4]
  }

  // nichts Brauchbares gefunden?
  if (!out.host && !out.worldDb) return null
  return out
}

function detectRepack (dir) {
  const result = { ok: false, dir: dir || '', notes: [] }
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    result.error = 'Ordner nicht gefunden.'
    return result
  }

  const ex = (...p) => path.join(dir, ...p)
  const exists = p => fs.existsSync(p)

  // --- worldserver / authserver finden ---
  // Die Binary liegt je nach Herkunft sehr unterschiedlich:
  //   Repack-Wurzel, bin\, bin\worldserver\ oder - bei frischem Build mit dem
  //   Visual-Studio-Generator - build\bin\RelWithDebInfo\ bzw. build\bin\Debug\.
  let worldExe = null
  let authExe = null
  let worldConfDir = null
  let authConfDir = null

  const REL = [
    [],
    ['configs'],
    ['bin'],
    ['bin', 'worldserver'],
    ['bin', 'authserver'],
    ['build', 'bin', 'RelWithDebInfo'],
    ['build', 'bin', 'Debug'],
    ['build', 'bin', 'Release'],
    ['server', 'bin'],
    ['bin', 'RelWithDebInfo'],
    ['bin', 'Debug']
  ]
  const BINAR = 'worldserver.exe'
  const AUTHBINAR = 'authserver.exe'

  const hatConf = (ordner, datei) =>
    fs.existsSync(path.join(ordner, datei)) || fs.existsSync(path.join(ordner, datei + '.dist'))

  const finde = (name) => {
    for (const rel of REL) {
      const exe = ex(...rel, name)
      if (!exists(exe)) continue
      // Configordner: configs\, danach der Ordner der EXE selbst
      const configDaneben = ex(...rel, 'configs')
      const conf = hatConf(configDaneben, 'worldserver.conf') || hatConf(configDaneben, 'authserver.conf')
        ? configDaneben
        : path.dirname(exe)
      return { exe, conf }
    }
    return null
  }

  const wHit = finde(BINAR)
  if (wHit) {
    worldExe = wHit.exe
    worldConfDir = hatConf(wHit.conf, 'worldserver.conf') ? wHit.conf : path.dirname(wHit.exe)
  }

  const aHit = finde(AUTHBINAR)
  if (aHit) {
    authExe = aHit.exe
    authConfDir = hatConf(aHit.conf, 'authserver.conf') ? aHit.conf : path.dirname(aHit.exe)
  }

  if (!worldExe && !authExe) {
    result.error = 'Keine worldserver.exe / authserver.exe in diesem Ordner gefunden.'
    return result
  }

  // --- Arbeitsverzeichnis: dort, wo relative Pfade aus der Conf aufloesen ---
  // DataDir = "Daten" o.ae. setzt voraus, dass cwd die Serverwurzel ist.
  // Ein frischer CMake-Build liegt dagegen unter build\bin\<Konfiguration>;
  // dort liegen auch die configs, also ist dieser Ordner das Arbeitsverzeichnis.
  let workDir = dir
  const exeOrdner = path.dirname(worldExe || authExe || '')
  if (/[\\/]build[\\/]bin[\\/][^\\/]+$/i.test(exeOrdner)) {
    workDir = exeOrdner
    result.notes.push('Build-Verzeichnis erkannt - Arbeitsverzeichnis ist der Ordner der Server-EXE.')
  }
  const confOrdner = worldConfDir || dir
  const confText = safeRead(path.join(confOrdner, 'worldserver.conf')) ||
    safeRead(path.join(confOrdner, 'worldserver.conf.dist'))
  const rel = confText && confText.match(/^\s*DataDir\s*=\s*"?([^"\r\n]+)"?/im)
  if (rel) {
    const wert = rel[1].trim()
    if (wert && !path.isAbsolute(wert)) {
      result.notes.push('DataDir ist relativ - das Arbeitsverzeichnis muss die Serverwurzel sein.')
    } else if (!wert) {
      // Leer heisst "aktuelles Verzeichnis". workDir dann leer zu lassen ist
      // wichtig: sonst startet der Server woanders als seine Config-Dateien.
      workDir = ''
      result.notes.push('DataDir ist leer - der Server nutzt sein eigenes Arbeitsverzeichnis.')
    }
  }

  // --- gebuendeltes MySQL finden ---
  let mysqlExe = null
  let mysqlDataDir = null
  let mysqlExtraArgs = ''
  let mysqlDefaultsFile = ''
  const mysqlCandidates = [
    ex('_Server', 'mysql', 'bin', 'mysqld.exe'),
    ex('mysql', 'bin', 'mysqld.exe'),
    ex('bin', 'mysql', 'bin', 'mysqld.exe')
  ]
  const mHit = mysqlCandidates.find(c => exists(c))
  if (mHit) {
    mysqlExe = mHit
    const myIni = path.join(path.dirname(path.dirname(mHit)), 'my.ini')
    if (exists(myIni)) {
      mysqlDefaultsFile = myIni
      result.notes.push('Portables MySQL mit eigener my.ini gefunden.')
    }
    mysqlDataDir = path.join(path.dirname(path.dirname(mHit)), 'data')
    if (!exists(mysqlDataDir)) mysqlDataDir = ''
    // Ohne diese Argumente laeuft mysqld als Dienst und loggt nicht nach stdout
    mysqlExtraArgs = '--standalone --console'
    if (!mysqlDefaultsFile) result.notes.push('Gebuendeltes MySQL gefunden - Startargumente: --standalone --console')
  }

  // --- Datenbankdaten aus der Conf lesen ---
  const db = readDbInfo(path.join(worldConfDir || dir, 'worldserver.conf')) ||
    readDbInfo(path.join(worldConfDir || dir, 'worldserver.conf.dist'))

  result.ok = true
  result.layout = worldConfDir && worldConfDir !== dir ? 'repack' : 'standard'
  result.server = { worldExe, authExe, worldConfDir, authConfDir, workDir }
  result.mysqlServer = {
    exe: mysqlExe,
    dataDir: mysqlDataDir,
    defaultsFile: mysqlDefaultsFile,
    extraArgs: mysqlExtraArgs
  }
  result.mysql = db
  return result
}

/*
 * Wie vollstaendig ist die Einrichtung? Der Assistent braucht das, um zu
 * entscheiden, ob er sich ueberhaupt zeigen muss.
 */
async function setupStatus () {
  const store = require('../store')
  const s = store.read()
  const exeOk = p => {
    try {
      return !!p && fs.existsSync(p) && fs.statSync(p).isFile()
    } catch (_) {
      return false
    }
  }
  const confOk = (dir, datei) => {
    if (!dir) return false
    return fs.existsSync(path.join(dir, datei)) || fs.existsSync(path.join(dir, datei + '.dist'))
  }

  const worldOk = exeOk(s.server.worldExe)
  const authOk = exeOk(s.server.authExe)
  const worldConfOk = confOk(s.server.worldConfDir, 'worldserver.conf')
  const authConfOk = confOk(s.server.authConfDir, 'authserver.conf')

  let dbOk = false
  const dbDetail = {}
  try {
    const db = require('../db')
    for (const kind of ['auth', 'chars', 'world']) {
      const r = await db.test(kind)
      dbDetail[kind] = r.ok
    }
    dbOk = Object.values(dbDetail).every(Boolean)
  } catch (e) {
    for (const kind of ['auth', 'chars', 'world']) dbDetail[kind] = false
  }

  const schritte = [
    { key: 'world', ok: worldOk },
    { key: 'auth', ok: authOk },
    { key: 'worldConf', ok: worldConfOk },
    { key: 'authConf', ok: authConfOk },
    { key: 'db', ok: dbOk }
  ]
  const offen = schritte.filter(x => !x.ok).map(x => x.key)

  /*
   * "eingerichtet" heisst: die Pfade stimmen und das Panel kann den Server
   * ueberhaupt steuern. Die Datenbank gehoert NICHT dazu - sie ist ein
   * Dienst, der auch mal aus ist, und der laesst sich spaeter jederzeit
   * ueber "Server Start / Stop" starten. Andernfalls kaeme man aus dem
   * Assistenten gar nicht mehr heraus, solange MySQL nicht laeuft.
   *
   * Minimal erforderlich: Worldserver samt Config. Der Authserver darf
   * fehlen (Core ohne Authserver), die Datenbank darf aus stehen.
   */
  const pfadeOk = worldOk && worldConfOk

  return {
    eingerichtet: pfadeOk,
    vollstaendig: pfadeOk && authOk && authConfOk && dbOk,
    pfadeOk,
    dbOk,
    schritte,
    offen,
    dbDetail
  }
}

// Ordner, in denen typischerweise ein Server liegt - als Vorschlaege fuer
// den Assistenten, damit der Nutzer nicht suchen muss.
async function suggestServerDirs () {
  const store = require('../store')
  const cfg = store.read()
  const heim = require('os').homedir()
  const wurzeln = [
    cfg.server.rootDir,
    cfg.server.workDir,
    cfg.server.worldConfDir,
    path.dirname(cfg.server.worldExe || ''),
    path.join(heim, 'AzerothCore'),
    path.join(heim, 'Desktop'),
    'C:\\',
    path.join(heim, 'Documents')
  ].filter(Boolean)

  const treffer = []
  const gesehen = new Set()
  for (const w of wurzeln) {
    if (gesehen.has(w)) continue
    gesehen.add(w)
    try {
      if (!fs.existsSync(w) || !fs.statSync(w).isDirectory()) continue
    } catch (_) {
      continue
    }
    const r = detectRepack(w)
    if (r.ok && r.server.worldExe) {
      treffer.push({ dir: w, layout: r.layout, worldExe: r.server.worldExe, notes: r.notes })
    }
  }
  return treffer.slice(0, 8)
}

function safeRead (p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch (_) {
    return ''
  }
}

/*
 * Plattenplatz im Auge behalten: Ein laufender Server frisst weiter Platz
 * (Backups, DB, Logs), und volle Platten sind der haeufigste Grund fuer
 * kryptische MySQL-Abschuerfe. fs.statfs gibt die Freiplatz-Statistik.
 */
async function freierPlatz (ziel) {
  try {
    const root = require('../store').read().server || {}
    const pfad = String(ziel || root.rootDir || process.cwd())
    const st = await fs.promises.statfs(pfad)
    const frei = st.bavail * st.bsize
    const gesamt = st.blocks * st.bsize
    return { ok: true, pfad, freiGb: frei / 1024 / 1024 / 1024, gesamtGb: gesamt / 1024 / 1024 / 1024 }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/*
 * WoW-Client-Helfer: realmlist.wtf auf den eigenen Server zeigen lassen,
 * ohne dass der Spieler Textdateien von Hand editiert. Die alte Datei wird
 * gesichert (realmlist.wtf.panel-backup), damit nichts verlorengeht.
 */
async function realmlistSetzen ({ clientDir, adresse, port } = {}) {
  if (!clientDir) throw new Error('Kein Client-Ordner angegeben.')
  const ziel = path.join(clientDir, 'realmlist.wtf')
  const zeile = `set realmlist ${adresse || '127.0.0.1'}${port ? ':' + port : ''}`
  try {
    // clientDir muss wie ein WoW-Client-Ordner aussehen (WoW.exe + Data)
    const exe = fs.existsSync(path.join(clientDir, 'Wow.exe')) ||
      fs.existsSync(path.join(clientDir, 'WoW.exe')) ||
      fs.existsSync(path.join(clientDir, 'wow.exe'))
    if (!exe) {
      return { ok: false, error: 'Kein WoW.exe in diesem Ordner gefunden - das sieht nicht wie ein WoW-Client aus.' }
    }
    let alt = ''
    if (fs.existsSync(ziel)) {
      alt = fs.readFileSync(ziel, 'utf8')
      fs.writeFileSync(path.join(clientDir, 'realmlist.wtf.panel-backup'), alt, 'utf8')
    }
    // Nur die realmlist-Zeile ersetzen, Rest (patchlist etc.) bleibt stehen.
    const rx = /^set\s+realmlist.*$/im
    const neu = alt && alt.trim()
      ? (rx.test(alt) ? alt.replace(rx, zeile) : alt.replace(/\s*$/, '\r\n') + zeile + '\r\n')
      : zeile + '\r\n'
    fs.writeFileSync(ziel, neu, 'utf8')
    return { ok: true, ziel, zeile, gesichert: fs.existsSync(path.join(clientDir, 'realmlist.wtf.panel-backup')) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/*
 * Ruhige Pruefung, ob der Ordner als 3.3.5a-Client taugt: WoW.exe, Data-
 * Ordner und (optional) vorhandene realmlist.wtf mit deren Inhalt.
 */
async function clientPruefen ({ clientDir } = {}) {
  const notizen = []
  const exe = fs.existsSync(path.join(clientDir || '', 'Wow.exe')) ||
    fs.existsSync(path.join(clientDir || '', 'WoW.exe')) ||
    fs.existsSync(path.join(clientDir || '', 'wow.exe'))
  notizen.push(exe ? 'WoW.exe gefunden.' : 'WoW.exe fehlt.')
  const daten = fs.existsSync(path.join(clientDir || '', 'Data'))
  notizen.push(daten ? 'Data-Ordner gefunden.' : 'Data-Ordner fehlt (Client unvollständig?).')
  const rl = path.join(clientDir || '', 'realmlist.wtf')
  if (fs.existsSync(rl)) {
    const inhalt = fs.readFileSync(rl, 'utf8')
    const m = /set\s+realmlist\s+(\S+)/i.exec(inhalt)
    notizen.push(m ? `realmlist.wtf zeigt auf: ${m[1]}` : 'realmlist.wtf enthält keine Serverzeile.')
  } else {
    notizen.push('realmlist.wtf noch nicht vorhanden.')
  }
  return { ok: true, notizen }
}

/*
 * Gesundheitscheck: eine Ampel-Liste ueber alles, was den Server am
 * Laufen haelt. Fuer "irgendwas stimmt nicht - wo fange ich an?".
 * Alles hier ist schnell (kein Netz-Download), damit der Knopf sofort
 * antwortet.
 */
/*
 * Lauscht auf dem Port jemand? Kurzer Verbindungsversuch - nur für die
 * Port-Prüfung im Gesundheitscheck.
 */
function portLauscht (port, timeoutMs = 800) {
  return new Promise(resolve => {
    let fertig = false
    const s = net.connect({ host: '127.0.0.1', port })
    const setze = wert => {
      if (fertig) return
      fertig = true
      try { s.destroy() } catch (_) {}
      resolve(wert)
    }
    s.setTimeout(timeoutMs)
    s.once('connect', () => setze(true))
    s.once('timeout', () => setze(false))
    s.once('error', () => setze(false))
  })
}

async function gesundheitscheck () {
  const items = []
  const store = require('../store')
  const cfg = store.read()
  const server = cfg.server || {}
  const mysql = cfg.mysql || {}

  // 1. Pfade
  const pfeile = [
    { name: 'worldserver.exe', p: server.worldExe },
    { name: 'authserver.exe', p: server.authExe },
    { name: 'mysqld.exe', p: (server.mysqlServer || {}).exe }
  ]
  const fehlen = pfeile.filter(x => !x.p || !fs.existsSync(x.p)).map(x => x.name)
  items.push({
    key: 'pfade',
    ok: fehlen.length === 0,
    text: fehlen.length ? `Fehlende Dateien: ${fehlen.join(', ')}` : 'Alle Programmdateien vorhanden.'
  })

  // 2. Datenbank
  try {
    const db = require('../db')
    const t = await db.test('world')
    items.push({ key: 'db', ok: !!t.ok, text: t.ok ? 'Datenbank erreichbar.' : `Datenbank nicht erreichbar: ${t.error}` })
  } catch (e) {
    items.push({ key: 'db', ok: false, text: `Datenbankprüfung fehlgeschlagen: ${e.message}` })
  }

  // 3. Clientdaten
  const root = server.rootDir || ''
  const datenOk = root && ['dbc', 'maps', 'vmaps', 'mmaps'].every(n => fs.existsSync(path.join(root, 'data', n)))
  items.push({ key: 'daten', ok: !!datenOk, text: datenOk ? 'Clientdaten (dbc/maps/vmaps/mmaps) vorhanden.' : 'Clientdaten unvollständig oder kein rootDir gesetzt.' })

  // 4. SOAP-Konfiguration
  const soap = cfg.soap || {}
  const soapOk = !!(soap.user && soap.password && Number(soap.port))
  items.push({
    key: 'soap',
    ok: soapOk,
    text: soapOk
      ? `SOAP-Zugang gesetzt (${soap.user}, Port ${soap.port}).`
      : 'SOAP-Zugang unvollständig - Konsole wird nicht funktionieren.'
  })

  // 5. Speicherplatz
  try {
    const platz = await freierPlatz(root)
    items.push({
      key: 'platz',
      ok: platz.ok && platz.freiGb >= 5,
      text: platz.ok ? `${platz.freiGb.toFixed(1)} GB frei.` : `Plattenplatz nicht prüfbar: ${platz.error}`
    })
  } catch (e) {
    items.push({ key: 'platz', ok: false, text: `Plattenplatz nicht prüfbar: ${e.message}` })
  }

  // 6. Zustandsdatei
  const zustand = root && fs.existsSync(path.join(root, 'install-state.json'))
  items.push({ key: 'zustand', ok: !!zustand, text: zustand ? 'install-state.json vorhanden.' : 'Kein install-state.json - der Server wurde noch nicht über das Panel eingerichtet.' })

  /*
   * 7. Serverbuild aktuell? Der Quellstand kann neuer sein als die gebaute
   * EXE - etwa nach einem fehlgeschlagenen Update-Bau. Bis dahin lief der
   * alte Server mit einer halb neuen Quelle; besser ist der Hinweis hier.
   */  try {
    const git = await new Promise(resolve => {
      require('child_process').execFile(
        'git',
        ['-C', path.join(root, 'source'), 'rev-parse', 'HEAD'],
        { timeout: 15000, windowsHide: true },
        (err, stdout) => resolve(err ? null : String(stdout || '').trim())
      )
    })
    if (git && zustand) {
      const zustandDaten = JSON.parse(fs.readFileSync(path.join(root, 'install-state.json'), 'utf8'))
      const gebaut = zustandDaten && zustandDaten.buildCommit
      const aktuell = !!gebaut && gebaut === git
      items.push({
        key: 'build',
        // Ohne eingetragenen Bau-Stand (z. B. vor Einführung dieser Prüfung
        // gebaut) gibt es nichts zu vergleichen - das ist kein Fehler, sondern
        // neutral; nach dem nächsten Update wird der Stand verifizierbar.
        ok: aktuell || !gebaut,
        text: aktuell
          ? `Gebaute EXE entspricht dem Quellstand (${git.slice(0, 8)}).`
          : (!gebaut
              ? `Gebauter Quellstand nicht protokolliert (vor dieser Prüfung gebaut) - nach dem nächsten Update verifizierbar. Quellstand: ${git.slice(0, 8)}.`
              : 'Quellcode ist neuer als die gebaute EXE - im Assistenten das Update erneut starten.')
      })
    }
  } catch (_) {}

  /*
   * 8. Playerbots-Status: Modul installiert? Bot-Datenbank vorhanden?
   * Nach Migration/Modul-Install sieht man hier sofort, ob die Bot-Welt
   * vollständig ist (die Bot-Seite wirkt erst mit beidem).
   */
  try {
    const confDa = root && fs.existsSync(path.join(root, 'build', 'bin', 'configs', 'modules', 'playerbots.conf'))
    let botsDbDa = false
    try {
      const db = require('../db')
      const rows = await db.execute('auth', 'SHOW DATABASES')
      botsDbDa = Array.isArray(rows) && rows.some(r => Object.values(r)[0] === 'acore_playerbots')
    } catch (_) {}
    items.push({
      key: 'bots',
      ok: !confDa && !botsDbDa ? true : (confDa && botsDbDa),
      text: confDa && botsDbDa
        ? 'Playerbots: Modul-Konfiguration und Bot-Datenbank vorhanden.'
        : (!confDa && !botsDbDa
            ? 'Playerbots nicht installiert - die Bot-Seite braucht das Modul.'
            : !confDa
              ? 'Playerbots: Konfiguration fehlt, Bot-Datenbank vorhanden.'
              : 'Playerbots: Konfiguration vorhanden, Bot-Datenbank fehlt (Bots laufen mit leerem Zustand).')
    })
  } catch (_) {}

  /*
   * 10. Module ohne Konfiguration: liegt der Quellordner vor, fehlt aber die
   * passende .conf in configs/modules, startet das Modul mit Defaults oder
   * meckert im Log - das fällt sonst erst in der Konsole auf.
   */
  try {
    const moduleApi = require('./module')
    const inst = moduleApi.installierte()
    const liste = inst.module || []
    const ohne = liste.filter(m => !(m.konf && m.konf.length)).map(m => m.name)
    if (liste.length) {
      items.push({
        key: 'moduleConf',
        ok: ohne.length === 0,
        text: ohne.length
          ? `Module ohne Konfiguration: ${ohne.join(', ')} - auf der Modulseite prüfen.`
          : `Alle ${liste.length} installierten Module haben eine Konfiguration.`
      })
    }
  } catch (_) {}

  /*
   * 11. Panel-Fehlerprotokoll: das Label gibt es seit Runde 10 - aber es gab
   * nie einen echten Punkt dazu (tote Zeile in der Legende). panel-fehler.log
   * ist der Schreikasten der Panel-Interna: unauffällig = fehlt oder leer;
   * Einträge melden. Meldungen, deren letzte Zeile älter als 24 h ist, gelten
   * als abgearbeitet - sonst bleibt die Ampel für immer rot.
   */
  try {
    const fehlerPfad = path.join(require('electron').app.getPath('userData'), 'panel-fehler.log')
    if (!fs.existsSync(fehlerPfad)) {
      items.push({ key: 'fehler', ok: true, text: 'Panel-Fehlerprotokoll: unauffällig (keine Einträge).' })
    } else {
      const st = fs.statSync(fehlerPfad)
      if (st.size === 0) {
        items.push({ key: 'fehler', ok: true, text: 'Panel-Fehlerprotokoll: unauffällig (keine Einträge).' })
      } else {
        let letzteZeile = ''
        let letzterStempel = null
        try {
          const zeilen = fs.readFileSync(fehlerPfad, 'utf8').trim().split(/\r?\n/).filter(Boolean)
          letzteZeile = zeilen.length ? zeilen[zeilen.length - 1] : ''
          // Format aus main.js: "[ISO] [art]" vor der eigentlichen Meldung
          for (const z of zeilen) {
            const m = /^\[(.+?)\]/.exec(z)
            if (m) {
              const t = new Date(m[1])
              if (!isNaN(t.getTime())) letzterStempel = t
            }
          }
        } catch (_) {}
        const frisch = letzterStempel && (Date.now() - letzterStempel.getTime()) < 24 * 60 * 60 * 1000
        items.push({
          key: 'fehler',
          ok: !frisch,
          text: frisch
            ? `Panel-Fehlerprotokoll: ${(st.size / 1024).toFixed(1)} KB, letzte Meldung in den letzten 24 h${letzteZeile ? ` - ${letzteZeile.slice(0, 140)}` : ''}.`
            : `Panel-Fehlerprotokoll: ${(st.size / 1024).toFixed(1)} KB, letzte Meldung älter als 24 h.`
        })
      }
    }
  } catch (e) {
    items.push({ key: 'fehler', ok: true, text: `Panel-Fehlerprotokoll nicht prüfbar: ${e.message}` })
  }

  /*
   * 10. Konten-Zuordnung: Charaktere ohne gültiges Konto können sich nie
   * einloggen - nach Migrationen oder Konten-Löschungen der stille Datenrest.
   */
  try {
    const db = require('../db')
    const authDb = db.nameOf('auth')
    const waisenRows = await db.execute(
      'chars',
      `SELECT COUNT(*) AS c FROM characters ch
       LEFT JOIN \`${authDb}\`.account a ON a.id = ch.account
       WHERE a.id IS NULL`
    )
    const waisen = Array.isArray(waisenRows) && waisenRows.length ? Number(waisenRows[0].c) : 0
    items.push({
      key: 'konten',
      ok: waisen === 0,
      text: waisen === 0
        ? 'Konten-Zuordnung: alle Charaktere haben ein Konto.'
        : `Konten-Zuordnung: ${waisen} Charaktere ohne Konto (nicht einloggbar).`
    })
  } catch (_) {}

  /*
   * 11. Realm-Port gegen Worldserver-Port: Klassiker unter den stillen
   * Fehlkonfigurationen - Login klappt, die Welt verbindet nicht.
   */
  try {
    const db2 = require('../db')
    const rows = await db2.execute('auth', 'SELECT id, name, port FROM realmlist ORDER BY id')
    const confPfad = path.join((server.worldConfDir || ''), 'worldserver.conf')
    const weltPort = portAusConf(confPfad, 'WorldServerPort', 8085)
    const liste = Array.isArray(rows) ? rows : []
    const abweichend = liste.filter(r => Number(r.port) !== Number(weltPort))
    items.push({
      key: 'realm',
      ok: abweichend.length === 0,
      text: abweichend.length === 0
        ? `Realm-Port passt zum Worldserver (${weltPort}).`
        : `Realm-Port weicht ab: ${abweichend.map(r => `${r.name}: ${r.port} (worldserver.conf: ${weltPort})`).join(', ')}.`
    })
  } catch (_) {}

  /*
   * 12. MySQL-Version und Laufzeit: "läuft die DB?" steht schon da - welche
   * Version und seit wann erklärt viele Symptome (alte 8.0.x, frischer
   * Neustart nach Absturz).
   */
  try {
    const db3 = require('../db')
    const v = await db3.execute('auth', 'SELECT VERSION() AS v')
    const version = Array.isArray(v) && v.length ? String(v[0].v) : ''
    let uptime = null
    try {
      const st = await db3.execute('auth', "SHOW GLOBAL STATUS LIKE 'Uptime'")
      if (Array.isArray(st) && st.length) {
        const werte = Object.values(st[0])
        uptime = Number(werte[1])
      }
    } catch (_) {}
    // Antwortzeit: träge Datenbank erklärt Lags, ohne dass etwas rot wird
    let antwortMs = null
    try {
      const t0 = Date.now()
      await db3.execute('auth', 'SELECT 1')
      antwortMs = Date.now() - t0
    } catch (_) {}
    let dauer = ''
    if (uptime != null && Number.isFinite(uptime)) {
      const tage = Math.floor(uptime / 86400)
      const stunden = Math.floor((uptime % 86400) / 3600)
      dauer = `, läuft seit ${tage > 0 ? `${tage} Tagen ` : ''}${stunden} h`
    }
    items.push({
      key: 'mysql',
      ok: antwortMs == null ? true : antwortMs <= 200,
      text: `MySQL ${version || '?'}${dauer}${antwortMs != null ? ` · Antwort ${antwortMs} ms` : ''}.`
    })
  } catch (_) {}

  /*
   * 13. Ports: Dienste können "laufen", ohne dass der Port erreichbar ist
   * (falscher Port in der Conf, Firewall, halb gestartet). Geprüft wird nur,
   * was laufen soll.
   */
  try {
    const sm = require('../server-manager')
    const st = sm.status()
    const confDir = server.worldConfDir || ''
    const dbPort = Number((cfg.mysql || {}).port) || 3306
    const worldPort = portAusConf(path.join(confDir, 'worldserver.conf'), 'WorldServerPort', 8085)
    const authPort = portAusConf(path.join(server.authConfDir || confDir, 'authserver.conf'), 'AuthServerPort', 3724)
    const soapPort = Number((cfg.soap || {}).port) || 7878
    const pruefungen = [
      { name: 'Worldserver', port: worldPort, laeuft: !!(st.world && st.world.running) },
      { name: 'Authserver', port: authPort, laeuft: !!(st.auth && st.auth.running) },
      { name: 'SOAP', port: soapPort, laeuft: !!(st.world && st.world.running) },
      { name: 'Datenbank', port: dbPort, laeuft: !!(st.db && st.db.running) }
    ]
    const fehler = []
    for (const p2 of pruefungen) {
      const offen = await portLauscht(p2.port)
      if (p2.laeuft && !offen) {
        fehler.push(`${p2.name} (Port ${p2.port}) nicht erreichbar`)
      } else if (!p2.laeuft && offen) {
        const b = sm.portBesitzer(p2.port)
        const wer = b ? ` von ${b.name || 'einem Prozess'}${b.pid ? ` (PID ${b.pid})` : ''}` : ''
        fehler.push(`${p2.name}: Port ${p2.port} belegt${wer}`)
      }
    }
    items.push({
      key: 'ports',
      ok: fehler.length === 0,
      text: fehler.length === 0
        ? 'Ports: laufende Dienste nehmen ihre Ports an, keine fremde Belegung.'
        : `Ports: ${fehler.join(', ')}.`
    })
  } catch (_) {}

  return { ok: items.every(i => i.ok), items, zeit: new Date().toISOString() }
}

/*
 * Konfiguration exportieren: config.json an einen vom Nutzer gewaehlten
 * Ort kopieren. Fuer Umzuege auf einen anderen PC und fuer den Support.
 */
async function configExport () {
  const store = require('../store')
  const quelle = store.filePathOf()
  const res = await dialog.showSaveDialog({
    title: 'Konfiguration exportieren',
    defaultPath: 'wowpanel-config.json',
    filters: [{ name: 'Konfiguration', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, abgebrochen: true }
  fs.copyFileSync(quelle, res.filePath)
  return { ok: true, pfad: res.filePath }
}

/*
 * Konfiguration importieren: Datei waehlen, JSON pruefen, schreiben.
 * Uebernommen wird per deepMerge - ein unvollstaendiger Stand ueberschreibt
 * nur die Abschnitte, die er wirklich enthaelt.
 */
async function configImport () {
  const store = require('../store')
  const res = await dialog.showOpenDialog({
    title: 'Konfiguration importieren',
    filters: [{ name: 'Konfiguration', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return { ok: false, abgebrochen: true }
  const datei = res.filePaths[0]
  let inhalt
  try {
    inhalt = JSON.parse(fs.readFileSync(datei, 'utf8'))
  } catch (e) {
    return { ok: false, error: `Datei ist kein gültiges JSON: ${e.message}` }
  }
  if (!inhalt || typeof inhalt !== 'object' || Array.isArray(inhalt)) {
    return { ok: false, error: 'Datei enthält keine Konfigurationsobjekt.' }
  }
  if (!inhalt.server && !inhalt.mysql && !inhalt.soap) {
    return { ok: false, error: 'Die Datei enthält keine Server-, MySQL- oder SOAP-Abschnitte.' }
  }
  const neu = store.write(inhalt)
  return { ok: true, pfad: datei, config: neu }
}

/*
 * „Freunde einlassen": LAN-IP erkennen, Realm-Adresse und Firewall auf
 * LAN-Zugriff stellen - und alles ebenso sauber zurück auf „nur lokal".
 * Die Firewall braucht Administratorrechte; misslingt das, stehen die
 * Befehle im Klartext da, damit sie sich erhöht nachholen lassen.
 */

function lanAdresse () {
  const os = require('os')
  const treffer = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) treffer.push({ name, adresse: iface.address })
    }
  }
  return { ok: treffer.length > 0, adressen: treffer }
}

// Port aus der jeweiligen .conf lesen (wie server-manager.portFuer)
function portAusConf (datei, schluessel, standard) {
  try {
    const m = fs.readFileSync(datei, 'utf8').match(new RegExp('^\\s*' + schluessel + '\\s*=\\s*(\\d+)', 'im'))
    if (m) return Number(m[1])
  } catch (_) {}
  return standard
}

function firewallBefehle (ports) {
  return [
    `netsh advfirewall firewall add rule name="AzerothCore Panel - Worldserver" dir=in action=allow protocol=TCP localport=${ports.world}`,
    `netsh advfirewall firewall add rule name="AzerothCore Panel - Authserver" dir=in action=allow protocol=TCP localport=${ports.auth}`
  ]
}

function netshAusfuehren (args) {
  return new Promise(resolve => {
    require('child_process').execFile('netsh', args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, fehler: err ? String(stderr || err.message || '') : '' })
    })
  })
}

async function freundeOeffnen ({ adresse } = {}) {
  const ports = { world: 8085, auth: 3724 }
  try {
    const s = require('../store').read().server || {}
    ports.world = portAusConf(path.join(s.worldConfDir || '', 'worldserver.conf'), 'WorldServerPort', 8085)
    ports.auth = portAusConf(path.join(s.authConfDir || '', 'authserver.conf'), 'RealmServerPort', 3724)
  } catch (_) {}

  const ziel = String(adresse || '').trim() || ((lanAdresse().adressen || [])[0] || {}).adresse || ''
  if (!ziel) return { ok: false, error: 'Keine LAN-Adresse gefunden - der Rechner hängt vermutlich nicht im Netz.' }

  const schritte = []

  // 1. Realm-Adresse in der Datenbank auf die LAN-IP setzen
  try {
    const db = require('../db')
    await db.execute('auth', 'UPDATE realmlist SET address = ? WHERE id = 1', [ziel])
    schritte.push({ ok: true, text: `Realm-Adresse in der Datenbank: ${ziel}` })
  } catch (e) {
    return { ok: false, error: `Realm-Adresse konnte nicht geschrieben werden: ${e.message}` }
  }

  // 2. Firewall-Regeln anlegen (braucht Administratorrechte)
  for (const [name, args] of [
    ['Worldserver', ['advfirewall', 'firewall', 'add', 'rule', `name=AzerothCore Panel - Worldserver`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${ports.world}`]],
    ['Authserver', ['advfirewall', 'firewall', 'add', 'rule', `name=AzerothCore Panel - Authserver`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${ports.auth}`]]
  ]) {
    const r = await netshAusfuehren(args)
    schritte.push(r.ok
      ? { ok: true, text: `Firewall freigegeben: ${name} (TCP ${args.find(a => a.startsWith('localport=')).slice(10)})` }
      : { ok: false, text: `Firewall für ${name} nicht gesetzt - als Administrator ausführen: ${firewallBefehle(ports).find(b => b.includes(name === 'Worldserver' ? `localport=${ports.world}` : `localport=${ports.auth}`))}` })
  }

  return { ok: true, adresse: ziel, ports, schritte }
}

async function freundeSchliessen () {
  const schritte = []
  try {
    const db = require('../db')
    await db.execute('auth', 'UPDATE realmlist SET address = ? WHERE id = 1', ['127.0.0.1'])
    schritte.push({ ok: true, text: 'Realm-Adresse zurück auf 127.0.0.1.' })
  } catch (e) {
    return { ok: false, error: `Realm-Adresse konnte nicht zurückgesetzt werden: ${e.message}` }
  }
  for (const name of ['Worldserver', 'Authserver']) {
    const r = await netshAusfuehren(['advfirewall', 'firewall', 'delete', 'rule', `name=AzerothCore Panel - ${name}`])
    schritte.push({ ok: true, text: r.ok ? `Firewall-Regel entfernt: ${name}.` : `Firewall-Regel ${name} nicht entfernt (war vermutlich nie gesetzt oder Rechte fehlen).` })
  }
  return { ok: true, schritte }
}

/*
 * Plattenplatz-Aufstellung: nicht nur "wieviel ist frei", sondern wo es
 * hingeht. Backups, Logs, die 1-GB-Clientdaten-ZIPs in deps/downloads und
 * das Datenverzeichnis - plus ein Hinweis auf die grossten Einzelobjekte.
 */
async function platzAufstellung () {
  const server = (require('../store').read().server || {})
  const root = server.rootDir || ''
  const oracle = [
    { key: 'backups', p: path.join(root, 'backups') },
    { key: 'logs', p: path.join(root, 'logs') },
    { key: 'downloads', p: path.join(root, 'deps', 'downloads') },
    { key: 'data', p: path.join(root, 'data') },
    { key: 'mysql', p: path.join(root, 'mysql') },
    // Nur Anzeige: Ein geloeschter Build-Ordner bedeutet Komplett-Neubau.
    { key: 'build', p: path.join(root, 'build') }
  ]
  const groesse = async dir => {
    let summe = 0
    const walk = async d => {
      let eintraege
      try { eintraege = await fs.promises.readdir(d, { withFileTypes: true }) } catch (_) { return }
      for (const e of eintraege) {
        const voll = path.join(d, e.name)
        if (e.isDirectory()) await walk(voll)
        else {
          try { summe += (await fs.promises.stat(voll)).size } catch (_) {}
        }
      }
    }
    await walk(dir)
    return summe
  }
  const anteile = []
  for (const o of oracle) {
    if (!root || !fs.existsSync(o.p)) continue
    anteile.push({ key: o.key, pfad: o.p, mb: Math.round((await groesse(o.p)) / 1024 / 1024) })
  }
  /*
   * Debug-Symbole gesondert ausweisen: worldserver.pdb und authserver.pdb
   * sind nach dem Build die größte Überflüssigkeit (zusammen ~450 MB),
   * solange niemand Crash-Dumps auswerten will.
   */
  const pdb = []
  for (const name of ['worldserver.pdb', 'authserver.pdb']) {
    const voll = path.join(root, 'build', 'bin', name)
    if (fs.existsSync(voll)) {
      try { pdb.push({ name, pfad: voll, mb: Math.round(fs.statSync(voll).size / 1024 / 1024) }) } catch (_) {}
    }
  }
  const frei = await freierPlatz(root)
  return { ok: true, anteile, pdb, freiGb: frei.freiGb, gesamtGb: frei.gesamtGb }
}

/*
 * Debug-Symbole löschen: alle .pdb unter build/bin. Sie entstehen beim
 * nächsten Build wieder; wer Crash-Dumps auswerten will, verliert damit
 * allerdings die Symboldateien - der Hinweis steht in der Oberfläche.
 */
async function pdbRaeumen () {
  const root = (require('../store').read().server || {}).rootDir || ''
  const ordner = path.join(root, 'build', 'bin')
  if (!root || !fs.existsSync(ordner)) return { ok: true, entfernt: 0, mb: 0 }
  let entfernt = 0
  let bytes = 0
  for (const name of fs.readdirSync(ordner)) {
    if (!name.toLowerCase().endsWith('.pdb')) continue
    const voll = path.join(ordner, name)
    try {
      bytes += fs.statSync(voll).size
      fs.rmSync(voll, { force: true })
      entfernt++
    } catch (_) {}
  }
  return { ok: true, entfernt, mb: Math.round(bytes / 1024 / 1024) }
}

/*
 * Altlasten räumen: die Clientdaten-ZIPs (je ~1 GB) sind nach dem
 * Entpacken Totlast. Die .dump-Dateien der Übernahme ebenso. Alles andere
 * wird nicht angerührt.
 */
async function downloadsRaeumen () {
  const root = (require('../store').read().server || {}).rootDir || ''
  const ordner = path.join(root, 'deps', 'downloads')
  if (!fs.existsSync(ordner)) return { ok: true, entfernt: 0, mb: 0 }
  let entfernt = 0
  let bytes = 0
  for (const name of fs.readdirSync(ordner)) {
    // auch .sql.gz: die Übernahme dumps sind seit Runde 12 gzip-gepackt
    if (!/^(client-data-.*\.zip|client-data-.*\.zip\.part|uebernahme-.*\.sql(\.gz)?)$/i.test(name)) continue
    const voll = path.join(ordner, name)
    try {
      bytes += fs.statSync(voll).size
      fs.rmSync(voll, { force: true })
      entfernt++
    } catch (_) {}
  }
  return { ok: true, entfernt, mb: Math.round(bytes / 1024 / 1024) }
}

/*
 * Logs & Crash-Dumps aufräumen: Update-, Übernahme- und Clientdaten-
 * Protokolle wachsen unbegrenzt. Gelöscht wird nur, was älter als 14 Tage
 * ist - laufende Logs (offene Dateien, frische Einträge) bleiben unberührt.
 */
async function logsRaeumen () {
  const root = (require('../store').read().server || {}).rootDir || ''
  const ordner = [root ? path.join(root, 'logs') : ''].filter(Boolean)
  try {
    const crash = require('./diagnose').crashOrdner()
    if (crash) ordner.push(crash)
  } catch (_) {}
  const grenze = Date.now() - 14 * 24 * 60 * 60 * 1000
  let entfernt = 0
  let bytes = 0
  for (const dir of ordner) {
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { continue }
    for (const e of eintraege) {
      if (!e.isFile()) continue
      const voll = path.join(dir, e.name)
      try {
        const st = fs.statSync(voll)
        if (st.mtimeMs >= grenze) continue
        bytes += st.size
        fs.rmSync(voll, { force: true })
        entfernt++
      } catch (_) {
        // gesperrte, noch offene Logdateien überspringen
      }
    }
  }
  return { ok: true, entfernt, mb: Math.round(bytes / 1024 / 1024) }
}

/*
 * Datenbankgrößen (Daten + Indizes, MB) der verbundenen DBs - für die
 * Platten-Aufstellung und die Frage "was wiegt hier was?". -1 = unbekannt.
 */
async function dbGroessen () {
  const cfg = (require('../store').read().mysql || {})
  const db = require('../db')
  const paare = [
    ['auth', cfg.authDb],
    ['chars', cfg.charDb],
    ['world', cfg.worldDb],
    ['bots', cfg.botsDb || 'acore_playerbots']
  ]
  const groessen = {}
  const fragmentierung = {}
  for (const [key, name] of paare) {
    if (!name) continue
    try {
      const rows = await db.execute(
        'auth',
        'SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024) AS mb, ROUND(SUM(data_free) / 1024 / 1024) AS frag FROM information_schema.tables WHERE table_schema = ?',
        [name]
      )
      groessen[key] = Array.isArray(rows) && rows.length ? Number(rows[0].mb) || 0 : -1
      fragmentierung[key] = Array.isArray(rows) && rows.length ? Number(rows[0].frag) || 0 : -1
    } catch (_) {
      groessen[key] = -1
      fragmentierung[key] = -1
    }
  }
  return { ok: true, groessen, fragmentierung }
}

/*
 * Datenbank-Wartung: ANALYZE (sicher, schnell) oder OPTIMIZE (rebuildet
 * Tabellen, kann bei der Welt-DB Minuten dauern). Arbeitet in Blöcken,
 * damit die SQL-Anweisung nicht zu lang wird.
 */
async function dbWartung ({ modus } = {}) {
  const mode = String(modus || '').toLowerCase() === 'optimize' ? 'OPTIMIZE' : 'ANALYZE'
  const cfg = (require('../store').read().mysql || {})
  const db = require('../db')
  const namen = [cfg.authDb, cfg.charDb, cfg.worldDb, cfg.botsDb || 'acore_playerbots'].filter(Boolean)
  const start = Date.now()
  let tabellen = 0
  const fehler = []
  for (const name of namen) {
    let liste = []
    try {
      liste = await db.execute(
        'auth',
        'SELECT TABLE_NAME AS t FROM information_schema.tables WHERE table_schema = ? AND TABLE_TYPE = ?',
        [name, 'BASE TABLE']
      )
    } catch (_) {
      continue
    }
    const alle = (Array.isArray(liste) ? liste : []).map(r => r.t).filter(Boolean)
    for (let i = 0; i < alle.length; i += 50) {
      const block = alle
        .slice(i, i + 50)
        .map(t => `\`${name}\`.\`${String(t).replace(/`/g, '')}\``)
        .join(', ')
      try {
        await db.execute('auth', `${mode} TABLE ${block}`)
        tabellen += Math.min(50, alle.length - i)
      } catch (e) {
        fehler.push(`${name}: ${e.message}`)
      }
    }
  }
  const ergebnis = {
    ok: true,
    modus: mode,
    tabellen,
    fehler,
    dauerSek: Math.round((Date.now() - start) / 1000)
  }
  // Letzte Ausführung merken - die Server-Karte zeigt sie an.
  try {
    require('../store').write({
      letzteDbWartung: {
        modus: ergebnis.modus,
        zeit: new Date().toISOString(),
        tabellen: ergebnis.tabellen,
        dauerSek: ergebnis.dauerSek
      }
    })
  } catch (_) {}
  return ergebnis
}

/*
 * Datenbank-Integritaet: CHECK TABLE fuer alle Tabellen der AzerothCore-
 * Datenbanken. Im Gegensatz zu ANALYZE/OPTIMIZE veraendert das nichts -
 * es liest nur und meldet Tabellen, die nicht "status ok" zurueckgeben.
 * Arbeitet in Bloecken, weil hunderte Tabellennamen sonst in einer
 * Anweisung stehen wuerden.
 */
async function dbPruefen () {
  const cfg = (require('../store').read().mysql || {})
  const db = require('../db')
  const namen = [cfg.authDb, cfg.charDb, cfg.worldDb, cfg.botsDb || 'acore_playerbots'].filter(Boolean)
  const start = Date.now()
  let geprueft = 0
  const auffaellig = []
  for (const name of namen) {
    let liste = []
    try {
      liste = await db.query(
        'auth',
        'SELECT TABLE_NAME AS t FROM information_schema.tables WHERE table_schema = ? AND TABLE_TYPE = ?',
        [name, 'BASE TABLE']
      )
    } catch (e) {
      auffaellig.push({ db: name, tabelle: '-', typ: 'error', text: e.message })
      continue
    }
    const alle = (Array.isArray(liste) ? liste : []).map(r => r.t).filter(Boolean)
    for (let i = 0; i < alle.length; i += 40) {
      const block = alle
        .slice(i, i + 40)
        .map(t => `\`${name}\`.\`${String(t).replace(/`/g, '')}\``)
        .join(', ')
      try {
        const rows = await db.query('auth', `CHECK TABLE ${block}`)
        geprueft += Math.min(40, alle.length - i)
        for (const r of rows || []) {
          const typ = String(r.Msg_type || '').toLowerCase()
          // "status"/"note" sind normale Befunde. Warnungen wie "client is
          // using or hasn't closed the table properly" sind kein Schaden;
          // als Fehler zaehlen nur echte CHECK-TABLE-Fehler.
          if (typ !== 'error') continue
          auffaellig.push({
            db: name,
            tabelle: r.Table || '?',
            typ: r.Msg_type || 'Meldung',
            text: String(r.Msg_text || '').slice(0, 300)
          })
        }
      } catch (e) {
        auffaellig.push({ db: name, tabelle: `${i + 1}-${Math.min(i + 40, alle.length)}`, typ: 'error', text: e.message })
      }
    }
  }
  const ergebnis = {
    ok: auffaellig.length === 0 && geprueft > 0,
    geprueft,
    auffaellig: auffaellig.slice(0, 100),
    dauerSek: Math.round((Date.now() - start) / 1000)
  }
  return ergebnis
}


/*
 * Zustand für die Oberfläche: Konfig geändert, aber der Worldserver läuft
 * noch mit dem alten Stand? (Raten, Module, Bots, Conf-Editor setzen das.)
 */
function restartNoetig () {
  try {
    return { noetig: require('../store').read().restartNoetig === true }
  } catch (_) {
    return { noetig: false }
  }
}

/*
 * Steht ein Übersetzen aus? Module setzen buildNoetig, wenn sie installiert,
 * aktualisiert oder entfernt wurden - die Änderung steckt dann noch nicht in
 * der gebauten EXE. Nach erfolgreichem Bau fällt der Merker.
 */
function buildNoetig () {
  try {
    return { noetig: require('../store').read().buildNoetig === true }
  } catch (_) {
    return { noetig: false }
  }
}

function dbWartungLetzte () {
  try {
    return { letzte: require('../store').read().letzteDbWartung || null }
  } catch (_) {
    return { letzte: null }
  }
}

/*
 * Letzte Auffälligkeiten: ERROR/WARNING-Zeilen aus den Serverlogs der
 * letzten Zeit - damit "warum kam gestern nichts an?" nicht zum Graben im
 * Explorer wird. Es wird nur gelesen, nichts verändert.
 */
async function auffaelligkeiten () {
  const server = (require('../store').read().server || {})
  const logsDir = server.rootDir ? path.join(server.rootDir, 'logs') : ''
  const msDir = (server.mysqlServer || {}).dataDir || ''
  const quellen = [
    { name: 'Worldserver', p: path.join(logsDir, 'Server.log') },
    { name: 'Authserver', p: path.join(logsDir, 'Auth.log') },
    { name: 'MySQL', p: path.join(msDir, 'wowpanel-mysql.err') }
  ]
  const rx = /\b(ERROR|FATAL)\b|Fehler|abgestürzt|beendet/i
  const treffer = []
  for (const q of quellen) {
    if (!q.p || !fs.existsSync(q.p)) continue
    let inhalt = ''
    try {
      const stat = fs.statSync(q.p)
      const lese = Math.min(stat.size, 300 * 1024)
      const fd = fs.openSync(q.p, 'r')
      const buf = Buffer.alloc(lese)
      fs.readSync(fd, buf, 0, lese, stat.size - lese)
      fs.closeSync(fd)
      inhalt = buf.toString('utf8')
    } catch (_) { continue }
    for (const zeile of inhalt.split(/\r?\n/).reverse()) {
      if (rx.test(zeile)) {
        treffer.push({ quelle: q.name, zeile: zeile.trim().slice(0, 220) })
        if (treffer.length >= 8) break
      }
    }
    if (treffer.length >= 8) break
  }
  return { ok: true, treffer }
}

/*
 * Diagnose-Export: alle Prüfergebnisse und Zustände in EINE Datei, für den
 * Support im Discord - ohne dass der Nutzer Screenshots von fünf Seiten
 * macht. Passwörter werden maskiert, bevor die Datei geschrieben wird.
 */
async function diagnoseBericht () {
  const store = require('../store')
  const cfg = store.read()
  const version = (() => { try { return require('electron').app.getVersion() } catch (_) { return 'unbekannt' } })()

  const gesund = await gesundheitscheck()
  const platz = await platzAufstellung()
  const auff = await auffaelligkeiten()

  let updateStand = 'unbekannt'
  let gebaut = 'unbekannt'
  try {
    const root = (cfg.server || {}).rootDir || ''
    const zustandDaten = JSON.parse(fs.readFileSync(path.join(root, 'install-state.json'), 'utf8'))
    gebaut = (zustandDaten.buildCommit || '').slice(0, 8) || 'unbekannt'
    updateStand = gebaut
  } catch (_) {}
  try {
    const git = await new Promise(resolve => {
      require('child_process').execFile(
        'git',
        ['-C', path.join((cfg.server || {}).rootDir || '', 'source'), 'rev-parse', 'HEAD'],
        { timeout: 15000, windowsHide: true },
        (err, stdout) => resolve(err ? null : String(stdout || '').trim())
      )
    })
    if (git) updateStand = `${gebaut} (Quelle: ${git.slice(0, 8)})`
  } catch (_) {}

  const backupStatus = await require('./backup').status()

  const maskiere = wert => (wert ? '***gesetzt***' : '(nicht gesetzt)')
  const zeilen = [
    'FreakItOut Server Control Center - Diagnosebericht',
    `Erstellt: ${new Date().toISOString()}`,
    `Panel-Version: ${version}`,
    '',
    '--- Gesundheit ---',
    ...gesund.items.map(i => `[${i.ok ? 'OK' : 'FEHLER'}] ${i.key}: ${i.text}`),
    '',
    '--- Versionen ---',
    `Server-Quellstand: ${updateStand}`,
    '',
    '--- Speicherplatz ---',
    `Frei: ${(platz.freiGb || 0).toFixed(1)} GB von ${(platz.gesamtGb || 0).toFixed(1)} GB`,
    ...platz.anteile.map(a => `${a.key}: ${a.mb} MB (${a.pfad})`),
    ...(platz.pdb && platz.pdb.length ? platz.pdb.map(p => `Debug-Symbol: ${p.name} ${p.mb} MB`) : []),
    '',
    '--- Letzte Auffälligkeiten (Serverlogs) ---',
    ...(auff.treffer.length ? auff.treffer.map(t => `[${t.quelle}] ${t.zeile}`) : ['keine']),
    '',
    '--- Backup ---',
    `Sicherungen: ${backupStatus.anzahl}, belegt ${(backupStatus.belegt / 1024 / 1024).toFixed(1)} MB`,
    `Letzte Sicherung: ${backupStatus.letzte ? backupStatus.letzte.zeitpunkt : 'nie'}`,
    `Wiederherstellungstest: ${backupStatus.letzterTest ? (backupStatus.letzterTest.ok ? 'bestanden (' + backupStatus.letzterTest.stamp + ')' : 'FEHLGESCHLAGEN') : 'nie getestet'}`,
    '',
    '--- Konfiguration (Passwörter maskiert) ---',
    `server.rootDir: ${(cfg.server || {}).rootDir || ''}`,
    `mysql: host=${(cfg.mysql || {}).host} port=${(cfg.mysql || {}).port} user=${(cfg.mysql || {}).user} pass=${maskiere((cfg.mysql || {}).password)} dbs=${(cfg.mysql || {}).authDb}/${(cfg.mysql || {}).charDb}/${(cfg.mysql || {}).worldDb}`,
    `soap: port=${(cfg.soap || {}).port} user=${(cfg.soap || {}).user} pass=${maskiere((cfg.soap || {}).password)}`,
    `wartung: enabled=${(cfg.maintenance || {}).enabled} restartAktiv=${(cfg.maintenance || {}).restartAktiv}`,
    `profile: ${((cfg.profile || {}).liste || []).map(p => p.name).join(', ') || 'keine'}`
  ]

  const res = await dialog.showSaveDialog({
    title: 'Diagnosebericht speichern',
    defaultPath: `wowpanel-diagnose-${new Date().toISOString().slice(0, 10)}.txt`,
    filters: [{ name: 'Diagnosebericht', extensions: ['txt'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, abgebrochen: true }
  fs.writeFileSync(res.filePath, zeilen.join('\r\n') + '\r\n', 'utf8')
  return { ok: true, pfad: res.filePath }
}

module.exports = {
  pickFile,
  pickFolder,
  listConf,
  checkPaths,
  detectRepack,
  setupStatus,
  suggestServerDirs,
  readDbInfo,
  freierPlatz,
  realmlistSetzen,
  clientPruefen,
  gesundheitscheck,
  configExport,
  configImport,
  lanAdresse,
  freundeOeffnen,
  freundeSchliessen,
  diagnoseBericht,
  platzAufstellung,
  downloadsRaeumen,
  logsRaeumen,
  dbGroessen,
  dbWartung,
  dbWartungLetzte,
  dbPruefen,
  restartNoetig,
  buildNoetig,
  pdbRaeumen,
  auffaelligkeiten,
  path
}