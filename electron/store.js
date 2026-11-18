'use strict'

const path = require('path')
const fs = require('fs')

let baseDir = null
let filePath = path.join(__dirname, '..', 'config.json')

const defaults = {
  mysql: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    authDb: 'ac_auth',
    charDb: 'ac_characters',
    worldDb: 'ac_world'
  },
  server: {
    // Pfade zu den AzerothCore-Binaries
    authExe: 'C:/AzerothCore/bin/authserver/authserver.exe',
    worldExe: 'C:/AzerothCore/bin/worldserver/worldserver.exe',
    // Verzeichnisse mit worldserver.conf / authserver.conf
    authConfDir: 'C:/AzerothCore/bin/authserver',
    worldConfDir: 'C:/AzerothCore/bin/worldserver',
    autoStartAuth: false,
    autoStartWorld: false,
    // Endet ein Server von allein, ihn wieder anwerfen? (max. 3 Versuche)
    autoRestart: false,
    // Arbeitsverzeichnis der Serverprozesse. Bei Repacks weicht das vom
    // Config-Ordner ab (die EXE muss aus der Serverwurzel starten).
    workDir: '',
    rootDir: '',
    // Vom Nutzer gewaehlte Bot-Konfiguration (z. B. playerbots.conf)
    botFile: '',
    // Datenbank: entweder als Windows-Dienst oder direkt die mysqld.exe starten
    mysqlServer: {
      exe: '',
      serviceName: '',
      dataDir: '',
      extraArgs: ''
    }
  },
  /*
   * Nachts-Wartung: einmal am Tag das Server-Update automatisch laufen
   * lassen (Sicherung, Quellen, Build, Datenbank). Der Timer lebt im
   * Panel - laeuft das Programm nicht, findet keine Wartung statt.
   */
  maintenance: {
    enabled: false,
    stunde: 3,
    minute: 0,
    // Wartung nur anstoßen, wenn kein Spieler online ist (Nachts-Wartung
    // soll Freunde nicht rauswerfen). Abgelaufene Versuche laufen trotzdem.
    nurBeiLeer: false,
    warteMinuten: 15,
    warteVersuche: 8,
    // Bot-Konto-Präfixe: Konten mit diesen Namensanfängen (plus dem
    // SOAP-Konto) zählen NICHT als Spieler - sonst würde der Schutz auf
    // einem Server mit Playerbots nie zuschlagen.
    botKontoPraefixe: 'rndbot, ahbot, playerbots',
    // Täglicher Weltserver-Neustart (Speicherhygiene bei Dauerbetrieb)
    restartAktiv: false,
    restartStunde: 6,
    restartMinute: 0,
    // Vorwarnzeit in Sekunden, die der Core selbst im Spiel ansagt
    restartVorwarnSek: 60,
    // Abgelaufene Bans taeglich automatisch entfernen (nur melden oder loeschen)
    banCleanup: false,
    banCleanupStunde: 5,
    banCleanupMinute: 0,
    banCleanupNurMelden: false,
    letzteBanReinigung: null,
    // Nach der Datenbank-Wartung zusaetzlich CHECK TABLE laufen lassen
    dbCheck: false,
    letzteDbPruefung: null
  },
  /*
   * Dienst-Waechter: Ein laufender Dienst, dessen Port nicht mehr offen ist,
   * haengt - ohne dass der Prozess endet. Der Waechter prueft das im
   * Hintergrund und kann den Dienst optional neu starten.
   */
  watchdog: {
    enabled: true,
    autoRestart: false
  },
  /*
   * Discord-Webhook: optional. Ist eine URL gesetzt, wird jede
   * Desktop-Benachrichtigung zusätzlich in den Kanal gepostet - praktisch,
   * wenn Freunde im Server sitzen und wissen wollen, was los ist.
   */
  webhook: {
    url: '',
    aktiv: true
  },
  /*
   * Serverprofile: benannte Kopien von server/mysql/soap, um zwischen
   * Installationen (etwa Repack und Quell-Build) umschalten zu koennen.
   */
  profile: {
    aktiv: '',
    liste: []
  },
  /*
   * Zuletzt benutzte Assistenten-Optionen: Zielordner, Realm-Name,
   * Playerbots usw. werden beim nächsten Aufruf vorausgefüllt.
   */
  setup: {
    zuletzt: {}
  },
  /*
   * SOAP. Der Port ist 7878 und nicht 8080: 7878 ist der Wert, den der
   * Core selbst als Vorgabe in die worldserver.conf schreibt
   * ("Default: 7878"). Das Panel war vorher auf 8080 eingestellt - da
   * lauschte nichts, und die Fehlermeldung lautete "ECONNREFUSED
   * 127.0.0.1:8080", obwohl der Server auf 7878 lauschen wuerde, sobald
   * SOAP.Enabled = 1 gesetzt ist.
   */
  soap: {
    enabled: false,
    host: '127.0.0.1',
    port: 7878,
    user: 'GMNAME',
    password: 'GMPASS'
  },
  panel: {
    theme: 'dark',
    // Sprache der Panel-Oberflaeche: 'de' oder 'en'
    language: 'de',
    // Mit Windows starten (nur im gepackten Programm wirksam)
    autostart: false,
    // Fenster unsichtbar in den Tray legen, wenn das X gedrückt wird.
    // Sinnvoll, weil die Nachts-Wartung ein offenes Panel braucht.
    inTray: false,
    // Desktop-Benachrichtigungen (Update fertig, Server-Crash, Backup)
    meldungen: true
  },
  backup: {
    // Leer lassen: dann sichert das Panel neben den Server (<Wurzel>\backups)
    dir: '',
    // Automatische Sicherung. intervalHours = 0 schaltet sie ab.
    auto: {
      enabled: false,
      // 0 = aus. Sonst aller X Stunden.
      intervalHours: 6,
      // Wie viele Sicherungen (Zeitpunkte) aufheben, bevor die aelteste
      // geloescht wird. Ohne diese Grenze fuellt jede Sicherung von ueber
      // 300 MB die Platte irgendwann.
      keep: 10,
      // Komprimieren. Eine Welt-Datenbank schrumpft dadurch auf etwa ein
      // Zehntel - ohne externes Programm, ueber das eingebaute zlib.
      compress: true
    },
    // Monatslicher Wiederherstellungstest: 1. des Monats, 04:00
    verify: false,
    /*
     * Zweites Sicherungsziel (andere Platte/NAS). Nach jeder Sicherung wird
     * dorthin kopiert; keep begrenzt die Zahl der Gruppen am Ziel.
     */
    mirror: {
      dir: '',
      keep: 5
    }
  }
}

