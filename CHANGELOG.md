# Changelog

**English** | [Deutsch](CHANGELOG.de.md)

All notable changes to FrakItOut Server Control Center are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-18

First public release. The panel was developed over 42 iterative improvement rounds; this entry
summarizes the functionality at release time instead of listing every intermediate step.

### Added

**Installation and updates**
- Guided setup from the official AzerothCore source, including prerequisite checks, clone,
  CMake build, database import and client data.
- Update checks with commit list, backup before the update, database rollback on import failure
  and a forced rebuild when modules changed.
- Nightly maintenance (backup → update → build → database), scheduled worldserver restarts with
  in-game warnings and optional RAM-threshold restarts.
- Module installation from Git URLs or `owner/repo` shorthand, with preflight checks, direct
  catalog install, batch install, optional SQL import, config generation and a “build now”
  hand-off.
- Module update checks via `git fetch`, module removal and versioned module configuration backups.

**Server control**
- Start, stop and restart worldserver, authserver and MySQL, including startup phases.
- Live console with per-service filters, search, first-error jump and SOAP command input.
- Port checks before start, port owner diagnosis, crash auto-restart and a service watchdog for
  running-but-unreachable services.
- Server event history, resource metrics, system history (RAM/CPU, database size, free disk) and a
  log archive with context search.

**Players and support**
- Accounts with search, pagination, password/GM level/email changes, lock/unlock, bulk password
  reset and bulk deletion with a mandatory backup.
- Characters with inventory, mailbox, rename, teleport, talent reset and deletion.
- Online players with zone/class filter and quick SOAP actions.
- Guild overview with roster, leader and guild bank; economy overview with gold, auctions and mail.
- Bans with search, manual cleanup and optional daily cleanup.
- Support tickets from `gm_ticket` with comments, replies, assignment, close and reopen.
- Account security overview with GM accounts, locks, failed logins, shared IPs and inactivity.

**Data and configuration**
- Compressed database backups with retention, verification in throwaway databases, restore preview
  with row-count comparison and an optional second backup target.
- Read-only SQL console with automatic row limit, timeout, history and CSV export.
- Module configuration editor with change preview and versioned backups.
- Rate presets, direct `worldserver.conf`/`authserver.conf` editing and config migration after core
  updates.
- Action log with area filters, search, export and retention.

**Quality of life**
- German and English UI with translation checks in the test suite.
- Modern dark/light theme, command palette, favorites and collapsible sidebar.
- Desktop notifications, notification center, Discord webhook, tray support and panel autostart.
- Health check, disk-space overview, cleanup helpers and diagnostic exports.

### Changed
- Replaced the external server console with a single in-panel console.
- Server start now uses hidden consoles; the database no longer opens a Windows Terminal window.
- Database shutdown uses `mysqladmin shutdown` because MySQL 8.4 keeps the listening socket in a
  child process.

### Fixed
- Database stop could leave the MySQL child process and port 3306 running.
- React error boundary crash on the ticket page caused by a missing `formatDate` import.
- Module configurations were not linked in the installed-module list when the folder name differed
  from the configuration name.
- Various route, i18n and build-freshness regressions caught by the check suite.

### Security
- `config.json` permissions are restricted to the current Windows user.
- SQL console is read-only and rejects multiple statements, `INTO OUTFILE`, `LOAD_FILE`,
  `FOR UPDATE` and similar dangerous constructs.
- Module SQL import and restores create a database backup first and abort if it fails.
- Bulk account deletion aborts when the mandatory backup fails.

### Known limitations
- Windows only.
- The portable EXE is not code-signed, so SmartScreen may warn.
- The panel manages an existing AzerothCore installation; it does not ship a game client, game data
  or a repack.
- Some destructive paths (restore, bulk delete, module SQL) are guarded by backups but were not
  executed against production data during automated tests.
