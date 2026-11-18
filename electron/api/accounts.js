'use strict'

const db = require('../db')
const schema = require('../db-schema')
const crypto = require('crypto')
const net = require('net')

function int (v, fallback = 0) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/*
 * Die Kontoverwaltung muss sich nach dem Schema der installierten
 * AzerothCore-Variante richten. Je nach Fork ist der GM-Level an
 * unterschiedlichen Stellen:
 *
 *   - Spalte "gmlevel" direkt in "account"          (aeltere Builds)
 *   - Tabelle "account_access" mit "gmlevel"         (neuere Builds, u. a. 4.4.5)
 *
 * Ausserdem ist "salt" je nach Version binary(16) oder binary(32), und
 * das Passwort wird als Roh-Binary gespeichert, nicht als Base64-Text.
 * Deshalb wird das Schema einmalig ausgelesen und zwischengespeichert.
 *
 * Die Stolperfalle ist die Spalte "RealmID" in account_access: der Kern
 * liest sie mit RealmID IN (-1, eigeneRealmID) und übersieht alles
 * andere. Siehe ALLE_REICHE weiter unten.
 */

let schemaCache = null

async function accountSchema () {
  if (schemaCache) return schemaCache

  let cols = {}
  try {
    const rows = await db.query('auth', 'SHOW COLUMNS FROM account')
    for (const r of rows) cols[r.Field] = r.Type
  } catch (_) {}

  let access = {}
  try {
    const rows = await db.query('auth', 'SHOW COLUMNS FROM account_access')
    for (const r of rows) access[r.Field] = r.Type
  } catch (_) {}

  const lenOf = t => {
    const m = String(t || '').match(/\((\d+)\)/)
    return m ? Number(m[1]) : 0
  }

  const schema = {
    cols,
    hasUsername: 'username' in cols,
    hasGmLevel: 'gmlevel' in cols,
    saltLen: lenOf(cols.salt) || 32,
    hasEmail: 'email' in cols,
    hasRegMail: 'reg_mail' in cols,
    hasJoinDate: 'joindate' in cols,
    lastIpCol: 'last_ip' in cols ? 'last_ip' : ('joinIp' in cols ? 'joinIp' : null),

    // account_access
    access: Object.keys(access).length > 0,
    accessGm: 'gmlevel' in access,
    // je nach Fork heisst die Referenz auf den Account "account" oder "id"
    accessAccountCol: 'account' in access ? 'account' : ('id' in access ? 'id' : null),
    accessRealmCol:
      'RealmID' in access ? 'RealmID' : 'realm_id' in access ? 'realm_id' : 'instance_id' in access ? 'instance_id' : null,
    accessHasComment: 'comment' in access
  }

  /*
   * Leeres Schema NICHT cachen: War die Datenbank beim ersten Aufruf
   * gerade nicht erreichbar, bliebe sonst ein leeres Schema für die ganze
   * Session hängen und jede Konto-Operation bräche mit "keine Spalte"-Fehlern.
   */
  if (schema.hasUsername) schemaCache = schema
  return schema
}

/*
 * In welche Spalte "RealmID" der GM-Level gehört.
 *
 * Der Kern liest den Level beim Einloggen über folgenden Join
 * (AzerothCore, src/server/game/Server/WorldSocket.cpp, struct AccountInfo):
 *
 *   LEFT JOIN account_access aa ON a.id = aa.AccountID
 *                            AND aa.RealmID IN (-1, ?)
 *
 * "?" ist die ID des eigenen Reiches, auf diesem System kommt sie aus
 * realmlist.id (hier 1). Ein Eintrag auf RealmID = 0 passt zu keiner der
 * beiden Stellen: der Join findet nichts, aa.gmlevel bleibt NULL, und der
 * Account steigt als normaler Spieler ein - ohne Meldung, ohne Fehler.
 * Genau daran ist der Konto 192 ("SOAP", vom Panel angelegt) haengenge-
 * blieben: in der Tabelle steht gmlevel = 3, gelesen wird NULL.
 *
 * -1 heißt "alle Reiche", ist die Vorgabe der Spalte und das, was die
 * Konsole mit ".account set gmlevel <konto> <level> -1" schreibt. Deshalb
 * schreibt das Panel -1: es gilt sofort und gilt auch noch, wenn spaeter
 * ein zweites Reich dazukommt.
 */
const ALLE_REICHE = -1

