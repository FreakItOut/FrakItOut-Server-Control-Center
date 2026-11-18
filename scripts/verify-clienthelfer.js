'use strict'

/*
 * Testet die WoW-Client-Helfer: realmlist.wtf ersetzen (mit Backup der
 * alten Datei), Client-Ordner-Pruefung, Ablehnung ohne WoW.exe. Alles in
 * einem temporaeren Ordner - es wird kein echtes Programm angeruehrt.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

async function main () {
  const system = require('../electron/api/system')

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wowpanel-client-'))

  section('1. Falscher Ordner wird abgelehnt')
  const r0 = await system.realmlistSetzen({ clientDir: base, adresse: '127.0.0.1' })
  check(r0.ok === false && /WoW\.exe/.test(r0.error), 'ohne WoW.exe: klare Ablehnung')
  check(!fs.existsSync(path.join(base, 'realmlist.wtf')), 'kein realmlist.wtf angelegt')

  section('2. Neues realmlist.wtf anlegen')
  fs.writeFileSync(path.join(base, 'Wow.exe'), 'x')
  fs.mkdirSync(path.join(base, 'Data'))
  const r1 = await system.realmlistSetzen({ clientDir: base, adresse: '192.168.1.50' })
  check(r1.ok === true, 'setzen meldet Erfolg')
  const inhalt = fs.readFileSync(path.join(base, 'realmlist.wtf'), 'utf8')
  check(/set\s+realmlist\s+192\.168\.1\.50/.test(inhalt), 'Serverzeile steht drin')
  check(!fs.existsSync(path.join(base, 'realmlist.wtf.panel-backup')), 'ohne alte Datei kein Backup angelegt')

  section('3. Bestehende Datei ersetzen, altes Backup bleiben lassen')
  fs.writeFileSync(path.join(base, 'realmlist.wtf'),
    'set realmlist 1.2.3.4\r\nset patchlist 1.2.3.4\r\n', 'utf8')
  const r2 = await system.realmlistSetzen({ clientDir: base, adresse: '127.0.0.1' })
  check(r2.ok === true, 'ersetzen meldet Erfolg')
  const neu = fs.readFileSync(path.join(base, 'realmlist.wtf'), 'utf8')
  check(/set\s+realmlist\s+127\.0\.0\.1/.test(neu), 'realmlist-Zeile ersetzt')
  check(/set\s+patchlist\s+1\.2\.3\.4/.test(neu), 'patchlist-Zeile bleibt erhalten')
  check(!/1\.2\.3\.4/.test(/set\s+realmlist[^\r\n]*/.exec(neu)[0]), 'alte Realmlist-Zeile ist weg')
  const backup = fs.readFileSync(path.join(base, 'realmlist.wtf.panel-backup'), 'utf8')
  check(/1\.2\.3\.4/.test(backup), 'die alte Datei liegt als Backup daneben')

  section('4. Ohne Serverzeile wird angehaengt, nicht ueberschrieben')
  fs.writeFileSync(path.join(base, 'realmlist.wtf'), 'set patchlist 5.6.7.8\r\n', 'utf8')
  const r3 = await system.realmlistSetzen({ clientDir: base, adresse: '127.0.0.1' })
  const nach = fs.readFileSync(path.join(base, 'realmlist.wtf'), 'utf8')
  check(r3.ok === true && /set\s+realmlist\s+127\.0\.0\.1/.test(nach) && /set\s+patchlist/.test(nach), 'Zeile angehaengt, Rest geblieben')

  section('5. clientPruefen beschreibt den Zustand')
  const p = await system.clientPruefen({ clientDir: base })
  check(p.ok === true && p.notizen.some(n => /WoW\.exe gefunden/.test(n)), 'WoW.exe erkannt')
  check(p.notizen.some(n => /realmlist\.wtf zeigt auf: 127\.0\.0\.1/.test(n)), 'aktuelle realmlist gelesen')
  const p2 = await system.clientPruefen({ clientDir: base })
  check(Array.isArray(p2.notizen) && p2.notizen.length >= 2, 'Pruefliste ausgefuellt')

  fs.rmSync(base, { recursive: true, force: true })
  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})
