'use strict'

/*
 * Serverprofile: mehrere Installationen verwalten (Repack und
 * Quell-Installation parallel), Umschalten per Klick.
 *
 * Ein Profil speichert server/mysql/soap - alles, was den Serverort und
 * die Zugänge ausmacht. Beim Aktivieren wird die laufende Konfiguration
 * zuerst als Profil gesichert (damit nichts verlorengeht), dann das
 * gewaehlte geschrieben. Laufende Server werden vorher beendet: ihre
 * EXE-Paehne gehoeren zur Konfiguration, die gerade ausgetauscht wird.
 */

const fs = require('fs')
const path = require('path')

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

function liste () {
  try {
    return (store.read().profile || {}).liste || []
  } catch (_) {
    return []
  }
}

function aktiverName () {
  try {
    return (store.read().profile || {}).aktiv || ''
  } catch (_) {
    return ''
  }
}

function schnitt () {
  const cfg = store.read()
  return {
    server: cfg.server || {},
    mysql: cfg.mysql || {},
    soap: cfg.soap || {}
  }
}

function gleicherName (name, ohneIndex) {
  const liste = liste()
  return liste.every(p => p.name !== name) ||
    (typeof ohneIndex === 'number' && liste[ohneIndex] && liste[ohneIndex].name === name)
}

/*
 * Aktuelle Konfiguration als Profil sichern. Existiert der Name schon,
 * wird nur dieser Eintrag aktualisiert.
 */
async function speichern ({ name } = {}) {
  const text = String(name || '').trim()
  if (!text) throw new Error('Bitte einen Profilnamen angeben.')
  const daten = schnitt()
  const listeNeu = liste().filter(p => p.name !== text)
  listeNeu.push({ name: text, daten, gespeichert: new Date().toISOString() })
  store.write({ profile: { liste: listeNeu, aktiv: text } })
  return { ok: true, name: text, anzahl: listeNeu.length }
}

async function loeschen ({ name } = {}) {
  const text = String(name || '').trim()
  const listeNeu = liste().filter(p => p.name !== text)
  const aktiv = aktiverName() === text ? '' : aktiverName()
  store.write({ profile: { liste: listeNeu, aktiv } })
  return { ok: true, anzahl: listeNeu.length }
}

/*
 * Profil aktivieren. Vorher laufende Server beenden (ihre EXE-Paehne
 * gehoeren zum alten Profil), danach den neuen Stand schreiben.
 */
async function aktivieren ({ name } = {}) {
  const text = String(name || '').trim()
  const profil = liste().find(p => p.name === text)
  if (!profil) throw new Error(`Profil nicht gefunden: ${text}`)

  const serverManager = require('../server-manager')
  const status = serverManager.status()
  for (const k of ['world', 'auth', 'db']) {
    if (status[k] && status[k].running) {
      send('server:log', { kind: k, stream: 'system', line: `>>> Profilwechsel: ${k} wird beendet (Konto gehört zum bisherigen Profil)` })
      try { serverManager.stop(k) } catch (_) {}
    }
  }
  await new Promise(r => setTimeout(r, 3000))

  const alt = schnitt()
  const backup = liste().find(p => p.name === aktiverName())
  if (aktiverName() && !backup) {
    // Die bisher laufende Konfiguration bleibt als Profil erhalten.
    const listeNeu = liste()
    listeNeu.push({ name: aktiverName(), daten: alt, gespeichert: new Date().toISOString() })
    store.write({ profile: { liste: listeNeu } })
  }

  const patch = {
    server: profil.daten.server || {},
    mysql: profil.daten.mysql || {},
    soap: profil.daten.soap || {},
    profile: { aktiv: text }
  }
  store.write(patch)
  return { ok: true, name: text }
}

module.exports = { init, liste, aktiverName, speichern, loeschen, aktivieren }
