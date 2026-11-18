'use strict'

const net = require('net')
const { spawn, execFile, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const GRACEFUL_SCRIPT = path.join(__dirname, 'scripts', 'Stop-ProcessGracefully.ps1')

const KIND_LABEL = { world: 'Worldserver', auth: 'Authserver', db: 'Datenbank' }

let store = null
let win = null

// Drossel fuer Fehler-Desktopmeldungen je Dienst (eine pro Minute).
const letzteFehlerMeldung = { world: 0, auth: 0, db: 0 }

// kind: 'world' | 'auth' | 'db'
const procs = {
  world: { child: null, running: false, pid: null, seit: null, phase: 'stopped', bereitTimer: null, manuell: false },
  auth: { child: null, running: false, pid: null, seit: null, phase: 'stopped', bereitTimer: null, manuell: false },
  db: { child: null, running: false, pid: null, seit: null, phase: 'stopped', bereitTimer: null, manuell: false }
}

function init (storeRef, windowRef) {
  store = storeRef
  win = windowRef
  waechterStarten()
}

function send (channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, payload)
  }
  /*
   * Fehler im laufenden Server sollen nicht erst auffallen, wenn jemand
   * die Konsole oeffnet. Hoechstens eine Desktop-Meldung pro Minute und
   * Dienst; die Konsole zaehlt weiterhin jede Zeile.
   */
  if (channel === 'server:log' && payload && payload.kind && payload.kind !== 'db' &&
      (payload.stream === 'stdout' || payload.stream === 'stderr') &&
      /\b(ERROR|FATAL)\b/i.test(payload.line || '')) {
    const jetzt = Date.now()
    if (jetzt - (letzteFehlerMeldung[payload.kind] || 0) > 60000) {
      letzteFehlerMeldung[payload.kind] = jetzt
      try {
        const meldungen = store.read().panel?.meldungen !== false
        if (meldungen) {
          require('./api/notify').melde(
            `${KIND_LABEL[payload.kind]}: Fehler`,
            String(payload.line || '').replace(/\s+/g, ' ').trim().slice(0, 180)
          )
        }
      } catch (_) {}
    }
  }
  // Tray-Tooltip mitführen - ein Blick ins Tray zeigt den Serverzustand.
  if (channel === 'server:status' && payload) {
    try { require('./api/tray').statusTooltip(payload) } catch (_) {}
  }
}

/*
 * AzerothCore schreibt auf Windows je nach Build in der lokalen
 * ANSI-Codepage, nicht zwingend in UTF-8. Enthaelt die UTF-8-Ausgabe
 * Ersatzzeichen, auf latin1 zurueckfallen - das bildet die Einzelbytes
 * korrekt ab, statt deutschen Text zu zerstoeren.
 */
function decodeChunk (buf) {
  const asUtf8 = buf.toString('utf8')
  if (!asUtf8.includes('\uFFFD')) return asUtf8
  return buf.toString('latin1')
}

function exeFor (kind) {
  const s = store.read().server || {}
  if (kind === 'world') return s.worldExe
  if (kind === 'auth') return s.authExe
  if (kind === 'db') return (s.mysqlServer && s.mysqlServer.exe) || ''
  return ''
}

/*
 * Arbeitsverzeichnis der Serverprozesse.
 *
 * Wichtig: Das ist NICHT zwingend der Ordner mit der Konfiguration.
 * Repacks starten die EXE aus der Serverwurzel, weil die Conf relative
 * Pfade enthaelt (DataDir = "Daten", LogsDir = "Berichte") und die
 * Default-Config ueber -c configs/worldserver.conf gefunden wird.
 * Deshalb wird zuerst ein explizit gesetztes workDir verwendet, danach
 * der Ordner der jeweiligen EXE.
 */
function cwdFor (kind) {
  const s = store.read().server || {}
  if (s.workDir && fs.existsSync(s.workDir)) return s.workDir
  if (kind === 'world') return s.worldConfDir || path.dirname(s.worldExe || '')
  if (kind === 'auth') return s.authConfDir || path.dirname(s.authExe || '')
  if (kind === 'db') {
    const exe = exeFor('db')
    return exe ? path.dirname(exe) : process.cwd()
  }
  return process.cwd()
}

/*
 * Nach einem Neustart des Panels laufen die Serverprozesse weiter, aber der
 * Prozessmanager kennt sie nicht - er zeigte "gestoppt", und ein Startversuch
 * kollidierte mit dem belegten Port. Liegt ein passender Prozess vor, wird
 * er uebernommen: Status korrekt, Log folgt wie bei einem eigenen Start.
 */
function uebernehmeLaeufenden (kind) {
  const p = procs[kind]
  if (p.running && p.pid) return true
  const gefunden = pidsOf(IMAGE[kind])
  if (!gefunden.length) return false
  p.running = true
  p.phase = 'ready'
  p.pid = gefunden[0]
  p.child = null
  send('server:status', statusAll())
  send('server:log', {
    kind,
    stream: 'system',
    line: `>>> ${KIND_LABEL[kind]} läuft bereits (PID ${p.pid}) - vom Panel übernommen`
  })
  // Ausgabe weiterlesen: bei world/auth die Logdatei, bei mysqld die .err
  if (kind === 'db') {
    const ms = (store.read().server || {}).mysqlServer || {}
    if (ms.dataDir) p.tail = tailLog(kind, path.join(ms.dataDir, 'wowpanel-mysql.err'), true)
  } else {
    const logFile = logPathFor(kind)
    p.tail = tailLog(kind, logFile, true)
  }
  // Der Beobachter wie bei einem eigenen Start: endet der uebernommene
  // Prozess von allein, faellt der Status auf "gestoppt".
  const watch = setInterval(() => {
    if (p.pid && !pidsOf(IMAGE[kind]).includes(p.pid)) {
      clearInterval(watch)
      p.running = false
      p.pid = null
      p.child = null
      if (p.tail) { clearInterval(p.tail); p.tail = null }
      send('server:status', statusAll())
      send('server:log', { kind, stream: 'system', line: `<<< ${KIND_LABEL[kind]} beendet` })
    }
  }, 2000)
  if (watch.unref) watch.unref()
  p.watch = watch
  return true
}

/*
 * tasklist ist teuer, deshalb wird die Übernahme-Pruefung gedrosselt: bei
 * jedem Statuspoll wuerde sie sonst mehrfach pro Sekunde laufen.
 */
let letzteUebernahmePruefung = 0
const UEBERNAHME_PAUSE_MS = 15000
// Fuer Testlaeufe abschaltbar (Pruefskripte haben sonst echte Serverprozesse
// im System, die die deterministischen Faelle stoeren).
let uebernahmeErlaubt = true
function setzeUebernahme (aktiv) { uebernahmeErlaubt = !!aktiv }
let portPruefungAktiv = true
function setzePortPruefung (aktiv) { portPruefungAktiv = !!aktiv }

