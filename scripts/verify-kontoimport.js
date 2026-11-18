'use strict'

/*
 * Testet die Spalten-Schnittmenge des Konto-Imports: Nur Felder, die auf
 * BEIDEN Seiten existieren, wandern in das INSERT IGNORE. Reine Funktion,
 * keine Datenbank.
 */

let failures = 0
const check = (c, l) => {
  console.log((c ? '  OK   ' : '  FAIL ') + l)
  if (!c) failures++
}
const section = t => console.log('\n=== ' + t + ' ===')

function main () {
  const installer = require('../electron/api/installer')
  const { gemeinsameSpalten } = installer.__intern

  section('1. Voll kompatible Schemata: alle Spalten gemeinsam')
  const ziel = ['id', 'username', 'salt', 'verifier', 'email', 'last_ip']
  const quelle = ['id', 'username', 'salt', 'verifier', 'email', 'last_ip', 'sha_pass_hash']
  const r1 = gemeinsameSpalten(ziel, quelle)
  check(JSON.stringify(r1) === JSON.stringify(ziel), `gemeinsame Spalten = Zielspalten (${r1.join(', ')})`)

  section('2. Älteres Repack-Schema (sha_pass_hash statt salt/verifier)')
  const zielNeu = ['id', 'username', 'salt', 'verifier', 'email']
  const quelleAlt = ['id', 'username', 'sha_pass_hash', 'email', 'locked']
  const r2 = gemeinsameSpalten(zielNeu, quelleAlt)
  check(r2.includes('id') && r2.includes('username') && r2.includes('email'), 'id/username/email übernommen')
  check(!r2.includes('salt') && !r2.includes('verifier') && !r2.includes('sha_pass_hash'), 'Passwortfelder beider Formate ausgeschlossen')

  section('3. Übergeben werden mysql2-Zeilen (Field-Objekte) genauso wie Strings')
  const objektForm = gemeinsameSpalten(
    [{ Field: 'id' }, { Field: 'username' }],
    [{ Field: 'id' }, { Field: 'username' }, { Field: 'etwas_andres' }]
  )
  check(objektForm.length === 2 && objektForm[0] === 'id', 'Objektform (Field) funktioniert')

  section('4. Randfälle: leere/verschiedene Schemata')
  check(gemeinsameSpalten([], []).length === 0, 'leere Eingabe -> leere Liste')
  check(gemeinsameSpalten(['id'], []).length === 0, 'leere Quelle -> nichts übernehmen')
  check(gemeinsameSpalten([], ['id']).length === 0, 'leeres Ziel -> nichts übernehmen')

  section('5. Reihenfolge folgt dem ZIEL (für das INSERT-Statement)')
  const r5 = gemeinsameSpalten(['b', 'a', 'c'], ['c', 'a', 'b', 'extra'])
  check(JSON.stringify(r5) === JSON.stringify(['b', 'a', 'c']), 'Zielreihenfolge erhalten')
}

main()
