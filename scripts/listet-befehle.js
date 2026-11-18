'use strict'

/*
 * Listet die Befehle des Core wie er sie selbst auffasst.
 *
 * Aufruf: node scripts/listet-befehle.js [suche]
 *
 * Nutzen: statt mir zu raten, was das Panel haben sollte, lese ich
 * aus der Quelle, die allein die Wahrheit kennt - der laufende Server.
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const store = require('../electron/store')
const desktop = path.join(os.homedir(), 'Desktop', 'config.json')
store.init(fs.existsSync(desktop) ? path.dirname(desktop) : path.join(process.env.APPDATA, 'wowpanel'))
const cfg = store.read().soap

const suche = (process.argv[2] || '').toLowerCase()

function esc (s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function sende (befehl) {
  return new Promise(resolve => {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns1:executeCommand xmlns:ns1="urn:AC">
      <command>${esc(befehl)}</command>
    </ns1:executeCommand>
  </soap:Body>
</soap:Envelope>`
    const req = http.request({
      host: cfg.host, port: cfg.port, path: '/',
      method: 'POST', auth: `${cfg.user}:${cfg.password}`,
      headers: { 'Content-Type':'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body), SOAPAction: 'urn:AC#executeCommand' },
      timeout: 30000
    }, res => {
      let d = ''
      res.on('data', c => { d += c.toString() })
      res.on('end', () => resolve({ status: res.statusCode, t: d }))
    })
    req.on('error', e => resolve({ status: 0, t: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, t: 'TIMEOUT' }) })
    req.write(body); req.end()
  })
}

function text (koerper) {
  const f = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(koerper)
  const r = /<result>([\s\S]*?)<\/result>/.exec(koerper)
  let roh = f ? f[1] : (r ? r[1] : koerper.replace(/<[^>]+>/g, ' '))
  return roh.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .trim()
}

;(async () => {
  console.log(`  Verbindung zu ${cfg.user}@${cfg.host}:${cfg.port}`)
  console.log('')
  const Befehle = [
    '.commands', '.help', '.help ban', '.help config',
    '.help announce', '.help motd', '.help group', '.help guild',
    '.help mail', '.help item', '.help npc', '.commands ban',
  ]
  for (const b of Befehle) {
    const r = await sende(b)
    const t = text(r.t)
    if (!t) continue
    if (suche && !t.toLowerCase().includes(suche) && !b.includes(suche)) continue
    console.log(`  ─── ${b}  (HTTP ${r.status}) ${'─'.repeat(Math.max(0, 20 - b.length))}`)
    for (const z of t.split(/\r?\n/)) {
      const zm = z.trim()
      if (!zm) continue
      console.log('    ' + zm)
    }
    console.log('')
  }
  process.exit(0)
})()