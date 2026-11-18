'use strict'

/*
 * Log-Archiv: Server.log und Auth.log durchsuchen, ohne den Rechner zu
 * verlassen. Gelesen wird nur der letzte Teil der Datei (max. 20 MB) -
 * ein tagelang gewachsener Log soll das Panel nicht blockieren.
 *
 * Erlaubt sind ausschliesslich die Dateien, die der Server-Manager selbst
 * kennt (aktuelle Logdatei + .old). Ein Pfad aus der Oberflaeche wird
 * gegen diese Liste geprueft.
 */

const fs = require('fs')
const path = require('path')

const MAX_BYTES = 20 * 1024 * 1024
const MAX_TREFFER = 200

function decode (buf) {
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  return buf.toString('latin1')
}

function dateien () {
  const liste = require('../server-manager').logDateien()
  return { dateien: liste }
}

function erlaubteDatei (pfad) {
  const ziel = String(pfad || '')
  const treffer = dateien().dateien.find(d => path.normalize(d.pfad) === path.normalize(ziel))
  if (!treffer) throw new Error('Diese Logdatei ist nicht freigegeben.')
  return treffer
}

function zeilenLesen (pfad) {
  const info = erlaubteDatei(pfad)
  const groesse = fs.statSync(info.pfad).size
  const start = Math.max(0, groesse - MAX_BYTES)
  const fd = fs.openSync(info.pfad, 'r')
  let buf
  try {
    buf = Buffer.alloc(groesse - start)
    fs.readSync(fd, buf, 0, buf.length, start)
  } finally {
    try { fs.closeSync(fd) } catch (_) {}
  }
  const zeilen = decode(buf).split(/\r?\n/)
  // Beim Abschneiden ist die erste Zeile meist unvollstaendig.
  if (start > 0 && zeilen.length) zeilen.shift()
  return { zeilen, groesse, info }
}

function passtStufe (zeile, stufe) {
  if (stufe === 'fehler') return /\b(error|fatal|failed|exception|crash)\b/i.test(zeile)
  if (stufe === 'warnung') return /\b(warn|warning|deprecated)\b/i.test(zeile)
  return true
}

async function suche ({ pfad, text = '', stufe = 'alle', kontext = 2, max = MAX_TREFFER } = {}) {
  const { zeilen, groesse, info } = zeilenLesen(pfad)
  const q = String(text || '').trim().toLowerCase()
  const art = ['alle', 'fehler', 'warnung'].includes(stufe) ? stufe : 'alle'
  const umfeld = Math.min(8, Math.max(0, Number(kontext) || 0))
  const grenze = Math.min(MAX_TREFFER, Math.max(1, Number(max) || MAX_TREFFER))

  const trefferIndizes = []
  for (let i = 0; i < zeilen.length; i++) {
    if (!passtStufe(zeilen[i], art)) continue
    if (q && !zeilen[i].toLowerCase().includes(q)) continue
    trefferIndizes.push(i)
  }

  /*
   * Ohne Suchtext und ohne Stufenfilter sind "alle Zeilen" wenig hilfreich -
   * dann zeigt das Archiv die letzten Zeilen, so wie man es erwartet.
   */
  const auswahl = !q && art === 'alle'
    ? trefferIndizes.slice(-grenze)
    : trefferIndizes.slice(0, grenze)

  const treffer = auswahl.map(i => ({
    zeile: i + 1,
    text: zeilen[i],
    vor: zeilen.slice(Math.max(0, i - umfeld), i),
    nach: zeilen.slice(i + 1, Math.min(zeilen.length, i + 1 + umfeld))
  }))

  return {
    ok: true,
    datei: info.name,
    pfad: info.pfad,
    groesse,
    gelesenAb: groesse > MAX_BYTES ? 'letzte 20 MB' : 'ganze Datei',
    zeilen: zeilen.length,
    treffer,
    trefferGesamt: trefferIndizes.length,
    gekuerzt: trefferIndizes.length > auswahl.length
  }
}

module.exports = { dateien, suche, __intern: { decode, passtStufe } }
