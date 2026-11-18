'use strict'
/*
 * Modul-Pull im Update: prueft moduleAktualisieren() aus installer.js
 * isoliert mit lokalen Git-Repos (kein Netz, keine echte Installation).
 *
 *  - unveraenderte Module: kein Pull-Fehler, kein buildNoetig
 *  - neuer Commit im Ursprung: Datei wird geholt, buildNoetig gesetzt
 *  - Modul ohne erreichbaren Ursprung: Warnung, kein Absturz
 *
 * Laeuft in 'npm run pruefe' mit (setzt git im PATH voraus).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const base = path.join(os.tmpdir(), 'wowpanel-pull33-' + Date.now())
let fehler = 0
const check = (ok, text) => { console.log((ok ? '  OK   ' : '  FAIL ') + text); if (!ok) fehler++ }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim()

function repoMitInhalt (name, inhalt) {
  const dir = path.join(base, 'work', name)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init')
  fs.writeFileSync(path.join(dir, 'stand.txt'), inhalt)
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.name=T', '-c', 'user.email=t@local', 'commit', '-m', 'stand 1')
  const bare = path.join(base, 'origin', name + '.git')
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  git(base, 'clone', '--bare', dir, bare)
  return { dir, bare }
}

async function main () {
  const store = require('../electron/store')
  store.init(path.join(base, 'cfg'))
  store.write({ buildNoetig: false })

  const installer = require('../electron/api/installer')
  const pull = installer.__intern.moduleAktualisieren

  const source = path.join(base, 'root', 'source')
  const moduleDir = path.join(source, 'modules')
  fs.mkdirSync(moduleDir, { recursive: true })

  const a = repoMitInhalt('a', 'alt-a')
  const b = repoMitInhalt('b', 'stand-b')
  git(moduleDir, 'clone', a.bare, 'mod-a')
  git(moduleDir, 'clone', b.bare, 'mod-b')

  console.log('\n=== 1. Unveraendert ===')
  const r1 = await pull('git', source)
  check(r1.anzahl === 2 && r1.geaendert === false, '2 Module geprueft, keine Aenderung')
  check(store.read().buildNoetig !== true, 'buildNoetig bleibt aus')

  console.log('\n=== 2. Neuer Commit im Ursprung ===')
  fs.writeFileSync(path.join(a.dir, 'stand.txt'), 'neu-a')
  git(a.dir, 'add', '-A')
  git(a.dir, '-c', 'user.name=T', '-c', 'user.email=t@local', 'commit', '-m', 'stand 2')
  git(a.dir, 'push', a.bare, 'HEAD:master')
  const r2 = await pull('git', source)
  check(r2.geaendert === true, 'Aenderung erkannt')
  check(fs.readFileSync(path.join(moduleDir, 'mod-a', 'stand.txt'), 'utf8') === 'neu-a', 'mod-a wurde aktualisiert')
  check(fs.readFileSync(path.join(moduleDir, 'mod-b', 'stand.txt'), 'utf8') === 'stand-b', 'mod-b blieb unveraendert')
  check(store.read().buildNoetig === true, 'buildNoetig gesetzt (Bau wird erzwungen)')

  console.log('\n=== 3. Modul ohne erreichbaren Ursprung ===')
  const kaputt = path.join(moduleDir, 'mod-kaputt')
  fs.mkdirSync(kaputt, { recursive: true })
  git(kaputt, 'init')
  store.write({ buildNoetig: false })
  const r3 = await pull('git', source)
  check(r3.anzahl === 3 && r3.geaendert === false, 'Abbruch des Pulls wird nicht als Aenderung gewertet')
  check(store.read().buildNoetig !== true, 'kein buildNoetig durch den Fehlerfall')

  console.log('\n' + (fehler ? fehler + ' Prüfung(en) fehlgeschlagen.' : 'MODUL-PULL: alle Prüfungen bestanden.'))
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_) {}
  process.exitCode = fehler ? 1 : 0
}

main().catch(e => {
  console.error('ABBRUCH:', e.message)
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_) {}
  process.exit(1)
})
