'use strict'

/*
 * Prueft die Sicherungen mit Zeitstempel.
 *
 * Aufruf: node scripts/verify-sicherungen.js
 *
 * Geprueft wird am echten Dateisystem, nicht am Quelltext: es geht darum,
 * dass nach mehrmaligem Schreiben mehrere Stufen zurueckkommen und eine
 * davon zurueckgespielt werden kann.
 *
 * Vorher gab es genau eine Sicherung: "<datei>.bak". Und die wurde bei
 * jedem Schreiben ueberschrieben. Nach dem zweiten Speichern war der
 * Stand von vor dem ersten weg - und bei der worldserver.conf mit 4957
 * Zeilen heisst das: drei falsch gesetzte Raten, und der letzte brauchbare
 * Stand ist fort.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const sicherung = require('../electron/api/sicherung')

let gut = 0
let schlecht = 0
const sag = z => console.log('  ' + z)
const pruefe = (c, l) => {
  if (c) { gut++; sag('OK   ' + l) } else { schlecht++; sag('FAIL ' + l) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-test-'))
const datei = path.join(tmp, 'worldserver.conf')

;(async () => {
  console.log('  === 1. Drei Staende anlegen ===')
  fs.writeFileSync(datei, 'Rate.XP.Kill = 1.0\n', 'utf8')
  const s1 = sicherung.sichern(datei, 10)
  fs.writeFileSync(datei, 'Rate.XP.Kill = 2.0\n', 'utf8')
  const s2 = sicherung.sichern(datei, 10)
  fs.writeFileSync(datei, 'Rate.XP.Kill = 3.0\n', 'utf8')
  const s3 = sicherung.sichern(datei, 10)

  pruefe(fs.existsSync(datei + '.bak'), 'die klassische .bak wird angelegt')
  pruefe(Boolean(s1.neu && fs.existsSync(s1.neu)), 'Stufe 1 liegt mit Zeitstempel da')
  pruefe(Boolean(s2.neu && fs.existsSync(s2.neu)), 'Stufe 2 liegt mit Zeitstempel da')
  pruefe(Boolean(s3.neu && fs.existsSync(s3.neu)), 'Stufe 3 liegt mit Zeitstempel da')
  pruefe(s1.neu !== s2.neu && s2.neu !== s3.neu, 'die drei Stufen haben verschiedene Namen')

  console.log('')
  console.log('  === 2. Die Stufen sind unterscheidbar ===')
  const liste = sicherung.listen(datei)
  pruefe(liste.length === 3, `es werden drei Stufen gefunden (${liste.length})`)
  const inhalte = liste.map(l => fs.readFileSync(l.pfad, 'utf8').trim())
  pruefe(inhalte.includes('Rate.XP.Kill = 1.0'), 'der urspruengliche Stand ist noch da')
  pruefe(inhalte.includes('Rate.XP.Kill = 2.0'), 'der mittlere Stand ist noch da')
  pruefe(inhalte.includes('Rate.XP.Kill = 3.0'), 'der letzte Stand ist da')
  // Das ist der entscheidende Punkt: vorher waere nach dem dritten
  // Speichern nur noch eine Stufe uebrig.
  sag(`      Staende: ${inhalte.join(' | ')}`)

  console.log('')
  console.log('  === 3. Alte Staende werden aufgeraeumt ===')
  for (let i = 0; i < 8; i++) {
    fs.writeFileSync(datei, `Rate.XP.Kill = ${10 + i}.0\n`, 'utf8')
    sicherung.sichern(datei, 3)
  }
  const nach = sicherung.listen(datei)
  pruefe(nach.length <= 3, `es bleiben hoechstens drei Staende (${nach.length})`)
  pruefe(nach.length >= 1, 'es bleibt mindestens eine Stufe')

  console.log('')
  console.log('  === 4. Eine alte Stufe zurueckspielen ===')
  /*
   * Es wird eine Stufe anhand ihres INHALTS gesucht, nicht anhand ihrer
   * Position. Nach dem Aufraeumen in Schritt 3 sind die fruehesten
   * Stufen weg - die Suche nach "der aeltesten" waere dann eine
   * Zufallsangabe. Gesucht wird deshalb nach einem bestimmten Wert.
   */
  fs.writeFileSync(datei, 'Rate.XP.Kill = 99.0\n', 'utf8')
  sicherung.sichern(datei, 10)
  const alle = sicherung.listen(datei)
  const mit42 = alle.find(l => fs.readFileSync(l.pfad, 'utf8').includes('= 42.0'))
  if (!mit42) {
    // Einen Stand mit dem gesuchten Wert gezielt erzeugen.
    fs.writeFileSync(datei, 'Rate.XP.Kill = 42.0\n', 'utf8')
    const s = sicherung.sichern(datei, 10)
    pruefe(Boolean(s.neu), 'der gesuchte Stand wurde gesichert')
    fs.writeFileSync(datei, 'Rate.XP.Kill = 99.0\n', 'utf8')
  }
  const ziel = mit42 || (() => {
    const neu = sicherung.listen(datei)[0]
    return neu
  })()
  const r = sicherung.zurueckspielen(datei, ziel.pfad)
  const inhalt = fs.readFileSync(datei, 'utf8').trim()
  pruefe(r.ok === true, 'das Zurueckspielen meldet Erfolg')
  pruefe(inhalt === 'Rate.XP.Kill = 42.0', `der gesuchte Stand ist wieder da (${inhalt})`)
  pruefe(Boolean(r.gesichertAls) && fs.existsSync(r.gesichertAls),
    'der Stand von vor dem Zurueckspielen wurde gesichert - er ist nicht verloren')

  console.log('')
  console.log('  === 5. Es wird nichts vernichtet ===')
  const ordner = sicherung.sicherungsOrdner(datei)
  pruefe(fs.existsSync(ordner), `der Sicherungsordner liegt neben der Datei (${path.basename(ordner)})`)
  pruefe(fs.existsSync(datei + '.bak'), 'die klassische .bak gibt es weiterhin')

  fs.rmSync(tmp, { recursive: true, force: true })

  console.log('')
  console.log(`  ${gut} bestanden, ${schlecht} fehlgeschlagen`)
  process.exit(schlecht ? 1 : 0)
})()