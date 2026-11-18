'use strict'

const net = require('net')
const serverManager = require('../server-manager')
const mysqlService = require('./mysql-service')

/*
 * Startet alle Komponenten hintereinander:
 *
 *   1. Datenbank
 *   2. nach <delay> Sekunden  -> Worldserver
 *   3. nach <delay> Sekunden  -> Authserver
 *
 * Der Worldserver kommt vor dem Authserver - so schreibt es die Anleitung des
 * Repacks vor. Die Verzoegerung gibt der Datenbank Zeit, ihre Tabellen zu
 * oeffnen, bevor darauf zugegriffen wird.
 *
 * Wichtig: an dieser Reihenfolge darf sich nichts ohne Not drehen. Kommentar,
 * Oberflaechentext, Pruefskript verify-startall.js und diese Liste muessen
 * dieselbe Aussage machen - sie sind schon einmal auseinanderlaufen.
 *
 * Der Ablauf laeuft im Hintergrund und meldet seinen Fortschritt ueber das
 * Event 'server:startAll'. Ein einzelner IPC-Aufruf wuerde sonst ueber
 * 40 Sekunden blockieren.
 */

let store = null
let win = null

let running = false
let cancelled = false

function init (storeRef, windowRef) {
  store = storeRef
  win = windowRef
}

function emit (payload) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send('server:startAll', payload)
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRunning = () => running

function dbEndpoint () {
  let cfg = {}
  try {
    cfg = store.read().mysql || {}
  } catch (_) {}
  return { host: cfg.host || '127.0.0.1', port: Number(cfg.port) || 3306 }
}

