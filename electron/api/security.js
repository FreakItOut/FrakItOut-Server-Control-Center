'use strict'

/*
 * Kontosicherheit: eine Sicht auf Daten, die das Panel ohnehin schon
 * liest (GM-Stufe, Sperre, Fehlanmeldungen, letzte IP, letztes Login).
 * Es wird nichts veraendert - Aktionen laufen ueber die vorhandenen
 * Konto-Routen (setLocked, setGmLevel, setPassword).
 */

const accounts = require('./accounts')

const TAG_MS = 24 * 60 * 60 * 1000

function tageSeit (iso) {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor((Date.now() - ms) / TAG_MS)
}

function kurz (a) {
  return {
    id: a.id,
    username: a.username,
    gmlevel: a.gmlevel,
    lastLogin: a.lastLogin,
    lastIp: a.lastIp,
    locked: a.locked,
    failedLogins: a.failedLogins,
    email: a.email,
    online: a.online,
    banned: a.banned
  }
}

async function uebersicht () {
  // Bot-Konten wuerden die IP-Gruppen und "ohne E-Mail" fluten - fuer
  // Sicherheitsfragen sind nur echte Konten interessant.
  const alle = await accounts.listAccounts({ ohneBots: true })
  const gm = alle.filter(a => Number(a.gmlevel) >= 1)
  const gesperrt = alle.filter(a => a.locked)
  const fehlversuche = alle.filter(a => Number(a.failedLogins) > 0)
  const ohneEmail = alle.filter(a => !a.email)
  const inaktiv = alle.filter(a => {
    const tage = tageSeit(a.lastLogin)
    return tage === null || tage >= 90
  })

  const ipMap = new Map()
  for (const a of alle) {
    const ip = String(a.lastIp || '').trim()
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') continue
    if (!ipMap.has(ip)) ipMap.set(ip, [])
    ipMap.get(ip).push(a)
  }
  const ipGruppen = [...ipMap.entries()]
    .map(([ip, konten]) => ({ ip, konten: konten.map(kurz) }))
    .filter(g => g.konten.length > 1)
    .sort((a, b) => b.konten.length - a.konten.length)
    .slice(0, 20)

  const sortiert = liste => liste
    .slice()
    .sort((a, b) => String(a.username).localeCompare(String(b.username)))
    .slice(0, 100)
    .map(kurz)

  return {
    stand: new Date().toISOString(),
    gesamt: alle.length,
    zahlen: {
      gm: gm.length,
      gesperrt: gesperrt.length,
      fehlversuche: fehlversuche.length,
      ohneEmail: ohneEmail.length,
      inaktiv: inaktiv.length,
      ipGruppen: ipGruppen.length
    },
    gm: sortiert(gm),
    gesperrt: sortiert(gesperrt),
    fehlversuche: sortiert(fehlversuche),
    ohneEmail: sortiert(ohneEmail),
    inaktiv: sortiert(inaktiv),
    ipGruppen
  }
}

module.exports = { uebersicht }
