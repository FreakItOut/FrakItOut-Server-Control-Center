'use strict'

/*
 * Diagnose: Ist der Build aktuell, und ist der Server abgestuerzt?
 *
 * Zwei Fragen, die man sich im Panel stellt und die bisher niemand
 * beantworten konnte:
 *
 *   1. Enthaelt die laufende EXE den aktuellen Stand?
 *      Am 24.10. war tsconfig.json auf 0 Bytes geklemmt. Ab da schlug
 *      jeder Build fehl - aber electron-builder nimmt trotzdem das alte
 *      dist/ und packt es ein. Ergebnis: eine startende EXE mit dem
 *      Vortagesstand und Exit-Code 0. Zwei Tage lang unbemerkt.
 *
 *   2. Wann und warum ist der Worldserver zuletzt abgestuerzt?
 *      Der Core legt im Ordner "Crashes" einen .txt-Bericht ab. Der
 *      enthaelt Datum, Exception-Code und die Aufrufkette bis zur
 *      Quellzeile. Das ist genau die Information, die man sonst durch
 *      Wuehlen in Logs findet.
 */

const fs = require('fs')
const path = require('path')

/* ============================================================
 * Teil 1: Build-Zustand
 * ============================================================ */

function alleDateien (ordner, tiefe = 0) {
  const raus = []
  if (tiefe > 6) return raus
  let eintraege = []
  try { eintraege = fs.readdirSync(ordner, { withFileTypes: true }) } catch (_) { return raus }
  for (const e of eintraege) {
    const p = path.join(ordner, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue
      raus.push(...alleDateien(p, tiefe + 1))
    } else {
      try { raus.push({ p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size }) } catch (_) {}
    }
  }
  return raus
}

/*
 * Wo liegt das Projekt? Beim Start aus dem Quelltext ist es das
 * Wurzelverzeichnis; in der ausgelieferten EXE ist es das resources-
 * Verzeichnis. In der EXE gibt es kein src/ - dann ist die Frage nicht
 * sinnvoll und wird als "nicht pruefbar" beantwortet.
 */
function projektWurzel () {
  const kandidaten = [
    path.join(__dirname, '..', '..'),           // electron/api -> Wurzel
    path.join(process.cwd()),
    path.join(__dirname, '..')
  ]
  for (const k of kandidaten) {
    if (fs.existsSync(path.join(k, 'src')) && fs.existsSync(path.join(k, 'electron'))) return k
  }
  return null
}

function buildZustand () {
  const wurzel = projektWurzel()
  if (!wurzel) {
    return {
      pruefbar: false,
      grund: 'Im ausgelieferten Programm gibt es keine Quellen - der Stand ist fest eingepackt.'
    }
  }

  const quellen = [...alleDateien(path.join(wurzel, 'src')), ...alleDateien(path.join(wurzel, 'electron'))]
  const ausgabe = alleDateien(path.join(wurzel, 'renderer'))

  if (!ausgabe.length) {
    return { pruefbar: true, aktuell: false, grund: 'Es wurde noch nie gebaut - renderer/ ist leer.', quellen: quellen.length }
  }

  const juengsteQuelle = quellen.reduce((m, x) => Math.max(m, x.mtime), 0)
  const juengsterBuild = ausgabe.reduce((m, x) => Math.max(m, x.mtime), 0)

  if (juengsteQuelle > juengsterBuild) {
    const datei = quellen.find(x => x.mtime === juengsteQuelle)
    return {
      pruefbar: true,
      aktuell: false,
      grund: 'Der Build ist aelter als die Quellen. Im Programm steckt ein aelterer Stand.',
      alterMinuten: Math.round((juengsteQuelle - juengsterBuild) / 60000),
      quelle: path.relative(wurzel, datei.p),
      quellen: quellen.length
    }
  }

  return {
    pruefbar: true,
    aktuell: true,
    quellen: quellen.length,
    gebaut: new Date(juengsterBuild).toISOString()
  }
}

/* ============================================================
 * Teil 2: Absturzberichte
 * ============================================================ */

