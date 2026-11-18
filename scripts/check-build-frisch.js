'use strict'

/*
 * Prueft, ob der Build im renderer/ noch zu den Quellen passt.
 *
 * Aufruf: node scripts/check-build-frisch.js [--bauen]
 *
 * Warum es das braucht
 * -------------------
 * Am 24.10. war tsconfig.json auf 0 Bytes geklemmt. Ab da schlug jeder
 * Build fehl - aber electron-builder nimmt trotzdem das ALTE dist/ und
 * packt es ein. Das Ergebnis: eine startende EXE mit dem Vortagesstand
 * und Exit-Code 0.
 *
 * Zwei Tage lang ist so etwas unbemerkt geblieben, weil niemand gebaut
 * und niemand verglichen hat. Dieser Test vergleicht.
 *
 * Was geprueft wird
 * ------------------
 *   1. Ist dist/ aelter als die neueste Quelldatei? Dann steckt im
 *      Build nicht der aktuelle Stand.
 *   2. Liegt der Build ueberhaupt vor?
 *   3. Mit --bauen wird der Build ausgefuehrt und danach erneut geprueft.
 *
 * Der Test bricht mit Exit 1 ab, wenn etwas nicht stimmt - damit er als
 * Aufgabenplan etwas bewirkt und nicht nur einen Text ausgibt.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const wurzel = path.join(__dirname, '..')
const SRC = ['src', 'electron']
const DIST = 'renderer'

const bauen = process.argv.includes('--bauen')

function alleDateien (ordner) {
  const raus = []
  const sammle = dir => {
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) sammle(p)
      else if (!p.includes('node_modules')) {
        try { raus.push({ p, mtime: fs.statSync(p).mtimeMs }) } catch (_) {}
      }
    }
  }
  sammle(path.join(wurzel, ordner))
  return raus
}

function pruefe () {
  const probleme = []

  const quellen = SRC.flatMap(o => alleDateien(o))
  const ausgabe = alleDateien(DIST)

  if (!ausgabe.length) {
    probleme.push('renderer/ ist leer - es wurde nie gebaut')
    return { probleme, quellen: quellen.length, ausgabe: 0 }
  }

  const juengsteQuelle = quellen.reduce((m, x) => Math.max(m, x.mtime), 0)
  const juengsterBuild = ausgabe.reduce((m, x) => Math.max(m, x.mtime), 0)
  const juengsteQuelleDatei = quellen.find(x => x.mtime === juengsteQuelle)

  if (juengsteQuelle > juengsterBuild) {
    const sekunden = Math.round((juengsteQuelle - juengsterBuild) / 1000)
    probleme.push(
      `renderer/ ist ${sekunden} Sekunden aelter als ${path.relative(wurzel, juengsteQuelleDatei.p)} - ` +
      'im Build steckt nicht der aktuelle Stand'
    )
  }

  // Der Build muss auch eine gebaute Hauptdatei enthalten.
  const hatIndex = ausgabe.some(a => /renderer[\\/]index\.html$/.test(a.p))
  if (!hatIndex) probleme.push('renderer/index.html fehlt - der Build ist unvollstaendig')

  return { probleme, quellen: quellen.length, ausgabe: ausgabe.length, juengsteQuelle, juengsterBuild }
}

if (bauen) {
  console.log('  === Build wird ausgefuehrt ===')
  const r = spawnSync('npm.cmd', ['run', 'build'], { cwd: wurzel, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.log('')
    console.log('  FEHLER: Der Build ist fehlgeschlagen.')
    process.exit(1)
  }
  console.log('')
}

const erg = pruefe()

console.log('  === Build-Zustand ===')
console.log(`  Quelldateien : ${erg.quellen}`)
console.log(`  Build-Dateien: ${erg.ausgabe}`)
if (erg.juengsteQuelle) {
  console.log(`  neueste Quelle: ${new Date(erg.juengsteQuelle).toISOString()}`)
  console.log(`  neuester Build: ${new Date(erg.juengsterBuild).toISOString()}`)
}
console.log('')

if (erg.probleme.length) {
  for (const p of erg.probleme) console.log('  FEHLER: ' + p)
  console.log('')
  console.log('  ' + erg.probleme.length + ' Problem(e). Mit --bauen wird der Build erneuert.')
  process.exit(1)
}

console.log('  OK   der Build passt zu den Quellen')
process.exit(0)