/*
 * Die IDs der Reiche, so wie der Kern sie abfragt. Wird nur gebraucht, um
 * beim Anzeigen zu entscheiden, ob ein Eintrag überhaupt gilt - nicht zum
 * Schreiben.
 */
let realmCache = null
async function realmIds () {
  if (realmCache) return realmCache
  realmCache = []
  try {
    const rows = await db.query('auth', 'SELECT id FROM realmlist')
    for (const r of rows) realmCache.push(int(r.id))
  } catch (_) {}
  return realmCache
}

function invalidateSchema () {
  schemaCache = null
  realmCache = null
  // Auch den gemeinsamen Zwischenspeicher leeren - sonst bleibt er auf dem
  // alten Server stehen, wenn der Assistent gerade auf einen anderen zeigt.
  schema.leeren()
}

/*
 * Wo liegt der GM-Level und wie wird er geschrieben?
 */
async function setGmLevelRaw (accountId, level) {
  const s = await accountSchema()
  if (s.hasGmLevel) {
    await db.execute('auth', 'UPDATE account SET gmlevel = ? WHERE id = ?', [level, accountId])
    return
  }
  if (s.access && s.accessGm && s.accessAccountCol) {
    const existing = await db.query(
      'auth',
      `SELECT * FROM account_access WHERE ${s.accessAccountCol} = ?`,
      [accountId]
    )
    if (existing.length) {
      // Auch die RealmID mitschreiben. Ein Eintrag, der schon auf 0 liegt,
      // bleibt sonst weiterhin unsichtbar fuer den Kern - auch wenn der
      // Level jetzt stimmt. -1 heißt "alle Reiche", dabei geht nichts
      // verloren.
      await db.execute(
        'auth',
        `UPDATE account_access SET gmlevel = ?, ${s.accessRealmCol || 'RealmID'} = ? WHERE ${s.accessAccountCol} = ?`,
        [level, ALLE_REICHE, accountId]
      )
    } else {
      const parts = [s.accessAccountCol, 'gmlevel']
      const vals = [accountId, level]
      if (s.accessRealmCol) {
        parts.push(s.accessRealmCol)
        vals.push(ALLE_REICHE)
      }
      if (s.accessHasComment) {
        parts.push('comment')
        vals.push('Panel')
      }
      await db.execute('auth', `INSERT INTO account_access (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`, vals)
    }
    return
  }
  throw new Error('GM-Level konnte nicht gesetzt werden - keine passende Spalte gefunden.')
}

async function readGmLevels () {
  const s = await accountSchema()
  if (s.hasGmLevel) return {}
  if (s.access && s.accessGm && s.accessAccountCol) {
    try {
      /*
       * Nur die Eintraege, die der Kern beim Einloggen wirklich liest.
       * Ohne diese Einschränkung zählt ein Eintrag auf RealmID = 0 mit:
       * die Liste zeigt "GM3", der Account ingame ist aber normaler Spieler.
       * Genau dieser Widerspruch war beim Konto 192 ("SOAP") zu sehen.
       */
      const ids = await realmIds()
      const erlaubt = [-1].concat(ids)
      const rows = await db.query(
        'auth',
        `SELECT ${s.accessAccountCol} AS acc, gmlevel FROM account_access WHERE ${s.accessRealmCol || 'RealmID'} IN (?)`,
        [erlaubt]
      )
      const map = {}
      // Mehrere Einträge pro Account sind möglich (einer pro Reich).
      // Der Kern nimmt bei seinem Join den mit der höchsten RealmID
      // (ORDER BY aa.RealmID DESC LIMIT 1), also den konkretesten.
      const letzte = {}
      for (const r of rows) {
        const id = int(r.acc)
        const bisher = letzte[id]
        // keine Angabe über die RealmID hier nötig: IN (?) begrenzt schon
        // auf die, die gelten; bei Gleichstand gilt der letzte.
        if (bisher === undefined || int(r.gmlevel) !== 0) letzte[id] = int(r.gmlevel)
        map[id] = letzte[id]
      }
      return map
    } catch (_) {
      return {}
    }
  }
  return {}
}

