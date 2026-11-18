// Prueft die Logpfad-Aufloesung gegen echte Installationen.
// Beide Repacks benutzen AzerothCore, aber unterschiedliche Appender-Flags.
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-'))
const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(path.join(tmp, 'userdata'))

const REPACKS = [
  {
    name: 'WoTLK (Appender-Flag 8)',
    root: 'C:\\Azerothcore WoTLK Repack (Playerbots + Individual Progression)',
    confDir: 'configs',
    erwartetMuster: /Server[_.]\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}\.log$/i,
    authMuster: /Auth[_.]\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}\.log$/i
  },
  {
    name: 'Legenden 4.4.5 (Appender-Flag 0)',
    root: 'C:\\German Repack Legenden 4.4.5',
    confDir: 'configs',
    erwartetMuster: /Server\.log$/i,
    authMuster: /Auth\.log$/i
  }
]

// Aus server-manager.js nachgebaut, damit die Testlogik dieselbe ist.
function appenderNameFor (confPath, standard) {
  try {
    if (!fs.existsSync(confPath)) return standard
    const text = fs.readFileSync(confPath, 'utf8')
    const m = text.match(new RegExp(`^\\s*Appender\\.\\w+\\s*=\\s*[^\\r\\n]*?["']?([\\w.-]+\\.log)["']?\\s*(?:,|$)`, 'im'))
    if (m && m[1]) return m[1]
  } catch (_) {}
  return standard
}

function findLogFile (dir, baseName) {
  const direkt = path.join(dir, baseName)
  if (fs.existsSync(direkt)) return direkt
  const ext = path.extname(baseName)
  const stamm = path.basename(baseName, ext)
  let eintraege = []
  try {
    eintraege = fs.readdirSync(dir)
  } catch (_) {
    return null
  }
  let treffer = null
  let neueste = -1
  for (const name of eintraege) {
    const n = name.toLowerCase()
    if (!n.endsWith(ext.toLowerCase())) continue
    if (!n.startsWith(stamm.toLowerCase())) continue
    const voll = path.join(dir, name)
    let mtime = 0
    try {
      mtime = fs.statSync(voll).mtimeMs
    } catch (_) {
      continue
    }
    if (mtime > neueste) {
      neueste = mtime
      treffer = voll
    }
  }
  return treffer
}

function logPathFor (kind, root, confRel) {
  const standard = kind === 'auth' ? 'Auth.log' : 'Server.log'
  const names = { conf: kind === 'auth' ? 'authserver.conf' : 'worldserver.conf' }
  const cwd = root
  const confDir = path.join(root, confRel)
  if (fs.existsSync(confDir)) {
    const cp = path.join(confDir, names.conf)
    if (fs.existsSync(cp)) {
      const basis = appenderNameFor(cp, standard)
      const m = fs.readFileSync(cp, 'utf8').match(/^\s*LogsDir\s*=\s*"?([^"\r\n#]+)"?/im)
      if (m) {
        const raw = m[1].trim()
        const abs = path.isAbsolute(raw) ? raw : path.join(cwd, raw)
        const treffer = findLogFile(abs, basis)
        if (treffer) return treffer
      }
    }
  }
  for (const g of ['Berichte', 'logs', 'Logs']) {
    const treffer = findLogFile(path.join(cwd, g), standard)
    if (treffer) return treffer
  }
  return null
}

const steps = []
const pruefe = (name, ok, zusatz) => steps.push({ name, ok: !!ok, zusatz: zusatz || '' })

for (const r of REPACKS) {
  if (!fs.existsSync(r.root)) {
    pruefe(`${r.name}: Repack vorhanden`, false, r.root)
    continue
  }
  store.write({ server: { rootDir: r.root, workDir: r.root, worldConfDir: path.join(r.root, r.confDir), authConfDir: path.join(r.root, r.confDir) } })

  const w = logPathFor('world', r.root, r.confRel = r.confDir)
  const a = logPathFor('auth', r.root, r.confDir)

  pruefe(`${r.name}: World-Log gefunden`, !!w, w ? path.relative(r.root, w) : '(null)')
  pruefe(`${r.name}: World-Log hat Zeitstempel`, !!w && r.erwartetMuster.test(w), w ? path.basename(w) : '')
  pruefe(`${r.name}: Auth-Log gefunden`, !!a, a ? path.relative(r.root, a) : '(null)')
  pruefe(`${r.name}: Auth-Log hat Zeitstempel`, !!a && r.authMuster.test(a), a ? path.basename(a) : '')
  pruefe(`${r.name}: Datei ist nicht leer`, !!w && fs.statSync(w).size > 0, w ? fs.statSync(w).size + ' Bytes' : '')
}

/* Der haeufigste Fehlgriff: es wird nach einem EXAKTEN Namen gesucht.
   Genau daran ist es im Referenz-Repack gescheitert. */
const flag8 = REPACKS[0]
const logDir = path.join(flag8.root, 'logs')
const nurExakt = fs.existsSync(path.join(logDir, 'Server.log'))
pruefe('Kontrollprobe: exaktes Server.log fehlt (Flag 8)', !nurExakt,
  nurExakt ? 'DOCH da - Testannahme falsch' : 'bestaetigt')

/* findLogFile muss die juengste waehlen, nicht einfach die erste. */
const probeDir = path.join(tmp, 'logs-probe')
fs.mkdirSync(probeDir, { recursive: true })
fs.writeFileSync(path.join(probeDir, 'Server.log'), 'direkt')
const alt = path.join(probeDir, 'Server_2020-01-01_00_00_00.log')
fs.writeFileSync(alt, 'alt')
const jetzt = Date.now()
fs.utimesSync(alt, jetzt / 1000, jetzt / 1000)
const alt2 = path.join(probeDir, 'Server_2019-01-01_00_00_00.log')
fs.writeFileSync(alt2, 'aelter')
fs.utimesSync(alt2, (jetzt - 600000) / 1000, (jetzt - 600000) / 1000)
const gewaehlt = findLogFile(probeDir, 'Server.log')
pruefe('Exakter Name gewinnt', gewaehlt === path.join(probeDir, 'Server.log'), path.basename(gewaehlt || ''))

fs.unlinkSync(path.join(probeDir, 'Server.log'))
const gewaehlt2 = findLogFile(probeDir, 'Server.log')
pruefe('Ohne exakten Namen: juengste gewinnt', gewaehlt2 === alt, path.basename(gewaehlt2 || ''))

/* Fremde Dateien mit aehnlichem Praefix duerfen nicht mitgenommen werden */
fs.writeFileSync(path.join(probeDir, 'ServerLog.bak'), 'fremd')
fs.writeFileSync(path.join(probeDir, 'Andere.log'), 'fremd')
const gewaehlt3 = findLogFile(probeDir, 'Server.log')
pruefe('Fremde Dateien bleiben aussen vor', gewaehlt3 === alt, path.basename(gewaehlt3 || ''))

/* Leeres Verzeichnis -> null, kein Absturz */
fs.mkdirSync(path.join(tmp, 'leer'), { recursive: true })
pruefe('Leeres Verzeichnis -> null', findLogFile(path.join(tmp, 'leer'), 'Server.log') === null)
pruefe('Fehlendes Verzeichnis -> null', findLogFile(path.join(tmp, 'gibtesnicht'), 'Server.log') === null)

console.log('')
let ok = 0
for (const s of steps) {
  console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
  if (s.ok) ok++
}
console.log(`\n${ok}/${steps.length} bestanden`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exitCode = ok === steps.length ? 0 : 1
