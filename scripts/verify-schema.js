'use strict'

// Prueft die reparierten Module gegen die ECHTE Datenbank.
//
// 'use strict' ist hier nicht Kosmetik: ohne das legt Node eine falsch
// geschriebene Zuweisung stillschweigend als globale Variable an, statt
// einen Fehler zu melden. Genau daran ist dieser Test gescheitert - die
// Anzeige zeigte auf eine ganz andere Zeile als die Ursache.
//
// Schreibt nicht in den Bestand: fuer Bans wird eine Sperre angelegt und
// wieder aufgehoben, fuer die Gilden wird nachgeschaut, ob die Abfrage
// ueberhaupt Namen liefert. Kein Account wird angelegt oder geloescht.
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'))
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
const schema = require(path.join(__dirname, '..', 'electron', 'db-schema.js'))
const online = require(path.join(__dirname, '..', 'electron', 'api', 'online.js'))
const bans = require(path.join(__dirname, '..', 'electron', 'api', 'bans.js'))
const characters = require(path.join(__dirname, '..', 'electron', 'api', 'characters.js'))
const accounts = require(path.join(__dirname, '..', 'electron', 'api', 'accounts.js'))

const steps = []
const pruefe = (name, ok, zusatz) => steps.push({ name, ok: !!ok, zusatz: zusatz || '' })
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0 }

const TEST_IP = '203.0.113.77'
const markiert = { ip: false, account: null, item: null }

// Reste aus einem abgebrochenen Lauf. Ohne das blockiert eine Zeile mit
// item = 0 den Primaerschluessel von character_inventory, und jeder
// weitere Lauf scheitert dann an derselben Stelle.
async function aufraeumen () {
  try {
    if (markiert.item !== null) {
      await db.execute('chars', 'DELETE FROM character_inventory WHERE item = ?', [markiert.item])
      await db.execute('chars', 'DELETE FROM item_instance WHERE guid = ?', [markiert.item])
    }
    await db.execute('chars', 'DELETE FROM character_inventory WHERE item = 0')
    await db.execute('chars', 'DELETE FROM item_instance WHERE guid = 0')
    if (markiert.ip) await bans.unbanIp(TEST_IP)
    if (markiert.account !== null) await bans.unbanAccount(markiert.account)
    markiert.item = null
    markiert.ip = false
    markiert.account = null
  } catch (_) {}
}