/*
 * SRP6: der Verifier haengt zwingend am Salt des Accounts.
 *
 * AzerothCore rechnet (src/common/Cryptography/Authentication/SRP6.cpp):
 *
 *   v = g ^ SHA1( salt || SHA1(name + ":" + pass) ) mod N
 *
 * WICHTIG: SRP6.cpp schreibt in SRP6.h ausdruecklich:
 *
 *   // username + password must be passed through Utf8ToUpperOnlyLatin FIRST!
 *
 * Die Grossschreibung passiert also NICHT in CalculateVerifier selbst,
 * sondern muss der Aufrufer machen - genau das tut
 * AccountMgr::CreateAccount, bevor er MakeRegistrationData aufruft.
 * Wer sie weglässt, kann sich mit dem Account nicht einloggen.
 *
 * Utf8ToUpperOnlyLatin macht laut Util.h NUR ASCII:
 *   isBasicLatinCharacter -> nur 'a'-'z' und 'A'-'Z'
 * Alles andere (ß, Umlaute, Kyrillisch) bleibt unveraendert.
 * String.prototype.toUpperCase waere hier also zu aggressiv.
 *
 * Salt und Verifier werden little-endian als Roh-Binary gespeichert,
 * weil die Spalten vom Typ binary sind.
 */
const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7')
const G = 7n

// Nachbildung von Acore::Utf8ToUpperOnlyLatin
function upperOnlyLatin (text) {
  return String(text).replace(/[a-z]/g, c => c.toUpperCase())
}

function modPow (base, exp, modulus) {
  let result = 1n
  base %= modulus
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % modulus
    base = (base * base) % modulus
    exp >>= 1n
  }
  return result
}

function leToBigInt (buf) {
  let hex = ''
  for (let i = buf.length - 1; i >= 0; i--) hex += buf[i].toString(16).padStart(2, '0')
  return BigInt('0x' + hex)
}

