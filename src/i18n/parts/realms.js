// Seitenname: Realms (src/pages/Realms.jsx)
export default {
  de: {
    realms: {
      saved: 'Realm gespeichert.',
      deleteConfirm: 'Realm „{name}" wirklich löschen?\n\nDas betrifft nur den Eintrag in der Client-Liste, die Datenbank bleibt erhalten.',
      deleted: 'Realm gelöscht.',
      loading: 'Lade Realms…',
      title: 'Realms ({count})',
      create: '+ Realm anlegen',
      empty: 'Keine Realms eingetragen.',

      // ----- Tabelle -----
      name: 'Name',
      address: 'Adresse',
      timezone: 'Zeitzone',
      access: 'Zugriff',
      status: 'Status',
      wartungAn: 'Offline',
      wartungAus: 'Online',
      wartungStarten: 'Wartungsmodus an',
      wartungBeenden: 'Wartungsmodus aus',
      wartungAnFrage: 'Realm "{name}" in den Wartungsmodus schalten? Der Authserver wird neu gestartet (neue Logins pausieren kurz).',
      wartungAusFrage: 'Wartungsmodus für "{name}" beenden? Der Authserver wird neu gestartet.',
      wartungDone: 'Realm "{name}": Wartungsmodus geändert. {auth}',
      wartungAuth: 'Authserver neu gestartet.',
      edit: 'Bearbeiten',
      delete: 'Löschen',

      // ----- Hinweisbox -----
      clientNote1: 'Der Client findet diese Liste über den Login-Server. Nach Änderungen den Client unter',
      clientNote2: 'aktualisieren, damit er den Realm sieht.',

      // ----- Dialog -----
      editTitle: 'Realm bearbeiten',
      createTitle: 'Realm anlegen',
      cancel: 'Abbrechen',
      save: 'Speichern',
      addressLabel: 'Adresse (IP oder Hostname)',
      port: 'Port',
      iconId: 'Icon-ID (0-5)',
      population: 'Einwohnerart',
      popEmpty: 'Leer',
      popLow: 'Niedrig',
      popMid: 'Mittel',
      popHigh: 'Hoch',
      popFull: 'Volle Welt',
      securityLevel: 'Zugriffsebene',
      securityOpen: 'Offen',
      securityWowAccounts: 'Gesperrt für WoW-Accounts',
      securityWowAndPvp: 'Gesperrt für WoW + WoWL',
      securityAll: 'Gesperrt für alle'
    }
  },
  en: {
    realms: {
      saved: 'Realm saved.',
      deleteConfirm: 'Really delete realm „{name}"?\n\nThis only affects the entry in the client list, the database is kept.',
      deleted: 'Realm deleted.',
      loading: 'Loading realms…',
      title: 'Realms ({count})',
      create: '+ Add realm',
      empty: 'No realms entered.',

      // ----- Table -----
      name: 'Name',
      address: 'Address',
      timezone: 'Timezone',
      access: 'Access',
      status: 'Status',
      wartungAn: 'Offline',
      wartungAus: 'Online',
      wartungStarten: 'Enable maintenance mode',
      wartungBeenden: 'Disable maintenance mode',
      wartungAnFrage: 'Put realm "{name}" into maintenance mode? The auth server restarts (new logins pause briefly).',
      wartungAusFrage: 'End maintenance mode for "{name}"? The auth server restarts.',
      wartungDone: 'Realm "{name}": maintenance mode changed. {auth}',
      wartungAuth: 'Auth server restarted.',
      edit: 'Edit',
      delete: 'Delete',

      // ----- Info box -----
      clientNote1: 'The client gets this list from the login server. After changes, update the client at',
      clientNote2: 'so that it sees the realm.',

      // ----- Modal -----
      editTitle: 'Edit realm',
      createTitle: 'Add realm',
      cancel: 'Cancel',
      save: 'Save',
      addressLabel: 'Address (IP or hostname)',
      port: 'Port',
      iconId: 'Icon ID (0-5)',
      population: 'Population type',
      popEmpty: 'Empty',
      popLow: 'Low',
      popMid: 'Medium',
      popHigh: 'High',
      popFull: 'Full world',
      securityLevel: 'Access level',
      securityOpen: 'Open',
      securityWowAccounts: 'Locked for WoW accounts',
      securityWowAndPvp: 'Locked for WoW + WoWL',
      securityAll: 'Locked for all'
    }
  }
}