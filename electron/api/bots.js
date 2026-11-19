'use strict'

const fs = require('fs')
const path = require('path')
const store = require('../store')
const configEditor = require('./config-editor')

/*
 * Bot-Konfiguration fuer AzerothCore.
 *
 * Es gibt zwei verbreitete Bot-Module, die unterschiedliche Schluessel
 * verwenden:
 *
 *  - NpcBots-Modul   : NpcBot.*       (z. B. NpcBot.WanderingBots.Continents.Count)
 *  - PlayerBots-Modul: AiPlayerbot.*  (z. B. AiPlayerbot.RandomBotsTotalCount)
 *
 * Deshalb werden die tatsaechlich vorhandenen Schluessel beider Praefixe
 * gelesen und dem Nutzer zur Bearbeitung angezeigt - statt Namen zu raten,
 * die je nach Modul und Version verschieden sind.
 *
 * Quelle ist bevorzugt die playerbots.conf im Worldserver-Ordner. Findet
 * sich dort nichts, wird auf die Bot-Eintraege in der worldserver.conf
 * zurueckgefallen (das NpcBot-Modul wird dort oft direkt eingebunden).
 */

// Beide Praefixe zulassen
const BOT_KEY_RE = /^(NpcBot\.|AiPlayerbot\.)/i

/*
 * Der Schluessel fuer die Gesamtanzahl haengt vom Modul ab, und nicht
 * jedes Modul kennt dieselben Namen:
 *
 *  - NpcBots-Modul    : NpcBot.WanderingBots.Continents.Count
 *  - mod-playerbots   : AiPlayerbot.MinRandomBots und AiPlayerbot.MaxRandomBots
 *
 * Wichtig: mod-playerbots kennt "AiPlayerbot.RandomBotsTotalCount" gar nicht.
 * Wer nur darauf prueft, findet dort nichts und zeigt eine leere Anzeige.
 *
 * Mehrere Schluessel in einer Gruppe gehoeren zusammen und werden
 * gemeinsam gesetzt - nur "MinRandomBots" zu aendern wuerde die Obergrenze
 * auf dem alten Wert stehen lassen.
 */
const COUNT_GROUPS = [
  ['NpcBot.WanderingBots.Continents.Count'],
  ['AiPlayerbot.RandomBotsTotalCount'],
  ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'],
  ['AiPlayerbot.RandomBots'],
  ['AiPlayerbot.RandomBotCount'],
  ['NpcBot.MaxBots']
]

// Schluessel, die die Bots ein- und ausschalten. "Enabled" statt "Enable"
// ist die Schreibweise von mod-playerbots.
const ENABLE_KEYS = [
  'AiPlayerbot.Enable',
  'AiPlayerbot.Enabled',
  'NpcBot.Enable',
  'NpcBot.Enable.All'
]

// Primaerer Schluessel fuer die Gesamtanzahl, in dieser Reihenfolge
const COUNT_KEYS = COUNT_GROUPS[0]

// Nur Vorschlaege fuer den Fall, dass die Datei keine Bot-Eintraege hat.
const SUGGESTIONS = [
  'NpcBot.WanderingBots.Continents.Count',
  'NpcBot.WanderingBots.Continents.Enable',
  'AiPlayerbot.Enable',
  'AiPlayerbot.Enabled',
  'AiPlayerbot.MinRandomBots',
  'AiPlayerbot.MaxRandomBots',
  'AiPlayerbot.RandomBotsTotalCount'
]

// Obergrenze laut NpcBot-Konfiguration
const MAX_BOTS = 10000

const TEMPLATE = `# Bot-Konfiguration
# Vom FreakItOut Server Control Center erzeugt.
# Aenderungen an der Bot-Anzahl greifen erst nach einem Neustart des
# Worldservers.
#
# NpcBots-Modul   -> Schluessel mit Praefix "NpcBot."
# mod-playerbots  -> Schluessel mit Praefix "AiPlayerbot."
# Es koennen beide Module installiert sein; welche greifen, haengt von
# deiner AzerothCore-Installation ab.
#
# Wichtig: MinRandomBots und MaxRandomBots gehoeren zusammen und werden vom
# Panel gemeinsam gesetzt. Nur einen davon umzustellen laesst die zweite
# Grenze auf ihrem alten Wert stehen.

# --- NpcBots-Modul ---
# Anzahl der wandernden Bots auf den Kontinenten (0 - 10000)
NpcBot.Enable = 1
NpcBot.WanderingBots.Continents.Count = 200
NpcBot.WanderingBots.Continents.Enable = 1

# --- mod-playerbots ---
AiPlayerbot.Enabled = 1
AiPlayerbot.MinRandomBots = 200
AiPlayerbot.MaxRandomBots = 200
AiPlayerbot.RandomBotAutologin = 1
`

function worldDir () {
  const s = store.read().server
  return s.worldConfDir || path.dirname(s.worldExe || '')
}