function bigIntToLE (value, length = 32) {
  const out = Buffer.alloc(length)
  let v = value
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function calculateVerifier (username, password, salt) {
  const inner = crypto
    .createHash('sha1')
    .update(`${upperOnlyLatin(username)}:${upperOnlyLatin(password)}`, 'utf8')
    .digest()
  const outer = crypto.createHash('sha1').update(Buffer.concat([salt, inner])).digest()
  return bigIntToLE(modPow(G, leToBigInt(outer), N), 32)
}

async function ladeAccounts ({ search = '', ohneBots = false, filter = 'all', limit = null, offset = 0 } = {}) {
  const s = await accountSchema()

  // Nur Spalten abfragen, die es im Schema wirklich gibt - je nach Fork
  // fehlen Felder wie last_logout.
  const pick = name => (name in s.cols ? `a.${name}` : null)
  const select = ['a.id', 'a.username']
    .concat([pick('email'), pick('reg_mail'), pick('last_login'), pick('last_logout'), pick('failed_logins'), pick('locked'), pick('online'), pick(s.lastIpCol)])
    .filter(Boolean)

  const params = []
  let where = ''
  if (search && search.trim()) {
    /*
     * Suche über Benutzername UND E-Mail: Support-Fragen kommen oft mit der
     * Adresse ("welches Konto gehört dazu?"). Nur vorhandene Spalten.
     */
    const q = `%${search.trim()}%`
    const teile = ['a.username LIKE ?']
    params.push(q)
    // Numerische Eingabe matcht zusätzlich die Konto-ID ("Konto 42")
    if (/^\d+$/.test(search.trim())) {
      teile.push('a.id = ?')
      params.push(Number(search.trim()))
    }
    if ('email' in s.cols) {
      teile.push('a.email LIKE ?')
      params.push(q)
    }
    if ('reg_mail' in s.cols) {
      teile.push('a.reg_mail LIKE ?')
      params.push(q)
    }
    where = `WHERE (${teile.join(' OR ')})`
  }
  /*
   * Bot-Konten ausblenden: bei Repack-Übernahmen liegen 200+ Bot-Konten
   * (RNDBOT0..199, playerbots, ahbot) in der Tabelle - dieselben Präfixe
   * wie überall. Kein JOIN nötig, gefiltert wird direkt auf a.username.
   */
  if (ohneBots) {
    try {
      const botFilter = require('./spieler').botFilterSql('a')
      where = where ? `${where} AND ${botFilter}` : `WHERE ${botFilter}`
    } catch (_) {}
  }

  /*
   * Anmelde-Filter gehoeren in die Abfrage, sonst wuerde nur die aktuelle
   * Seite gefiltert - bei 100 von 2000 Konten waere das schlicht falsch.
   */
  if (filter === '7d' || filter === '30d') {
    if ('last_login' in s.cols) {
      const tage = filter === '7d' ? 7 : 30
      const bedingung = `a.last_login >= (NOW() - INTERVAL ${tage} DAY)`
      where = where ? `${where} AND ${bedingung}` : `WHERE ${bedingung}`
    }
  } else if (filter === 'never') {
    if ('last_login' in s.cols) {
      const bedingung = 'a.last_login IS NULL'
      where = where ? `${where} AND ${bedingung}` : `WHERE ${bedingung}`
    }
  } else if (filter === 'gm') {
    const gm = await readGmLevels()
    const ids = Object.keys(gm).filter(id => Number(gm[id]) > 0).map(Number)
    if (!ids.length) return { rows: [], total: 0 }
    const bedingung = `a.id IN (${ids.join(',')})`
    where = where ? `${where} AND ${bedingung}` : `WHERE ${bedingung}`
  } else if (filter === 'nochars') {
    const mitChar = new Set()
    try {
      const c = await db.query('chars', 'SELECT DISTINCT account FROM characters')
      for (const row of c) mitChar.add(int(row.account))
    } catch (_) {}
    if (mitChar.size) {
      const bedingung = `a.id NOT IN (${[...mitChar].join(',')})`
      where = where ? `${where} AND ${bedingung}` : `WHERE ${bedingung}`
    }
  }

  // Limit nur setzen, wenn ausdruecklich seitenweise geladen wird.
  const grenze = limit == null ? null : Math.max(1, Math.min(500, Number(limit) || 100))
  const start = Math.max(0, Number(offset) || 0)
  const seitenSql = grenze == null ? '' : ` LIMIT ${grenze} OFFSET ${start}`

  const rows = await db.query(
    'auth',
    `SELECT ${select.join(', ')}
     FROM account a
     ${where}
     ORDER BY a.id ASC${seitenSql}`,
    params
  )

  let total = rows.length
  if (grenze != null) {
    try {
      const c = await db.query('auth', `SELECT COUNT(*) AS c FROM account a ${where}`, params)
      total = int(c[0] && c[0].c)
    } catch (_) {}
  }

  const gmMap = await readGmLevels()

  const counts = {}
  try {
    const c = await db.query('chars', 'SELECT account, COUNT(*) AS n FROM characters GROUP BY account')
    for (const row of c) counts[int(row.account)] = int(row.n)
  } catch (_) {}

  /*
   * Gesperrte Accounts. Die Spalte hiess frueher "account", heute ist "id"
   * die Account-ID. Ohne diese Anpassung wirft die Abfrage, der Fehler wird
   * hier verschluckt - und das Kästchen "Gebannt" bleibt immer leer.
   */
  let banned = new Set()
  try {
    const spalte = await schema.erster('auth', 'account_banned', ['account', 'id'])
    if (spalte) {
      const b = await db.query('auth', `SELECT \`${spalte}\` AS account FROM account_banned WHERE active = 1`)
      for (const row of b) banned.add(int(row.account))
    }
  } catch (_) {}

  const iso = v => {
    if (!v) return null
    if (v instanceof Date) return v.toISOString()
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const ergebnis = rows.map(a => {
    const id = int(a.id)
    return {
      id,
      username: a.username,
      email: a.email || a.reg_mail || '',
      gmlevel: gmMap[id] || 0,
      online: int(a.online) > 0,
      lastLogin: iso(a.last_login),
      lastLogout: iso(a.last_logout),
      lastIp: a[s.lastIpCol] || null,
      failedLogins: int(a.failed_logins),
      locked: int(a.locked) === 1,
      characters: counts[id] || 0,
      banned: banned.has(id)
    }
  })
  return { rows: ergebnis, total }
}

/* Bestehende Aufrufer (z. B. Bots) bekommen weiterhin die reine Liste. */
async function listAccounts (params = {}) {
  return (await ladeAccounts(params)).rows
}

/* Seitenweise Liste fuer die Konten-Seite: rows + Gesamtzahl. */
async function listAccountsPage (params = {}) {
  return ladeAccounts(params)
}

async function createAccount ({ username, password, email = '', gmlevel = 0 }) {
  if (!username || !password) throw new Error('Benutzername und Passwort sind Pflicht.')
  if (String(password).length < 4) throw new Error('Passwort muss mindestens 4 Zeichen haben.')

  const s = await accountSchema()
  if (!s.hasUsername) throw new Error('Die Tabelle "account" hat keine Spalte username.')

  // Den Namen NICHT gross schreiben: der Authserver macht das selbst
  // (AccountInfo::LoadResult -> Utf8ToUpperOnlyLatin), und die Anmeldung
  // sucht ueber eine case-insensitive collation. Gross schreiben wuerde hier
  // nur mit bestehenden Accounts kollidieren, die noch klein geschrieben sind.
  // Grossschreibung ist allein Sache des Verifiers, siehe calculateVerifier.

  const salt = crypto.randomBytes(s.saltLen)
  const verifier = calculateVerifier(username, password, salt)
  // Keine Adresse erfinden. AzerothCore legt Konten ohne Mail mit '' an
  // (alle 131 Konten dieser Datenbank haben email = ''), und die Spalte ist
  // NOT NULL ohne Vorgabewert - also leer, nicht irgendein Platzhalter.
  // Die Mail wird wie im Core grossgeschrieben, sonst weicht ein Konto aus dem
  // Panel von einem aus der Konsole ab.
  const mail = email ? upperOnlyLatin(String(email)) : ''

  // Nur Spalten verwenden, die im Schema wirklich existieren
  const parts = ['username', 'salt', 'verifier']
  const vals = [username, salt, verifier]

  if ('session_key' in s.cols) {
    parts.push('session_key')
    vals.push(Buffer.alloc(0))
  }
  if (s.hasEmail) {
    parts.push('email')
    vals.push(mail)
  }
  if (s.hasRegMail) {
    parts.push('reg_mail')
    vals.push(mail)
  }
  if (s.hasJoinDate) {
    parts.push('joindate')
    vals.push(new Date())
  }
  if (s.lastIpCol) {
    parts.push(s.lastIpCol)
    vals.push('127.0.0.1')
  }
  if (s.hasGmLevel) {
    parts.push('gmlevel')
    vals.push(int(gmlevel))
  }

  const res = await db.execute(
    'auth',
    `INSERT INTO account (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
    vals
  ).catch(err => {
    // idx_username ist UNIQUE und case-insensitive: ein Bestandsaccount
    // "FrakItOut" blockiert also auch "freakitout". MySQL meldet das als
    // ER_DUP_ENTRY mit kryptischem Text - fuer die Anzeige aufbereiten.
    if (err && err.code === 'ER_DUP_ENTRY') {
      const vorhanden = /for key '([^']+)'/.exec(err.sqlMessage || '')
      throw new Error(
        `Der Benutzername ist bereits vergeben. Achte auf Groß- und Kleinschreibung: ` +
        `„${upperOnlyLatin(username)}" ist schon belegt` +
        (vorhanden ? ` (${vorhanden[1]}).` : '.')
      )
    }
    throw err
  })

  // GM-Level steht woanders -> nachziehen
  if (!s.hasGmLevel && int(gmlevel) > 0) {
    await setGmLevelRaw(res.insertId, int(gmlevel))
  }
  return { ok: true, id: res.insertId }
}

