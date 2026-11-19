'use strict'

const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')

const store = require('./store')
const db = require('./db')
const { registerRoutes } = require('./api')
const serverManager = require('./server-manager')
const startAll = require('./api/start-all')
const kontextmenue = require('./api/kontextmenue')

let mainWindow = null

/*
 * Electron leitet userData aus dem Produktnamen ab. Wuerde der Name
 * hier mitwandern, bekäme das Panel ein leeres Verzeichnis und damit
 * alle gespeicherten Einstellungen (Datenbank, Pfade, Sprache) weg.
 * Der Pfad wird deshalb festgenagelt.
 *
 * Wichtig: userData bleibt hier unter %APPDATA%. Dort liegen die
 * Chrome-eigenen Sachen (Zwischenspeicher, Cookies, Logs) - die gehoeren
 * nicht auf den Desktop. Die config.json liegt dagegen direkt neben der
 * EXE, siehe store.initAuto().
 */
const USER_DATA_ORDNER = 'wowpanel'
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_ORDNER))
const ALTES_CONFIG_VERZEICHNIS = path.join(app.getPath('appData'), USER_DATA_ORDNER)

/*
 * Panel-eigenes Fehlerprotokoll: Unbehandelte Exceptions und Rejections
 * verschwinden sonst spurlos - die Serverlogs helfen da nicht. Die Datei
 * liegt im userData-Ordner, rotiert bei 5 MB (.alt) und erscheint im
 * Protokoll-Browser der Einstellungen.
 */
const PANEL_FEHLER_LOG = path.join(app.getPath('userData'), 'panel-fehler.log')

function schreibePanelFehler (art, text) {
  try {
    fs.mkdirSync(path.dirname(PANEL_FEHLER_LOG), { recursive: true })
    try {
      if (fs.existsSync(PANEL_FEHLER_LOG) && fs.statSync(PANEL_FEHLER_LOG).size > 5 * 1024 * 1024) {
        fs.rmSync(PANEL_FEHLER_LOG + '.alt', { force: true })
        fs.renameSync(PANEL_FEHLER_LOG, PANEL_FEHLER_LOG + '.alt')
      }
    } catch (_) {}
    fs.appendFileSync(PANEL_FEHLER_LOG, `[${new Date().toISOString()}] [${art}]\r\n${String(text || '')}\r\n\r\n`, 'utf8')
  } catch (_) {}
}

process.on('uncaughtException', e => {
  schreibePanelFehler('uncaughtException', (e && e.stack) || String(e))
})
process.on('unhandledRejection', e => {
  schreibePanelFehler('unhandledRejection', (e && (e.stack || e.reason)) || String(e))
})

