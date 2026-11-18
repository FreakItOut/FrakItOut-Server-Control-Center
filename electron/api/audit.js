'use strict'

/*
 * Aktionsprotokoll des Panels.
 *
 * Nicht der Serverlog (das macht der Core), sondern: wer hat im Panel was
 * ausgeloest und kam es durch? Konten, Bans, Raten, Module, Sicherungen,
 * Neustarts. Die Eintraege liegen rolling in der Panel-Konfiguration -
 * kein zusaetzlicher Dienst, keine externe Datenbank.
 *
 * Bewusst NICHT protokolliert werden Passwoerter, SOAP-Zugangsdaten oder
 * komplette Konfigurationsinhalte. Nur Bereich, Aktion, Kurzdetail, Ergebnis.
 */

let store = null
const MAX = 500

function init (storeRef) {
  store = storeRef
}

function liste ({ bereich, suche, limit } = {}) {
  let alle = []
  try {
    alle = Array.isArray(store.read().audit) ? store.read().audit : []
  } catch (_) {
    alle = []
  }
  const text = String(suche || '').trim().toLowerCase()
  const gefiltert = alle.filter(e => {
    if (bereich && bereich !== 'alle' && e.bereich !== bereich) return false
    if (!text) return true
    return `${e.aktion || ''} ${e.details || ''}`.toLowerCase().includes(text)
  })
  const grenze = Math.min(MAX, Math.max(1, Number(limit) || MAX))
  return { liste: gefiltert.slice(0, grenze), gesamt: alle.length, gefiltert: gefiltert.length }
}

function protokolliere (bereich, aktion, { details = '', ok = true } = {}) {
  const eintrag = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    zeit: new Date().toISOString(),
    bereich: String(bereich || 'system'),
    aktion: String(aktion || 'unbekannt'),
    details: String(details || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    ok: ok !== false
  }
  try {
    const alt = Array.isArray(store.read().audit) ? store.read().audit : []
    store.write({ audit: [eintrag, ...alt].slice(0, MAX) })
  } catch (_) {
    // Protokollieren darf nie die eigentliche Aktion verhindern.
  }
  return eintrag
}

function leeren () {
  try { store.write({ audit: [] }) } catch (_) {}
  return { ok: true }
}

module.exports = { init, liste, protokolliere, leeren, MAX }
