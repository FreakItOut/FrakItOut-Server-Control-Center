'use strict'

/*
 * Fuehrt alle Pruefungen des Projekts in einem Rutsch aus:
 *
 *   - alle scripts/check-*.js   (statisch, ohne Datenbank)
 *   - scripts/verify-startall.js (Startsequenz mit gemockten Prozessen)
 *
 * Der Rest der verify-* Skripte braucht eine laufende Datenbank oder
 * Electron und gehoert deshalb hier nicht hin - er blockiert sonst jede
 * Automatisierung. Aufruf: node scripts/pruefe-alle.js  (oder npm run pruefe)
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ordner = __dirname
const skripte = fs
  .readdirSync(ordner)
  .filter(n => /^check-.*\.js$/.test(n))
  .sort()
skripte.push('verify-startall.js')
skripte.push('verify-maintenance.js')
skripte.push('verify-profile.js')
skripte.push('verify-clienthelfer.js')
skripte.push('verify-installer-skip.js')
skripte.push('verify-rollback.js')
skripte.push('verify-kontoimport.js')
skripte.push('verify-botfilter.js')
skripte.push('verify-modul-sql.js')
skripte.push('verify-modul-pull.js')

let fehler = 0
for (const name of skripte) {
  const voll = path.join(ordner, name)
  console.log(`\n=== ${name}`)
  const r = spawnSync(process.execPath, [voll], { stdio: 'inherit' })
  if (r.status !== 0) {
    fehler++
    console.log(`!!! ${name} fehlgeschlagen (exit ${r.status})`)
  }
}

console.log('\n' + (fehler ? `${fehler} Pruefskript(e) fehlgeschlagen.` : 'ALLES BESTANDEN.'))
process.exitCode = fehler ? 1 : 0
