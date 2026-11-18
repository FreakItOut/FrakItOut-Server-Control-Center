# Changelog

[English](CHANGELOG.md) | **Deutsch**

Alle nennenswerten Änderungen am FrakItOut Server Control Center. Das Format orientiert sich an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionierung folgt
[Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [1.0.0] - 2026-11-18

Erste öffentliche Veröffentlichung. Das Panel entstand über 42 iterative Verbesserungsrunden;
dieser Eintrag fasst den Funktionsstand zum Release zusammen, statt jeden Zwischenschritt
aufzulisten.

### Hinzugefügt

**Installation und Updates**
- Geführte Einrichtung aus der offiziellen AzerothCore-Quelle inklusive Voraussetzungsprüfung,
  Klonen, CMake-Bau, Datenbankimport und Clientdaten.
- Update-Prüfung mit Commit-Liste, Sicherung vor dem Update, Datenbank-Rollback bei fehlgeschlagenem
  Import und erzwungenem Neubau nach Moduländerungen.
- Nächtliche Wartung (Sicherung → Update → Bau → Datenbank), geplante Weltserver-Neustarts mit
  Ansage im Spiel und optionaler Neustart bei RAM-Schwelle.
- Modulinstallation per Git-URL oder Kurzform `owner/repo`, mit Vorabprüfung, direkter
  Katalog-Installation, Sammelinstallation, optionalem SQL-Import, Konfigurationserzeugung und
  „Jetzt bauen“-Übergabe.
- Modul-Update-Prüfung per `git fetch`, Modulentfernung und versionierte Modul-Sicherungen.

**Serversteuerung**
- Worldserver, Authserver und MySQL starten, stoppen und neu starten, inklusive Startphasen.
- Live-Konsole mit Filtern pro Dienst, Suche, Sprung zum ersten Fehler und SOAP-Befehlseingabe.
- Portprüfung vor dem Start, Diagnose des Portbesitzers, Auto-Neustart nach Absturz und ein
  Dienst-Wächter für laufende, aber nicht erreichbare Dienste.
- Server-Verlauf, Ressourcenwerte, Systemverlauf (RAM/CPU, Datenbankgröße, freier Platz) und
  Log-Archiv mit Kontextsuche.

**Spieler und Support**
- Konten mit Suche, Blättern, Passwort-/GM-Stufen-/E-Mail-Änderung, Sperren/Entsperren,
  Sammel-Passwort-Reset und Sammel-Löschen mit Pflicht-Sicherung.
- Charaktere mit Inventar, Postfach, Umbenennen, Teleport, Talent-Reset und Löschen.
- Online-Spieler mit Zonen-/Klassenfilter und Schnellaktionen über SOAP.
- Gildenübersicht mit Mitgliederliste, Leiter und Gildenbank; Wirtschaftsübersicht mit Gold,
  Auktionen und Post.
- Bans mit Suche, manueller Bereinigung und optionalem täglichem Aufräumen.
- Support-Tickets aus `gm_ticket` mit Kommentaren, Antworten, Zuweisung, Abschließen und
  Wiederöffnen.
- Kontosicherheit mit GM-Konten, Sperren, Fehlanmeldungen, geteilten IPs und Inaktivität.

**Daten und Konfiguration**
- Komprimierte Datenbanksicherungen mit Aufbewahrung, Prüfung in Wegwerf-Datenbanken,
  Restore-Vorschau mit Zeilenvergleich und optionalem zweitem Sicherungsziel.
- Datenbank-Konsole nur lesend, mit automatischer Zeilenbegrenzung, Timeout, Verlauf und
  CSV-Export.
- Modul-Konfiguration mit Änderungsvorschau und versionierten Sicherungen.
- Raten-Vorlagen, direkter Editor für `worldserver.conf`/`authserver.conf` und
  Konfigurationsmigration nach Core-Updates.
- Aktionsprotokoll mit Bereichsfilter, Suche, Export und Aufbewahrungsgrenze.

**Komfort**
- Oberfläche auf Deutsch und Englisch, mit Übersetzungsprüfung in der Testsuite.
- Modernes Hell-/Dunkel-Theme, Befehlspalette, Favoriten und einklappbare Seitenleiste.
- Desktop-Benachrichtigungen, Meldungszentrale, Discord-Webhook, Tray und Panel-Autostart.
- Gesundheitscheck, Plattenplatz-Aufstellung, Aufräumhilfen und Diagnose-Export.

### Geändert
- Die externe Serverkonsole wurde durch eine einzige Konsole im Panel ersetzt.
- Serverstart nutzt unsichtbare Konsolen; die Datenbank öffnet kein Windows-Terminal-Fenster mehr.
- Das Beenden der Datenbank nutzt `mysqladmin shutdown`, weil MySQL 8.4 den lauschenden Socket in
  einem Kindprozess hält.

### Behoben
- Beim Datenbank-Stop konnten der MySQL-Kindprozess und Port 3306 weiterlaufen.
- Absturz der React-Ansicht auf der Ticket-Seite durch einen fehlenden `formatDate`-Import.
- Modul-Konfigurationen wurden in der Installationsliste nicht zugeordnet, wenn der Ordnername vom
  Conf-Namen abwich.
- Mehrere Routen-, i18n- und Build-Frische-Regressionen, die von der Prüfsuite erkannt wurden.

### Sicherheit
- Die Rechte der `config.json` sind auf den aktuellen Windows-Benutzer beschränkt.
- Die SQL-Konsole ist nur lesend und lehnt Mehrfach-Anweisungen, `INTO OUTFILE`, `LOAD_FILE`,
  `FOR UPDATE` und ähnliche gefährliche Konstrukte ab.
- Modul-SQL-Import und Restore erstellen zuerst eine Sicherung und brechen ab, wenn sie scheitert.
- Sammel-Löschen von Konten bricht ab, wenn die Pflicht-Sicherung fehlschlägt.

### Bekannte Einschränkungen
- Nur Windows.
- Die portable EXE ist nicht signiert; SmartScreen kann warnen.
- Das Panel verwaltet eine vorhandene AzerothCore-Installation; es liefert keinen Spielclient,
  keine Spieldaten und keinen Repack.
- Einige destruktive Wege (Restore, Sammel-Löschen, Modul-SQL) sind durch Sicherungen geschützt,
  wurden in automatisierten Tests aber nicht auf Produktionsdaten ausgeführt.