function pruefeUebernahme (kind, sofort = false) {
  const p = procs[kind]
  if (p.running && p.pid) return
  if (!uebernahmeErlaubt) return
  if (!sofort && Date.now() - letzteUebernahmePruefung < UEBERNAHME_PAUSE_MS) return
  letzteUebernahmePruefung = Date.now()
  uebernehmeLaeufenden(kind)
}

function status (kind) {
  const p = procs[kind]
  pruefeUebernahme(kind)
  const w = waechterEinstellungen()
  /*
   * seit: Startzeit des Prozesses (ISO). "Läuft seit wann?" ist bei
   * geplanten Neustarts und Speicherhygiene die Standardfrage - ohne die
   * Zeit kannte der Status nur running/pid. Übernommene Prozesse (vor dem
   * Panel-Start gestartet) haben keine bekannte Zeit -> null.
   */
  return {
    running: p.running,
    pid: p.pid,
    seit: p.running ? (p.seit || null) : null,
    phase: p.running ? (p.phase || 'ready') : 'stopped',
    // Dienst-Waechter: letzter Portbefund und Anzahl der Fehlversuche
    waechter: {
      enabled: w.enabled,
      autoRestart: w.autoRestart,
      ...waechterStand(kind)
    }
  }
}

function statusAll () {
  return { world: status('world'), auth: status('auth'), db: status('db') }
}

/*
 * Kleiner Ereignisverlauf fuer die Server-Seite: Start, Stop, Absturz,
 * automatischer Neustart. Rolling 100 Eintraege in der Panel-Konfiguration;
 * die Logs bleiben die Details, hier steht nur das Wann und Was.
 */
function merkeEreignis (kind, art, text) {
  try {
    const alt = Array.isArray(store.read().serverEvents) ? store.read().serverEvents : []
    const eintrag = { zeit: new Date().toISOString(), kind, art, text: String(text || '') }
    store.write({ serverEvents: [eintrag, ...alt].slice(0, 100) })
    send('server:event', eintrag)
  } catch (_) {}
}

function ereignisse () {
  try {
    const l = store.read().serverEvents
    return Array.isArray(l) ? l : []
  } catch (_) {
    return []
  }
}

/* ------------------------------------------------------- Port-Prüfung */

/*
 * Belegte Ports vorher erkennen. Ohne diese Prüfung endet ein Start in
 * rätselhaften Serverlogs ("bind failed", sofortiges Beenden), statt in
 * einer klaren Meldung.
 */
function portBelegt (port, timeoutMs = 1200) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port })
    let fertig = false
    const entscheid = wert => {
      if (fertig) return
      fertig = true
      try { s.destroy() } catch (_) {}
      resolve(wert)
    }
    s.setTimeout(timeoutMs)
    s.once('connect', () => entscheid(true))
    s.once('timeout', () => entscheid(false))
    s.once('error', () => entscheid(false))
  })
}

/*
 * Wer haelt den Port? netstat liefert die PID, tasklist den Namen.
 * Nur fuer die Diagnose - ohne Treffer bleibt es bei null.
 */
function portBesitzer (port) {
  if (!port) return null
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
    // Spalten: Proto, lokale Adresse, Gegenstelle, Status, PID. Der Status
    // ist lokalisiert ("LISTENING"/"ABHÖREN"), deshalb wird er nicht geprüft.
    let pid = 0
    for (const zeile of out.split(/\r?\n/)) {
      const teile = zeile.trim().split(/\s+/)
      if (teile.length < 4) continue
      if (!new RegExp(`[:.]${port}$`).test(teile[1])) continue
      const kandidat = Number(teile[teile.length - 1])
      if (Number.isFinite(kandidat) && kandidat > 0) { pid = kandidat; break }
    }
    if (!pid) return null
    let name = ''
    try {
      const t = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
      const m = t.match(/^"([^"]+)","(\d+)"/m)
      if (m) name = m[1]
    } catch (_) {}
    return { pid, name }
  } catch (_) {
    return null
  }
}

function portAusConf (datei, schluessel, standard) {
  try {
    const m = fs.readFileSync(datei, 'utf8').match(new RegExp('^\\s*' + schluessel + '\\s*=\\s*(\\d+)', 'im'))
    if (m) return Number(m[1])
  } catch (_) {}
  return standard
}

/*
 * Welchen Port belegt die Komponente? Steht in der jeweiligen .conf;
 * die Defaults sind die AzerothCore-Standardports.
 */
function portFuer (kind) {
  const s = store.read().server || {}
  try {
    if (kind === 'world') {
      return portAusConf(path.join(s.worldConfDir || '', 'worldserver.conf'), 'WorldServerPort', 8085)
    }
    if (kind === 'auth') {
      return portAusConf(path.join(s.authConfDir || '', 'authserver.conf'), 'RealmServerPort', 3724)
    }
    if (kind === 'db') {
      return Number((s.mysqlServer || {}).port) || 3306
    }
  } catch (_) {}
  return 0
}

/*
 * Nach dem Spawn ist der Prozess da, aber der Dienst noch nicht bereit.
 * Worldserver braucht je nach Modulen 60-100 Sekunden; ohne diese Pruefung
 * stand die Oberflaeche sofort auf gruen, obwohl die Welt noch lud.
 * "Bereit" heisst: der Dienst-Port ist offen. Nach einem Sicherheitslimit
 * wird trotzdem auf bereit gestellt, damit ein anderer Port nicht ewig
 * "startet" anzeigt.
 */
function warteAufBereitschaft (kind, port) {
  const p = procs[kind]
  if (!p.running) return
  if (p.bereitTimer) {
    clearInterval(p.bereitTimer)
    p.bereitTimer = null
  }
  if (!port) {
    p.phase = 'ready'
    return
  }
  let versuche = 0
  const maximum = kind === 'world' ? 150 : 45
  const timer = setInterval(async () => {
    if (!p.running) {
      clearInterval(timer)
      if (p.bereitTimer === timer) p.bereitTimer = null
      return
    }
    versuche++
    const offen = await portBelegt(port)
    if (offen || versuche >= maximum) {
      clearInterval(timer)
      if (p.bereitTimer === timer) p.bereitTimer = null
      if (!p.running) return
      p.phase = 'ready'
      send('server:status', statusAll())
      send('server:log', {
        kind,
        stream: 'system',
        line: offen
          ? `>>> ${KIND_LABEL[kind]} ist bereit (Port ${port}).`
          : `>>> ${KIND_LABEL[kind]} meldet nach ${Math.round(versuche * 2)} s keinen Port ${port} - Status trotzdem auf bereit gesetzt.`
      })
    }
  }, 2000)
  if (timer.unref) timer.unref()
  p.bereitTimer = timer
}

/* ------------------------------------------------------- Log-Rotation */

const LOG_MAX_BYTES = 50 * 1024 * 1024

/*
 * Serverlogs wachsen unbegrenzt. Vor dem Mitschneiden ein mal umlegen:
 * die aktuelle Datei wird zu *.old, der Server legt danach neu an.
 */
