'use strict'

const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const path = require('path')
const net = require('net')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const mysql = require('mysql2/promise')
const store = require('../store')
const serverManager = require('../server-manager')

/*
 * Automatische Einrichtung eines AzerothCore-Servers aus den Originalquellen.
 *
 * Der Ablauf entspricht dem Ein-Klick-Installer des ersten Projekts, ist aber
 * kein Repack-Erkenner: es wird ausschliesslich das offizielle Repository
 * geklont, mit Visual Studio gebaut und die Datenbank aus den mitgelieferten
 * SQL-Dateien aufgebaut. MySQL liegt dabei portabel im Serverordner.
 *
 * Die Schritte sind bewusst wiederholbar. Bricht der Rechner mitten im Build
 * ab, kann derselbe Ordner erneut gestartet werden: vorhandene Quellen werden
 * aktualisiert, bereits entpackte Werkzeuge weiterverwendet und ein fertiger
 * Build nicht sinnlos neu uebersetzt.
 */

const QUELLE = 'https://github.com/azerothcore/azerothcore-wotlk.git'
const QUELLE_BRANCH = 'master'
const BOOST_VERSION = '1.87.0'
const BOOST_TOOLSET = '14.3'
const VS_GENERATOR = 'NMake Makefiles'
const BUILD_CONFIG = 'RelWithDebInfo'
const MYSQL_FALLBACK = ['8.4.6', '8.4.5', '8.4.4', '8.4.3']
const MYSQL_MAJOR = '8.4'
const DB_USER = 'acore'
const DB = {
  auth: 'acore_auth',
  chars: 'acore_characters',
  world: 'acore_world'
}
const SOAP_STANDARD_PORT = 7878
const SOAP_USER = 'SOAP'
const SOAP_GMLEVEL = 3
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const STEPS = [
  { key: 'vorbereiten', weight: 2, run: schrittVorbereiten },
  { key: 'werkzeuge', weight: 18, run: schrittWerkzeuge },
  { key: 'mysql', weight: 15, run: schrittMySql },
  { key: 'quelle', weight: 15, run: schrittQuelle },
  { key: 'playerbots', weight: 4, run: schrittPlayerbots },
  { key: 'konfigurieren', weight: 5, run: schrittKonfigurieren },
  { key: 'bauen', weight: 30, run: schrittBauen },
  { key: 'daten', weight: 8, run: schrittDaten },
  { key: 'datenbank', weight: 5, run: schrittDatenbank },
  { key: 'selbsttest', weight: 2, run: schrittSelbsttest },
  { key: 'fertig', weight: 2, run: schrittFertig }
]
const GESAMT_GEWICHT = STEPS.reduce((sum, s) => sum + s.weight, 0)

let win = null
let lauf = null
let startLaeuft = false

function init (storeRef, windowRef) {
  // storeRef wird nur fuer die Routen benoetigt; die Modulreferenz bleibt
  // trotzdem in der Signatur, damit sich installer wie die anderen API-Module
  // initialisieren laesst.
  win = windowRef
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function istAbgebrochen (err) {
  return err && (err.abgebrochen || err.code === 'ABBRUCH')
}

function abbruchFehler () {
  const err = new Error('Installation abgebrochen.')
  err.abgebrochen = true
  return err
}

function normalisiereRoot (root) {
  let r = String(root || '').trim()
  if ((r.startsWith('"') && r.endsWith('"')) || (r.startsWith("'") && r.endsWith("'"))) {
    r = r.slice(1, -1)
  }
  if (!r) return path.join(os.homedir(), 'AzerothCore')
  if (r === '~') return os.homedir()
  if (r.startsWith('~\\') || r.startsWith('~/')) return path.join(os.homedir(), r.slice(2))
  return path.resolve(r)
}

function pfade (root) {
  const wurzel = normalisiereRoot(root)
  const build = path.join(wurzel, 'build')
  const bin = path.join(build, 'bin', BUILD_CONFIG)
  return {
    root: wurzel,
    source: path.join(wurzel, 'source'),
    modules: path.join(wurzel, 'source', 'modules'),
    build,
    bin,
    configs: path.join(bin, 'configs'),
    modConfigs: path.join(bin, 'configs', 'modules'),
    data: path.join(wurzel, 'data'),
    mysql: path.join(wurzel, 'mysql'),
    mysqlData: path.join(wurzel, 'mysql', 'data'),
    myIni: path.join(wurzel, 'mysql', 'my.ini'),
    clientCnf: path.join(wurzel, 'mysql', 'client.cnf'),
    deps: path.join(wurzel, 'deps'),
    downloads: path.join(wurzel, 'deps', 'downloads'),
    logs: path.join(wurzel, 'logs'),
    zustand: path.join(wurzel, 'install-state.json')
  }
}

function exists (p) {
  try {
    return fs.existsSync(p)
  } catch (_) {
    return false
  }
}

function istDatei (p) {
  try {
    return fs.statSync(p).isFile()
  } catch (_) {
    return false
  }
}

function istOrdner (p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch (_) {
    return false
  }
}

async function dateiGroesse (p) {
  try {
    return (await fsp.stat(p)).size
  } catch (_) {
    return 0
  }
}

function slash (p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function psQuote (p) {
  return String(p || '').replace(/'/g, "''")
}

function zufallspasswort (laenge = 20) {
  const zeichen = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = require('crypto').randomBytes(laenge)
  let out = ''
  for (const b of bytes) out += zeichen[b % zeichen.length]
  return out
}

function zeitstempel () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function leseZustand (root) {
  try {
    const datei = pfade(root).zustand
    if (!exists(datei)) return null
    return JSON.parse(fs.readFileSync(datei, 'utf8'))
  } catch (_) {
    return null
  }
}

/*
 * Die SOAP-Zugangsdaten gehoeren zum Server, nicht zur Installation: bei einem
 * zweiten Lauf werden Benutzer, Passwort und Port aus install-state.json
 * uebernommen. Sonst waere nach einem Abbruch das bereits angelegte Konto
 * unbrauchbar, weil das Panel ein neues Passwort erwartet.
 *
 * WICHTIG: Der Core begrenzt Passwoerter auf MAX_PASS_STR = 16 Zeichen
 * (AccountMgr.cpp prueft utf8length(password) > MAX_PASS_STR und wirft dann
 * die Anmeldung weg). Ein 20-Zeichen-Passwort fuehrt dazu, dass die Konsole
 * immer mit 401 Unauthorized abweist - deshalb genau 16 Zeichen.
 */

function soapZugangAusZustand (zustand) {
  const alt = zustand && zustand.soap && typeof zustand.soap === 'object' ? zustand.soap : {}
  let password = String(alt.password || zufallspasswort(16))
  /*
   * Ein Passwort aus einer alten Einrichtung kann laenger als 16 Zeichen
   * sein - der Core lehnt es dann bei jeder SOAP-Anmeldung ab (401). In dem
   * Fall wird es hier ueberschrieben; soapKontoAnlegen schreibt danach den
   * passenden Verifier in die Datenbank.
   */
  if (password.length > 16) password = zufallspasswort(16)
  return {
    enabled: true,
    host: '127.0.0.1',
    port: Number(alt.port) || SOAP_STANDARD_PORT,
    user: String(alt.user || SOAP_USER),
    password
  }
}

function schreibeZustand (root, daten) {
  try {
    const p = pfade(root)
    if (!exists(p.root)) return
    fs.writeFileSync(p.zustand, JSON.stringify(daten, null, 2), 'utf8')
  } catch (e) {
    if (lauf) protokoll(`Zustand konnte nicht gespeichert werden: ${e.message}`, 'WARN')
  }
}

function oeffentlicheOptionen (opts) {
  return {
    root: opts.root,
    mysqlPort: opts.mysqlPort,
    buildProfile: opts.buildProfile,
    downloadClientData: opts.downloadClientData,
    autoInstallTools: opts.autoInstallTools,
    realmName: opts.realmName,
    branch: opts.branch,
    playerbots: opts.playerbots === true
  }
}

function protokoll (zeile, level = 'INFO') {
  if (!lauf) {
    console.log(`[installer] ${zeile}`)
    return
  }
  const text = `[${new Date().toLocaleTimeString('de-DE', { hour12: false })}] [${level}] ${zeile}`
  lauf.log.push(text)
  if (lauf.log.length > 6000) lauf.log.splice(0, lauf.log.length - 6000)
  if (lauf.logDatei) {
    try {
      fs.appendFileSync(lauf.logDatei, text + '\r\n', 'utf8')
    } catch (_) {}
  }

  /*
   * Beim Übersetzen gibt CMake pro Ziel "[ 45%] ..." aus. Aus diesen Zeilen
   * den echten Fortschritt ableiten: ohne das stand die Anzeige waehrend des
   * langsamen Builds minutenlang still, obwohl der Compiler arbeitete.
   */
  const m = /^\[\s*(\d+)%\]/.exec(zeile)
  if (m && lauf.running && lauf.stepKey === 'bauen') {
    const liste = aktiveSchritte()
    const idx = liste.findIndex(s => s.key === 'bauen')
    if (idx >= 0) {
      const basis = prozentBasis(idx)
      const gewicht = Number(liste[idx].weight) || 1
      const neu = Math.min(99, basis + Math.round((Number(m[1]) / 100) * gewicht))
      if (neu > lauf.percent) {
        lauf.percent = neu
        emit({ type: 'status', status: kurzStatus() })
      }
    }
  }

  emit({ type: 'log', line: text, level })
}

function emit (event) {
  if (!event) return
  if (event.type !== 'log') event.status = kurzStatus()
  // Fallback: falls init() nicht aufgerufen wurde oder win verloren ging,
  // das erste offene Fenster verwenden.
  let ziel = win
  if (!ziel || ziel.isDestroyed()) {
    const { BrowserWindow } = require('electron')
    const fenster = BrowserWindow.getAllWindows()
    ziel = fenster.length ? fenster[0] : null
  }
  if (ziel && !ziel.isDestroyed() && ziel.webContents) {
    ziel.webContents.send('installer:progress', event)
  }
}

function kurzStatus () {
  if (!lauf) {
    return {
      running: false,
      root: '',
      stepIndex: -1,
      stepKey: '',
      percent: 0,
      steps: STEPS.map(s => ({ key: s.key, state: 'pending' })),
      logDatei: ''
    }
  }
  return {
    running: lauf.running,
    root: lauf.root,
    stepIndex: lauf.stepIndex,
    stepKey: lauf.stepKey || '',
    percent: lauf.percent || 0,
    startedAt: lauf.startedAt,
    finishedAt: lauf.finishedAt,
    error: lauf.error || '',
    abgebrochen: !!lauf.abgebrochen,
    steps: lauf.steps.map(s => ({ key: s.key, state: s.state })),
    logDatei: lauf.logDatei || ''
  }
}

function status () {
  if (!lauf) {
    return { ...kurzStatus(), log: [] }
  }
  return { ...kurzStatus(), log: lauf.log.slice(-800) }
}

function aktiveSchritte () {
  // Beim Update laeuft eine kuerzere Schrittliste als bei der Installation.
  // Ohne diese Unterscheidung wuerde der Fortschritt gegen die falschen
  // Gewichte und Schluessel gerechnet.
  return (lauf && Array.isArray(lauf.schritte)) ? lauf.schritte : STEPS
}

function prozentBasis (index) {
  const liste = aktiveSchritte()
  const gesamt = liste.reduce((sum, s) => sum + (Number(s.weight) || 1), 0) || 1
  let sum = 0
  for (let i = 0; i < index; i++) sum += (Number(liste[i] && liste[i].weight) || 1)
  return Math.round((sum / gesamt) * 100)
}

function setzeSchritt (index, zustand, text) {
  if (!lauf) return
  const liste = aktiveSchritte()
  lauf.stepIndex = index
  lauf.stepKey = liste[index] ? liste[index].key : (lauf.stepKey || '')
  if (lauf.steps[index]) lauf.steps[index].state = zustand
  if (zustand === 'running') lauf.percent = prozentBasis(index)
  if (zustand === 'ok' || zustand === 'skip') {
    const gesamt = liste.reduce((sum, s) => sum + (Number(s.weight) || 1), 0) || 1
    let sum = 0
    for (let i = 0; i <= index; i++) sum += (Number(liste[i] && liste[i].weight) || 1)
    lauf.percent = Math.round((sum / gesamt) * 100)
  }
  if (zustand === 'fail') lauf.percent = prozentBasis(index)
  if (text) protokoll(text, zustand === 'fail' ? 'ERROR' : 'STEP')
  emit({
    type: 'step',
    index,
    key: lauf.stepKey,
    state: zustand,
    percent: lauf.percent,
    message: text || ''
  })
}

function checkAbort () {
  if (lauf && lauf.cancelled) throw abbruchFehler()
}

function dekodiere (buf) {
  const text = buf.toString('utf8')
  if (!text.includes('\uFFFD')) return text
  return buf.toString('latin1')
}

function killTree (pid) {
  if (!pid) return
  try {
    spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } catch (_) {}
}

/*
 * Startet ein Programm und leitet beide Ausgabestroeme zeilenweise ins
 * Protokoll. Die Oberflaeche bleibt waehrenddessen bedienbar, weil der Aufruf
 * als Promise im Hintergrund laeuft.
 */
function run (datei, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (lauf && lauf.cancelled) return reject(abbruchFehler())

    let child
    try {
      child = spawn(datei, args || [], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env || {}) },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      return reject(e)
    }

    if (lauf) lauf.child = child
    let out = ''
    let err = ''
    const rest = { out: '', err: '' }

    const verarbeite = (data, istFehler) => {
      const text = dekodiere(data)
      if (istFehler) err += text
      else out += text
      const key = istFehler ? 'err' : 'out'
      rest[key] += text
      const teile = rest[key].split(/\r?\n|\r/)
      rest[key] = teile.pop()
      for (const zeile of teile) {
        const t = zeile.trimEnd()
        if (t) {
          protokoll(t, istFehler ? 'ERR' : 'OUT')
          /*
           * Zusaetzlicher Zeilen-Zuhörer (Fortschritt): zählt z. B. die
           * "Applying"-Zeilen des dbimport und bewegt die Prozentzahl.
           */
          if (opts.proZeile) { try { opts.proZeile(t, istFehler) } catch (_) {} }
        }
      }
    }

    child.stdout.on('data', d => verarbeite(d, false))
    child.stderr.on('data', d => verarbeite(d, true))

    let timer = null
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        killTree(child.pid)
        const e = new Error(`Zeitüberschreitung bei ${path.basename(datei)}`)
        e.zeit = true
        reject(e)
      }, opts.timeoutMs)
      if (timer.unref) timer.unref()
    }

    const abschluss = code => {
      if (timer) clearTimeout(timer)
      if (lauf && lauf.child === child) lauf.child = null
      for (const key of ['out', 'err']) {
        const text = rest[key].trim()
        if (text) protokoll(text, key === 'err' ? 'ERR' : 'OUT')
      }
      if (lauf && lauf.cancelled) return reject(abbruchFehler())
      if (code !== 0 && !opts.allowFail) {
        const letzte = (err || out).trim().split(/\r?\n/).slice(-12).join('\n')
        return reject(
          new Error(
            `${path.basename(datei)} endete mit Code ${code}.` +
              (letzte ? `\n${letzte}` : '')
          )
        )
      }
      resolve({ code, out: out.trim(), err: err.trim() })
    }

    child.once('error', e => {
      if (timer) clearTimeout(timer)
      if (lauf && lauf.child === child) lauf.child = null
      reject(e)
    })
    child.once('close', abschluss)
  })
}

// Wie run(), sammelt aber nur die Ausgabe fuer Pruefungen (kein Log).
function execCapture (datei, args, opts = {}) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(datei, args || [], {
        cwd: opts.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      return resolve({ ok: false, code: -1, out: '', err: e.message })
    }

    let out = ''
    let err = ''
    let fertig = false
    const beenden = ergebnis => {
      if (fertig) return
      fertig = true
      clearTimeout(timer)
      resolve(ergebnis)
    }
    const timer = setTimeout(() => {
      killTree(child.pid)
      beenden({ ok: false, code: -1, out: out.trim(), err: 'Zeitüberschreitung' })
    }, opts.timeoutMs || 12000)
    if (timer.unref) timer.unref()

    child.stdout.on('data', d => { out += dekodiere(d) })
    child.stderr.on('data', d => { err += dekodiere(d) })
    child.once('error', e => beenden({ ok: false, code: -1, out: out.trim(), err: e.message }))
    child.once('close', code => beenden({ ok: code === 0, code, out: out.trim(), err: err.trim() }))
  })
}

/* ---------------------------------------------------------------- Netz */

