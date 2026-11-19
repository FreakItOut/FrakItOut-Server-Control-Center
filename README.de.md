<p align="center">
  <img src="public/logo.png" width="96" alt="FreakItOut Logo">
</p>

<h1 align="center">FreakItOut Server Control Center</h1>

<p align="center">
  Ein natives Windows-Verwaltungspanel für <strong>AzerothCore</strong> 3.3.5 (Wrath of the Lich King).
</p>

<p align="center">
  <a href="https://github.com/FreakItOut/FreakItOut-Server-Control-Center/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/FreakItOut/FreakItOut-Server-Control-Center?label=release"></a>
  <img alt="Plattform" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6">
  <a href="LICENSE"><img alt="Lizenz" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="Sprachen" src="https://img.shields.io/badge/UI-Deutsch%20%7C%20English-lightgrey">
</p>

[English](README.md) | **Deutsch**

> Kein offizielles Produkt von Blizzard Entertainment oder dem AzerothCore-Projekt. Dieses
> Repository enthält keinen Spielclient, keine Spieldaten und keinen Repack. Das Panel verwaltet
> eine vorhandene AzerothCore-Installation — offiziell oder als Repack.

---

## Was ist das?

Das FreakItOut Server Control Center ist eine Electron-Desktop-App, die die tägliche Arbeit an einem
privaten AzerothCore-Server in einem Fenster bündelt: Core installieren und aktualisieren, Dienste
starten und stoppen, Konten und Charaktere verwalten, Sicherungen erstellen und zurückspielen,
Modul-Konfiguration bearbeiten und den Rechner im Blick behalten.

Der geführte Installations- und Update-Weg nutzt die **offiziellen AzerothCore-Quellen**
(`azerothcore/azerothcore-wotlk`). **Vorhandene Repacks können ebenfalls verwaltet werden** — auch
Bundles mit Playerbots und Individual Progression. Das Panel liefert keinen Repack mit und
überschreibt nichts hinter dem Rücken; es arbeitet mit dem Serverordner, den du auswählst. Eine
frische geführte Installation startet immer aus dem offiziellen Repository.

## Funktionen

### Installieren, aktualisieren, warten
- Geführte Installation aus der offiziellen AzerothCore-Quelle: Voraussetzungen, Klonen,
  CMake-Bau, Datenbankimport und Clientdaten.
- Update-Prüfung mit Commit-Liste, erzwungener Neubau nur wenn nötig, Sicherung vor dem Update und
  automatischer Rücksprung, wenn der Datenbankimport fehlschlägt.
- Nächtliche Wartung nach Plan, Weltserver-Neustarts mit Ansage im Spiel, Datenbank-Wartung
  (`ANALYZE`/`OPTIMIZE`) und `CHECK TABLE`-Bericht.
- Modulinstallation per Git-URL oder Kurzform `owner/repo`, inklusive Vorabprüfung, optionalem
  SQL-Import, Konfigurationserzeugung und Übergabe an den Bau.

### Serversteuerung
- Worldserver, Authserver und MySQL starten, stoppen und neu starten; Startphasen
  (`starting` → `ready`).
- Live-Konsole mit Suche, Fehlerfilter und „zum ersten Fehler springen“; SOAP-Befehlseingabe.
- Portprüfung vor dem Start, Diagnose des Portbesitzers, Auto-Neustart nach Absturz und ein
  Dienst-Wächter für laufende, aber nicht mehr erreichbare Dienste.
- Server-Verlauf, Ressourcenwerte, Systemverlauf (RAM/CPU, Datenbankgröße, freier Platz) und
  Log-Archiv mit Kontextsuche.

### Spieler und Support
- Konten: anlegen, suchen, blättern, Passwort/GM-Stufe/E-Mail ändern, sperren/entsperren,
  Sammelaktionen mit Pflicht-Sicherung vor dem Sammel-Löschen.
- Charaktere: Liste, Filter, Detailansicht, Inventar, Postfach, Umbenennen, Teleport,
  Talent-Reset, Löschen.
- Online-Spieler mit Zonen- und Klassenfilter, Schnellaktionen über SOAP.
- Gilden mit Mitgliederliste, Leiter und Gildenbank; Wirtschaftsübersicht mit Gold, Auktionen und
  Post.
- Bans mit Suche, Ablauf-Bereinigung und optionalem täglichem Aufräumen.
- Support-Tickets aus `gm_ticket`: Kommentare, Antworten, Zuweisung, Abschließen und Wiederöffnen.
- Kontosicherheit: GM-Konten, gesperrte Konten, Fehlanmeldungen, geteilte IPs und Inaktivität.

### Daten und Konfiguration
- Komprimierte Datenbanksicherungen mit Aufbewahrung, Prüfung in Wegwerf-Datenbanken,
  Restore-Vorschau mit Zeilenvergleich und optionalem zweitem Sicherungsziel auf anderer Platte
  oder NAS.
- Datenbank-Konsole nur lesend (`SELECT`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `WITH`), CSV-Export und
  Verlauf.
- Modul-Konfiguration für `<configs>/modules/*.conf` mit Änderungsvorschau und versionierten
  Sicherungen.
- Raten-Vorlagen für Erfahrung, Beute, Ruf und Berufe sowie direkter Editor für
  `worldserver.conf` und `authserver.conf`.
- Aktionsprotokoll für Panel-Aktionen mit Filtern und Export.

