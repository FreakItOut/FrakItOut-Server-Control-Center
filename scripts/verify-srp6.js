// Prueft die Kontenerstellung gegen AzerothCore - nicht gegen sich selbst.
//
// Hintergrund: Wer das Panel ohne Tests aendert, kann die Verifier-Rechnung
// kaputt machen, ohne dass irgendetwas auffaellt. Die Kontoanlage meldet
// Erfolg, das Feld ist 32 Byte lang, und niemand kann sich trotzdem einloggen.
//
// Deshalb wird hier nicht die eigene Formel nachgerechnet, sondern gegen eine
// unabhaengige Nachbildung der offiziellen Bibliothek
// https://github.com/azerothcore/ac-nodejs-srp6 , die AzerothCore selbst zur
// Erzeugung von Verifiern einsetzt. Zusaetzlich abgeglichen mit dem
// C++-Original:
//   src/common/Cryptography/Authentication/SRP6.cpp   (CalculateVerifier)
//   src/common/Cryptography/BigNumber.h               (ToByteArray/BN: little-endian)
//   src/server/game/Accounts/AccountMgr.cpp           (Utf8ToUpperOnlyLatin)
//
// Zwei Fehler, die hier ausgeschlossen werden:
//   - N und g falsch (dann stimmt gar nichts mehr)
//   - die Grossschreibung weggelassen (dann sieht jeder Verifier plausibel aus)
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srp6-'))
const echte = path.join(os.homedir(), 'AppData', 'Roaming', 'wowpanel', 'config.json')
if (!fs.existsSync(echte)) {
  console.log('Keine Panel-Konfiguration gefunden - Abbruch.')
  process.exit(1)
}
fs.copyFileSync(echte, path.join(tmp, 'config.json'))

const store = require(path.join(__dirname, '..', 'electron', 'store.js'))
store.init(tmp)
const db = require(path.join(__dirname, '..', 'electron', 'db.js'))
db.init(store)
const accounts = require(path.join(__dirname, '..', 'electron', 'api', 'accounts.js'))

// ---------------------------------------------------------- Referenz
// Nachbildung von ac-nodejs-srp6. Bewusst NICHT die Panel-Formel, sondern die
// offizielle Bibliothek - sonst prueft der Test nur sich selbst.
const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7')
const G = BigInt(7)
const sha1 = (...teile) => crypto.createHash('sha1').update(Buffer.concat(teile)).digest()

function toBigIntLE (buf) {
  let h = ''
  for (let i = buf.length - 1; i >= 0; i--) h += buf[i].toString(16).padStart(2, '0')
  return BigInt('0x' + h)
}
function toBufferLE (wert, len = 32) {
  const out = Buffer.alloc(len)
  let v = wert
  for (let i = 0; i < len; i++) { out[i] = Number(v & 0xffn); v >>= 8n }
  return out
}
function modPow (b, e, m) {
  let r = 1n
  b %= m
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n }
  return r
}

// x = LE(H(s | H(I | ':' | P)))   - so steht es in der offiziellen Bibliothek
function referenzX (salt, identity, password) {
  return toBigIntLE(sha1(salt, sha1(Buffer.from(`${identity}:${password}`, 'utf8'))))
}
// v = LE(g^x mod N)
function referenzVerifier (salt, identity, password) {
  return toBufferLE(modPow(G, referenzX(salt, identity, password), N), 32)
}

// Acore::Utf8ToUpperOnlyLatin - wandelt ausschliesslich a-z, sonst nichts
const upperOnlyLatin = s => String(s).replace(/[a-z]/g, c => c.toUpperCase())

const schritte = []
const merke = (ok, was, zusatz) => schritte.push({ ok, name: was, zusatz: zusatz || '' })

// Feste Werte: mit Zufall waere nichts vergleichbar.
const NAME = 'PANEL_SRP6TEST'
const PASS = 'Test1234'

