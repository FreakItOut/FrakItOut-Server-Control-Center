'use strict'

const http = require('http')

// AzerothCore SOAP-Schnittstelle fuer Konsolenbefehle.
// Voraussetzung in worldserver.conf:
//   SOAP.Enabled = 1
//   SOAP.IP      = "127.0.0.1"
//   SOAP.Port    = 7878
//
// Der Namensraum im Briefkoerper ist "urn:AC". Mit "urn:ExecuteCommand"
// antwortet der Core mit HTTP 500 und dem Text
//   Method 'ns1:executeCommand' not implemented: method name or namespace
//   not recognized
//
// Der Kopf SOAPAction darf beliebig sein: mit "urn:AC#executeCommand", mit
// "urn:ExecuteCommand" und ganz ohne Kopf liefert derselbe Befehl HTTP
// 200. Es ist allein der Namensraum.
// (SOAP.Login und SOAP.Password gibt es in der worldserver.conf nicht - weder
//  in ihr noch in der .dist. Wer die Rechte braucht, gibt dem Konto GM-Stufe 3.)

let store = null
function init (storeRef) {
  store = storeRef
}

/*
 * XML-Zeichenreferenzen lesbar machen. Der Core antwortet mit &#xD; fuer
 * Zeilenumbrueche und &quot; fuer Anfuehrungszeichen - unaufgeloest sieht
 * jede Serverantwort unlesbar aus.
 *
 * Die Reihenfolge ist wichtig. Die erste Fassung ersetzte &#xD; direkt
 * durch "\n". Der Koerper des Core enthaelt aber "&#xD;" und danach einen
 * echten Zeilenumbruch - das ist die Ausgabe von "server info":
 *
 *   ...(Win64, RelWithDebInfo, Static)&#xD;
 *   Connected players: 0.
 *
 * Aus einem Zeilenumbruch wurden damit zwei, und die Ausgabe bekam
 * zwischen jeder Zeile eine Leerzeile. Deshalb erst nach "\r" wandeln und
 * danach die Paare zusammenlegen.
 */
