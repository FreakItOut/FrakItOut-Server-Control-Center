'use strict'

/*
 * Prueft die SOAP-Anfrage des Panels gegen den laufenden Worldserver.
 *
 * Aufruf: node scripts/verify-soap.js
 *
 * Voraussetzung: der Worldserver laeuft und SOAP.Enabled = 1.
 *
 * Zwei Dinge werden geprueft, und beide sind nicht selbstverstaendlich:
 *
 *   1. Die Anfrage, die das Panel wirklich stellt, bekommt HTTP 200.
 *   2. Die alte Anfrage mit "urn:ExecuteCommand" bekommt HTTP 500.
 *
 * Der zweite Punkt ist der Grund fuer diesen Test. Ein Test, der nur
 * prueft "die Anfrage funktioniert", ist gruen, sobald irgendetwas
 * antwortet - auch dann, wenn der Server aus einem voellig anderen Grund
 * antwortet. Erst der Vergleich mit der bekannten schlechten Variante
 * beweist, dass der Unterschied der Namensraum ist und nicht etwas
 * Zufaelliges.
 *
 * Es wird ausschliesslich der lesende Befehl "server info" gesendet.
 */

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const store = require('../electron/store')

/*
 * Welche Konfiguration wird benutzt?
 *
 * Die ausgelieferte EXE liegt auf dem Desktop und liest die config.json
 * daneben. Der Entwicklungsordner unter %APPDATA% kann davon abweichen -
 * bei ihm zeigte sich, dass dort ein Konto "adm" eingetragen ist, das in
 * der Datenbank gar nicht existiert. Mit dem liefert der Core
 * "401 Unauthorized", und man haelt den Namensraum fuer schuld.
 *
 * Deshalb wird die Desktop-Datei bevorzugt, genau wie es die EXE tut.
 */
const desktop = path.join(os.homedir(), 'Desktop', 'config.json')
const quelle = fs.existsSync(desktop) ? desktop : path.join(process.env.APPDATA, 'wowpanel')
store.init(path.dirname(quelle))

const cfg = store.read().soap

let gut = 0
let schlecht = 0
const sag = z => console.log('  ' + z)
const pruefe = (c, l) => {
  if (c) { gut++; sag('OK   ' + l) } else { schlecht++; sag('FAIL ' + l) }
}

console.log(`  Konfiguration: ${quelle}`)
console.log(`  Adresse ${cfg.host}:${cfg.port}, Benutzer ${cfg.user}`)
console.log('')

function brief (command, ns) {
  const escaped = String(command)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns1:executeCommand xmlns:ns1="${ns}">
      <command>${escaped}</command>
    </ns1:executeCommand>
  </soap:Body>
</soap:Envelope>`
}

function sende (command, ns) {
  return new Promise(resolve => {
    const body = brief(command, ns)
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

// Das, was der Core bei einem Befehl zurueckgibt.
//
// Der Core antwortet mit
//   <ns1:executeCommandResponse><result>...</result></ns1:executeCommandResponse>
// Das Element heisst schlicht "result". Die erste Fassung dieses Tests
// suchte nach "executeCommandResult" und fand nichts - und meldete dann
// "der Server gibt kein Ergebnis zurueck", was eine vollstaendige
// erfolgreiche Antwort war.
function ergebnis (koerper) {
  const m = /<result>([\s\S]*?)<\/result>/.exec(koerper)
  if (!m) return null
  return m[1]
    .replace(/&#xD;?/gi, '\n').replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim()
}

function fault (koerper) {
  const m = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(koerper)
  return m ? m[1].trim() : null
}

;(async () => {
  console.log('=== Die Anfrage des Panels (urn:AC) ===')
  const r = sende('server info', 'urn:AC')
  const gutAntwort = await r
  sag(`HTTP ${gutAntwort.status}`)
  const text = ergebnis(gutAntwort.koerper)
  if (text) {
    for (const z of text.split('\n').slice(0, 6)) sag('     ' + z)
  } else {
    sag('     ' + fault(gutAntwort.koerper))
  }
  sag('')

  pruefe(gutAntwort.status >= 200 && gutAntwort.status < 300,
    `die Anfrage des Panels wird angenommen (HTTP ${gutAntwort.status})`)
  pruefe(Boolean(text), 'der Server gibt ein Ergebnis zurück')
  pruefe(/AzerothCore/i.test(text || ''),
    'das Ergebnis ist die Ausgabe des Befehls und keine Fehlermeldung')

  console.log('')
  console.log('=== Gegenprobe: die alte Anfrage (urn:ExecuteCommand) ===')
  const altAntwort = await sende('server info', 'urn:ExecuteCommand')
  sag(`HTTP ${altAntwort.status}`)
  sag('     ' + (fault(altAntwort.koerper) || '(keine Fault-Meldung)'))
  sag('')

  pruefe(altAntwort.status === 500,
    `die alte Anfrage scheitert weiterhin (HTTP ${altAntwort.status})`)
  pruefe(/not implemented/i.test(fault(altAntwort.koerper) || ''),
    'das Scheitern nennt den Namensraum als Grund')

  console.log('')
  console.log('=== Geprueft wird derselbe Aufruf, den das Panel macht ===')
  const soap = require('../electron/api/soap')
  soap.init(store)
  try {
    const r2 = await soap.send('server info')
    sag(`  Panel: HTTP ${r2.status}, Antwort ${(r2.antwort || '').split('\n')[0]}`)
    pruefe(r2.ok === true, 'das Panel selbst bekommt keine Fehlermeldung')
    pruefe(Boolean(r2.antwort), 'das Panel gibt den Text des Servers weiter')
  } catch (e) {
    sag('  Panel: ' + e.message)
    pruefe(false, 'das Panel selbst kann den Befehl senden')
  }

  console.log('')
  console.log(`  ${gut} bestanden, ${schlecht} fehlgeschlagen`)
  process.exit(schlecht ? 1 : 0)
})()