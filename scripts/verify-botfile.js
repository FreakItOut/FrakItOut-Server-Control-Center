// Prueft die Auswahl der Bot-Konfigurationsdatei gegen die echten Module.
// Laeuft ohne Electron und ohne die echte config.json des Nutzers.
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botfile-'))
const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(path.join(tmp, 'userdata'))

const bots = require(path.join(__dirname, '..', 'electron', 'api', 'bots.js'))

// Aufbau: eine "worldserver.conf" (automatische Erkennung) und eine
// bewusst anders benannte bzw. anders platzierte Bot-Datei.
const welt = path.join(tmp, 'world', 'bin')
fs.mkdirSync(welt, { recursive: true })
fs.writeFileSync(
  path.join(welt, 'worldserver.conf'),
  'NpcBot.WanderingBots.Continents.Count = 200\nNpcBot.WanderingBots.Continents.Enable = 1\n',
  'utf8'
)

const abseits = path.join(tmp, 'ganz', 'anders', 'wo')
fs.mkdirSync(abseits, { recursive: true })
const eigene = path.join(abseits, 'meine_bots.conf')
fs.writeFileSync(eigene, 'NpcBot.WanderingBots.Continents.Count = 777\n', 'utf8')

store.write({ server: { worldConfDir: welt, botFile: '' } })

const steps = []
const pruefe = (name, bedingung, zusatz) => {
  steps.push({ name, ok: !!bedingung, zusatz: zusatz || '' })
}

;(async () => {
  // 1) Ohne Auswahl: automatisch, worldserver.conf
  let d = await bots.get()
  pruefe('automatisch -> worldserver.conf', d.path === path.join(welt, 'worldserver.conf'), d.path)
  pruefe('automatisch -> source=auto', d.source === 'auto', d.source)
  pruefe('automatisch -> Count 200', d.entries.some(e => e.value === '200'))

  // 2) Auf die abseits liegende Datei umstellen
  await bots.setFile({ path: eigene })
  d = await bots.get()
  pruefe('Auswahl uebernommen', d.path === eigene, d.path)
  pruefe('Auswahl -> source=user', d.source === 'user', d.source)
  pruefe('Auswahl -> Count 777 (nicht 200)', d.entries.some(e => e.value === '777'))
  pruefe('Auswahl -> kein Hinweis auf Rueckfall', d.primary === false && d.source === 'user')

  // 3) Schreiben muss in genau dieser Datei landen
  await bots.save({ file: eigene, entries: [{ key: 'NpcBot.WanderingBots.Continents.Count', value: '4321' }] })
  const text = fs.readFileSync(eigene, 'utf8')
  pruefe('geschrieben in die gewaehlte Datei', /Continents\.Count\s*=\s*4321/.test(text))
  pruefe('worldserver.conf unberuehrt',
    /Continents\.Count\s*=\s*200/.test(fs.readFileSync(path.join(welt, 'worldserver.conf'), 'utf8')))

  // 4) Datei war gesetzt und wird danach geloescht (Server umgezogen o. Ae.)
  const verschwindet = path.join(abseits, 'spaeter-geloescht.conf')
  fs.writeFileSync(verschwindet, 'NpcBot.WanderingBots.Continents.Count = 55\n', 'utf8')
  await bots.setFile({ path: verschwindet })
  fs.unlinkSync(verschwindet)
  d = await bots.get()
  pruefe('geloeschte Datei -> file=null', d.file === null, String(d.file))
  pruefe('geloeschte Datei -> missingFile gesetzt', d.missingFile === verschwindet)
  pruefe('geloeschte Datei -> erklaerender Text', typeof d.message === 'string' && d.message.length > 0, d.message)
  pruefe('geloeschte Datei -> keine Eintraege', d.entries.length === 0)

  // 5) Zurueck auf automatisch
  await bots.setFile({ path: '' })
  d = await bots.get()
  pruefe('zurueckgesetzt -> wieder automatisch', d.source === 'auto' && d.path === path.join(welt, 'worldserver.conf'))
  pruefe('zurueckgesetzt -> Count wieder 200', d.entries.some(e => e.value === '200'))

  // 6) Unsinnige Eingaben
  let wirf = false
  try { await bots.setFile({ path: path.join(tmp, 'gibt-es-nicht.conf') }) } catch (e) { wirf = true }
  pruefe('setFile mit fehlender Datei -> Fehler', wirf)

  wirf = false
  try { await bots.setFile({ path: welt }) } catch (e) { wirf = true }
  pruefe('setFile mit Ordner -> Fehler', wirf)

  wirf = false
  try { await bots.setFile({ path: 42 }) } catch (e) { wirf = true }
  pruefe('setFile mit Zahl -> Fehler', wirf)

  await bots.setFile({ path: '' })

  console.log('')
  let ok = 0
  for (const s of steps) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }
  console.log(`\n${ok}/${steps.length} bestanden`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exitCode = ok === steps.length ? 0 : 1
})()