function rotiereLog (datei) {
  try {
    if (fs.statSync(datei).size <= LOG_MAX_BYTES) return
    const alt = `${datei}.old`
    try { fs.rmSync(alt, { force: true }) } catch (_) {}
    fs.renameSync(datei, alt)
    console.log(`[server-manager] Log rotiert: ${datei} -> ${path.basename(alt)}`)
  } catch (_) {}
}

/* ------------------------------------------------------- Auto-Restart */

/*
 * Wenn ein Server von allein endet, kann das Panel ihn wieder anwerfen.
 * Drei Versuche mit je 5 Sekunden Pause; der Zaehler wird zurueckgesetzt,
 * sobald ein Prozess 10 Minuten stabil lief. Manuelle Stops (auch die beim
 * Beenden des Panels) lösen keinen Neustart aus.
 */
let autoRestartGestoppt = {}
let wiederanlaufVersuche = { world: 0, auth: 0, db: 0 }
let stabilSeit = {}

function autoRestartAktiv () {
  try { return !!(store.read().server || {}).autoRestart } catch (_) { return false }
}

function planeWiederanlauf (kind) {
  if (!autoRestartAktiv()) {
    // Ohne Auto-Restart wenigstens melden - ein verlorener Worldserver
    // ohne Meldung wird sonst erst bemerkt, wenn ein Spieler ruft.
    if (Date.now() - (autoRestartGestoppt[kind] || 0) >= 15000) {
      require('./api/notify').melde(`${KIND_LABEL[kind]} beendet`, 'Der Prozess hat sich unerwartet beendet. Manuell starten, wenn gewünscht.')
    }
    return
  }
  if (Date.now() - (autoRestartGestoppt[kind] || 0) < 15000) return // manuell beendet
  if (wiederanlaufVersuche[kind] >= 3) {
    send('server:log', { kind, stream: 'system', line: `>>> ${KIND_LABEL[kind]} nicht neu gestartet: 3 Versuche übersprungen. Manuelles Starten prüft die Logs.` })
    require('./api/notify').melde(`${KIND_LABEL[kind]} nicht neu gestartet`, '3 Automatik-Versuche sind durch - bitte im Panel starten und das Log prüfen.')
    return
  }
  wiederanlaufVersuche[kind] += 1
  send('server:log', {
    kind,
    stream: 'system',
    line: `>>> ${KIND_LABEL[kind]} beendete sich unerwartet - Neustart in 5 Sekunden (Versuch ${wiederanlaufVersuche[kind]}/3)`
  })
  require('./api/notify').melde(`${KIND_LABEL[kind]} abgestürzt`, `Neustart läuft (Versuch ${wiederanlaufVersuche[kind]}/3).`)
  setTimeout(() => {
    start(kind).catch?.(() => {})
  }, 5000)
}

function merkeStabil (kind) {
  if (!stabilSeit[kind]) stabilSeit[kind] = Date.now()
  if (Date.now() - stabilSeit[kind] > 10 * 60 * 1000) wiederanlaufVersuche[kind] = 0
}

/* ------------------------------------------------------- Dienst-Waechter */

/*
 * Der Prozess-Beobachter merkt nur, wenn ein Prozess endet. Ein haengender
 * Worldserver laeuft weiter, nimmt aber keine Verbindungen mehr an - Status
 * bliebe "bereit". Der Waechter fragt deshalb im Hintergrund den Dienst-Port
 * ab und meldet (optional: startet neu), wenn er zweiseitig wegbleibt.
 */
const waechter = {
  world: { fehler: 0, letzte: null, gemeldet: false, versuche: [], gestoppt: false },
  auth: { fehler: 0, letzte: null, gemeldet: false, versuche: [], gestoppt: false },
  db: { fehler: 0, letzte: null, gemeldet: false, versuche: [], gestoppt: false }
}
let waechterTimer = null
let waechterLaeuft = false

function waechterEinstellungen () {
  let w = {}
  try { w = store.read().watchdog || {} } catch (_) {}
  return {
    enabled: w.enabled !== false,
    autoRestart: w.autoRestart === true
  }
}

function waechterStand (kind) {
  const w = waechter[kind] || {}
  return {
    fehler: Number(w.fehler) || 0,
    letzte: w.letzte || null,
    gemeldet: !!w.gemeldet
  }
}

function waechterSetzen (patch = {}) {
  const alt = waechterEinstellungen()
  const neu = {
    enabled: patch.enabled != null ? patch.enabled === true : alt.enabled,
    autoRestart: patch.autoRestart != null ? patch.autoRestart === true : alt.autoRestart
  }
  try { store.write({ watchdog: neu }) } catch (_) {}
  // Abschalten raeumt die Fehlversuche auf, damit ein spaeteres Einschalten
  // nicht sofort mit einem alten Zaehler neu startet.
  if (!neu.enabled) {
    for (const kind of ['world', 'auth', 'db']) {
      waechter[kind] = { fehler: 0, letzte: null, gemeldet: false, versuche: [], gestoppt: false }
    }
  }
  return { ...neu }
}

async function waechterPruefen (kind) {
  const e = waechterEinstellungen()
  const p = procs[kind]
  if (!e.enabled || !portPruefungAktiv || !p.running || p.phase !== 'ready') return
  const port = portFuer(kind)
  if (!port) return
  const st = waechter[kind]
  const offen = await portBelegt(port, 2500)
  if (!p.running) return
  st.letzte = new Date().toISOString()
  if (offen) {
    st.fehler = 0
    st.gemeldet = false
    st.gestoppt = false
    return
  }
  st.fehler++
  /*
   * Zwei Fehlversuche hintereinander: ein einzelner verpasster Port kann
   * auch ein kurzer Aussetzer beim Start sein. Erst danach melden.
   */
  if (st.fehler < 2) return
  if (!st.gemeldet) {
    st.gemeldet = true
    const text = `Port ${port} ist nicht mehr erreichbar, obwohl der Prozess läuft (PID ${p.pid}).`
    merkeEreignis(kind, 'hang', text)
    send('server:log', { kind, stream: 'system', line: `>>> WARNUNG: ${KIND_LABEL[kind]}: ${text}` })
    try { require('./api/notify').melde(`${KIND_LABEL[kind]} nicht erreichbar`, text) } catch (_) {}
  }
  if (!e.autoRestart) return
  const jetzt = Date.now()
  st.versuche = (st.versuche || []).filter(t => jetzt - t < 30 * 60 * 1000)
  if (st.versuche.length >= 2) {
    if (!st.gestoppt) {
      st.gestoppt = true
      send('server:log', {
        kind,
        stream: 'system',
        line: `>>> ${KIND_LABEL[kind]}: Wächter hat 2 Neustarts versucht - bitte Logs prüfen.`
      })
      try {
        require('./api/notify').melde(
          `${KIND_LABEL[kind]}: Wächter gestoppt`,
          'Zwei automatische Neustarts in 30 Minuten - bitte im Panel starten und das Log prüfen.'
        )
      } catch (_) {}
    }
    return
  }
  st.versuche.push(jetzt)
  st.gemeldet = false // der Neustart darf erneut melden
  send('server:log', {
    kind,
    stream: 'system',
    line: `>>> ${KIND_LABEL[kind]}: Wächter startet den Dienst neu (Versuch ${st.versuche.length}/2).`
  })
  try { require('./api/notify').melde(`${KIND_LABEL[kind]} wird neu gestartet`, 'Der Dienst war nicht mehr erreichbar.') } catch (_) {}
  try { await restart(kind) } catch (_) {}
}

