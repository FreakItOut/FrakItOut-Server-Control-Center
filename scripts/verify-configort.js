'use strict'

/*
 * Prueft, wo das Panel die config.json ablegt.
 *
 * Anlass: die Konfiguration soll direkt neben der EXE liegen, nicht unter
 * %APPDATA%. Das hat drei Stellen, an denen es schiefgehen kann:
 *
 *   1. Die portable EXE laeuft aus %TEMP%. Ohne PORTABLE_EXECUTABLE_DIR
 *      landet die Datei neben einer Kopie, die es nach dem Beenden nicht
 *      mehr gibt - der Nutzer verliert sie scheinbar.
 *   2. Ist neben der EXE nicht zu schreiben, muss auf %APPDATA% zurueck.
 *   3. Liegt am alten Ort eine Konfiguration, muss sie uebernommen werden.
 *      Sonst startet das Panel nach dem Umstieg unkonfiguriert und der
 *      Nutzer verliert Datenbankkennwort und Pfade, ohne es zu merken.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const WURZEL = path.join(__dirname, '..')
const STORE = path.join(WURZEL, 'electron', 'store.js')

let gut = 0
let schlecht = 0

function pruefe (cond, label) {
  if (cond) {
    gut++
    console.log('  OK   ' + label)
  } else {
    schlecht++
    console.log('  FAIL ' + label)
  }
}

// store.js merkt sich den Pfad im Modulzustand. Fuer jeden Fall wird der
// Einstiegspunkt neu geladen, sonst sieht der zweite Fall die Datei des
// ersten.
function storeNeu () {
  delete require.cache[require.resolve(STORE)]
  return require(STORE)
}

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'wowpanel-configort-'))

/* ------------------------------------------- Fall 1: Umzug vom alten Ort */

console.log('=== 1. Konfiguration liegt am alten Ort ===')
{
  const exeDir = path.join(wurzel, 'fall1-desktop')
  const altDir = path.join(wurzel, 'fall1-appdata')
  fs.mkdirSync(exeDir, { recursive: true })
  fs.mkdirSync(altDir, { recursive: true })

  const altInhalt = {
    mysql: { host: '10.0.0.9', user: 'gastar', password: 'geheim' },
    panel: { language: 'en' }
  }
  fs.writeFileSync(path.join(altDir, 'config.json'), JSON.stringify(altInhalt, null, 2), 'utf8')

  process.env.PORTABLE_EXECUTABLE_DIR = exeDir
  const store = storeNeu()
  const wo = store.initAuto({ altesVerzeichnis: altDir, app: { isPackaged: true } })

  pruefe(wo.nebenDerExe === true, 'neben der EXE gewaehlt')
  pruefe(path.dirname(wo.pfad) === exeDir, `Pfad liegt in ${path.basename(exeDir)} (ist ${path.basename(path.dirname(wo.pfad))})`)

  const neu = path.join(exeDir, 'config.json')
  pruefe(fs.existsSync(neu), 'config.json wurde neben der EXE angelegt')

  const gelesen = JSON.parse(fs.readFileSync(neu, 'utf8'))
  pruefe(gelesen.mysql.host === '10.0.0.9', 'Datenbank-Host uebernommen')
  pruefe(gelesen.mysql.password === 'geheim', 'Passwort uebernommen')
  pruefe(gelesen.panel.language === 'en', 'Sprache uebernommen')

  // Und es muss auch wirklich benutzt werden, nicht nur kopiert sein
  const zurueck = store.read()
  pruefe(zurueck.mysql.user === 'gastar', 'gelesene Konfiguration stammt vom neuen Ort')

  pruefe(fs.existsSync(path.join(altDir, 'config.json')), 'alte Datei bleibt liegen (nicht geloescht)')
}

/* ------------------------------- Fall 2: neben der EXE ist nichts da */

