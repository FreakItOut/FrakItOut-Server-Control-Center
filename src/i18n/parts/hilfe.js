export default {
  de: {
    hilfe: {
      intro: 'Kurzformanleitung.',
      intro2: 'Jeder Abschnitt nennt, wo die Schaltfläche liegt und welche zwei bis drei Schritte nötig sind. Für Hintergründe steht in jedem Panel-Bereich ein Hinweistext.',
      zumOrt: 'dorthin springen',
      connect: {
        titel: 'WoW-Client mit dem Server verbinden',
        schritt1: 'Datenbank und Server laufen lassen: Seite „Server Start / Stop“ → „Alle starten“.',
        schritt2: 'Connect Optionen → „WoW-Client verbinden“ → Client-Ordner wählen → „realmlist.wtf setzen“. Die alte Datei bleibt als Backup liegen.',
        schritt3: 'WoW.exe starten und mit dem Spielkonto einloggen. GM-Konto anlegen geht unter „Acc erstellen“.'
      },
      start: {
        titel: 'Server starten und beenden',
        schritt1: 'Seite „Server Start / Stop“ → „Alle starten“ (Reihenfolge: Datenbank → Auth → World).',
        schritt2: 'Die Ausgabe jedes Prozesses erscheint im Protokoll; Fehler stehen dort mit Grund.',
        schritt3: '„bei Absturz neu starten“ (max. 3 Versuche) und „beim Panel-Start“ halten den Server im Betrieb.'
      },
      update: {
        titel: 'Server aktualisieren',
        schritt1: 'Übersicht zeigt an, ob neue Commits oder veraltete Clientdaten vorliegen.',
        schritt2: 'Einrichtungsassistent (Knopf oben in den Einstellungen) → „Automatisch installieren“ → „Updates prüfen“. Vor dem Import sichert das Panel die Datenbank automatisch.',
        schritt3: 'Ohne neue Commits überspringt das Update den 30–90-minütigen Bau. Laufende Server werden gestoppt und danach wieder angestellt.'
      },
      sicherung: {
        titel: 'Datenbank sichern und zurückholen',
        schritt1: 'Datenbank Backup → „Jetzt sichern“ oder Zeitplan einschalten (Komprimierung empfohlen).',
        schritt2: 'Zurückholen: Zeitpunkt wählen → Bestätigen. Laufende Server werden automatisch beendet und danach neu gestartet; vorher legt das Panel eine Sicherheitssicherung an.',
        schritt3: 'Nur einzelne Datenbanken zurückholen: im Dialog die gewünschten ankreuzen (z. B. nur acore_characters).'
      },
      bots: {
        titel: 'PlayerBots einrichten',
        schritt1: 'Im Einrichtungsassistenten die Option „Playerbots-Modul installieren“ wählen (baut das Bot-Modul mit ein).',
        schritt2: 'Seite „Bot Anzahl“ → Konto anlegen (Passwort max. 16 Zeichen), dann Bot-Anzahl einstellen und speichern.',
        schritt3: 'Worldserver neu starten - erst danach laufen Bots an.'
      },
      konsole: {
        titel: 'Konsole reparieren (401 / keine Antwort)',
        schritt1: 'Worldserver muss laufen (Server-Seite). Danach „Einstellungen" → „SOAP testen“.',
        schritt2: 'Antwortet SOAP nicht: Seite „Konsole“ → „Konsole-Zugang neu setzen“ legt das Konto mit einem gültigen 16-Zeichen-Passwort neu an.',
        schritt3: 'Immer noch 401: worldserver.conf prüfen - SOAP.Enabled = 1 und SOAP.Port = 7878 (Seite „Konfiguration“).'
      },
      migration: {
        titel: 'Charaktere aus einem anderen Server übernehmen',
        schritt1: 'Datenbank Backup → „Charaktere vom alten Server übernehmen": MySQL-Ordner des alten Servers wählen (z. B. ...\\mysql beim Repack).',
        schritt2: '„Was ist drin?" zeigt, wie viele Charaktere und Konten der alte Server hat.',
        schritt3: 'Konten, Bot-Datenbank und playerbots.conf anhaken (Standard), dann „Übernahme starten" - vorher läuft automatisch eine Sicherheitssicherung.',
        schritt4: 'Worldserver neu starten: das Schema richtet er beim Start selbst, die Bots laufen mit übernommenem Zustand. Bei veraltetem Konto-Format hilft der Bulk-Passwort-Reset auf der Konten-Seite.'
      }
    }
  },
  en: {
    hilfe: {
      intro: 'Short manual.',
      intro2: 'Each section tells you where the button lives and the two to three steps involved. Every panel area carries its own hint text for background.',
      zumOrt: 'go there',
      connect: {
        titel: 'Connect the WoW client to the server',
        schritt1: 'Have database and server running: “Server Start / Stop” page → “Start all”.',
        schritt2: 'Connect Options → “Connect the WoW client” → choose the client folder → “Set realmlist.wtf”. The old file is kept as a backup.',
        schritt3: 'Start WoW.exe and log in with your game account. GM accounts are created under “Create Account”.'
      },
      start: {
        titel: 'Start and stop the server',
        schritt1: '“Server Start / Stop” page → “Start all” (order: database → auth → world).',
        schritt2: 'Each process writes its output to the log; failures show the reason there.',
        schritt3: '“restart on crash” (max. 3 attempts) and “on panel start” keep the server running.'
      },
      update: {
        titel: 'Update the server',
        schritt1: 'The overview shows pending commits or outdated client data.',
        schritt2: 'Setup wizard (button on the Settings page) → “Install automatically” → “Check for updates”. The panel backs up the database before importing.',
        schritt3: 'With no new commits the 30–90 minute build is skipped. Running servers are stopped and started again afterwards.'
      },
      sicherung: {
        titel: 'Back up and restore the database',
        schritt1: 'Database Backup → “Back up now” or enable the schedule (compression recommended).',
        schritt2: 'Restore: pick a timestamp → confirm. Running servers are stopped automatically and restarted afterwards; the panel creates a safety backup first.',
        schritt3: 'Partial restore: tick the databases you want in the dialog (e.g. only acore_characters).'
      },
      bots: {
        titel: 'Set up PlayerBots',
        schritt1: 'Choose “Install Playerbots module” in the setup wizard (builds the bot module in).',
        schritt2: '“Bot Count” page → create the account (password max. 16 chars), set the bot count and save.',
        schritt3: 'Restart the world server - only then do bots appear.'
      },
      konsole: {
        titel: 'Repair the console (401 / no answer)',
        schritt1: 'The world server must be running (Server page). Then “Settings” → “Test SOAP”.',
        schritt2: 'No answer: the “Console” page → “Reset console access” recreates the account with a valid 16-character password.',
        schritt3: 'Still 401: check worldserver.conf - SOAP.Enabled = 1 and SOAP.Port = 7878 (page “Configuration”).'
      },
      migration: {
        titel: 'Import characters from another server',
        schritt1: 'Database Backup → “Import characters from the old server”: choose the old server\'s MySQL folder (e.g. ...\\mysql in the repack).',
        schritt2: '“What\'s inside?” shows how many characters and accounts the old server has.',
        schritt3: 'Tick accounts, bot database and playerbots.conf (default), then “Start import” - a safety backup runs automatically first.',
        schritt4: 'Restart the world server: it applies schema updates on start, bots run with their imported state. For outdated account formats the bulk password reset on the Accounts page helps.'
      }
    }
  }
}
