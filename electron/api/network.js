'use strict'

const net = require('net')
const db = require('../db')
const configEditor = require('./config-editor')

/*
 * IP-Adresse des Servers aendern.
 *
 * Fuer den Login braucht der Client die Adresse des Realms. Die steht an
 * zwei Stellen und beide muessen zusammenpassen:
 *
 *  1. ac_auth.realmlist.address / .port  - was der Client im Realm-Login
 *     als Ziel sieht (Realm-Auswahl im Client, realmist.wtf).
 *  2. worldserver.conf  BindIP / ExternalIP - was der Server selbst bindet
 *     bzw. nach aussen meldet.
 *
 * BindIP = 0.0.0.0 heisst "auf allen Interfaces" und ist fuer die meisten
 * Setups richtig. Geaendert wird hier in der Regel die ExternalIP bzw.
 * die Adresse in der realmlist.
 */

// IPv4, IPv6 oder Hostname
function isValidHost (v) {
  if (!v) return false
  const s = String(v).trim()
  if (!s) return false
  if (net.isIP(s)) return true

  // Reine Ziffern-und-Punkte-Form ist immer eine verklammerte IP.
  // "999.1.1.1" oder "192.168.1" sind Tippfehler, keine Hostnamen -
  // sonst wuerden sie stillschweigend als Adresse gespeichert.
  if (!/[a-zA-Z]/.test(s)) return false

  // Hostname: Labels aus Buchstaben, Ziffern, Bindestrichen
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s)
}

function isPrivateOrLoopback (v) {
  if (net.isIP(v) === 4) {
    const p = String(v).split('.').map(Number)
    if (p[0] === 127) return true
    if (p[0] === 10) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 169 && p[1] === 254) return true
  }
  return false
}

async function get () {
  let realms = []
  let dbError = null
  try {
    realms = await db.query(
      'auth',
      'SELECT id, name, address, port, icon, population FROM realmlist ORDER BY id ASC'
    )
  } catch (e) {
    dbError = e.message
  }

  let bindIp = null
  let externalIp = null
  let realmServerPort = null
  let confError = null
  try {
    const cfg = configEditor.readConfig('world')
    for (const l of cfg.lines) {
      if (l.type !== 'setting') continue
      if (l.key === 'BindIP') bindIp = l.value.replace(/^"|"$/g, '')
      else if (l.key === 'ExternalIP') externalIp = l.value.replace(/^"|"$/g, '')
      else if (l.key === 'RealmServerPort') realmServerPort = Number(l.value)
    }
  } catch (e) {
    confError = e.message
  }

  const first = realms[0]
  return {
    address: first ? first.address : externalIp || '127.0.0.1',
    port: first ? Number(first.port) : realmServerPort || 8085,
    bindIp: bindIp || '0.0.0.0',
    externalIp,
    realms,
    dbError,
    confError
  }
}

/*
 * Adresse in der realmlist aendern.
 * Ohne realmId wird jeder Realm auf die neue Adresse gesetzt - meistens
 * gibt es nur einen, und genau den wollen die Clients sehen.
 */
async function setRealmAddress ({ ip, port, realmId }) {
  const host = String(ip || '').trim()
  if (!isValidHost(host)) {
    throw new Error(
      `Ungültige Adresse: "${ip}". Erlaubt sind IPv4, IPv6 oder ein Hostname (z. B. play.meine-domain.de).`
    )
  }
  const p = Number(port)
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error(`Ungültiger Port: ${port}. Erlaubt sind 1 bis 65535.`)
  }

  let res
  if (realmId) {
    res = await db.execute(
      'auth',
      'UPDATE realmlist SET address = ?, port = ? WHERE id = ?',
      [host, p, Number(realmId)]
    )
  } else {
    res = await db.execute('auth', 'UPDATE realmlist SET address = ?, port = ?', [host, p])
  }

  return {
    ok: true,
    updated: res.affectedRows,
    hint: isPrivateOrLoopback(host)
      ? 'Hinweis:_private Adresse. Von aussen ist der Server damit nicht erreichbar - noetig ist die oeffentliche oder die WAN-IP.'
      : null
  }
}

// BindIP / ExternalIP in der worldserver.conf schreiben
async function setConfIp ({ bindIp, externalIp }) {
  const entries = []
  if (bindIp !== undefined && bindIp !== null && bindIp !== '') {
    if (bindIp === '0.0.0.0' || isValidHost(bindIp)) {
      entries.push({ key: 'BindIP', value: `"${bindIp.trim()}"` })
    } else {
      throw new Error(`Ungültige BindIP: ${bindIp}`)
    }
  }
  if (externalIp !== undefined && externalIp !== null && externalIp !== '') {
    if (externalIp === '0.0.0.0' || isValidHost(externalIp)) {
      entries.push({ key: 'ExternalIP', value: `"${externalIp.trim()}"` })
    } else {
      throw new Error(`Ungültige ExternalIP: ${externalIp}`)
    }
  }
  if (!entries.length) throw new Error('Keine Änderungen übergeben.')

  return configEditor.writeSettings({ file: 'world', entries })
}

module.exports = { get, setRealmAddress, setConfIp, isValidHost, isPrivateOrLoopback }