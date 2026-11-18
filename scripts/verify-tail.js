// Prueft das Nachsuchen nach einer Logdatei, die erst NACH dem Start
// entsteht - das ist der Fall beim Zeitstempel-Appender (Flag 8).
//
// Ruft die echten Funktionen aus electron/server-manager.js auf.
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-'))
const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(path.join(tmp, 'userdata'))

// server-manager bekommt das Fenster injiziert - Electron selbst wird gar
// nicht geladen. Wir tun nur so, als waere ein Fenster da.
const empfangen = []
const fakeWin = {
  isDestroyed: () => false,
  webContents: {
    send: (kanal, daten) => empfangen.push({ kanal, daten })
  }
}
const sm = require(path.join(__dirname, '..', 'electron', 'server-manager.js'))
sm.init(store, fakeWin)

const { logPathFor, tailLog } = sm.__intern

const steps = []
const pruefe = (name, ok, zusatz) => steps.push({ name, ok: !!ok, zusatz: zusatz || '' })
const warte = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  // Ein Serververzeichnis nachbauen: Config mit Flag 8, noch KEINE Logdatei
  const wurzel = path.join(tmp, 'server')
  const confDir = path.join(wurzel, 'configs')
  const logDir = path.join(wurzel, 'logs')
  fs.mkdirSync(confDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })
  fs.writeFileSync(
    path.join(confDir, 'worldserver.conf'),
    'LogsDir = "logs"\nAppender.Server=2,5,8,Server.log,w\n',
    'utf8'
  )
  store.write({ server: { rootDir: wurzel, workDir: wurzel, worldConfDir: confDir, authConfDir: confDir } })

  pruefe('vor dem Start: keine Logdatei', logPathFor('world') === null)

  // Der Tail laeuft bereits, obwohl es nichts zu lesen gibt
  const iv = tailLog('world', null, true)
  pruefe('tailLog startet auch ohne Datei', !!iv)

  await warte(1800)
  pruefe('meldet das Warten', empfangen.some(e => /warte auf die Logdatei/.test(e.daten.line || '')))

  // Jetzt entsteht die Datei - so wie es der Server beim Start tut
  const neu = path.join(logDir, 'Server_2026-10-14_16_00_00.log')
  fs.writeFileSync(neu, 'AzerothCore Server ist bereit.\n')
  await warte(1800)
  const gefunden = empfangen.some(e => (e.daten.line || '').includes('AzerothCore Server ist bereit'))
  pruefe('liest die nachträglich entstandene Datei', gefunden,
    empfangen.filter(e => e.daten.line).map(e => e.daten.line).slice(-2).join(' | '))

  // Weitere Zeilen muessen laufend dazukommen
  fs.appendFileSync(neu, 'Verbindung zur Datenbank hergestellt.\n')
  await warte(1800)
  pruefe('folgt weiteren Zeilen',
    empfangen.some(e => (e.daten.line || '').includes('Verbindung zur Datenbank')))

  // Eine Logdatei des VORHERIGEN Laufs darf nicht ausgegeben werden.
  // Realistisch heisst das: deutlich aelter als der Start des Panels.
  clearInterval(iv)
  const alt = path.join(logDir, 'Server_2020-01-01_00_00_00.log')
  fs.writeFileSync(alt, 'ALTE DATEI DARF NICHT ERSCHEINEN\n')
  const vorEinerStunde = (Date.now() - 3600 * 1000) / 1000
  fs.utimesSync(alt, vorEinerStunde, vorEinerStunde)
  empfangen.length = 0
  const iv2 = tailLog('world', null, true)
  await warte(1800)
  pruefe('liest beim Start nicht das Log des Vorlaufs',
    !empfangen.some(e => (e.daten.line || '').includes('ALTE DATEI')),
    empfangen.filter(e => e.daten.line).map(e => e.daten.line).join(' | '))

  // Und es wartet weiter, statt die alte Datei zu lesen
  const wirklichNeu = path.join(logDir, 'Server_2026-10-14_16_30_00.log')
  fs.writeFileSync(wirklichNeu, 'Startprotokoll des neuen Laufs.\n')
  await warte(1800)
  pruefe('nimmt danach die neue Datei',
    empfangen.some(e => (e.daten.line || '').includes('Startprotokoll des neuen Laufs')))
  clearInterval(iv2)

  console.log('')
  let ok = 0
  for (const s of steps) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }
  console.log(`\n${ok}/${steps.length} bestanden`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exitCode = ok === steps.length ? 0 : 1
})().catch(e => {
  console.error('Abbruch:', e.message, e.stack)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exitCode = 1
})