// "Exception code: C0000005 ACCESS_VIOLATION"
const RE_EXCEPTION = /Exception code:\s*([0-9A-Fa-f]+)\s*(.*)/
// "Date 16:10:2026. Time 9:15"
const RE_DATUM = /Date\s+(\d{2}):(\d{2}):(\d{4})\.\s*Time\s+(\d{1,2}):(\d{2})/
// "Revision: AzerothCore rev. 47a54dd6..."
const RE_REVISION = /Revision:\s*(.+?)\s*$/
// "Physical Memory: 33473420 KB (Available: 15351872 KB)"
const RE_SPEICHER = /Physical Memory:\s*(\d+) KB \(Available:\s*(\d+) KB\)/
// Zeilen der Aufrufkette: "  <adresse> <frame> <Funktion> <Quelle>"
/*
 * Eine Zeile der Aufrufkette:
 *   "00007FF6AD82AD64  0000008A1E6FF7E0  Unit::IsPetAura+84  F:\WoW\...\Unit.cpp line 13321"
 *
 * Wichtig: die Zeile beginnt OHNE Leerzeichen. Mit "^\\s+" (mindestens
 * ein Leerzeichen) passte kein einziger Frame - und die Diagnose meldete
 * daraufhin "die Aufrufkette konnte nicht gelesen werden", ohne einen
 * Fehler zu zeigen. Das Muster verlangt deshalb "^\\s*" (optional).
 */
const RE_FRAME = /^\s*[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)\s+(.*\.(?:cpp|h)\s+line\s+\d+)/

/*
 * Uebersetzt die Adressen der Aufrufkette in etwas Lesbares.
 *
 * "Unit::IsPetAura+84  F:\WoW\Sources\AC\src\server\game\Entities\Unit\Unit.cpp line 13321"
 * wird zu
 *   { funktion: 'Unit::IsPetAura', datei: 'Entities/Unit/Unit.cpp', zeile: 13321 }
 */
function frameLesen (zeile) {
  const m = RE_FRAME.exec(zeile)
  if (!m) return null
  const funktion = m[1].replace(/\+\w+$/, '')
  const quelle = m[2]
  const dm = /(.+\.(?:cpp|h))\s+line\s+(\d+)/.exec(quelle)
  if (!dm) return { funktion, datei: null, zeile: null }
  let datei = dm[1]
  // Den langen Pfad auf den Teil nach "src\server\" kuerzen.
  const kuerzen = /(?:game|shared|scripts)\\/i.exec(datei)
  if (kuerzen) datei = datei.slice(kuerzen.index)
  return {
    funktion,
    datei: datei.replace(/\\/g, '/'),
    zeile: Number(dm[2])
  }
}

/*
 * Ordnet einen Absturz einer Ursache zu.
 *
 * Die Call-Stack-Zeilen nennen Funktion und Datei. Aus ihnen laesst sich
 * lesen, worum es ging - ohne dass jemand den Core-Quellcode kennen
 * muss. Die Zuordnung ist bewusst zurueckhaltend: sie benennt die
 * Funktion, die abgestuerzt ist, und reicht die wichtigste Quelldatei
 * durch.
 */
function ursacheErkennen (frames) {
  const namen = frames.map(f => f.funktion)
  const dateien = frames.map(f => f.datei || '').join(' ')

  if (/Pet::_SaveAuras|Pet::SavePetToDB/.test(namen.join(' ')) && /Unit::IsPetAura/.test(namen.join(' '))) {
    return {
      kuerzel: 'Haustier beim Reiten',
      text: 'Ein Bot ist auf ein Reittier gestiegen und sein zeitweiliges Haustier wurde gespeichert. Dabei ist ein Nullzeiger aufgetreten.',
      hinweis: 'Tritt bei vielen Bots auf. Das ist ein Fehler zwischen Core und Playerbots, nicht im Panel.'
    }
  }
  if (/Player::SaveToDB/.test(namen.join(' '))) {
    return {
      kuerzel: 'Spieler speichern',
      text: 'Der Absturz passierte beim Speichern eines Charakters.',
      hinweis: null
    }
  }
  if (/MapUpdater|MapMgr/.test(namen.join(' '))) {
    return {
      kuerzel: 'Karten-Update',
      text: 'Der Absturz passierte im Kartentimer.',
      hinweis: null
    }
  }
  if (/Item|item/i.test(dateien)) {
    return {
      kuerzel: 'Gegenstand',
      text: 'Der Absturz passierte beim Verarbeiten eines Gegenstands.',
      hinweis: null
    }
  }
  return {
    kuerzel: frames.length ? frames[0].funktion : 'unbekannt',
    text: frames.length
      ? `Der Absturz passierte in ${frames[0].funktion}.`
      : 'Die Aufrufkette konnte nicht gelesen werden.',
    hinweis: null
  }
}

