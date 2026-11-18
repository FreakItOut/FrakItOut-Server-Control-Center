'use strict'
/*
 * Manueller Modul-Installations-Test (Runde 32) - braucht NETZ (klont von GitHub).
 * Nicht in 'npm run pruefe' eingehaengt. Aufruf: node scripts/verify-modul-installation.js
 *
 * Isoliert:
 * - temporärer Server-Root mit Git-Quellbaum und configs/modules
 * - eigenes Store-Verzeichnis (die echte Panel-Config bleibt unberührt)
 * - klont zwei echte Module von GitHub, prüft Conf/SQL/buildNoetig/Version,
 *   aktualisiert und entfernt sie wieder.
 */
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const base = path.join(os.tmpdir(), 'wowpanel-modultest-' + Date.now())
const root = path.join(base, 'root')
const source = path.join(root, 'source')
const configs = path.join(root, 'build', 'bin', 'configs')
const modConfigs = path.join(configs, 'modules')

const log = (...a) => console.log(...a)
let fehler = 0
const check = (ok, text) => {
  log((ok ? '  OK   ' : '  FAIL ') + text)
  if (!ok) fehler++
}

async function main () {
  fs.mkdirSync(source, { recursive: true })
  fs.mkdirSync(modConfigs, { recursive: true })
  // Ein vorhandener Conf-Eintrag, damit moduleOrdner() den modules-Ordner findet
  fs.writeFileSync(path.join(modConfigs, 'dummy.conf'), '# dummy\n', 'utf8')

  // Minimaler Git-Quellbaum (installieren erwartet kein Repo, aber sauber ist sauber)
  const g = (...args) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  g('init')
  g('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-m', 'init')

  // Eigenes Store-Verzeichnis -> echte Panel-Config unberührt
  const store = require('../electron/store')
  store.init(path.join(base, 'cfg'))
  store.write({
    server: {
      rootDir: root,
      worldExe: path.join(root, 'build', 'bin', 'worldserver.exe'),
      worldConfDir: configs
    },
    mysql: {}
  })

  const moduleApi = require('../electron/api/module')

  log('\n=== 1. Installation mod-transmog ===')
  const r1 = await moduleApi.installieren({
    url: 'https://github.com/azerothcore/mod-transmog.git',
    name: 'transmog'
  })
  log('  Ergebnis:', JSON.stringify({ name: r1.name, confs: r1.confs, sqlAnzahl: r1.sqlAnzahl }))
  check(fs.existsSync(path.join(source, 'modules', 'transmog', '.git')), 'Quellordner geklont (mit .git)')
  check(r1.confs && r1.confs.length > 0, 'Konfiguration nach configs/modules kopiert: ' + (r1.confs || []).join(', '))
  check(store.read().buildNoetig === true, 'buildNoetig gesetzt (erzwingt den Build)')

  log('\n=== 2. installierte(): Version ===')
  const inst = moduleApi.installierte()
  const eintrag = (inst.module || []).find(m => m.name === 'transmog')
  log('  Eintrag:', JSON.stringify(eintrag))
  check(!!eintrag, 'Modul in installierte() sichtbar')
  check(!!eintrag && /^[0-9a-f]{7,}$/.test(eintrag.version || ''), 'Git-Version gelesen')

  log('\n=== 3. Aktualisieren (git pull) ===')
  const up = await moduleApi.aktualisieren({ name: 'transmog' })
  log('  Ergebnis:', JSON.stringify(up.module))
  check(up.ok && up.module.length === 1 && up.module[0].ok, 'Aktualisierung lief ohne Fehler')
  check(up.module[0].geaendert === false, 'keine Änderung -> kein erzwungener Rebuild')

  log('\n=== 4. Zweites Modul mit SQL (individual-progression) ===')
  let r2 = null
  try {
    r2 = await moduleApi.installieren({
      url: 'https://github.com/ZhengPeiRu21/mod-individual-progression.git',
      name: 'individual-progression'
    })
    log('  Ergebnis:', JSON.stringify({ confs: r2.confs, sqlAnzahl: r2.sqlAnzahl, sql: (r2.sql || []).slice(0, 3) }))
    check(fs.existsSync(path.join(source, 'modules', 'individual-progression', '.git')), 'zweites Modul geklont')
    check(r2.sqlAnzahl > 0, 'SQL-Dateien gefunden (' + r2.sqlAnzahl + ')')
  } catch (e) {
    log('  INFO: zweites Modul nicht geklont (' + e.message + ') - kein Fehler des Installers')
  }

  log('\n=== 5. Entfernen ===')
  const rm = moduleApi.entfernen({ name: 'transmog' })
  check(rm.ok && !fs.existsSync(path.join(source, 'modules', 'transmog')), 'transmog entfernt')
  if (r2) {
    moduleApi.entfernen({ name: 'individual-progression' })
    check(!fs.existsSync(path.join(source, 'modules', 'individual-progression')), 'individual-progression entfernt')
  }
  check(store.read().buildNoetig === true, 'buildNoetig bleibt nach Entfernen gesetzt')

  log('\n=== 6. Fehlerfälle ===')
  let e1 = ''
  try { await moduleApi.installieren({ url: 'keine-url' }) } catch (e) { e1 = e.message }
  check(/Git-URL/.test(e1), 'ungültige URL wird abgelehnt')
  let e2 = ''
  try { moduleApi.entfernen({ name: '../boese' }) } catch (e) { e2 = e.message }
  check(/Ungültiger Modulname/.test(e2), 'Pfad-Ausbruch im Namen wird abgelehnt')

  log('\n' + (fehler ? fehler + ' Prüfung(en) fehlgeschlagen.' : 'MODULTEST: alle Prüfungen bestanden.'))
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_) {}
  process.exitCode = fehler ? 1 : 0
}

main().catch(e => {
  console.error('ABBRUCH:', e.message)
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_) {}
  process.exit(1)
})
