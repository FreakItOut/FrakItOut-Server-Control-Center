'use strict'

/*
 * Online-Verlauf: alle 5 Minuten zaehlen, wie viele echte Spieler und wie
 * viele Bots eingeloggt sind. Die Messungen werden stuendlich verdichtet
 * (Peak + Summe + Anzahl), damit die Panel-Konfiguration klein bleibt:
 * 30 Tage = 720 Stundenwerte.
 */

const MAX_TAGE = 30
const INTERVALL_MS = 5 * 60 * 1000

let store = null
let timer = null
let startTimer = null

function init (storeRef) {
  store = storeRef
  if (timer) return
  timer = setInterval(() => { messen().catch(() => {}) }, INTERVALL_MS)
  if (timer.unref) timer.unref()
  // Beim Start kurz warten: Datenbank und Server sind dann meist erreichbar.
  startTimer = setTimeout(() => { messen().catch(() => {}) }, 20000)
  if (startTimer.unref) startTimer.unref()
}

function liste () {
  try {
    const l = store.read().onlineStats
    return Array.isArray(l) ? l : []
  } catch (_) {
    return []
  }
}

function tagKey (d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function messen () {
  try {
    const antwort = await require('./online').listOnline({ includeBots: true })
    const rows = (antwort && antwort.rows) || []
    const istBot = require('./spieler').istBotName
    const bots = rows.filter(r => istBot(r.username || r.name || '')).length
    const spieler = Math.max(0, rows.length - bots)
    const stunde = new Date()
    stunde.setMinutes(0, 0, 0)
    const key = stunde.toISOString()
    const alt = liste()
    const idx = alt.findIndex(e => e && e.stunde === key)
    if (idx >= 0) {
      const e = alt[idx]
      alt[idx] = {
        ...e,
        peak: Math.max(Number(e.peak) || 0, spieler),
        summe: (Number(e.summe) || 0) + spieler,
        messungen: (Number(e.messungen) || 0) + 1,
        botPeak: Math.max(Number(e.botPeak) || 0, bots)
      }
    } else {
      alt.push({ stunde: key, peak: spieler, summe: spieler, messungen: 1, botPeak: bots })
    }
    const grenze = Date.now() - MAX_TAGE * 24 * 60 * 60 * 1000
    const neu = alt
      .filter(e => e && e.stunde && new Date(e.stunde).getTime() >= grenze)
      .sort((a, b) => a.stunde.localeCompare(b.stunde))
    store.write({ onlineStats: neu })
    return { ok: true, spieler, bots, stunde: key }
  } catch (e) {
    // Datenbank aus oder Worldserver weg: naechste Messung versucht es erneut.
    return { ok: false, error: e.message }
  }
}

function uebersicht () {
  const stunden = liste()
  const karte = new Map()
  for (const e of stunden) {
    const d = new Date(e.stunde)
    if (!Number.isFinite(d.getTime())) continue
    const key = tagKey(d)
    const g = karte.get(key) || { datum: key, peak: 0, summe: 0, messungen: 0, botPeak: 0 }
    g.peak = Math.max(g.peak, Number(e.peak) || 0)
    g.summe += Number(e.summe) || 0
    g.messungen += Number(e.messungen) || 0
    g.botPeak = Math.max(g.botPeak, Number(e.botPeak) || 0)
    karte.set(key, g)
  }
  const tage = [...karte.values()]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map(g => ({
      ...g,
      durchschnitt: g.messungen ? Math.round((g.summe / g.messungen) * 10) / 10 : 0
    }))
    .slice(-7)

  const heute = tage.find(g => g.datum === tagKey(new Date())) || null
  let rekord = null
  for (const e of stunden) {
    const peak = Number(e.peak) || 0
    if (!rekord || peak > rekord.peak) rekord = { peak, stunde: e.stunde, bots: Number(e.botPeak) || 0 }
  }
  const letzte = stunden.length ? stunden[stunden.length - 1] : null
  return {
    ok: true,
    tage,
    heute,
    rekord,
    letzte,
    messungen: stunden.reduce((n, e) => n + (Number(e.messungen) || 0), 0),
    stunden: stunden.length
  }
}

module.exports = { init, messen, uebersicht }