;(async () => {
  const variante = process.argv[2] || 'le'

  const vorher = await db.query('auth', 'SELECT COUNT(*) AS n FROM account')
  await db.execute('auth', 'DELETE FROM account WHERE username = ?', [NAME])

  const neu = await accounts.createAccount({ username: NAME, password: PASS, email: '' })
  merke(neu && neu.id > 0, 'Konto ueber das Panel angelegt', `id=${neu && neu.id}`)

  const rows = await db.query('auth', 'SELECT id, username, salt, verifier, session_key, email FROM account WHERE username = ?', [NAME])
  merke(rows.length === 1, 'Konto genau einmal in der Datenbank')
  const k = rows[0]

  // ---- Schema
  merke(k.salt && k.salt.length === 32, 'Salt ist 32 Byte', `${k.salt && k.salt.length} Byte`)
  merke(k.verifier && k.verifier.length === 32, 'Verifier ist 32 Byte', `${k.verifier && k.verifier.length} Byte`)
  const sk = k.session_key === null ? Buffer.alloc(0) : Buffer.from(k.session_key)
  merke(sk.length === 40, 'Sessionkey ist 40 Byte (K1||K2)', `${sk.length} Byte`)

  // ---- Die eigentliche Pruefung: Panel gegen die offizliche Bibliothek
  const soll = referenzVerifier(k.salt, upperOnlyLatin(NAME), upperOnlyLatin(PASS))
  merke(soll.equals(k.verifier), 'Verifier stimmt mit der AzerothCore-Referenz ueberein',
    soll.equals(k.verifier) ? 'byteweise identisch' : 'ABWEICHUNG')

  // ---- Und die Umkehrprobe: ohne Grossschreibung waere es anders
  const ohneGross = referenzVerifier(k.salt, NAME, PASS)
  merke(!ohneGross.equals(k.verifier), 'Grossschreibung ist wirklich noetig (sonst waere es gleich)',
    ohneGross.equals(k.verifier) ? 'verdaechtig gleich' : 'weicht ab, wie erwartet')

  // ---- Und die Sonderzeichen-Regel: nur a-z werden gewandelt
  merke(upperOnlyLatin('aßöÄ') === 'AßöÄ', 'Utf8ToUpperOnlyLatin wandelt nur a-z',
    JSON.stringify(upperOnlyLatin('aßöÄ')))

  // ---- E-Mail: AzerothCore legt Konten ohne Mail mit '' an
  merke(k.email === '', 'Keine Adresse erfunden, leer wie im Core', JSON.stringify(k.email))

  // ---- Und mit Adresse: ebenfalls grossgeschrieben wie im Core
  const NAME2 = 'PANEL_SRP6MAIL'
  await db.execute('auth', 'DELETE FROM account WHERE username = ?', [NAME2])
  await accounts.createAccount({ username: NAME2, password: PASS, email:'Meine@Beispiel.De' })
  const r2 = await db.query('auth', 'SELECT email, reg_mail FROM account WHERE username = ?', [NAME2])
  merke(r2[0].email === 'MEINE@BEISPIEL.DE', 'E-Mail grossgeschrieben wie im Core', JSON.stringify(r2[0].email))
  merke(r2[0].reg_mail === r2[0].email, 'reg_mail entspricht email', JSON.stringify(r2[0].reg_mail))

  const nachher = await db.query('auth', 'SELECT COUNT(*) AS n FROM account')
  merke(Number(nachher[0].n) === Number(vorher[0].n) + 2, 'Genau zwei Testkonten dazu',
    `${vorher[0].n} -> ${nachher[0].n}`)

  let ok = 0
  for (const s of schritte) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }

  // Aufraeumen - die echten Konten bleiben unberuehrt
  await db.execute('auth', 'DELETE FROM account WHERE username IN (?, ?)', [NAME, NAME2])
  const reste = await db.query('auth', 'SELECT COUNT(*) AS n FROM account WHERE username IN (?, ?)', [NAME, NAME2])
  const weg = Number(reste[0].n) === 0
  console.log(`${weg ? 'OK   ' : 'FEHLT'}  Testkonten wieder entfernt`)
  if (weg) ok++

  console.log(`\n${ok}/${schritte.length + 1} bestanden`)

  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === schritte.length + 1 ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  console.error(e.stack)
  try {
    await db.execute('auth', 'DELETE FROM account WHERE username IN (?, ?)', [NAME, 'PANEL_SRP6MAIL'])
    await db.closeAll()
  } catch (_) {}
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})