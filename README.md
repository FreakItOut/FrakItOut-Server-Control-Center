<p align="center">
  <img src="public/logo.png" width="96" alt="FreakItOut logo">
</p>

<h1 align="center">FreakItOut Server Control Center</h1>

<p align="center">
  A native Windows control center for <strong>AzerothCore</strong> 3.3.5 (Wrath of the Lich King).
</p>

<p align="center">
  <a href="https://github.com/FreakItOut/FreakItOut-Server-Control-Center/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/FreakItOut/FreakItOut-Server-Control-Center?label=release"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="Languages" src="https://img.shields.io/badge/UI-Deutsch%20%7C%20English-lightgrey">
</p>

**English** | [Deutsch](README.de.md)

> Not affiliated with Blizzard Entertainment or the AzerothCore project. This repository contains
> no game client, no game data and no repack. It manages an existing AzerothCore installation —
> official or repack.

---

## What is it?

FreakItOut Server Control Center is an Electron desktop app that bundles the everyday work of a
private AzerothCore server into one window: install and update the core, start and stop the
services, manage accounts and characters, handle backups and restores, edit module configuration,
and keep an eye on the machine.

The guided installation and update path uses the **official AzerothCore sources**
(`azerothcore/azerothcore-wotlk`). Existing **repacks can be managed as well** — including bundles
with Playerbots and Individual Progression. The panel does not ship a repack and does not overwrite
files behind your back; it works with the server folder you point it to. A fresh guided installation
always starts from the official repository.

## Features

### Install, update, maintain
- Guided installation from the official AzerothCore source: prerequisites, clone, CMake build,
  database import and client data.
- Update check with commit list, forced rebuild only when needed, backup before the update and
  automatic rollback if the database import fails.
- Scheduled nightly maintenance, worldserver restarts with in-game warning, database maintenance
  (`ANALYZE`/`OPTIMIZE`) and a `CHECK TABLE` integrity report.
- Module installation from a Git URL or `owner/repo` shorthand, including preflight checks,
  optional SQL import, config generation and build hand-off.

### Server control
- Start, stop and restart worldserver, authserver and MySQL; startup phases (`starting` → `ready`).
- Live console with search, error filter and “jump to first error”; SOAP command input.
- Port checks before start, port owner diagnosis, crash auto-restart and a service watchdog for
  running-but-unreachable services.
- Server event history, resource metrics, system history (RAM/CPU, database size, free disk) and
  log archive with context search.

### Players and support
- Accounts: create, search, paginate, change password/GM level/email, lock/unlock, bulk actions
  with a mandatory backup before bulk deletion.
- Characters: list, filter, detail view, inventory, mail, rename, teleport, talent reset, delete.
- Online players with zone and class filters, quick SOAP actions.
- Guilds with roster, leader and guild bank; economy overview with gold, auctions and mail.
- Bans with search, expiry cleanup and optional daily cleanup.
- Support tickets from `gm_ticket`: comments, replies, assignment, close and reopen.
- Account security overview: GM accounts, locked accounts, failed logins, shared IPs and inactivity.

### Data and configuration
- Compressed database backups with retention, verification in throwaway databases, restore preview
  with row-count comparison, and an optional second backup target on another drive or NAS.
- Read-only SQL console (`SELECT`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `WITH`), CSV export and history.
- Module configuration editor for `<configs>/modules/*.conf`, with change preview and versioned
  backups.
- Rate presets for XP, loot, reputation and professions, plus direct config editing for
  `worldserver.conf` and `authserver.conf`.
- Action log for panel operations, with filters and export.

### Quality of life
- German and English UI.
- Light/dark modern theme, command palette (`Ctrl+K`), favorites and collapsible sidebar.
- Desktop notifications, notification center, optional Discord webhook and tray support.
- Health check, disk-space overview, cleanup helpers and diagnostic exports.

## Download

Download the latest portable EXE from
[Releases](https://github.com/FreakItOut/FreakItOut-Server-Control-Center/releases/latest).

- The app is **portable**: put the EXE in a writable folder and start it.
- `config.json` is created next to the EXE and contains database and SOAP credentials in plain text.
  It is restricted to the current Windows user, but you should still treat it as a secret.
- The EXE is currently **not code-signed**. Windows SmartScreen may warn on first start.

## Requirements

**To use the app**
- Windows 10 or Windows 11 (64-bit)
- An existing AzerothCore 3.3.5 installation (official or repack), or enough disk space (25 GB+) to
  install one
- MySQL 8.x (the installer can set up a portable instance)

**To build from source**
- Node.js 20 or newer and npm
- Git
- Visual Studio 2022 C++ build tools, CMake and OpenSSL for the AzerothCore build itself

## Quick start

1. Start the app. The setup wizard opens automatically.
2. Choose the server folder and let the wizard install the official AzerothCore sources and the
   database, or point the app to an existing installation.
3. Configure the database, server paths and SOAP access in **Settings**.
4. Start the database, authserver and worldserver from **Server**.
5. Create an account in **Accounts**, then connect your 3.3.5a client to the realm.
6. Set up a backup schedule and the monthly restore test before you invite players.

## Build from source

```bash
npm install
npm run build      # render the UI into renderer/
npm start          # build and run the app
npm run dist       # portable Windows EXE in release/
npm run pruefe     # run all static checks and mocked integration tests
```

The portable build ends up as `release/FreakItOut Server Control Center 1.0.2.exe`.

## Configuration and security

- Database and SOAP credentials live in `config.json` next to the EXE. They are **not** part of this
  repository and must never be committed.
- The app restricts `config.json` permissions to the current Windows user.
- Use a dedicated MySQL user and a dedicated SOAP account; do not reuse passwords from other
  services.
- The SQL console is read-only by design. Destructive operations remain explicit actions such as
  restores or module SQL imports, both of which create a backup first.

## Project structure

```
electron/          main process: windows, tray, server control, API modules
src/               React UI, pages, components, i18n (de/en)
scripts/           static checks, mocked integration tests, release helpers
build/             application icons
public/            logo assets
renderer/          generated UI bundle (not tracked)
release/           generated portable EXE (not tracked)
```

## Tests

```bash
npm run pruefe
```

The suite covers i18n key parity, routes, exports, build freshness, ASAR contents, mocked start
sequences, maintenance, installer skip logic, rollback, module SQL/pull and more. A green run ends
with `ALLES BESTANDEN.`

## Compatibility

- AzerothCore WotLK 3.3.5a (official source)
- Existing **repacks are supported**: point the panel at the repack folder and use its configs,
  database and executables. The guided installation itself uses the official source.
- Playerbots and Individual Progression are supported and tested in a repack environment; the panel
  itself does not depend on them.
- Windows only. The process control uses PowerShell for graceful shutdown and hidden consoles.

## Contributing

Issues and pull requests are welcome. Please keep the official AzerothCore source as the base, avoid
repack-only assumptions, and run `npm run pruefe` before opening a PR. For security issues, please do
not open a public issue with credentials or personal data.

## License

[MIT](LICENSE) © 2026 FreakItOut

## Acknowledgements

- [AzerothCore](https://www.azerothcore.org/) for the server emulator
- [Electron](https://www.electronjs.org/), [React](https://react.dev/) and [Vite](https://vitejs.dev/)
- The AzerothCore module authors whose work the panel can install and configure