function resolveBotFile () {
  // Vom Nutzer frei gewaehlte Datei hat Vorrang - dann wird genau die
  // bearbeitet, die auch im Panel angezeigt wird.
  const s = store.read().server
  const gewaehlt = s.botFile
  if (gewaehlt) {
    if (fs.existsSync(gewaehlt)) {
      return { file: gewaehlt, path: gewaehlt, primary: false, source: 'user' }
    }
    // Angegebene Datei fehlt: melden, statt still auf eine andere auszuweichen
    return {
      file: null,
      path: gewaehlt,
      missingFile: gewaehlt,
      entries: [],
      found: false,
      missing: SUGGESTIONS,
      available: configEditor.available(),
      message: `Die eingestellte Bot-Datei wurde nicht gefunden: ${gewaehlt}`
    }
  }

  const pb = configEditor.resolveTarget('playerbots')
  if (pb) return { file: 'playerbots', path: pb, primary: true, source: 'auto' }

  const world = configEditor.resolveTarget('world')
  if (world) return { file: 'world', path: world, primary: false, source: 'auto' }

  return null
}

function readBotEntries () {
  const available = configEditor.available()
  const target = resolveBotFile()

  if (!target) {
    return {
      file: null,
      path: null,
      entries: [],
      found: false,
      missing: SUGGESTIONS,
      available,
      message:
        'Keine Worldserver-Konfiguration gefunden. Bitte unter „Einstellungen → Server-Pfade" den Worldserver-Ordner angeben.'
    }
  }

  if (target.missingFile) {
    return {
      file: null,
      path: target.missingFile,
      missingFile: target.missingFile,
      entries: [],
      found: false,
      missing: SUGGESTIONS,
      available,
      message: `Die eingestellte Bot-Datei wurde nicht gefunden: ${target.missingFile}`
    }
  }

  let lines = []
  try {
    lines = configEditor.parseConf(fs.readFileSync(target.path, 'utf8'))
  } catch (e) {
    return {
      file: target.file,
      path: target.path,
      source: target.source,
      primary: target.primary,
      entries: [],
      found: false,
      missing: SUGGESTIONS,
      available,
      message: `Datei nicht lesbar: ${e.message}`
    }
  }

  const entries = []
  const seen = new Set()
  for (const l of lines) {
    if (l.type !== 'setting') continue
    if (!BOT_KEY_RE.test(l.key)) continue
    entries.push({ key: l.key, value: l.value })
    seen.add(l.key)
  }

  return {
    file: target.file,
    path: target.path,
    source: target.source,
    primary: target.primary,
    entries,
    found: entries.length > 0,
    missing: SUGGESTIONS.filter(k => !seen.has(k)),
    available
  }
}

async function get () {
  const daten = readBotEntries()
  // Ausgewaehlte Datei mitschicken, damit die Oberflaeche sie anzeigen kann
  daten.ausgewaehlt = store.read().server.botFile || ''
  return daten
}

// Bot-Datei fest verlinken oder die Auswahl loeschen
async function setFile ({ path: pfad }) {
  if (!pfad) {
    store.write({ server: { botFile: '' } })
    return { ok: true, path: '' }
  }
  if (typeof pfad !== 'string' || !fs.existsSync(pfad) || !fs.statSync(pfad).isFile()) {
    throw new Error(`Datei nicht gefunden: ${pfad}`)
  }
  store.write({ server: { botFile: pfad } })
  return { ok: true, path: pfad }
}

async function save ({ file, entries }) {
  const target = resolveBotFile()
  const useFile = file || (target && target.file)
  if (!useFile) throw new Error('Keine Konfigurationsdatei gefunden.')

  // Nur echte Bot-Schluessel zulassen, damit nichts versehentlich
  // andere Eintraege der worldserver.conf ueberschreibt.
  const clean = (entries || []).filter(e => e && e.key && BOT_KEY_RE.test(e.key.trim()))
  if (!clean.length) throw new Error('Keine gültigen Bot-Einstellungen übergeben.')

  return configEditor.writeSettings({ file: useFile, entries: clean })
}

// playerbots.conf anlegen, falls sie fehlt
async function createFile () {
  const dir = worldDir()
  if (!dir) throw new Error('Kein Worldserver-Ordner konfiguriert.')
  if (!fs.existsSync(dir)) throw new Error(`Ordner existiert nicht: ${dir}`)

  const p = path.join(dir, 'playerbots.conf')
  if (fs.existsSync(p)) return { ok: true, path: p, created: false }

  fs.writeFileSync(p, TEMPLATE, 'utf8')
  // Bot-Konfig geändert -> Neustart ausstehend
  try { require('../store').write({ restartNoetig: true }) } catch (_) {}
  return { ok: true, path: p, created: true }
}

module.exports = {
  get,
  save,
  setFile,
  createFile,
  // Nur was die Tests brauchen. SUGGESTIONS und COUNT_KEYS sind bewusst
  // nicht dabei: sie werden nur intern benutzt und exportiert niemandem Nu.
  COUNT_GROUPS,
  ENABLE_KEYS,
  MAX_BOTS,
  TEMPLATE
}