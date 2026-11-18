'use strict'

/*
 * Tests fuer die Netzwerk-/IP-Funktionen.
 * Prueft Adressvalidierung, Realm-Port-Pruefung und das Schreiben der
 * BindIP in eine echte worldserver.conf (inkl. Unversehrtheit der
 * uebrigen Zeilen).
 *
 * Aufruf:  node scripts/verify-network.js <verzeichnis-mit-bin/worldserver>
 */

const path = require('path')
const fs = require('fs')

const BASE = process.argv[2] || path.join(__dirname, '..', '..', 'actest')
const WS = path.join(BASE, 'bin', 'worldserver')

const store = require('../electron/store')
store.init(path.join(BASE, 'cfg'))
store.write({
  server: {
    worldExe: path.join(WS, 'worldserver.exe'),
    authExe: path.join(BASE, 'bin', 'authserver', 'authserver.exe'),
    worldConfDir: WS,
    authConfDir: path.join(BASE, 'bin', 'authserver'),
    mysqlServer: {}
  }
})

const network = require('../electron/api/network')

let failures = 0
function check (cond, label) {
  console.log((cond ? '  OK   ' : '  FAIL ') + label)
  if (!cond) failures++
}

function section (t) {
  console.log('\n=== ' + t + ' ===')
}

const CONF = `WorldServerConfig

RealmID = 1
LoginDatabaseInfo = "127.0.0.1;3306;root;root;ac_auth"
WorldDatabaseInfo = "127.0.0.1;3306;root;root;ac_world"

# an alle Interfaces binden
BindIP = "0.0.0.0"
ExternalIP = "127.0.0.1"
RealmServerPort = 8085

AiPlayerbot.Enable = 0
SOAP.enable = 0
MaxPingTime = 30
`

fs.mkdirSync(WS, { recursive: true })
fs.writeFileSync(path.join(WS, 'worldserver.conf'), CONF, 'utf8')

async function main () {
  section('1. Adressvalidierung')
  const valid = ['127.0.0.1', '192.168.178.50', '10.0.0.1', '8.8.8.8', '::1', '2001:db8::1', 'play.meine-domain.de', 'server-01.lan']
  for (const v of valid) {
    check(network.isValidHost(v), `gueltig: ${v}`)
  }
  const invalid = ['', '   ', '999.1.1.1', '192.168.1', 'http://192.168.1.1', '192.168.1.1:8085', 'mein domain', 'x/y']
  for (const v of invalid) {
    check(!network.isValidHost(v), `ungueltig: "${v}"`)
  }

  section('2. Erkennung privater Adressen')
  check(network.isPrivateOrLoopback('192.168.1.5'), '192.168.x ist privat')
  check(network.isPrivateOrLoopback('127.0.0.1'), '127.0.0.1 ist lokal')
  check(network.isPrivateOrLoopback('10.0.0.1'), '10.x ist privat')
  check(!network.isPrivateOrLoopback('8.8.8.8'), '8.8.8.8 ist oeffentlich')

  section('3. Realm-Adresse: Eingabepruefung')
  for (const bad of [
    { ip: '999.1.1.1', port: 8085 },
    { ip: '127.0.0.1', port: 0 },
    { ip: '127.0.0.1', port: 70000 },
    { ip: '', port: 8085 }
  ]) {
    let threw = false
    try {
      await network.setRealmAddress(bad)
    } catch (_) {
      threw = true
    }
    check(threw, `abgelehnt: ip="${bad.ip}" port=${bad.port}`)
  }

  section('4. Aktuelle Werte werden aus der Datei gelesen')
  const cur = await network.get()
  check(cur.bindIp === '0.0.0.0', `BindIP gelesen: ${cur.bindIp}`)
  check(cur.externalIp === '127.0.0.1', `ExternalIP gelesen: ${cur.externalIp}`)

  section('5. BindIP wird geschrieben')
  const res = await network.setConfIp({ bindIp: '192.168.178.50' })
  check(res.ok === true, 'Schreiben erfolgreich')
  const after = await network.get()
  check(after.bindIp === '192.168.178.50', `BindIP jetzt: ${after.bindIp}`)

  section('6. Uebrige Zeilen unveraendert')
  const raw = fs.readFileSync(path.join(WS, 'worldserver.conf'), 'utf8')
  check(raw.includes('RealmID = 1'), 'RealmID unveraendert')
  check(raw.includes('MaxPingTime = 30'), 'MaxPingTime unveraendert')
  check(raw.includes('SOAP.enable = 0'), 'SOAP.enable unveraendert')
  check(raw.includes('AiPlayerbot.Enable = 0'), 'Bot-Eintrag unveraendert')
  check(raw.includes('ExternalIP = "127.0.0.1"'), 'ExternalIP unveraendert')
  check(raw.includes('# an alle Interfaces binden'), 'Kommentar unveraendert')
  check(raw.includes('BindIP = "192.168.178.50"'), 'BindIP aktualisiert')
  check(/LoginDatabaseInfo = "127\.0\.0\.1;3306;root;root;ac_auth"/.test(raw), 'Datenbankzeile unveraendert')

  section('7. Backup vorhanden')
  check(fs.existsSync(path.join(WS, 'worldserver.conf.bak')), '.bak-Datei angelegt')

  section('8. Ungueltige BindIP wird abgewiesen')
  let threw = false
  try {
    await network.setConfIp({ bindIp: '999.999.1.1' })
  } catch (_) {
    threw = true
  }
  check(threw, 'BindIP 999.999.1.1 abgelehnt')

  section('9. 0.0.0.0 bleibt erlaubt')
  await network.setConfIp({ bindIp: '0.0.0.0' })
  check((await network.get()).bindIp === '0.0.0.0', '0.0.0.0 akzeptiert')

  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})