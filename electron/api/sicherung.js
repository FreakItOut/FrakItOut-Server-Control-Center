'use strict'

/*
 * Sicherungen mit Zeitstempel - mehr als eine.
 *
 * Warum
 * -----
 * Bisher hat jeder schreibende Vorgang genau eine Sicherung angelegt:
 * "<datei>.bak". Und zwar immer ueberschrieben. Nach dem zweiten
 * Speichern war der Stand von vor dem ersten weg, nach dem dritten der
 * von vor dem zweiten. Es blieb genau ein Schritt zurueck.
 *
 * Bei der worldserver.conf sind das 4957 Zeilen. Wer drei Raten falsch
 * setzt und dreimal speichert, hat nur noch den Zustand vor dem LETZTEN
 * Speichern - und der kann auch schon falsch sein.
 *
 * Wie
 * ---
 * Gesichert wird in einen Ordner neben der Datei:
 *
 *   worldserver.conf.bak/
 *     2026-10-26_15-44-12.conf
 *     2026-10-26_15-38-01.conf
 *     ...
 *
 * Die alten bleiben erhalten, bis eine Grenze erreicht ist. Welche, sagt
 * die Einstellung "Sicherungen behalten" (Standard 10). Aehnlich wie beim
 * Datenbank-Backup, das diese Logik schon hat.
 *
 * Zusaetzlich bleibt die klassische "<datei>.bak" erhalten. Die wird
 * weiterhin bei jedem Schreiben neu erzeugt - sie ist der schnelle
 * Rueckweg fuer "hab ich eben kaputtgemacht".
 */

const fs = require('fs')
const path = require('path')

const ORDNER_ENDUNG = '.sicherungen'
const STANDARD_ANZAHL = 10

/*
 * Der Zeitstempel im Namen.
 *
 * Aufloesung: Sekunden. Das reicht nicht - drei Speicherungen in
 * derselben Sekunde (was beim Panel durchaus vorkommt, wenn man eine
 * Aenderung ueber mehrere Dateien anstoesst) ergaeben denselben Namen
 * und die spaeteren ueberschrieben die frueheren. Genau das ist
 * passiert, als dieser Test zum ersten Mal lief.
 *
 * Deshalb Millisekunden, und zusaetzlich eine laufende Nummer, falls
 * wirklich zwei Sicherungen im selben Millisekunden-Bereich entstehen.
 */
let laufendeNummer = 0

function zeitstempel (d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0')
  const millis = p(d.getMilliseconds(), 3)
  laufendeNummer = (laufendeNummer + 1) % 1000
  const nummer = p(laufendeNummer, 3)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${millis}${nummer}`
}

/*
 * Der Ordner, in dem die versionierten Sicherungen liegen. Er haengt an
 * der Zieldatei, damit alles fuer eine Datei zusammenliegt:
 *
 *   configs/worldserver.conf           <- die Datei
 *   configs/worldserver.conf.bak       <- die klassische Sicherung (Datei)
 *   configs/worldserver.conf.sicherungen/  <- die versionierten Stufen
 *
 * Wichtig: Der Ordner heisst NICHT ".bak". Sonst hiesse die klassische
 * Sicherung genauso wie der Ordner - und beides kann nicht zugleich
 * Datei und Ordner sein. Der erste Versuch scheiterte genau daran.
 */
function sicherungsOrdner (datei) {
  return datei + ORDNER_ENDUNG
}

/*
 * Legt eine Sicherung an und raeumt alte auf.
 *
 * Rueckgabe: { ok, datei, ordner, alt } - alt ist der Pfad der
 * klassischen .bak, damit der Aufrufer ihn weitergeben kann.
 */
function sichern (datei, behalten = STANDARD_ANZAHL) {
  const alt = datei + '.bak'
  const ordner = sicherungsOrdner(datei)

  if (!fs.existsSync(datei)) {
    return { ok: false, grund: 'Die Datei gibt es nicht - es wurde nichts gesichert.', alt }
  }

  // Die klassische Sicherung: immer, sofort, ueberschrieben.
  try {
    fs.copyFileSync(datei, alt)
  } catch (_) {}

  // Und dazu eine mit Zeitstempel.
  let neu = null
  try {
    fs.mkdirSync(ordner, { recursive: true })
    const endung = path.extname(datei) || '.conf'
    neu = path.join(ordner, `${zeitstempel()}${endung}`)
    fs.copyFileSync(datei, neu)
  } catch (e) {
    // Wenn der Ordner nicht angelegt werden kann, ist die klassische
    // Sicherung immer noch da. Das ist kein Grund fuer einen Abbruch.
    return { ok: true, alt, ordner: null, neu: null, hinweis: 'Der Sicherungsordner konnte nicht angelegt werden: ' + e.message }
  }

  const aufgeraeumt = aufraeumen(ordner, behalten)

  return { ok: true, alt, ordner, neu, aufgeraeumt }
}

/*
 * Behaelt die juengsten "behalten" Dateien und entfernt die aelteren.
 * Gibt die Anzahl der entfernten Dateien zurueck.
 */
function aufraeumen (ordner, behalten = STANDARD_ANZAHL) {
  const anzahl = Math.max(1, Number(behalten) || STANDARD_ANZAHL)
  let eintraege = []
  try {
    eintraege = fs.readdirSync(ordner)
      .filter(n => !n.startsWith('.'))
      .map(n => {
        const p = path.join(ordner, n)
        try { return { p, mtime: fs.statSync(p).mtimeMs } } catch (_) { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
  } catch (_) {
    return 0
  }
  let entfernt = 0
  for (const e of eintraege.slice(anzahl)) {
    try { fs.unlinkSync(e.p); entfernt++ } catch (_) {}
  }
  return entfernt
}

/*
 * Listet die vorhandenen Sicherungen, juengste zuerst. Das Panel zeigt
 * sie an, damit man weiss, welche Stufen es gibt.
 */
function listen (datei) {
  const ordner = sicherungsOrdner(datei)
  let eintraege = []
  try {
    eintraege = fs.readdirSync(ordner)
      .filter(n => !n.startsWith('.'))
      .map(n => {
        const p = path.join(ordner, n)
        try {
          const st = fs.statSync(p)
          return { name: n, pfad: p, mtime: st.mtimeMs, groesse: st.size }
        } catch (_) { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
  } catch (_) {
    return []
  }
  return eintraege
}

/*
 * Holt eine Sicherung zurueck. Wird benutzt, wenn man im Panel eine
 * aeltere Stufe zurueckspielen will.
 */
function zurueckspielen (datei, sicherungsPfad) {
  if (!sicherungsPfad) throw new Error('Keine Sicherungsdatei angegeben.')
  if (!fs.existsSync(sicherungsPfad)) throw new Error('Die Sicherungsdatei gibt es nicht mehr.')
  // Vor dem Rueckspielen den jetzigen Stand sichern - sonst ist der
  // Zustand, den man gerade wiederherstellt, verloren.
  const vorher = sichern(datei)
  fs.copyFileSync(sicherungsPfad, datei)
  return { ok: true, pfad: datei, gesichertAls: vorher.neu, alt: vorher.alt }
}

module.exports = {
  sichern,
  aufraeumen,
  listen,
  zurueckspielen,
  sicherungsOrdner,
  zeitstempel,
  STANDARD_ANZAHL
}