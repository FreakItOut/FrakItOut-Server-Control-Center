'use strict'

/*
 * Systemverlauf: RAM/CPU der Dienste, Datenbankgröße und freier Plattenplatz.
 * Alle 5 Minuten gemessen, stuendlich verdichtet, 7 Tage aufgehoben.
 * Damit werden Memory-Leaks und Plattenwachstum sichtbar, bevor es knallt.
 */

const MAX_TAGE = 7
const INTERVALL_MS = 5 * 60 * 1000

let store = null
let timer = null
let startTimer = null
const letzteCpu = {}

function init (storeRef) {
  store = storeRef
  if (timer) return
  timer = setInterval(() => { messen().catch(() => {}) }, INTERVALL_MS)
  if (timer.unref) timer.unref()
  startTimer = setTimeout(() => { messen().catch(() => {}) }, 25000)
  if (startTimer.unref) startTimer.unref()
}

function liste () {
  try {
    const l = store.read().systemHistory
    return Array.isArray(l) ? l : []
  } catch (_) {
    return []
  }
}

async function messen () {
  try {
    const jetzt = Date.now()
    const metriken = await require('../server-manager').metriken().catch(() => ({}))
    let cpuPeak = 0
    const ram = { world: 0, auth: 0, db: 0 }
    for (const kind of ['world', 'auth', 'db']) {
      const p = metriken && metriken[kind]
      if (!p) continue
      ram[kind] = Number(p.ramMb) || 0
      const alt = letzteCpu[kind]
      if (alt && Number(p.cpuSek) >= alt.sek) {
        const dt = (jetzt - alt.zeit) / 1000
        if (dt > 0) {
          const prozent = ((Number(p.cpuSek) - alt.sek) / dt) * 100
          cpuPeak = Math.max(cpuPeak, Math.max(0, Math.min(100, Math.round(prozent))))
        }
      }
      letzteCpu[kind] = { sek: Number(p.cpuSek) || 0, zeit: jetzt }
    }

    let dbMb = 0
    try {
      const g = await require('./system').dbGroessen()
      for (const key of ['auth', 'chars', 'world', 'bots']) {
        dbMb += Math.max(0, Number(g.groessen && g.groessen[key]) || 0)
      }
    } catch (_) {}
    let freiGb = null
    try {
      const f = await require('./system').freierPlatz()
      if (f && f.ok) freiGb = Math.round(f.freiGb * 10) / 10
    } catch (_) {}

    const stunde = new Date()
    stunde.setMinutes(0, 0, 0)
    const key = stunde.toISOString()
    const alt = liste()
    const idx = alt.findIndex(e => e && e.stunde === key)
    if (idx >= 0) {
      const e = alt[idx]
      alt[idx] = {
        ...e,
        worldRam: Math.max(Number(e.worldRam) || 0, ram.world),
        authRam: Math.max(Number(e.authRam) || 0, ram.auth),
        dbRam: Math.max(Number(e.dbRam) || 0, ram.db),
        cpuPeak: Math.max(Number(e.cpuPeak) || 0, cpuPeak),
        dbMb,
        freiGb: freiGb == null ? e.freiGb : freiGb,
        messungen: (Number(e.messungen) || 0) + 1
      }
    } else {
      alt.push({
        stunde: key,
        worldRam: ram.world,
        authRam: ram.auth,
        dbRam: ram.db,
        cpuPeak,
        dbMb,
        freiGb,
        messungen: 1
      })
    }
    const grenze = Date.now() - MAX_TAGE * 24 * 60 * 60 * 1000
    const neu = alt
      .filter(e => e && e.stunde && new Date(e.stunde).getTime() >= grenze)
      .sort((a, b) => a.stunde.localeCompare(b.stunde))
    store.write({ systemHistory: neu })
    return { ok: true, stunde: key, ram, cpuPeak, dbMb, freiGb }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function uebersicht () {
  const stunden = liste()
  const jetzt = Date.now()
  const letzte24 = stunden.filter(e => jetzt - new Date(e.stunde).getTime() <= 24 * 60 * 60 * 1000)
  const ramMax = letzte24.reduce((m, e) => Math.max(m, Number(e.worldRam) || 0), 0)
  const cpuMax = letzte24.reduce((m, e) => Math.max(m, Number(e.cpuPeak) || 0), 0)
  const freiWerte = stunden.map(e => Number(e.freiGb)).filter(v => Number.isFinite(v))
  const aktuell = stunden.length ? stunden[stunden.length - 1] : null
  const erst = stunden.length ? stunden[0] : null
  return {
    ok: true,
    stunden,
    aktuell,
    ramMax24: ramMax,
    cpuMax24: cpuMax,
    freiMin: freiWerte.length ? Math.min(...freiWerte) : null,
    dbWachstum: aktuell && erst ? (Number(aktuell.dbMb) || 0) - (Number(erst.dbMb) || 0) : 0,
    messungen: stunden.reduce((n, e) => n + (Number(e.messungen) || 0), 0)
  }
}

module.exports = { init, messen, uebersicht }
