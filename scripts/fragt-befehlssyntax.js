'use strict'

/*
 * Fragt den Core nach der richtigen Schreibweise seiner Befehle.
 *
 * Aufruf: node scripts/fragt-befehlssyntax.js [name1 name2 ...]
 *
 * Warum: Die Schnellbefehle im Panel waren teilweise falsch. Angegeben
 * wird nur der blanke Befehlsname - der Core gibt darauf die Usage-Zeile
 * aus und tut sonst nichts. Belegt an "server": die Antwort war
 *
 *   ### USAGE: .server
 *   Commands:
 *   - info : Display server version ...
 *
 * Das nennt genau die erwartete Schreibweise. Ohne die Ausfuehrung wird
 * nichts am Server geaendert - mit Ausnahme der Befehle, die auch ohne
 * Argumente etwas tun. Deshalb steht unten ausdruecklich, welche Befehle
 * NICHT angefasst werden.
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const store = require('../electron/store')
const desktop = path.join(os.homedir(), 'Desktop', 'config.json')
store.init(fs.existsSync(desktop) ? path.dirname(desktop) : path.join(process.env.APPDATA, 'wowpanel'))
const cfg = store.read().soap

/*
 * Befehle, die auch ohne Argumente etwas bewirken koennten. Die werden
 * nicht gesendet - bei ihnen waere die Auskunft den Preis nicht wert.
 */
const NICHT_SENDEN = ['shutdown', 'stop', 'exit', 'quit', 'restart', 'saveall']

const ALLE = [
  'gm', 'account', 'ban', 'unban', 'kick', 'tele', 'character', 'npc',
  'gobject', 'send', 'reload', 'save', 'server', 'info', 'level', 'group',
  'appear', 'items', 'delete', 'reset'
]

const gewaehlt = process.argv.length > 2 ? process.argv.slice(2) : ALLE

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
  const roh = f ? f[1] : (r ? r[1] : koerper.replace(/<[^>]+>/g, ' '))
  return roh
    .replace(/&#xD;?/gi, '\r').replace(/&#xA;?/gi, '\n')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

;(async () => {
  console.log(`  Adresse ${cfg.host}:${cfg.port}`)
  console.log(`  Es wird nur der blanke Befehlsname gesendet - das fuehrt nichts aus.`)
  console.log('')
  for (const name of gewaehlt) {
    if (NICHT_SENDEN.includes(name)) {
      console.log(`  [nicht gesendet] ${name} - koennte auch ohne Argumente etwas tun`)
      console.log('')
      continue
    }
    const r = await sende(name)
    console.log(`  ─── ${name} ─── HTTP ${r.status}`)
    const t = text(r.koerper)
    if (!t) { console.log('    (leere Antwort)') } else {
      for (const z of t.split('\n').slice(0, 24)) console.log('    ' + z)
    }
    console.log('')
  }
  process.exit(0)
})()