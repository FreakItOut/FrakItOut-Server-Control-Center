'use strict'

const fs = require('fs')
const path = require('path')

const db = require('../db')
const store = require('../store')
const serverManager = require('../server-manager')

const realms = require('./realms')
const characters = require('./characters')
const accounts = require('./accounts')
const bans = require('./bans')
const backup = require('./backup')
const online = require('./online')
const gm = require('./gm')
const configEditor = require('./config-editor')
const soap = require('./soap')
const bots = require('./bots')
const system = require('./system')
const mysqlService = require('./mysql-service')
const network = require('./network')
const startAll = require('./start-all')
const rates = require('./rates')
const moduleApi = require('./module')
const diagnose = require('./diagnose')
const installer = require('./installer')
const maintenance = require('./maintenance')
const profile = require('./profile')
const webhook = require('./webhook')
const spieler = require('./spieler')
const audit = require('./audit')
const tickets = require('./tickets')
const security = require('./security')
const sqlkonsole = require('./sqlkonsole')
const statistik = require('./statistik')
const logarchiv = require('./logarchiv')
const guilds = require('./guilds')
const wirtschaft = require('./wirtschaft')
const systemverlauf = require('./systemverlauf')

db.init(store)
soap.init(store)
diagnose.init(store)
maintenance.init(store, null)
profile.init(store, null)
webhook.init(store)
spieler.init(store)
audit.init(store)
sqlkonsole.init(store)
statistik.init(store)
systemverlauf.init(store)