function createWindow () {
  /*
   * Das Programmsymbol fuer die Taskleiste. Ohne diese Zeile nimmt Windows das
   * Electron-Standardzeichen; mit einem nicht vorhandenen Pfad bleibt das
   * Verhalten unveraendert, deshalb wird nur gesetzt, wenn die Datei da ist.
   */
  const symbol = path.join(__dirname, '..', 'build', 'icon.png')
  const opt = {
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0a0a0c',
    show: true,
    autoHideMenuBar: true,
    title: 'FreakItOut Server Control Center für Azeroth-Core',
    /*
     * Eigene Titelleiste zeichnen, aber die nativen Fensterknoepfe behalten.
     *
     * Diese beiden Werte muessen zu src/styles.css passen, sonst steht der
     * Knopfblock als fremdes Rechteck in der Leiste - genau das war der
     * Anlass fuer die Aenderung. Geprueft von verify-titelleiste.js.
     *
     *   color   einfarbig, weil Windows fuer den Rahmen nur eine Farbe
     *           annimmt. Die Leiste ist deshalb flach (#08080a) - ein
     *           Verlauf wuerde an den Fensterknoepfen als Kante auffallen.
     *   height  genau so hoch wie .titlebar (34px). Beide Werte werden
     *           von verify-titelleiste.js gegeneinander geprueft.
     */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#08080a',
      symbolColor: '#e8ecf0',
      height: 34
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
  // icon erst nachtragen, wenn die Datei wirklich existiert
  if (fs.existsSync(symbol)) opt.icon = symbol

  /*
   * Gespeicherte Fenstergeometrie anwenden. Plausibilitätsprüfung: nur
   * setzen, wenn das Fenster auf einem vorhandenen Bildschirm läge -
   * sonst landet es unsichtbar hinter einem ausgestöpselten Monitor.
   */
  try {
    const { screen } = require('electron')
    const b = (store.read().panel || {}).windowBounds
    if (b && b.width >= opt.minWidth && b.height >= opt.minHeight) {
      const sichtbar = screen.getAllDisplays().some(d =>
        b.x >= d.workArea.x - 40 && b.x < d.workArea.x + d.workArea.width &&
        b.y >= d.workArea.y - 40 && b.y < d.workArea.y + d.workArea.height
      )
      if (sichtbar) {
        opt.x = b.x
        opt.y = b.y
        opt.width = b.width
        opt.height = b.height
      }
    }
  } catch (_) {}

  mainWindow = new BrowserWindow(opt)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Dev: Vite-Server. Prod: gebaute Dateien.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * Wenn die Oberflaeche gar nicht erst geladen werden kann (fehlende Datei,
   * beschaedigtes Paket), bleibt das Fenster sonst leer und niemand weiss,
   * warum. Diese beiden Ereignisse machen daraus eine lesbare Meldung.
   */
  mainWindow.webContents.on('did-fail-load', (_event, code, beschreibung, url) => {
    if (code === -3) return // -3 = vom Nutzer abgebrochen, kein Fehler
    dialog.showErrorBox(
      'Oberfläche konnte nicht geladen werden',
      `${url || 'unbekannte Adresse'}\n\n${code} ${beschreibung}`
    )
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    dialog.showErrorBox(
      'Die Oberfläche wurde beendet',
      `Grund: ${details.reason}\nCode: ${details.exitCode}`
    )
  })

  /*
   * Schließen-Schutz: Ein Update/Installations-Lauf lebt im Hauptprozess.
   * Fenster zu während des Übersetzens heißt, den Vorgang mitten im Build
   * abzubrechen - ein halber Build-Ordner und 20 verlorene Minuten.
   */
  let schliessenBestaetigt = false
  mainWindow.on('close', async e => {
    // Geometrie festhalten - beim naechsten Start am selben Ort aufgehen.
    try {
      const b = mainWindow.getBounds()
      store.write({ panel: { windowBounds: b } })
    } catch (_) {}

    let lauftEinrichtung = false
    let dauer = ''
    try {
      const st = require('./api/installer').status()
      lauftEinrichtung = !!st.running
      if (st.startedAt) {
        const min = Math.round((Date.now() - new Date(st.startedAt).getTime()) / 60000)
        dauer = min > 0 ? ` seit ${min} min` : ''
      }
    } catch (_) {}

    if (lauftEinrichtung && !schliessenBestaetigt) {
      e.preventDefault()
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Einrichtung läuft',
        message: `Es läuft gerade eine Einrichtung oder ein Update${dauer}.`,
        detail: 'Beenden bricht den Vorgang ab - der bereits übersetzte Teil bleibt erhalten, aber das Update muss wiederholt werden.',
        buttons: ['Fenster offen lassen', 'Trotzdem beenden'],
        defaultId: 0,
        cancelId: 0
      })
      if (response === 1) {
        schliessenBestaetigt = true
        mainWindow.close()
      }
      return
    }

    /*
     * Tray-Modus: das X versteckt das Fenster nur. Die Nachts-Wartung
     * braucht ein laufendes Panel - "geschlossen" soll nicht "tot" heißen.
     */
    if (require('./api/tray').inTrayModus()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  kontextmenue.anbinden(mainWindow)
}

/*
 * Tray-Erzeugung lebt im Modul - main.js bindet nur an. Siehe
 * electron/api/tray.js (Architekturregel: main.js baut keine Menues).
 */
let tray = null

function trayErzeugen () {
  if (tray) return
  const trayModul = require('./api/tray')
  trayModul.init(store)
  tray = trayModul.erzeugen(mainWindow, app)
}

// Windows-Autostart: Panel startet mit dem Login - Voraussetzung dafuer,
// dass die Nachts-Wartung zuverlaessig zuschlaegt.
function autostartAnwenden () {
  try {
    const cfg = store.read().panel || {}
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: cfg.autostart === true,
        path: process.execPath,
        args: ['--hidden']
      })
    }
  } catch (_) {}
}


// config.json im Auge behalten: wird sie von aussen geaendert, melden wir
// das an den Renderer, damit die Einstellungen ohne Neustart neu geladen
// werden. Die Datenbankpools vergleichen ihre Konfiguration selbst und
// bauen sich bei Abweichung neu auf.
function watchConfig () {
  store.watch(cfg => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w && !w.isDestroyed()) {
      w.webContents.send('config:changed', cfg)
    }
  })
}