function lesbar (text) {
  return String(text)
    .replace(/&#xD;?/gi, '\r')
    .replace(/&#xA;?/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    // "&#xD;" gefolgt von einem echten Umbruch ergibt jetzt \r\n - das
    // ist ein Umbruch, kein zweiter.
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/*
 * Was sagt der Server? Bei HTTP 500 steckt die Erklaerung im Koerper -
 * "Method not implemented" ist die einzige brauchbare Spur.
 *
 * Vorher wurde der Koerper weggeworfen und stattdessen geraten
 * ("Ist SOAP.enable=1?"). Bei diesem Fehler war SOAP aktiv und richtig
 * eingestellt; geraten wurde daneben. Genau davor hat der erste Versuch
 * mit dem falschen Namensraum gestanden, und niemand konnte sehen,
 * worum es eigentlich ging.
 */
function serverSagt (body) {
  if (!body) return ''
  // Fehler: die Erklaerlung steckt im <faultstring>.
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(body)
  if (fault) return lesbar(fault[1]).trim()
  /*
   * Erfolg: die Ausgabe steckt im <result>. Das muss ausdruecklich
   * geholt werden.
   *
   * Die erste Fassung nahm bei Erfolg den ganzen Briefkopf, machte die
   * Marken zu Leerzeichen und schnitt nach 300 Zeichen ab - die Antwort
   * von "server info" endete mitten im Satz bei "Last 500 d". Die
   * Oberflaeche bekam also eine halbe Antwort zu sehen.
   */
  const result = /<result>([\s\S]*?)<\/result>/.exec(body)
  if (result) return lesbar(result[1]).trim()
  // Irgendetwas anderes: dann eben flach, aber nur als Notnagel.
  const flach = lesbar(body.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim()
  return flach.slice(0, 300)
}

function buildEnvelope (command) {
  const escaped = String(command)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns1:executeCommand xmlns:ns1="urn:AC">
      <command>${escaped}</command>
    </ns1:executeCommand>
  </soap:Body>
</soap:Envelope>`
}

function send (command) {
  return new Promise((resolve, reject) => {
    // Ohne Hintergrundpaket (z. B. frisch installiert) kann der Eintrag fehlen.
    // Dann mit den Standardwerten arbeiten, statt mit "null" abzustuerzen.
    const soap = store.read().soap || {}
    const host = soap.host || '127.0.0.1'
    const port = Number(soap.port) || 7878
    const body = buildEnvelope(command)

    const req = http.request(
      {
        host,
        port,
        path: '/',
        method: 'POST',
        auth: `${soap.user || ''}:${soap.password || ''}`,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: 'urn:ExecuteCommand'
        },
        timeout: 10000
      },
      res => {
        let data = ''
        res.on('data', c => {
          data += c.toString()
        })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, antwort: serverSagt(data) })
          } else {
            // Die Meldung des Servers mitgeben. Ohne sie bleibt nur eine
            // Fehlernummer, und die fuehrt nicht weiter.
            const sagt = serverSagt(data)
            reject(new Error(
              sagt
                ? `SOAP antwortete mit HTTP ${res.statusCode}: ${sagt}`
                : `SOAP antwortete mit HTTP ${res.statusCode}. Ist SOAP.Enabled = 1 und stimmt der Port?`
            ))
          }
        })
      }
    )

    req.on('error', e => {
      reject(new Error(`SOAP nicht erreichbar (${e.message}).`))
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('SOAP-Timeout.'))
    })

    req.write(body)
    req.end()
  })
}

/*
 * SOAP-Zugang neu anlegen: frisches 16-Zeichen-Passwort (der Core lehnt
 * laengere ab), SRP6-Verifier in der Auth-Datenbank neu schreiben, die
 * Panel-Konfiguration und install-state.json mitziehen. Fehlt das Konto
 * komplett, wird es angelegt - mit GM-Stufe 3, damit die Konsole Befehle
 * annehmen darf.
 */
async function zugangNeuSetzen () {
  const crypto = require('crypto')
  const db = require('./db')
  const fs = require('fs')
  const path = require('path')
  const { calculateVerifier } = require('./accounts')

  const cfg = store.read().soap || {}
  const user = String(cfg.user || 'SOAP').trim() || 'SOAP'
  const zeichen = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(16)
  let neu = ''
  for (const b of bytes) neu += zeichen[b % zeichen.length]

  const salt = crypto.randomBytes(32)
  const verifier = calculateVerifier(user, neu, salt)

  let id = null
  try {
    const zeilen = await db.execute('auth', 'SELECT id FROM account WHERE username = ?', [user])
    if (zeilen && zeilen.length) {
      id = zeilen[0].id
      await db.execute('auth', 'UPDATE account SET salt = ?, verifier = ? WHERE id = ?', [salt, verifier, id])
    } else {
      const res = await db.execute(
        'auth',
        'INSERT INTO account (username, salt, verifier, email, reg_mail, last_ip) VALUES (?, ?, ?, ?, ?, ?)',
        [user, salt, verifier, '', '', '127.0.0.1']
      )
      id = res && res.insertId
    }
  } catch (e) {
    throw new Error(`Konto konnte nicht geschrieben werden: ${e.message}`)
  }

  try {
    const spalten = await db.execute('auth', 'SHOW COLUMNS FROM account_access')
    const hatKommentar = Array.isArray(spalten) && spalten.some(s => s.Field === 'comment')
    const sql = hatKommentar
      ? "INSERT INTO account_access (id, gmlevel, RealmID, comment) VALUES (?, 3, -1, 'Panel') ON DUPLICATE KEY UPDATE gmlevel = 3"
      : 'INSERT INTO account_access (id, gmlevel, RealmID) VALUES (?, 3, -1) ON DUPLICATE KEY UPDATE gmlevel = 3'
    await db.execute('auth', sql, [id])
  } catch (_) {}

  store.write({ soap: { user, password: neu } })

  // install-state.json des Servers mitziehen, falls das Panel auf einen
  // AzerothCore-Install zeigt - sonst schreibt das naechste Update das alte
  // Passwort zurueck.
  try {
    const root = (store.read().server || {}).rootDir
    const zustand = root ? path.join(root, 'install-state.json') : ''
    if (root && fs.existsSync(zustand)) {
      const daten = JSON.parse(fs.readFileSync(zustand, 'utf8'))
      if (daten && daten.soap && typeof daten.soap === 'object') {
        daten.soap.user = user
        daten.soap.password = neu
        fs.writeFileSync(zustand, JSON.stringify(daten, null, 2), 'utf8')
      }
    }
  } catch (_) {}

  return { ok: true, user, password: neu }
}

module.exports = { init, send, zugangNeuSetzen }