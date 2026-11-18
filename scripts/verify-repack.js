'use strict'

/* Testet die Repack-Erkennung gegen einen echten Serverordner.
   Aufruf:  node scripts/verify-repack.js "C:\German Repack Legenden 4.4.5" */

const path = require('path')
const { detectRepack, readDbInfo } = require('../electron/api/system')

const BASE = process.argv[2] || 'C:\\German Repack Legenden 4.4.5'

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

const main = () => {
  section('1. Erkennung auf dem echten Ordner')
  const r = detectRepack(BASE)
  if (!r.ok) {
    console.log('  FAIL Erkennung fehlgeschlagen:', r.error)
    process.exitCode = 1
    return
  }
  console.log('  Layout:', r.layout)
  r.notes.forEach(n => console.log('  Hinweis:', n))
  console.log('  worldExe     :', r.server.worldExe)
  console.log('  authExe      :', r.server.authExe)
  console.log('  worldConfDir :', r.server.worldConfDir)
  console.log('  workDir      :', r.server.workDir)
  console.log('  mysqlExe     :', r.mysqlServer.exe)
  console.log('  mysqlDataDir :', r.mysqlServer.dataDir)
  console.log('  mysqlArgs    :', r.mysqlServer.extraArgs)

  section('2. Pruefungen')
  check(r.layout === 'repack', 'als Repack erkannt')
  check(!!r.server.worldExe, 'worldserver.exe gefunden')
  check(!!r.server.authExe, 'authserver.exe gefunden')
  check(
    r.server.worldConfDir && r.server.worldConfDir.endsWith('configs'),
    'Config-Ordner ist configs\\ (nicht der Wurzelordner)'
  )
  check(
    r.server.worldConfDir !== r.server.workDir,
    'Arbeitsverzeichnis weicht vom Config-Ordner ab'
  )
  check(!!r.mysqlServer.exe, 'gebündeltes MySQL gefunden')
  check(r.mysqlServer.extraArgs.includes('--standalone'), '--standalone gesetzt')
  check(r.mysqlServer.extraArgs.includes('--console'), '--console gesetzt')

  section('3. Datenbankdaten aus der Conf')
  check(!!r.mysql, 'DB-Block gelesen')
  if (r.mysql) {
    console.log('  ', JSON.stringify(r.mysql))
    check(r.mysql.user === 'root', `Benutzer: ${r.mysql.user}`)
    check(r.mysql.port === 3306, `Port: ${r.mysql.port}`)
    check(!!r.mysql.authDb, `Auth-DB: ${r.mysql.authDb}`)
    check(!!r.mysql.worldDb, `World-DB: ${r.mysql.worldDb}`)
    check(!!r.mysql.charDb, `Characters-DB: ${r.mysql.charDb}`)
  }

  section('4. Server findet seine Config ohne Argument')
  // Die Default-Config ist relativ: configs/worldserver.conf
  const confRel = path.join(r.server.workDir, 'configs', 'worldserver.conf')
  check(require('fs').existsSync(confRel), `Default-Pfad aufloesbar: ${confRel}`)

  section('5. Unsinniger Ordner')
  const bad = detectRepack('C:\\Windows\\System32')
  check(bad.ok === false, 'System32 wird abgelehnt')
  const none = detectRepack('C:\\gibtesnicht12345')
  check(none.ok === false, 'nicht existierender Ordner wird abgelehnt')

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main()