let cache = null
let watcher = null
let eigeneSchreibvorgaenge = 0

function deepMerge (target, source) {
  const out = { ...target }
  for (const key of Object.keys(source || {})) {
    const sv = source[key]
    const tv = out[key]
    // "null" in der Datei darf ein Standardobjekt nicht ersetzen: sonst
    // stehen z. B. mysql oder soap als null im Speicher, und jeder Zugriff
    // auf cfg.mysql.port endet mit "Cannot read properties of null".
    if (sv === null && tv && typeof tv === 'object' && !Array.isArray(tv)) continue
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      out[key] = deepMerge(tv && typeof tv === 'object' ? tv : {}, sv)
    } else if (sv !== undefined) {
      out[key] = sv
    }
  }
  return out
}

function read () {
  if (cache) return cache
  let onDisk = {}
  try {
    if (fs.existsSync(filePath)) {
      onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch (e) {
    console.error('[store] config unlesbar:', e.message)
  }
  cache = deepMerge(defaults, onDisk)
  return cache
}

function write (patch) {
  const current = read()
  cache = deepMerge(current, patch || {})
  if (!baseDir) baseDir = path.dirname(filePath)
  // Eigene Schreibvorgaenge kurz markieren, damit der Dateiwatcher sie
  // nicht als "externer Aenderung" zurueckmeldet.
  eigeneSchreibvorgaenge = Date.now()
  try {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8')
    haerteBerechtigungen()
  } catch (e) {
    console.error('[store] config schreiben fehlgeschlagen:', e.message)
  }
  return cache
}

/*
 * Die config.json enthaelt Passwörter im Klartext. Standardmaessig darf auf
 * Windows jeder lokale Administrator und - je nach Ordner - "Benutzer" die
 * Datei lesen. Diese Funktion zieht die Berechtigungen auf den aktuellen
 * Nutzer zurueck. Misslingt das (icacls fehlt, ungewöhnliches Laufwerk),
 * bleibt es beim bisherigen Zustand - sicherer werden statt abbrechen.
 */
let berechtigungenGeaendert = false
function haerteBerechtigungen () {
  if (process.platform !== 'win32' || !filePath) return
  const { execFileSync } = require('child_process')
  const nutzer = process.env.USERDOMAIN && process.env.USERNAME
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME
  try {
    execFileSync('icacls', [filePath, '/inheritance:r', `/grant:r`, `${nutzer}:F`], {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore'
    })
    berechtigungenGeaendert = true
  } catch (e) {
    if (!berechtigungenGeaendert) {
      console.error('[store] Berechtigungen konnten nicht gehärtet werden:', e.message)
      berechtigungenGeaendert = true // nur einmal meckern
    }
  }
}

// Cache verwerfen, damit die naechste read() die Datei erneut einliest.
function reload () {
  cache = null
  return read()
}

// Die Datei im Auge behalten und melden, wenn sie von aussen geaendert
// wurde. Dadurch wirken Handaenderungen ohne Neustart.
function watch (onChange) {
  if (watcher) return watcher
  if (!filePath) return null
  let timer = null

  const ausloesen = () => {
    // Nicht auf eigene Schreibvorgaenge reagieren
    if (Date.now() - eigeneSchreibvorgaenge < 800) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        reload()
        if (typeof onChange === 'function') onChange(read())
      } catch (e) {
        console.error('[store] config neu lesen fehlgeschlagen:', e.message)
      }
    }, 250)
  }

  try {
    watcher = fs.watch(filePath, { persistent: false }, ausloesen)
    // Manche Editoren ersetzen die Datei statt sie zu beschreiben - dann
    // feuert der Watcher auf der Datei nicht mehr. Das Verzeichnis mit
    // beobachten und den Pfad gegenpruefen.
    watcher.on('error', () => {})
  } catch (e) {
    console.error('[store] config nicht beobachtbar:', e.message)
    watcher = null
  }
  return watcher
}