async function setPassword ({ accountId, password }) {
  if (!password) throw new Error('Passwort darf nicht leer sein.')
  const s = await accountSchema()

  const rows = await db.query('auth', 'SELECT id, username, salt FROM account WHERE id = ?', [int(accountId)])
  if (!rows.length) throw new Error('Account nicht gefunden.')

  // vorhandenes Salt als Roh-Binary lesen und weiterverwenden
  let salt = rows[0].salt
  if (!Buffer.isBuffer(salt)) {
    salt = typeof salt === 'string' ? Buffer.from(salt, 'base64') : Buffer.from(String(salt))
  }
  if (salt.length !== s.saltLen) salt = crypto.randomBytes(s.saltLen)

  const verifier = calculateVerifier(rows[0].username, password, salt)
  await db.execute('auth', 'UPDATE account SET salt = ?, verifier = ? WHERE id = ?', [
    salt,
    verifier,
    int(accountId)
  ])
  return { ok: true }
}

async function setGmLevel ({ accountId, gmlevel }) {
  await setGmLevelRaw(int(accountId), int(gmlevel))
  return { ok: true }
}

async function setEmail ({ accountId, email }) {
  const s = await accountSchema()
  if (s.hasEmail) {
    await db.execute('auth', 'UPDATE account SET email = ? WHERE id = ?', [email || '', int(accountId)])
  }
  if (s.hasRegMail) {
    await db.execute('auth', 'UPDATE account SET reg_mail = ? WHERE id = ?', [email || '', int(accountId)])
  }
  return { ok: true }
}

/*
 * Konto entsperren oder sperren. Beim Entsperren werden auch die
 * Fehlanmeldungen zurueckgesetzt - sonst sperrt der Kern beim naechsten
 * Versuch sofort wieder.
 */