function hole (url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = String(url).startsWith('https:') ? https : http
    const req = mod.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          ...(opts.headers || {})
        }
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          const ziel = new URL(res.headers.location, url).toString()
          return resolve(hole(ziel, opts))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} bei ${url}`))
        }
        let daten = ''
        res.setEncoding('utf8')
        res.on('data', c => { daten += c })
        res.on('end', () => {
          if (!opts.json) return resolve(daten)
          try {
            resolve(JSON.parse(daten))
          } catch (e) {
            reject(new Error(`Antwort von ${url} ist kein JSON: ${e.message}`))
          }
        })
      }
    )
    req.setTimeout(opts.timeoutMs || 30000, () => req.destroy(new Error('Zeitüberschreitung')))
    req.on('error', reject)
  })
}

function downloadOne (url, ziel, beschreibung, timeoutMs = 0, bereich = null) {
  return new Promise((resolve, reject) => {
    const mod = String(url).startsWith('https:') ? https : http

    /*
     * Fortsetzbarer Download: Eine vorhandene .part-Datei wird mit einem
     * Range-Header weiterverwendet. Ein Seitenhändler (.url) merkt sich,
     * zu welcher URL die Teildatei gehört - eine andere URL auf dieselbe
     * .part zu legen würde bytegemischten Müll erzeugen. Server, die
     * Range ignorieren (200 statt 206), werden mit Neustart bei null
     * beantwortet; 416 heißt: Die Teildatei ist stale - weg damit.
     */
    const sidecar = ziel + '.url'
    let fortsetzen = 0
    if (bereich === null) {
      try { fortsetzen = fs.existsSync(ziel) ? fs.statSync(ziel).size : 0 } catch (_) { fortsetzen = 0 }
      try {
        const gemerkt = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, 'utf8').trim() : ''
        if (fortsetzen > 0 && gemerkt && gemerkt !== url) {
          fs.rmSync(ziel, { force: true })
          fs.rmSync(sidecar, { force: true })
          fortsetzen = 0
        }
      } catch (_) {}
    } else {
      fortsetzen = bereich
    }

    const headers = Object.assign(
      {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
      },
      /mysql\.com/i.test(url)
        ? { Referer: 'https://dev.mysql.com/downloads/mysql/' }
        : {},
      fortsetzen > 0 ? { Range: `bytes=${fortsetzen}-` } : {}
    )
    // Merken, zu welcher URL die Teildatei gehört (auch nach Redirect-Hop)
    try { fs.writeFileSync(sidecar, url, 'utf8') } catch (_) {}

    const req = mod.get(
      url,
      { headers },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          const weiter = new URL(res.headers.location, url).toString()
          return resolve(downloadOne(weiter, ziel, beschreibung, timeoutMs, fortsetzen))
        }
        if (res.statusCode === 416 && fortsetzen > 0) {
          res.resume()
          try { fs.rmSync(ziel, { force: true }) } catch (_) {}
          return resolve(downloadOne(url, ziel, beschreibung, timeoutMs, 0))
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }

        const teilweise = res.statusCode === 206
        if (!teilweise && fortsetzen > 0) fortsetzen = 0 // Server kennt kein Range
        const cl = Number(res.headers['content-length']) || 0
        const gesamt = teilweise ? fortsetzen + cl : cl
        let gehabt = fortsetzen
        if (fortsetzen > 0) protokoll(`${beschreibung}: setze fort bei ${((fortsetzen / 1024 / 1024).toFixed(1))} MB`)
        let letzteMeldung = 0
        let letzterProzent = -1
        const datei = fs.createWriteStream(ziel, fortsetzen > 0 ? { flags: 'a' } : undefined)
        let abgeschlossen = false

        const fehler = e => {
          if (abgeschlossen) return
          abgeschlossen = true
          try { datei.close() } catch (_) {}
          reject(e)
        }

        res.on('data', chunk => {
          gehabt += chunk.length
          const jetzt = Date.now()
          if (jetzt - letzteMeldung < 1200) return
          letzteMeldung = jetzt
          const prozent = gesamt ? Math.floor((gehabt * 100) / gesamt) : -1
          if (prozent !== letzterProzent || !gesamt) {
            letzterProzent = prozent
            const mb = n => (n / 1024 / 1024).toFixed(1)
            protokoll(
              `${beschreibung}: ${mb(gehabt)} MB` +
                (gesamt ? ` / ${mb(gesamt)} MB (${prozent} %)` : ''),
              'INFO'
            )
          }
        })

        res.on('error', fehler)
        datei.on('error', fehler)
        res.pipe(datei)

        datei.on('finish', () => {
          if (abgeschlossen) return
          abgeschlossen = true
          datei.close(() => {
            if (gesamt && gehabt < gesamt - 1) {
              return reject(new Error(`Download unvollständig (${gehabt} von ${gesamt} Bytes)`))
            }
            try { fs.rmSync(ziel + '.url', { force: true }) } catch (_) {}
            resolve(ziel)
          })
        })

        if (timeoutMs) {
          req.setTimeout(timeoutMs, () => req.destroy(new Error('Zeitüberschreitung beim Download')))
        }
      }
    )
    req.on('error', reject)
  })
}

async function download (urls, ziel, opts = {}) {
  const beschreibung = opts.description || 'Download'
  if (exists(ziel) && (await dateiGroesse(ziel)) > 1024 * 1024) {
    protokoll(`${beschreibung}: bereits vorhanden (${ziel})`)
    return ziel
  }
  await fsp.mkdir(path.dirname(ziel), { recursive: true })
  let letzterFehler = null
  for (const url of urls || []) {
    checkAbort()
    const tmp = ziel + '.part'
    try {
      protokoll(`${beschreibung}: ${url}`)
      await downloadOne(url, tmp, beschreibung, opts.timeoutMs || 0)
      await fsp.rm(ziel, { force: true }).catch(() => {})
      await fsp.rename(tmp, ziel)
      protokoll(`${beschreibung}: fertig (${(await dateiGroesse(ziel) / 1024 / 1024).toFixed(1)} MB)`)
      return ziel
    } catch (e) {
      letzterFehler = e
      /*
       * Die .part-Datei bleibt liegen - der nächste Versuch (auch nach
       * einem Panel-Neustart) setzt per HTTP-Range an derselben Stelle
       * fort. Nur ein URL-Wechsel invalidiert sie (Seitenhändler-Datei).
       */
      protokoll(`${beschreibung}: ${url} fehlgeschlagen (${e.message})`, 'WARN')
    }
  }
  throw new Error(
    `${beschreibung} konnte nicht geladen werden` +
      (letzterFehler ? `: ${letzterFehler.message}` : '.')
  )
}

/* ------------------------------------------------------------- Dateien */

async function verschiebeInhalt (quelle, ziel) {
  await fsp.mkdir(ziel, { recursive: true })
  const eintraege = await fsp.readdir(quelle)
  for (const name of eintraege) {
    const von = path.join(quelle, name)
    const nach = path.join(ziel, name)
    await fsp.rm(nach, { recursive: true, force: true }).catch(() => {})
    try {
      await fsp.rename(von, nach)
    } catch (_) {
      await fsp.cp(von, nach, { recursive: true, force: true })
      await fsp.rm(von, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function entpacke (zip, ziel, opts = {}) {
  checkAbort()
  const tmp = path.join(path.dirname(ziel), `_extract_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  await fsp.mkdir(tmp, { recursive: true })
  try {
    protokoll(`Entpacke ${path.basename(zip)} ...`)
    let ok = false
    // Windows bringt bsdtar mit; das ist deutlich schneller als Expand-Archive.
    const tar = await run('tar.exe', ['-xf', zip, '-C', tmp], {
      allowFail: true,
      timeoutMs: 60 * 60 * 1000
    })
    if (tar.code === 0) {
      ok = true
    } else {
      protokoll('tar konnte das Archiv nicht entpacken - versuche PowerShell.', 'WARN')
      const ps = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Expand-Archive -LiteralPath '${psQuote(zip)}' -DestinationPath '${psQuote(tmp)}' -Force`
        ],
        { timeoutMs: 60 * 60 * 1000 }
      )
      ok = ps.code === 0
    }
    if (!ok) throw new Error('Archiv konnte nicht entpackt werden.')

    let quelle = tmp
    if (opts.stripTopLevel) {
      const eintraege = await fsp.readdir(tmp)
      if (eintraege.length === 1 && istOrdner(path.join(tmp, eintraege[0]))) {
        quelle = path.join(tmp, eintraege[0])
      }
    }
    await verschiebeInhalt(quelle, ziel)
    protokoll(`Entpackt nach ${ziel}`)
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/* --------------------------------------------------------- Werkzeugerkennung */

async function findeGit (root) {
  const r = await execCapture('git.exe', ['--version'], { timeoutMs: 8000 })
  if (r.ok) return 'git.exe'
  const kandidaten = [
    path.join(root, 'deps', 'PortableGit', 'cmd', 'git.exe'),
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe') : ''
  ].filter(Boolean)
  return kandidaten.find(istDatei) || null
}

async function findeCMake (root) {
  const r = await execCapture('cmake.exe', ['--version'], { timeoutMs: 8000 })
  if (r.ok) return 'cmake.exe'
  const kandidaten = [
    path.join(root, 'deps', 'cmake', 'bin', 'cmake.exe'),
    'C:\\Program Files\\CMake\\bin\\cmake.exe',
    'C:\\Program Files (x86)\\CMake\\bin\\cmake.exe'
  ]
  return kandidaten.find(istDatei) || null
}

async function findeWinget () {
  const r = await execCapture('winget.exe', ['--version'], { timeoutMs: 8000 })
  return r.ok ? 'winget.exe' : null
}

async function findeVisualStudio () {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  )
  if (!istDatei(vswhere)) return null
  const r = await execCapture(
    vswhere,
    [
      '-products', '*',
      '-version', '[17.0,18.0)',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
      '-latest'
    ],
    { timeoutMs: 15000 }
  )
  if (!r.ok || !r.out) return null
  return r.out.split(/\r?\n/)[0].trim() || null
}

function opensslGueltig (dir) {
  if (!dir) return false
  return (
    istDatei(path.join(dir, 'include', 'openssl', 'ssl.h')) &&
    istOrdner(path.join(dir, 'lib'))
  )
}

async function findeOpenSsl (root) {
  const kandidaten = [
    path.join(root, 'deps', 'openssl'),
    process.env.OPENSSL_ROOT_DIR,
    process.env.OPENSSL_DIR,
    'C:\\Program Files\\OpenSSL-Win64',
    'C:\\Program Files\\OpenSSL',
    'C:\\OpenSSL-Win64',
    'C:\\Program Files\\FireDaemon OpenSSL 3'
  ].filter(Boolean)
  for (const k of kandidaten) {
    if (opensslGueltig(k)) return k
  }
  return null
}

async function findeBoost (root) {
  const lib = 'lib64-msvc-' + BOOST_TOOLSET
  const boostName = `boost_${BOOST_VERSION.replace(/\./g, '_')}`
  const kandidaten = [
    path.join(root, 'deps', boostName),
    process.env.BOOST_ROOT,
    path.join('C:\\local', boostName)
  ].filter(Boolean)
  for (const k of kandidaten) {
    if (istDatei(path.join(k, 'boost', 'version.hpp')) && istOrdner(path.join(k, lib))) return k
  }
  // Andere Boost-Version, die bereits in C:\local liegt.
  try {
    for (const e of fs.readdirSync('C:\\local', { withFileTypes: true })) {
      if (!e.isDirectory() || !/^boost_/i.test(e.name)) continue
      const dir = path.join('C:\\local', e.name)
      if (istDatei(path.join(dir, 'boost', 'version.hpp')) && istOrdner(path.join(dir, lib))) return dir
    }
  } catch (_) {}
  return null
}

function findeMySql (root) {
  const p = pfade(root)
  return {
    mysqld: path.join(p.mysql, 'bin', 'mysqld.exe'),
    mysql: path.join(p.mysql, 'bin', 'mysql.exe'),
    mysqladmin: path.join(p.mysql, 'bin', 'mysqladmin.exe'),
    lib: path.join(p.mysql, 'lib', 'libmysql.lib'),
    vorhanden: istDatei(path.join(p.mysql, 'bin', 'mysqld.exe'))
  }
}

async function freierPlatz (root) {
  try {
    const p = exists(root) ? root : os.homedir()
    const st = await fsp.statfs(p)
    return Number(st.bavail) * Number(st.bsize)
  } catch (_) {
    return null
  }
}

async function environment (input = {}) {
  const root = normalisiereRoot(input.root)
  const p = pfade(root)
  const [git, cmake, vs, openssl, boost, winget] = await Promise.all([
    findeGit(root),
    findeCMake(root),
    findeVisualStudio(),
    findeOpenSsl(root),
    findeBoost(root),
    findeWinget()
  ])
  const mysqlPfade = findeMySql(root)
  const frei = await freierPlatz(root)
  const zustand = leseZustand(root)
  return {
    ok: true,
    root,
    standardRoot: normalisiereRoot(''),
    pfade: p,
    werkzeuge: {
      git: { ok: !!git, pfad: git || '' },
      cmake: { ok: !!cmake, pfad: cmake || '' },
      vs: { ok: !!vs, pfad: vs || '' },
      openssl: { ok: !!openssl, pfad: openssl || '' },
      boost: { ok: !!boost, pfad: boost || '' },
      winget: { ok: !!winget, pfad: winget || '' }
    },
    mysql: {
      ok: mysqlPfade.vorhanden && istDatei(mysqlPfade.lib),
      mysqld: mysqlPfade.vorhanden ? mysqlPfade.mysqld : '',
      lib: istDatei(mysqlPfade.lib) ? mysqlPfade.lib : '',
      initialisiert: istOrdner(path.join(p.mysqlData, 'mysql'))
    },
    installiert: istDatei(path.join(p.bin, 'worldserver.exe')),
    platz: {
      freiBytes: frei,
      freiGb: frei === null ? null : Math.round((frei / 1024 / 1024 / 1024) * 10) / 10
    },
    zustand: zustand
      ? {
          startedAt: zustand.startedAt || '',
          finishedAt: zustand.finishedAt || '',
          running: !!zustand.running,
          steps: zustand.steps || []
        }
      : null
  }
}

/* --------------------------------------------------------- Werkzeuginstallation */

async function installiereGit (root) {
  const p = pfade(root)
  protokoll('Git fehlt - lade PortableGit herunter ...', 'STEP')
  const release = await hole('https://api.github.com/repos/git-for-windows/git/releases/latest', { json: true })
  const asset = (release.assets || []).find(a => /^PortableGit-.*-64-bit\.7z\.exe$/i.test(a.name))
  if (!asset) throw new Error('Kein PortableGit-Archiv in der aktuellen Git-Version gefunden.')
  const datei = path.join(p.downloads, asset.name)
  await download([asset.browser_download_url], datei, { description: 'PortableGit' })
  const ziel = path.join(p.deps, 'PortableGit')
  await fsp.mkdir(ziel, { recursive: true })
  await run(datei, [`-o${ziel}`, '-y'], { timeoutMs: 20 * 60 * 1000 })
  const git = path.join(ziel, 'cmd', 'git.exe')
  if (!istDatei(git)) throw new Error('PortableGit wurde entpackt, aber git.exe fehlt.')
  return git
}

async function installiereCMake (root) {
  const p = pfade(root)
  protokoll('CMake fehlt - lade die portable Version herunter ...', 'STEP')
  const release = await hole('https://api.github.com/repos/Kitware/CMake/releases/latest', { json: true })
  const asset = (release.assets || []).find(a => /^cmake-.*-windows-x86_64\.zip$/i.test(a.name))
  if (!asset) throw new Error('Kein CMake-Archiv in der aktuellen Version gefunden.')
  const datei = path.join(p.downloads, asset.name)
  await download([asset.browser_download_url], datei, { description: 'CMake' })
  const ziel = path.join(p.deps, 'cmake')
  await entpacke(datei, ziel, { stripTopLevel: true })
  const cmake = path.join(ziel, 'bin', 'cmake.exe')
  if (!istDatei(cmake)) throw new Error('CMake wurde entpackt, aber cmake.exe fehlt.')
  return cmake
}

async function installiereOpenSsl (root) {
  const p = pfade(root)
  protokoll('OpenSSL (Vollversion) fehlt - lade den Installer herunter ...', 'STEP')
  let urls = []
  try {
    const seite = await hole('https://slproweb.com/products/Win32OpenSSL.html')
    for (const m of seite.matchAll(/href="(\/download\/Win64OpenSSL-3_\d+_\d+[a-z]?\.(?:exe|msi))"/gi)) {
      const url = 'https://slproweb.com' + m[1]
      if (!/light/i.test(url) && !urls.includes(url)) urls.push(url)
    }
  } catch (e) {
    protokoll(`OpenSSL-Downloadseite nicht erreichbar: ${e.message}`, 'WARN')
  }
  if (urls.length) {
    const datei = path.join(p.downloads, path.basename(urls[0]))
    try {
      await download(urls, datei, { description: 'OpenSSL' })
      const ziel = path.join(p.deps, 'openssl')
      if (datei.toLowerCase().endsWith('.msi')) {
        await run('msiexec.exe', ['/i', datei, '/qn', `INSTALLDIR=${ziel}`], {
          timeoutMs: 30 * 60 * 1000
        })
      } else {
        await run(
          datei,
          ['/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${ziel}`],
          { timeoutMs: 30 * 60 * 1000 }
        )
      }
      if (opensslGueltig(ziel)) return ziel
    } catch (e) {
      protokoll(`Direkte OpenSSL-Installation fehlgeschlagen: ${e.message}`, 'WARN')
    }
  }

  const winget = await findeWinget()
  if (winget) {
    protokoll('Versuche OpenSSL über winget zu installieren ...', 'WARN')
    await run(
      winget,
      [
        'install', '--id', 'ShiningLight.OpenSSL.Dev', '-e',
        '--silent', '--accept-package-agreements', '--accept-source-agreements',
        '--disable-interactivity'
      ],
      { allowFail: true, timeoutMs: 45 * 60 * 1000 }
    )
    const gefunden = await findeOpenSsl(root)
    if (gefunden) return gefunden
  }
  throw new Error(
    'OpenSSL 3.x (Vollversion, nicht „Light") konnte nicht automatisch installiert werden. ' +
      'Bitte von https://slproweb.com/products/Win32OpenSSL.html installieren.'
  )
}

async function installiereBoost (root) {
  const p = pfade(root)
  const name = `boost_${BOOST_VERSION.replace(/\./g, '_')}_msvc-${BOOST_TOOLSET.replace('.', '_')}_64`
  const dateiName = `boost_${BOOST_VERSION.replace(/\./g, '_')}-msvc-${BOOST_TOOLSET}-64.exe`
  protokoll(`Boost ${BOOST_VERSION} fehlt - lade die vorkompilierte Version herunter ...`, 'STEP')
  const datei = path.join(p.downloads, dateiName)
  await download(
    [
      `https://github.com/userdocs/boost/releases/download/boost-${BOOST_VERSION}/${dateiName}`,
      `https://sourceforge.net/projects/boost/files/boost-binaries/${BOOST_VERSION}/${dateiName}/download`
    ],
    datei,
    { description: `Boost ${BOOST_VERSION}` }
  )
  const ziel = path.join(p.deps, `boost_${BOOST_VERSION.replace(/\./g, '_')}`)
  await run(
    datei,
    ['/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${ziel}`],
    { timeoutMs: 45 * 60 * 1000 }
  )
  const boost = await findeBoost(root)
  if (!boost) throw new Error('Boost wurde installiert, aber der Ordner mit den Bibliotheken fehlt.')
  return boost
}

async function installiereVisualStudio (root, opts) {
  const p = pfade(root)
  if (!opts.autoInstallTools) {
    throw new Error(
      'Visual Studio 2022 C++ Build Tools fehlen. Bitte installieren oder im Assistenten ' +
        '„Fehlende Werkzeuge automatisch installieren" aktivieren.'
    )
  }
  protokoll('Visual Studio 2022 C++ Build Tools fehlen - Installation wird gestartet ...', 'STEP')
  const winget = await findeWinget()
  if (winget) {
    await run(
      winget,
      [
        'install', '--id', 'Microsoft.VisualStudio.2022.BuildTools', '-e',
        '--silent', '--accept-package-agreements', '--accept-source-agreements',
        '--disable-interactivity',
        '--override',
        '--quiet --wait --norestart --nocache ' +
          '--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
      ],
      { allowFail: true, timeoutMs: 2 * 60 * 60 * 1000 }
    )
  } else {
    protokoll('winget fehlt - lade den Visual-Studio-Bootstrapper herunter ...', 'WARN')
    const datei = path.join(p.downloads, 'vs_BuildTools.exe')
    await download(['https://aka.ms/vs/17/release/vs_BuildTools.exe'], datei, {
      description: 'Visual Studio Build Tools'
    })
    await run(
      datei,
      [
        '--quiet', '--wait', '--norestart', '--nocache',
        '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended'
      ],
      { allowFail: true, timeoutMs: 2 * 60 * 60 * 1000 }
    )
  }
  const vs = await findeVisualStudio()
  if (!vs) {
    throw new Error(
      'Visual Studio 2022 C++ Build Tools wurden nicht gefunden. ' +
        'Die Installation braucht eventuell Administratorrechte.'
    )
  }
  return vs
}

async function werkzeugeSichern (root, opts) {
  let git = await findeGit(root)
  if (!git) {
    if (!opts.autoInstallTools) throw new Error('Git fehlt. Bitte installieren oder die automatische Werkzeugeinrichtung aktivieren.')
    git = await installiereGit(root)
  }
  protokoll(`Git: ${git}`, 'STEP')

  let cmake = await findeCMake(root)
  if (!cmake) {
    if (!opts.autoInstallTools) throw new Error('CMake fehlt. Bitte installieren oder die automatische Werkzeugeinrichtung aktivieren.')
    cmake = await installiereCMake(root)
  }
  protokoll(`CMake: ${cmake}`, 'STEP')

  let vs = await findeVisualStudio()
  if (!vs) vs = await installiereVisualStudio(root, opts)
  protokoll(`Visual Studio C++: ${vs}`, 'STEP')

  let openssl = await findeOpenSsl(root)
  if (!openssl) {
    if (!opts.autoInstallTools) throw new Error('OpenSSL 3.x (Vollversion) fehlt.')
    openssl = await installiereOpenSsl(root)
  }
  protokoll(`OpenSSL: ${openssl}`, 'STEP')

  let boost = await findeBoost(root)
  if (!boost) {
    if (!opts.autoInstallTools) throw new Error(`Boost ${BOOST_VERSION} fehlt.`)
    boost = await installiereBoost(root)
  }
  protokoll(`Boost: ${boost}`, 'STEP')

  opts.werkzeuge = { git, cmake, vs, openssl, boost }
  return opts.werkzeuge
}

/* --------------------------------------------------------------- MySQL */

function myIniInhalt (p, port) {
  const base = slash(p.mysql)
  return `[mysqld]
basedir="${base}"
datadir="${base}/data"
port=${port}
bind-address=127.0.0.1
max_allowed_packet=128M
innodb_buffer_pool_size=512M
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
log-error="${base}/data/wowpanel-mysql.err"
mysqlx=OFF

[client]
port=${port}
`
}

function clientCnfInhalt (port, passwort) {
  return `[client]
user=root
password=${passwort || ''}
host=127.0.0.1
port=${port}
`
}

function passwortAusCnf (datei) {
  try {
    if (!exists(datei)) return ''
    const text = fs.readFileSync(datei, 'utf8')
    const m = text.match(/^\s*password\s*=\s*(.*)$/im)
    return m ? m[1].trim() : ''
  } catch (_) {
    return ''
  }
}

async function mysqlUrls () {
  const versionen = []
  try {
    const html = await hole('https://dev.mysql.com/downloads/mysql/8.4.html', { timeoutMs: 20000 })
    for (const m of html.matchAll(/mysql-(8\.4\.\d+)-winx64\.zip/g)) {
      if (!versionen.includes(m[1])) versionen.push(m[1])
    }
  } catch (e) {
    protokoll(`MySQL-Downloadseite nicht lesbar: ${e.message}`, 'WARN')
  }
  for (const v of MYSQL_FALLBACK) if (!versionen.includes(v)) versionen.push(v)

  const urls = []
  for (const ver of versionen.slice(0, 4)) {
    const datei = `mysql-${ver}-winx64.zip`
    urls.push(
      `https://cdn.mysql.com//Downloads/MySQL-${MYSQL_MAJOR}/${datei}`,
      `https://dev.mysql.com/get/Downloads/MySQL-${MYSQL_MAJOR}/${datei}`,
      `https://downloads.mysql.com/archives/get/p/23/file/${datei}`
    )
  }
  return urls
}

async function installiereMySql (p, opts) {
  const ziel = path.join(p.mysql, 'bin', 'mysqld.exe')
  if (istDatei(ziel)) return

  protokoll('MySQL (portabel) fehlt - lade das ZIP-Archiv herunter ...', 'STEP')
  let zip = null
  try {
    const dateien = await fsp.readdir(p.downloads)
    const kandidaten = []
    for (const name of dateien) {
      if (!/^mysql-.*winx64.*\.zip$/i.test(name)) continue
      const voll = path.join(p.downloads, name)
      const groesse = await dateiGroesse(voll)
      if (groesse > 50 * 1024 * 1024) kandidaten.push({ voll, groesse })
    }
    kandidaten.sort((a, b) => b.groesse - a.groesse)
    if (kandidaten.length) {
      zip = kandidaten[0].voll
      protokoll(`Verwende vorhandenes MySQL-Archiv: ${zip}`)
    }
  } catch (_) {}

  if (!zip) {
    zip = path.join(p.downloads, 'mysql-winx64.zip')
    try {
      const urls = await mysqlUrls()
      await download(urls, zip, { description: `MySQL ${MYSQL_MAJOR} (portabel)` })
    } catch (e) {
      protokoll(`MySQL-ZIP-Download fehlgeschlagen: ${e.message}`, 'WARN')
      protokoll('Versuche MySQL über winget zu installieren ...', 'STEP')
      const ok = await installiereMySqlViaWinget(p)
      if (!ok) {
        throw new Error(
          'MySQL konnte weder als ZIP heruntergeladen noch über winget installiert werden. ' +
            'Bitte installiere MySQL 8.4 manuell nach C:\\Program Files\\MySQL oder lege ein ' +
            'MySQL-ZIP in den downloads-Ordner.'
        )
      }
      return
    }
  }

  await entpacke(zip, p.mysql, { stripTopLevel: true })
  if (!istDatei(path.join(p.mysql, 'bin', 'mysqld.exe'))) {
    throw new Error('MySQL wurde entpackt, aber mysqld.exe fehlt.')
  }
  if (!istDatei(path.join(p.mysql, 'lib', 'libmysql.lib'))) {
    throw new Error(
      'Im MySQL-Archiv fehlt lib/libmysql.lib. Für den Build wird die Entwicklungsdatei benötigt.'
    )
  }
}

async function installiereMySqlViaWinget (p) {
  const winget = 'winget.exe'
  const r = await execCapture(winget, ['--version'], { timeoutMs: 8000 })
  if (!r || !r.ok) return false
  protokoll('Installiere MySQL über winget (Oracle.MySQL) ...', 'STEP')
  try {
    await run(winget, ['install', 'Oracle.MySQL', '--silent', '--accept-package-agreements', '--accept-source-agreements'], {
      timeoutMs: 10 * 60 * 1000,
      allowFail: true
    })
  } catch (e) {
    protokoll(`winget-Installation: ${e.message}`, 'WARN')
  }

  // MySQL finden
  const basen = [
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  ]
  let quellDir = null
  for (const base of basen) {
    const mysqlBase = path.join(base, 'MySQL')
    if (!istOrdner(mysqlBase)) continue
    let eintraege = []
    try { eintraege = await fsp.readdir(mysqlBase, { withFileTypes: true }) } catch (_) {}
    const kandidaten = eintraege
      .filter(e => e.isDirectory() && /^MySQL Server/i.test(e.name))
      .map(e => path.join(mysqlBase, e.name))
      .sort()
      .reverse()
    for (const dir of kandidaten) {
      if (istDatei(path.join(dir, 'bin', 'mysqld.exe')) && istDatei(path.join(dir, 'lib', 'libmysql.lib'))) {
        quellDir = dir
        break
      }
    }
    if (quellDir) break
  }

  if (!quellDir) {
    protokoll('MySQL wurde über winget installiert, aber der Ordner wurde nicht gefunden.', 'WARN')
    return false
  }

  protokoll(`Kopiere MySQL von ${quellDir} nach ${p.mysql} ...`, 'STEP')
  await fsp.mkdir(p.mysql, { recursive: true })
  for (const sub of ['bin', 'lib', 'include', 'share']) {
    const src = path.join(quellDir, sub)
    if (istOrdner(src)) {
      await fsp.cp(src, path.join(p.mysql, sub), { recursive: true, force: true })
    }
  }
  if (!istDatei(path.join(p.mysql, 'bin', 'mysqld.exe'))) {
    protokoll('Kopieren fehlgeschlagen: mysqld.exe fehlt.', 'WARN')
    return false
  }
  if (!istDatei(path.join(p.mysql, 'lib', 'libmysql.lib'))) {
    protokoll('Kopieren fehlgeschlagen: libmysql.lib fehlt.', 'WARN')
    return false
  }
  protokoll('MySQL über winget installiert und kopiert.', 'STEP')
  return true
}

function portOffen (port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let fertig = false
    const beenden = ok => {
      if (fertig) return
      fertig = true
      try { socket.destroy() } catch (_) {}
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => beenden(true))
    socket.once('timeout', () => beenden(false))
    socket.once('error', () => beenden(false))
    socket.connect(port, '127.0.0.1')
  })
}

async function portFrei (port) {
  return !(await portOffen(port, 400))
}

/*
 * SOAP ist im Core standardmaessig auf 7878 eingestellt. Ist der Port schon
 * belegt (z. B. von einem anderen Server), nimmt der Assistent den naechsten
 * freien - sonst waere die Konsole nach der Installation tot, ohne dass der
 * Grund sichtbar wird.
 */
async function freierPort (start, anzahl = 20) {
  const ab = Number(start) || SOAP_STANDARD_PORT
  for (let port = ab; port < ab + anzahl; port++) {
    if (await portFrei(port)) return port
  }
  return ab
}

async function warteAufPort (port, maxMs) {
  const ende = Date.now() + maxMs
  while (Date.now() < ende) {
    if (lauf && lauf.cancelled) throw abbruchFehler()
    if (await portOffen(port, 700)) return true
    await sleep(600)
  }
  return false
}

async function mysqlVerbinden (port, user, passwort, datenbank) {
  return mysql.createConnection({
    host: '127.0.0.1',
    port,
    user,
    password: passwort,
    database: datenbank,
    connectTimeout: 4000,
    multipleStatements: true,
    charset: 'utf8mb4'
  })
}