const routes = {
  // ---------- Einstellungen / Diagnose ----------
  'settings.get': async () => store.read(),
  // Diagnose: Ist der Build aktuell, und wann ist der Server abgestuerzt?
  'diagnose.get': async () => diagnose.diagnose(),
  'diagnose.crashOrdnerOeffnen': async () => {
    const ordner = diagnose.crashOrdner()
    if (!ordner) throw new Error('Kein Crashes-Ordner gefunden.')
    const { shell } = require('electron')
    const fehler = await shell.openPath(ordner)
    if (fehler) throw new Error(fehler)
    return { ok: true, pfad: ordner }
  },
  'settings.save': async (patch) => store.write(patch),
  // Datei neu einlesen, damit Handaenderungen ohne Neustart wirken.
  // Die Datenbankpools vergleichen ihre Konfiguration bei jeder Anfrage
  // und bauen sich bei Abweichung selbst neu auf.
  'settings.reload': async () => store.reload(),
  'settings.filePath': async () => store.filePathOf(),
  'settings.openFile': async () => {
    const { shell } = require('electron')
    const p = store.filePathOf()
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
    return { ok: true, path: p }
  },
  'settings.testDb': async (kind) => db.test(kind || 'world'),
  'settings.testAll': async () => {
    const results = {}
    for (const kind of ['auth', 'chars', 'world']) {
      results[kind] = await db.test(kind)
    }
    return results
  },

  // ---------- Serversteuerung ----------
  'server.status': async () => serverManager.status(),
  'server.ereignisse': async () => ({ liste: serverManager.ereignisse() }),
  // Datenbank einzeln starten. Benoetigt der Assistent, weil dort sonst
  // niemals eine Pruefung erfolgreich werden kann, solange MySQL aus ist.
  'server.startDatabase': async () => startAll.startDatabase(),
  'server.start': async ({ kind }) => serverManager.start(kind),
  'server.stop': async ({ kind }) => serverManager.stop(kind),
  'server.restart': async ({ kind }) => serverManager.restart(kind),
  // Dienst-Waechter: Port eines laufenden Dienstes im Auge behalten
  'server.watchdog': async () => serverManager.waechterEinstellungen(),
  'server.watchdogSetzen': async (data) => serverManager.waechterSetzen(data || {}),
  'server.clearLogs': async ({ kind }) => {
    serverManager.clearLogs(kind)
    return { ok: true }
  },

  // ---------- Datenbank (Windows-Dienst oder mysqld.exe) ----------
  'mysql.services': async () => ({
    services: await mysqlService.listServices(),
    admin: await mysqlService.isAdmin()
  }),
  'mysql.serviceAction': async (data) => mysqlService.serviceAction(data),

  // ---------- Startsequenz: Datenbank -> Authserver -> Worldserver ----------
  'server.startAll': async (data) => {
    // nicht blockierend: der Fortschritt kommt ueber das Event
    startAll.startAll(data || {}).catch(() => {})
    return { ok: true, started: true }
  },
  'server.stopAll': async (data) => startAll.stopAll(data || {}),
  'server.startAllState': async () => ({ running: startAll.isRunning() }),
  'server.metriken': async () => serverManager.metriken(),
  'server.logOeffnen': async ({ kind } = {}) => {
    const pfad = serverManager.logDatei(kind || 'world')
    if (!pfad) throw new Error('Logdatei nicht gefunden - der Server hat noch keine geschrieben.')
    const { shell } = require('electron')
    const fehler = await shell.openPath(pfad)
    if (fehler) throw new Error(fehler)
    return { ok: true, pfad }
  },

  // ---------- Server-IP / Netzwerk ----------
  'network.get': async () => network.get(),
  'network.setRealmAddress': async (data) => network.setRealmAddress(data),
  'network.setConfIp': async (data) => network.setConfIp(data),

  // ---------- Server-Raten ----------
  'rates.get': async () => rates.get(),
  'rates.save': async (data) => rates.save(data),
  'rates.createDefaults': async () => rates.createDefaults(),
  'rates.reset': async (data) => rates.resetStandards(data || {}),

  // ---------- Konfigurationsdateien ----------
  'config.available': async () => configEditor.available(),
  'config.read': async ({ file }) => configEditor.readConfig(file),
  'config.save': async (data) => configEditor.saveConfig(data),
  'config.search': async (data) => configEditor.searchConfig(data),
  // Sicherungen mit Zeitstempel: auflisten und eine aeltere Stufe
  // zurueckspielen.
  'config.sicherungen': async (data) => configEditor.sicherungenListen(data || {}),
  'config.sicherungZurueckspielen': async (data) => configEditor.sicherungZurueckspielen(data || {}),

  // ---------- PlayerBots ----------
  'bots.get': async () => bots.get(),
  'bots.save': async (data) => bots.save(data),
  'bots.createFile': async () => bots.createFile(),
  'bots.setFile': async (data) => bots.setFile(data || {}),

  // ---------- Datei-/Ordnerauswahl (Explorer) ----------
  'system.pickFile': async (data) => system.pickFile(data),
  'system.pickFolder': async (data) => system.pickFolder(data),
  'system.listConf': async ({ dir }) => system.listConf(dir),
  'system.checkPaths': async ({ paths }) => system.checkPaths(paths),
  'system.detectRepack': async ({ dir }) => system.detectRepack(dir),
  'system.setupStatus': async () => system.setupStatus(),
  'system.suggestServerDirs': async () => system.suggestServerDirs(),
  'system.freierPlatz': async (data) => system.freierPlatz((data || {}).ziel),
  'system.realmlistSetzen': async (data) => system.realmlistSetzen(data || {}),
  'system.clientPruefen': async (data) => system.clientPruefen(data || {}),
  'system.gesundheitscheck': async () => system.gesundheitscheck(),
  'system.configExport': async () => system.configExport(),
  'system.configImport': async () => system.configImport(),
  'system.freundeOeffnen': async (data) => system.freundeOeffnen(data || {}),
  'system.freundeSchliessen': async () => system.freundeSchliessen(),
  'system.lanAdresse': async () => system.lanAdresse(),
  'system.platzAufstellung': async () => system.platzAufstellung(),
  'system.downloadsRaeumen': async () => system.downloadsRaeumen(),
  'system.logsRaeumen': async () => system.logsRaeumen(),
  'system.dbGroessen': async () => system.dbGroessen(),
  'system.dbWartung': async (data) => system.dbWartung(data || {}),
  'system.dbWartungLetzte': async () => system.dbWartungLetzte(),
  'system.restartNoetig': async () => system.restartNoetig(),
  'system.buildNoetig': async () => system.buildNoetig(),
  'system.auffaelligkeiten': async () => system.auffaelligkeiten(),
  'installer.fremdDb': async (data) => installer.fremdDbUebernehmen(data || {}),
  'installer.migration': async () => ({ migration: require('../store').read().lastConfigMigration || null }),
  'installer.migrationGesehen': async () => {
    try { require('../store').write({ lastConfigMigration: { gesehen: true } }) } catch (_) {}
    return { ok: true }
  },
  'installer.mysqlPortAendern': async (data) => installer.mysqlPortAendern(data || {}),
  'installer.fremdDbZaehlen': async (data) => installer.fremdDbZaehlen(data || {}),

  /*
   * Rückhol-Anker der Migration: der Stempel der Sicherheitssicherung, die
   * VOR der Übernahme gezogen wurde. Die Backup-Seite zeigt dazu den
   * markierten Rückhol-Knopf; verwerfen räumt die Markierung weg.
   */
  'installer.fremdRueckholInfo': async () => {
    const m = (store.read().migration || {})
    return m.backupStamp ? { ok: true, stamp: m.backupStamp, zeit: m.zeit || '' } : { ok: false }
  },
  'installer.fremdRueckholVerwerfen': async () => {
    store.write({ migration: { backupStamp: '', zeit: '' } })
    return { ok: true }
  },
  // Zuletzt gewählter Fremd-Ordner der Übernahme - für die Vorbefüllung
  'installer.fremdLetzterOrdner': async () => {
    const m = (store.read().migration || {})
    return { ordner: m.letzterOrdner || '' }
  },
  // Gemerktes Ergebnis der letzten Übernahme (überlebt den Panel-Neustart)
  'installer.fremdErgebnis': async () => {
    const m = (store.read().migration || {})
    return m.letztesErgebnis ? { ok: true, ergebnis: m.letztesErgebnis } : { ok: false }
  },
  'installer.fremdErgebnisVerwerfen': async () => {
    store.write({ migration: { letztesErgebnis: null } })
    return { ok: true }
  },
  // Update-Verlauf: die letzten Läufe (Zeit, Dauer, Ergebnis)
  'installer.updateVerlauf': async () => {
    const liste = Array.isArray(store.read().updateHistory) ? store.read().updateHistory : []
    return { verlauf: liste }
  },
  'installer.serverStand': async () => installer.serverStand(),
  'system.spielerOnline': async () => {
    const online = await spieler.zaehleEchteSpieler()
    return { ok: true, online }
  },
  'mysql.portAendern': async (data) => installer.mysqlPortAendern(data || {}),
  'webhook.testen': async () => webhook.testen(),
  'system.pdbRaeumen': async () => system.pdbRaeumen(),
  'system.diagnoseExport': async () => system.diagnoseBericht(),
  'notify.list': async () => ({ liste: require('./notify').liste() }),
  'notify.gelesen': async () => require('./notify').gelesen(),
  'notify.leeren': async () => require('./notify').leeren(),
  'notify.test': async () => require('./notify').test(),
  'audit.liste': async (data) => audit.liste(data || {}),
  'audit.leeren': async () => audit.leeren(),

  // ---------- Automatische Einrichtung aus den Originalquellen ----------
  'installer.environment': async (data) => installer.environment(data || {}),
  'installer.start': async (data) => installer.start(data || {}),
  'installer.status': async () => installer.status(),
  'installer.cancel': async () => installer.cancel(),
  'installer.openLog': async () => installer.openLog(),
  'installer.checkUpdate': async (data) => installer.checkUpdate(data || {}),
  'installer.update': async (data) => installer.update(data || {}),
  'installer.clientDataUpdate': async (data) => installer.clientDatenAktualisieren(data || {}),
  'installer.quelleReparieren': async (data) => installer.quelleReparieren(data || {}),

  // ---------- Protokolle des Servers ----------
  'installer.protokolle': async () => {
    const root = (store.read().server || {}).rootDir || ''
    const ordner = path.join(root, 'logs')
    const liste = []
    if (root && fs.existsSync(ordner)) {
      for (const f of fs.readdirSync(ordner)) {
        if (!(/^(installation|update|client-data|DBImport|uebernahme).*\.log$/i.test(f) || /\.dmp$/i.test(f))) continue
        const voll = path.join(ordner, f)
        const st = fs.statSync(voll)
        liste.push({ name: f, pfad: voll, groesseKb: Math.round(st.size / 1024), geaendert: st.mtimeMs, quelle: 'server' })
      }
    }
    /*
     * Panel-eigenes Fehlerprotokoll mit anzeigen: Main-Prozess-Fehler
     * (uncaughtException/Rejection) landen im userData-Ordner, nicht im
     * Server-Logordner - ohne diesen Eintrag wären sie unauffindbar.
     */
    try {
      const panelLog = path.join(require('electron').app.getPath('userData'), 'panel-fehler.log')
      if (fs.existsSync(panelLog)) {
        const st = fs.statSync(panelLog)
        liste.push({ name: 'panel-fehler.log', pfad: panelLog, groesseKb: Math.round(st.size / 1024), geaendert: st.mtimeMs, quelle: 'panel' })
      }
    } catch (_) {}
    liste.sort((a, b) => b.geaendert - a.geaendert)
    return { ok: true, liste: liste.slice(0, 40) }
  },
  'installer.protokollOeffnen': async ({ pfad } = {}) => {
    const root = path.resolve((store.read().server || {}).rootDir || '')
    const ziel = path.resolve(String(pfad || ''))
    // Nur Dateien aus dem Server-Logordner oder dem Panel-UserData-Ordner dürfen aufgehen.
    const erlaubt = [
      path.join(root, 'logs'),
      (() => { try { return path.resolve(require('electron').app.getPath('userData')) } catch (_) { return '' } })()
    ].filter(Boolean)
    if (!erlaubt.includes(path.dirname(ziel))) {
      throw new Error('Diese Datei liegt nicht in einem erlaubten Protokoll-Ordner.')
    }
    const { shell } = require('electron')
    const fehler = await shell.openPath(ziel)
    if (fehler) throw new Error(fehler)
    return { ok: true }
  },

  // ---------- Sicherung der Datenbank ----------
  'backup.status': async () => backup.status(),
  'backup.list': async () => backup.list(),
  'backup.create': async () => backup.create(),
  'backup.restore': async (data) => backup.restore(data || {}),
  'backup.remove': async (data) => backup.remove(data || {}),
  'backup.openFolder': async () => backup.ordnerOeffnen(),
  'backup.prune': async (data) => ({ ok: true, removed: backup.aufraeumen((data || {}).keep) }),
  'backup.plan': async () => backup.plan(),
  'backup.saveSettings': async (data) => backup.einstellungenSetzen((data || {}).auto || data || {}),
  'backup.runNow': async () => backup.automatischSichern(),
  'backup.verify': async (data) => backup.verify(data || {}),
  'backup.spiegelSetzen': async (data) => backup.spiegelSetzen(data || {}),

  // ---------- Nachts-Wartung ----------
  'maintenance.get': async () => maintenance.plan(),
  'maintenance.saveSettings': async (data) => maintenance.einstellungenSetzen(data || {}),
  'maintenance.runNow': async () => maintenance.ausfuehren(),
  'maintenance.restartNow': async () => maintenance.weltserverNeustarten(),
  'maintenance.dbWartungJetzt': async () => maintenance.dbWarten(),
  'maintenance.dbPruefenJetzt': async () => maintenance.dbPruefen(),

  // ---------- Serverprofile ----------
  'profile.list': async () => ({ liste: profile.liste(), aktiv: profile.aktiverName() }),
  'profile.speichern': async (data) => profile.speichern(data || {}),
  'profile.loeschen': async (data) => profile.loeschen(data || {}),
  'profile.aktivieren': async (data) => profile.aktivieren(data || {}),

  // ---------- SOAP / Konsole ----------
  'soap.send': async ({ command }) => {
    if (!command || !String(command).trim()) throw new Error('Leerer Befehl.')
    return soap.send(String(command).trim())
  },
  'soap.zugangNeuSetzen': async () => soap.zugangNeuSetzen(),

  // ---------- Realms ----------
  'realms.list': async () => realms.listRealms(),
  'realms.create': async (data) => realms.createRealm(data),
  'realms.update': async (data) => realms.updateRealm(data),
  'realms.delete': async ({ id }) => realms.deleteRealm(id),
  // Wartungsmodus: realmlist OFFLINE-Bit setzen/entfernen (+ Auth-Neustart)
  'realms.wartung': async (data) => realms.wartung(data || {}),

  // ---------- Charaktere ----------
  'characters.list': async (params) => characters.listCharacters(params || {}),
  'characters.count': async (params) => characters.countCharacters(params || {}),
  'characters.itemNamen': async (data) => characters.itemNamen(data || {}),
  'characters.get': async ({ guid }) => characters.getCharacter(guid),
  'characters.update': async ({ guid, patch }) => characters.updateCharacter(guid, patch),
  'characters.rename': async (data) => characters.renameCharacter(data.guid, data.name),
  'characters.resetTalents': async ({ guid }) => characters.resetTalents(guid),
  'characters.delete': async (data) => characters.deleteCharacter(
    (data && data.guid !== undefined ? data : {}).guid,
    { bestaetigt: Boolean(data && data.bestaetigt) }
  ),
  'characters.deletePreview': async ({ guid }) => characters.deletePreview(guid),
  'characters.teleport': async (data) => characters.teleport(data || {}),
  'characters.maps': async () => characters.maps(),
  'characters.postfach': async ({ guid }) => characters.postfach(guid),

  // ---------- Gilden und Wirtschaft (nur lesend) ----------
  'guilds.liste': async (data) => guilds.liste(data || {}),
  'guilds.detail': async (data) => guilds.detail(data || {}),
  'wirtschaft.uebersicht': async () => wirtschaft.uebersicht(),

  // ---------- Systemverlauf (RAM, CPU, DB-Groesse, Plattenplatz) ----------
  'systemverlauf.get': async () => systemverlauf.uebersicht(),

  // ---------- Module ----------
  'modules.list': async () => moduleApi.list(),
  'modules.read': async (data) => moduleApi.read(data || {}),
  'modules.save': async (data) => moduleApi.save(data || {}),
  'modules.reset': async (data) => moduleApi.zuruecksetzen(data || {}),
  // Versionierte Sicherungen eines Moduls: auflisten und zurueckspielen.
  'modules.sicherungen': async (data) => moduleApi.sicherungenListen(data || {}),
  'modules.sicherungZurueckspielen': async (data) => moduleApi.sicherungZurueckspielen(data || {}),
  'modules.installieren': async (data) => moduleApi.installieren(data || {}),
  'modules.mehrfachInstallieren': async (data) => moduleApi.mehrfachInstallieren(data || {}),
  'modules.vorpruefen': async (data) => moduleApi.vorpruefen(data || {}),
  'modules.konfigurationNachziehen': async (data) => moduleApi.konfigurationNachziehen(data || {}),
  'modules.aktualisieren': async (data) => moduleApi.aktualisieren(data || {}),
  'modules.pruefen': async (data) => moduleApi.pruefen(data || {}),
  'modules.entfernen': async (data) => moduleApi.entfernen(data || {}),
  'modules.installierte': async () => moduleApi.installierte(),
  'modules.sqlEinspielen': async (data) => moduleApi.sqlEinspielen(data || {}),

  // ---------- Accounts ----------
  'accounts.list': async (params) => accounts.listAccounts(params || {}),
  'accounts.page': async (params) => accounts.listAccountsPage(params || {}),
  'accounts.create': async (data) => accounts.createAccount(data),
  'accounts.bulkPasswortReset': async (data) => accounts.bulkPasswortReset(data || {}),

  // Vorab-Zählung für die Bulk-Reset-Karte (Konten ohne SRP6-Passwort)
  'accounts.ohneSrp6Anzahl': async () => accounts.ohneSrp6Anzahl(),

  // Bot-Präfix-Test: welche Konten gelten nach den eingestellten Präfixen als Bot?
  'accounts.botPraefixTest': async () => accounts.botPraefixTest(),
  'accounts.setPassword': async (data) => accounts.setPassword(data),
  'accounts.setGmLevel': async (data) => accounts.setGmLevel(data),
  'accounts.setEmail': async (data) => accounts.setEmail(data),
  'accounts.delete': async ({ id }) => accounts.deleteAccount(id),
  'accounts.setLocked': async (data) => accounts.setLocked(data || {}),

  // ---------- Support-Tickets ----------
  'tickets.liste': async (data) => tickets.liste(data || {}),
  'tickets.gmCharaktere': async () => tickets.gmCharaktere(),
  'tickets.antworten': async (data) => tickets.antworten(data || {}),
  'tickets.kommentar': async (data) => tickets.kommentar(data || {}),
  'tickets.zuweisen': async (data) => tickets.zuweisen(data || {}),
  'tickets.schliessen': async (data) => tickets.schliessen(data || {}),
  'tickets.oeffnen': async (data) => tickets.oeffnen(data || {}),

  // ---------- Kontosicherheit ----------
  'security.uebersicht': async () => security.uebersicht(),

  // ---------- Datenbank-Konsole (nur lesend) ----------
  'sql.ausfuehren': async (data) => sqlkonsole.ausfuehren(data || {}),
  'sql.verlauf': async () => ({ liste: sqlkonsole.verlauf() }),
  'sql.verlaufLeeren': async () => sqlkonsole.verlaufLeeren(),

  // ---------- Online-Verlauf ----------
  'statistik.get': async () => statistik.uebersicht(),

  // ---------- Log-Archiv ----------
  'logs.dateien': async () => logarchiv.dateien(),
  'logs.suche': async (data) => logarchiv.suche(data || {}),

  // ---------- Bans ----------
  'bans.list': async () => bans.listBans(),
  'bans.page': async (data) => bans.listBansPage(data || {}),
  'bans.unbanAccount': async ({ account }) => bans.unbanAccount(account),
  'bans.unbanIp': async ({ id }) => bans.unbanIp(id),
  'bans.banAccount': async (data) => bans.banAccount(data),
  'bans.banIp': async (data) => bans.banIp(data),
  // Abgelaufene Bans entfernen
  'bans.aufraeumen': async () => bans.aufraeumen(),

  // ---------- Online ----------
  'online.list': async (data) => online.listOnline({ includeBots: !data || data.includeBots !== false }),
  'dashboard.stats': async () => online.dashboard(),

  // ---------- Datenbank-Werkzeuge ----------
  // Groessen je Datenbank aus information_schema - zeigt, wie Backups,
  // Logs und die Welt-DB die Platte fuellen.
  'db.groessen': async () => {
    const m = store.read().mysql || {}
    const dbs = [m.authDb, m.charDb, m.worldDb, 'acore_playerbots'].filter(Boolean)
    if (!dbs.length) return { ok: false, error: 'Keine Datenbanknamen in den Einstellungen.' }
    const rows = await db.query('auth',
      'SELECT table_schema AS name, ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb FROM information_schema.tables GROUP BY table_schema'
    )
    return { ok: true, groessen: rows.filter(r => dbs.includes(r.name)) }
  },

  // ---------- GM-Werkzeuge ----------
  'gm.items': async ({ search }) => gm.lookupItems(search),
  'gm.creatures': async ({ search }) => gm.lookupCreatures(search),
  'gm.gameobjects': async ({ search }) => gm.lookupGameObjects(search),
  'gm.sendItem': async (data) => gm.sendItem(data),
  'gm.deleteItem': async (data) => gm.deleteItem(data)
}