async function setLocked ({ accountId, locked }) {
  const s = await accountSchema()
  if (!('locked' in s.cols)) {
    throw new Error('Dieses Kontoschema kennt kein "locked"-Feld.')
  }
  await db.execute('auth', 'UPDATE account SET locked = ? WHERE id = ?', [locked ? 1 : 0, int(accountId)])
  if (!locked && 'failed_logins' in s.cols) {
    await db.execute('auth', 'UPDATE account SET failed_logins = 0 WHERE id = ?', [int(accountId)])
  }
  return { ok: true }
}

async function deleteAccount (id) {
  await db.execute('auth', 'DELETE FROM account WHERE id = ?', [int(id)])
  return { ok: true }
}

// Schema bewusst neu ermitteln, falls die Datenbank wechselt
async function refreshSchema () {
  invalidateSchema()
  return accountSchema()
}

/*
 * Bulk-Reset für übernommene Konten: Konten aus einem alten Server mit
 * veraltetem Passwort-Format (sha_pass_hash statt SRP6) haben kein
 * nutzbares salt/verifier - sie können sich nicht einloggen. Diese
 * Funktion setzt für ALLE solchen Konten dasselbe neue Passwort.
 */
async function bulkPasswortReset ({ password } = {}) {
  const s = await accountSchema()
  if (!('salt' in s.cols)) throw new Error('Die Tabelle "account" hat keine salt-Spalte.')
  const pass = String(password || '')
  if (pass.length < 4) throw new Error('Passwort muss mindestens 4 Zeichen haben.')
  if (pass.length > 16) throw new Error('Der Core lehnt Passwörter über 16 Zeichen ab.')

  const rows = await db.execute('auth',
    "SELECT id, username FROM account WHERE salt IS NULL OR CHAR_LENGTH(salt) = 0")
  let n = 0
  const saltLen = s.saltLen || 32
  for (const r of rows) {
    try {
      const salt = crypto.randomBytes(saltLen)
      const verifier = calculateVerifier(r.username, pass, salt)
      await db.execute('auth', 'UPDATE account SET salt = ?, verifier = ? WHERE id = ?', [salt, verifier, r.id])
      n++
    } catch (_) {}
  }
  return { ok: true, konten: n, benutzer: rows.map(r => r.username) }
}

/*
 * Vorab-Zählung für die Bulk-Reset-Karte: WIE VIELE Konten haben kein
 * nutzbares SRP6-Passwort (leeres salt)? Derselbe SQL-Ausdruck wie im
 * Reset. -1 = Schema ohne salt-Spalte oder Abfrage fehlgeschlagen.
 */
async function ohneSrp6Anzahl () {
  try {
    const s = await accountSchema()
    if (!('salt' in s.cols)) return -1
    const rows = await db.execute('auth',
      'SELECT COUNT(*) AS c FROM account WHERE salt IS NULL OR CHAR_LENGTH(salt) = 0')
    return Array.isArray(rows) && rows.length ? Number(rows[0].c) : -1
  } catch (_) {
    return -1
  }
}

/*
 * Bot-Präfix-Test für die Wartungs-Karte: Zählt die Konten, die nach den
 * eingestellten Präfixen als Bot gelten, und liefert Beispiele. Genau dieser
 * Test hätte den Default-Tippfehler (rnbot statt rndbot) sofort gezeigt.
 */
async function botPraefixTest () {
  const spieler = require('./spieler')
  const praefixe = spieler.botPraefixe()
  let rows = []
  try {
    rows = await db.execute('auth', 'SELECT username FROM account')
  } catch (e) {
    throw new Error(`Konten nicht lesbar: ${e.message}`)
  }
  const namen = (rows || []).map(r => r.username).filter(Boolean)
  const treffer = namen.filter(n => spieler.istBotName(n))
  return {
    ok: true,
    praefixe,
    gesamt: namen.length,
    anzahl: treffer.length,
    beispiele: treffer.slice(0, 10)
  }
}

module.exports = {
  listAccounts,
  listAccountsPage,
  createAccount,
  setPassword,
  setGmLevel,
  setEmail,
  setLocked,
  deleteAccount,
  bulkPasswortReset,
  ohneSrp6Anzahl,
  botPraefixTest,
  accountSchema,
  refreshSchema,
  invalidateSchema,
  // Wird auch vom Installer benutzt, um das SOAP-Konto direkt anzulegen.
  calculateVerifier
}