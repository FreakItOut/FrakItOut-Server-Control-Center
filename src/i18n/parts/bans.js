// Seitenname: Bans (src/pages/Bans.jsx)
export default {
  de: {
    bans: {
      // ----- Dauer -----
      permanent: 'dauerhaft',
      days: '{count} Tag(e)',
      hours: '{count} Stunde(n)',

      // ----- Meldungen -----
      unbanned: 'Sperre aufgehoben.',
      ipRemoved: 'IP-Sperre entfernt.',
      ipBanned: 'IP {ip} gesperrt.',

      // ----- Reiter -----
      tabAccounts: 'Account-Sperren ({count})',
      search: 'Account, IP oder Grund suchen …',
      onlyActive: 'nur aktive',
      count: '{n} Einträge',
      pageOf: 'Seite {page} von {pages}',
      back: 'Zurück',
      next: 'Weiter',
      tabIps: 'IP-Sperren ({count})',
      loading: 'Lade…',

      // ----- Account-Sperren -----
      accountsHeading: 'Account-Sperren',
      emptyAccounts: 'Keine Sperren vorhanden.',
      reason: 'Grund',
      duration: 'Dauer',
      by: 'Von',
      date: 'Datum',
      status: 'Status',
      badgeActive: 'aktiv',
      badgeLifted: 'aufgehoben',
      revoke: 'Aufheben',
      cleanup: 'abgelaufene aufräumen',
      cleanupConfirm: 'Abgelaufene Bans endgültig aus der Tabelle entfernen?',
      cleanupDone: '{n} abgelaufene Bans entfernt.',
      grundCheat: 'Cheat',
      grundWerbung: 'Werbung',
      grundBeleidigung: 'Beleidigung',
      grundBot: 'Bot-Konto',

      // ----- IP sperren -----
      ipBlockHeading: 'IP sperren',
      ipAddress: 'IP-Adresse',
      ipPlaceholder: 'z.B. 192.168.1.50',
      daysLabel: 'Tage (0 = dauerhaft)',
      ipBlock: 'IP sperren',
      ipBlockTitle: 'IP-Adresse sperren?',
      ipBlockText: 'Diese Adresse wird für die angegebene Dauer gesperrt. Eine Sperre wirkt auf alle, die sich mit dieser Adresse anmelden.',
      ipBlockConfirm: 'Sperren',
      ipBlockDuration: 'Dauer: {duration}',
      ipUnblockTitle: 'IP-Sperre aufheben?',
      ipUnblockText: 'Diese Adresse wird wieder freigegeben.',
      ipUnblockConfirm: 'Sperre aufheben',
      abort: 'Abbrechen',

      // ----- IP-Sperren -----
      ipListHeading: 'IP-Sperren ({count})',
      emptyIps: 'Keine IP-Sperren vorhanden.',
      remove: 'Entfernen'
    }
  },
  en: {
    bans: {
      // ----- Duration -----
      permanent: 'permanent',
      days: '{count} day(s)',
      hours: '{count} hour(s)',

      // ----- Notifications -----
      unbanned: 'Ban lifted.',
      ipRemoved: 'IP ban removed.',
      ipBanned: 'IP {ip} banned.',

      // ----- Tabs -----
      tabAccounts: 'Account bans ({count})',
      search: 'Search account, IP or reason …',
      onlyActive: 'active only',
      count: '{n} entries',
      pageOf: 'Page {page} of {pages}',
      back: 'Back',
      next: 'Next',
      tabIps: 'IP bans ({count})',
      loading: 'Loading…',

      // ----- Account bans -----
      accountsHeading: 'Account bans',
      emptyAccounts: 'No bans found.',
      reason: 'Reason',
      duration: 'Duration',
      by: 'By',
      date: 'Date',
      status: 'Status',
      badgeActive: 'active',
      badgeLifted: 'lifted',
      revoke: 'Lift',
      cleanup: 'clean up expired',
      cleanupConfirm: 'Permanently remove expired bans from the table?',
      cleanupDone: '{n} expired bans removed.',
      grundCheat: 'Cheating',
      grundWerbung: 'Advertising',
      grundBeleidigung: 'Insult',
      grundBot: 'Bot account',

      // ----- Ban an IP -----
      ipBlockHeading: 'Ban IP',
      ipAddress: 'IP address',
      ipPlaceholder: 'e.g. 192.168.1.50',
      daysLabel: 'Days (0 = permanent)',
      ipBlock: 'Ban IP',
      ipBlockTitle: 'Ban IP address?',
      ipBlockText: 'This address will be banned for the given period. An IP ban affects everyone who connects with that address.',
      ipBlockConfirm: 'Ban',
      ipBlockDuration: 'Duration: {duration}',
      ipUnblockTitle: 'Lift IP ban?',
      ipUnblockText: 'This address will be allowed again.',
      ipUnblockConfirm: 'Lift ban',
      abort: 'Cancel',

      // ----- IP bans -----
      ipListHeading: 'IP bans ({count})',
      emptyIps: 'No IP bans found.',
      remove: 'Remove'
    }
  }
}