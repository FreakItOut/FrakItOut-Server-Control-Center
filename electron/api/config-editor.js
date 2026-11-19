'use strict'

const path = require('path')
const fs = require('fs')
const store = require('../store')
const sicherung = require('./sicherung')

/*
 * Wo liegen die Konfigurationsdateien? AzerothCore legt sie direkt neben
 * der jeweiligen Binary ab - worldserver.conf also im worldserver-Ordner.
 * Der Nutzer kann die Ordner in den Einstellungen frei waehlen.
 *
 * Statt eines bekannten Schluessels ("world", "auth", "playerbots") darf
 * auch ein vollstaendiger Pfad uebergeben werden. Dann wird genau diese
 * Datei benutzt - so laesst sich eine playerbots.conf an einem selbst
 * gewaehlten Ort gezielt ansprechen.
 */
function candidates (file) {
  if (typeof file === 'string' && path.isAbsolute(file) && /\.(conf|dist)$/i.test(file)) {
    return [file]
  }

  const s = store.read().server
  const worldDir = s.worldConfDir || path.dirname(s.worldExe || '')
  const authDir = s.authConfDir || path.dirname(s.authExe || '')

  if (file === 'world') {
    return [
      path.join(worldDir, 'worldserver.conf'),
      path.join(worldDir, 'worldserver.conf.dist'),
      // manche Builds legen sie unter configs/ ab
      path.join(path.dirname(worldDir), 'configs', 'worldserver.conf')
    ]
  }
  if (file === 'auth') {
    return [
      path.join(authDir, 'authserver.conf'),
      path.join(authDir, 'authserver.conf.dist'),
      path.join(path.dirname(authDir), 'configs', 'authserver.conf')
    ]
  }
  if (file === 'playerbots') {
    // AzerothCore laedt Modul-Konfigurationen aus <configs>/modules/. Dort
    // liegt die playerbots.conf bei manchen Repacks, nicht neben der
    // worldserver.conf - ohne diesen Zweig wird sie nie gefunden.
    const basis = [
      worldDir,
      path.dirname(worldDir),
      path.join(path.dirname(worldDir), 'configs')
    ]
    const kandidaten = []
    for (const b of basis) {
      kandidaten.push(
        path.join(b, 'playerbots.conf'),
        path.join(b, 'playerbots.conf.dist'),
        path.join(b, 'modules', 'playerbots.conf'),
        path.join(b, 'modules', 'playerbots.conf.dist')
      )
    }
    return kandidaten
  }
  return []
}

// Erste existierende Datei oder null
function resolveTarget (file) {
  return candidates(file).find(p => p && fs.existsSync(p)) || null
}

function available () {
  return ['world', 'auth', 'playerbots'].map(key => {
    const found = resolveTarget(key)
    return { key, path: found, exists: !!found }
  })
}

// Aktuelle Werte aus einer .conf auslesen: KEY = VALUE
function parseConf (text) {
  const out = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      out.push({ type: 'comment', raw: rawLine })
      continue
    }
    const idx = line.indexOf('=')
    if (idx === -1) {
      out.push({ type: 'raw', raw: rawLine })
      continue
    }
    out.push({
      type: 'setting',
      key: line.slice(0, idx).trim(),
      value: line.slice(idx + 1).trim(),
      raw: rawLine
    })
  }
  return out
}

function targetFile (file) {
  const p = resolveTarget(file)
  if (!p) {
    throw new Error(
      `Keine Konfigurationsdatei für "${file}" gefunden. Pfad in den Einstellungen prüfen (Einstellungen → Server-Pfade).`
    )
  }
  return p
}

function readConfig (file) {
  const p = targetFile(file)
  const text = fs.readFileSync(p, 'utf8')
  return { path: p, lines: parseConf(text) }
}

/*
 * Werte gezielt setzen, ohne die ganze Datei durch den Renderer zu schleifen.
 * Vorhandene Schluessel werden ersetzt, neue werden am Ende angehaengt.
 */