/*
 * Der Store wird von aussen uebergeben - so wie es bei soap, backup und
 * den anderen Modulen auch ist. Ohne ihn kennt das Modul die Konfiguration
 * nicht und findet den Ordner "Crashes" nicht.
 */
let storeRef = null
function init (store) {
  storeRef = store
}

function crashOrdner () {
  // Der Ordner liegt neben dem worldserver.exe, also neben der
  // Serverwurzel. Die steht in der Konfiguration.
  let wurzel = null
  try {
    if (!storeRef) return null
    const s = storeRef.read()
    const exe = (s.server || {}).worldExe
    if (exe) wurzel = path.dirname(exe)
  } catch (_) {}
  if (!wurzel) return null
  const ordner = path.join(wurzel, 'Crashes')
  try {
    if (fs.existsSync(ordner)) return ordner
  } catch (_) {}
  return null
}

function crashesLesen () {
  const ordner = crashOrdner()
  if (!ordner) return { verfuegbar: false, grund: 'Kein Ordner "Crashes" neben dem Worldserver gefunden.', liste: [] }

  let dateien = []
  try {
    dateien = fs.readdirSync(ordner)
      .filter(n => n.endsWith('.txt'))
      .map(n => {
        const p = path.join(ordner, n)
        try { return { n, p, mtime: fs.statSync(p).mtimeMs } } catch (_) { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
  } catch (_) {
    return { verfuegbar: false, grund: 'Der Ordner "Crashes" kann nicht gelesen werden.', liste: [] }
  }

  const liste = []
  for (const d of dateien.slice(0, 10)) {
    let text = ''
    try { text = fs.readFileSync(d.p, 'utf8') } catch (_) { continue }
    const zeilen = text.split(/\r?\n/)

    const dm = RE_DATUM.exec(text)
    const em = RE_EXCEPTION.exec(text)
    const rm = RE_REVISION.exec(zeilen[0] || '')
    const sm = RE_SPEICHER.exec(text)

    const frames = []
    let imStack = false
    for (const z of zeilen) {
      if (/Call stack:/.test(z)) { imStack = true; continue }
      if (imStack) {
        if (/^\s*$/.test(z)) { if (frames.length) break; else continue }
        const f = frameLesen(z)
        if (f) frames.push(f)
      }
    }

    const datumsTeil = dm
      ? `${dm[2]}.${dm[1]}.${dm[3]} ${dm[4]}:${dm[5]}`
      : new Date(d.mtime).toISOString().slice(0, 16).replace('T', ' ')

    liste.push({
      datei: d.n,
      pfad: d.p,
      zeitpunkt: datumsTeil,
      exception: em ? em[1] : null,
      exceptionText: em ? em[2].trim() : null,
      revision: rm ? rm[1] : null,
      speicherFrei: sm ? Math.round(Number(sm[2]) / 1024) : null,
      frames,
      ursache: ursacheErkennen(frames)
    })
  }

  return { verfuegbar: true, ordner, liste, anzahl: dateien.length }
}

/* ============================================================ */

function diagnose () {
  return {
    build: buildZustand(),
    crashes: crashesLesen()
  }
}

module.exports = { init, diagnose, buildZustand, crashesLesen, crashOrdner }