;(async () => {
  await aufraeumen()
  const m = store.read().mysql
  console.log(`Auth: ${m.authDb}   Characters: ${m.charDb}\n`)

  // ---------------- 1) Der Schema-Helfer selbst ----------------
  const acc = await schema.spalten('auth', 'account')
  pruefe('spalten() liefert Namen klein', acc.has('username'), `${acc.size} Spalten`)
  pruefe('hat() erkennt Vorhandenes', await schema.hat('auth', 'account', 'username'))
  pruefe('hat() erkennt Fehlendes', !(await schema.hat('auth', 'account', 'gibtesnicht')))
  pruefe('erster() nimmt den vorhandenen Namen', (await schema.erster('auth', 'account', ['gibtesnicht', 'username'])) === 'username')
  pruefe('erster() liefert null, wenn keiner passt', (await schema.erster('auth', 'account', ['x', 'y'])) === null)
  pruefe('tabelleFehlt() erkennt Fehlendes', await schema.tabelleFehlt('auth', 'gibtesnicht'))
  pruefe('tabelleFehlt() erkennt Vorhandenes', !(await schema.tabelleFehlt('auth', 'account')))

  let wirf = null
  try {
    await schema.spalten('auth', 'account; DROP TABLE x')
  } catch (e) {
    wirf = e.message
  }
  pruefe('Tabellenname wird geprueft', !!wirf && /Ungueltiger Tabellenname/.test(wirf), wirf)

  // Zwischenspeicher: zweimal lesen liefert dasselbe Objekt
  const a1 = await schema.spalten('auth', 'account')
  const a2 = await schema.spalten('auth', 'account')
  pruefe('Ergebnis wird zwischengespeichert', a1 === a2)
  schema.leeren()
  const a3 = await schema.spalten('auth', 'account')
  pruefe('leeren() erzwingt Neulesen', a3 !== a1, 'gleicher Inhalt: ' + (a3.size === a1.size))

  // ---------------- 2) Spieler Optionen ----------------
  let liste = null
  try {
    liste = await online.listOnline()
    pruefe('listOnline() wirft keinen SQL-Fehler', true, `${liste.length} online`)
  } catch (e) {
    pruefe('listOnline() wirft keinen SQL-Fehler', false, e.message)
  }
  if (liste) {
    pruefe('gmlevel ist eine Zahl', liste.every(r => Number.isFinite(r.gmlevel)),
      liste[0] ? `${liste[0].name}: gmlevel=${liste[0].gmlevel}, username=${liste[0].username}` : 'niemand online')
    pruefe('Kein "undefined" beim Benutzernamen', liste.every(r => r.username === null || typeof r.username === 'string'))
  }

  // Gegenprobe: die alte Abfrage muss weiterhin scheitern. Wichtig ist
  // 'auth' als Ziel - "account" liegt nur dort. Gegen die Character-Datenbank
  // wuerde die Abfrage aus einem anderen Grund scheitern und damit nichts
  // beweisen.
  wirf = null
  try {
    await db.query('auth', 'SELECT gmlevel FROM account LIMIT 1')
  } catch (e) {
    wirf = e.message
  }
  pruefe('Kontrollprobe: altes Schema scheitert weiter', !!wirf && /gmlevel/.test(wirf),
    wirf ? wirf.slice(0, 70) : 'DOCH MOEGLICH')

  // Und die reparierte Abfrage muss laufen
  wirf = null
  try {
    const authDb = db.nameOf('auth')
    await db.query('chars', `SELECT c.guid, a.username FROM characters c
      LEFT JOIN \`${authDb}\`.account a ON a.id = c.account LIMIT 1`)
    pruefe('datenbankuebergreifender Join laeuft', true, `\`${authDb}\`.account`)
  } catch (e) {
    pruefe('datenbankuebergreifender Join laeuft', false, e.message)
  }

  // Die Übersicht darf nicht brechen
  const dash = await online.dashboard()
  pruefe('dashboard() funktioniert', Number.isFinite(dash.characters), JSON.stringify(dash))

  // ---------------- 3) Bans ----------------
  let banListe = null
  try {
    banListe = await bans.listBans()
    pruefe('listBans() wirft keinen SQL-Fehler', true,
      `${banListe.accounts.length} Accounts, ${banListe.ips.length} IPs`)
  } catch (e) {
    pruefe('listBans() wirft keinen SQL-Fehler', false, e.message)
  }
  if (banListe) {
    pruefe('Account-Bans haben eine ID', banListe.accounts.every(r => Number.isFinite(r.account)))
    pruefe('Account-Bans haben einen Namen', banListe.accounts.every(r => r.username === null || typeof r.username === 'string'))
    pruefe('Account-Bans haben ein Ablaufdatum', banListe.accounts.every(r => r.bantime >= 0))
    pruefe('IP-Bans nennen die IP', banListe.ips.every(r => !!r.entry))
    pruefe('IP-Bans haben einen aktiven Status', banListe.ips.every(r => typeof r.active === 'boolean'))
  }

  // Kontrollprobe: alte IP-Abfrage muss scheitern
  wirf = null
  try {
    await db.query('auth', 'SELECT id, entry, bannedate, bantime, bandby FROM ip_banned')
  } catch (e) {
    wirf = e.message
  }
  pruefe('Kontrollprobe: alte IP-Abfrage scheitert weiter', !!wirf && /Unknown column/.test(wirf), wirf ? 'bestaetigt' : 'DOCH MOEGLICH')

  // Anlegen und wieder aufheben - an einem Wegwerf-Account, damit der
  // Bestand unberuehrt bleibt.
  const weg = await db.query('auth', 'SELECT id FROM account ORDER BY id DESC LIMIT 1')
  if (!weg.length) throw new Error('Kein Account vorhanden - Test nicht moeglich.')
  const testAccount = int(weg[0].id)

  const vorher = await bans.listBans()
  const vorherIp = vorher.ips.filter(r => r.entry === TEST_IP).length

  await bans.banIp({ entry: TEST_IP, bantime: 3600, banby: 'Test', banreason: 'Pruefung' })
  markiert.ip = true
  const nachher = await bans.listBans()
  const treffer = nachher.ips.find(r => r.entry === TEST_IP)
  pruefe('IP-Sperre taucht in der Liste auf', !!treffer, TEST_IP)
  pruefe('IP-Sperre ist aktiv', treffer && treffer.active === true)
  pruefe('IP-Sperre hat die Restdauer (~1 h)', treffer && treffer.bantime > 3300 && treffer.bantime <= 3600,
    treffer ? `${treffer.bantime} s` : '-')
  pruefe('IP-Sperre nennt den Urheber', treffer && treffer.banby === 'Test', treffer ? treffer.banby : '-')
  pruefe('Keine zweite Zeile fuer dieselbe IP', nachher.ips.filter(r => r.entry === TEST_IP).length === 1)

  await bans.unbanIp(TEST_IP)
  markiert.ip = false
  const danach = await bans.listBans()
  pruefe('IP-Sperre wieder entfernt', !danach.ips.some(r => r.entry === TEST_IP),
    vorherIp + ' vorher -> ' + danach.ips.filter(r => r.entry === TEST_IP).length + ' nachher')

  // Unbefristete Sperre: unbandate 0 heisst "kein Ende"
  await bans.banIp({ entry: TEST_IP, bantime: 0, banby: 'Test', banreason: 'unbefristet' })
  markiert.ip = true
  const unb = (await bans.listBans()).ips.find(r => r.entry === TEST_IP)
  pruefe('Unbefristet -> Restdauer 0', unb && unb.bantime === 0, unb ? String(unb.bantime) : '-')
  pruefe('Unbefristet -> aktiv', unb && unb.active === true)
  await bans.unbanIp(TEST_IP)
  markiert.ip = false

  // Accountsperre anlegen und aufheben
  await bans.banAccount({ account: testAccount, bantime: 7200, banby: 'Test', banreason: 'Pruefung' })
  markiert.account = testAccount
  const mitBan = await bans.listBans()
  const ab = mitBan.accounts.find(r => r.account === testAccount)
  pruefe('Account-Sperre taucht auf', !!ab, `Account ${testAccount}`)
  pruefe('Account-Sperre hat ~2 h Restdauer', ab && ab.bantime > 6900 && ab.bantime <= 7200, ab ? `${ab.bantime} s` : '-')
  pruefe('Account-Sperre verknuepft den Namen', ab && typeof ab.username === 'string', ab ? String(ab.username) : '-')

  await bans.unbanAccount(testAccount)
  markiert.account = null
  const ohneBan = await bans.listBans()
  pruefe('Account-Sperre wieder entfernt', !ohneBan.accounts.some(r => r.account === testAccount))

  // ---------------- 4) Gilden ----------------
  const chars = await characters.listCharacters({ limit: 50 })
  pruefe('listCharacters() liefert Zeilen', Array.isArray(chars), `${chars.length} geladen`)
  const mitGilde = chars.filter(c => c.guild)
  const hatGilden = !(await schema.tabelleFehlt('chars', 'guild'))
  pruefe('Gildenabfrage benutzt die moderne Struktur', hatGilden)
  pruefe(
    'Gilden werden zugeordnet (oder es gibt keine)',
    !hatGilden || chars.length === 0 || chars.some(c => typeof c.guild === 'string' || c.guild === null),
    `${mitGilde.length} mit Gilde`
  )

  // Direkter Vergleich: die Abfrage darf nicht werfen
  wirf = null
  try {
    await db.query('chars', `
      SELECT m.guid, g.name
      FROM guild_member m
      LEFT JOIN guild g ON g.guildid = m.guildid
      LIMIT 3`)
    pruefe('Gildenabfrage laeuft durch', true)
  } catch (e) {
    wirf = e.message
    pruefe('Gildenabfrage laeuft durch', false, e.message)
  }

  // Kontrollprobe: die geratenen Verknuepfungen muessen scheitern
  for (const [name, sql] of [
    ['g.id = m.guild', 'SELECT 1 FROM guild_member m LEFT JOIN guild g ON g.id = m.guild LIMIT 1'],
    ['character_guild', 'SELECT guid, name FROM character_guild LIMIT 1']
  ]) {
    wirf = null
    try {
      await db.query('chars', sql)
    } catch (e) {
      wirf = e.message
    }
    pruefe(`Kontrollprobe: "${name}" scheitert`, !!wirf, wirf ? 'bestaetigt' : 'DOCH MOEGLICH')
  }

  // ---------------- 5) Gebannt-Flag in der Accountliste ----------------
  let accListe = null
  try {
    accListe = await accounts.listAccounts({})
    pruefe('listAccounts() wirft keinen Fehler', Array.isArray(accListe), `${accListe.length} Accounts`)
    pruefe('Jeder Account traegt das Feld banned',
      accListe.every(a => 'banned' in a),
      accListe[0] ? `${accListe[0].username}: banned=${accListe[0].banned}` : 'keine Accounts')
  } catch (e) {
    pruefe('listAccounts() wirft keinen Fehler', false, e.message)
  }

  // ---------------- 6) Item zustellen (GM) ----------------
  // Ein Item anlegen und sofort wieder loeschen. Betroffen ist ein
  // Testcharakter; sauber aufgeraeumt wird in jedem Fall.
  const gm = require(path.join(__dirname, '..', 'electron', 'api', 'gm.js'))
  const schonDa = await db.query('chars', 'SELECT guid FROM characters ORDER BY guid LIMIT 1')
  const charGuid = schonDa.length ? int(schonDa[0].guid) : null

  // Eine Item-ID, die es in DIESEM Core wirklich gibt. Feste Nummern wie
  // 2589 stammen aus dem Original-Core und fehlen in einem Repack mit
  // eigener Datenbank.
  const eintraege = await db.query('world', 'SELECT entry FROM item_template WHERE entry > 0 ORDER BY entry LIMIT 1')
  const itemEntry = eintraege.length ? int(eintraege[0].entry) : null

  if (charGuid !== null && itemEntry !== null) {
    let erzeugt = null
    try {
      const r = await gm.sendItem({ guid: charGuid, itemEntry: itemEntry, count: 1 })
      erzeugt = r.itemInstanceGuid
      markiert.item = erzeugt
      // Strenger als "ist eine Zahl": item_instance.guid hat kein
      // AUTO_INCREMENT. 0 hiesse, das Item haette keine echte Nummer
      // bekommen - und "if (0)" waere falsch, die Folgepruefungen
      // wuerden stillschweigend ausfallen.
      pruefe('Item zustellen funktioniert', Number.isInteger(erzeugt) && erzeugt > 0,
        `Item ${itemEntry}, itemInstanceGuid=${erzeugt}`)
    } catch (e) {
      pruefe('Item zustellen funktioniert', false, e.message)
    }
    if (erzeugt) {
      const inv = await db.query('chars', 'SELECT slot, bag FROM character_inventory WHERE item = ?', [erzeugt])
      pruefe('Item landet im Inventar', inv.length === 1, inv.length ? 'bag ' + inv[0].bag + ' slot ' + inv[0].slot : 'nichts')
      try {
        await aufraeumen()
        const rest = await db.query('chars', 'SELECT guid FROM item_instance WHERE guid = ?', [erzeugt])
        pruefe('Testitem wieder entfernt', rest.length === 0)
      } catch (e) {
        pruefe('Testitem wieder entfernt', false, e.message)
      }
    } else {
      pruefe('Item zustellen: GUID wurde vergeben', false,
        'keine GUID - Folgeprüfungen wurden übersprungen')
    }
  } else {
    pruefe('Item zustellen uebersprungen', true, 'kein Charakter oder kein item_template')
  }

  // Kontrollprobe: der alte INSERT muss scheitern
  wirf = null
  try {
    await db.execute('chars', `INSERT INTO item_instance
      (itemEntry, owner_guid, ownerEnchantment, ownerFlags, ownerCreationMail,
       giftCreatorGuid, ownerCount, duration, enchantment1) VALUES (1,1,-1,0,0,0,1,0,0)`)
  } catch (e) {
    wirf = e.message
  }
  pruefe('Kontrollprobe: alter item_instance-INSERT scheitert', !!wirf,
    wirf ? wirf.slice(0, 70) : 'DOCH MOEGLICH')

  // getCharacter muss ohne logintime auskommen
  wirf = null
  try {
    await characters.getCharacter(charGuid)
    pruefe('getCharacter() laeuft durch', true)
  } catch (e) {
    wirf = e.message
    pruefe('getCharacter() laeuft durch', false, e.message)
  }

  // ---------------- 6) Aufraeumen ----------------
  await aufraeumen()

  const reste = await bans.listBans()
  pruefe('Keine Testdatei IP-Sperre uebrig', !reste.ips.some(r => r.entry === TEST_IP))
  pruefe('Keine Test-Accountsperre uebrig', !reste.accounts.some(r => r.account === testAccount))

  console.log('')
  let ok = 0
  for (const s of steps) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }
  console.log(`\n${ok}/${steps.length} bestanden`)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  /*
   * Bewusst process.exit() statt nur exitCode: nach einer FEHLGESCHLAGENEN
   * Abfrage haelt mysql2 die Verbindung offen, und pool.end() wartet
   * darauf. Node beendet sich dann nie - der Test haengt sich auf, statt
   * mit einem Exitcode zu enden. Genau das ist hier passiert.
   */
  process.exit(ok === steps.length ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  try {
    await aufraeumen()
    await db.closeAll()
  } catch (_) {}
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch (_) {}
  process.exit(1)
})
