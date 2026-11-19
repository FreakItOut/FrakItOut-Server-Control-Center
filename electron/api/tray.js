'use strict'

/*
 * System-Tray: haelt das Panel unsichtbar am Leben und bietet
 * Schnellzugriffe. Das Menue wird hier gebaut - main.js bindet nur an,
 * wie es die Architekturregel (check-kontextmenue) verlangt.
 */

const path = require('path')
const fs = require('fs')

let store = null

function init (storeRef) {
  store = storeRef
}

function inTrayModus () {
  try {
    return !!(store.read().panel || {}).inTray
  } catch (_) {
    return false
  }
}

function erzeugen (mainWindow, app) {
  try {
    const { Tray, Menu } = require('electron')
    const symbol = path.join(__dirname, '..', '..', 'build', 'icon.png')
    if (!fs.existsSync(symbol)) return null
    const tray = new Tray(symbol)
    tray.setToolTip('FreakItOut Server Control Center')
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Panel zeigen',
        click: () => {
          const w = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : require('electron').BrowserWindow.getAllWindows()[0]
          if (w) {
            if (w.isMinimized()) w.restore()
            w.show()
            w.focus()
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Alles starten (DB → Auth → World)',
        click: () => {
          require('./start-all').startAll({ delay: 10, waitDb: true }).catch?.(() => {})
          const w = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : require('electron').BrowserWindow.getAllWindows()[0]
          if (w) w.show()
        }
      },
      {
        label: 'Alles beenden',
        click: () => {
          try { require('../server-manager').shutdownAll() } catch (_) {}
        }
      },
      {
        label: 'Auf Updates prüfen',
        click: () => {
          try {
            const root = (store.read().server || {}).rootDir || ''
            require('./installer').checkUpdate({ root, erzwingen: true })
              .then(r => {
                const { init: notifyInit, melde } = require('./notify')
                notifyInit(store)
                melde(
                  'Update-Prüfung',
                  r.ok
                    ? (r.verfuegbar ? `${r.anzahl} neue Commits verfügbar (${r.lokal} → ${r.remote}).` : 'Der Server ist auf dem neuesten Stand.')
                    : (r.error || 'Prüfung fehlgeschlagen.')
                )
              })
              .catch(e => {
                const { init: notifyInit, melde } = require('./notify')
                notifyInit(store)
                melde('Update-Prüfung fehlgeschlagen', e.message)
              })
          } catch (_) {}
        }
      },
      { type: 'separator' },
      {
        label: 'Wirklich beenden',
        click: () => {
          try { require('../server-manager').shutdownAll() } catch (_) {}
          app.quit()
        }
      }
    ]))
    tray.on('double-click', () => {
      const w = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : require('electron').BrowserWindow.getAllWindows()[0]
      if (w) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
    })
    trayObjekt = tray
    return tray
  } catch (e) {
    console.error('[tray] konnte nicht erzeugt werden:', e.message)
    return null
  }
}

let trayObjekt = null

/*
 * Live-Status im Tray-Tooltip: "World ✓ · Auth ✓ · DB ✓" - ein Blick aus
 * dem Tray genügt, ohne das Fenster zu öffnen. Wird vom server-manager
 * bei jeder Statusänderung angerufen.
 */
function statusTooltip (status) {
  try {
    if (!trayObjekt) return
    const zeichen = k => (status[k] && status[k].running ? '✓' : '·')
    trayObjekt.setToolTip(
      `FreakItOut Server Control Center  ·  World ${zeichen('world')}  Auth ${zeichen('auth')}  DB ${zeichen('db')}`
    )
  } catch (_) {}
}

module.exports = { init, inTrayModus, erzeugen, statusTooltip }