function waechterStarten () {
  if (waechterTimer) return
  waechterTimer = setInterval(() => {
    if (waechterLaeuft) return
    waechterLaeuft = true
    ;(async () => {
      try {
        await Promise.all(['world', 'auth', 'db'].map(k => waechterPruefen(k)))
      } catch (_) {
        // Ein einzelner Portfehler darf den Takt nicht beenden.
      } finally {
        waechterLaeuft = false
      }
    })()
  }, 15000)
  if (waechterTimer.unref) waechterTimer.unref()
}

/* ------------------------------------------------------- Firewall-Hinweis */

const firewallHinweisGegeben = {}

function firewallHinweis (kind, port) {
  if (kind === 'db' || firewallHinweisGegeben[kind]) return
  firewallHinweisGegeben[kind] = true
  send('server:log', {
    kind,
    stream: 'system',
    line: `>>> Hinweis: Beim ersten Start fragt Windows eventuell nach der Firewall - "Zulassen" wählen, sonst ist Port ${port} von außen nicht erreichbar.`
  })
}

// Ist der Pfad eine benutzbare Programmdatei?
function isUsableExe (p) {
  if (!p) return false
  try {
    // Achtung: ein Verzeichnis besteht ebenfalls - "existiert" reicht nicht.
    return fs.statSync(p).isFile()
  } catch (_) {
    return false
  }
}

// .bat/.cmd startet Node nicht direkt -> ueber cmd.exe aufrufen
// Bildnamen der Serverprozesse - werden zum Ermitteln der PID benutzt
const IMAGE = { world: 'worldserver.exe', auth: 'authserver.exe', db: 'mysqld.exe' }

// .bat/.cmd startet Node nicht direkt -> ueber cmd.exe aufrufen
function isBatch (p) {
  return /\.(bat|cmd)$/i.test(String(p || ''))
}

// laufende PIDs eines Images ermitteln (fuer "start" ohne direkte PID)
function pidsOf (image) {
  try {
    const out = execFileSync(
      'tasklist',
      // Achtung: /NH darf nur einmal angegeben werden
      ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    )
    const pids = []
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/)
      if (m && m[1].toLowerCase() === image.toLowerCase()) pids.push(Number(m[2]))
    }
    return pids
  } catch (_) {
    return []
  }
}

/*
 * Wo schreibt der Server sein Logfile?
 * Der Pfad steht als LogsDir in der jeweiligen .conf und ist oft relativ
 * zum Arbeitsverzeichnis.
 */
/*
 * Eine Logdatei in einem Ordner finden - auch wenn sie nicht genau so
 * heisst wie erwartet.
 *
 * AzerothCore haengt an den Dateinamen je nach Appender-Flag einen
 * Zeitstempel:
 *   Appender.Server=2,5,0,Server.log,w   ->  Server.log
 *   Appender.Server=2,5,8,Server.log,w   ->  Server_2026-10-14_15_39_25.log
 * Wer nur nach dem genauen Namen sucht, findet bei Flag 8 nichts - und
 * die Konsole bleibt dann einfach leer.
 *
 * Deshalb: erst der exakte Name, dann die juengste passende Datei.
 */
function findLogFile (dir, baseName) {
  const direkt = path.join(dir, baseName)
  if (fs.existsSync(direkt)) return direkt

  const ext = path.extname(baseName)
  const stamm = path.basename(baseName, ext)
  let eintraege = []
  try {
    eintraege = fs.readdirSync(dir)
  } catch (_) {
    return null
  }

  let treffer = null
  let neueste = -1
  for (const name of eintraege) {
    const n = name.toLowerCase()
    if (!n.endsWith(ext.toLowerCase())) continue
    if (!n.startsWith(stamm.toLowerCase())) continue
    const voll = path.join(dir, name)
    let mtime = 0
    try {
      mtime = fs.statSync(voll).mtimeMs
    } catch (_) {
      continue
    }
    if (mtime > neueste) {
      neueste = mtime
      treffer = voll
    }
  }
  return treffer
}

// Basisname des Logs aus der Conf, falls dort ein Appender steht.
// Sonst der Standardname.
function appenderNameFor (confPath, standard) {
  try {
    if (!fs.existsSync(confPath)) return standard
    const text = fs.readFileSync(confPath, 'utf8')
    // Appender.Server=2,5,8,Server.log,w
    const m = text.match(new RegExp(`^\\s*Appender\\.\\w+\\s*=\\s*[^\\r\\n]*?["']?([\\w.-]+\\.log)["']?\\s*(?:,|$)`, 'im'))
    if (m && m[1]) return m[1]
  } catch (_) {}
  return standard
}

/*
 * Wo liegt das Log? Erst die Angabe aus der Conf, dann die ueblichen
 * Orte. Liefert null, wenn es die Datei noch nicht gibt.
 */
/*
 * Öffentlicher Logpfad für die Oberfläche ("Logdatei öffnen"). null, wenn
 * der Server noch nie eine geschrieben hat.
 */
function logDatei (kind) {
  try {
    return logPathFor(kind)
  } catch (_) {
    return null
  }
}

/*
 * Alle vorhandenen Serverlogs fuer das Log-Archiv: aktuelle Datei und die
 * vom Panel umgelegte .old-Datei. Nur echte Dateien, keine geratenen Pfade -
 * das Archiv darf ausschliesslich diese Liste lesen.
 */
function logDateien () {
  const out = []
  for (const kind of ['world', 'auth']) {
    const pfad = logDatei(kind)
    if (!pfad) continue
    for (const [datei, art] of [[pfad, 'aktuell'], [`${pfad}.old`, 'rotation']]) {
      try {
        const st = fs.statSync(datei)
        if (!st.isFile()) continue
        out.push({
          kind,
          pfad: datei,
          name: path.basename(datei),
          art,
          groesse: st.size,
          geaendert: st.mtime.toISOString()
        })
      } catch (_) {}
    }
  }
  return out
}

