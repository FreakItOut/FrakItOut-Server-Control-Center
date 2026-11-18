'use strict'

/*
 * Testet die Build-Skip-Bedingung (quelleUnveraendert): HEAD == origin,
 * UND der zuletzt gebaute Stand (install-state.buildCommit) muss dem Ziel
 * entsprechen. Aufgebaut wird ein echtes Git-Repo im Temp-Verzeichnis mit
 * einem bare-Repo als "origin" - kein Netz, keine echten Quellen.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

function git (cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function main () {
  const installer = require('../electron/api/installer')
  const { quelleUnveraendert, pfade, normalisiereRoot } = installer.__intern

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wowpanel-skip-'))
  const root = path.join(base, 'server')
  const source = path.join(root, 'source')
  fs.mkdirSync(source, { recursive: true })

  // Echtes Repo aufsetzen (mit eigenem Origin, damit der Fetch-Fall nicht zählt)
  git(source, ['init', '-b', 'master'])
  git(source, ['config', 'user.email', 'test@test'])
  git(source, ['config', 'user.name', 'test'])
  fs.writeFileSync(path.join(source, 'datei.txt'), 'v1')
  git(source, ['add', '-A'])
  git(source, ['commit', '-m', 'v1'])
  const origin = path.join(base, 'origin.git')
  fs.mkdirSync(origin, { recursive: true })
  git(origin, ['init', '-b', 'master', '--bare'])
  git(source, ['remote', 'add', 'origin', origin])
  git(source, ['push', '-u', 'origin', 'master'])

  const p = pfade(normalisiereRoot(root))
  const gitExe = 'git'

  const head = () => git(source, ['rev-parse', 'HEAD']).trim()

  section('1. HEAD == origin && buildCommit == HEAD -> Build kann übersprungen werden')
  fs.writeFileSync(p.zustand, JSON.stringify({ buildCommit: head() }), 'utf8')
  check(await quelleUnveraendert(p, gitExe) === true, 'identisch -> Skip erlaubt')

  section('2. Ohne buildCommit (z. B. vor dieser Prüfung gebaut) -> kein Skip')
  fs.writeFileSync(p.zustand, JSON.stringify({}), 'utf8')
  check(await quelleUnveraendert(p, gitExe) === false, 'unbekannter Bau-Stand -> kein Skip')

  section('3. buildCommit ist älter (Update scheiterte am Build) -> kein Skip')
  fs.writeFileSync(p.zustand, JSON.stringify({ buildCommit: '0000000000000000000000000000000000000000' }), 'utf8')
  check(await quelleUnveraendert(p, gitExe) === false, 'alter Bau-Stand -> kein Skip')

  section('4. Neue lokale Commits ohne Push -> kein Skip')
  fs.writeFileSync(p.zustand, JSON.stringify({ buildCommit: head() }), 'utf8')
  fs.writeFileSync(path.join(source, 'datei.txt'), 'v2')
  git(source, ['add', '-A'])
  git(source, ['commit', '-m', 'v2'])
  check(await quelleUnveraendert(p, gitExe) === false, 'HEAD != origin -> kein Skip')

  section('5. Remote bewegt sich (neue Commits im Origin) -> kein Skip')
  // Workaround für den 3. Fall zurücksetzen:push von v2, dann neuer Commit im Origin
  git(source, ['push', 'origin', 'master'])
  fs.writeFileSync(p.zustand, JSON.stringify({ buildCommit: head() }), 'utf8')
  // Neuer Commit im Origin (ueber einen zweiten Clone)
  const zweiter = path.join(base, 'zweiter')
  git(base, ['clone', origin, zweiter])
  git(zweiter, ['config', 'user.email', 'test@test'])
  git(zweiter, ['config', 'user.name', 'test'])
  fs.writeFileSync(path.join(zweiter, 'datei.txt'), 'v3')
  git(zweiter, ['add', '-A'])
  git(zweiter, ['commit', '-m', 'v3'])
  git(zweiter, ['push', 'origin', 'master'])
  // Der remote-tracking ref im eigenen Repo muss erst geholt werden -
  // genau das tut auch die echte Update-Prüfung (git fetch) vorher.
  git(source, ['fetch', 'origin'])
  check(await quelleUnveraendert(p, gitExe) === false, 'origin ist weiter -> kein Skip')

  fs.rmSync(base, { recursive: true, force: true })
  console.log('\n' + (failures ? `${failures} PRUEFUNG(EN) FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN'))
  process.exitCode = failures ? 1 : 0
}

main().catch(e => {
  console.error('\nABBRUCH:', e)
  process.exitCode = 1
})