async function mysqlStarten (p, port, opts) {
  if (lauf && lauf.mysql && lauf.mysql.port === port && (await portOffen(port))) {
    return lauf.mysql
  }

  const state = leseZustand(p.root)
  let rootPasswort = (state && state.mysqlRootPassword) || passwortAusCnf(p.clientCnf) || ''
  let child = null

  if (!(await portOffen(port))) {
    const mysqld = path.join(p.mysql, 'bin', 'mysqld.exe')
    protokoll(`Starte MySQL auf Port ${port} ...`, 'STEP')
    child = spawn(mysqld, [`--defaults-file=${p.myIni}`, '--console'], {
      cwd: p.mysql,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const ausgabe = (data, level) => {
      for (const zeile of dekodiere(data).split(/\r?\n|\r/)) {
        if (zeile.trim()) protokoll(zeile.trimEnd(), level)
      }
    }
    child.stdout.on('data', d => ausgabe(d, 'MYSQL'))
    child.stderr.on('data', d => ausgabe(d, 'MYSQL'))
    child.once('exit', code => {
      protokoll(`MySQL-Prozess beendet (Code ${code}).`, 'WARN')
    })
    if (!(await warteAufPort(port, 90000))) {
      if (child && !child.killed) killTree(child.pid)
      throw new Error('MySQL nimmt nach 90 Sekunden keine Verbindungen an.')
    }
    protokoll('MySQL läuft.', 'STEP')
  } else {
    protokoll(`Auf Port ${port} antwortet bereits MySQL - vorhandene Instanz wird benutzt.`, 'WARN')
  }

  /*
   * Nur eine selbst gestartete Instanz gehoert uns. Laeuft auf dem Port
   * bereits ein fremdes MySQL, wird hoechstens noch mit den gespeicherten
   * Zugangsdaten gearbeitet - niemals das root-Passwort geaendert.
   */
  const eigeneInstanz = !!child
  if (!eigeneInstanz && !rootPasswort) {
    throw new Error(
      `Auf Port ${port} läuft bereits ein MySQL, dessen root-Zugang dem Assistenten ` +
        'nicht bekannt ist. Bitte einen anderen Port wählen oder die Instanz beenden.'
    )
  }

  let conn = null
  let verwendetLeer = false
  if (eigeneInstanz) {
    try {
      conn = await mysqlVerbinden(port, 'root', rootPasswort)
    } catch (_) {
      try {
        conn = await mysqlVerbinden(port, 'root', '')
        rootPasswort = ''
        verwendetLeer = true
      } catch (e2) {
        throw new Error(
          `MySQL läuft, aber der root-Zugang passt nicht. ` +
            `Vorhandenes root-Passwort unbekannt: ${e2.message}`
        )
      }
    }
  } else {
    try {
      conn = await mysqlVerbinden(port, 'root', rootPasswort)
    } catch (e) {
      throw new Error(
        `Auf Port ${port} läuft ein MySQL, aber das gespeicherte root-Passwort passt nicht: ${e.message}`
      )
    }
  }

  const dbPasswort = (state && state.dbPassword) || zufallspasswort(18)
  const frisch = eigeneInstanz && (!state || !state.mysqlRootPassword || verwendetLeer)
  if (!rootPasswort) rootPasswort = zufallspasswort(20)

  const sql = []
  for (const name of [DB.auth, DB.chars, DB.world]) {
    sql.push(`CREATE DATABASE IF NOT EXISTS \`${name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
  }
  for (const host of ['%', 'localhost']) {
    sql.push(`CREATE USER IF NOT EXISTS '${DB_USER}'@'${host}' IDENTIFIED BY '${dbPasswort}';`)
    sql.push(`ALTER USER '${DB_USER}'@'${host}' IDENTIFIED BY '${dbPasswort}';`)
    for (const name of [DB.auth, DB.chars, DB.world]) {
      sql.push(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${DB_USER}'@'${host}';`)
    }
    sql.push(`GRANT RELOAD ON *.* TO '${DB_USER}'@'${host}';`)
  }
  sql.push('FLUSH PRIVILEGES;')
  if (eigeneInstanz && (frisch || rootPasswort !== passwortAusCnf(p.clientCnf))) {
    sql.push(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPasswort}';`)
  }

  try {
    await conn.query(sql.join('\n'))
  } finally {
    await conn.end().catch(() => {})
  }

  fs.writeFileSync(p.clientCnf, clientCnfInhalt(port, rootPasswort), 'utf8')
  schreibeZustand(p.root, {
    ...(state || {}),
    version: 1,
    root: p.root,
    startedAt: (state && state.startedAt) || new Date().toISOString(),
    mysqlRootPassword: rootPasswort,
    dbPassword: dbPasswort,
    mysqlPort: port,
    options: oeffentlicheOptionen({ ...opts, root: p.root })
  })

  // Pruefen, ob das neue root-Passwort wirklich greift.
  const kontrolle = await mysqlVerbinden(port, 'root', rootPasswort)
  await kontrolle.end().catch(() => {})

  if (frisch) protokoll(`Datenbanken und Benutzer ${DB_USER} wurden angelegt.`, 'STEP')
  else protokoll('Datenbankzugang wurde aktualisiert.', 'STEP')

  const ergebnis = {
    port,
    rootPasswort,
    dbPasswort,
    child,
    gestartet: !!child,
    // Eine bereits laufende Instanz mit passenden Zugangsdaten wird beim
    // Aufraeumen mit heruntergefahren, damit das Panel sie uebernehmen kann.
    uebernommen: !child && !!rootPasswort,
    datenbanken: { ...DB }
  }
  if (lauf) lauf.mysql = ergebnis
  return ergebnis
}

async function mySqlVorbereiten (p, opts) {
  const port = Number(opts.mysqlPort) || 3306
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Ungültiger MySQL-Port: ${opts.mysqlPort}`)
  }

  await fsp.mkdir(p.mysql, { recursive: true })
  await fsp.mkdir(p.mysqlData, { recursive: true })
  fs.writeFileSync(p.myIni, myIniInhalt(p, port), 'utf8')

  /*
   * Liegt der Port schon in Benutzung, ist das fast immer die Datenbank, die
   * das Panel selbst gestartet hat - etwa aus einer frueheren Installation
   * oder einem daneben liegenden Repack. Der Import braucht den Port fuer die
   * eigene Instanz, und deren root-Zugang kann ein anderer sein. Deshalb wird
   * eine vom Panel verwaltete Datenbank hier kurz beendet; am Ende der
   * Einrichtung startet sie wieder - dann mit dem neuen Stand.
   * Eine fremde Instanz (Windows-Dienst) laesst sich so nicht beenden; sie
   * wird gleich darauf mit einer klaren Meldung abgelehnt.
   */
  const eigeneLaeuft =
    !!(lauf && lauf.mysql && lauf.mysql.port === port) && (await portOffen(port))
  if (!eigeneLaeuft && (await portOffen(port))) {
    protokoll('Beende die laufende Panel-Datenbank für die Einrichtung ...', 'STEP')
    try { serverManager.stop('db') } catch (_) {}
    for (let i = 0; i < 30 && (await portOffen(port)); i++) await sleep(500)
  }

  if (!istDatei(path.join(p.mysql, 'bin', 'mysqld.exe'))) {
    await installiereMySql(p, opts)
  }
  if (!istDatei(path.join(p.mysql, 'lib', 'libmysql.lib'))) {
    throw new Error('MySQL ist unvollständig: lib/libmysql.lib fehlt.')
  }

  if (!istOrdner(path.join(p.mysqlData, 'mysql'))) {
    if (!(await portFrei(port))) {
      throw new Error(
        `Port ${port} ist bereits belegt. Bitte einen anderen Port wählen oder den ` +
          `laufenden MySQL-Dienst beenden.`
      )
    }
    protokoll('Initialisiere das portable MySQL-Datenverzeichnis ...', 'STEP')
    await run(
      path.join(p.mysql, 'bin', 'mysqld.exe'),
      [`--defaults-file=${p.myIni}`, '--initialize-insecure', '--console'],
      { cwd: p.mysql, timeoutMs: 20 * 60 * 1000 }
    )
  }

  return mysqlStarten(p, port, opts)
}

async function mySqlBeenden (p, my) {
  if (!my || (!my.gestartet && !my.uebernommen)) return
  protokoll('Beende das Installations-MySQL ...', 'STEP')
  try {
    await run(
      path.join(p.mysql, 'bin', 'mysqladmin.exe'),
      [`--defaults-extra-file=${p.clientCnf}`, 'shutdown'],
      { allowFail: true, timeoutMs: 90000 }
    )
  } catch (_) {}

  if (my.child) {
    const ende = Date.now() + 60000
    while (Date.now() < ende) {
      if (my.child.exitCode !== null) break
      await sleep(400)
    }
    if (my.child.exitCode === null) {
      protokoll('MySQL reagiert nicht auf shutdown - beende den Prozess hart.', 'WARN')
      killTree(my.child.pid)
    }
  } else {
    // Uebernommene Instanz: warten, bis der Port wirklich frei ist.
    const ende = Date.now() + 60000
    while (Date.now() < ende && (await portOffen(my.port, 500))) await sleep(400)
  }
  my.gestartet = false
  my.uebernommen = false
  if (lauf) lauf.mysql = null
}

/* ----------------------------------------------------------- Quellen/Build */

async function quelleSichern (p, opts) {
  const git = opts.werkzeuge.git
  const branch = opts.branch || QUELLE_BRANCH
  if (istOrdner(path.join(p.source, '.git'))) {
    protokoll('Quellcode ist vorhanden - aktualisiere ihn ...', 'STEP')

    /*
     * Veränderte Quell-Dateien lassen den Pull scheitern - und das Update
     * liefe still auf dem alten Stand weiter. Deshalb: alles Abweichende
     * (auch unentdeckte Dateien wie Crash-Dumps) in einen benannten Stash,
     * nach dem Pull zurückholen. Gelingt das Zurückholen nicht, bleiben
     * die Änderungen sicher im Stash und werden benannt.
     */
    let stashGesetzt = false
    try {
      const status = await execCapture(git, ['-C', p.source, 'status', '--porcelain'])
      if ((status.out || '').trim()) {
        protokoll('Geänderte Quelldateien gefunden - sichere sie per Git-Stash ...', 'STEP')
        const stash = await run(git, ['-C', p.source, 'stash', 'push', '-u', '-m', 'Panel-Update-Autostash'], {
          allowFail: true,
          timeoutMs: 120000
        })
        stashGesetzt = stash.code === 0
        if (!stashGesetzt) protokoll('Stash war nicht möglich - der Pull kann an den Änderungen scheitern.', 'WARN')
      }
    } catch (_) {}

    const pull = await run(git, ['-C', p.source, 'pull', '--ff-only'], {
      allowFail: true,
      timeoutMs: 20 * 60 * 1000
    })
    if (pull.code !== 0) protokoll('git pull war nicht möglich - baue den vorhandenen Stand.', 'WARN')

    if (stashGesetzt) {
      const pop = await run(git, ['-C', p.source, 'stash', 'pop'], {
        allowFail: true,
        timeoutMs: 120000
      })
      if (pop.code !== 0) {
        protokoll('Das Zurückholen der Stash-Änderungen ging nicht auf - sie liegen sicher im Git-Stash. In der Quelle: git stash list / git stash pop.', 'WARN')
      }
    }

    await run(git, ['-C', p.source, 'submodule', 'update', '--init', '--recursive'], {
      timeoutMs: 60 * 60 * 1000,
      allowFail: true
    })
  } else if (istDatei(path.join(p.source, 'CMakeLists.txt'))) {
    protokoll('Vorhandene Quelldateien ohne .git gefunden - verwende sie unverändert.', 'WARN')
  } else {
    if (istOrdner(p.source)) {
      const eintraege = await fsp.readdir(p.source).catch(() => [])
      if (eintraege.length) {
        throw new Error(
          `Der Ordner ${p.source} ist nicht leer, enthält aber keine AzerothCore-Quellen. ` +
            'Bitte einen anderen Zielordner wählen oder den Ordner leeren.'
        )
      }
    }
    await fsp.mkdir(p.root, { recursive: true })
    protokoll(`Klonen von ${QUELLE} (Branch ${branch}) ...`, 'STEP')
    await run(
      git,
      ['clone', '--branch', branch, '--recurse-submodules', '--progress', QUELLE, p.source],
      { cwd: p.root, timeoutMs: 2 * 60 * 60 * 1000 }
    )
  }

  const head = await execCapture(git, ['-C', p.source, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 15000 })
  if (head.ok) protokoll(`Quellstand: ${head.out}`, 'STEP')

  /*
   * Alle Module im Quellbaum mitziehen. Frueher wurde nur modules/playerbots
   * aktualisiert - dadurch blieben andere Module auf ihrem Stand, obwohl sie
   * mitkompiliert werden (und der Bau konnte unerklaerlich brechen).
   */
  const module = await moduleAktualisieren(git, p.source)
  if (module.anzahl) {
    protokoll(`${module.anzahl} Modul(e) geprüft${module.geaendert ? ' - Stand geändert' : ', alle unverändert'}.`, 'STEP')
  }
}

/*
 * Pull fuer alle Module unter <source>/modules (mit .git). Eigenstaendig,
 * damit der Ablauf ohne vollstaendigen Update-Lauf prüfbar ist.
 * Setzt buildNoetig, sobald sich ein Modulstand aendert.
 */
async function moduleAktualisieren (git, source) {
  const moduleDir = path.join(source, 'modules')
  let module = []
  try {
    module = (await fsp.readdir(moduleDir, { withFileTypes: true }))
      .filter(e => e.isDirectory() && fs.existsSync(path.join(moduleDir, e.name, '.git')))
      .map(e => e.name)
  } catch (_) {}
  if (module.length) {
    protokoll(`Aktualisiere ${module.length} Modul(e) im Quellbaum ...`, 'STEP')
  }
  let modulGeaendert = false
  for (const name of module) {
    const dir = path.join(moduleDir, name)
    const vorher = await execCapture(git, ['-C', dir, 'rev-parse', 'HEAD'], { timeoutMs: 15000 })
    const r = await run(git, ['-C', dir, 'pull', '--ff-only'], { allowFail: true, timeoutMs: 15 * 60 * 1000 })
    const nachher = await execCapture(git, ['-C', dir, 'rev-parse', 'HEAD'], { timeoutMs: 15000 })
    if (vorher.ok && nachher.ok && vorher.out !== nachher.out) {
      modulGeaendert = true
      protokoll(`Modul ${name}: ${vorher.out.slice(0, 8)} → ${nachher.out.slice(0, 8)}`, 'STEP')
    } else if (r.code !== 0) {
      // Erste aussagekraeftige Zeile: bei "git pull" steht der Grund oben,
      // unten folgen nur Hinweise (Tracking-Branch, Hilfe).
      const zeilen = String(r.err || '').split(/\r?\n/).map(z => z.trim()).filter(Boolean)
      const grund = zeilen.find(z => /^(fatal|error):/i.test(z)) || zeilen[0] || `git pull (Code ${r.code})`
      protokoll(`Modul ${name} konnte nicht aktualisiert werden: ${grund}`, 'WARN')
    }
  }
  if (modulGeaendert) {
    try { store.write({ buildNoetig: true }) } catch (_) {}
    protokoll('Modulstand geändert - der Bau wird beim Update erzwungen.', 'STEP')
  }
  return { anzahl: module.length, geaendert: modulGeaendert, module }
}

async function konfigurieren (p, opts) {
  const { cmake, boost, openssl } = opts.werkzeuge
  await fsp.mkdir(p.build, { recursive: true })
  const boostLib = path.join(boost, `lib64-msvc-${BOOST_TOOLSET}`)
  const mysqlLib = path.join(p.mysql, 'lib', 'libmysql.lib')
  const mysqlInc = path.join(p.mysql, 'include')

  const args = [
    '-S', p.source,
    '-B', p.build,
    '-G', VS_GENERATOR,
    '-DTOOLS_BUILD=db-only',
    '-DSCRIPTS=static',
    '-DMODULES=static',
    '-DWITH_WARNINGS=0',
    '-DCMAKE_BUILD_TYPE=' + BUILD_CONFIG,
    // MSVC: mehrere Quelldateien einer Compile-Einheit parallel übersetzen.
    // Größter Einzelfaktor gegen die Bauzeit bei NMake.
    '-DCMAKE_CXX_FLAGS=/MP',
    `-DBOOST_ROOT=${slash(boost)}`,
    `-DBOOST_LIBRARYDIR=${slash(boostLib)}`,
    `-DMYSQL_INCLUDE_DIR=${slash(mysqlInc)}`,
    `-DMYSQL_LIBRARY=${slash(mysqlLib)}`,
    `-DOPENSSL_ROOT_DIR=${slash(openssl)}`
  ]
  protokoll('Konfiguriere CMake ...', 'STEP')
  await run(cmake, args, { cwd: p.root, timeoutMs: 60 * 60 * 1000, env: vsEnv() })
}

/*
 * Hoechste installierte Version eines Ordners ermitteln (z. B. MSVC
 * "14.44.35207" oder Windows SDK "10.0.26100.0"). Fest verdrahtete Nummern
 * brechen auf jedem anderen Rechner, sobald Microsoft eine neue Version
 * ausliefert - deshalb wird immer die vorhandene benutzt.
 */
function neuesteVersionUnter (ordner) {
  let treffer = null
  try {
    for (const eintrag of fs.readdirSync(ordner)) {
      const teile = String(eintrag).split('.').map(x => parseInt(x, 10) || 0)
      if (teile.length < 2 || teile.some(x => x < 0)) continue
      const wert = teile[0] * 1e8 + teile[1] * 1e4 + (teile[2] || 0) * 100 + (teile[3] || 0)
      if (!treffer || wert > treffer.wert) treffer = { name: eintrag, wert }
    }
  } catch (_) {}
  return treffer ? treffer.name : ''
}

function vsEnv () {
  // NMake Makefiles braucht die VS-Umgebung (vcvars64.bat).
  // Wir setzen die wichtigsten Variablen manuell, da vcvars64.bat
  // nicht direkt aus Node.js aufgerufen werden kann.
  const msPaths = [
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Professional',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Enterprise',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise'
  ]
  const vsRoot = msPaths.find(p => istOrdner(p))
  if (!vsRoot) return {}
  const msDir = path.join(vsRoot, 'VC', 'Tools', 'MSVC', neuesteVersionUnter(path.join(vsRoot, 'VC', 'Tools', 'MSVC')))
  const sdkRoot = [
    'C:\\Program Files (x86)\\Windows Kits\\10',
    'C:\\Program Files\\Windows Kits\\10'
  ].find(p => istOrdner(p)) || 'C:\\Program Files (x86)\\Windows Kits\\10'
  const sdkVersion = neuesteVersionUnter(path.join(sdkRoot, 'Include'))
  if (!msDir || !istOrdner(msDir)) {
    protokoll(`MSVC-Tools unter "${vsRoot}" nicht gefunden - der Compiler wird vermutlich nicht laufen.`, 'WARN')
    return {}
  }
  const env = {}
  env.PATH = [
    path.join(msDir, 'bin', 'Hostx64', 'x64'),
    path.join(vsRoot, 'Common7', 'IDE'),
    path.join(sdkRoot, 'bin', sdkVersion, 'x64'),
    process.env.PATH || ''
  ].join(';')
  env.INCLUDE = [
    path.join(msDir, 'include'),
    path.join(sdkRoot, 'Include', sdkVersion, 'ucrt'),
    path.join(sdkRoot, 'Include', sdkVersion, 'shared'),
    path.join(sdkRoot, 'Include', sdkVersion, 'um'),
    path.join(sdkRoot, 'Include', sdkVersion, 'winrt'),
    path.join(sdkRoot, 'Include', sdkVersion, 'cppwinrt')
  ].join(';')
  env.LIB = [
    path.join(msDir, 'lib', 'x64'),
    path.join(sdkRoot, 'Lib', sdkVersion, 'ucrt', 'x64'),
    path.join(sdkRoot, 'Lib', sdkVersion, 'um', 'x64')
  ].join(';')
  env.VCToolsInstallDir = msDir + '\\'
  return env
}

function findeDateiUnter (ordner, name, tiefe = 6) {
  if (tiefe < 0 || !istOrdner(ordner)) return null
  let eintraege = []
  try {
    eintraege = fs.readdirSync(ordner, { withFileTypes: true })
  } catch (_) {
    return null
  }
  for (const e of eintraege) {
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(ordner, e.name)
  }
  for (const e of eintraege) {
    if (!e.isDirectory()) continue
    const treffer = findeDateiUnter(path.join(ordner, e.name), name, tiefe - 1)
    if (treffer) return treffer
  }
  return null
}

async function kopiereLaufzeitDlls (p, opts, bin) {
  const mysqlDll = path.join(p.mysql, 'lib', 'libmysql.dll')
  if (istDatei(mysqlDll)) await fsp.copyFile(mysqlDll, path.join(bin, 'libmysql.dll'))

  const ssl = opts.werkzeuge.openssl
  if (!ssl || !opensslGueltig(ssl)) {
    protokoll('OpenSSL-Ordner nicht gefunden - Laufzeit-DLLs fehlen eventuell.', 'WARN')
    return
  }

  const sammle = (muster, excludeX86 = true) => {
    const treffer = []
    const gehe = dir => {
      let eintraege = []
      try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
      for (const e of eintraege) {
        const voll = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (excludeX86 && /^(x86|Win32|debug)$/i.test(e.name)) continue
          gehe(voll)
        } else if (e.name.toLowerCase().includes(muster)) {
          treffer.push(voll)
        }
      }
    }
    gehe(ssl)
    return treffer
  }

  let kopiert = []
  for (const name of ['libcrypto', 'libssl', 'legacy']) {
    const dateien = sammle(name)
    if (!dateien.length) continue
    const passend = dateien.find(f => /x64|win64/i.test(f)) || dateien[0]
    await fsp.copyFile(passend, path.join(bin, path.basename(passend)))
    kopiert.push(path.basename(passend))
  }
  if (!kopiert.some(n => /legacy\.dll$/i.test(n))) {
    protokoll(
      'legacy.dll wurde nicht gefunden. AzerothCore bricht ohne diese OpenSSL-Datei beim Start ab.',
      'WARN'
    )
  } else {
    protokoll(`Laufzeit-DLLs kopiert: ${kopiert.join(', ')}`, 'STEP')
  }
}

async function konfigurationsdateienKopieren (p) {
  // .conf.dist Dateien suchen: im Build-Ordner, im Quellbaum und in den
  // Modulen (mod-playerbots bringt playerbots.conf.dist mit)
  const orte = [p.configs, path.join(p.source, 'src'), path.join(p.source, 'modules')]
  // Fuer die Oberflaeche: welche Dateien wurden um welche Schluessel ergaenzt?
  const migration = []
  const kopieren = async dir => {
    if (!istOrdner(dir)) return
    let eintraege = []
    try { eintraege = await fsp.readdir(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const voll = path.join(dir, e.name)
      if (e.isDirectory()) {
        await kopieren(voll)
      } else if (/\.conf\.dist$/i.test(e.name)) {
        const ziel = path.join(p.configs, e.name.replace(/\.dist$/i, ''))
        if (!exists(ziel)) {
          await fsp.mkdir(path.dirname(ziel), { recursive: true })
          await fsp.copyFile(voll, ziel)
          protokoll(`Konfiguration angelegt: ${path.basename(ziel)}`)
        } else if (istDatei(ziel) && path.dirname(voll) !== p.configs) {
          /*
           * Die .conf existiert bereits (vom Nutzer bearbeitet). Nichts
           * ueberschreiben! Aber neue Schluessel aus der .dist ergaenzen -
           * ein Core-Update fuehrt sonst zu einer veralteten Konfiguration,
           * der Schluessel fehlen und der Server setzt still Defaults.
           */
          const frisch = fs.readFileSync(voll, 'utf8')
          const alt = fs.readFileSync(ziel, 'utf8')
          let ergaenzt = 0
          const neue = []
          for (const zeile of frisch.split(/\r?\n/)) {
            const m = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.+?)\s*$/.exec(zeile)
            if (!m) continue
            const rx = new RegExp(`^\\s*${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'm')
            if (rx.test(alt)) continue
            setConfValue(ziel, m[1], m[2])
            ergaenzt++
            neue.push(m[1])
          }
          if (ergaenzt) {
            migration.push({ datei: path.basename(ziel), anzahl: ergaenzt, keys: neue.slice(0, 100) })
            protokoll(`Konfiguration ergänzt: ${path.basename(ziel)} (${ergaenzt} neue Schlüssel aus der .dist)`)
          }
        }
      }
    }
  }
  for (const ort of orte) await kopieren(ort)
  if (migration.length) {
    try {
      store.write({
        lastConfigMigration: {
          zeit: new Date().toISOString(),
          gesehen: false,
          dateien: migration
        }
      })
    } catch (_) {}
  }
}

function formatConfWert (wert) {
  const text = String(wert ?? '')
  if (/^-?\d+(\.\d+)?$/.test(text)) return text
  if (text.startsWith('"') && text.endsWith('"')) return text
  return `"${text}"`
}

function setConfValue (datei, key, wert) {
  if (!istDatei(datei)) return false
  let inhalt = fs.readFileSync(datei, 'utf8')
  const formatiert = formatConfWert(wert)
  const rx = new RegExp(`^(\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*).*$`, 'm')
  if (rx.test(inhalt)) {
    inhalt = inhalt.replace(rx, `$1${formatiert.replace(/\$/g, '$$$$')}`)
  } else {
    if (!inhalt.endsWith('\n')) inhalt += '\r\n'
    inhalt += `${key} = ${formatiert}\r\n`
  }
  fs.writeFileSync(datei, inhalt, 'utf8')
  return true
}

function dbInfo (my, name) {
  if (!my || !Number(my.port)) {
    throw new Error(
      'Die Datenbank ist noch nicht vorbereitet - Port und Zugangsdaten fehlen. ' +
      'Bitte die Einrichtung bzw. das Update erneut starten.'
    )
  }
  return `127.0.0.1;${my.port};${DB_USER};${my.dbPasswort};${name}`
}

