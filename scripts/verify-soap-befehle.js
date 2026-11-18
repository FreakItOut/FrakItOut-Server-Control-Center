'use strict'

/*
 * Prueft jeden Befehl, den das Panel anbietet, gegen den laufenden Core.
 *
 * Aufruf: node scripts/verify-soap-befehle.js
 *
 * Anlass: Der Schnellbefehl "Serverinfo" schickte "server info 1" und
 * scheiterte mit HTTP 500. Ursache: Die Endung "1" stammt aus der
 * TrinityCore-Doku, wo "server info" ein Argument erwartet. AzerothCore
 * erwartet keines und weist jeden Zusatz als falsche Verwendung ab.
 *
 * Geprueft wird, was der Server wirklich antwortet - nicht, was im Quelltext
 * steht. Ein Schnellbefehl, der im Code korrekt aussieht und den der Core
 * trotzdem nicht kennt, ist genau der Fall, der vorher unentdeckt blieb.
 *
 * Wie geprueft wird, ohne etwas zu veraendern:
 *
 *   Lesebefehle werden vollstaendig gesendet - "server info" aendert nichts.
 *
 *   Befehle mit Nebenwirkungen werden NICHT gesendet. Stattdessen wird nur
 *   der bloße Befehlsname ohne Argumente geschickt. Der Core gibt darauf
 *   dieusage-Zeile aus und tut sonst nichts - belegt an "server", das so
 *   nur "### USAGE: .server ..." lieferte. Damit ist der Name geprueft,
 *   ohne einen Spieler zu bannen oder den Server zu beenden.
 *
 *   "shutdown" wird gar nicht angefasst. Bei diesem Befehl waere der
 *   blosse Name zu viel Risiko fuer den kleinen Gewinn.
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const store = require('../electron/store')
const desktop = path.join(os.homedir(), 'Desktop', 'config.json')
store.init(fs.existsSync(desktop) ? path.dirname(desktop) : path.join(process.env.APPDATA, 'wowpanel'))
const cfg = store.read().soap

// Die Befehle aus den Quellen lesen, statt sie hier zu wiederholen. Sonst
// prueft der Test eine Liste, die nicht mehr der des Panels entspricht.
function liesAus (datei, muster) {
  const s = fs.readFileSync(path.join(__dirname, '..', datei), 'utf8')
  return [...s.matchAll(muster)].map(m => m[1])
}

const PRESETS = liesAus('src/pages/Console.jsx', /cmd:\s*'([^']+)'/g)
const QUICK = liesAus('src/pages/Online.jsx', /cmd:\s*'([^']+)'/g)

console.log(`  Adresse ${cfg.host}:${cfg.port}, Benutzer ${cfg.user}`)
console.log(`  Schnellbefehle (Konsole): ${PRESETS.length}`)
console.log(`  Schnellaktionen (Online) : ${QUICK.length}`)
console.log('')

function brief (command) {
  const escaped = String(command)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns1:executeCommand xmlns:ns1="urn:AC">
      <command>${escaped}</command>
    </ns1:executeCommand>
  </soap:Body>
</soap:Envelope>`
}

function sende (command) {
  return new Promise(resolve => {
    const body = brief(command)
    const req = http.request({
      host: cfg.host,
      port: cfg.port,
      path: '/',
      method: 'POST',
      auth: `${cfg.user}:${cfg.password}`,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        SOAPAction: 'urn:ExecuteCommand'
      },
      timeout: 15000
    }, res => {
      let d = ''
      res.on('data', c => { d += c.toString() })
      res.on('end', () => resolve({ status: res.statusCode, koerper: d }))
    })
    req.on('error', e => resolve({ status: 0, koerper: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, koerper: 'Timeout' }) })
    req.write(body)
    req.end()
  })
}

function text (koerper) {
  const f = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(koerper)
  const r = /<result>([\s\S]*?)<\/result>/.exec(koerper)
  const roh = f ? 'FAULT: ' + f[1] : (r ? r[1] : koerper.replace(/<[^>]+>/g, ' '))
  return roh
    .replace(/&#xD;?/gi, '\n').replace(/&#xA;?/gi, '\n')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ').trim()
}

// Namen und Handgriffe, die nichts bewirken
const NEBENWIRKUNG = ['gm', 'ban', 'unban', 'reload', 'save']

/*
 * Befehle, die den Server anhalten, werden NIE gesendet - auch nicht
 * teilweise.
 *
 * Vorher stand hier eine Liste mit "shutdown". Das war zu kurz: der Name
 * wird aus dem ERSTEN Wort gebildet, und der Preset lautet
 * "server shutdown 1 0" - dessen erstes Wort ist "server". Der Test hat
 * ihn deshalb fuer einen Lesebefehl gehalten und wirklich gesendet. Der
 * Worldserver ist dabei orderly heruntergefahren - das Log endet mit
 * "All connections on DatabasePool closed".
 *
 * Geprueft wird deshalb der GESAMTE Befehl, nicht sein erstes Wort.
 */