function unwatch () {
  if (watcher) {
    try { watcher.close() } catch (_) {}
    watcher = null
  }
}

function filePathOf () {
  return filePath
}

function init (userDataDir) {
  baseDir = userDataDir
  filePath = path.join(userDataDir, 'config.json')
  if (!fs.existsSync(filePath)) {
    // Defaults sofort persistieren, damit die Datei als Vorlage sichtbar ist
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf8')
      cache = deepMerge({}, defaults)
    } catch (e) {
      console.error('[store] Defaults nicht schreibbar:', e.message)
    }
  }
}

/* ============================================================
   config.json neben der EXE
   ============================================================ */

/*
 * Wo liegt die Datei, die der Nutzer gestartet hat?
 *
 * Die portable EXE ist ein selbstentpackendes Archiv: sie kopiert sich beim
 * Start nach %TEMP% und startet die Anwendung von dort. process.execPath
 * zeigt in diesem Fall auf die Kopie - die Konfiguration landete also neben
 * einer Datei, die es nach dem Beenden nicht mehr gibt.
 *
 * electron-builder setzt deshalb PORTABLE_EXECUTABLE_DIR auf das Verzeichnis
 * der gestarteten EXE. Das ist die gesuchte Stelle. Im Entwicklungsbetrieb
 * gibt es die Variable nicht, dann gilt der Ordner von execPath.
 */
