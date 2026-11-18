const hasBridge = () => typeof window !== 'undefined' && window.api && typeof window.api.call === 'function'

const call = async (route, payload) => {
  if (!hasBridge()) {
    throw new Error(
      'Keine Verbindung zum Electron-Backend. Diese Oberfläche muss über die Electron-App gestartet werden (npm start / npm run dev).'
    )
  }
  return window.api.call(route, payload)
}

export const api = {
  settings: {
    get: () => call('settings.get'),
    save: (patch) => call('settings.save', patch),
    // Die Datei liegt ausserhalb des Panels und kann von Hand geaendert
    // werden - reload laedt sie ohne Neustart neu ein.
    reload: () => call('settings.reload'),
    filePath: () => call('settings.filePath'),
    openFile: () => call('settings.openFile'),
    testDb: (kind) => call('settings.testDb', kind),
    testAll: () => call('settings.testAll'),
    // SOAP-Verbindung direkt aus den Einstellungen testen
    testSoap: () => call('soap.send', { command: 'server info' })
  },
  maintenance: {
    get: () => call('maintenance.get'),
    save: (data) => call('maintenance.saveSettings', data),
    runNow: () => call('maintenance.runNow'),
    restartNow: () => call('maintenance.restartNow'),
    dbWartungJetzt: () => call('maintenance.dbWartungJetzt'),
    dbPruefenJetzt: () => call('maintenance.dbPruefenJetzt'),
    on: (handler) => window.api.on('maintenance:progress', handler)
  },
  profile: {
    list: () => call('profile.list'),
    speichern: (name) => call('profile.speichern', { name }),
    loeschen: (name) => call('profile.loeschen', { name }),
    aktivieren: (name) => call('profile.aktivieren', { name })
  },
  server: {
    status: () => call('server.status'),
    ereignisse: () => call('server.ereignisse'),
    startDatabase: () => call('server.startDatabase'),
    start: (kind) => call('server.start', { kind }),
    stop: (kind) => call('server.stop', { kind }),
    restart: (kind) => call('server.restart', { kind }),
    clearLogs: (kind) => call('server.clearLogs', { kind }),
    startAll: (data) => call('server.startAll', data),
    stopAll: (data) => call('server.stopAll', data),
    startAllState: () => call('server.startAllState'),
    metriken: () => call('server.metriken'),
    logOeffnen: (kind) => call('server.logOeffnen', { kind }),
    watchdog: () => call('server.watchdog'),
    watchdogSetzen: (data) => call('server.watchdogSetzen', data)
  },
  db: {
    groessen: () => call('db.groessen')
  },
  soap: {
    send: (command) => call('soap.send', { command }),
    zugangNeuSetzen: () => call('soap.zugangNeuSetzen')
  },
  realms: {
    list: () => call('realms.list'),
    create: (data) => call('realms.create', data),
    update: (data) => call('realms.update', data),
    remove: (id) => call('realms.delete', { id }),
    wartung: (data) => call('realms.wartung', data)
  },
  characters: {
    list: (params) => call('characters.list', params),
    count: (params) => call('characters.count', params),
    get: (guid) => call('characters.get', { guid }),
    itemNamen: (data) => call('characters.itemNamen', data),
    update: (guid, patch) => call('characters.update', { guid, patch }),
    rename: (guid, name) => call('characters.rename', { guid, name }),
    resetTalents: (guid) => call('characters.resetTalents', { guid }),
    teleport: (data) => call('characters.teleport', data),
    maps: () => call('characters.maps'),
    postfach: (guid) => call('characters.postfach', { guid }),
    remove: (guid) => call('characters.delete', { guid, bestaetigt: true }),
    deletePreview: (guid) => call('characters.deletePreview', { guid })
  },
  guilds: {
    liste: (data) => call('guilds.liste', data),
    detail: (data) => call('guilds.detail', data)
  },
  wirtschaft: {
    uebersicht: () => call('wirtschaft.uebersicht')
  },
  systemverlauf: {
    get: () => call('systemverlauf.get')
  },
  accounts: {
    list: (params) => call('accounts.list', params),    page: (params) => call('accounts.page', params),
    create: (data) => call('accounts.create', data),
    setPassword: (data) => call('accounts.setPassword', data),
    setGmLevel: (data) => call('accounts.setGmLevel', data),
    setEmail: (data) => call('accounts.setEmail', data),
    setLocked: (data) => call('accounts.setLocked', data),
    remove: (id) => call('accounts.delete', { id }),
    bulkPasswortReset: (data) => call('accounts.bulkPasswortReset', data),
    // Vorab-Zählung: wie viele Konten ohne SRP6-Passwort
    ohneSrp6Anzahl: () => call('accounts.ohneSrp6Anzahl'),
    botPraefixTest: () => call('accounts.botPraefixTest')
  },
  tickets: {
    liste: (data) => call('tickets.liste', data),
    gmCharaktere: () => call('tickets.gmCharaktere'),
    antworten: (data) => call('tickets.antworten', data),
    kommentar: (data) => call('tickets.kommentar', data),
    zuweisen: (data) => call('tickets.zuweisen', data),
    schliessen: (data) => call('tickets.schliessen', data),
    oeffnen: (data) => call('tickets.oeffnen', data)
  },
  security: {
    uebersicht: () => call('security.uebersicht')
  },
  sql: {
    ausfuehren: (data) => call('sql.ausfuehren', data),
    verlauf: () => call('sql.verlauf'),
    verlaufLeeren: () => call('sql.verlaufLeeren')
  },
  statistik: {
    get: () => call('statistik.get')
  },
  logs: {
    dateien: () => call('logs.dateien'),
    suche: (data) => call('logs.suche', data)
  },
  bans: {
    list: () => call('bans.list'),
    page: (data) => call('bans.page', data),
    unbanAccount: (account) => call('bans.unbanAccount', { account }),
    unbanIp: (id) => call('bans.unbanIp', { id }),
    banAccount: (data) => call('bans.banAccount', data),
    banIp: (data) => call('bans.banIp', data),
    aufraeumen: () => call('bans.aufraeumen')
  },
  online: {
    list: () => call('online.list')
  },
  dashboard: {
    stats: () => call('dashboard.stats')
  },
  // Diagnose: Build-Zustand und Absturzberichte. Eigenes Kapitel, weil
  // es nicht zur Uebersicht gehoert, sondern allgemein gilt.
  diagnose: {
    get: () => call('diagnose.get'),
    crashOrdnerOeffnen: () => call('diagnose.crashOrdnerOeffnen')
  },
  gm: {
    items: (search) => call('gm.items', { search }),
    creatures: (search) => call('gm.creatures', { search }),
    gameobjects: (search) => call('gm.gameobjects', { search }),
    sendItem: (data) => call('gm.sendItem', data),
    deleteItem: (data) => call('gm.deleteItem', data)
  },
  config: {
    available: () => call('config.available'),
    read: (file) => call('config.read', { file }),
    save: (data) => call('config.save', data),
    search: (data) => call('config.search', data),
    sicherungen: (data) => call('config.sicherungen', data),
    sicherungZurueckspielen: (data) => call('config.sicherungZurueckspielen', data)
  },
  modules: {
    list: () => call('modules.list'),
    read: (data) => call('modules.read', data),
    save: (data) => call('modules.save', data),
    reset: (data) => call('modules.reset', data),
    sicherungen: (data) => call('modules.sicherungen', data),
    sicherungZurueckspielen: (data) => call('modules.sicherungZurueckspielen', data),
    installieren: (data) => call('modules.installieren', data),
    mehrfachInstallieren: (data) => call('modules.mehrfachInstallieren', data),
    vorpruefen: (data) => call('modules.vorpruefen', data),
    konfigurationNachziehen: (data) => call('modules.konfigurationNachziehen', data),
    aktualisieren: (data) => call('modules.aktualisieren', data),
    pruefen: (data) => call('modules.pruefen', data),
    entfernen: (data) => call('modules.entfernen', data),
    installierte: () => call('modules.installierte'),
    sqlEinspielen: (data) => call('modules.sqlEinspielen', data)
  },
  bots: {
    get: () => call('bots.get'),
    save: (data) => call('bots.save', data),
    createFile: () => call('bots.createFile'),
    setFile: (data) => call('bots.setFile', data)
  },
  startAll: (data) => call('server.startAll', data),
  stopAll: (data) => call('server.stopAll', data),
  startAllState: () => call('server.startAllState'),
  system: {
    pickFile: (data) => call('system.pickFile', data),
    pickFolder: (data) => call('system.pickFolder', data),
    listConf: (dir) => call('system.listConf', { dir }),
    checkPaths: (paths) => call('system.checkPaths', { paths }),
    detectRepack: (dir) => call('system.detectRepack', { dir }),
    setupStatus: () => call('system.setupStatus'),
    suggestServerDirs: () => call('system.suggestServerDirs'),
    freierPlatz: (ziel) => call('system.freierPlatz', { ziel }),
    realmlistSetzen: (data) => call('system.realmlistSetzen', data),
    clientPruefen: (data) => call('system.clientPruefen', data),
    gesundheitscheck: () => call('system.gesundheitscheck'),
    configExport: () => call('system.configExport'),
    configImport: () => call('system.configImport'),
    lanAdresse: () => call('system.lanAdresse'),
    freundeOeffnen: (data) => call('system.freundeOeffnen', data),
    freundeSchliessen: () => call('system.freundeSchliessen'),
    spielerOnline: () => call('system.spielerOnline'),
    platzAufstellung: () => call('system.platzAufstellung'),
    downloadsRaeumen: () => call('system.downloadsRaeumen'),
    logsRaeumen: () => call('system.logsRaeumen'),
    dbGroessen: () => call('system.dbGroessen'),
    dbWartung: (data) => call('system.dbWartung', data),
    dbWartungLetzte: () => call('system.dbWartungLetzte'),
    restartNoetig: () => call('system.restartNoetig'),
    buildNoetig: () => call('system.buildNoetig'),
    pdbRaeumen: () => call('system.pdbRaeumen'),
    diagnoseExport: () => call('system.diagnoseExport'),
    auffaelligkeiten: () => call('system.auffaelligkeiten')
  },
  notify: {
    list: () => call('notify.list'),
    gelesen: () => call('notify.gelesen'),
    leeren: () => call('notify.leeren'),
    test: () => call('notify.test')
  },
  audit: {
    liste: (data) => call('audit.liste', data),
    leeren: () => call('audit.leeren')
  },
  webhook: {
    testen: () => call('webhook.testen')
  },
  // Automatische Einrichtung: Originalquellen klonen, bauen, MySQL und
  // Datenbank aufsetzen. Der Fortschritt kommt ueber 'installer:progress'.
  installer: {
    environment: (data) => call('installer.environment', data),
    start: (data) => call('installer.start', data),
    status: () => call('installer.status'),
    cancel: () => call('installer.cancel'),
    openLog: () => call('installer.openLog'),
    checkUpdate: (data) => call('installer.checkUpdate', data),
    update: (data) => call('installer.update', data),
    clientDataUpdate: (data) => call('installer.clientDataUpdate', data),
    quelleReparieren: (data) => call('installer.quelleReparieren', data),
    fremdDb: (data) => call('installer.fremdDb', data),
    migration: () => call('installer.migration'),
    migrationGesehen: () => call('installer.migrationGesehen'),
    fremdDbZaehlen: (data) => call('installer.fremdDbZaehlen', data),
    // Rückhol-Anker der Migration (Stempel der Sicherheitssicherung)
    fremdRueckholInfo: () => call('installer.fremdRueckholInfo'),
    fremdRueckholVerwerfen: () => call('installer.fremdRueckholVerwerfen'),
    // Zuletzt gewählter Fremd-Ordner - für die Vorbefüllung
    fremdLetzterOrdner: () => call('installer.fremdLetzterOrdner'),
    // Gemerktes Ergebnis der letzten Übernahme
    fremdErgebnis: () => call('installer.fremdErgebnis'),
    fremdErgebnisVerwerfen: () => call('installer.fremdErgebnisVerwerfen'),
    // Update-Verlauf (letzte Läufe)
    updateVerlauf: () => call('installer.updateVerlauf'),
    serverStand: () => call('installer.serverStand'),
    mysqlPortAendern: (data) => call('installer.mysqlPortAendern', data),
    protokolle: () => call('installer.protokolle'),
    protokollOeffnen: (pfad) => call('installer.protokollOeffnen', { pfad })
  },
  mysql: {
    services: () => call('mysql.services'),
    serviceAction: (name, action) => call('mysql.serviceAction', { name, action })
  },
  network: {
    get: () => call('network.get'),
    setRealmAddress: (data) => call('network.setRealmAddress', data),
    setConfIp: (data) => call('network.setConfIp', data)
  },
  rates: {
    get: () => call('rates.get'),
    save: (data) => call('rates.save', data),
    createDefaults: () => call('rates.createDefaults'),
    reset: (data) => call('rates.reset', data)
  },
  backup: {
    status: () => call('backup.status'),
    list: () => call('backup.list'),
    create: () => call('backup.create'),
    restore: (data) => call('backup.restore', data),
    remove: (data) => call('backup.remove', data),
    openFolder: () => call('backup.openFolder'),
    prune: (data) => call('backup.prune', data),
    plan: () => call('backup.plan'),
    saveSettings: (data) => call('backup.saveSettings', data),
    runNow: () => call('backup.runNow'),
    verify: (data) => call('backup.verify', data),
    spiegelSetzen: (data) => call('backup.spiegelSetzen', data),
    groessen: () => call('db.groessen')
  },
  // Ereignisse des Backends (z. B. Fortschritt eines Backups).
  // Gibt eine Funktion zum Abbestellen zurück; fehlt die Bruecke,
  // passiert nichts, damit die Seite auch im Browser nicht abstuerzt.
  on: (channel, handler) => {
    if (typeof window === 'undefined' || !window.api || typeof window.api.on !== 'function') {
      return () => {}
    }
    return window.api.on(channel, handler)
  }
}

export default api