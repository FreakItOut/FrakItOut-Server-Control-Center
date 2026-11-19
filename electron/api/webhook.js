'use strict'

/*
 * Discord-Webhook: optional. Ist eine URL gesetzt, wird jede
 * Desktop-Benachrichtigung zusätzlich in einen Discord-Kanal gepostet -
 * praktisch, wenn Freunde im Server sitzen und wissen wollen, was los ist
 * (Server online/offline, Update fertig, Backup durch).
 *
 * Der Versand ist Fire-and-Forget: Ein Webhook darf das Panel nie
 * blockieren oder zum Absturz bringen.
 */

let store = null

function init (storeRef) {
  store = storeRef
}

function konfig () {
  try {
    return store.read().webhook || {}
  } catch (_) {
    return {}
  }
}

function aktiv () {
  const w = konfig()
  return !!(w.url && String(w.url).startsWith('https://') && w.aktiv !== false)
}

function senden (titel, text) {
  if (!aktiv()) return Promise.resolve({ ok: false, uebersprungen: true })
  const w = konfig()
  const inhalt = `**${titel}**\n${String(text || '')}`.slice(0, 1900)
  return new Promise(resolve => {
    try {
      const https = require('https')
      const u = new URL(w.url)
      const daten = JSON.stringify({ content: inhalt })
      const req = https.request(
        {
          hostname: u.hostname,
          port: 443,
          path: u.pathname + (u.search || ''),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(daten)
          },
          timeout: 10000
        },
        res => {
          res.resume()
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode })
        }
      )
      req.on('error', e => resolve({ ok: false, error: e.message }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, error: 'Timeout' })
      })
      req.write(daten)
      req.end()
    } catch (e) {
      resolve({ ok: false, error: e.message })
    }
  })
}

// Testknopf: eine sichtbare Nachricht schicken
async function testen () {
  if (!konfig().url) throw new Error('Keine Webhook-URL gesetzt.')
  const r = await senden('FreakItOut Server Control Center', 'Testmeldung - Webhook ist eingerichtet. Ab sofort kommen hier Server- und Update-Ereignisse an.')
  if (!r.ok) throw new Error(`Webhook antwortete nicht erfolgreich${r.error ? `: ${r.error}` : r.status ? ` (HTTP ${r.status})` : '.'}`)
  return { ok: true }
}

module.exports = { init, senden, testen, aktiv }
