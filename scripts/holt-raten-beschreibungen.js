'use strict'

/*
 * Liest ALLE Beschreibungen aus der worldserver.conf.
 *
 * Aufruf: node scripts/holt-raten-beschreibungen.js [pfad] [--json]
 *
 * AzerothCore dokumentiert die Schluessel in Bloecken. Drei Formen kommen
 * vor und alle drei muessen gelesen werden:
 *
 *  1. Familie ueber eine Liste im Default-Block
 *
 *         #    Rate.SellValue.Item.Heirloom
 *         #        Description: Item Sale Value rates based on quality.
 *         #        Default:     1 - (Rate.SellValue.Item.Poor)
 *         #                     1 - (Rate.SellValue.Item.Normal)
 *
 *  2. Wildcard - ein Kopf gilt fuer alle Schluessel mit dem Praefix
 *
 *         #    Rate.XP.BattlegroundKill...
 *         #        Description: Experience rate for honorable kills ...
 *
 *  3. Description ueber mehrere Zeilen, danach ein Default-Block OHNE
 *     Klammern, der die Schluessel "Name = Wert" nennt
 *
 *         #    Rate.MissChanceMultiplier...
 *         #        Description: ... zwei Zeilen ...
 *         #        Default:     Rate.MissChanceMultiplier.TargetCreature = 11
 *         #                     Rate.MissChanceMultiplier.TargetPlayer = 7
 */

const fs = require('fs')
const path = require('path')

const argumente = process.argv.slice(2)
const alsJson = argumente.includes('--json')
const KONFIG = argumente.find(a => !a.startsWith('--')) || path.join(
  'C:\\Azerothcore WoTLK Repack (Playerbots + Individual Progression)',
  'configs', 'worldserver.conf'
)

if (!fs.existsSync(KONFIG)) {
  console.error('Nicht gefunden: ' + KONFIG)
  process.exit(1)
}

const roh = fs.readFileSync(KONFIG, 'utf8').split(/\r?\n/)
// Kommentarzeilen ohne "#" und ohne Inhalt sind fuer die Blockgrenzen egal
const zeilen = roh.map(l => l.trim())

const istBeschreibung = z => /^#\s+Description:\s*(.+)$/.test(z)
const istDefault = z => /^#\s+Default:/.test(z)
const istKopf = z => /^#\s{2,}([A-Z][A-Za-z0-9_.]*\.{0,3})\s*$/.exec(z)
const istKommentar = z => z.startsWith('#')
const istLeer = z => z === ''

// Alles, was wirklich gesetzt ist
const gesetztRE = /^([A-Z][A-Za-z0-9_.]*)\s*=/ 
const gesetzt = []
for (const z of zeilen) {
  const m = gesetztRE.exec(z)
  if (m && /^Rates?\./i.test(m[1])) gesetzt.push(m[1])
}

const treffer = new Map()
const setzen = (k, v) => { if (!treffer.has(k) && v) treffer.set(k, v.trim()) }

for (let i = 0; i < zeilen.length; i++) {
  const b = istBeschreibung(zeilen[i])
  if (!b) continue
  const erster = /^#\s+Description:\s*(.+)$/.exec(zeilen[i])[1]

  // Text: erste Zeile plus alle Folgezeilen bis "Default:"
  let text = erster
  let j = i + 1
  while (j < zeilen.length && istKommentar(zeilen[j]) && !istDefault(zeilen[j]) && !istBeschreibung(zeilen[j])) {
    if (!istLeer(zeilen[j])) {
      const ohne = zeilen[j].replace(/^#\s+/, '').replace(/^(Note|Example|Default):/i, '').trim()
      if (ohne) text += ' ' + ohne
    }
    j++
  }
  // Mehr als eine sinnvolle Zeile? Sonst ist es vermutlich eine Tabelle.
  text = text.replace(/\s+/g, ' ').trim()

  // Der Kopf, falls vorhanden (Wildcard moeglich). Mehrere Schluessel
  // koennen sich einen Kopf teilen:
  //
  //     #    Rate.Reputation.Gain.WSG
  //     #    Rate.Reputation.Gain.AB
  //     #    Rate.Reputation.Gain.AV
  //         Description: Reputation bonus rate for WSG, AB and AV ...
  const koepfe = []
  for (let k = i - 1; k >= 0 && i - k < 12; k--) {
    if (istLeer(zeilen[k])) continue
    const kh = istKopf(zeilen[k])
    if (kh) { koepfe.unshift(kh[1]); continue }
    break
  }

  // Schluessel sammeln: aus dem Default-Block darunter
  const gefunden = []
  for (let k = j; k < zeilen.length && k < j + 40; k++) {
    const z = zeilen[k]
    if (istBeschreibung(z) || istKopf(z)) break
    if (!istKommentar(z)) {
      if (istLeer(z)) continue
      break
    }
    // "(Rate.XP.Kill)"  oder  "Rate.XP.Kill = 1"
    for (const m of z.matchAll(/\(([A-Za-z][A-Za-z0-9_.]*)\)/g)) gefunden.push(m[1])
    for (const m of z.matchAll(/([A-Z][A-Za-z0-9_.]*)\s*=\s*[\d.]+/g)) gefunden.push(m[1])
  }

  if (gefunden.length) {
    for (const k of gefunden) setzen(k, text)
  } else {
    for (const kopf of koepfe) {
      if (kopf.endsWith('...')) {
        const praefix = kopf.slice(0, -3)
        for (const k of gesetzt) {
          if (k === praefix || k.startsWith(praefix)) setzen(k, text)
        }
      } else {
        setzen(kopf, text)
      }
    }
  }
}

const mit = gesetzt.filter(k => treffer.has(k))
const ohne = gesetzt.filter(k => !treffer.has(k))

if (alsJson) {
  const raus = {}
  for (const k of gesetzt) raus[k] = treffer.get(k) || null
  console.log(JSON.stringify(raus, null, 2))
  process.exit(0)
}

console.log(`  gesetzte Raten gesamt : ${gesetzt.length}`)
console.log(`  mit Beschreibung     : ${mit.length}`)
console.log(`  ohne                 : ${ohne.length}`)
console.log('')
if (ohne.length) {
  console.log('=== Ohne Beschreibung ===')
  for (const k of ohne) console.log('  ' + k)
  console.log('')
}
console.log('=== Die Beschreibungen ===')
for (const k of gesetzt) {
  if (!treffer.has(k)) continue
  console.log(`${k}`)
  console.log(`    ${treffer.get(k)}`)
  console.log('')
}