function haeltServerAn (cmd) {
  return /^\s*\.?\s*(?:server\s+shutdown|shutdown)\b/i.test(String(cmd))
}

let gut = 0
let schlecht = 0
const sag = z => console.log('  ' + z)
const pruefe = (c, l) => {
  if (c) { gut++; sag('OK   ' + l) } else { schlecht++; sag('FAIL ' + l) }
}

function nameVon (cmd) {
  return String(cmd).trim().split(/\s+/)[0].replace(/^\./, '').toLowerCase()
}

;(async () => {
  sag('=== Schnellbefehle der Konsole ===')
  for (const cmd of PRESETS) {
    const name = nameVon(cmd)
    if (haeltServerAn(cmd)) {
      /*
       * Die Schreibweise wird trotzdem geprueft - aber am blassen Befehls-
       * namen, nicht am Befehl selbst. "server" ohne Argumente gibt nur
       * die usage-Zeile aus und beendet nichts.
       */
      const r = await sende('server')
      const t = text(r.koerper)
      const kenntShutdown = /server shutdown/i.test(t)
      pruefe(kenntShutdown, `"${cmd}" - der Core kennt "server shutdown" (nur "server" gesendet)`)
      sag(`      ${t.split('\n').filter((z) => /shutdown/i.test(z))[0] || '(keine Zeile mit shutdown)'}`)
      continue
    }
    if (NEBENWIRKUNG.includes(name)) {
      // Nur der Name, ohne Argumente: der Core gibt die usage aus.
      const r = await sende(name)
      const t = text(r.koerper)
      const bekannt = !/does not exist/i.test(t)
      pruefe(bekannt, `"${cmd}" - Befehl "${name}" ist dem Core bekannt (nur Name gesendet)`)
      if (!bekannt) sag(`      Server: ${t.slice(0, 100)}`)
      continue
    }
    // Lesebefehl: vollstaendig senden
    const r = await sende(cmd)
    const t = text(r.koerper)
    const gut2 = r.status >= 200 && r.status < 300
    pruefe(gut2, `"${cmd}" wird angenommen (HTTP ${r.status})`)
    sag(`      ${t.split('\n')[0].slice(0, 100)}`)
  }

  sag('')
  sag('=== Schnellaktionen der Online-Seite ===')
  for (const cmd of QUICK) {
    const name = nameVon(cmd)
    // Platzhalter durch einen Namen ersetzen, den es nicht gibt - so
    // greift der Befehl ins Leere, statt jemanden zu treffen.
    const mitPlatzhalter = cmd.includes('{name}')
    if (haeltServerAn(cmd)) {
      sag(`SKIP ${cmd}   - Befehl beendet den Server, wird nicht gesendet`)
      continue
    }
    if (NEBENWIRKUNG.includes(name) && !mitPlatzhalter) {
      const r = await sende(name)
      const bekannt = !/does not exist/i.test(text(r.koerper))
      pruefe(bekannt, `"${cmd}" - Befehl "${name}" ist dem Core bekannt (nur Name gesendet)`)
      continue
    }
    if (mitPlatzhalter) {
      // Es wird nichts gesendet. Geprueft wird nur, ob es den Befehl
      // ueberhaupt gibt - dazu wird der Name ohne Platzhalter geprueft.
      const r = await sende(name)
      const bekannt = !/does not exist/i.test(text(r.koerper))
      pruefe(bekannt, `"${cmd}" - Befehl "${name}" ist dem Core bekannt (nur Name gesendet)`)
      if (!bekannt) sag(`      Server: ${text(r.koerper).slice(0, 100)}`)
      continue
    }
    const r = await sende(cmd)
    pruefe(r.status >= 200 && r.status < 300, `"${cmd}" wird angenommen (HTTP ${r.status})`)
  }

  sag('')
  sag(`  ${gut} bestanden, ${schlecht} fehlgeschlagen`)
  process.exit(schlecht ? 1 : 0)
})()
