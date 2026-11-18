'use strict'

/*
 * Bot-Filter-Regressionsschutz (Runde 15).
 *
 * Runde 11-14 hatte zwei Fehler in der Bot-Erkennung:
 *   1. botFilterSql liefert bereits "NOT (bot…)". Liste und Count wickelten
 *      nochmal "NOT(…)" drumherum - "Bots ausblenden" zeigte dann NUR Bots
 *      (doppelte Verneinung).
 *   2. Der Default-Praefix war "rnbot" statt "rndbot" (der Repack erzeugt
 *      RNDBOT1..200 bzw. rndbot0..199) - der Filter griff nie.
 *
 * Aufruf:  node scripts/verify-botfilter.js
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

// Eigenes Store-Verzeichnis, damit die echte Panel-Konfiguration unberuehrt bleibt
const BASE = path.join(os.tmpdir(), 'wowpanel-botfilter')
const store = require('../electron/store')
store.init(path.join(BASE, 'cfg'))
store.write({ maintenance: { botKontoPraefixe: '' }, soap: { user: 'SOAP' } })

const spieler = require('../electron/api/spieler')
spieler.init(store)

section('Standard-Praefixe')
const sql = spieler.botFilterSql('a')
check(/^NOT \(/.test(sql), 'SQL beginnt mit NOT ( ... )')
check((sql.match(/\bNOT\b/g) || []).length === 1, 'genau EIN NOT in botFilterSql')
check(sql.includes("LOWER(a.username) = 'soap'"), 'SOAP-Konto ausgeschlossen')
check(sql.includes("LIKE 'rndbot%'"), 'rndbot-Praefix (Repack RNDBOT1..200)')
check(sql.includes("LIKE 'ahbot%'"), 'ahbot-Praefix (Auctionhouse-Bot)')
check(sql.includes("LIKE 'playerbots%'"), 'playerbots-Praefix')
check(!sql.includes("LIKE 'rnbot%'"), 'kein alter Tippfehler rnbot')

section('istBotName')
check(spieler.istBotName('RNDBOT153') === true, 'RNDBOT153 = Bot')
check(spieler.istBotName('ahbot0') === true, 'ahbot0 = Bot')
check(spieler.istBotName('playerbots3') === true, 'playerbots3 = Bot')
check(spieler.istBotName('SOAP') === true, 'SOAP-Konto = Bot (kein Spieler)')
check(spieler.istBotName('freak') === false, 'freak = echter Spieler')
check(spieler.istBotName('freakitout') === false, 'freakitout = echter Spieler')
check(spieler.istBotName('') === false, 'leerer Name = kein Bot')

section('Eigene Praefixe')
store.write({ maintenance: { botKontoPraefixe: 'testbot' } })
const sql2 = spieler.botFilterSql('acc')
check(sql2.includes("LIKE 'testbot%'"), 'eigenes Praefix im SQL')
check(!sql2.includes("LIKE 'rndbot%'"), 'Standard-Praefixe ersetzt')
check(spieler.istBotName('testbot7') === true, 'istBotName folgt eigenen Praefixen')
check(spieler.istBotName('rndbot1') === false, 'alte Praefixe gelten nicht mehr')

section('Quelltext: kein doppeltes NOT')
const lies = f => fs.readFileSync(path.join(__dirname, '..', 'electron', 'api', f), 'utf8')
for (const datei of ['characters.js', 'online.js']) {
  const text = lies(datei)
  check(!text.includes('NOT (${botFilter})'), `${datei}: kein NOT um botFilter`)
}
const charsText = lies('characters.js')
// characters.js (Runde 16): Filter laeuft ueber die Variable botBedingung -
// Liste UND Count muessen beide filtern, ohne zusaetzliches NOT.
check((charsText.match(/botBedingung/g) || []).length >= 4, 'characters.js: Liste UND Count nutzen botBedingung')
check(!charsText.includes('NOT (${botBedingung})'), 'characters.js: kein NOT um botBedingung')
const onlineText = lies('online.js')
check(onlineText.includes('AND ${botFilter}'), 'online.js: nutzt AND ${botFilter}')

console.log('')
console.log(failures ? `${failures} Pruefung(en) fehlgeschlagen.` : 'Bot-Filter: alle Pruefungen bestanden.')
process.exitCode = failures ? 1 : 0
