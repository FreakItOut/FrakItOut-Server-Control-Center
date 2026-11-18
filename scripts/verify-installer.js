'use strict'

/*
 * Prueft die automatische Einrichtung ohne Netzzugriff und ohne Build.
 *
 * Getestet werden die reinen Rechen- und Dateifunktionen (Pfade, Conf-Werte,
 * my.ini, Fortschritt) sowie die Verdrahtung zwischen Backend, Preload und
 * Oberflaeche. Ein echter Download oder eine Uebersetzung waeren hier weder
 * schnell noch reproduzierbar.
 *
 * Aufruf: node scripts/verify-installer.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const installer = require('../electron/api/installer')
const intern = installer.__intern

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

const lies = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

const main = async () => {
  section('1. Zielordner')
  check(
    intern.normalisiereRoot('') === path.join(os.homedir(), 'AzerothCore'),
    'leerer Ordner faellt auf den Standardordner zurueck'
  )
  check(
    intern.normalisiereRoot('~') === os.homedir(),
    '~ wird auf das Benutzerverzeichnis abgebildet'
  )
  check(
    intern.normalisiereRoot('~/AC') === path.join(os.homedir(), 'AC'),
    '~/ wird auf das Benutzerverzeichnis abgebildet'
  )
  check(
    intern.normalisiereRoot('"C:\\AzerothCore"') === path.resolve('C:\\AzerothCore'),
    'Anfuehrungszeichen werden entfernt'
  )

  section('2. Ordnerstruktur')
  const p = intern.pfade('C:\\AC-Test')
  check(p.source === path.join('C:\\AC-Test', 'source'), 'Quellen liegen unter source')
  check(
    p.bin === path.join('C:\\AC-Test', 'build', 'bin', 'RelWithDebInfo'),
    'Binaries liegen unter build\\bin\\RelWithDebInfo'
  )
  check(p.configs === path.join(p.bin, 'configs'), 'Konfiguration liegt neben den Binaries')
  check(p.mysqlData === path.join('C:\\AC-Test', 'mysql', 'data'), 'MySQL-Daten liegen unter mysql\\data')
  check(p.zustand === path.join('C:\\AC-Test', 'install-state.json'), 'Zustandsdatei liegt in der Wurzel')

  section('3. Konfigurationswerte')
  check(intern.formatConfWert(3306) === '3306', 'Zahlen bleiben ohne Anfuehrungszeichen')
  check(intern.formatConfWert('1') === '1', 'numerische Strings bleiben ohne Anfuehrungszeichen')
  check(intern.formatConfWert('C:/AC/data') === '"C:/AC/data"', 'Pfade werden in Anfuehrungszeichen gesetzt')
  check(intern.formatConfWert('"fertig"') === '"fertig"', 'bereits zitierte Werte bleiben unveraendert')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-installer-'))
  try {
    const conf = path.join(tmp, 'worldserver.conf')
    fs.writeFileSync(
      conf,
      'LoginDatabaseInfo = "alt"\r\nDataDir = "."\r\n# Kommentar\r\n',
      'utf8'
    )
    check(intern.setConfValue(conf, 'DataDir', 'C:/AC data/$x'), 'vorhandener Schluessel wird ersetzt')
    let text = fs.readFileSync(conf, 'utf8')
    check(text.includes('DataDir = "C:/AC data/$x"'), 'Pfad mit Leerzeichen und $ wird korrekt geschrieben')
    check(!text.includes('DataDir = "."'), 'alter Wert ist verschwunden')
    check(text.includes('# Kommentar'), 'Kommentare bleiben erhalten')

    check(intern.setConfValue(conf, 'RealmID', 1), 'fehlender Schluessel wird ergaenzt')
    text = fs.readFileSync(conf, 'utf8')
    check(/(^|\r?\n)RealmID = 1(\r?\n|$)/.test(text), 'neuer Schluessel steht in eigener Zeile')

    const db = intern.dbInfo({ port: 3307, dbPasswort: 'geheim' }, 'acore_world')
    check(db === '127.0.0.1;3307;acore;geheim;acore_world', 'DB-Info hat das AzerothCore-Format')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  section('4. Portable MySQL')
  const ini = intern.myIniInhalt(p, 3306)
  check(ini.includes('basedir="C:/AC-Test/mysql"'), 'basedir zeigt auf den MySQL-Ordner')
  check(ini.includes('datadir="C:/AC-Test/mysql/data"'), 'datadir zeigt auf mysql\\data')
  check(ini.includes('port=3306'), 'Port steht in der my.ini')
  check(ini.includes('log-error="C:/AC-Test/mysql/data/wowpanel-mysql.err"'), 'Fehlerprotokoll liegt im Datenordner')
  check(ini.includes('mysqlx=OFF'), 'X-Protokoll ist abgeschaltet')

  const cnf = intern.clientCnfInhalt(3306, 'pw')
  check(cnf.includes('user=root') && cnf.includes('password=pw'), 'client.cnf enthaelt den root-Zugang')
  check(cnf.includes('host=127.0.0.1'), 'client.cnf verbindet lokal')

  section('5. Fortschritt')
  const b0 = intern.prozentBasis(0)
  const bLast = intern.prozentBasis(intern.STEPS.length)
  check(b0 === 0, 'Start liegt bei 0 %')
  check(bLast === 100, 'Ende liegt bei 100 %')
  let steigend = true
  for (let i = 1; i <= intern.STEPS.length; i++) {
    if (intern.prozentBasis(i) < intern.prozentBasis(i - 1)) steigend = false
  }
  check(steigend, 'Fortschritt steigt monoton')
  check(
    intern.STEPS.every(s => typeof s.key === 'string' && s.weight > 0),
    'jeder Schritt hat Schluessel und Gewicht'
  )

  section('6. Texte')
  const i18n = lies('src', 'i18n', 'parts', 'setup.js')
  for (const s of intern.STEPS) {
    check(i18n.includes(`${s.key}:`), `Schritt ${s.key} ist uebersetzt`)
  }
  for (const t of ['git', 'cmake', 'vs', 'openssl', 'boost', 'winget']) {
    check(i18n.includes(`${t}:`), `Werkzeug ${t} ist uebersetzt`)
  }

  section('7. Verdrahtung')
  const routes = lies('electron', 'api', 'index.js')
  for (const r of ['installer.environment', 'installer.start', 'installer.status', 'installer.cancel', 'installer.openLog']) {
    check(routes.includes(`'${r}'`), `Route ${r} ist registriert`)
  }
  check(
    lies('electron', 'main.js').includes("require('./api/installer').init(store, mainWindow)"),
    'Installer wird mit dem Fenster initialisiert'
  )
  check(
    lies('electron', 'preload.js').includes("'installer:progress'"),
    'Ereignis installer:progress ist freigeschaltet'
  )
  const apiJs = lies('src', 'lib', 'api.js')
  for (const m of ['environment:', 'start:', 'status:', 'cancel:', 'openLog:']) {
    check(apiJs.includes(m), `API-Wrapper enthaelt ${m.replace(':', '')}`)
  }
  check(
    lies('src', 'pages', 'Setup.jsx').includes('SetupInstall'),
    'Assistent bindet die Installationsoberflaeche ein'
  )
  check(
    lies('electron', 'server-manager.js').includes('defaultsFile'),
    'Prozessverwaltung kennt die portable my.ini'
  )
  check(
    lies('electron', 'api', 'system.js').includes('defaultsFile'),
    'Pfaderkennung uebernimmt die portable my.ini'
  )

  section('8. SOAP')
  const alt = intern.soapZugangAusZustand({
    soap: { user: 'SOAP', password: 'AltPasswort123', port: 7900 }
  })
  check(alt.enabled === true, 'SOAP ist nach der Installation aktiv')
  check(alt.user === 'SOAP' && alt.password === 'AltPasswort123', 'vorhandene Zugangsdaten bleiben erhalten')
  check(alt.port === 7900, 'vorhandener SOAP-Port bleibt erhalten')

  const neu = intern.soapZugangAusZustand(null)
  check(neu.password.length >= 16, 'neues SOAP-Passwort wird zufaellig erzeugt')
  check(neu.port === 7878, 'neuer SOAP-Port ist der Core-Standard 7878')
  check(neu.host === '127.0.0.1', 'SOAP lauscht nur lokal')

  const installerJs = lies('electron', 'api', 'installer.js')
  for (const key of ['SOAP.Enabled', 'SOAP.IP', 'SOAP.Port']) {
    check(installerJs.includes(`'${key}'`), `worldserver.conf wird um ${key} ergaenzt`)
  }
  check(installerJs.includes('account_access'), 'SOAP-Konto erhaelt einen GM-Eintrag')
  check(
    installerJs.includes('INSERT INTO account (username, salt, verifier'),
    'SOAP-Konto wird mit SRP6-Verifier angelegt'
  )
  check(
    lies('electron', 'api', 'accounts.js').match(/calculateVerifier\s*\n\}/),
    'Verifier-Berechnung ist fuer den Installer freigegeben'
  )
  check(installerJs.includes("soap: {\n      enabled: true"), 'SOAP-Zugang wird in config.json uebernommen')

  const aufrufe = []
  const conn = {
    async query (sql, params = []) {
      aufrufe.push({ sql, params })
      if (/SELECT id FROM account/i.test(sql)) return [[]]
      if (/SHOW COLUMNS FROM account_access/i.test(sql)) {
        return [[{ Field: 'id' }, { Field: 'gmlevel' }, { Field: 'RealmID' }, { Field: 'comment' }]]
      }
      if (/INSERT INTO account \(/i.test(sql)) return [{ insertId: 42 }]
      return [{}]
    }
  }
  const kontoId = await intern.soapKontoAnlegen(conn, { user: 'SOAP', password: 'Testpasswort123' })
  check(kontoId === 42, 'neues SOAP-Konto liefert die ID des INSERT zurueck')
  const konto = aufrufe.find(a => /INSERT INTO account \(/i.test(a.sql))
  check(konto && konto.params[0] === 'SOAP', 'SOAP-Konto wird mit dem Benutzernamen angelegt')
  check(
    konto && Buffer.isBuffer(konto.params[1]) && konto.params[1].length === 32,
    'Salt ist 32 Byte lang'
  )
  check(
    konto && Buffer.isBuffer(konto.params[2]) && konto.params[2].length === 32,
    'Verifier ist 32 Byte lang'
  )
  const zugriff = aufrufe.find(a => /INSERT INTO account_access/i.test(a.sql))
  check(
    zugriff && zugriff.params[1] === 3 && zugriff.sql.includes('-1'),
    'SOAP-Konto erhaelt GM-Stufe 3 fuer alle Reiche'
  )

  console.log(
    '\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  )
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