function logPathFor (kind) {  const standard = kind === 'auth' ? 'Auth.log' : 'Server.log'
  const names = kind === 'auth' ? { conf: 'authserver.conf' } : { conf: 'worldserver.conf' }
  const cwd = cwdFor(kind)

  try {
    const s = store.read().server || {}
    const dir = kind === 'auth' ? s.authConfDir : s.worldConfDir
    if (dir) {
      const cp = path.join(dir, names.conf)
      if (fs.existsSync(cp)) {
        const basis = appenderNameFor(cp, standard)
        const m = fs.readFileSync(cp, 'utf8').match(/^\s*LogsDir\s*=\s*"?([^"\r\n#]+)"?/im)
        if (m) {
          const raw = m[1].trim()
          const abs = path.isAbsolute(raw) ? raw : path.join(cwd, raw)
          const treffer = findLogFile(abs, basis)
          if (treffer) return treffer
        }
      }
    }
  } catch (_) {}

  // Übliche Orte als Rückfall
  for (const g of ['Berichte', 'logs', 'Logs']) {
    const treffer = findLogFile(path.join(cwd, g), standard)
    if (treffer) return treffer
  }
  return null
}

// Neue Zeilen aus einer Logdatei an die Oberflaeche schicken.
// fromStart = true liest zuerst die vorhandenen Zeilen mit - noetig, weil
// der Server sein Startprotokoll schreibt, bevor der Tail laeuft.
//
// Wichtig: mit Zeitstempel-Appender legt der Server bei JEDEM Start eine
// neue Datei an. Die kann beim Start des Panels noch gar nicht existieren.
// Deshalb wird nicht aufgeben, sondern weiter nach ihr gesucht - und eine
// Datei, die nach dem Startzeitpunkt geschrieben wurde, ist garantiert die
// richtige. Sonst wuerde das Panel das Log des VORHERIGEN Laufs ausgeben.
function tailLog (kind, file, fromStart = false) {
  if (file) rotiereLog(file)
  const startZeit = Date.now()
  let ziel = file && fs.existsSync(file) ? file : null
  let pos = ziel ? (fromStart ? 0 : fs.statSync(ziel).size) : 0
  let gemeldet = false

  const iv = setInterval(() => {
    // Datei weg (Neustart des Servers oder Zeitstempel-Appender)?
    if (!ziel || !fs.existsSync(ziel)) {
      const neu = logPathFor(kind)
      let brauchbar = false
      if (neu && neu !== ziel) {
        try {
          // Muss wirklich die Datei dieses Laufs sein. Das Fenster ist
          // absichtlich klein: nur die Grobheit des Dateisystems wird
          // abgefangen. Ein Log, das deutlich vor dem Start geschrieben
          // wurde, gehoert zum vorherigen Lauf und wird nicht erneut
          // ausgegeben.
          brauchbar = fs.statSync(neu).mtimeMs >= startZeit - 500
        } catch (_) {
          brauchbar = false
        }
      }
      if (brauchbar) {
        ziel = neu
        pos = 0 // neue Datei: ab Anfang lesen
      } else {
        if (!ziel && !gemeldet) {
          gemeldet = true
          send('server:log', {
            kind,
            stream: 'stdout',
            line: '>>> warte auf die Logdatei …'
          })
        }
        return
      }
    }

    let size
    try {
      size = fs.statSync(ziel).size
    } catch (_) {
      return
    }
    if (size < pos) pos = 0 // Datei wurde neu angelegt
    if (size === pos) return
    try {
      const fd = fs.openSync(ziel, 'r')
      const buf = Buffer.alloc(size - pos)
      fs.readSync(fd, buf, 0, buf.length, pos)
      fs.closeSync(fd)
      pos = size
      for (const line of decodeChunk(buf).split(/\r?\n/)) {
        if (line.trim()) send('server:log', { kind, stream: 'stdout', line })
      }
    } catch (_) {}
  }, 700)
  if (iv.unref) iv.unref()
  return iv
}

async function start (kind) {
  // Erst nachlaufen, ob der Prozess von vor dem Panelstart noch da ist -
  // sonst wuerde der Start einen zweiten worldserver anwerfen. Beim Start
  // sofort pruefen, nicht gedrosselt: ein falscher Doppelstart ist teurer
  // als eine tasklist-Abfrage.
  pruefeUebernahme(kind, true)
  const exe = exeFor(kind)
  if (procs[kind].running) {
    return { ok: false, error: `${KIND_LABEL[kind]} laeuft bereits (PID ${procs[kind].pid}).` }
  }
  if (!exe) {
    return {
      ok: false,
      // Achtung: die Pfade stehen unter "Einstellungen", nicht unter
      // "Connect Optionen" - dort steht nur die IP-Adresse des Servers.
      error:
        kind === 'db'
          ? 'Kein mysqld-Pfad gesetzt. Unter "Einstellungen - Datenbank-Server (mysqld.exe)" eintragen oder den Server-Wurzelordner automatisch uebernehmen lassen.'
          : `Kein Pfad fuer ${KIND_LABEL[kind]} gesetzt. Unter "Einstellungen - Server-Pfade" eintragen.`
    }
  }
  if (!fs.existsSync(exe)) {
    return { ok: false, error: `Datei nicht gefunden: ${exe}` }
  }
  if (!isUsableExe(exe)) {
    // Sehr haeufig: der Pfad zeigt auf den Ordner statt auf die .exe
    const want = path.join(exe, kind === 'db' ? 'mysqld.exe' : `${kind}server.exe`)
    return {
      ok: false,
      error:
        `"${exe}" ist ein Ordner, keine Programmdatei. ` +
        `Bitte die Datei selbst waehlen, z. B. ${want}.`
    }
  }

  /*
   * Belegten Port vorher erkennen. Ohne diese Pruefung endet der Start in
   * raetselhaften Serverlogs - der Server bindet nicht und beendet sich.
   * Der haeufigste Fall: die Komponente laeuft schon ausserhalb des Panels.
   * Fuer Pruefskripte abschaltbar (die laufen auf Maschinen, auf denen
   * echte mysqld-Instanzen den Port halten).
   */
  const port = portFuer(kind)
  if (portPruefungAktiv && port && (await portBelegt(port))) {
    const besitzer = portBesitzer(port)
    const wer = besitzer
      ? ` Belegt von ${besitzer.name || 'einem Prozess'}${besitzer.pid ? ` (PID ${besitzer.pid})` : ''}.`
      : ''
    return {
      ok: false,
      error:
        `Port ${port} ist bereits belegt.${wer} ` +
        `Vermutlich läuft ${KIND_LABEL[kind]} schon (außerhalb des Panels) oder ein anderes Programm benutzt den Port. ` +
        `Erst die andere Instanz beenden, dann erneut starten.`
    }
  }

  const cwd = cwdFor(kind)

  // mysqld braucht --datadir, sonst sucht es die Daten im Arbeitsordner.
  // Zusaetzliche Argumente erlauben Repacks (z. B. --standalone --console).
  // Eine portable Installation bringt eine eigene my.ini mit; dann kommen
  // Datenverzeichnis, Port und Logdatei von dort und duerfen nicht doppelt
  // auf der Kommandozeile stehen.
  let args = []
  if (kind === 'db') {
    const ms = (store.read().server || {}).mysqlServer || {}
    const extra = String(ms.extraArgs || '').trim().split(/\s+/).filter(Boolean)
    const defaultsFile = ms.defaultsFile && fs.existsSync(ms.defaultsFile) ? ms.defaultsFile : ''
    if (defaultsFile) {
      args.push(`--defaults-file=${defaultsFile}`)
      args.push(...extra.filter(a => a !== '--console'))
    } else {
      // --console und --log-error schliessen sich bei MySQL gegenseitig aus.
      // Fuer die Anzeige im Panel brauchen wir die Datei, deshalb wird
      // --console entfernt, sobald eine eigene Logdatei angegeben wird.
      const wantsLogFile = ms.dataDir && fs.existsSync(ms.dataDir)
      args.push(...(wantsLogFile ? extra.filter(a => a !== '--console') : extra))
      if (ms.dataDir && fs.existsSync(ms.dataDir)) args.push(`--datadir=${ms.dataDir}`)
      if (ms.port) args.push(`--port=${ms.port}`)
      // Ohne Konsolenausgabe schreibt mysqld nichts, was wir anzeigen
      // koennten. Deshalb ein eigenes Fehlerprotokoll, das der Tail liest.
      if (wantsLogFile && !args.some(a => a.startsWith('--log-error'))) {
        args.push(`--log-error=${path.join(ms.dataDir, 'wowpanel-mysql.err')}`)
      }
    }
  }

  const batch = isBatch(exe)
  const command = batch ? 'cmd.exe' : exe
  const commandArgs = batch ? ['/c', exe] : args

  // mysqld braucht keine Konsole und laeuft mit Pipes gut ->
  // Ausgabe direkt abgreifen.
  // World- und Authserver brauchen dagegen eine echte Konsole fuer stdin.
  // Sie wird unsichtbar gestartet (Start-Process -WindowStyle Hidden):
  // echter Konsolen-Handle, aber kein Fenster auf Desktop oder Taskleiste.
  // Die Ausgabe kommt weiterhin aus der Logdatei ins Panel.
  const useConsoleWindow = kind !== 'db' && !batch

  try {
    if (useConsoleWindow) {
      const before = new Set(pidsOf(IMAGE[kind]))
      /*
       * PowerShell statt "cmd /c start /min": -WindowStyle Hidden erzeugt
       * eine echte, aber unsichtbare Konsole. Damit funktioniert der
       * Ctrl+C-Shutdown (AttachConsole) unveraendert, waehrend der Nutzer
       * kein externes Fenster mehr sieht.
       *
       * Pfade koennen Leerzeichen enthalten - deshalb einfache
       * PowerShell-Quotes und verdoppelte innere Quotes.
       */
      const quote = s => `'${String(s).replace(/'/g, "''")}'`
      const ps = `$ErrorActionPreference='Stop'; $p = Start-Process -FilePath ${quote(exe)} -WorkingDirectory ${quote(cwd)} -WindowStyle Hidden -PassThru; $p.Id`
      const starter = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let psOut = ''
      let psErr = ''
      starter.stdout.on('data', d => { psOut += d.toString() })
      starter.stderr.on('data', d => { psErr += d.toString() })
      await new Promise(resolve => starter.on('close', resolve))
      let pid = Number(String(psOut).trim().split(/\r?\n/).pop()) || null
      if (psErr.trim()) {
        send('server:log', { kind, stream: 'system', line: `Starter-Meldung: ${psErr.trim().split(/\r?\n/).slice(-2).join(' ')}` })
      }

      // Fallback, falls PowerShell keine PID liefert (z. B. aeltere Version)
      if (!pid) {
        for (let i = 0; i < 25 && !pid; i++) {
          await new Promise(r => setTimeout(r, 300))
          const found = pidsOf(IMAGE[kind]).filter(p => !before.has(p))
          if (found.length) pid = found[0]
        }
      }

      /*
       * Ohne PID gibt es zwei Moeglichkeiten: der Prozess starb bereits
       * wieder (Authserver mit unloesbarer Realm-Adresse beendet sich
       * sofort), oder er ist nicht mehr auffindbar. Beides heisst:
       * "running = true, pid = null" wuerde fuer immer haengen - jeder
       * weitere Start bricht mit "laeuft bereits (PID null)" ab, und der
       * Beobachter unten kann ohne PID nie den Status zuruecksetzen.
       */
      if (!pid) {
        procs[kind].running = false
        procs[kind].phase = 'stopped'
        procs[kind].pid = null
        send('server:status', statusAll())
        send('server:log', {
          kind,
          stream: 'system',
          line: `<<< ${KIND_LABEL[kind]} wurde nicht gestartet - der Prozess beendete sich sofort (siehe Serverlog)`
        })
        return { ok: false, error: `${KIND_LABEL[kind]} beendete sich sofort nach dem Start. Details im Serverlog.` }
      }

      procs[kind].child = null
      procs[kind].pid = pid
      procs[kind].running = true
      procs[kind].phase = 'starting'
      procs[kind].manuell = false
      // Keine echte Startzeit bekannt - der Prozess stammt aus dieser
      // Direkt-Start-Variante (unsichtbare Konsole), wir sehen nur die PID.
      procs[kind].seit = null
      stabilSeit[kind] = Date.now()

      send('server:log', {
        kind,
        stream: 'system',
        line: `>>> ${KIND_LABEL[kind]} gestartet (PID ${pid || 'unbekannt'}) in ${cwd} · unsichtbare Konsole`
      })
      firewallHinweis(kind, port)

      /*
       * Der Logpfad darf beim Start noch gar nicht existieren: mit
       * Zeitstempel-Appender legt der Server die Datei erst jetzt an.
       * tailLog sucht von allein weiter, deshalb ist eine fehlende Datei
       * kein Fehler, sondern nur ein noch leeres Log.
       */
      const logFile = logPathFor(kind)
      procs[kind].tail = tailLog(kind, logFile, true)
      send('server:log', {
        kind,
        stream: 'system',
        line: logFile
          ? `>>> Ausgabe wird aus ${logFile} gelesen`
          : '>>> Logdatei wird gesucht - sie entsteht beim Start des Servers'
      })

      // ueberwachen, ob der Prozess von selbst endet
      const watch = setInterval(() => {
        merkeStabil(kind)
        if (pid && !pidsOf(IMAGE[kind]).includes(pid)) {
          clearInterval(watch)
          procs[kind].running = false
          procs[kind].phase = 'stopped'
          procs[kind].pid = null
          if (procs[kind].bereitTimer) {
            clearInterval(procs[kind].bereitTimer)
            procs[kind].bereitTimer = null
          }
          stabilSeit[kind] = null
          if (procs[kind].tail) {
            clearInterval(procs[kind].tail)
            procs[kind].tail = null
          }
          send('server:log', { kind, stream: 'system', line: `<<< ${KIND_LABEL[kind]} beendet` })
          send('server:status', statusAll())
          if (!procs[kind].manuell) merkeEreignis(kind, 'crash', 'Prozess unerwartet beendet')
          procs[kind].manuell = false
          planeWiederanlauf(kind)
        }
      }, 2000)
      if (watch.unref) watch.unref()
      procs[kind].watch = watch

      send('server:status', statusAll())
      warteAufBereitschaft(kind, port)
      merkeEreignis(kind, 'start', `gestartet (PID ${pid})`)
      if (kind === 'db') datenbankGestartet()
      return { ok: true, pid }
    }

    const child = spawn(command, commandArgs, {
      cwd,
      /*
       * detached:true gibt dem Prozess auf Windows eine eigene Konsole.
       * Seit Windows 11 ist Windows Terminal der Standard-Host - dann geht
       * ein leeres Konsolenfenster auf, obwohl windowsHide gesetzt ist.
       * mysqld braucht das nicht: das Panel beendet die Datenbank beim
       * Schließen ohnehin selbst. Nur Batch-Dateien bleiben detached.
       */
      detached: kind !== 'db',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    procs[kind].child = child
    procs[kind].pid = child.pid
    procs[kind].running = true
    procs[kind].phase = 'starting'
    procs[kind].manuell = false
    procs[kind].seit = new Date().toISOString()
    stabilSeit[kind] = Date.now()
    // Neuer Worldserver liest die Konfiguration -> "Neustart ausstehend" erledigt
    if (kind === 'world') {
      try { store.write({ restartNoetig: false }) } catch (_) {}
    }

    const argTxt = commandArgs.length ? ` ${commandArgs.join(' ')}` : ''
    send('server:log', {
      kind,
      stream: 'system',
      line: `>>> ${KIND_LABEL[kind]} gestartet (PID ${child.pid}) in ${cwd}${argTxt}`
    })
    firewallHinweis(kind, port)

    const attach = (stream, name) => {
      let buffer = ''
      stream.on('data', chunk => {
        buffer += decodeChunk(chunk)
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop()
        for (const line of lines) {
          send('server:log', { kind, stream: name, line })
        }
      })
    }
    attach(child.stdout, 'stdout')
    attach(child.stderr, 'stderr')

    // mysqld protokolliert in die angegebene Datei -> mitlesen
    if (kind === 'db') {
      const ms = (store.read().server || {}).mysqlServer || {}
      if (ms.dataDir) {
        const errFile = path.join(ms.dataDir, 'wowpanel-mysql.err')
        setTimeout(() => {
          procs[kind].tail = tailLog(kind, errFile, true)
          if (procs[kind].tail) {
            send('server:log', { kind, stream: 'system', line: `>>> Ausgabe wird aus ${errFile} gelesen` })
          }
        }, 2500)
      }
    }

    child.on('error', err => {
      send('server:log', { kind, stream: 'system', line: `Fehler: ${err.message}` })
      procs[kind].running = false
      procs[kind].phase = 'stopped'
      procs[kind].pid = null
      procs[kind].child = null
      if (procs[kind].bereitTimer) {
        clearInterval(procs[kind].bereitTimer)
        procs[kind].bereitTimer = null
      }
      if (!procs[kind].manuell) merkeEreignis(kind, 'crash', err.message)
      procs[kind].manuell = false
      send('server:status', statusAll())
    })

    child.on('exit', (code, signal) => {
      procs[kind].running = false
      procs[kind].phase = 'stopped'
      procs[kind].pid = null
      procs[kind].child = null
      if (procs[kind].bereitTimer) {
        clearInterval(procs[kind].bereitTimer)
        procs[kind].bereitTimer = null
      }
      stabilSeit[kind] = null
      if (!procs[kind].manuell) {
        merkeEreignis(kind, code === 0 ? 'exit' : 'crash', `beendet (Code ${code})`)
      }
      procs[kind].manuell = false
      send('server:log', {
        kind,
        stream: 'system',
        line: `<<< ${KIND_LABEL[kind]} beendet (code=${code}, signal=${signal})`
      })
      send('server:status', statusAll())
      planeWiederanlauf(kind)
    })

    send('server:status', statusAll())
    warteAufBereitschaft(kind, port)
    merkeEreignis(kind, 'start', `gestartet (PID ${child.pid})`)
    if (kind === 'db') datenbankGestartet()
    return { ok: true, pid: child.pid }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/*
 * Der Sicherungszeitplan wurde bisher nur einmal beim Programmstart
 * angelegt - und das nur, wenn die Datenbank schon lief. Startet der Nutzer
 * die Datenbank spaeter (frisch installiert, nach Update, aus Versehen
 * beendet), blieb der Zeitplan fuer die ganze Sitzung aus. Jetzt legt jede
 * erfolgreiche Datenbank-Start ihn an; planStarten ist idempotent.
 */
function datenbankGestartet () {
  try { require('./api/backup').planStarten() } catch (_) {}
}

/* ------------------------------------------------------- Prozess-Metriken */

let metrikenZwischenspeicher = { zeit: 0, werte: {} }

/*
 * RAM und CPU-Zeit der drei Prozesse. Ein PowerShell-Aufruf fuer alle
 * zusammen; Ergebnisse werden max. 5 s wiederverwendet, damit Statuspolls
 * in der Oberflaeche nicht Dutzende Prozesse pro Minute anwerfen.
 */
async function metriken () {
  if (Date.now() - metrikenZwischenspeicher.zeit < 5000) {
    return metrikenZwischenspeicher.werte
  }
  const pids = []
  for (const kind of ['world', 'auth', 'db']) {
    pruefeUebernahme(kind, false)
    if (procs[kind].running && procs[kind].pid) pids.push(procs[kind].pid)
  }
  const leer = { world: null, auth: null, db: null }
  if (!pids.length) {
    metrikenZwischenspeicher = { zeit: Date.now(), werte: leer }
    return leer
  }
  try {
    const out = await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command',
          `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WS,CPU,StartTime | ConvertTo-Json -Compress`],
        { timeout: 10000, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout || '')))
      )
    })
    const liste = JSON.parse(out || '[]')
    const eintraege = Array.isArray(liste) ? liste : [liste]
    const werte = { world: null, auth: null, db: null }
    for (const e of eintraege) {
      if (!e || !e.Id) continue
      for (const kind of ['world', 'auth', 'db']) {
        if (procs[kind].pid === e.Id) {
          let seitMs = null
          if (e.StartTime) {
            const t = new Date(e.StartTime)
            if (!isNaN(t.getTime())) seitMs = t.getTime()
          }
          werte[kind] = {
            pid: e.Id,
            ramMb: Math.round((e.WS || 0) / 1024 / 1024),
            cpuSek: Number((e.CPU || 0).toFixed(1)),
            seitMs
          }
        }
      }
    }
    metrikenZwischenspeicher = { zeit: Date.now(), werte }
    return werte
  } catch (_) {
    return leer
  }
}