// Antwortet der MySQL-Port? Blockiert hoechstens timeoutMs.
function probeDb (timeout = 1500) {
  return new Promise(resolve => {
    const { host, port } = dbEndpoint()
    const socket = net.connect({ host, port })
    let settled = false
    const done = ok => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch (_) {}
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/*
 * Datenbank starten: einen laufenden Dienst unangetastet lassen,
 * sonst einen vorhandenen Dienst starten, sonst mysqld direkt starten.
 */
async function startDatabase () {
  const list = await mysqlService.listServices().catch(() => [])

  /*
   * Nur ein Dienst, der wirklich DIESE mysqld.exe startet, gehoert zum
   * Panel. Gibt es auf dem Rechner weitere MySQL-Dienste (etwa MySQL80 von
   * einer Installation ueber winget), darf das Panel sie nicht
   * andrehen: dort fehlen die Datenbanken und Zugangsdaten des Servers,
   * und das Panel meldete "Datenbank bereit", obwohl danach alle Seiten
   * mit Zugriffsfehlern brechen. Passt kein Dienst, wird die konfigurierte
   * mysqld.exe direkt gestartet.
   */
  const exe = String(((store.read().server || {}).mysqlServer || {}).exe || '')
  // Erst die Programmargumente abtrennen, dann die Anfuehrungszeichen
  // am Rand entfernen - sonst bleibt das schliessende Quote der EXE haengen.
  const kern = s => String(s || '').replace(/^"/, '').replace(/"$/, '').trim().toLowerCase()
  const zielexe = exe ? kern(exe.split(/\s+--/)[0]) : ''
  const passend = s => {
    if (!zielexe || !s.imagePath) return false
    return kern(s.imagePath.split(/\s+--/)[0]) === zielexe
  }

  const laufend = list.find(s => s.running && passend(s))
  if (laufend) {
    return `Windows-Dienst "${laufend.displayName || laufend.name}" (war bereits gestartet)`
  }

  const gestoppt = list.find(passend)
  if (gestoppt) {
    await mysqlService.serviceAction({ name: gestoppt.name, action: 'start' })
    return `Windows-Dienst "${gestoppt.displayName || gestoppt.name}"`
  }

  const res = await serverManager.start('db')
  if (!res || !res.ok) throw new Error((res && res.error) || 'Start der mysqld fehlgeschlagen')
  return `mysqld direkt gestartet (PID ${res.pid})`
}

// Auf die Datenbank warten, aber hoechstens maxSec. Nach Ablauf geht es
// weiter - ein blockierendes Warten wuerde die Sequenz nur aufhaengen.
async function waitForDb (maxSec) {
  const deadline = Date.now() + maxSec * 1000
  while (Date.now() < deadline) {
    if (cancelled) return false
    if (await probeDb(1000)) return true
    await sleep(1000)
  }
  return probeDb(1000)
}

/*
 * delay:   Sekunden zwischen den Schritten (Standard 10)
 * waitDb:  true = nach dem DB-Start auf Erreichbarkeit warten statt die
 *          volle Zeit zu schlafen (bricht frueher ab, wenn MySQL schnell
 *          bereit ist); false = immer die vollen delay Sekunden warten
 */
async function startAll ({ delay = 10, waitDb = false } = {}) {
  if (running) throw new Error('Ein Startvorgang läuft bereits.')

  running = true
  cancelled = false

  const step = Math.max(0, Number(delay) || 0)
  const startedAt = Date.now()
  const stamp = () => `+${Math.round((Date.now() - startedAt) / 1000)}s`

  emit({ step: 'begin', state: 'start', message: `Startsequenz gestartet (Abstand ${step} s).` })

  try {
    // ---------- 1. Datenbank ----------
    emit({ step: 'db', state: 'start', message: 'Datenbank wird gestartet ...' })
    let how
    try {
      how = await startDatabase()
    } catch (e) {
      emit({ step: 'db', state: 'fail', message: `Datenbank konnte nicht gestartet werden: ${e.message}` })
      throw e
    }
    emit({ step: 'db', state: 'ok', message: `${stamp()} Datenbank bereit über ${how}` })

    const { host, port } = dbEndpoint()
    if (waitDb) {
      const ok = await waitForDb(step)
      emit({
        step: 'db',
        state: ok ? 'ready' : 'wait',
        message: ok
          ? `${stamp()} MySQL antwortet auf ${host}:${port}.`
          : `${stamp()} MySQL antwortet nach ${step} s noch nicht - es geht trotzdem weiter.`
      })
    } else {
      emit({ step: 'db', state: 'ready', message: `${stamp()} MySQL ${host}:${port} · warte ${step} s ...` })
      await sleep(step * 1000)
    }
    if (cancelled) return emitCancelled()

    // ---------- 2. Worldserver ----------
    // Reihenfolge laut Anleitung des Repacks: Worldserver VOR dem Authserver.
    emit({ step: 'world', state: 'start', message: 'Worldserver wird gestartet ...' })
    const worldRes = await serverManager.start('world')
    if (!worldRes || !worldRes.ok) {
      const msg = (worldRes && worldRes.error) || 'unbekannter Fehler'
      emit({ step: 'world', state: 'fail', message: `Worldserver: ${msg}` })
      throw new Error(msg)
    }
    emit({ step: 'world', state: 'ok', message: `${stamp()} Worldserver läuft (PID ${worldRes.pid})` })
    emit({ step: 'world', state: 'ready', message: `${stamp()} warte ${step} s ...` })
    await sleep(step * 1000)
    if (cancelled) return emitCancelled()

    // ---------- 3. Authserver ----------
    emit({ step: 'auth', state: 'start', message: 'Authserver wird gestartet ...' })
    const authRes = await serverManager.start('auth')
    if (!authRes || !authRes.ok) {
      const msg = (authRes && authRes.error) || 'unbekannter Fehler'
      emit({ step: 'auth', state: 'fail', message: `Authserver: ${msg}` })
      throw new Error(msg)
    }
    emit({ step: 'auth', state: 'ok', message: `${stamp()} Authserver läuft (PID ${authRes.pid})` })

    emit({
      step: 'done',
      state: 'ok',
      message: `Alle Komponenten gestartet · Dauer ${Math.round((Date.now() - startedAt) / 1000)} s`
    })
  } catch (e) {
    emit({ step: 'error', state: 'fail', message: `Startsequenz abgebrochen: ${e.message}` })
    throw e
  } finally {
    running = false
    emit({ step: 'state', state: 'idle', running: false })
  }
}

function emitCancelled () {
  emit({ step: 'cancelled', state: 'fail', message: 'Startsequenz abgebrochen.' })
}

/*
 * Bricht die laufende Sequenz ab und beendet alles in umgekehrter
 * Reihenfolge zum Start: erst Authserver, dann Worldserver, die Datenbank
 * ganz zum Schluss.
 *
 * Zum Worldserver vor dem Authserver: die Charaktere schreibt der Worldserver
 * direkt in MySQL, nicht ueber den Authserver. Solange die Datenbank laeuft,
 * kann er also sauber speichern, auch wenn der Authserver schon weg ist.
 *
 * (Dieser Kommentar stand hier frueher auf "Worldserver zuerst", waehrend der
 * Code Authserver zuerst beendete. Beides zugleich ist nicht moeglich - jetzt
 * sagen Kommentar, Code und Oberflaechentext dasselbe.)
 */
async function stopAll ({ stopDb = true } = {}) {
  cancelled = true
  emit({ step: 'stop', state: 'start', message: 'Alles wird beendet ...' })

  // Umgekehrte Reihenfolge zum Start: erst Auth-, dann Worldserver,
  // die Datenbank weiter unten als letztes.
  const out = {}
  for (const kind of ['auth', 'world']) {
    try {
      out[kind] = await serverManager.stop(kind)
    } catch (e) {
      out[kind] = { ok: false, error: e.message }
    }
  }

  if (stopDb) {
    try {
      const list = await mysqlService.listServices().catch(() => [])
      const svc = list.find(s => s.running)
      if (svc) {
        await mysqlService.serviceAction({ name: svc.name, action: 'stop' })
        out.db = { ok: true, via: `Dienst "${svc.name}"` }
      } else {
        out.db = await serverManager.stop('db')
      }
    } catch (e) {
      out.db = { ok: false, error: e.message }
    }
  } else {
    out.db = { ok: true, skipped: true }
  }

  // Die Reihenfolge im Text entspricht der Reihenfolge oben: Authserver,
  // Worldserver, Datenbank. Vorher stand hier "World- zuerst", was das
  // Protokoll im Widerspruch zur Ausgabe des Servers loggte.
  emit({
    step: 'stop',
    state: 'ok',
    message: out.db && out.db.skipped
      ? 'Auth- und Worldserver beendet.'
      : 'Authserver, Worldserver und Datenbank beendet.'
  })
  return out
}

module.exports = { init, startAll, stopAll, isRunning, probeDb, startDatabase }