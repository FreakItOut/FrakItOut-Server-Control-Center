// Spielbegriffe und Formatierungen.
//
// Die Namen und Beschreibungen sind ueber Schluessel im Sprachpaket
// uebersetzbar. Damit die Aufrufstellen ihre bestehende Signatur behalten
// (className(id) statt className(id, t)), haelt dieses Modul die aktuelle
// Sprache selbst - gesetzt wird sie einmal aus dem I18nProvider.

let sprache = 'de'

export function setLocale (lang) {
  sprache = lang === 'en' ? 'en' : 'de'
}

export function getLocale () {
  return sprache
}

const LOCALE_TAG = () => (sprache === 'en' ? 'en-US' : 'de-DE')

// Uebersetzen, wenn eine t-Funktion da ist, sonst den deutschen Wert
function txt (t, schluessel, deutsch) {
  if (typeof t !== 'function') return deutsch
  const wert = t(schluessel)
  // Ohne Uebersetzung liefert t() den Schluessel zurueck
  return wert && wert !== schluessel ? wert : deutsch
}

// ---------- Klassen ----------
export const CLASSES = {
  1: 'Krieger',
  2: 'Paladin',
  3: 'Jäger',
  4: 'Schurke',
  5: 'Priester',
  6: 'Todesritter',
  7: 'Schamane',
  8: 'Magier',
  9: 'Hexer',
  10: 'Mönch',
  11: 'Druide',
  12: 'Dämonenjäger'
}

export const CLASSES_EN = {
  1: 'Warrior',
  2: 'Paladin',
  3: 'Hunter',
  4: 'Rogue',
  5: 'Priest',
  6: 'Death Knight',
  7: 'Shaman',
  8: 'Mage',
  9: 'Warlock',
  10: 'Monk',
  11: 'Druid',
  12: 'Demon Hunter'
}

// ---------- Rassen ----------
export const RACES = {
  1: 'Mensch',
  2: 'Ork',
  3: 'Zwerg',
  4: 'Nachtelf',
  5: 'Untoter',
  6: 'Tauren',
  7: 'Gnom',
  8: 'Troll',
  9: 'Goblin',
  10: 'Blutelf',
  11: 'Draenei',
  12: 'Draenei (QC)',
  26: 'Mensch (CD)'
}

export const RACES_EN = {
  1: 'Human',
  2: 'Orc',
  3: 'Dwarf',
  4: 'Night Elf',
  5: 'Undead',
  6: 'Tauren',
  7: 'Gnome',
  8: 'Troll',
  9: 'Goblin',
  10: 'Blood Elf',
  11: 'Draenei',
  12: 'Draenei (QC)',
  26: 'Human (CD)'
}

// ---------- Geschlechter ----------
export const GENDER = { 0: 'Männlich', 1: 'Weiblich', 2: 'Unbekannt' }
export const GENDER_EN = { 0: 'Male', 1: 'Female', 2: 'Unknown' }

// ---------- Kontinente / Zonen ----------
export const MAPS = {
  0: 'Eastern Kingdoms',
  1: 'Kalimdor',
  530: 'The Outland',
  571: 'Norsca',
  249: 'Uldum',
  855: "Scholazar's Oasis"
}

export const MAPS_EN = {
  0: 'Eastern Kingdoms',
  1: 'Kalimdor',
  530: 'The Outland',
  571: 'Norsca',
  572: 'Outland (Instances)',
  249: 'Uldum',
  855: "Scholazar's Oasis"
}

// ---------- Qualitaet ----------
export const QUALITY = ['Schlecht', 'Gewöhnlich', 'Ungewöhnlich', 'Selten', 'Episch', 'Legendär', 'Artefakt']
export const QUALITY_EN = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact']

// ---------- GM-Stufen ----------
export const GM_LEVELS = {
  0: 'Kein GM',
  1: 'Moderator',
  2: 'Spielleiter',
  3: 'Administrator'
}

export const GM_LEVELS_EN = {
  0: 'No GM',
  1: 'Moderator',
  2: 'Game Master',
  3: 'Administrator'
}

const pick = (table, id, fallback, t, prefix) => {
  const base = table[id]
  if (base === undefined) return fallback
  return txt(t, `${prefix}.${id}`, base)
}

export const className = (id, t) => pick(sprache === 'en' ? CLASSES_EN : CLASSES, id, `Klasse ${id}`, t, 'constants.class')
export const raceName = (id, t) => pick(sprache === 'en' ? RACES_EN : RACES, id, `Rasse ${id}`, t, 'constants.race')
export const genderName = (id, t) => pick(sprache === 'en' ? GENDER_EN : GENDER, id, txt(t, 'constants.unknown', 'Unbekannt'), t, 'constants.gender')
export const mapName = (id, t) => pick(sprache === 'en' ? MAPS_EN : MAPS, id, `Map ${id}`, t, 'constants.map')
export const qualityName = (id, t) => pick(sprache === 'en' ? QUALITY_EN : QUALITY, id, `Qualität ${id}`, t, 'constants.quality')

export const gmLevelName = (id, t) => pick(sprache === 'en' ? GM_LEVELS_EN : GM_LEVELS, id, `GM ${id}`, t, 'constants.gm')

export const qualityColor = (q) =>
  ({ 0: '#9d9d9d', 1: '#ffffff', 2: '#1eff00', 3: '#0070dd', 4: '#a335ee', 5: '#ff8000', 6: '#e6cc80' }[q] || '#cccccc')

/*
 * Zahl in der aktuellen Sprache ausgeben. Ohne diese Helper blieb in
 * englischen Ansichten "10.000" stehen, weil ueberall fest auf de-DE
 * formatiert wurde - auf Englisch gehoert da "10,000" hin.
 */
export function formatNumber (n) {
  const v = Number(n)
  return Number.isFinite(v) ? v.toLocaleString(LOCALE_TAG()) : '0'
}

/*
 * Dateigroesse in der aktuellen Sprache.
 *
 * toLocaleString() ohne Locale richtet sich nach der System-Sprache, nicht
 * nach der Panelsprache - im deutschen System mit englischer Oberflaeche
 * stuende dann "314,5 MB" statt "314.5 MB".
 */
export function formatBytes (bytes) {
  const v = Number(bytes)
  if (!Number.isFinite(v) || v < 0) return '—'
  if (v < 1024) return `${Math.round(v)} B`
  const mb = v / (1024 * 1024)
  if (mb < 1024) return `${mb.toLocaleString(LOCALE_TAG(), { maximumFractionDigits: 1 })} MB`
  return `${(mb / 1024).toLocaleString(LOCALE_TAG(), { maximumFractionDigits: 2 })} GB`
}

export function formatMoney (copper) {
  const v = Math.max(0, Math.floor(copper || 0))
  const gold = Math.floor(v / 10000)
  const silver = Math.floor((v % 10000) / 100)
  const c = v % 100
  const parts = []
  if (gold) parts.push(`${gold.toLocaleString(LOCALE_TAG())}g`)
  if (silver || gold) parts.push(`${silver}s`)
  parts.push(`${c}c`)
  return parts.join(' ')
}

export function formatPlaytime (seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function formatDate (iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(LOCALE_TAG(), { dateStyle: 'short', timeStyle: 'short' })
}

export function formatDateTime (unixSeconds) {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1000)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(LOCALE_TAG(), { dateStyle: 'short', timeStyle: 'short' })
}