/* ------------------------------------------------- Aktionsprotokoll */

/*
 * Welche Routen landen im Aktionsprotokoll? Nur Aktionen, die etwas
 * veraendern - keine Leseabfragen und keine Statusabfragen. Die Werte sind
 * [Bereich, Aktionsschluessel]; der Schluessel wird in der Oberflaeche
 * uebersetzt.
 */
const AUDIT_ROUTES = {
  'accounts.create': ['accounts', 'accountCreate'],
  'accounts.delete': ['accounts', 'accountDelete'],
  'accounts.setPassword': ['accounts', 'accountPassword'],
  'accounts.setGmLevel': ['accounts', 'accountGmLevel'],
  'accounts.setEmail': ['accounts', 'accountEmail'],
  'accounts.bulkPasswortReset': ['accounts', 'accountBulkPassword'],
  'accounts.setLocked': ['accounts', 'accountLock'],
  'tickets.antworten': ['tickets', 'ticketReply'],
  'tickets.kommentar': ['tickets', 'ticketComment'],
  'tickets.zuweisen': ['tickets', 'ticketAssign'],
  'tickets.schliessen': ['tickets', 'ticketClose'],
  'tickets.oeffnen': ['tickets', 'ticketReopen'],
  'characters.update': ['characters', 'characterUpdate'],
  'characters.rename': ['characters', 'characterRename'],
  'characters.resetTalents': ['characters', 'characterTalents'],
  'characters.delete': ['characters', 'characterDelete'],
  'characters.teleport': ['characters', 'characterTeleport'],
  'bans.banAccount': ['bans', 'banAccount'],
  'bans.unbanAccount': ['bans', 'unbanAccount'],
  'bans.banIp': ['bans', 'banIp'],
  'bans.unbanIp': ['bans', 'unbanIp'],
  'bans.aufraeumen': ['bans', 'banCleanup'],
  'server.start': ['server', 'serverStart'],
  'server.stop': ['server', 'serverStop'],
  'server.restart': ['server', 'serverRestart'],
  'server.startAll': ['server', 'serverStartAll'],
  'server.stopAll': ['server', 'serverStopAll'],
  'backup.create': ['backup', 'backupCreate'],
  'backup.restore': ['backup', 'backupRestore'],
  'backup.remove': ['backup', 'backupRemove'],
  'backup.verify': ['backup', 'backupVerify'],
  'backup.prune': ['backup', 'backupPrune'],
  'backup.spiegelSetzen': ['backup', 'backupMirror'],
  'modules.installieren': ['modules', 'moduleInstall'],
  'modules.mehrfachInstallieren': ['modules', 'moduleInstallMultiple'],
  'modules.konfigurationNachziehen': ['modules', 'moduleConf'],
  'modules.aktualisieren': ['modules', 'moduleUpdate'],
  'modules.entfernen': ['modules', 'moduleRemove'],
  'modules.save': ['modules', 'moduleSave'],
  'modules.reset': ['modules', 'moduleReset'],
  'modules.sqlEinspielen': ['modules', 'moduleSql'],
  'modules.sicherungZurueckspielen': ['modules', 'moduleRestore'],
  'config.save': ['config', 'configSave'],
  'config.sicherungZurueckspielen': ['config', 'configRestore'],
  'rates.save': ['rates', 'ratesSave'],
  'rates.reset': ['rates', 'ratesReset'],
  'settings.save': ['settings', 'settingsSave'],
  'gm.sendItem': ['gm', 'gmSendItem'],
  'gm.deleteItem': ['gm', 'gmDeleteItem'],
  'installer.update': ['installer', 'installerUpdate'],
  'installer.checkUpdate': ['installer', 'installerCheck'],
  'installer.quelleReparieren': ['installer', 'installerRepair'],
  'installer.clientDataUpdate': ['installer', 'installerClientData'],
  'realms.create': ['realms', 'realmCreate'],
  'realms.update': ['realms', 'realmUpdate'],
  'realms.delete': ['realms', 'realmDelete'],
  'realms.wartung': ['realms', 'realmMaintenance'],
  'mysql.serviceAction': ['server', 'mysqlService'],
  'maintenance.runNow': ['maintenance', 'maintenanceRun'],
  'maintenance.restartNow': ['maintenance', 'maintenanceRestart'],
  'maintenance.dbWartungJetzt': ['maintenance', 'dbOptimize'],
  'maintenance.dbPruefenJetzt': ['maintenance', 'dbCheck'],
  'sql.ausfuehren': ['sql', 'sqlQuery']
}