/*
 * MySQL 8.4 startet auf Windows einen Kindprozess: der eigentliche Server
 * laeuft im Kind, waehrend das Panel den Elternprozess gestartet hat. Ein
 * Stop des Elternprozesses laesst das Kind (und Port 3306) weiterlaufen.
 * Deshalb wird die Datenbank ueber "mysqladmin shutdown" beendet - das
 * trifft den Server selbst - mit taskkill als Rueckfall.
 */
function mysqlAdminExe () {
  try {
    const exe = exeFor('db')
    if (!exe) return null
    const p = path.join(path.dirname(exe), 'mysqladmin.exe')
    return fs.existsSync(p) ? p : null
  } catch (_) {
    return null
  }
}

function mysqlAdminArgs () {
  const cfg = store.read().mysql || {}
  return [
    `--host=${cfg.host || '127.0.0.1'}`,
    `--port=${Number(cfg.port) || 3306}`,
    `--user=${cfg.user || 'root'}`,
    `--password=${cfg.password || ''}`,
    'shutdown'
  ]
}

async function datenbankBeenden (pid) {
  const port = portFuer('db')
  const admin = mysqlAdminExe()
  let fehler = ''
  if (admin) {
    await new Promise(resolve => {
      execFile(admin, mysqlAdminArgs(), { timeout: 45000, windowsHide: true }, err => {
        if (err) fehler = err.message
        resolve()
      })
    })
  } else {
    fehler = 'mysqladmin.exe nicht gefunden.'
  }
  for (let i = 0; i < 20; i++) {
    if (!port || !(await portBelegt(port))) break
    await new Promise(r => setTimeout(r, 500))
  }
  const nochOffen = port ? await portBelegt(port) : false
  if (nochOffen) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 })
    } catch (_) {}
    const besitzer = port ? portBesitzer(port) : null
    if (besitzer && besitzer.pid && besitzer.pid !== pid) {
      try {
        execFileSync('taskkill', ['/PID', String(besitzer.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 })
      } catch (_) {}
    }
  }
  return { ok: !nochOffen, fehler }
}

