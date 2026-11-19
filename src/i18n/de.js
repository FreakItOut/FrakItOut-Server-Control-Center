// Deutsche Texte. Schluessel muessen mit en.js und mit den t('...')-Aufrufen
// uebereinstimmen. Reihenfolge hier = Reihenfolge der Anzeige.
export default {
  // ---------- Rahmen ----------
  app: {
    title: 'FrakItOut Server Control Center für Azeroth-Core',
    notFound: 'Seite nicht gefunden.',
    setupCheck: 'Einrichtung wird geprüft …',
    status: {
      emulator: 'Emulator:',
      auth: 'Authserver:',
      db: 'Datenbank:',
      accounts: 'Accounts:',
      characters: 'Charaktere:',
      online: 'Online:',
      on: 'Online',
      off: 'Offline',
      starting: 'Startet …',
      coreWarning: '„AzerothCore" NICHT „TrinityCore" — Config nach jedem Core-Update sichern.',
      ready: 'Bereit. Server über „Server Start / Stop" starten.'
    },
    chips: {
      world: 'Worldserver',
      auth: 'Authserver',
      db: 'Datenbank'
    },
    language: {
      label: 'Sprache',
      de: 'Deutsch',
      en: 'English'
    }
  },

  // ---------- Navigation ----------
  nav: {
    server: 'Server Start / Stop',
    console: 'Konsolen Befehl',
    settings: 'Connect Optionen',
    accounts: 'Acc erstellen',
    characters: 'Charaktere',
    bots: 'Bot Anzahl',
    rates: 'Server Raten',
    modules: 'Module',
    bans: 'Bans',
    realms: 'Realms',
    online: 'Spieler Optionen',
    tickets: 'Support-Tickets',
    guilds: 'Gilden',
    wirtschaft: 'Wirtschaft',
    gm: 'Zeige GM Kommandos',
    config: 'Konfiguration',
    backup: 'Datenbank Backup',
    options: 'Einstellungen',
    werkzeuge: 'Werkzeuge',
    protokoll: 'Aktionsprotokoll',
    hilfe: 'Hilfe',
    dashboard: 'Übersicht',
    search: 'Seite suchen …',
    noResults: 'Keine Seite gefunden.',
    favorites: 'Favoriten',
    favorite: 'Anheften',
    unfavorite: 'Lösen',
    collapse: 'Leiste einklappen',
    expand: 'Leiste ausklappen',
    group: {
      operations: 'Betrieb',
      players: 'Spieler & Konten',
      server: 'Server',
      system: 'System'
    }
  },

  palette: {
    title: 'Befehlspalette',
    placeholder: 'Seite oder Aktion suchen …',
    empty: 'Nichts gefunden.',
    pages: 'Seite',
    actions: 'Aktion',
    account: 'Konto',
    character: 'Charakter',
    item: 'Item',
    creature: 'NPC',
    startAll: 'Server starten (alles)',
    stopAll: 'Server stoppen (alles)',
    stopConfirm: 'Wirklich alle Server und die Datenbank beenden?',
    backup: 'Backup jetzt erstellen',
    started: 'Server werden gestartet.',
    stopped: 'Server werden beendet.',
    backupDone: 'Sicherung {stamp} erstellt.',
    navigate: 'wählen',
    run: 'ausführen'
  },

  notify: {
    title: 'Meldungen',
    empty: 'Keine Meldungen.',
    all: 'Alle',
    unread: 'Ungelesen',
    clear: 'Leeren',
    markRead: 'Gelesen',
    noUnread: 'Keine ungelesenen Meldungen.'
  },

  // ---------- Seitentitel ----------
  page: {
    '/': ['Übersicht', 'Serverstatus und Kennzahlen im Blick'],
    '/server': ['Server Start / Stop', 'World- und Authserver starten, stoppen, Protokoll'],
    '/realms': ['Realms', 'Realm-Einträge in der Auth-Datenbank'],
    '/characters': ['Charaktere', 'Alle Charaktere der Characters-Datenbank'],
    '/accounts': ['Acc erstellen / Account', 'Accounts anlegen, Passwort und GM-Level ändern'],
    '/bots': ['Bot Anzahl', 'Anzahl der PlayerBots einstellen'],
    '/rates': ['Server Raten', 'Loot, Quests, Ruf und Cooldowns beschleunigen'],
  '/modules': ['Module', 'Einstellungen der Module, die AzerothCore aus configs/modules lädt'],
    '/bans': ['Bans', 'Account- und IP-Sperren'],
    '/online': ['Spieler Optionen', 'Aktuell eingeloggte Spieler'],
    '/tickets': ['Support-Tickets', 'Anliegen der Spieler bearbeiten'],
    '/guilds': ['Gilden', 'Mitglieder, Leiter und Gildenbank'],
    '/wirtschaft': ['Wirtschaft', 'Gold, Auktionen und Post im Überblick'],
    '/gm': ['GM Kommandos', 'Items, NPCs und Objekte suchen und verteilen'],
    '/console': ['Konsolen Befehl', 'Befehle über SOAP an den Worldserver senden'],
    '/config': ['Konfiguration', 'worldserver.conf und authserver.conf bearbeiten'],
    '/backup': ['Datenbank Backup', 'Datenbank sichern und wiederherstellen'],
    '/settings': ['Connect Optionen', 'IP-Adresse, unter der Spieler den Server erreichen'],
    '/options': ['Einstellungen', 'Datenbank, Server-Pfade und SOAP-Zugang'],
    '/werkzeuge': ['Werkzeuge', 'Kontosicherheit, Datenbank-Konsole und Log-Archiv'],
    '/protokoll': ['Aktionsprotokoll', 'Wer hat im Panel was ausgelöst – und mit welchem Ergebnis'],
    '/hilfe': ['Hilfe', 'Die Kernworkflows in Kurzform']
  },

  common: {
    save: 'Speichern',
    cancel: 'Abbrechen',
    close: 'Schließen',
    delete: 'Löschen',
    edit: 'Ändern',
    refresh: 'Aktualisieren',
    search: 'Suchen…',
    loading: 'Lädt…',
    empty: 'Keine Einträge vorhanden.',
    yes: 'Ja',
    no: 'Nein',
    none: '—',
    name: 'Name',
    value: 'Wert',
    status: 'Status',
    actions: 'Aktionen'
  }
}