/*
 * Kurzdetail fuer das Protokoll. Nur unverfaengliche Felder - niemals
 * Passwoerter oder Zugangsdaten. Arrays und Objekte werden zu Zahlen
 * zusammengefasst, damit kein kompletter Konfigurationsinhalt im
 * Protokoll landet.
 */
function auditDetails (payload) {
  if (!payload || typeof payload !== 'object') return ''
  const teile = []
  for (const key of ['username', 'name', 'account', 'id', 'guid', 'entry', 'ip', 'stamp', 'file', 'kind', 'pfad', 'modul']) {
    const wert = payload[key]
    if (wert === undefined || wert === null || wert === '' || typeof wert === 'object') continue
    teile.push(`${key}=${String(wert).slice(0, 80)}`)
  }
  if (Array.isArray(payload.entries)) teile.push(`${payload.entries.length} Werte`)
  if (Array.isArray(payload.ids)) teile.push(`${payload.ids.length} Einträge`)
  if (Array.isArray(payload.urls)) teile.push(`${payload.urls.length} URLs`)
  if (Array.isArray(payload.dbs)) teile.push(`${payload.dbs.length} Datenbanken`)
  if (payload.patch && typeof payload.patch === 'object') teile.push(`${Object.keys(payload.patch).length} Felder`)
  if (typeof payload.command === 'string') teile.push(payload.command.slice(0, 100))
  if (typeof payload.sql === 'string') teile.push(payload.sql.replace(/\s+/g, ' ').slice(0, 140))
  return teile.join(' · ').slice(0, 300)
}

function registerRoutes (route, payload) {
  const handler = routes[route]
  if (!handler) {
    return Promise.reject(new Error(`Unbekannte Route: ${route}`))
  }
  const eintrag = AUDIT_ROUTES[route]
  if (!eintrag) return Promise.resolve(handler(payload))
  const [bereich, aktion] = eintrag
  const basis = auditDetails(payload)
  return Promise.resolve()
    .then(() => handler(payload))
    .then(ergebnis => {
      // Manche Routen melden Fehler im Ergebnis statt per Exception.
      const fehler = ergebnis && ergebnis.ok === false
      audit.protokolliere(bereich, aktion, {
        details: [basis, fehler ? (ergebnis.error || 'fehlgeschlagen') : ''].filter(Boolean).join(' · '),
        ok: !fehler
      })
      return ergebnis
    })
    .catch(fehler => {
      audit.protokolliere(bereich, aktion, {
        details: [basis, fehler && fehler.message ? fehler.message : String(fehler)].filter(Boolean).join(' · '),
        ok: false
      })
      throw fehler
    })
}

module.exports = { registerRoutes, routes }