function stop (kind) {
  if (!procs[kind].running || !procs[kind].pid) {
    // Trotzdem nachschauen: der Prozess koennte vom Panel uebernommen
    // werden koennen (z. B. frisch gestarteter Server ohne Statuspoll).
    pruefeUebernahme(kind, true)
    if (!procs[kind].running || !procs[kind].pid) {
      return { ok: false, error: `${KIND_LABEL[kind]} laeuft nicht.` }
    }
  }
  // Manuell beendet - der Wiederanlauf darf hier nicht anspringen.
  autoRestartGestoppt[kind] = Date.now()
  stabilSeit[kind] = null
  const pid = procs[kind].pid

  // Tail und Beobachter beenden
  if (procs[kind].tail) {
    clearInterval(procs[kind].tail)
    procs[kind].tail = null
  }
  if (procs[kind].watch) {
    clearInterval(procs[kind].watch)
    procs[kind].watch = null
  }

  // Wichtig: Zustand zuruecksetzen. Bei world/auth gibt es keinen
  // exit-Handler wie bei Pipes - ohne das bliebe "running" dauerhaft true
  // und jeder weitere Start wuerde mit "laeuft bereits" abgelehnt.
  procs[kind].running = false
  procs[kind].phase = 'stopped'
  procs[kind].pid = null
  procs[kind].manuell = true
  merkeEreignis(kind, 'stop', 'manuell beendet')
  if (procs[kind].bereitTimer) {
    clearInterval(procs[kind].bereitTimer)
    procs[kind].bereitTimer = null
  }
  if (procs[kind].child) {
    procs[kind].child = null
  }

  send('server:log', { kind, stream: 'system', line: `>>> ${KIND_LABEL[kind]} wird beendet (PID ${pid})` })
  send('server:status', statusAll())

  // Graceful shutdown: CTRL+C an die Prozesskonsole schicken.
  // Bei world/auth ist die Konsole echt, aber unsichtbar gestartet -
  // AttachConsole findet sie damit zuverlaessig. Die Datenbank hat einen
  // Eltern-/Kindprozess und wird ueber mysqladmin beendet.
  if (kind === 'db') {
    datenbankBeenden(pid).then(r => {
      send('server:log', {
        kind,
        stream: 'system',
        line: r.ok
          ? '>>> Datenbank beendet.'
          : `>>> Datenbank konnte nicht sauber beendet werden${r.fehler ? `: ${r.fehler}` : ''}.`
      })
    }).catch(() => {})
    return { ok: true, pid }
  }

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', GRACEFUL_SCRIPT, '-ProcessId', String(pid)],
    { timeout: 60000 },
    (err) => {
      if (err) {
        // Notausstieg
        try {
          process.kill(pid, 'SIGTERM')
        } catch (_) {}
      }
    }
  )

  return { ok: true, pid }
}

