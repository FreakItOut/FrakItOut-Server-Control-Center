// English texts. Keys must match de.js and the t('...') call sites.
export default {
  // ---------- Frame ----------
  app: {
    title: 'FrakItOut Server Control Center for Azeroth-Core',
    notFound: 'Page not found.',
    status: {
      emulator: 'Emulator:',
      auth: 'Authserver:',
      db: 'Database:',
      accounts: 'Accounts:',
      characters: 'Characters:',
      online: 'Online:',
      on: 'Online',
      off: 'Offline',
      starting: 'Starting …',
      coreWarning: 'Use „AzerothCore", not „TrinityCore" — back up the config after every core update.',
      ready: 'Ready. Start the server via „Server Start / Stop".'
    },
    chips: {
      world: 'Worldserver',
      auth: 'Authserver',
      db: 'Database'
    },
    language: {
      label: 'Language',
      de: 'German',
      en: 'English'
    }
  },

  // ---------- Navigation ----------
  nav: {
    server: 'Server Start / Stop',
    console: 'Console Command',
    settings: 'Connect Options',
    accounts: 'Create Account',
    characters: 'Characters',
    bots: 'Bot Count',
    rates: 'Server Rates',
    modules: 'Modules',
    bans: 'Bans',
    realms: 'Realms',
    online: 'Player Options',
    tickets: 'Support tickets',
    guilds: 'Guilds',
    wirtschaft: 'Economy',
    gm: 'Show GM Commands',
    config: 'Configuration',
    backup: 'Database Backup',
    options: 'Settings',
    werkzeuge: 'Tools',
    protokoll: 'Action log',
    hilfe: 'Help',
    dashboard: 'Overview',
    search: 'Search pages …',
    noResults: 'No page found.',
    favorites: 'Favorites',
    favorite: 'Pin',
    unfavorite: 'Unpin',
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    group: {
      operations: 'Operations',
      players: 'Players & accounts',
      server: 'Server',
      system: 'System'
    }
  },

  palette: {
    title: 'Command palette',
    placeholder: 'Search page or action …',
    empty: 'Nothing found.',
    pages: 'Page',
    actions: 'Action',
    account: 'Account',
    character: 'Character',
    item: 'Item',
    creature: 'NPC',
    startAll: 'Start servers (all)',
    stopAll: 'Stop servers (all)',
    stopConfirm: 'Really stop all servers and the database?',
    backup: 'Create backup now',
    started: 'Servers are starting.',
    stopped: 'Servers are stopping.',
    backupDone: 'Backup {stamp} created.',
    navigate: 'select',
    run: 'run'
  },

  notify: {
    title: 'Notifications',
    empty: 'No notifications.',
    all: 'All',
    unread: 'Unread',
    clear: 'Clear',
    markRead: 'Read',
    noUnread: 'No unread notifications.'
  },

  // ---------- Page titles ----------
  page: {
    '/': ['Overview', 'Server status and key figures at a glance'],
    '/server': ['Server Start / Stop', 'Start and stop world and auth server, protocol'],
    '/realms': ['Realms', 'Realm entries in the auth database'],
    '/characters': ['Characters', 'All characters of the characters database'],
    '/accounts': ['Create Account / Account', 'Create accounts, change password and GM level'],
    '/bots': ['Bot Count', 'Set the number of player bots'],
    '/rates': ['Server Rates', 'Speed up loot, quests, reputation and cooldowns'],
    '/modules': ['Modules', 'Settings of the modules AzerothCore loads from configs/modules'],
    '/bans': ['Bans', 'Account and IP bans'],
    '/online': ['Player Options', 'Currently logged-in players'],
    '/tickets': ['Support tickets', 'Handle player requests'],
    '/guilds': ['Guilds', 'Members, leader and guild bank'],
    '/wirtschaft': ['Economy', 'Gold, auctions and mail at a glance'],
    '/gm': ['GM Commands', 'Search for and distribute items, NPCs and objects'],
    '/console': ['Console Command', 'Send commands to the world server via SOAP'],
    '/config': ['Configuration', 'Edit worldserver.conf and authserver.conf'],
    '/backup': ['Database Backup', 'Back up and restore the database'],
    '/settings': ['Connect Options', 'IP address at which players reach the server'],
    '/options': ['Settings', 'Database, server paths and SOAP access'],
    '/werkzeuge': ['Tools', 'Account security, database console and log archive'],
    '/protokoll': ['Action log', 'What was triggered in the panel – and with what result'],
    '/hilfe': ['Help', 'The core workflows in short form']
  },

  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    refresh: 'Refresh',
    search: 'Search…',
    loading: 'Loading…',
    empty: 'No entries found.',
    yes: 'Yes',
    no: 'No',
    none: '—',
    name: 'Name',
    value: 'Value',
    status: 'Status',
    actions: 'Actions'
  }
}