/*
 * Eine Panel-Instanz reicht: Zweitstarts erzeugen sonst zwei
 * Prozessmanager, die dieselben Server starten/stoppen wollen - genau
 * dafuer gab es schon verwirrende Doppel-Status. Ein zweiter Aufruf
 * landet stattdessen im ersten Fenster.
 */
const hatEinzelsperre = app.requestSingleInstanceLock()

if (!hatEinzelsperre) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
  })

  app.whenReady()
    .then(() => {
    // config.json direkt neben die EXE legen. Faellt der Ordner aus
    // (Desktop gesperrt, Laufwerk entfernt), wird der alte Ort unter
    // %APPDATA% benutzt, und eine dort liegende Konfiguration wird
    // uebernommen - sonst waere der Nutzer nach dem Umstieg unkonfiguriert.
    const wo = store.initAuto({ altesVerzeichnis: ALTES_CONFIG_VERZEICHNIS, app })
    console.log(`[start] config.json: ${wo.pfad}  (${wo.grund})`)
    if (wo.uebernommen) {
      console.log(`[start] uebernommen aus ${wo.uebernommen}`)
      console.log('[start] Die alte Datei bleibt liegen und kann geloescht werden.')
    }
    // Auch hier initialisieren: normalerweise passiert das beim Laden von
    // api/index.js, aber der Zeitplan unten fragt die Datenbank ab, bevor
    // diese Datei ueberhaupt geladen wurde.
    db.init(store)
    watchConfig()
    // Ein generischer Einstiegspunkt: Renderer ruft window.api.call('route', payload)
    ipcMain.handle('api', async (_event, route, payload) => registerRoutes(route, payload))
    createWindow()

    // Erst NACH createWindow initialisieren - vorher ist mainWindow noch null
    // und die Log-Events wuerden im Renderer nicht ankommen.
    serverManager.init(store, mainWindow)
    startAll.init(store, mainWindow)
    require('./api/backup').init(mainWindow)
    require('./api/installer').init(store, mainWindow)
    // Modul-Fortschritt (Klonen, SQL-Import) geht an das Fenster
    require('./api/module').init(mainWindow)
    // Nachts-Wartung und Serverprofile brauchen das Fenster fuer ihre
    // Ereignisse - und der Wartungsplaner muss beim Start anlaufen.
    require('./api/maintenance').init(store, mainWindow)
    require('./api/maintenance').planStarten()
    require('./api/profile').init(store, mainWindow)
    // Desktop-Benachrichtigungen (Update fertig, Crash, Backup)
    require('./api/notify').init(store, mainWindow)

    // Tray + Windows-Autostart anwenden
    trayErzeugen()
    autostartAnwenden()
    if (process.argv.includes('--hidden')) {
      mainWindow.hide()
    }

    // Server automatisch anwerfen, wenn die Schalter in den Einstellungen
    // stehen. Diese Konfig-Schluessel existierten vorher, wurden aber nie
    // gelesen - jetzt starten sie DB und, je nach Wahl, Auth-/Worldserver.
    const serverCfg = (store.read().server || {})
    if (serverCfg.autoStartAuth || serverCfg.autoStartWorld) {
      console.log('[start] Autostart der Komponenten aktiviert')
      require('./api/start-all').startAll({ delay: 10, waitDb: true }).catch?.(() => {})
    }
    // Den Zeitplan erst starten, wenn die Datenbank wirklich erreichbar ist.
    // Sonst wuerde der erste Versuch ins Leere laufen und als Fehler dastehen.
    db.test('world').then(r => {
      if (r.ok) require('./api/backup').planStarten()
      else console.log('[backup] Zeitplan startet erst, sobald die Datenbank läuft.')
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch(err => {
    console.error('[main] Start fehlgeschlagen:', err)
    dialog.showErrorBox('Start fehlgeschlagen', String(err && err.stack ? err.stack : err))
    app.quit()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // laufende Serverprozesse sauber beenden
  require('./server-manager').shutdownAll()
})

/*
 * Windows fährt herunter oder geht in den Ruhezustand: ohne diesen Hook
 * sterben die Serverprozesse ohne Speichern - Charakterstände des letzten
 * Stundenplans wären weg. Ctrl+C an die Prozesskonsolen schicken, damit
 * World-/Authserver ihre Daten schreiben können. Best-Effort: Windows
 * räumt gnadenlos auf, aber der Versuch kostet nichts.
 */
app.whenReady().then(() => {
  try {
    const { powerMonitor } = require('electron')
    powerMonitor.on('shutdown', () => {
      console.log('[shutdown] Windows fährt herunter - Server werden sauber beendet')
      try { require('./server-manager').shutdownAll() } catch (_) {}
    })
  } catch (_) {}
})
