// Prueft das Auslesen der Bot-Konfiguration gegen echte Repacks.
// Liest nur, schreibt ausser in eine Kopie.
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botreal-'))
const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(path.join(tmp, 'userdata'))
const bots = require(path.join(__dirname, '..', 'electron', 'api', 'bots.js'))
const ce = require(path.join(__dirname, '..', 'electron', 'api', 'config-editor.js'))

// Dieselbe Auswahl, die auch die Oberflaeche trifft.
const COUNT_GROUPS = [
  ['NpcBot.WanderingBots.Continents.Count'],
  ['AiPlayerbot.RandomBotsTotalCount'],
  ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'],
  ['AiPlayerbot.RandomBots'],
  ['AiPlayerbot.RandomBotCount'],
  ['NpcBot.MaxBots']
]
const ENABLE_KEYS = ['AiPlayerbot.Enable', 'AiPlayerbot.Enabled', 'NpcBot.Enable', 'NpcBot.Enable.All']

const gruppeVon = entries => {
  for (const g of COUNT_GROUPS) {
    const v = g.map(k => entries.find(e => e.key.toLowerCase() === k.toLowerCase())?.key).filter(Boolean)
    if (v.length) return v
  }
  return []
}
const enableVon = entries => {
  for (const n of ENABLE_KEYS) {
    const t = entries.find(e => e.key.toLowerCase() === n.toLowerCase())
    if (t) return t.key
  }
  return null
}
const wert = (entries, k) => (entries.find(e => e.key === k) || {}).value

const REPACKS = [
  {
    name: 'WoTLK (mod-playerbots)',
    root: 'C:\\Azerothcore WoTLK Repack (Playerbots + Individual Progression)',
    worldConfDir: 'configs',
    erwartetDatei: 'playerbots.conf',
    erwartetGruppe: ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'],
    erwartetEnable: 'AiPlayerbot.Enabled'
  },
  {
    name: 'Legenden 4.4.5 (NpcBots)',
    root: 'C:\\German Repack Legenden 4.4.5',
    worldConfDir: 'configs',
    erwartetGruppe: ['NpcBot.WanderingBots.Continents.Count'],
    erwartetEnable: 'NpcBot.Enable'
  }
]

;(async () => {
  const steps = []
  const pruefe = (name, ok, zusatz) => steps.push({ name, ok: !!ok, zusatz: zusatz || '' })

  for (const r of REPACKS) {
    if (!fs.existsSync(r.root)) {
      steps.push({ name: `${r.name}: Repack vorhanden`, ok: false, zusatz: r.root })
      continue
    }
    store.write({ server: { worldConfDir: path.join(r.root, r.worldConfDir), botFile: '' } })

    // 1) Automatische Suche
    let d = await bots.get()
    const relativ = d.path ? path.relative(r.root, d.path) : '(keine)'
    if (r.erwartetDatei) {
      pruefe(`${r.name}: automatisch playerbots.conf gefunden`, d.path && /playerbots\.conf$/i.test(d.path), relativ)
      pruefe(`${r.name}: liegt in configs\\modules`, /configs\\modules\\playerbots\.conf$/i.test(d.path || ''), relativ)
    } else {
      // Dieser Repack hat nachweislich keine playerbots.conf. Dann ist das
      // Rueckfallen auf die worldserver.conf das richtige Verhalten.
      pruefe(`${r.name}: faellt auf worldserver.conf zurueck`,
        /worldserver\.conf$/i.test(d.path || '') && d.primary === false, relativ)
    }

    // 2) Schluessel werden richtig erkannt
    const gruppe = gruppeVon(d.entries)
    const enable = enableVon(d.entries)
    pruefe(`${r.name}: Gruppe erkannt`, JSON.stringify(gruppe) === JSON.stringify(r.erwartetGruppe), gruppe.join(' + ') || '(leer)')
    pruefe(`${r.name}: Enable-Schluessel erkannt`, enable === r.erwartetEnable, enable || '(leer)')

    // 3) Der angezeigte Wert ist der aus der Datei, nicht 0
    const erster = gruppe[0]
    const angezeigt = parseInt(wert(d.entries, erster), 10)
    pruefe(`${r.name}: Anzeigewert plausibel`, Number.isFinite(angezeigt) && angezeigt > 0, `${erster} = ${angezeigt}`)
    pruefe(`${r.name}: Feld waere aktiv`, Boolean(erster))

    // 4) Gruppe einheitlich?
    const uneinheitlich = gruppe.length > 1 && gruppe.some(k => parseInt(wert(d.entries, k), 10) !== angezeigt)
    pruefe(`${r.name}: Gruppe einheitlich (${gruppe.length} Schluessel)`, !uneinheitlich,
      gruppe.map(k => `${k.split('.').pop()}=${wert(d.entries, k)}`).join(' '))
  }

  // 5) Schreiben auf eine KOPIE: beide Schluessel der Gruppe muessen wechseln
  const r = REPACKS[0]
  const quelle = path.join(r.root, r.worldConfDir, 'modules', 'playerbots.conf')
  if (fs.existsSync(quelle)) {
    const kopie = path.join(tmp, 'kopie.conf')
    fs.copyFileSync(quelle, kopie)
    await bots.setFile({ path: kopie })
    const d = await bots.get()
    const gruppe = gruppeVon(d.entries)
    pruefe('Kopie: Gruppe erkannt', gruppe.length === 2, gruppe.join(' + '))

    await bots.save({
      file: kopie,
      entries: gruppe.map(k => ({ key: k, value: '321' }))
    })
    const text = fs.readFileSync(kopie, 'utf8')
    pruefe('Kopie: MinRandomBots = 321', /AiPlayerbot\.MinRandomBots\s*=\s*321/.test(text))
    pruefe('Kopie: MaxRandomBots = 321', /AiPlayerbot\.MaxRandomBots\s*=\s*321/.test(text))

    const d2 = await bots.get()
    pruefe('Kopie: beide Gruppenwerte gleich', new Set(gruppe.map(k => wert(d2.entries, k))).size === 1,
      gruppe.map(k => wert(d2.entries, k)).join(' / '))

    // Original unangetastet?
    const original = fs.readFileSync(quelle, 'utf8')
    pruefe('Original unveraendert', !/MinRandomBots\s*=\s*321/.test(original))

    await bots.setFile({ path: '' })
  }

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