### Komfort
- Oberfläche auf Deutsch und Englisch.
- Modernes Hell-/Dunkel-Theme, Befehlspalette (`Strg+K`), Favoriten und einklappbare Seitenleiste.
- Desktop-Benachrichtigungen, Meldungszentrale, optionaler Discord-Webhook und Tray-Unterstützung.
- Gesundheitscheck, Plattenplatz-Aufstellung, Aufräumhilfen und Diagnose-Export.

## Download

Die neueste portable EXE gibt es unter
[Releases](https://github.com/FreakItOut/FreakItOut-Server-Control-Center/releases/latest).

- Die App ist **portable**: EXE in einen beschreibbaren Ordner legen und starten.
- `config.json` entsteht neben der EXE und enthält Datenbank- und SOAP-Zugangsdaten im Klartext.
  Die Datei wird auf den aktuellen Windows-Benutzer beschränkt, bleibt aber ein Geheimnis.
- Die EXE ist derzeit **nicht signiert**. Windows SmartScreen kann beim ersten Start warnen.

## Voraussetzungen

**Für die Nutzung**
- Windows 10 oder Windows 11 (64 Bit)
- Eine vorhandene AzerothCore-3.3.5-Installation (offiziell oder Repack) oder genug Plattenplatz
  (25 GB+), um eine anzulegen
- MySQL 8.x (der Assistent kann eine portable Instanz einrichten)

**Für den Quellstand**
- Node.js 20 oder neuer und npm
- Git
- Visual Studio 2022 C++ Build Tools, CMake und OpenSSL für den AzerothCore-Bau

## Kurzstart

1. App starten. Der Einrichtungsassistent öffnet sich automatisch.
2. Serverordner wählen und die offiziellen AzerothCore-Quellen sowie die Datenbank einrichten
   lassen – oder auf eine vorhandene Installation zeigen.
3. Datenbank, Serverpfade und SOAP-Zugang unter **Einstellungen** eintragen.
4. Datenbank, Authserver und Worldserver unter **Server** starten.
5. Unter **Konten** ein Konto anlegen und den 3.3.5a-Client mit dem Realm verbinden.
6. Vor dem Einladen von Spielern eine Sicherung und den monatlichen Wiederherstellungstest
   einrichten.

## Aus dem Quellstand bauen

```bash
npm install
npm run build      # Oberfläche nach renderer/ bauen
npm start          # bauen und App starten
npm run dist       # portable Windows-EXE in release/
npm run pruefe     # alle statischen Prüfungen und gemockten Integrationstests
```

Das portable Paket liegt danach als
`release/FreakItOut Server Control Center 1.0.2.exe` vor.

## Konfiguration und Sicherheit

- Datenbank- und SOAP-Zugangsdaten stehen in `config.json` neben der EXE. Sie sind **nicht** Teil
  dieses Repositories und dürfen niemals eingecheckt werden.
- Die App beschränkt die Rechte der `config.json` auf den aktuellen Windows-Benutzer.
- Ein eigenes MySQL-Konto und einen eigenen SOAP-Zugang verwenden; keine Passwörter anderer Dienste
  wiederverwenden.
- Die SQL-Konsole ist absichtlich nur lesend. Schreibende Eingriffe bleiben ausdrückliche Aktionen
  wie Restore oder Modul-SQL, beide mit Sicherung davor.

## Projektstruktur

```
electron/          Hauptprozess: Fenster, Tray, Serversteuerung, API-Module
src/               React-Oberfläche, Seiten, Komponenten, i18n (de/en)
scripts/           statische Prüfungen, gemockte Integrationstests, Release-Helfer
build/             Anwendungssymbole
public/            Logo-Dateien
renderer/          erzeugtes UI-Bundle (nicht eingecheckt)
release/           erzeugte portable EXE (nicht eingecheckt)
```

## Tests

```bash
npm run pruefe
```

Die Suite prüft unter anderem i18n-Schlüsselparität, Routen, Exporte, Build-Frische,
ASAR-Inhalt, gemockte Startsequenzen, Wartung, Installer-Skip-Logik, Rollback, Modul-SQL/Pull und
mehr. Ein grüner Lauf endet mit `ALLES BESTANDEN.`

## Kompatibilität

- AzerothCore WotLK 3.3.5a (offizielle Quelle)
- **Vorhandene Repacks werden unterstützt**: Panel auf den Repack-Ordner zeigen lassen und dessen
  Configs, Datenbank und Programme verwenden. Die geführte Installation selbst nutzt die offizielle
  Quelle.
- Playerbots und Individual Progression werden unterstützt und in einer Repack-Umgebung getestet;
  das Panel selbst hängt nicht von ihnen ab.
- Nur Windows. Die Prozesssteuerung nutzt PowerShell für sauberes Beenden und unsichtbare Konsolen.

## Mitmachen

Issues und Pull Requests sind willkommen. Bitte die offizielle AzerothCore-Quelle als Basis
behalten, keine Repack-Annahmen einbauen und vor einem PR `npm run pruefe` ausführen. Bei
Sicherheitsproblemen bitte kein öffentliches Issue mit Zugangsdaten oder personenbezogenen Daten
eröffnen.

## Lizenz

[MIT](LICENSE) © 2026 FreakItOut

## Danksagung

- [AzerothCore](https://www.azerothcore.org/) für den Server-Emulator
- [Electron](https://www.electronjs.org/), [React](https://react.dev/) und [Vite](https://vitejs.dev/)
- Den AzerothCore-Modulautoren, deren Arbeit das Panel installieren und konfigurieren kann
