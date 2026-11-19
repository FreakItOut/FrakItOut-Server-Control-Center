'use strict'

/*
 * Desktop-Benachrichtigungen. Wenn das Panel im Tray liegt oder minimiert
 * ist, ist das die einzige Rueckmeldung darueber, dass das Update fertig,
 * ein Server abgestuerzt oder die Sicherung durch ist.
 *
 * Der Schalter "panel.meldungen" steuert das zentral ab; Fehlschlaege
 * (z. B. keine Berechtigung) werden still verschluckt - eine Notifikation
 * darf das Panel nie in die Knie zwingen.
 */

let store = null
let win = null

function init (storeRef, windowRef) {
  store = storeRef
  win = windowRef
}

function send (channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, payload)
  }
}

function erlaubt () {
  try {
    // Fehlte der Schalter, war er bisher aus - die Oberflaeche zeigt ihn
    // aber als an. Deshalb nur aus, wenn ausdruecklich false.
    return (store.read().panel || {}).meldungen !== false
  } catch (_) {
    return true
  }
}

function liste () {
  try {
    const l = store.read().notifications
    return Array.isArray(l) ? l : []
  } catch (_) {
    return []
  }
}

function merke (titel, text) {
  try {
    const eintrag = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      zeit: new Date().toISOString(),
      titel: String(titel || ''),
      text: String(text || ''),
      gelesen: false
    }
    store.write({ notifications: [eintrag, ...liste()].slice(0, 50) })
    send('notify:event', eintrag)
    return eintrag
  } catch (_) {
    return null
  }
}

function gelesen () {
  try {
    store.write({ notifications: liste().map(n => ({ ...n, gelesen: true })) })
  } catch (_) {}
  return { ok: true }
}

function leeren () {
  try { store.write({ notifications: [] }) } catch (_) {}
  return { ok: true }
}

function melde (titel, text) {
  merke(titel, text)
  try {
    if (erlaubt()) {
      const { app, Notification } = require('electron')
      if (app && app.isReady && app.isReady() && Notification.isSupported()) {
        const n = new Notification({ title: titel, body: String(text || ''), silent: false })
        n.on('click', () => {
          try {
            const { BrowserWindow } = require('electron')
            const w = BrowserWindow.getAllWindows()[0]
            if (w) {
              if (w.isMinimized()) w.restore()
              w.show()
              w.focus()
            }
          } catch (_) {}
        })
        n.show()
      }
    }
  } catch (_) {}

  /*
   * Discord-Webhook (optional): derselbe Ereignisstrom, ein weiterer
   * Ausgang. Fire-and-forget - der Webhook darf die Meldung nie blockieren.
   */
  try {
    require('./webhook').senden(titel, text).catch?.(() => {})
  } catch (_) {}
}

/*
 * Testmeldung: zeigt, ob Desktop-Benachrichtigungen und Webhook
 * funktionieren, und landet zugleich im Meldungsverlauf.
 */
function test () {
  melde('FreakItOut Testmeldung', 'Wenn du das siehst, funktionieren die Benachrichtigungen.')
  return { ok: true }
}

module.exports = { init, melde, liste, gelesen, leeren, test }