function ordnerDerStartdatei () {
  const ausPortabl = process.env.PORTABLE_EXECUTABLE_DIR
  if (ausPortabl && fs.existsSync(ausPortabl)) return ausPortabl
  return path.dirname(process.execPath)
}

/*
 * Kann in dieses Verzeichnis geschrieben werden? Der Desktop ist manchmal
 * gesperrt (OneDrive-Platzhalter, Fremdlaufwerk, eingeschraenkte Rechte).
 * Lieber eine Probe schreiben als spaeter festzustellen, dass sich die
 * Einstellungen nicht speichern lassen.
 */
function schreibbar (dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.schreibtest-' + process.pid)
    fs.writeFileSync(probe, 'x')
    fs.unlinkSync(probe)
    return true
  } catch (_) {
    return false
  }
}

/*
 * Startet die Konfiguration "neben der EXE".
 *
 * Wird nur vom Programm selbst benutzt. Die Pruefskripte rufen weiter
 * init() mit einem eigenen Verzeichnis auf - sonst wuerde jedes davon in
 * den Projektordner schreiben.
 *
 * Reihenfolge:
 *   1. Neben der EXE, wenn dort geschrieben werden kann.
 *   2. Sonst der bisherige Ort unter %APPDATA%. Lieber am falschen Ort
 *      speichern als gar nicht.
 *   3. Liegt am alten Ort noch eine Konfiguration und neben der EXE keine,
 *      wird sie uebernommen. Sonst startet das Programm nach dem Umstieg
 *      unkonfiguriert und der Nutzer verliert Datenbankkennwort, Pfade und
 *      Zeiteinstellungen, ohne es zu merken.
 */
function initAuto ({ altesVerzeichnis = null, app = null } = {}) {
  const nebenDerExe = ordnerDerStartdatei()

  // Entwicklungsbetrieb: dort liegt keine echte EXE des Nutzers, sondern
  // electron.exe aus node_modules. Dort eine config.json abzulegen waere
  // irrefuehrend - der Entwicklungsbetrieb bleibt beim alten Ort.
  if (app && !app.isPackaged) {
    const ziel = altesVerzeichnis || nebenDerExe
    init(ziel)
    return { pfad: filePathOf(), ordner: ziel, nebenDerExe: false, grund: 'Entwicklungsbetrieb' }
  }

  const ziel = schreibbar(nebenDerExe) ? nebenDerExe : altesVerzeichnis

  if (!ziel) {
    init(nebenDerExe)
    return { pfad: filePathOf(), ordner: nebenDerExe, nebenDerExe: true, grund: 'kein Ausweichordner bekannt' }
  }

  // Uebernahme aus dem bisherigen Ort
  let uebernommen = null
  if (ziel !== altesVerzeichnis && altesVerzeichnis) {
    const alt = path.join(altesVerzeichnis, 'config.json')
    const neu = path.join(ziel, 'config.json')
    if (!fs.existsSync(neu) && fs.existsSync(alt)) {
      try {
        fs.copyFileSync(alt, neu)
        uebernommen = alt
      } catch (e) {
        console.error('[store] Konfiguration nicht uebernommen:', e.message)
      }
    }
  }

  init(ziel)
  return {
    pfad: filePathOf(),
    ordner: ziel,
    nebenDerExe: ziel === nebenDerExe,
    grund: ziel === nebenDerExe ? 'neben der EXE' : 'neben der EXE nicht schreibbar',
    uebernommen
  }
}

module.exports = { init, initAuto, read, write, reload, watch, unwatch, filePathOf, defaults }