console.log('=== 2. Neben der EXE liegt noch nichts ===')
{
  const exeDir = path.join(wurzel, 'fall2-desktop')
  const altDir = path.join(wurzel, 'fall2-appdata')
  fs.mkdirSync(exeDir, { recursive: true })
  fs.mkdirSync(altDir, { recursive: true })
  // am alten Ort liegt bewusst nichts

  process.env.PORTABLE_EXECUTABLE_DIR = exeDir
  const store = storeNeu()
  const wo = store.initAuto({ altesVerzeichnis: altDir, app: { isPackaged: true } })

  pruefe(wo.nebenDerExe === true, 'trotzdem neben der EXE geblieben')
  pruefe(fs.existsSync(path.join(exeDir, 'config.json')), 'eine Vorlage wurde geschrieben')
  const gelesen = JSON.parse(fs.readFileSync(path.join(exeDir, 'config.json'), 'utf8'))
  pruefe(gelesen.mysql.port === 3306, 'Vorlage enthaelt die Vorgabewerte')
}

/* ------------------------------- Fall 3: neben der EXE nicht schreibbar */

console.log('=== 3. Neben der EXE nicht schreibbar ===')
{
  const exeDir = path.join(wurzel, 'fall3-desktop')
  const altDir = path.join(wurzel, 'fall3-appdata')
  fs.mkdirSync(exeDir, { recursive: true })
  fs.mkdirSync(altDir, { recursive: true })
  fs.writeFileSync(path.join(altDir, 'config.json'), JSON.stringify({ panel: { language: 'en' } }), 'utf8')

  // Verzeichnis zurueckziehen: schreibbar() muss mit false antworten
  process.env.PORTABLE_EXECUTABLE_DIR = exeDir
  const store = storeNeu()
  const original = fs.existsSync
  fs.existsSync = (p) => (p === exeDir ? false : original(p))

  let wo
  try {
    wo = store.initAuto({ altesVerzeichnis: altDir, app: { isPackaged: true } })
  } finally {
    fs.existsSync = original
  }

  pruefe(wo.nebenDerExe === false, 'Ausweichen auf den alten Ort')
  pruefe(path.dirname(wo.pfad) === altDir, 'Pfad zeigt auf den alten Ort')
  pruefe(fs.existsSync(path.join(altDir, 'config.json')), 'Konfiguration am alten Ort erhalten')
}

/* --------------------------- Fall 4: Entwicklungsbetrieb bleibt unberuehrt */

console.log('=== 4. Entwicklungsbetrieb ===')
{
  const exeDir = path.join(wurzel, 'fall4-desktop')
  const altDir = path.join(wurzel, 'fall4-appdata')
  fs.mkdirSync(exeDir, { recursive: true })
  fs.mkdirSync(altDir, { recursive: true })

  process.env.PORTABLE_EXECUTABLE_DIR = exeDir
  const store = storeNeu()
  const wo = store.initAuto({ altesVerzeichnis: altDir, app: { isPackaged: false } })

  pruefe(wo.nebenDerExe === false, 'im Entwicklungsbetrieb nicht neben der EXE')
  pruefe(path.dirname(wo.pfad) === altDir, 'Entwicklungsbetrieb nutzt den alten Ort')
  pruefe(!fs.existsSync(path.join(exeDir, 'config.json')), 'nichts neben electron.exe abgelegt')
}

/* ------------------------------ Fall 5: Tests duerfen nichts verdraeben */

console.log('=== 5. init() bleibt unveraendert ===')
{
  const eigenes = path.join(wurzel, 'fall5-eigenes')
  process.env.PORTABLE_EXECUTABLE_DIR = path.join(wurzel, 'irgendwo')
  const store = storeNeu()
  store.init(eigenes)
  pruefe(store.filePathOf() === path.join(eigenes, 'config.json'),
    'init() schreibt dorthin, wohin es gesagt wird - die 20 Pruefskripte rufen das auf')
}

delete process.env.PORTABLE_EXECUTABLE_DIR
fs.rmSync(wurzel, { recursive: true, force: true })

console.log('')
console.log(schlecht
  ? `${gut} bestanden, ${schlecht} FEHLGESCHLAGEN`
  : `ALLE ${gut} PRUEFUNGEN BESTANDEN`)
process.exit(schlecht ? 1 : 0)