async function serverKonfigurationSchreiben (p, opts, my) {
  await fsp.mkdir(p.logs, { recursive: true })
  await fsp.mkdir(p.data, { recursive: true })
  const mysqlExe = path.join(p.mysql, 'bin', 'mysql.exe')
  const world = path.join(p.configs, 'worldserver.conf')
  const auth = path.join(p.configs, 'authserver.conf')
  const dbimport = path.join(p.configs, 'dbimport.conf')

  for (const datei of [world, auth, dbimport]) {
    if (!istDatei(datei)) continue
    setConfValue(datei, 'LogsDir', slash(p.logs))
    setConfValue(datei, 'MySQLExecutable', slash(mysqlExe))
  }

  if (istDatei(world)) {
    setConfValue(world, 'LoginDatabaseInfo', dbInfo(my, DB.auth))
    setConfValue(world, 'WorldDatabaseInfo', dbInfo(my, DB.world))
    setConfValue(world, 'CharacterDatabaseInfo', dbInfo(my, DB.chars))
    setConfValue(world, 'DataDir', slash(p.data))
    setConfValue(world, 'Console.Enable', 1)
    setConfValue(world, 'Updates.EnableDatabases', 7)
    setConfValue(world, 'Updates.AutoSetup', 1)
    setConfValue(world, 'RealmID', 1)

    // SOAP fuer die Konsole im Panel. Benutzer und Passwort werden nach dem
    // Datenbankimport als GM-Konto angelegt (siehe soapKontoAnlegen).
    const soap = opts.soap || {}
    setConfValue(world, 'SOAP.Enabled', 1)
    setConfValue(world, 'SOAP.IP', soap.host || '127.0.0.1')
    setConfValue(world, 'SOAP.Port', Number(soap.port) || SOAP_STANDARD_PORT)
  }

  if (istDatei(auth)) {
    setConfValue(auth, 'LoginDatabaseInfo', dbInfo(my, DB.auth))
  }

  if (istDatei(dbimport)) {
    setConfValue(dbimport, 'LoginDatabaseInfo', dbInfo(my, DB.auth))
    setConfValue(dbimport, 'WorldDatabaseInfo', dbInfo(my, DB.world))
    setConfValue(dbimport, 'CharacterDatabaseInfo', dbInfo(my, DB.chars))
    setConfValue(dbimport, 'SourceDirectory', slash(p.source))
    setConfValue(dbimport, 'Updates.EnableDatabases', 7)
    setConfValue(dbimport, 'Updates.AutoSetup', 1)
    setConfValue(dbimport, 'Updates.AllowedModules', 'all')
  }
  protokoll('Serverkonfiguration wurde auf die portable Datenbank eingestellt.', 'STEP')
}

async function bauen (p, opts) {
  const cmake = opts.werkzeuge.cmake
  const kerne = os.cpus().length || 2
  const anteil = opts.buildProfile === 'background' ? 0.5 : opts.buildProfile === 'balanced' ? 0.75 : 1
  const jobs = Math.max(1, Math.round(kerne * anteil))
  protokoll(`Übersetze mit ${jobs} parallelen Aufgaben (${kerne} Kerne) ...`, 'STEP')
  const args = [
    '--build', p.build,
    '--config', BUILD_CONFIG
  ]
  /*
   * Zwei Hebel gegen die Bauzeit: CMAKE_BUILD_PARALLEL_LEVEL (wo der
   * Generator es unterstuetzt) und /MP im Compiler - MSVC uebersetzt dann
   * mehrere Dateien einer Compile-Einheit gleichzeitig. Ohne beides lief
   * der Build mit NMake streng nacheinander, was ein Update unnötig in die
   * Laenge zog.
   */
  const env = { ...vsEnv(), CMAKE_BUILD_PARALLEL_LEVEL: String(jobs) }
  await run(cmake, args, { cwd: p.root, timeoutMs: 6 * 60 * 60 * 1000, env })

  let bin = p.bin
  if (!istDatei(path.join(bin, 'worldserver.exe'))) {
    const gefunden = findeDateiUnter(p.build, 'worldserver.exe')
    if (gefunden) bin = path.dirname(gefunden)
  }
  if (!istDatei(path.join(bin, 'worldserver.exe'))) {
    throw new Error('Der Build lief durch, aber worldserver.exe wurde nicht gefunden.')
  }
  if (!istDatei(path.join(bin, 'authserver.exe'))) {
    throw new Error('Der Build lief durch, aber authserver.exe wurde nicht gefunden.')
  }

  p.bin = bin
  p.configs = path.join(bin, 'configs')
  p.modConfigs = path.join(p.configs, 'modules')

  await kopiereLaufzeitDlls(p, opts, bin)
  await konfigurationsdateienKopieren(p)
  await serverKonfigurationSchreiben(p, opts, lauf.mysql)
  protokoll(`Build fertig: ${bin}`, 'STEP')

  /*
   * Den gebauten Quellstand festhalten. Ohne diese Zeile gibt es die
   * Build-Skip-Falle: Scheitert ein Update am Build (Quelle neu, EXE alt),
   * sieht der naechste Lauf "0 neue Commits" und ueberspringt den Build -
   * und importiert dann die NEUE Datenbank gegen die ALTE worldserver.exe.
   * Der Skip greift deshalb nur, wenn der eingetragene Bau-Stand dem
   * gewuenschten entspricht.
   */
  try {
    const head = await execCapture(opts.werkzeuge.git, ['-C', p.source, 'rev-parse', 'HEAD'])
    const stand = (head.out || '').trim()
    if (stand) {
      schreibeZustand(p.root, { ...(leseZustand(p.root) || {}), buildCommit: stand, buildZeit: new Date().toISOString() })
      protokoll(`Gebauter Quellstand festgehalten: ${stand.slice(0, 8)}`, 'STEP')
    }
    // Modul-Änderungen sind jetzt eingebaut - kein erzwungener Rebuild nötig
    try { store.write({ buildNoetig: false }) } catch (_) {}
  } catch (_) {}
}

/*
 * Welche Clientdaten-Version liegt in <root>/data? Die Datei schreibt das
 * Panel beim Laden; ohne sie ist "aktualisieren" nicht bewertbar.
 */
function clientDatenVersion (p) {
  try {
    return fs.readFileSync(path.join(p.data, '.panel-version'), 'utf8').trim()
  } catch (_) {
    return ''
  }
}

async function clientDatenSichern (p, opts, erzwinge = false) {
  const pruefe = async () => {
    const namen = ['dbc', 'maps', 'vmaps', 'mmaps']
    for (const n of namen) if (!istOrdner(path.join(p.data, n))) return false
    return true
  }

  if (opts.clientDataPath && istOrdner(opts.clientDataPath)) {
    protokoll(`Übernehme Clientdaten aus ${opts.clientDataPath} ...`, 'STEP')
    for (const n of ['dbc', 'maps', 'vmaps', 'mmaps', 'Cameras']) {
      const src = path.join(opts.clientDataPath, n)
      if (istOrdner(src)) await fsp.cp(src, path.join(p.data, n), { recursive: true, force: true })
    }
    if (!(await pruefe())) throw new Error('Der gewählte Clientdaten-Ordner ist unvollständig.')
    try { fs.writeFileSync(path.join(p.data, '.panel-version'), 'lokal übernommen', 'utf8') } catch (_) {}
    return
  }

  if (!erzwinge && (await pruefe())) {
    const version = clientDatenVersion(p)
    protokoll(
      version
        ? `Clientdaten (dbc, maps, vmaps, mmaps) sind bereits vorhanden (Version: ${version}).`
        : 'Clientdaten (dbc, maps, vmaps, mmaps) sind bereits vorhanden.',
      'STEP'
    )
    return
  }

  if (!opts.downloadClientData && !erzwinge) {
    throw new Error(
      'Clientdaten fehlen und der automatische Download ist abgeschaltet. ' +
        'Aktiviere den Download oder gib einen Ordner mit dbc, maps, vmaps und mmaps an.'
    )
  }

  protokoll('Lade die offiziellen Clientdaten (dbc, maps, vmaps, mmaps) ...', 'STEP')
  const release = await hole('https://api.github.com/repos/wowgaming/client-data/releases/latest', { json: true })
  const assets = (release.assets || []).filter(a => /\.zip$/i.test(a.name))
  assets.sort((a, b) => {
    const wert = x => (String(x.name).toLowerCase() === 'data.zip' ? 0 : 1)
    return wert(a) - wert(b)
  })
  if (!assets.length) throw new Error('Die Clientdaten-Version enthält kein ZIP-Archiv.')
  const zip = path.join(p.downloads, `client-data-${release.tag_name || 'latest'}.zip`)
  await download([assets[0].browser_download_url], zip, {
    description: `Clientdaten ${release.tag_name || ''}`.trim(),
    timeoutMs: 0
  })
  await entpacke(zip, p.data)
  try { fs.writeFileSync(path.join(p.data, '.panel-version'), release.tag_name || 'unbekannt', 'utf8') } catch (_) {}
  if (!(await pruefe())) throw new Error('Die Clientdaten sind unvollständig entpackt worden.')
}

/*
 * SOAP benutzt ein normales Spielkonto zur Anmeldung. Der Core laesst
 * Konsolenbefehle nur ab GM-Stufe 3 (SEC_ADMINISTRATOR) zu. Deshalb wird nach
 * dem Datenbankimport ein eigenes Konto angelegt - nicht das Spaeter vom
 * Spieler benutzte, damit dessen Passwort unabhaengig bleibt.
 */
async function soapKontoAnlegen (conn, soap) {
  if (!soap || !soap.user || !soap.password) return null

  const crypto = require('crypto')
  const { calculateVerifier } = require('./accounts')
  const salt = crypto.randomBytes(32)
  const verifier = calculateVerifier(soap.user, soap.password, salt)

  const [vorhanden] = await conn.query('SELECT id FROM account WHERE username = ? LIMIT 1', [soap.user])
  let id
  if (vorhanden.length) {
    id = vorhanden[0].id
    await conn.query('UPDATE account SET salt = ?, verifier = ? WHERE id = ?', [salt, verifier, id])
  } else {
    const [res] = await conn.query(
      'INSERT INTO account (username, salt, verifier, email, reg_mail, last_ip) VALUES (?, ?, ?, ?, ?, ?)',
      [soap.user, salt, verifier, '', '', '127.0.0.1']
    )
    id = res.insertId
  }

  // -1 heisst "alle Reiche" und ist genau das, was auch die Konsole mit
  // ".account set gmlevel <konto> 3 -1" schreibt.
  const [spalten] = await conn.query('SHOW COLUMNS FROM account_access')
  const hatKommentar = spalten.some(s => s.Field === 'comment')
  if (hatKommentar) {
    await conn.query(
      "INSERT INTO account_access (id, gmlevel, RealmID, comment) VALUES (?, ?, -1, 'Panel') " +
        'ON DUPLICATE KEY UPDATE gmlevel = ?',
      [id, SOAP_GMLEVEL, SOAP_GMLEVEL]
    )
  } else {
    await conn.query(
      'INSERT INTO account_access (id, gmlevel, RealmID) VALUES (?, ?, -1) ' +
        'ON DUPLICATE KEY UPDATE gmlevel = ?',
      [id, SOAP_GMLEVEL, SOAP_GMLEVEL]
    )
  }
  return id
}

/*
 * Wie viele SQL-Dateien bringt die Quelle mit? Basis- und Update-Dateien der
 * Datenbanken liegen unter source/data/sql. Die Zahl ist der Zählerlauf für
 * den Fortschritt: dbimport arbeitet sie nacheinander ab.
 */
function zaehleQuellSql (source) {
  const wurzel = path.join(source, 'data', 'sql')
  let n = 0
  try {
    for (const art of ['base', 'updates']) {
      const ordner = path.join(wurzel, art)
      if (!istOrdner(ordner)) continue
      for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
        const unter = path.join(ordner, eintrag.name)
        if (eintrag.isDirectory()) {
          try {
            for (const d of fs.readdirSync(unter)) {
              if (d.toLowerCase().endsWith('.sql')) n++
            }
          } catch (_) {}
        } else if (eintrag.name.toLowerCase().endsWith('.sql')) {
          n++
        }
      }
    }
  } catch (_) {}
  return n
}

async function datenbankImportieren (p, opts, my) {
  const dbimport = path.join(p.bin, 'dbimport.exe')
  if (!istDatei(dbimport)) {
    throw new Error('dbimport.exe fehlt. Der Build muss mit -DTOOLS_BUILD=db-only erfolgen.')
  }
  /*
   * Fortschritt statt Stillstand: Dieser Schritt dauert je nach Maschine
   * Minuten bis Stunden. Pro "Applying"-Zeile wandert die Prozentzahl im
   * Bereich dieses Schritts nach vorn - ohne Treffer bleibt es beim
   * bisherigen Verhalten.
   */
  const erwartet = zaehleQuellSql(p.source)
  let gesehen = 0
  const idx = lauf ? lauf.stepIndex : -1
  const liste = idx >= 0 ? aktiveSchritte() : null
  const basis = idx >= 0 ? prozentBasis(idx) : 0
  const spielraum = liste && idx >= 0
    ? Math.max(1, (idx + 1 < liste.length ? prozentBasis(idx + 1) : 100) - basis)
    : 0
  protokoll(
    erwartet > 0
      ? `Importiere die AzerothCore-Datenbank (${erwartet} SQL-Dateien) ...`
      : 'Importiere die AzerothCore-Datenbank ...',
    'STEP'
  )
  await run(dbimport, [], {
    cwd: p.bin,
    timeoutMs: 2 * 60 * 60 * 1000,
    proZeile: zeile => {
      if (!erwartet || !/Applying|Importing|Loading/i.test(zeile)) return
      gesehen++
      if (lauf && spielraum > 0) {
        lauf.percent = basis + Math.min(spielraum - 1, Math.round((gesehen / erwartet) * spielraum))
        emit({ type: 'status', status: kurzStatus() })
      }
    }
  })

  let conn
  try {
    conn = await mysqlVerbinden(my.port, DB_USER, my.dbPasswort, DB.auth)
  } catch (_) {
    conn = await mysqlVerbinden(my.port, 'root', my.rootPasswort, DB.auth)
  }
  const realm = String(opts.realmName || 'AzerothCore').trim() || 'AzerothCore'
  try {
    /*
     * Spaltenname des Realm-Flags ermitteln: die Basisdaten haben die Spalte
     * in neueren Versionen von "realmflags" in "flag" umbenannt. Falsch
     * benannt wuerde der INSERT mit "Unknown column" brechen.
     */
    const [spalten] = await conn.query('SHOW COLUMNS FROM realmlist')
    const flagSpalte = spalten.some(s => s.Field === 'flag') ? 'flag' : 'realmflags'
    const [rows] = await conn.query('SELECT id FROM realmlist WHERE id = 1')
    if (rows.length) {
      await conn.query(
        `UPDATE realmlist SET name = ?, address = ?, localAddress = ?, ${flagSpalte} = 0 WHERE id = 1`,
        [realm, '127.0.0.1', '127.0.0.1']
      )
    } else {
      await conn.query(
        `INSERT INTO realmlist ` +
          `(id, name, address, localAddress, port, icon, ${flagSpalte}, timezone, allowedSecurityLevel, population, gamebuild) ` +
          'VALUES (1, ?, ?, ?, 8085, 0, 0, 1, 0, 0, 12340)',
        [realm, '127.0.0.1', '127.0.0.1']
      )
    }
    /*
     * Der Flag 2 (OFFLINE) aus den Basisdaten haette den Realm abgeschaltet:
     * der Authserver verweigert dann sofort den Start ("No valid realms")
     * und niemand kann sich verbinden. Deshalb steht der Realm jetzt
     * ausdruecklich auf online.
     */
    protokoll(`Realm "${realm}" wurde eingetragen (flag = 0, Realm online).`, 'STEP')

    const soapId = await soapKontoAnlegen(conn, opts.soap)
    if (soapId) {
      protokoll(
        `SOAP-Konto "${opts.soap.user}" wurde mit GM-Stufe ${SOAP_GMLEVEL} angelegt ` +
          `(Port ${opts.soap.port}).`,
        'STEP'
      )
    }
  } finally {
    await conn.end().catch(() => {})
  }
}

/*
 * Benutzt das Panel bereits genau diesen Server? Nur dann darf ein Update die
 * Pfade und Zugangsdaten in der Konfiguration ueberschreiben.
 */
function panelZeigtAuf (root) {
  const cfg = store.read()
  const server = cfg.server || {}
  const kandidaten = [server.rootDir, server.worldExe].filter(Boolean)
  if (!kandidaten.length) return true
  const ziel = path.resolve(root).toLowerCase()
  const trifft = k => {
    const wert = path.resolve(k).toLowerCase()
    return wert === ziel || wert.startsWith(ziel + path.sep)
  }
  return kandidaten.some(trifft)
}

function einstellungenSpeichern (p, opts, my) {
  /*
   * Die fest verlinkte Bot-Datei gehoert zum jeweils verwalteten Server.
   * Zeigt sie in einen fremden Ordner (etwa den des bisherigen Repacks),
   * wuerde die Bot-Seite weiter die Datei eines anderen Servers
   * bearbeiten. Innerhalb des eigenen Servers bleibt der Verweis erhalten.
   */
  const altBot = String((store.read().server || {}).botFile || '')
  const botFileImZiel =
    !altBot || altBot.toLowerCase().startsWith(path.resolve(p.root).toLowerCase() + path.sep)

  const patch = {
    server: {
      rootDir: p.root,
      workDir: p.bin,
      worldExe: path.join(p.bin, 'worldserver.exe'),
      authExe: path.join(p.bin, 'authserver.exe'),
      worldConfDir: p.configs,
      authConfDir: p.configs,
      // Fremde Bot-Datei (alter Server/Repack) abkoppeln - '' schaltet die
      // automatische Suche im neuen Server wieder ein.
      botFile: botFileImZiel ? altBot : '',
      mysqlServer: {
        exe: path.join(p.mysql, 'bin', 'mysqld.exe'),
        dataDir: p.mysqlData,
        defaultsFile: p.myIni,
        port: my.port,
        serviceName: '',
        extraArgs: ''
      }
    },
    mysql: {
      host: '127.0.0.1',
      port: my.port,
      user: DB_USER,
      password: my.dbPasswort,
      authDb: DB.auth,
      charDb: DB.chars,
      worldDb: DB.world
    },
    soap: {
      enabled: true,
      host: (opts.soap && opts.soap.host) || '127.0.0.1',
      port: Number(opts.soap && opts.soap.port) || SOAP_STANDARD_PORT,
      user: (opts.soap && opts.soap.user) || SOAP_USER,
      password: (opts.soap && opts.soap.password) || ''
    }
  }
  store.write(patch)
  protokoll('Einstellungen des Panels wurden übernommen.', 'STEP')
  return patch
}

/* ------------------------------------------------------------- Schritte */

async function schrittVorbereiten (p, opts) {
  await fsp.mkdir(p.root, { recursive: true })
  for (const dir of [p.deps, p.downloads, p.logs, p.data]) {
    await fsp.mkdir(dir, { recursive: true })
  }
  const frei = await freierPlatz(p.root)
  if (frei !== null) {
    const gb = frei / 1024 / 1024 / 1024
    protokoll(`Freier Speicherplatz: ${gb.toFixed(1)} GB`)
    if (gb < 25) {
      protokoll(
        'Weniger als 25 GB frei. Quellcode, Build, Clientdaten und Datenbank brauchen deutlich mehr Platz.',
        'WARN'
      )
    }
  }
  /*
   * Läuft vom bestehenden Stand noch ein Server, stoppen wir ihn hier: Der
   * Build kann eine laufende worldserver.exe nicht überschreiben und die
   * Datenbank-Einrichtung braucht den Port. Was vorher lief, wird in
   * schrittFertig wieder angestellt; die Datenbank regelt mySqlVorbereiten.
   */
  const statusVor = serverManager.status()
  lauf.vorher = {}
  for (const k of ['world', 'auth']) {
    lauf.vorher[k] = !!(statusVor[k] && statusVor[k].running)
    if (lauf.vorher[k]) {
      protokoll(`Beende ${k === 'world' ? 'den Worldserver' : 'den Authserver'} für die Einrichtung ...`, 'STEP')
      try { serverManager.stop(k) } catch (_) {}
    }
  }

  schreibeZustand(p.root, {
    version: 1,
    root: p.root,
    running: true,
    startedAt: lauf.startedAt,
    options: oeffentlicheOptionen(opts),
    soap: opts.soap,
    steps: lauf.steps
  })
}

async function schrittWerkzeuge (p, opts) {
  await werkzeugeSichern(p.root, opts)
  schreibeZustand(p.root, {
    ...(leseZustand(p.root) || {}),
    running: true,
    options: oeffentlicheOptionen(opts),
    werkzeuge: opts.werkzeuge,
    steps: lauf.steps
  })
}

async function schrittMySql (p, opts) {
  const my = await mySqlVorbereiten(p, opts)
  schreibeZustand(p.root, {
    ...(leseZustand(p.root) || {}),
    running: true,
    options: oeffentlicheOptionen(opts),
    mysqlRootPassword: my.rootPasswort,
    dbPassword: my.dbPasswort,
    mysqlPort: my.port,
    steps: lauf.steps
  })
}

async function schrittQuelle (p, opts) {
  await quelleSichern(p, opts)
}

async function schrittKonfigurieren (p, opts) {
  await konfigurieren(p, opts)
}

async function schrittBauen (p, opts) {
  await bauen(p, opts)
}

async function schrittDaten (p, opts) {
  await clientDatenSichern(p, opts)
}

/*
 * Offizielles Bot-Modul in den Quellbaum legen, VOR dem Konfigurieren -
 * dann baue ich den Kern nur einmal, mit Bots drin. Nachtraeglich
 * einschalten wuerde einen zweiten vollen Build bedeuten.
 */
const PLAYERBOTS_REPO = 'https://github.com/mod-playerbots/mod-playerbots.git'

async function schrittPlayerbots (p, opts) {
  if (opts.playerbots !== true) {
    protokoll('Playerbots-Modul nicht angefordert - übersprungen.', 'INFO')
    return
  }
  const ziel = path.join(p.source, 'modules', 'playerbots')
  const git = opts.werkzeuge.git
  if (istOrdner(path.join(ziel, '.git'))) {
    protokoll('Playerbots-Modul vorhanden - aktualisiere es ...', 'STEP')
    await run(git, ['-C', ziel, 'pull', '--ff-only'], { allowFail: true, timeoutMs: 15 * 60 * 1000 })
  } else {
    protokoll(`Klone mod-playerbots (${PLAYERBOTS_REPO}) ...`, 'STEP')
    await fsp.mkdir(path.dirname(ziel), { recursive: true })
    await run(git, ['clone', '--depth', '1', PLAYERBOTS_REPO, ziel], {
      cwd: p.source,
      timeoutMs: 45 * 60 * 1000
    })
  }
  await run(git, ['-C', ziel, 'submodule', 'update', '--init', '--recursive'], {
    allowFail: true,
    timeoutMs: 30 * 60 * 1000
  })
  protokoll('Playerbots-Modul bereit - wird beim Übersetzen mit eingebaut.', 'STEP')
}

/*
 * Endkontrolle nach dem Datenbankimport: alles pruefen, was spaeter zu
 * frustrierenden Fehlern fuehrt, wenn es fehlt. Der Server wird dafuer
 * einmal gestartet und sauber beendet - dann stimmen am Ende alle Werte.
 */