async function restart (kind) {
  if (procs[kind].running) {
    stop(kind)
    // auf das exit-Event warten
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (!procs[kind].running) {
          clearInterval(check)
          resolve()
        }
      }, 400)
      setTimeout(() => {
        clearInterval(check)
        resolve()
      }, 45000)
    })
  }
  return start(kind)
}

function clearLogs (kind) {
  send('server:log', { kind, stream: 'system', line: '--- Log geleert ---', clear: true })
}

function shutdownAll () {
  for (const kind of ['world', 'auth', 'db']) {
    // Panel-Ende ist ein manueller Stop: kein Auto-Restart danach.
    autoRestartGestoppt[kind] = Date.now()
    // Tail/Beobachter aufraeumen
    if (procs[kind].tail) {
      clearInterval(procs[kind].tail)
      procs[kind].tail = null
    }
    if (procs[kind].watch) {
      clearInterval(procs[kind].watch)
      procs[kind].watch = null
    }
    if (procs[kind].bereitTimer) {
      clearInterval(procs[kind].bereitTimer)
      procs[kind].bereitTimer = null
    }
    procs[kind].phase = 'stopped'
    if (procs[kind].running && procs[kind].pid) {
      if (kind === 'db') {
        /*
         * Beim Beenden des Panels bleibt keine Zeit fuer einen asynchronen
         * Stop: mysqladmin blockiert kurz (Sekunden), danach wird der
         * Prozessbaum als Rueckfall beendet. So laeuft MySQL nicht weiter,
         * waehrend das Panel schon weg ist.
         */
        const admin = mysqlAdminExe()
        try {
          if (admin) execFileSync(admin, mysqlAdminArgs(), { timeout: 25000, windowsHide: true, stdio: 'ignore' })
        } catch (_) {}
        try {
          execFileSync('taskkill', ['/PID', String(procs[kind].pid), '/T', '/F'], { windowsHide: true, timeout: 10000 })
        } catch (_) {}
      } else {
        try {
          execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', GRACEFUL_SCRIPT, '-ProcessId', String(procs[kind].pid)],
            { timeout: 20000 }
          )
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  init,
  start,
  stop,
  restart,
  status: statusAll,
  clearLogs,
  shutdownAll,
  setzeUebernahme,
  setzePortPruefung,
  metriken,
  logDatei,
  logDateien,
  portBesitzer,
  ereignisse,
  waechterEinstellungen,
  waechterSetzen,
  // Fuer die Pruefskripte: sonst laesst sich das Aufloesen des Logpfads
  // und das Nachsuchen nach einer erst spaeter entstehenden Datei nicht
  // gegen echte Installationen testen.
  __intern: { logPathFor, findLogFile, appenderNameFor, tailLog, cwdFor }
}