function writeSettings ({ file, entries }) {
  const p = targetFile(file)
  const text = fs.readFileSync(p, 'utf8')
  const lines = parseConf(text)

  const wanted = new Map()
  for (const e of entries || []) {
    if (e && e.key) wanted.set(e.key.trim(), String(e.value ?? '').trim())
  }

  const seen = new Set()
  const out = []
  for (const l of lines) {
    if (l.type === 'setting' && wanted.has(l.key)) {
      out.push(`${l.key} = ${wanted.get(l.key)}`)
      seen.add(l.key)
    } else {
      out.push(l.raw)
    }
  }

  const missing = [...wanted.keys()].filter(k => !seen.has(k))
  if (missing.length) {
    while (out.length && out[out.length - 1].trim() === '') out.pop()
    out.push('')
    out.push('# --- vom FreakItOut Server Control Center hinzugefuegt ---')
    for (const k of missing) out.push(`${k} = ${wanted.get(k)}`)
  }

  /*
   * Sichern. Es gibt jetzt mehr als eine Stufe: die klassische ".bak"
   * (immer, sofort) und eine mit Zeitstempel im Ordner neben der Datei.
   * Bisher wurde nur die ".bak" geschrieben und dabei immer ueberschrieben
   * - nach dem zweiten Speichern war der Stand von vor dem ersten weg.
   */
  const gesichert = sicherung.sichern(p)

  fs.writeFileSync(p, out.join('\n'), 'utf8')
  // Konfig geändert -> der laufende Worldserver nutzt noch die alten Werte
  try { require('../store').write({ restartNoetig: true }) } catch (_) {}
  return {
    ok: true,
    path: p,
    backup: gesichert.alt,
    sicherungen: gesichert.neu ? [gesichert.neu] : [],
    added: missing,
    updated: [...seen]
  }
}

function saveConfig ({ file, lines }) {
  const p = targetFile(file)
  const gesichert = sicherung.sichern(p)

  const text = lines
    .map(l => {
      if (l.type === 'setting') return `${l.key} = ${l.value}`
      return l.raw
    })
    .join('\n')

  fs.writeFileSync(p, text, 'utf8')
  return {
    ok: true,
    path: p,
    backup: gesichert.alt,
    sicherungen: gesichert.neu ? [gesichert.neu] : []
  }
}

/*
 * Die Sicherungen einer Datei auflisten. Das Panel zeigt sie an, damit
 * sichtbar ist, welche Stufen es gibt - und man eine aeltere zurueckspielen
 * kann.
 */
function sicherungenListen ({ file }) {
  const p = targetFile(file)
  return {
    pfad: p,
    ordner: sicherung.sicherungsOrdner(p),
    alt: fs.existsSync(p + '.bak') ? p + '.bak' : null,
    liste: sicherung.listen(p)
  }
}

/*
 * Eine aeltere Stufe zurueckspielen. Der jetzige Stand wird vorher
 * gesichert - sonst waere der Zustand, den man gerade wiederherstellt,
 * verloren.
 */
function sicherungZurueckspielen ({ file, pfad }) {
  const p = targetFile(file)
  return sicherung.zurueckspielen(p, pfad)
}

function searchConfig ({ file, term, settingOnly = true }) {
  const data = readConfig(file)
  const t = (term || '').toLowerCase()
  const out = []
  data.lines.forEach((l, i) => {
    if (!t) {
      out.push({ index: i, ...l })
      return
    }
    if (l.type === 'setting') {
      if (l.key.toLowerCase().includes(t) || String(l.value).toLowerCase().includes(t)) {
        out.push({ index: i, ...l })
      }
    } else if (!settingOnly && l.raw.toLowerCase().includes(t)) {
      out.push({ index: i, ...l })
    }
  })
  return { path: data.path, lines: out }
}

module.exports = {
  available,
  resolveTarget,
  readConfig,
  saveConfig,
  searchConfig,
  writeSettings,
  sicherungenListen,
  sicherungZurueckspielen,
  parseConf
}