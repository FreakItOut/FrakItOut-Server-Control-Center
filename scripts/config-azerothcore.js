'use strict'

/*
 * Stellt die Panel-Konfiguration auf die echte AzerothCore-Installation
 * unter C:\Users\FreakItOut\AzerothCore.
 *
 * Warum es das braucht: "npm run dist" baut release\win-unpacked neu auf
 * (bzw. laesst die alte config.json vom Vortag liegen), und beim Start
 * wird fehlende Konfiguration aus %APPDATA%\wowpanel uebernommen. Beides
 * hinterlaesst beim Testen einen Repack-Stand, der nichts mit dem
 * installierten Server zu tun hat. Dieses Skript setzt beide Orte
 * (win-unpacked und die portable EXE) auf den echten Stand.
 *
 * Aufruf:  node scripts/config-azerothcore.js
 */

const fs = require('fs')

const ROOT = 'C:\\Users\\FreakItOut\\AzerothCore'

const repoint = {
  server: {
    rootDir: ROOT,
    workDir: `${ROOT}\\build\\bin`,
    worldExe: `${ROOT}\\build\\bin\\worldserver.exe`,
    authExe: `${ROOT}\\build\\bin\\authserver.exe`,
    worldConfDir: `${ROOT}\\build\\bin\\configs`,
    authConfDir: `${ROOT}\\build\\bin\\configs`,
    botFile: '',
    mysqlServer: {
      exe: `${ROOT}\\mysql\\bin\\mysqld.exe`,
      dataDir: `${ROOT}\\mysql\\data`,
      defaultsFile: `${ROOT}\\mysql\\my.ini`,
      port: 3306,
      serviceName: '',
      extraArgs: ''
    }
  },
  mysql: {
    host: '127.0.0.1',
    port: 3306,
    user: 'acore',
    authDb: 'acore_auth',
    charDb: 'acore_characters',
    worldDb: 'acore_world'
  }
}

let passwortAusZustand = ''
try {
  const zustand = JSON.parse(fs.readFileSync(`${ROOT}\\install-state.json`, 'utf8'))
  if (zustand && zustand.soap && zustand.soap.password) {
    passwortAusZustand = String(zustand.soap.password)
  }
  if (zustand && zustand.mysqlRootPassword) {
    repoint.mysql.password = String(zustand.dbPassword || '')
    repoint.server.mysqlServer.port = Number(zustand.mysqlPort) || 3306
    repoint.mysql.port = Number(zustand.mysqlPort) || 3306
  }
} catch (_) {}

for (const ziel of [
  'release\\win-unpacked\\config.json',
  'release\\config.json'
]) {
  const pfad = require('path').join(__dirname, '..', ziel)
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(pfad, 'utf8')) } catch (_) {}
  const neu = { ...cfg, ...repoint }
  neu.server = { ...cfg.server, ...repoint.server }
  neu.mysql = { ...cfg.mysql, ...repoint.mysql }
  if (passwortAusZustand) {
    neu.soap = { ...(cfg.soap || {}), enabled: true, host: '127.0.0.1', port: 7878, user: 'SOAP', password: passwortAusZustand }
  }
  fs.writeFileSync(pfad, JSON.stringify(neu, null, 2), 'utf8')
  console.log('aktualisiert:', pfad)
}
