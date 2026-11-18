'use strict'

/*
 * Prueft, dass das Panel nur solche SOAP-Schluessel nennt, die es in der
 * worldserver.conf wirklich gibt - und dass die Ports zusammenpassen.
 *
 * Aufruf: node scripts/check-soap-angaben.js
 *
 * Anlass: Die Seite "Konsole" und die Einstellungen sagten dem Anwender,
 * er solle SOAP.enable, SOAP.login und SOAP.password setzen. Keines dieser
 * drei Schluessel existiert in der worldserver.conf. Wer der Anleitung
 * folgte, konnte den Fehler "SOAP nicht erreichbar" nie loswerden, ohne
 * zu verstehen, warum.
 *
 * Geprueft wird gegen die echte Datei, nicht gegen eine Liste hier im
 * Skript: die gueltigen Schluessel liest das Skript aus der Conf. Aendert
 * der Core seinen Aufbau, faellt der Test auf - statt still zu stimmen.
 */

const fs = require('fs')
const path = require('path')

const WURZEL = path.join(__dirname, '..')

function liesConfig () {
  // Der Pfad steht in der Konfiguration neben der EXE bzw. im
  // Anwendungsordner. Ohne ihn laesst sich nichts pruefen - dann sagt
  // der Test das auch, statt zu raten.
  const kandidaten = [
    path.join(process.env.APPDATA || '', 'wowpanel', 'config.json'),
    path.join(process.env.USERPROFILE || '', 'Desktop', 'config.json')
  ]
  for (const k of kandidaten) {
    try {
      const c = JSON.parse(fs.readFileSync(k, 'utf8'))
      const s = c.server || {}
      const conf = s.worldConfDir && path.join(s.worldConfDir, 'worldserver.conf')
      if (conf && fs.existsSync(conf)) return { conf, cfg: c, quelle: k }
    } catch (_) {}
  }
  return null
}

const gefunden = liesConfig()
if (!gefunden) {
  console.log('  FEHLER: Keine worldserver.conf gefunden.')
  console.log('  Der Test vergleicht mit der echten Datei und erfindet keine Schluessel.')
  process.exit(1)
}

const confText = fs.readFileSync(gefunden.conf, 'utf8')
console.log(`  Verglichen mit: ${gefunden.conf}`)
console.log(`  Panel-Konfiguration: ${gefunden.quelle}`)
console.log('')

// Welche SOAP-Schluessel gibt es wirklich?
const echteSchluessel = new Set()
for (const m of confText.matchAll(/^\s*(SOAP\.\w+)\s*=/gm)) {
  echteSchluessel.add(m[1])
}

// Und welchen Port nennt die Conf?
const portTreffer = /^\s*SOAP\.Port\s*=\s*"?(\d+)"?/m.exec(confText)
const confPort = portTreffer ? Number(portTreffer[1]) : null

console.log('  Die worldserver.conf kennt:')
for (const k of [...echteSchluessel].sort()) console.log(`    ${k}`)
console.log(`    (Port laut Conf: ${confPort})`)
console.log('')

let schlecht = 0
const pruefe = (c, l) => {
  if (c) console.log('  OK   ' + l)
  else { schlecht++; console.log('  FAIL ' + l) }
}

/*
 * Welche Schluessel nennt das Panel dem Anwender? Gesucht wird in dem,
 * was tatsaechlich angezeigt wird - Kommentare zaehlen nicht mit, denn die
 * sieht niemand.
 */
const ORTE = [
  { datei: 'src/pages/Console.jsx', muster: /SOAP\.\w+/g },
  { datei: 'src/pages/Settings.jsx', muster: /SOAP\.\w+/g }
]

console.log('=== Angezeigte Schluessel ===')
for (const o of ORTE) {
  const p = path.join(WURZEL, o.datei)
  const text = fs.readFileSync(p, 'utf8')
  // Kommentarzeilen entfernen: was in /* ... */ oder // steht, sieht
  // der Anwender nicht.
  const sichtbar = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*'))
    .join('\n')
  const genannt = new Set((sichtbar.match(o.muster) || []))
  console.log(`  ${o.datei}`)
  for (const k of [...genannt].sort()) {
    const gut = echteSchluessel.has(k)
    console.log(`    ${gut ? 'OK  ' : 'FALSCH'}  ${k}`)
    if (!gut) schlecht++
  }
  if (!genannt.size) console.log('    (nennt keine)')
}

// Und die Voreinstellung des Panels gegen die Vorgabe des Cores.
console.log('')
console.log('=== Port in der Voreinstellung ===')
const storeText = fs.readFileSync(path.join(WURZEL, 'electron', 'store.js'), 'utf8')
const storePort = /soap:[\s\S]*?port:\s*(\d+)/.exec(storeText)
const wert = storePort ? Number(storePort[1]) : null
console.log(`  store.js (Voreinstellung) : ${wert}`)
console.log(`  worldserver.conf          : ${confPort}`)
pruefe(wert !== null && confPort !== null && wert === confPort,
  `die Voreinstellung nennt denselben Port wie der Core (${wert} / ${confPort})`)

// Und die Konfiguration, die tatsaechlich benutzt wird.
console.log('')
console.log('=== Benutzte Konfiguration ===')
const benutzt = gefunden.cfg.soap || {}
console.log(`  soap.port    : ${benutzt.port}`)
console.log(`  soap.enabled : ${benutzt.enabled}`)
console.log(`  soap.host    : ${benutzt.host}`)
pruefe(Number(benutzt.port) === confPort,
  `die Konfiguration spricht den Port des Cores an (${benutzt.port} / ${confPort})`)

// Ist SOAP in der Conf ueberhaupt eingeschaltet?
const enabledTreffer = /^\s*SOAP\.Enabled\s*=\s*(\d+)/m.exec(confText)
const enabled = enabledTreffer ? Number(enabledTreffer[1]) : null
console.log('')
console.log('=== Zustand in der worldserver.conf ===')
console.log(`  SOAP.Enabled = ${enabled}`)
pruefe(enabled === 1, 'SOAP ist in der worldserver.conf eingeschaltet')

console.log('')
console.log(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
process.exit(schlecht ? 1 : 0)