async function schrittSelbsttest (p, opts) {
  const my = lauf.mysql
  if (!my) throw new Error('MySQL-Zustand fehlt - der Selbsttest braucht die Datenbank.')

  // 1. Datenbank erreichbar und Realm eingetragen
  let conn
  try {
    conn = await mysqlVerbinden(my.port, DB_USER, my.dbPasswort, DB.auth)
  } catch (_) {
    conn = await mysqlVerbinden(my.port, 'root', my.rootPasswort, DB.auth)
  }
  let realmName = ''
  try {
    const [realm] = await conn.query('SELECT name FROM realmlist WHERE id = 1')
    realmName = realm.length ? realm[0].name : ''
    if (!realmName) throw new Error('Der Realm wurde nicht in die Datenbank eingetragen.')
    protokoll(`Selbsttest: Datenbank erreichbar, Realm "${realmName}" vorhanden.`, 'STEP')

    if (opts.soap && opts.soap.user) {
      const [konto] = await conn.query('SELECT id FROM account WHERE username = ?', [opts.soap.user])
      if (konto.length) {
        const [zugang] = await conn.query('SELECT gmlevel FROM account_access WHERE id = ?', [konto[0].id])
        const stufe = zugang.length ? Number(zugang[0].gmlevel) : 0
        protokoll(
          stufe >= SOAP_GMLEVEL
            ? `Selbsttest: SOAP-Konto "${opts.soap.user}" hat GM-Stufe ${stufe}.`
            : `Selbsttest: WARNUNG - SOAP-Konto "${opts.soap.user}" hat nur GM-Stufe ${stufe}.`,
          stufe >= SOAP_GMLEVEL ? 'STEP' : 'WARN'
        )
      } else {
        protokoll(`Selbsttest: WARNUNG - SOAP-Konto "${opts.soap.user}" fehlt in der Datenbank.`, 'WARN')
      }
    }
  } finally {
    await conn.end().catch(() => {})
  }

  // 2. Konfiguration: SOAP an, Datenordner da
  const world = path.join(p.configs, 'worldserver.conf')
  if (istDatei(world)) {
    const text = fs.readFileSync(world, 'utf8')
    const soapAn = /^\s*SOAP\.Enabled\s*=\s*1/im.test(text)
    const soapPort = Number((/^\s*SOAP\.Port\s*=\s*(\d+)/im.exec(text) || [])[1])
    protokoll(
      soapAn
        ? `Selbsttest: SOAP ist in worldserver.conf aktiv (Port ${soapPort || '?'}).`
        : 'Selbsttest: WARNUNG - SOAP.Enabled ist nicht gesetzt, die Konsole bleibt ohne Funktion.',
      soapAn ? 'STEP' : 'WARN'
    )
  }
  const datenOk = ['dbc', 'maps', 'vmaps', 'mmaps'].every(n => istOrdner(path.join(p.data, n)))
  protokoll(
    datenOk ? 'Selbsttest: Clientdaten (dbc/maps/vmaps/mmaps) vorhanden.' : 'Selbsttest: WARNUNG - Clientdaten unvollständig, der Worldserver wird ohne Karten nicht starten.',
    datenOk ? 'STEP' : 'WARN'
  )

  // 3. Realer Startversuch: einmal hochfahren, per SOAP gruessen, beenden
  let worldGestartet = false
  let worldVomTest = false
  try {
    const world = await serverManager.start('world')
    worldGestartet = !!(world && world.ok)
    if (!worldGestartet && world && /läuft bereits/i.test(world.error || '')) {
      // Läuft schon (z. B. aus einer frueheren Sitzung uebernommen) - fuer
      // den Test benutzen, aber NICHT wieder beenden.
      worldGestartet = true
      worldVomTest = false
      protokoll('Selbsttest: Worldserver lief bereits - wird für den Test benutzt.', 'INFO')
    }
    if (!worldGestartet) {
      protokoll(`Selbsttest: WARNUNG - Worldserver-Start: ${world.error}`, 'WARN')
      return
    }
    if (worldGestartet && world && world.ok) worldVomTest = true
    // Die Welt braucht bis zu einer Minute fuer DBC und Karten.
    let worldBereit = false
    for (let i = 0; i < 40 && !worldBereit; i++) {
      await sleep(3000)
      worldBereit = await portOffen(8085)
    }
    if (!worldBereit) {
      protokoll('Selbsttest: WARNUNG - Worldserver nimmt Port 8085 nicht an (Clientdaten prüfen).', 'WARN')
      return
    }
    protokoll('Selbsttest: Worldserver läuft.', 'STEP')

    const auth = await serverManager.start('auth')
    let authVomTest = false
    let authLaueft = !!(auth && auth.ok)
    if (!authLaueft && auth && /läuft bereits/i.test(auth.error || '')) authLaueft = true
    if (auth && auth.ok) authVomTest = true
    let authBereit = authLaueft
    if (authLaueft) {
      for (let i = 0; i < 20 && !authBereit; i++) {
        await sleep(1500)
        authBereit = await portOffen(3724)
      }
      protokoll(authBereit ? 'Selbsttest: Authserver läuft.' : 'Selbsttest: WARNUNG - Authserver nimmt Port 3724 nicht an.', authBereit ? 'STEP' : 'WARN')
    }

    // 4. SOAP-Anmeldung mit den echten Zugangsdaten probieren
    if (opts.soap && worldBereit) {
      try {
        const soap = require('./soap')
        const altStore = store.read()
        if (!altStore.soap || altStore.soap.password !== opts.soap.password) {
          store.write({ soap: { ...opts.soap } })
        }
        const r = await soap.send('server info')
        protokoll(`Selbsttest: SOAP-Anmeldung erfolgreich - Konsole ist einsatzbereit.`, 'STEP')
        if (r && r.antwort) protokoll(`  ${String(r.antwort).split('\n')[0].trim()}`)
      } catch (e) {
        protokoll(`Selbsttest: WARNUNG - SOAP-Anmeldung fehlgeschlagen: ${e.message}`, 'WARN')
      }
    }
  } finally {
    // Nur Server, die der Test selbst gestartet hat, wieder beenden - ein
    // laufender Server des Nutzers bleibt unberuehrt.
    if (worldVomTest) {
      try { serverManager.stop('world') } catch (_) {}
    }
    if (authVomTest) {
      try { serverManager.stop('auth') } catch (_) {}
    }
    if (worldVomTest) {
      for (let i = 0; i < 10 && (await portOffen(8085)); i++) await sleep(1000)
    }
  }
}

async function schrittDatenbank (p, opts) {
  const my = lauf.mysql || (await mySqlVorbereiten(p, opts))
  await datenbankImportieren(p, opts, my)
  schreibeZustand(p.root, {
    ...(leseZustand(p.root) || {}),
    running: true,
    options: oeffentlicheOptionen(opts),
    steps: lauf.steps
  })
}

async function schrittFertig (p, opts) {
  const my = lauf.mysql
  if (!my) throw new Error('MySQL-Zustand fehlt - die Datenbank wurde nicht eingerichtet.')

  einstellungenSpeichern(p, opts, my)

  // Das Installations-MySQL sauber beenden und anschliessend das Panel
  // starten lassen. Damit kennt die Prozessverwaltung die PID und der
  // Status in der Oberflaeche stimmt.
  await mySqlBeenden(p, my)
  await sleep(1200)
  const res = await serverManager.start('db')
  if (res && res.ok) {
    const bereit = await warteAufPort(my.port, 20000)
    protokoll(
      bereit
        ? `Datenbank läuft jetzt unter Kontrolle des Panels (Port ${my.port}).`
        : 'Datenbank wurde gestartet, antwortet aber noch nicht.',
      bereit ? 'STEP' : 'WARN'
    )
  } else {
    protokoll(
      `Datenbank konnte nicht an die Prozessverwaltung übergeben werden: ` +
        `${(res && res.error) || 'unbekannter Fehler'}.`,
      'WARN'
    )
  }

  /*
   * Was vor der Einrichtung lief, läuft wieder - der Server lädt den neuen
   * Stand beim Start selbst. Erst nach der Datenbank, die braucht der
   * Worldserver zum Hochfahren.
   */
  const vorher = lauf.vorher || {}
  if (vorher.world) {
    await sleep(1500)
    try {
      const w = await serverManager.start('world')
      protokoll(
        w && w.ok
          ? 'Worldserver läuft wieder (war vor der Einrichtung an).'
          : `WARNUNG: Worldserver-Start: ${(w && w.error) || 'unbekannt'} - über die Seite "Server" starten.`,
        w && w.ok ? 'STEP' : 'WARN'
      )
    } catch (e) {
      protokoll(`Worldserver-Start fehlgeschlagen: ${e.message}.`, 'WARN')
    }
  }
  if (vorher.auth) {
    await sleep(1500)
    try {
      const a = await serverManager.start('auth')
      protokoll(
        a && a.ok
          ? 'Authserver läuft wieder (war vor der Einrichtung an).'
          : `WARNUNG: Authserver-Start: ${(a && a.error) || 'unbekannt'} - über die Seite "Server" starten.`,
        a && a.ok ? 'STEP' : 'WARN'
      )
    } catch (e) {
      protokoll(`Authserver-Start fehlgeschlagen: ${e.message}.`, 'WARN')
    }
  }

  schreibeZustand(p.root, {
    ...(leseZustand(p.root) || {}),
    version: 1,
    root: p.root,
    running: false,
    startedAt: lauf.startedAt,
    finishedAt: new Date().toISOString(),
    options: oeffentlicheOptionen(opts),
    werkzeuge: opts.werkzeuge,
    steps: lauf.steps
  })
  protokoll('Einrichtung abgeschlossen.', 'STEP')
}

/* --------------------------------------------------------------- Steuerung */

async function ausfuehren () {
  for (let i = 0; i < STEPS.length; i++) {
    checkAbort()
    const step = STEPS[i]
    setzeSchritt(i, 'running', `${step.key} ...`)
    await step.run(lauf.pfade, lauf.opts)
    setzeSchritt(i, 'ok', `${step.key} fertig.`)
  }
  lauf.percent = 100
}

async function checkUpdate (input = {}) {
  const root = normalisiereRoot(input.root)
  const p = pfade(root)
  if (!istOrdner(path.join(p.source, '.git'))) {
    return { ok: false, error: 'Kein Git-Repository gefunden. Bitte zuerst installieren.' }
  }

  /*
   * Drosselung: Der Dashboard-Hinweis prueft bei jedem Start, der Nutzer
   * kann zusaetzlich klicken. Die GitHub-API (Clientdaten-Release) ist
   * unauthentifiziert auf 60 Anfragen/Stunde begrenzt - danach sieht
   * alles wie "fehlgeschlagen" aus, obwohl nur gedrosselt wurde. Ohne
   * "erzwingen" gilt ein Ergebnis bis 10 Minuten als frisch.
   */
  if (input.erzwingen !== true) {
    try {
      const cache = (store.read().installerCache || {})
      const frisch = cache.zeit && cache.root === root &&
        (Date.now() - cache.zeit) < 10 * 60 * 1000 &&
        cache.ergebnis && cache.ergebnis.ok
      if (frisch) return { ...cache.ergebnis, ausCache: true }
    } catch (_) {}
  }

  const git = await findeGit(root)
  if (!git) return { ok: false, error: 'Git nicht gefunden.' }
  try {
    await run(git, ['-C', p.source, 'fetch', 'origin', QUELLE_BRANCH], { timeoutMs: 60000, allowFail: true })
  } catch (e) {
    return { ok: false, error: `Fetch fehlgeschlagen: ${e.message}` }
  }
  const r = await execCapture(git, ['-C', p.source, 'rev-list', 'HEAD..origin/' + QUELLE_BRANCH, '--count'])
  const anzahl = parseInt((r.out || '0').trim(), 10) || 0
  const lokal = await execCapture(git, ['-C', p.source, 'rev-parse', '--short', 'HEAD'])
  const remote = await execCapture(git, ['-C', p.source, 'rev-parse', '--short', 'origin/' + QUELLE_BRANCH])

  /*
   * Was bringt das Update? Die Commit-Betreffzeilen des Abstands - damit der
   * Nutzer entscheidet, ob sich die Bauzeit lohnt, ohne das Protokoll zu
   * raten. Auf 20 Zeilen begrenzt, das reicht zum Ueberfliegen.
   */
  let commits = []
  if (anzahl > 0) {
    try {
      const log = await execCapture(git, ['-C', p.source, 'log', '--oneline', `HEAD..origin/${QUELLE_BRANCH}`])
      commits = String(log.out || '')
        .split(/\r?\n/)
        .map(z => z.trim())
        .filter(Boolean)
        .slice(0, 20)
    } catch (_) {}
  }

  /*
   * Nebenbei pruefen, ob die geladenen Clientdaten noch zum aktuellen
   * Client-Data-Release passen. Schlagen die Karten fehl, sieht man hier
   * sofort den Grund - statt im Worldserver-Log zu graben.
   */
  let clientData = null
  try {
    const release = await Promise.race([
      hole('https://api.github.com/repos/wowgaming/client-data/releases/latest', { json: true }),
      new Promise((_, lehne) => setTimeout(() => lehne(new Error('Timeout')), 20000))
    ])
    const geladen = clientDatenVersion(p)
    clientData = {
      geladen: geladen || 'unbekannt',
      remote: release.tag_name || '',
      aktuell: !!geladen && geladen === (release.tag_name || '')
    }
  } catch (e) {
    // 403 = GitHub-Drosselung. Meldbar machen, statt still kein Ergebnis zu
    // liefern - sonst glaubt der Nutzer, alles sei aktuell.
    if (/HTTP 403/.test(String(e && e.message))) {
      clientData = { geladen: clientDatenVersion(p) || 'unbekannt', remote: '', aktuell: false, gedrosselt: true }
    }
  }

  const ergebnis = {
    ok: true,
    verfuegbar: anzahl > 0,
    anzahl,
    lokal: (lokal.out || '').trim(),
    remote: (remote.out || '').trim(),
    commits,
    clientData
  }
  try {
    store.write({ installerCache: { zeit: Date.now(), root, ergebnis } })
  } catch (_) {}
  return ergebnis
}

/*
 * Fremd-Dump ziehen: probiert die Kandidaten-Namen der Reihe nach und
 * meldet den gefundenen Namen zurück. Ein fehlgeschlagener Versuch hinter-
 * lässt eine halbe Dump-Datei - die wird sofort entfernt.
 */
async function dumpFremdDb (dumpExe, clientArgs, kandidaten, zielDatei) {
  let letzterFehler = null
  for (const name of kandidaten) {
    const r = await run(dumpExe, [
      ...clientArgs,
      '--databases', name,
      '--single-transaction', '--quick',
      '--default-character-set=utf8mb4',
      `--result-file=${zielDatei}`
    ], { cwd: path.dirname(dumpExe), timeoutMs: 30 * 60 * 1000, allowFail: true })
    if (r.code === 0) return name
    try { fs.rmSync(zielDatei, { force: true }) } catch (_) {}
    letzterFehler = (r.err || '').trim().split(/\r?\n/).slice(-2).join(' ') || `Code ${r.code}`
  }
  throw new Error(
    `Keine der Datenbanken (${kandidaten.join(', ')}) war im alten Server zu finden. ` +
    `Letzter Fehler: ${letzterFehler}`
  )
}

/*
 * Die MySQL des ALTEN Servers nur lesend starten: eigene temporäre my.ini
 * mit deren eigene mysqld.exe. Die Daten des alten Servers bleiben
 * unangetastet; beenden() fährt die Instanz sauber herunter.
 *
 * WICHTIG zum Verbindungsweg: Ab MySQL 8.0.34 schaltet skip-grant-tables
 * TCP/IP zwangsweise ab (skip-networking lässt sich NICHT mehr übersteuern
 * - getestet gegen 8.4.7). Der Verbindungsweg ist deshalb SHARED MEMORY,
 * was nur lokal möglich ist - genau hier. Eigener base-name, damit eine
 * Parallel-Instanz nicht kollidiert.
 */
/*
 * Ist der gewählte Ordner die MySQL DIESER Panel-Installation? Dann ist
 * "der alte Server" der eigene - die Standard-Meldung ("läuft noch") wäre
 * irreführend, und der Nutzer sucht am falschen Ende.
 */
function istEigeneMySql (mysqlOrdner) {
  try {
    const exe = (((store.read().server || {}).mysqlServer || {}).exe) || ''
    if (!exe) return false
    // Die eigene mysqld.exe liegt unter <mysql>\bin - der gewählte Ordner
    // ist <mysql> (oder auch <mysql>\bin). Präfix-Vergleich deckt beides ab.
    const a = path.resolve(mysqlOrdner).toLowerCase()
    const b = path.resolve(exe).toLowerCase()
    return b === a || b.startsWith(a + path.sep)
  } catch (_) {
    return false
  }
}

function eigeneMySqlFehler () {
  return new Error(
    'Das ist die MySQL dieser Panel-Installation, nicht die des alten Servers. ' +
      'Bitte den MySQL-Ordner des ALTEN Servers wählen (z. B. ...\\AltServer\\mysql).'
  )
}

/*
 * Läuft aus dem gewählten Fremd-Ordner noch ein Server? Nur Prozesse, deren
 * ExecutablePath unter dem Fremd-Ordner liegt, gelten - die eigene
 * Installation und Dienste von woanders stören nicht. Win32_Process liefert
 * den Pfad, tasklist nicht.
 */
async function fremdProzesseLaeufen (mysqlOrdner) {
  const gefunden = []
  try {
    const r = await execCapture(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-CimInstance Win32_Process -Filter "Name=\'mysqld.exe\' OR Name=\'worldserver.exe\' OR Name=\'authserver.exe\'" | ForEach-Object { $_.ExecutablePath }'],
      { timeoutMs: 30000 }
    )
    const basis = slash(mysqlOrdner).toLowerCase()
    for (const zeile of String(r && (r.out || '')).split(/\r?\n/)) {
      const pfad = zeile.trim()
      if (!pfad) continue
      if (slash(pfad).toLowerCase().startsWith(basis)) {
        gefunden.push(path.basename(pfad))
      }
    }
  } catch (_) {}
  return gefunden
}

async function fremdMysqlStarten (mysqlOrdner, fremdDatadir, downloadsDir, logsDir) {
  const fremdMysqld = path.join(mysqlOrdner, 'bin', 'mysqld.exe')
  if (!istDatei(fremdMysqld)) {
    throw new Error(`Kein mysqld.exe gefunden: ${fremdMysqld} - bitte den MySQL-Ordner des alten Servers wählen (z. B. ...\\mysql).`)
  }
  if (!istOrdner(fremdDatadir)) {
    throw new Error(`Kein Datenverzeichnis gefunden: ${fremdDatadir} - der alte Server war vermutlich nie gestartet.`)
  }

  const ini = path.join(downloadsDir, 'fremd-my.ini')
  await fsp.mkdir(downloadsDir, { recursive: true })
  fs.writeFileSync(ini, [
    '[mysqld]',
    `basedir="${slash(mysqlOrdner)}"`,
    `datadir="${slash(fremdDatadir)}"`,
    'skip-networking',
    'skip-grant-tables',
    'shared-memory',
    'mysqlx=OFF',
    `log-error="${slash(path.join(logsDir, 'fremd-mysql.err'))}"`,
    ''
  ].join('\r\n'), 'utf8')
  protokoll('Starte die MySQL des alten Servers (nur lesend, über Shared Memory) ...', 'STEP')

  const kind = spawn(fremdMysqld, [`--defaults-file=${ini}`], {
    cwd: mysqlOrdner,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  kind.stdout.on('data', d => { for (const z of dekodiere(d).split(/\r?\n/)) if (z.trim()) protokoll(z.trimEnd(), 'MYSQL') })
  kind.stderr.on('data', d => { for (const z of dekodiere(d).split(/\r?\n/)) if (z.trim()) protokoll(z.trimEnd(), 'MYSQL') })

  /*
   * Warten bis die Instanz Abfragen beantwortet: der Shared-Memory-Weg hat
   * keinen Port, also probieren wir SHOW DATABASES bis es klappt (der
   * InnoDB-Aufbau dauert einige Sekunden).
   *
   * Kein eigener base-name: der Server nutzt den Standard "MYSQL" - eine
   * base-name-Variante hat sich in der Praxis als unzuverlässig erwiesen
   * (Client/Server-Finde-Problem). Kollision mit der eigenen Instanz ist
   * ausgeschlossen, weil unsere my.ini shared-memory nicht aktiviert.
   */
  const clientArgs = ['-uroot', '--protocol=memory']
  const mysqlProbe = path.join(mysqlOrdner, 'bin', 'mysql.exe')
  let bereit = false
  for (let i = 0; i < 60 && !bereit; i++) {
    await sleep(1000)
    try {
      const r = await run(mysqlProbe, [...clientArgs, '-N', '-B', '-e', 'SELECT 1'], {
        allowFail: true,
        timeoutMs: 10000
      })
      if (r.code === 0) bereit = true
    } catch (_) {}
  }
  if (!bereit) {
    try { killTree(kind.pid) } catch (_) {}
    throw new Error(
      'Die MySQL des alten Servers nimmt keine Verbindungen an. Details im Protokoll (fremd-mysql.err). ' +
      'Scheitert der Start an fehlenden DLLs (z. B. VCRUNTIME140.dll), das Visual-C++-Redistributable ' +
      '2015-2022 (x64) installieren und erneut versuchen.'
    )
  }

  return {
    clientArgs,
    beenden: async () => {
      try { killTree(kind.pid) } catch (_) {}
      for (let i = 0; i < 25 && kind.exitCode === null; i++) await sleep(400)
    }
  }
}

/*
 * Datenbanknamen auf dem fremden Server ermitteln (Repacks benennen die
 * DBs unterschiedlich). Liefert die ersten Treffer aus den Kandidatenlisten.
 */
async function fremdDbsErmitteln (mysqlExe, clientArgs) {
  const r = await run(mysqlExe, [...clientArgs, '-N', '-B', '-e', 'SHOW DATABASES'],
    { allowFail: true, timeoutMs: 30000 })
  const vorhanden = (r.out || '').split(/\r?\n/).map(z => z.trim()).filter(Boolean)
  const wähle = kandidaten => kandidaten.find(k => vorhanden.includes(k)) || null
  return {
    charsDb: wähle(['acore_characters', 'characters', 'char']),
    authDb: wähle(['acore_auth', 'auth', 'realmd']),
    botsDb: wähle(['acore_playerbots', 'playerbots']),
    worldDb: wähle(['acore_world', 'world'])
  }
}

/*
 * Zeilenzahl einer Tabelle auf dem fremden Server lesen (-N -B liefert nur
 * die Zahl). Tabelle fehlt oder Abfrage schlägt fehl -> -1.
 */
async function fremdZaehle (mysqlExe, clientArgs, db, tab) {
  const r = await run(mysqlExe, [...clientArgs, '-N', '-B',
    '-e', `SELECT COUNT(*) AS c FROM \`${db}\`.\`${tab}\``
  ], { allowFail: true, timeoutMs: 30000 })
  if (r.code !== 0) return -1
  const n = parseInt((r.out || '').trim(), 10)
  return Number.isFinite(n) ? n : -1
}

/*
 * Grobe Größe einer fremden Datenbank (Daten + Indizes, MB). -1 wenn nicht
 * lesbar. In der Vorschau entscheidet sie mit, ob sich eine Welt-Übernahme
 * lohnt und wie lange sie dauert.
 */
async function fremdGroesseMb (mysqlExe, clientArgs, db) {
  const r = await run(mysqlExe, [...clientArgs, '-N', '-B',
    '-e', `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024) AS mb FROM information_schema.tables WHERE table_schema = '${String(db).replace(/'/g, "''")}'`
  ], { allowFail: true, timeoutMs: 30000 })
  if (r.code !== 0) return -1
  const n = parseInt((r.out || '').trim(), 10)
  return Number.isFinite(n) ? n : -1
}

/*
 * Vorab-Zählung: Was ist im alten Server drin? Startet dessen MySQL nur
 * lesend, zählt Charaktere und Konten, fährt wieder herunter. Der Nutzer
 * sieht vor dem Bestätigen, was die Übernahme bringen würde.
 */
async function fremdDbZaehlen (input = {}) {
  if (startLaeuft || (lauf && lauf.running)) {
    throw new Error('Es läuft bereits eine Einrichtung oder Übernahme.')
  }
  zaehlLaeuft = true
  const mysqlOrdner = normalisiereRoot(input.mysqldOrdner)
  const fremdDatadir = input.datadir ? path.resolve(input.datadir) : path.join(mysqlOrdner, 'data')
  const p = pfade(normalisiereRoot((store.read().server || {}).rootDir || ''))
  let instanz = null
  try {
    if (istEigeneMySql(mysqlOrdner)) throw eigeneMySqlFehler()
    /*
     * Läuft der alte Server noch, sind seine Datendateien gesperrt: der
     * zweite mysqld kommt nicht an InnoDB heran und der Lauf scheitert
     * erst nach 60 Sekunden Warten. Die klare Meldung kommt lieber vorher.
     */
    const laufende = await fremdProzesseLaeufen(mysqlOrdner)
    if (laufende.includes('mysqld.exe')) {
      throw new Error(
        `Der alte Server läuft noch: mysqld.exe aus ${mysqlOrdner}. ` +
          'Solange die alte MySQL läuft, sind ihre Datendateien gesperrt. ' +
          'Bitte zuerst den alten Worldserver beenden (damit stoppt auch seine MySQL) und es erneut versuchen.'
      )
    }
    if (laufende.length) {
      protokoll(`Hinweis: vom alten Server laufen noch ${laufende.join(', ')} - die Zählung sieht den laufenden Stand.`, 'WARN')
    }
    // Ordner merken: die Karte füllt ihn beim nächsten Mal vor
    try { store.write({ migration: { letzterOrdner: mysqlOrdner } }) } catch (_) {}
    instanz = await fremdMysqlStarten(mysqlOrdner, fremdDatadir, p.downloads, p.logs)
    const mysqlExe = path.join(p.mysql, 'bin', 'mysql.exe')
    if (!istDatei(mysqlExe)) throw new Error('mysql.exe fehlt im eigenen MySQL-Ordner.')
    const dbs = await fremdDbsErmitteln(mysqlExe, instanz.clientArgs)
    if (!dbs.charsDb) throw new Error('Keine Charakter-Datenbank auf dem alten Server gefunden (acore_characters/characters/char).')
    const charaktere = await fremdZaehle(mysqlExe, instanz.clientArgs, dbs.charsDb, 'characters')
    const konten = dbs.authDb ? await fremdZaehle(mysqlExe, instanz.clientArgs, dbs.authDb, 'account') : -1
    // Weltdatenbank-Vorschau: creature_template ist die grobe Größe des
    // Custom-Inhalts - hilft bei der Entscheidung für die Welt-Übernahme.
    const welten = dbs.worldDb ? await fremdZaehle(mysqlExe, instanz.clientArgs, dbs.worldDb, 'creature_template') : -1
    const groessen = {
      charsMb: dbs.charsDb ? await fremdGroesseMb(mysqlExe, instanz.clientArgs, dbs.charsDb) : -1,
      authMb: dbs.authDb ? await fremdGroesseMb(mysqlExe, instanz.clientArgs, dbs.authDb) : -1,
      botsMb: dbs.botsDb ? await fremdGroesseMb(mysqlExe, instanz.clientArgs, dbs.botsDb) : -1,
      worldMb: dbs.worldDb ? await fremdGroesseMb(mysqlExe, instanz.clientArgs, dbs.worldDb) : -1
    }
    protokoll(
      `Vorab-Zählung: ${charaktere} Charaktere, ${konten < 0 ? '?' : konten} Konten` +
        `${welten >= 0 ? `, ${welten} Welt-Einträge` : ''} (${dbs.charsDb}).`,
      'STEP'
    )
    /*
     * Hat die ZIEL-Installation das Playerbots-Modul? Ohne Modul werden
     * übernommene Bot-DB und playerbots.conf wirkungslos - der Hinweis
     * gehört in die Vorschau, nicht in die Überraschung danach.
     */
    let zielBots = false
    try {
      zielBots = istDatei(path.join(p.configs, 'modules', 'playerbots.conf'))
    } catch (_) {}
    return {
      ok: true, charaktere, konten, welten,
      charsDb: dbs.charsDb, worldDb: dbs.worldDb || '',
      botsDb: dbs.botsDb || '', zielBots,
      groessen
    }
  } finally {
    if (instanz) await instanz.beenden()
    zaehlLaeuft = false
  }
}

let zaehlLaeuft = false

/*
 * Charaktere vom alten Server übernehmen. Ein fremder Server-Ordner (z. B.
 * der alte Repack) bringt eine eigene MySQL-Installation mit eigener
 * Datenbank mit. Dieses Werkzeug startet DIESE MySQL-Instanz kurzzeitig
 * auf einem freien Port (ohne deren Konfiguration oder Daten zu verändern,
 * ohne deren root-Passwort zu brauchen: --skip-grant-tables), sichert
 * acore_characters in eine Datei und spielt sie in die eigene Datenbank.
 *
 * Sicherheit: Vor dem Einspielen läuft backup.create() - der aktuelle
 * Stand ist damit immer zurückholbar. Schema-Unterschiede zwischen alter
 * und neuer Core-Version richtet der Weltserver beim nächsten Start selbst
 * (Updates.AutoSetup = 1 steht in der worldserver.conf).
 */
async function fremdDbUebernehmen (input = {}) {
  if (startLaeuft || (lauf && lauf.running)) {
    throw new Error('Es läuft bereits eine Einrichtung.')
  }
  const mysqlOrdner = normalisiereRoot(input.mysqldOrdner)
  const fremdDatadir = input.datadir ? path.resolve(input.datadir) : path.join(mysqlOrdner, 'data')
  const db = String(input.db || 'acore_characters').trim() || 'acore_characters'
  const ziel = String(input.zielDb || '').trim() || (store.read().mysql || {}).charDb || 'acore_characters'

  if (!istDatei(path.join(mysqlOrdner, 'bin', 'mysqld.exe'))) {
    throw new Error(`Kein mysqld.exe gefunden: ${path.join(mysqlOrdner, 'bin', 'mysqld.exe')} - bitte den MySQL-Ordner des alten Servers wählen (z. B. ...\\mysql).`)
  }
  if (!istOrdner(fremdDatadir)) {
    throw new Error(`Kein Datenverzeichnis gefunden: ${fremdDatadir} - der alte Server war vermutlich nie gestartet.`)
  }

  /*
   * Läuft der alte Server noch, sind seine Datendateien gesperrt: der
   * zweite mysqld kommt nicht an InnoDB heran und der Lauf scheitert erst
   * nach 60 Sekunden Warten. Die klare Meldung kommt lieber vorher.
   * Davor: der eigene MySQL-Ordner ist kein "alter Server".
   */
  if (istEigeneMySql(mysqlOrdner)) throw eigeneMySqlFehler()
  const laufendeProzesse = await fremdProzesseLaeufen(mysqlOrdner)
  if (laufendeProzesse.includes('mysqld.exe')) {
    throw new Error(
      `Der alte Server läuft noch: mysqld.exe aus ${mysqlOrdner}. ` +
        'Solange die alte MySQL läuft, sind ihre Datendateien gesperrt. ' +
        'Bitte zuerst den alten Worldserver beenden (damit stoppt auch seine MySQL) und es erneut versuchen.'
    )
  }
  if (laufendeProzesse.length) {
    protokoll(`Hinweis: vom alten Server laufen noch ${laufendeProzesse.join(', ')} - der übernommene Stand ist der laufende.`, 'WARN')
  }

  // Ordner merken: die Karte füllt ihn beim nächsten Mal vor (der Pfad
  // ändert sich praktisch nie, der Repack bleibt der Repack).
  try { store.write({ migration: { letzterOrdner: mysqlOrdner } }) } catch (_) {}

  startLaeuft = true
  const p = pfade(normalisiereRoot((store.read().server || {}).rootDir || ''))
  await fsp.mkdir(p.logs, { recursive: true })
  const logPfad = path.join(p.logs, `uebernahme-${zeitstempel()}.log`)

  // Klein enough Protokoll an das Fenster, damit die Oberfläche mitliest.
  lauf = {
    running: true, root: p.root, opts: {}, pfade: p,
    startedAt: new Date().toISOString(), finishedAt: '', cancelled: false, abgebrochen: false,
    error: '', child: null, mysql: null, stepIndex: 0, stepKey: 'uebernahme', percent: 0, log: [],
    logDatei: logPfad,
    steps: [{ key: 'uebernahme', state: 'running' }]
  }
  emit({ type: 'status', status: kurzStatus() })

  /*
   * Zeitmessung je Stufe: beim Planen eines Umzugs (und beim Live-Test)
   * die wichtigste Zahl - bisher stand weder im Protokoll noch in der
   * Ergebnis-Karte, wie lange Dump, Sicherung oder Importe dauern.
   */
  let marke = Date.now()
  const seit = () => {
    const d = Date.now() - marke
    marke = Date.now()
    const min = Math.floor(d / 60000)
    const sek = Math.round((d - min * 60000) / 1000)
    return `${min}:${String(sek).padStart(2, '0')} min`
  }
  const gesamtStart = Date.now()
  const gesamt = () => {
    const d = Date.now() - gesamtStart
    const min = Math.floor(d / 60000)
    const sek = Math.round((d - min * 60000) / 1000)
    return `${min}:${String(sek).padStart(2, '0')} min`
  }

  let instanz = null
  try {
    protokoll('Starte die MySQL des alten Servers (nur lesend, über Shared Memory) ...', 'STEP')
    instanz = await fremdMysqlStarten(mysqlOrdner, fremdDatadir, p.downloads, p.logs)
    lauf.percent = 5
    emit({ type: 'status', status: kurzStatus() })

    const mysqlExe = path.join(p.mysql, 'bin', 'mysql.exe')
    if (!istDatei(mysqlExe)) throw new Error('mysql.exe fehlt im eigenen MySQL-Ordner.')
    const dbs = await fremdDbsErmitteln(mysqlExe, instanz.clientArgs)
    if (!dbs.charsDb) throw new Error('Keine Charakter-Datenbank auf dem alten Server gefunden (acore_characters/characters/char).')
    if (dbs.charsDb !== db) protokoll(`Die Charakter-Datenbank heißt auf dem alten Server "${dbs.charsDb}" - benutze sie.`, 'INFO')
    const quellCharaktere = await fremdZaehle(mysqlExe, instanz.clientArgs, dbs.charsDb, 'characters')
    const quellKonten = dbs.authDb ? await fremdZaehle(mysqlExe, instanz.clientArgs, dbs.authDb, 'account') : -1
    // Welt-Vergleichsgröße: creature_template. Wird nach der Übernahme gegen
    // die Ziel-Zahl gestellt - sonst sieht man nicht, ob der Custom-Inhalt da ist.
    const quellWelt = dbs.worldDb ? await fremdZaehle(mysqlExe, instanz.clientArgs, dbs.worldDb, 'creature_template') : -1
    lauf.percent = 15
    emit({ type: 'status', status: kurzStatus() })
    protokoll(`Quellstand: ${quellCharaktere < 0 ? '?' : quellCharaktere} Charaktere, ${quellKonten < 0 ? '?' : quellKonten} Konten.`, 'STEP')

    // 3. Dump ziehen (Zugang egal: skip-grant-tables lässt jede Anmeldung zu)
    const dump = path.join(p.mysql, 'bin', 'mysqldump.exe')
    if (!istDatei(dump)) throw new Error('mysqldump.exe fehlt im eigenen MySQL-Ordner.')
    const dumpDatei = path.join(p.downloads, `uebernahme-${db}-${zeitstempel()}.sql.gz`)
    protokoll(`Sichere ${dbs.charsDb} aus dem alten Server ...`, 'STEP')
    await dumpFremdDb(dump, instanz.clientArgs, [dbs.charsDb], dumpDatei)
    const groesse = await dateiGroesse(dumpDatei)
    protokoll(`Dump fertig: ${(groesse / 1024 / 1024).toFixed(1)} MB (dauerte ${seit()})`, 'STEP')
    // Grobe Bewegung in der Anzeige: Dump = 40 %, Einspielen = 80 %
    lauf.percent = 40
    emit({ type: 'status', status: kurzStatus() })

    /*
     * 4. Eigene Datenbank bereitstellen: Sicherung UND Import gehen als
     * SQL-Client an die eigene Instanz - ist sie aus (etwa nach einem
     * Panel-Neustart), wird sie hier angeworfen statt den Lauf abzubrechen.
     */
    const ownPort = Number((store.read().mysql || {}).port) || 3306
    const statusDb = serverManager.status()
    if (!(statusDb.db && statusDb.db.running)) {
      protokoll('Eigene Datenbank läuft nicht - starte sie (Sicherung und Import brauchen sie) ...', 'STEP')
      await serverManager.start('db')
      const bereit = await warteAufPort(ownPort, 20000)
      if (!bereit) {
        throw new Error('Die eigene Datenbank startet nicht - bitte auf der Seite "Server" prüfen (Port, Passwort).')
      }
    }

    /*
     * 5. Sicherheitssicherung ZUERST - bei laufender Datenbank. Die alte
     * Reihenfolge (DB stoppen, dann sichern) brach immer an create() ab,
     * weil die Sicherung die Datenbank selbst braucht. Der Stempel wird
     * gemerkt: die Backup-Seite bietet danach den Rückhol-Knopf an.
     */
    protokoll('Sichere den aktuellen Stand (Rückholbarkeit) ...', 'STEP')
    const sicherung = await require('./backup').create()
    if (sicherung && sicherung.stamp) {
      store.write({ migration: { backupStamp: sicherung.stamp, zeit: new Date().toISOString() } })
      protokoll(`Sicherungs-Stempel ${sicherung.stamp} gemerkt - der Stand vor der Übernahme bleibt auf der Backup-Seite direkt wiederherstellbar.`, 'STEP')
    }
    protokoll(`Sicherung dauerte ${seit()}.`, 'INFO')
    lauf.percent = 50
    emit({ type: 'status', status: kurzStatus() })

    /*
     * 6. World- und Authserver beenden, NICHT die Datenbank: Der Worldserver
     * hält Verbindungen zur Charakter-DB, die gleich ersetzt wird. Der
     * Import selbst braucht die Datenbank LAUFEND (er arbeitet als SQL-
     * Client) - eine Zwischen-Version stoppte sie und brach damit den Import.
     */
    const statusVor = serverManager.status()
    const lief = {}
    for (const k of ['world', 'auth']) {
      lief[k] = !!(statusVor[k] && statusVor[k].running)
    }

    /*
     * Sind echte Spieler online, gibt es eine Ansage im Spiel und eine
     * kurze Frist - niemand soll mitten im Kampf vom Server fliegen.
     * Bots zählen nicht (Leer-Check-Logik).
     */
    if (lief.world) {
      try {
        const echte = await require('./spieler').zaehleEchteSpieler()
        if (echte > 0) {
          protokoll(`${echte} echte Spieler online - Ansage im Spiel (20 s), danach wird der Worldserver beendet.`, 'WARN')
          try {
            await require('./soap').send('server shutdown 20')
            await sleep(22000)
          } catch (e) {
            protokoll(`Ansage nicht möglich (${e.message}) - der Server wird direkt beendet.`, 'WARN')
          }
        }
      } catch (_) {}
    }

    for (const k of ['world', 'auth']) {
      if (lief[k]) {
        protokoll(`Beende ${k === 'world' ? 'den Worldserver' : 'den Authserver'} für den Import ...`, 'STEP')
        try { serverManager.stop(k) } catch (_) {}
      }
    }

    // 7. Dump in die eigene Datenbank spielen (CREATE/USE auf Ziel umbenannt)
    protokoll(`Spiele ${dbs.charsDb} in ${ziel} ...`, 'STEP')
    const backup = require('./backup')
    const zielIni = backup.defaultsDatei()
    try {
      await backup.spieleEin(dumpDatei, zielIni, { von: dbs.charsDb, nach: ziel })
    } finally {
      try { fs.unlinkSync(zielIni) } catch (_) {}
    }
    protokoll(`Übernahme fertig: ${ziel} enthält jetzt die Daten des alten Servers (Import dauerte ${seit()}).`, 'STEP')
    // Der Dump hat seinen Zweck erfüllt - Downloads nicht mit GB-Dateien füllen.
    try { fs.rmSync(dumpDatei, { force: true }) } catch (_) {}
    lauf.percent = 75
    emit({ type: 'status', status: kurzStatus() })

    /*
     * 8. Konten mit übernehmen. Ohne sie wären die importierten Charaktere
     * unsichtbar: characters.account verweist auf Konto-IDs in acore_auth,
     * die es in der frischen Installation nicht gibt. Über den Temp-DB-Trick
     * (Dump unter Umbenennung einspielen) per INSERT IGNORE übernehmen -
     * IDs bleiben konsistent, Kollisionen (z. B. id 1 = SOAP-Konto) greifen
     * das neue Konto nicht an.
     */
    let kontoErgebnis = null
    if (input.konten !== false) {
      try {
        protokoll('Übernehme die Konten aus dem alten Server ...', 'STEP')
        if (!dbs.authDb) throw new Error('Keine Konto-Datenbank auf dem alten Server gefunden (acore_auth/auth/realmd).')
        const authDumpDatei = path.join(p.downloads, `uebernahme-auth-${zeitstempel()}.sql.gz`)
        await dumpFremdDb(dump, instanz.clientArgs, [dbs.authDb], authDumpDatei)
        const backup2 = require('./backup')
        const tempIni = backup2.defaultsDatei()
        const tempDb = 'acore_auth_verify_tmp'
        try {
          const dbVerbindung = require('../db')
          await dbVerbindung.execute('auth', `DROP DATABASE IF EXISTS \`${tempDb}\``)
          await backup2.spieleEin(authDumpDatei, tempIni, { von: dbs.authDb, nach: tempDb })

          // Spalten, die es auf BEIDEN Seiten gibt - alte Repacks haben ein
          // älteres Konto-Schema (z. B. sha_pass_hash statt salt/verifier).
          const gemeinsame = async tab => {
            const zielSpalten = await dbVerbindung.execute('auth', `SHOW COLUMNS FROM \`${tab}\``)
            const quelleSpalten = await dbVerbindung.execute('auth', `SHOW COLUMNS FROM \`${tempDb}\`.\`${tab}\``)
            const zielNamen = Array.isArray(zielSpalten) ? zielSpalten.map(x => x.Field) : []
            const quellNamen = Array.isArray(quelleSpalten) ? quelleSpalten.map(x => x.Field) : []
            return gemeinsameSpalten(zielNamen, quellNamen)
          }

          const importiereTabelle = async tab => {
            const spalten = await gemeinsame(tab)
            if (!spalten.includes('id') || !spalten.length) {
              return { tab, übernommen: 0, hinweis: 'Schema zu weit auseinander' }
            }
            const liste = spalten.join(', ')
            await dbVerbindung.execute('auth',
              `INSERT IGNORE INTO \`${tab}\` (${liste}) SELECT ${liste} FROM \`${tempDb}\`.\`${tab}\``)
            const rows = await dbVerbindung.execute('auth', `SELECT COUNT(*) AS c FROM \`${tab}\``)
            return { tab, übernommen: Array.isArray(rows) && rows.length ? Number(rows[0].c) : 0 }
          }

          const kontoRes = await importiereTabelle('account')
          const zugangRes = await importiereTabelle('account_access')
          kontoErgebnis = { konten: kontoRes, zugänge: zugangRes }
          protokoll(`Konten übernommen: ${kontoRes.übernommen} Konten, ${zugangRes.übernommen} GM-Zuordnungen.`, 'STEP')
          if (kontoRes.übernommen > 0 && !(await hatSpalten('account', 'salt'))) {
            protokoll('Hinweis: die alte Kontotabelle verwendet kein SRP6-Format - die Passwörter der übernommenen Konten müssen neu gesetzt werden (Seite „Acc erstellen").', 'WARN')
          }
          await dbVerbindung.execute('auth', `DROP DATABASE IF EXISTS \`${tempDb}\``)
          try { fs.rmSync(authDumpDatei, { force: true }) } catch (_) {}
        } finally {
          /*
           * Auch im Fehlerfall aufräumen: sonst bleibt ein voller
           * Konto-Dump als acore_auth_verify_tmp in der Datenbank liegen.
           * Doppelt ausführen ist harmlos.
           */
          try {
            await require('../db').execute('auth', `DROP DATABASE IF EXISTS \`${tempDb}\``)
          } catch (_) {}
          try { fs.unlinkSync(tempIni) } catch (_) {}
        }
      } catch (e) {
        protokoll(`Konten konnten nicht übernommen werden: ${e.message} - die Charaktere sind trotzdem da, ggf. Konto anlegen und Zuordnung prüfen.`, 'WARN')
      }
    }

    /*
     * 8a. Plausibilitätsvergleich für die Konten - wie bei den Charakteren.
     * INSERT IGNORE schluckt Kollisionen (gleiche IDs, z. B. das SOAP-Konto),
     * deshalb ist "Ziel >= Quelle" gut, weniger ist auffällig.
     */
    let kontenVergleich = null
    if (quellKonten >= 0) {
      try {
        const zielKontenRows = await require('../db').execute('auth', 'SELECT COUNT(*) AS c FROM account')
        const zielKonten = Array.isArray(zielKontenRows) && zielKontenRows.length ? Number(zielKontenRows[0].c) : -1
        kontenVergleich = { quelle: quellKonten, ziel: zielKonten, ok: zielKonten >= quellKonten }
        /*
         * Alte Passwort-Formate (sha_pass_hash statt SRP6) hinterlassen leere
         * salt-Spalten: diese Konten können sich nicht einloggen. Die Zahl
         * gehört in die Ergebnis-Karte - mit Verweis auf den Bulk-Reset.
         */
        try {
          if (await hatSpalten('account', 'salt')) {
            const srpRows = await require('../db').execute(
              'auth',
              'SELECT COUNT(*) AS c FROM account WHERE salt IS NULL OR CHAR_LENGTH(salt) = 0'
            )
            kontenVergleich.ohneSrp6 = Array.isArray(srpRows) && srpRows.length ? Number(srpRows[0].c) : -1
          }
        } catch (_) {}
        protokoll(
          kontenVergleich.ok
            ? `Konten-Vergleich bestanden: ${zielKonten} Konten im Ziel (Quelle ${quellKonten} - Kollisionen durch INSERT IGNORE sind normal).`
            : `WARNUNG: Kontenzahl weicht ab - Quelle ${quellKonten}, Ziel ${zielKonten}.`,
          kontenVergleich.ok ? 'STEP' : 'WARN'
        )
        /*
         * Waisen: Charaktere ohne Konto sind nicht einloggbar - entstehen
         * z. B. wenn der Konten-Import scheitert oder Konten kollidieren.
         * Das gehört in die Ergebnis-Karte, nicht in eine Überraschung.
         */
        try {
          const dbM = require('../db')
          const waisenRows = await dbM.execute(
            'chars',
            `SELECT COUNT(*) AS c FROM characters ch
             LEFT JOIN \`${dbM.nameOf('auth')}\`.account a ON a.id = ch.account
             WHERE a.id IS NULL`
          )
          kontenVergleich.waise = Array.isArray(waisenRows) && waisenRows.length ? Number(waisenRows[0].c) : -1
        } catch (_) {}
        if (kontenVergleich.ohneSrp6 > 0) {
          protokoll(`${kontenVergleich.ohneSrp6} Konten ohne SRP6-Passwort - Bulk-Reset auf der Seite "Konto erstellen".`, 'WARN')
        }
        if (kontenVergleich.waise > 0) {
          protokoll(`WARNUNG: ${kontenVergleich.waise} Charaktere ohne Konto - sie können sich nicht einloggen.`, 'WARN')
        }
      } catch (_) {}
    }
    protokoll(`Konten-Abschnitt dauerte ${seit()}.`, 'INFO')
    lauf.percent = 82
    emit({ type: 'status', status: kurzStatus() })

    /*
     * 8b. Bot-Datenbank mit übernehmen (mod-playerbots): Dort steht der
     * Bot-Zustand (Beziehungen, Guilds, Quests). Ohne sie starten die
     * importierten Bots mit leerem AI-Zustand. Die Dump-Datei legt die
     * gleichnamige DB im Ziel neu an - keine Umbenennung nötig, weil die
     * Konto-IDs mit dem Konten-Import konsistent sind.
     */
    let botsDbErgebnis = null
    if (input.botDb !== false && dbs.botsDb) {
      try {
        protokoll(`Übernehme die Bot-Datenbank (${dbs.botsDb}) ...`, 'STEP')
        const botsDumpDatei = path.join(p.downloads, `uebernahme-bots-${zeitstempel()}.sql.gz`)
        await dumpFremdDb(dump, instanz.clientArgs, [dbs.botsDb], botsDumpDatei)
        const backupB = require('./backup')
        const botsIni = backupB.defaultsDatei()
        try {
          await backupB.spieleEin(botsDumpDatei, botsIni)
        } finally {
          try { fs.unlinkSync(botsIni) } catch (_) {}
        }
        try { fs.rmSync(botsDumpDatei, { force: true }) } catch (_) {}
        botsDbErgebnis = { db: dbs.botsDb }
        protokoll(`Bot-Datenbank übernommen: ${dbs.botsDb}.`, 'STEP')
      } catch (e) {
        protokoll(`Bot-Datenbank konnte nicht übernommen werden: ${e.message} - die Bots laufen mit leerem AI-Zustand.`, 'WARN')
      }
    }
    protokoll(`Bot-DB-Abschnitt dauerte ${seit()}.`, 'INFO')
    lauf.percent = 88
    emit({ type: 'status', status: kurzStatus() })

    /*
     * 8c. Weltdatenbank mit übernehmen: Custom-Items, eigene NPCs und die
     * Mod-Tabellen des alten Servers. Nur auf ausdrücklichen Wunsch - die
     * eigene Welt-DB stammt aus der offiziellen Quelle, ein älterer Repack
     * hat ein anderes Schema. Das Dump-Format (--databases) legt die
     * gleichnamige DB im Ziel neu an; Schema-Lücken richtet der Worldserver
     * beim nächsten Start selbst (Updates.AutoSetup).
     */
    let worldDbErgebnis = null
    if (input.worldDb && dbs.worldDb) {
      try {
        protokoll(`Übernehme die Weltdatenbank (${dbs.worldDb}) - Custom-Inhalte des alten Servers ...`, 'STEP')
        const worldDumpDatei = path.join(p.downloads, `uebernahme-world-${zeitstempel()}.sql.gz`)
        await dumpFremdDb(dump, instanz.clientArgs, [dbs.worldDb], worldDumpDatei)
        const backupW = require('./backup')
        const worldIni = backupW.defaultsDatei()
        try {
          await backupW.spieleEin(worldDumpDatei, worldIni)
        } finally {
          try { fs.unlinkSync(worldIni) } catch (_) {}
        }
        try { fs.rmSync(worldDumpDatei, { force: true }) } catch (_) {}
        /*
         * Vergleich wie bei Charakteren und Konten: die Zahl der
         * creature_template-Einträge im Ziel gegen die Quelle.
         */
        let zielWelt = -1
        try {
          const weltRows = await require('../db').execute('world', 'SELECT COUNT(*) AS c FROM creature_template')
          zielWelt = Array.isArray(weltRows) && weltRows.length ? Number(weltRows[0].c) : -1
        } catch (_) {}
        const weltOk = quellWelt < 0 || zielWelt < 0 ? null : zielWelt === quellWelt
        worldDbErgebnis = { db: dbs.worldDb, quelle: quellWelt, ziel: zielWelt, ok: weltOk }
        protokoll(
          weltOk == null
            ? `Weltdatenbank übernommen: ${dbs.worldDb} (Vergleich nicht möglich).`
            : weltOk
              ? `Welt-Vergleich bestanden: ${zielWelt} Welt-Einträge (wie in der Quelle).`
              : `WARNUNG: Welt-Einträge weichen ab - Quelle ${quellWelt}, Ziel ${zielWelt}.`,
          weltOk == null ? 'STEP' : weltOk ? 'STEP' : 'WARN'
        )
        lauf.percent = 93
        emit({ type: 'status', status: kurzStatus() })
      } catch (e) {
        protokoll(`Weltdatenbank konnte nicht übernommen werden: ${e.message} - die eigene Weltdatenbank bleibt unverändert.`, 'WARN')
      }
    }
    protokoll(`Welt-Abschnitt dauerte ${seit()}.`, 'INFO')

    /*
     * 8d. Einstellungen aus der ALTEN worldserver.conf übernehmen: Raten
     * und Feineinstellungen, die im Repack getätigt wurden. Nur Schlüssel,
     * die in BEIDEN Dateien existieren (verhindert Deprecated/Version-Drift);
     * DB-Verbindung, SOAP, DataDir, LogsDir, RealmID gehören der Panel-
     * Installation. Die neue Datei vorher als .bak sichern.
     */
    let confErgebnis = null
    if (input.playerbotsConf !== false) {
      try {
        const alterRoot = path.dirname(mysqlOrdner)
        const kandidaten = [
          path.join(alterRoot, 'configs', 'modules', 'playerbots.conf'),
          path.join(alterRoot, 'playerbots.conf'),
          path.join(alterRoot, 'configs', 'playerbots.conf')
        ]
        const quelle = kandidaten.find(istDatei)
        if (!quelle) {
          protokoll('Keine playerbots.conf auf dem alten Server gefunden - übersprungen.', 'INFO')
        } else {
          const zielConf = path.join(p.configs, 'modules', 'playerbots.conf')
          await fsp.mkdir(path.dirname(zielConf), { recursive: true })
          if (istDatei(zielConf)) {
            try { fs.copyFileSync(zielConf, zielConf + '.bak') } catch (_) {}
          }
          fs.copyFileSync(quelle, zielConf)
          store.write({ server: { botFile: zielConf } })
          confErgebnis = { quelle, ziel: zielConf }
          protokoll(`playerbots.conf übernommen: ${quelle} -> ${zielConf} (alte Datei als .bak).`, 'STEP')
          protokoll('Hinweis: Pfad-Schlüssel in der übernommenen Datei auf diese Installation prüfen (Seite „Bot Anzahl").', 'INFO')
        }
      } catch (e) {
        protokoll(`playerbots.conf konnte nicht übernommen werden: ${e.message} - die Bot-Konfiguration bleibt unverändert.`, 'WARN')
      }
    }

    /*
     * 8e. Raten/Einstellungen aus der ALTEN worldserver.conf übernehmen:
     * Nur Schlüssel, die in beiden Dateien existieren (verhindert Schema-
     * Drift), und ausdrücklich NICHT die Installations-Schlüssel (DB, SOAP,
     * DataDir, LogsDir, RealmID). Die neue Datei vorher als .bak sichern.
     */
    let ratenErgebnis = null
    if (input.worldConf !== false) {
      try {
        const alterRoot = path.dirname(mysqlOrdner)
        const kandidatenAlt = [
          path.join(alterRoot, 'configs', 'worldserver.conf'),
          path.join(alterRoot, 'worldserver.conf')
        ]
        const quelleAlt = kandidatenAlt.find(istDatei)
        const zielAlt = path.join(p.configs, 'worldserver.conf')
        if (!quelleAlt || !istDatei(zielAlt)) {
          protokoll('Alte oder neue worldserver.conf nicht gefunden - Einstellungs-Übernahme übersprungen.', 'INFO')
        } else {
          try { fs.copyFileSync(zielAlt, zielAlt + '.bak') } catch (_) {}
          const altText = fs.readFileSync(quelleAlt, 'utf8')
          const neuText = fs.readFileSync(zielAlt, 'utf8')
          // Geklammert: ohne Gruppe würde ^ nur die erste Alternative
          // verankern und substring-Treffer (etwa "MyDataDirX") durchlassen.
          const eigene = /^(LoginDatabaseInfo|WorldDatabaseInfo|CharacterDatabaseInfo|DataDir|LogsDir|RealmID|SOAP\.)/i
          let übernommen = 0
          for (const zeile of altText.split(/\r?\n/)) {
            const m = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.+?)\s*$/.exec(zeile)
            if (!m || eigene.test(m[1])) continue
            const rx = new RegExp(`^\\s*${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'm')
            if (!rx.test(neuText)) continue // Schlüssel existiert in der neuen Version nicht
            setConfValue(zielAlt, m[1], m[2])
            übernommen++
            // Jeder Schlüssel ins Protokoll: die Anzahl allein sagt nicht,
            // WELCHE Werte der neue Server jetzt hat.
            protokoll(`Konfig-Übernahme: ${m[1]} = ${m[2]}`, 'INFO')
          }
          ratenErgebnis = { übernommen }
          protokoll(`Einstellungen übernommen: ${übernommen} Schlüssel aus der alten worldserver.conf (nur vorhandene Schlüssel, DB/SOAP ausgenommen).`, 'STEP')
        }
      } catch (e) {
        protokoll(`Einstellungen aus der alten worldserver.conf konnten nicht übernommen werden: ${e.message} - die neue Konfiguration bleibt unverändert.`, 'WARN')
      }
    }
    lauf.percent = 96
    emit({ type: 'status', status: kurzStatus() })

    /*
     * 9. Plausibilitätsvergleich: Ziel-Charakterzahl gegen die Quellzahl.
     * Eine volle DB-Übernahme muss die Zahl 1:1 bringen - Abweichungen
     * werden benannt, statt still durchzurutschen.
     */
    let vergleich = null
    if (quellCharaktere >= 0) {
      try {
        const zielRows = await require('../db').execute('chars', 'SELECT COUNT(*) AS c FROM characters')
        const zielChars = Array.isArray(zielRows) && zielRows.length ? Number(zielRows[0].c) : -1
        vergleich = { quelle: quellCharaktere, ziel: zielChars, ok: zielChars === quellCharaktere }
        protokoll(
          vergleich.ok
            ? `Vergleich bestanden: ${zielChars} Charaktere im Ziel (wie in der Quelle).`
            : `WARNUNG: Charakterzahl weicht ab - Quelle ${quellCharaktere}, Ziel ${zielChars}.`,
          vergleich.ok ? 'STEP' : 'WARN'
        )
      } catch (_) {}
    }

    /*
     * 10. Vorher laufende Server wieder anwerfen - nach ALLEN Importen und
     * Konfig-Übernahmen. Der Worldserver lädt beim Start den neuen Stand
     * UND die übernommenen Einstellungen in einem Rutsch; die Bot- und
     * Welt-DB sind da längst fertig, nichts läuft neben dem Import.
     *
     * Das Ergebnis wird ausgewertet: ein fehlgeschlagener Start (z. B.
     * Schema-Update-Fehler) ist kein Migrationserfolg - er steht als WARN
     * im Protokoll und in der Ergebnis-Karte.
     */
    const neuGestartet = { world: null, auth: null }
    if (lief.world) {
      await sleep(1500)
      const w = await serverManager.start('world')
      neuGestartet.world = !!(w && w.ok)
      protokoll(
        w && w.ok
          ? 'Worldserver läuft wieder.'
          : `WARNUNG: Worldserver-Start nach der Übernahme: ${(w && w.error) || 'unbekannt'} - über die Seite "Server" starten und das Log prüfen.`,
        w && w.ok ? 'STEP' : 'WARN'
      )
    }
    if (lief.auth) {
      await sleep(1500)
      const a = await serverManager.start('auth')
      neuGestartet.auth = !!(a && a.ok)
      protokoll(
        a && a.ok
          ? 'Authserver läuft wieder.'
          : `WARNUNG: Authserver-Start nach der Übernahme: ${(a && a.error) || 'unbekannt'}.`,
        a && a.ok ? 'STEP' : 'WARN'
      )
    }
    lauf.percent = 99
    emit({ type: 'status', status: kurzStatus() })

    protokoll('Hinweis: Schema-Unterschiede richtet der Worldserver beim nächsten Start selbst (Updates.AutoSetup).', 'STEP')
    protokoll(`Übernahme insgesamt: ${gesamt()}.`, 'STEP')

    require('./notify').melde('Übernahme abgeschlossen',
      `${dbs.charsDb} aus dem alten Server ist jetzt in ${ziel}` +
      (quellCharaktere >= 0 ? ` (${quellCharaktere} Charaktere` : ' (') +
      (kontoErgebnis ? `, ${kontoErgebnis.konten.übernommen} Konten` : '') +
      '). Die Server laufen wieder - Charaktere sind da.')
    lauf.percent = 100
    lauf.running = false
    lauf.steps[0].state = 'ok'
    lauf.stepIndex = -1
    lauf.stepKey = ''
    emit({ type: 'done', ok: true, status: kurzStatus() })
    const ergebnis = {
      ok: true, db: dbs.charsDb, ziel, groesse, dumpDatei, konten: kontoErgebnis,
      charaktere: quellCharaktere, zielCharaktere: vergleich ? vergleich.ziel : null,
      kontenVergleich,
      botsDb: botsDbErgebnis, worldDb: worldDbErgebnis,
      playerbotsConf: confErgebnis, raten: ratenErgebnis,
      neuGestartet
    }
    /*
     * Ergebnis merken: die Karte überlebt damit den Panel-Neustart - der
     * Anker blieb bisher, das Ergebnis (Zahlen, Vergleiche, Dauern) war weg.
     */
    try {
      store.write({ migration: { letztesErgebnis: { ...ergebnis, zeit: new Date().toISOString() } } })
    } catch (_) {}
    return ergebnis
  } catch (err) {
    lauf.running = false
    lauf.error = err.message
    lauf.steps[0].state = 'fail'
    emit({ type: 'error', message: err.message, status: kurzStatus() })
    require('./notify').melde('Übernahme fehlgeschlagen', err.message)
    throw err
  } finally {
    // Den fremden MySQL sauber beenden - dessen Daten bleiben unangetastet.
    if (instanz) {
      await instanz.beenden()
    }
    startLaeuft = false
  }
}

/*
 * Hat die Tabelle diese Spalte? Fuer den Konto-Import: alte Repacks
 * verwenden teils kein SRP6 (salt/verifier), sondern sha_pass_hash.
 */
async function hatSpalten (tab, spalte) {
  try {
    const rows = await require('../db').execute('auth', `SHOW COLUMNS FROM \`${tab}\``)
    return Array.isArray(rows) && rows.some(x => x.Field === spalte)
  } catch (_) {
    return false
  }
}

/*
 * Clientdaten auf den neuesten Stand bringen - unabhaengig von einer
 * Einrichtung. Laeuft laenger (ca. 1 GB Download), die Oberflaeche zeigt
 * deshalb einen laufenden Knopf.
 */
async function clientDatenAktualisieren (input = {}) {  if (startLaeuft || (lauf && lauf.running)) {    throw new Error('Es läuft bereits eine Einrichtung.')
  }
  startLaeuft = true
  const root = normalisiereRoot(input.root)
  const p = pfade(root)
  // Temporaerer Lauf-Zustand, damit die Oberflaeche den Download live sieht.
  lauf = {
    running: true, root, opts: { downloadClientData: true, clientDataPath: '' }, pfade: p,
    startedAt: new Date().toISOString(), finishedAt: '', cancelled: false, abgebrochen: false,
    error: '', child: null, mysql: null, stepIndex: 0, stepKey: 'daten', percent: 0, log: [],
    logDatei: path.join(p.logs, `client-data-${zeitstempel()}.log`),
    steps: [{ key: 'daten', state: 'running' }]
  }
  emit({ type: 'status', status: kurzStatus() })
  try {
    await fsp.mkdir(p.data, { recursive: true })
    await clientDatenSichern(p, { downloadClientData: true, clientDataPath: '' }, true)
    const version = clientDatenVersion(p) || 'unbekannt'
    protokoll(`Clientdaten aktualisiert: ${version}`, 'STEP')
    lauf.percent = 100
    lauf.running = false
    lauf.steps[0].state = 'ok'
    lauf.stepIndex = -1
    lauf.stepKey = ''
    emit({ type: 'done', ok: true, status: kurzStatus() })
    require('./notify').melde('Clientdaten aktualisiert', `Neue Version: ${version}`)
    return { ok: true, version }
  } catch (err) {
    lauf.running = false
    lauf.error = err.message
    lauf.steps[0].state = 'fail'
    emit({ type: 'error', message: err.message, status: kurzStatus() })
    require('./notify').melde('Clientdaten-Download fehlgeschlagen', err.message)
    throw err
  } finally {
    startLaeuft = false
  }
}

/*
 * Haben die Quellen durch das Update wirklich etwas veraendert? Vergleicht
 * HEAD mit dem abgeholten Branch-Stand UND dem zuletzt erfolgreich
 * gebauten Stand (install-state.buildCommit). Nur wenn beide uebereinstimmen,
 * ist der Build ein No-op - sonst waere es die Falle "neue Datenbank gegen
 * alte worldserver.exe", wenn ein frueheres Update am Build gescheitert war.
 */
async function quelleUnveraendert (p, git) {
  try {
    const lokal = await execCapture(git, ['-C', p.source, 'rev-parse', 'HEAD'])
    const remote = await execCapture(git, ['-C', p.source, 'rev-parse', 'origin/' + QUELLE_BRANCH])
    const ziel = (remote.out || '').trim()
    if (!lokal.ok || !remote.ok || ziel === '' || (lokal.out || '').trim() !== ziel) return false
    const zustand = leseZustand(p.root)
    const gebaut = zustand && zustand.buildCommit
    return !!gebaut && gebaut === ziel
  } catch (_) {
    return false
  }
}

/*
 * Wo liegen die fertigen Programme? bauen() ermittelt das nach dem Build;
 * wenn der Build uebersprungen wird, muss die Ermittlung trotzdem laufen,
 * denn der Standardpfad (build/bin/<CONFIG>) ist bei NMake oft nicht der
 * echte (hier: build/bin).
 */
async function binWaehlen (p) {
  if (istDatei(path.join(p.bin, 'worldserver.exe'))) return
  const gefunden = findeDateiUnter(p.build, 'worldserver.exe')
  if (gefunden) {
    p.bin = path.dirname(gefunden)
    p.configs = path.join(p.bin, 'configs')
    p.modConfigs = path.join(p.configs, 'modules')
    protokoll(`Binärdateien gefunden: ${p.bin}`, 'STEP')
  }
}

/*
 * MySQL-Port nachträglich ändern. Der Port steckt in fünf Stellen: my.ini
 * ([mysqld] und [client]), drei .conf-Verbindungsstrings, der
 * install-state.json und der Panel-Konfiguration. Das Werkzeug beendet die
 * Komponenten, baut alles mit .bak-Backup um und startet wieder.
 */
async function mysqlPortAendern ({ neuerPort } = {}) {
  const neu = Number(neuerPort)
  if (!Number.isInteger(neu) || neu < 1024 || neu > 65535) {
    throw new Error(`Ungültiger Port: ${neuerPort} (erlaubt: 1024-65535)`)
  }
  const root = normalisiereRoot((store.read().server || {}).rootDir || '')
  if (!root || !istDatei(path.join(root, 'mysql', 'my.ini'))) {
    throw new Error('Kein eingerichteter Server gefunden - der Port lässt sich nur nach einer Einrichtung ändern.')
  }
  const p = pfade(root)
  const alt = Number((store.read().mysql || {}).port) || 3306
  if (neu === alt) return { ok: true, port: neu, unverändert: true }
  if (!(await portFrei(neu))) {
    throw new Error(`Port ${neu} ist bereits belegt - bitte einen freien Port wählen.`)
  }

  // 1. Laufende Komponenten beenden (sie halten Verbindungen und Dateien)
  const st = serverManager.status()
  const lief = {}
  for (const k of ['world', 'auth', 'db']) {
    lief[k] = !!(st[k] && st[k].running)
    if (lief[k]) {
      try { serverManager.stop(k) } catch (_) {}
    }
  }
  for (let i = 0; i < 40 && (await portOffen(alt)); i++) await sleep(500)

  // 2. my.ini: alle port=-Zeilen ([mysqld] und [client])
  const myIni = p.myIni
  const iniBak = myIni + '.bak'
  try { fs.copyFileSync(myIni, iniBak) } catch (_) {}
  let iniText = fs.readFileSync(myIni, 'utf8')
  iniText = iniText.replace(/^port=\d+/gm, `port=${neu}`)
  fs.writeFileSync(myIni, iniText, 'utf8')
  protokoll(`my.ini: Port ${alt} -> ${neu}`, 'STEP')

  // 3. Konfigurationsdateien: 127.0.0.1;<alt>;... -> 127.0.0.1;<neu>;...
  for (const conf of ['worldserver.conf', 'authserver.conf', 'dbimport.conf']) {
    const voll = path.join(p.configs, conf)
    if (!istDatei(voll)) continue
    try { fs.copyFileSync(voll, voll + '.bak') } catch (_) {}
    let text = fs.readFileSync(voll, 'utf8')
    const rx = new RegExp(`(127\\.0\\.0\\.1;);${alt};`, 'g')
    if (rx.test(text)) {
      text = text.replace(rx, `$1;${neu};`)
      fs.writeFileSync(voll, text, 'utf8')
      protokoll(`${conf}: Verbindungsport ${alt} -> ${neu}`, 'STEP')
    }
  }

  // 4. install-state + Panel-Konfiguration
  const zustand = leseZustand(root)
  if (zustand) schreibeZustand(root, { ...zustand, mysqlPort: neu })
  store.write({ mysql: { port: neu }, server: { mysqlServer: { port: neu } } })

  // 5. Alles wieder anwerfen
  await sleep(1500)
  const resDb = await serverManager.start('db')
  if (resDb && resDb.ok) await warteAufPort(neu, 30000)
  if (lief.world) { await sleep(1500); await serverManager.start('world') }
  if (lief.auth) { await sleep(1500); await serverManager.start('auth') }

  require('./notify').melde('MySQL-Port geändert', `Die Datenbank läuft jetzt auf Port ${neu} (vorher ${alt}).`)
  return { ok: true, port: neu, vorher: alt, neuGestartet: { db: true, world: lief.world, auth: lief.auth } }
}

/*
 * Serverstand aus der install-state.json lesen - fuer die Übersicht
 * ("welchen Stand betreibe ich eigentlich?").
 */
async function serverStand () {
  const root = normalisiereRoot((store.read().server || {}).rootDir || '')
  try {
    const zustand = leseZustand(root)
    return {
      ok: true,
      stand: (zustand && zustand.buildCommit ? zustand.buildCommit : '').slice(0, 8),
      zeit: (zustand && zustand.buildZeit) || ''
    }
  } catch (_) {
    return { ok: true, stand: '', zeit: '' }
  }
}

/*
 * Spalten-Schnittmenge für den Konto-Import: nur Felder importieren, die es
 * auf BEIDEN Seiten gibt (alte Repacks haben ältere Konto-Schemata).
 * Reine Funktion, prüfbar in verify-kontoimport.js.
 */
function gemeinsameSpalten (zielSpalten, quellSpalten) {
  const zielNamen = (Array.isArray(zielSpalten) ? zielSpalten : []).map(x =>
    typeof x === 'string' ? x : x.Field
  )
  const quellNamen = (Array.isArray(quellSpalten) ? quellSpalten : []).map(x =>
    typeof x === 'string' ? x : x.Field
  )
  return zielNamen.filter(n => quellNamen.includes(n))
}

/*
 * Rollback: die Datenbank auf die Vorab-Sicherung zurücksetzen. Extrahiert,
 * damit der Ablauf prüfbar ist (verify-rollback.js mockt backup.restore).
 * Server, die vor dem Update liefen (liefWorld/liefAuth), werden nach dem
 * Rollback wieder angestellt - nach einem fehlgeschlagenen Update soll der
 * Server genau in dem Zustand stehen wie davor: alte DB, laufende Prozesse.
 */
async function datenbankRollback (stamp, p, my, liefWorld, liefAuth) {
  protokoll(
    `Der Import ist fehlgeschlagen - rollen die Datenbank auf die Sicherung ${stamp} zurück ...`,
    'WARN'
  )
  try {
    await require('./backup').restore({ stamp })
    protokoll('Datenbank wurde auf den Stand vor dem Update zurückgerollt.', 'WARN')
    require('./notify').melde('Update zurückgerollt', 'Der Datenbankimport schlug fehl - die Datenbank steht wieder auf dem Stand vor dem Update.')
  } catch (rueckFehler) {
    protokoll(
      `Das Zurückrollen schlug fehl: ${rueckFehler.message}. ` +
        `Die Sicherung ${stamp} liegt im Backup-Ordner und kann über die Seite "Datenbank Backup" zurückgespielt werden.`,
      'ERROR'
    )
    return { ok: false, error: rueckFehler.message }
  }
  try {
    await mySqlBeenden(p, my)
    await sleep(1200)
    await serverManager.start('db')
  } catch (_) {}
  // Was vor dem Update lief, läuft wieder - der Server ist dann genau so
  // weiter benutzbar wie vor dem fehlgeschlagenen Versuch.
  if (liefWorld) {
    await sleep(2000)
    try {
      const w = await serverManager.start('world')
      protokoll(w && w.ok ? 'Worldserver läuft wieder (Rückrollung).' : `WARNUNG: Worldserver-Start nach Rollback: ${w.error}`, w && w.ok ? 'STEP' : 'WARN')
    } catch (_) {}
  }
  if (liefAuth) {
    await sleep(2000)
    try {
      const a = await serverManager.start('auth')
      protokoll(a && a.ok ? 'Authserver läuft wieder (Rückrollung).' : `WARNUNG: Authserver-Start nach Rollback: ${a.error}`, a && a.ok ? 'STEP' : 'WARN')
    } catch (_) {}
  }
  return { ok: true }
}

async function update (input = {}) {
  if (startLaeuft || (lauf && lauf.running)) {
    throw new Error('Es läuft bereits eine Einrichtung.')
  }
  startLaeuft = true
  const root = normalisiereRoot(input.root)
  const p = pfade(root)

  /*
   * Plattenplatz wie bei der Installation prüfen: Build-Temp-Daten,
   * Quell-Zug und Sicherung schreiben GB-Größen auf die Platte - und die
   * Nachts-Wartung läuft unbeaufsichtigt. Scheitert sie an vollem Laufwerk,
   * wäre der Rollback selbst gefährdet.
   */
  try {
    const frei = await freierPlatz(p.root)
    if (frei !== null) {
      const gb = frei / 1024 / 1024 / 1024
      if (gb < 15) {
        startLaeuft = false
        throw new Error(
          `Weniger als 15 GB frei (${gb.toFixed(1)} GB) - das Update braucht Platz ` +
            'für Quellen, Build-Zwischenstände und Sicherungen. Erst Platz schaffen ' +
            '(z. B. alte Clientdaten-ZIPs und Debug-Symbole löschen), dann erneut.'
        )
      }
    }
  } catch (e) {
    if (/15 GB/.test(String(e && e.message))) throw e
    // Plattenplatz nicht prüfbar: weitermachen, der Build selbst wird es zeigen
  }

  /*
   * Ein Update darf den Datenbank-Port nicht aendern: die bereits
   * geschriebenen Serverdateien und das Datenverzeichnis haengen daran.
   * Deshalb gilt der Port aus der letzten Einrichtung - die Oberflaeche
   * kennt ihn nicht und schickt immer ihren Standardwert mit.
   */
  const zustandVorab = leseZustand(root)
  const portAusZustand = Number(
    (zustandVorab && zustandVorab.mysqlPort) ||
      (zustandVorab && zustandVorab.options && zustandVorab.options.mysqlPort)
  )
  const opts = {
    root,
    mysqlPort: portAusZustand || Number(input.mysqlPort) || 3306,
    buildProfile: ['full', 'balanced', 'background'].includes(input.buildProfile) ? input.buildProfile : 'balanced',
    downloadClientData: false,
    autoInstallTools: false,
    realmName: String(input.realmName || 'AzerothCore').trim() || 'AzerothCore',
    clientDataPath: '',
    branch: input.branch || QUELLE_BRANCH,
    werkzeuge: null
  }
  // Werkzeuge ermitteln
  let git, cmake, vs, openssl, boost, winget
  try {
    ;[git, cmake, vs, openssl, boost, winget] = await Promise.all([
      findeGit(root), findeCMake(root), findeVisualStudio(), findeOpenSsl(root), findeBoost(root), findeWinget()
    ])
    opts.werkzeuge = { git, cmake, vs, openssl, boost, winget }
    if (!git || !cmake) throw new Error('Git und CMake werden benötigt.')

    /*
     * SOAP-Zugang aus der letzten Installation uebernehmen. Ohne diese Zeilen
     * liefe der Datenbankimport ohne Konto, und die Konsole im Panel kaeme nach
     * dem Update nicht mehr an den Server.
     */
    const vorher = zustandVorab
    const soap = soapZugangAusZustand(vorher)
    const portBekannt = !!(vorher && vorher.soap && Number(vorher.soap.port))
    if (!portBekannt && !(await portFrei(soap.port))) soap.port = await freierPort(soap.port + 1)
    opts.soap = soap
  } catch (err) {
    // Ohne diese Rueckstellung bliebe die Sperre haengen und jeder weitere
    // Versuch meldete "Es laeuft bereits eine Einrichtung."
    startLaeuft = false
    throw err
  }

  lauf = {
    running: true, root, opts, pfade: p,
    startedAt: new Date().toISOString(), finishedAt: '', cancelled: false, abgebrochen: false,
    error: '', child: null, mysql: null, stepIndex: -1, stepKey: '', percent: 0, log: [],
    logDatei: path.join(p.logs, `update-${zeitstempel()}.log`),
    steps: [
      { key: 'quelle', state: 'pending' },
      { key: 'mysql', state: 'pending' },
      { key: 'konfigurieren', state: 'pending' },
      { key: 'bauen', state: 'pending' },
      { key: 'datenbank', state: 'pending' },
      { key: 'fertig', state: 'pending' }
    ]
  }
  startLaeuft = false
  protokoll(`AzerothCore-Update gestartet: ${root}`, 'STEP')

  /*
   * Laufende Server beenden, BEVOR uebersetzt wird: der Build verlinkt
   * worldserver.exe neu, und eine gesperrte EXE bricht den Build ab.
   * Liefen sie vorher, werden sie am Ende wieder angefahren.
   */
  const statusVorher = serverManager.status()
  const liefWorld = !!(statusVorher.world && statusVorher.world.running)
  const liefAuth = !!(statusVorher.auth && statusVorher.auth.running)
  if (liefWorld) {
    protokoll('Beende den Worldserver für das Update (er wird danach neu gestartet) ...', 'STEP')
    try { serverManager.stop('world') } catch (_) {}
  }
  if (liefAuth) {
    protokoll('Beende den Authserver für das Update (er wird danach neu gestartet) ...', 'STEP')
    try { serverManager.stop('auth') } catch (_) {}
  }
  if (liefWorld || liefAuth) await sleep(4000)

  // Ergebnis der Neustarts nach dem Update - Grundlage für Toast und Rückgabe
  const neuGestartet = { world: null, auth: null }
  // Stempel der Sicherung VOR dem Update (für den Verlauf/Rollback)
  let updateSicherung = null

  const steps = [
    { key: 'quelle', weight: 25, run: async () => {
      await quelleSichern(p, opts)
      // Merken, ob die Quellen wirklich aenderten - konfigurieren/bauen
      // springen dann aus, und das Update dauert Minuten statt Stunden.
      lauf.quellenIdentisch = await quelleUnveraendert(p, opts.werkzeuge.git)
      /*
       * Modul-Änderungen (installiert, aktualisiert, entfernt) ändern den
       * Core-HEAD NICHT - ohne diesen Merker würde der Build übersprungen
       * und das neue Modul fehlte in der EXE. Deshalb erzwingen.
       */
      try {
        if (store.read().buildNoetig) {
          lauf.quellenIdentisch = false
          protokoll('Modul-Änderung erkannt - Konfigurieren und Übersetzen werden erzwungen.', 'STEP')
        }
      } catch (_) {}
      if (lauf.quellenIdentisch) {
        protokoll('Die Quellen sind unverändert - Konfigurieren und Übersetzen werden übersprungen.', 'STEP')
      }
    } },
    // Die Datenbank muss VOR dem Konfigurieren und Bauen laufen: die
    // Serverkonfiguration braucht Port und Zugangsdaten, und der Build
    // schreibt sie direkt mit. Ohne diesen Schritt war lauf.mysql noch
    // null, und der Build brach mit "Cannot read properties of null" ab.
    { key: 'mysql', weight: 10, run: async () => { await mySqlVorbereiten(p, opts) } },
    { key: 'konfigurieren', weight: 5, run: async () => {
      if (lauf.quellenIdentisch) { protokoll('konfigurieren übersprungen (Quellen unverändert).', 'INFO'); return }
      await konfigurieren(p, opts)
    } },
    { key: 'bauen', weight: 50, run: async () => {
      if (lauf.quellenIdentisch) { protokoll('bauen übersprungen (Quellen unverändert).', 'INFO'); return }
      await bauen(p, opts)
    } },
    { key: 'datenbank', weight: 8, run: async () => {
      const my = lauf.mysql
      if (!my) throw new Error('Die Datenbank wurde nicht vorbereitet - bitte das Update erneut starten.')
      if (lauf.quellenIdentisch) {
        /*
         * Ohne neue Commits gibt es keine neuen SQL-Updates. Die volle
         * Sicherung + der dbimport (Minuten) wären reine Wartezeit - die
         * Nacht-Wartung lief dadurch jede Nacht 10-20 Minuten ohne Anlass.
         * Schema-Updates, die der Worldserver beim Start zieht, bleiben
         * davon unberührt.
         */
        await binWaehlen(p)
        protokoll('Keine neuen SQL-Updates (Quellen unverändert) - Datenbank-Import und Sicherung werden übersprungen.', 'INFO')
        /*
         * Der Handover gehört trotzdem dazu: die vom Assistenten gestartete
         * MySQL beenden und die Panel-verwaltete starten - sonst kennt die
         * Prozessverwaltung ihre Datenbank später nicht.
         */
        await mySqlBeenden(p, my)
        await sleep(1200)
        await serverManager.start('db')
        return
      }

      let sicherungsStamp = null
      /*
       * Sicherheitshalber eine Sicherung der aktuellen Datenbank ziehen,
       * BEVOR der Import laeuft. Geht das Update schief, ist der alte Stand
       * damit rueckholbar - Characters und Fortschritte bleiben bewahrt.
       * Scheitert die Sicherung (kein mysqldump, volle Platte), blockiert
       * sie das Update nicht.
       */
      try {
        protokoll('Sichere die Datenbank vor dem Update ...', 'STEP')
        const sicherung = await require('./backup').create()
        sicherungsStamp = sicherung.stamp
        updateSicherung = sicherungsStamp
        protokoll(
          `Sicherung fertig (${Math.round((sicherung.size || 0) / 1024 / 1024)} MB, Stamp ${sicherungsStamp})` +
            (sicherung.removed && sicherung.removed.length ? `, ${sicherung.removed.length} alte Datei(en) entfernt.` : '.'),
          'STEP'
        )
      } catch (e) {
        protokoll(`WARNUNG: Die Sicherung vor dem Update schlug fehl (${e.message}) - Update läuft trotzdem weiter.`, 'WARN')
      }

      try {
        await datenbankImportieren(p, opts, my)
      } catch (importFehler) {
        /*
         * Scheitert der Import, bleibt eine halb-aktualisierte Datenbank
         * zurück. Die Sicherung vom Anfang gibt den alten Stand her -
         * automatisch zurückrollen, statt den Nutzer mit einem kaputten
         * Zwischenstand zu lassen.
         */
        if (sicherungsStamp) {
          await datenbankRollback(sicherungsStamp, p, my, liefWorld, liefAuth)
        } else {
          protokoll('Es gibt keine Sicherung zum Zurückrollen (die Sicherung vor dem Update schlug bereits fehl).', 'ERROR')
        }
        throw importFehler
      }
      /*
       * Das Panel auf den aktualisierten Stand umstellen - aber nur, wenn es
       * diesen Server schon benutzt. Zeigt es auf eine andere Installation
       * (etwa ein Repack daneben), waere ein stilles Umschalten eine boese
       * Ueberraschung: der Nutzer verwaltet dann ploetzlich einen anderen Server.
       */
      if (panelZeigtAuf(p.root)) {
        einstellungenSpeichern(p, opts, my)
      } else {
        protokoll(
          'Das Panel zeigt auf einen anderen Server - die Einstellungen bleiben unveraendert. ' +
            'Zum Umschalten im Einrichtungsassistenten "Vorhandenen Server verwenden" waehlen.',
          'WARN'
        )
      }
      await mySqlBeenden(p, my)
      await sleep(1200)
      await serverManager.start('db')
    }},
    { key: 'fertig', weight: 2, run: async () => {
      protokoll('Update abgeschlossen.', 'STEP')
      // install-state aufräumen: der Step-Zustand der ALTEN Installation
      // (z. B. "fertig: running" vom Vortag) haengt sonst ewig in der Datei.
      const st = leseZustand(root)
      if (st) schreibeZustand(root, { ...st, running: false, steps: undefined })
      // Server, die vor dem Update liefen, wieder anfahren.
      if (liefWorld) {
        protokoll('Starte den Worldserver wieder ...', 'STEP')
        await sleep(2000)
        const w = await serverManager.start('world')
        neuGestartet.world = !!(w && w.ok)
        protokoll(w && w.ok ? 'Worldserver läuft wieder.' : `WARNUNG: Worldserver-Start: ${(w && w.error) || 'unbekannt'}`, w && w.ok ? 'STEP' : 'WARN')
      }
      if (liefAuth) {
        await sleep(2000)
        protokoll('Starte den Authserver wieder ...', 'STEP')
        const a = await serverManager.start('auth')
        neuGestartet.auth = !!(a && a.ok)
        protokoll(a && a.ok ? 'Authserver läuft wieder.' : `WARNUNG: Authserver-Start: ${(a && a.error) || 'unbekannt'}`, a && a.ok ? 'STEP' : 'WARN')
      }
    }}
  ]
  lauf.schritte = steps

  try {
    const updateStart = Date.now()
    for (let i = 0; i < steps.length; i++) {
      if (lauf.cancelled) throw abbruchFehler()
      lauf.stepIndex = i
      lauf.stepKey = steps[i].key
      lauf.steps[i].state = 'running'
      setzeSchritt(i, 'running', `${steps[i].key} ...`)
      const t0 = Date.now()
      await steps[i].run()
      /*
       * Dauer je Abschnitt: "Wie lange dauert ein Update?" ist die Frage
       * davor und danach - das Protokoll beantwortet sie jetzt.
       */
      const d = Date.now() - t0
      const min = Math.floor(d / 60000)
      const sek = Math.round((d - min * 60000) / 1000)
      protokoll(`Abschnitt ${steps[i].key} dauerte ${min}:${String(sek).padStart(2, '0')} min.`, 'INFO')
      lauf.steps[i].state = 'ok'
      setzeSchritt(i, 'ok', `${steps[i].key} fertig.`)
    }
    {
      const d = Date.now() - updateStart
      const min = Math.floor(d / 60000)
      const sek = Math.round((d - min * 60000) / 1000)
      protokoll(`Update insgesamt: ${min}:${String(sek).padStart(2, '0')} min.`, 'STEP')
    }
    lauf.running = false
    lauf.finishedAt = new Date().toISOString()
    lauf.percent = 100
    emit({ type: 'done', ok: true, status: kurzStatus(), neuGestartet })
    require('./notify').melde('AzerothCore-Update fertig', `Server ist auf Stand ${root}.`)
    /*
     * Verlauf: "lief das Nacht-Update?" soll man später beantworten können,
     * ohne das Protokoll von gestern zu suchen.
     */
    try {
      const eintrag = {
        zeit: new Date().toISOString(),
        dauerMin: Math.round((Date.now() - updateStart) / 60000),
        ok: true,
        quellenIdentisch: !!lauf.quellenIdentisch,
        neuGestartet,
        sicherung: updateSicherung
      }
      const alt = Array.isArray(store.read().updateHistory) ? store.read().updateHistory : []
      store.write({ updateHistory: [eintrag, ...alt].slice(0, 5) })
    } catch (_) {}
    return { ok: true, running: false, root, status: status(), neuGestartet }
  } catch (err) {
    lauf.running = false
    lauf.finishedAt = new Date().toISOString()
    if (istAbgebrochen(err)) {
      lauf.abgebrochen = true
    } else {
      lauf.error = err.message
      protokoll(`Fehler: ${err.message}`, 'ERROR')
      try {
        const eintrag = { zeit: new Date().toISOString(), ok: false, fehler: err.message, sicherung: updateSicherung }
        const alt = Array.isArray(store.read().updateHistory) ? store.read().updateHistory : []
        store.write({ updateHistory: [eintrag, ...alt].slice(0, 5) })
      } catch (_) {}
    }
    if (liefWorld || liefAuth) {
      protokoll('Hinweis: World-/Authserver blieben für das Update gestoppt und können im Panel neu gestartet werden.', 'WARN')
    }
    if (lauf.stepIndex >= 0 && lauf.steps[lauf.stepIndex]) {
      lauf.steps[lauf.stepIndex].state = 'fail'
    }
    emit({ type: 'error', message: lauf.error || 'Abgebrochen.', status: kurzStatus() })
    require('./notify').melde('AzerothCore-Update fehlgeschlagen', lauf.error || 'Abgebrochen.')
    throw err
  }
}
async function start (input = {}) {
  if (startLaeuft || (lauf && lauf.running)) {
    throw new Error('Es läuft bereits eine Einrichtung.')
  }
  startLaeuft = true

  const root = normalisiereRoot(input.root)
  const opts = {
    root,
    mysqlPort: Number(input.mysqlPort) || 3306,
    buildProfile: ['full', 'balanced', 'background'].includes(input.buildProfile)
      ? input.buildProfile
      : 'balanced',
    downloadClientData: input.downloadClientData !== false,
    autoInstallTools: input.autoInstallTools !== false,
    realmName: String(input.realmName || 'AzerothCore').trim() || 'AzerothCore',
    clientDataPath: input.clientDataPath ? path.resolve(input.clientDataPath) : '',
    branch: input.branch || QUELLE_BRANCH,
    playerbots: input.playerbots === true
  }
  const p = pfade(root)
  try {
    await fsp.mkdir(p.root, { recursive: true })
    await fsp.mkdir(p.logs, { recursive: true })
  } catch (e) {
    startLaeuft = false
    throw e
  }

  /*
   * SOAP-Zugang vorbereiten. Bei einem Wiederholungslauf bleiben Benutzer,
   * Passwort und Port erhalten - der Port kann dann bereits vom eigenen,
   * noch laufenden Worldserver belegt sein. Nur eine frische Einrichtung
   * weicht auf einen freien Port aus.
   */
  const vorher = leseZustand(root)
  const soap = soapZugangAusZustand(vorher)
  const portBekannt = !!(vorher && vorher.soap && Number(vorher.soap.port))
  try {
    if (!portBekannt && !(await portFrei(soap.port))) soap.port = await freierPort(soap.port + 1)
  } catch (err) {
    startLaeuft = false
    throw err
  }
  opts.soap = soap

  lauf = {
    running: true,
    root,
    opts,
    pfade: p,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    cancelled: false,
    abgebrochen: false,
    error: '',
    child: null,
    mysql: null,
    stepIndex: -1,
    stepKey: '',
    percent: 0,
    log: [],
    logDatei: path.join(p.logs, `installation-${zeitstempel()}.log`),
    steps: STEPS.map(s => ({ key: s.key, state: 'pending' }))
  }
  startLaeuft = false

  protokoll(`AzerothCore-Einrichtung gestartet: ${root}`, 'STEP')
  protokoll(`Quelle: ${QUELLE} (Branch ${opts.branch})`, 'INFO')
  emit({ type: 'start', root, status: kurzStatus() })

  ausfuehren()
    .then(() => {
      lauf.running = false
      lauf.finishedAt = new Date().toISOString()
      lauf.percent = 100
      emit({ type: 'done', ok: true, status: kurzStatus() })
      require('./notify').melde('Einrichtung abgeschlossen', `Server eingerichtet: ${root}. Datenbank läuft im Panel.`)
    })
    .catch(async err => {
      if (lauf) {
        lauf.running = false
        lauf.finishedAt = new Date().toISOString()
        if (istAbgebrochen(err)) {
          lauf.abgebrochen = true
          lauf.error = ''
          protokoll('Einrichtung abgebrochen.', 'WARN')
        } else {
          lauf.error = err.message
          protokoll(`Fehler: ${err.message}`, 'ERROR')
          if (err.stack) protokoll(err.stack, 'ERROR')
          if (lauf.stepIndex >= 0 && lauf.steps[lauf.stepIndex]) {
            lauf.steps[lauf.stepIndex].state = 'fail'
          }
        }
        try {
          if (lauf.mysql && lauf.mysql.child && lauf.mysql.child.exitCode === null) {
            await mySqlBeenden(lauf.pfade, lauf.mysql)
          }
        } catch (_) {}
        schreibeZustand(lauf.root, {
          ...(leseZustand(lauf.root) || {}),
          running: false,
          finishedAt: lauf.finishedAt,
          abgebrochen: lauf.abgebrochen,
          error: lauf.error,
          options: oeffentlicheOptionen(lauf.opts),
          steps: lauf.steps
        })
        emit({ type: 'error', message: lauf.error || 'Abgebrochen.', status: kurzStatus() })
        require('./notify').melde('Einrichtung fehlgeschlagen', lauf.error || 'Abgebrochen.')
      }
    })

  return { ok: true, running: true, root, status: status() }
}

async function cancel () {
  if (!lauf || !lauf.running) return { ok: false, error: 'Es läuft keine Einrichtung.' }
  lauf.cancelled = true
  protokoll('Abbruch angefordert - laufender Schritt wird beendet ...', 'WARN')
  if (lauf.child) killTree(lauf.child.pid)
  if (lauf.mysql && lauf.mysql.child) killTree(lauf.mysql.child.pid)
  return { ok: true }
}

async function openLog () {
  if (!lauf || !lauf.logDatei || !exists(lauf.logDatei)) {
    throw new Error('Es gibt noch kein Installationsprotokoll.')
  }
  const { shell } = require('electron')
  const fehler = await shell.openPath(lauf.logDatei)
  if (fehler) throw new Error(fehler)
  return { ok: true, path: lauf.logDatei }
}

/*
 * Quellen hart reparieren: Stash -> fetch -> reset --hard origin/<branch> ->
 * Submodule. Der Rettungsweg, wenn `git pull` an einem kaputten Arbeitsbaum
 * scheitert und das Update sonst still beim alten Stand bleibt.
 */
async function quelleReparieren (input = {}) {
  if (startLaeuft || (lauf && lauf.running)) {
    throw new Error('Es läuft bereits eine Einrichtung.')
  }
  const root = normalisiereRoot(input.root)
  const p = pfade(root)
  if (!istOrdner(path.join(p.source, '.git'))) {
    throw new Error('Kein Git-Repository gefunden. Bitte zuerst installieren.')
  }
  const git = await findeGit(root)
  if (!git) throw new Error('Git nicht gefunden.')

  startLaeuft = true
  await fsp.mkdir(p.logs, { recursive: true })
  lauf = {
    running: true, root, opts: {}, pfade: p,
    startedAt: new Date().toISOString(), finishedAt: '', cancelled: false, abgebrochen: false,
    error: '', child: null, mysql: null, stepIndex: 0, stepKey: 'quelle', percent: 0, log: [],
    logDatei: path.join(p.logs, `reparatur-${zeitstempel()}.log`),
    steps: [{ key: 'quelle', state: 'running' }]
  }
  emit({ type: 'status', status: kurzStatus() })
  try {
    protokoll('Repariere die Quellen: Stash → fetch → reset --hard → Submodule ...', 'STEP')
    await run(git, ['-C', p.source, 'stash', 'push', '-u', '-m', 'Panel-Reparatur-Autostash'], { allowFail: true, timeoutMs: 120000 })
    lauf.percent = 20
    emit({ type: 'status', status: kurzStatus() })
    await run(git, ['-C', p.source, 'fetch', 'origin', QUELLE_BRANCH], { timeoutMs: 10 * 60 * 1000 })
    lauf.percent = 45
    emit({ type: 'status', status: kurzStatus() })
    await run(git, ['-C', p.source, 'reset', '--hard', `origin/${QUELLE_BRANCH}`], { timeoutMs: 5 * 60 * 1000 })
    lauf.percent = 70
    emit({ type: 'status', status: kurzStatus() })
    await run(git, ['-C', p.source, 'submodule', 'update', '--init', '--recursive'], { timeoutMs: 60 * 60 * 1000 })
    const pop = await run(git, ['-C', p.source, 'stash', 'pop'], { allowFail: true, timeoutMs: 120000 })
    if (pop.code !== 0) {
      protokoll('Stash-Zurückholen ging nicht auf - die Änderungen liegen sicher im Git-Stash (git stash list).', 'WARN')
    }
    lauf.percent = 100
    lauf.running = false
    lauf.steps[0].state = 'ok'
    lauf.stepIndex = -1
    lauf.stepKey = ''
    emit({ type: 'done', ok: true, status: kurzStatus() })
    protokoll('Quellen repariert.', 'STEP')
    return { ok: true }
  } catch (err) {
    lauf.running = false
    lauf.error = err.message
    lauf.steps[0].state = 'fail'
    emit({ type: 'error', message: err.message, status: kurzStatus() })
    throw err
  } finally {
    startLaeuft = false
  }
}

module.exports = {
  init,
  environment,
  start,
  status,
  cancel,
  openLog,
  checkUpdate,
  update,
  clientDatenAktualisieren,
  quelleReparieren,
  fremdDbUebernehmen,
  fremdDbZaehlen,
  mysqlPortAendern,
  serverStand,
  // Fuer Pruefskripte: reine Rechen- und Dateifunktionen ohne Netzzugriff.
  __intern: {
    pfade,
    normalisiereRoot,
    setConfValue,
    dbInfo,
    formatConfWert,
    myIniInhalt,
    clientCnfInhalt,
    prozentBasis,
    soapZugangAusZustand,
    soapKontoAnlegen,
    quelleUnveraendert,
    moduleAktualisieren,
    datenbankRollback,
    gemeinsameSpalten,
    STEPS
  }
}
