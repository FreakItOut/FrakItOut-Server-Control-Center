// Prueft die deutsche Suche gegen die echte Datenbank.
//
// Kriterium ist nicht "steht im Woerterbuch", sondern "findet der damit
// wirklich etwas". Ein Eintrag, der auf 0 Treffer zeigt, ist fuer den Nutzer
// dasselbe wie kein Eintrag - nur mit mehr Pflegeaufwand.
//
// Geprueft wird ausschliesslich lesend.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'begriffe-'))
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
const begriffe = require(path.join(__dirname, '..', 'electron', 'woe-begriffe.js'))
const gm = require(path.join(__dirname, '..', 'electron', 'api', 'gm.js'))

// Deutsche Begriffe, die im Alltag jemand eintippt
const WORTE = [
  'Schwert', 'Schild', 'Axt', 'Stab', 'Dolch', 'Speer', 'Bogen', 'Armbrust',
  'Rüstung', 'Hose', 'Stiefel', 'Handschuhe', 'Helm', 'Ring', 'Umhang',
  'Beutel', 'Truhe', 'Schlüssel', 'Flasche', 'Trank',
  'Krieger', 'Magier', 'Jäger', 'Druide', 'Paladin',
  'Mensch', 'Zwerg', 'Orc', 'Goblin', 'Troll', 'Blutelf', 'Untot',
  'Knochen', 'Wolfs', 'Bär', 'Spinne', 'Drache', 'Drachling', 'Dämon',
  'Stadt', 'Turm', 'Schmiede', 'Bank', 'Höhle', 'Tempel',
  'Gold', 'Silber', 'Eisen', 'Stahl', 'Leder', 'Kristall', 'Edelstein',
  'Feuer', 'Frost', 'Blitz', 'Gift', 'Schatten', 'Heilig'
]

const schritte = []
const merke = (ok, was, zusatz) => schritte.push({ ok, name: was, zusatz: zusatz || '' })

;(async () => {
  console.log(`Woerterbuch: ${begriffe.anzahl} Eintraege`)
  console.log('')

  // ---- 1) Jeder Begriff findet ueberhaupt etwas
  const ohneTreffer = []
  for (const w of WORTE) {
    const treffer = (await gm.lookupItems(w, 3)).treffer
    const m = begriffe.muster(w)
    if (treffer.length === 0) ohneTreffer.push(`${w} (${m.uebersetzt ? 'uebersetzt' : 'nicht im Woerterbuch'})`)
  }
  merke(ohneTreffer.length === 0, 'Jeder gepruefte Begriff findet mindestens einen Treffer',
    ohneTreffer.length ? ohneTreffer.join(', ') : `${WORTE.length} Begriffe`)

  // ---- 2) Die Suche funktioniert wirklich ueber die Uebersetzung
  const beispielAntwort = await gm.lookupItems('Schwert', 5)
  const beispiel = beispielAntwort.treffer
  merke(beispiel.length > 0, '"Schwert" findet Items', beispiel.length ? `${beispiel.length}, z.B. ${beispiel[0].name}` : '-')
  const direktAntwort = await gm.lookupItems('Sword', 5)
  const direkt = direktAntwort.treffer
  merke(direkt.length > 0, 'und "Sword" auch', direkt.length ? `${direkt.length}, z.B. ${direkt[0].name}` : '-')
  // Gegenprobe: die Treffer fuer "Schwert" sollen in "Sword" wiederzufinden sein
  const namenSindEnglisch = beispiel.every(r => /sword/i.test(r.name))
  merke(namenSindEnglisch, 'gefundene Namen sind englisch (wie erwartet)',
    beispiel.slice(0, 2).map(r => r.name).join(' | '))

  // ---- 3) Creatures und Gameobjects profitieren auch
  const npcAntwort = await gm.lookupCreatures('Drachling', 3)
  const npc = npcAntwort.treffer
  merke(npc.length > 0, '"Drachling" findet Creatures', npc.length ? npc.map(r => r.name).join(', ') : '-')
  const gobAntwort = await gm.lookupGameObjects('Truhe', 3)
  const gob = gobAntwort.treffer
  merke(gob.length > 0, '"Truhe" findet Gameobjects', gob.length ? gob.map(r => r.name).join(', ') : '-')

  // ---- 4) Eine deutsche Suche liefert mehr als die ohne Uebersetzung
  const nurOriginal = await db.query('world',
    'SELECT COUNT(*) AS n FROM item_template WHERE name LIKE ?', ['%Schwert%'])
  const mitUebersetzung = await db.query('world',
    'SELECT COUNT(*) AS n FROM item_template WHERE name LIKE ? OR name LIKE ?', ['%Schwert%', '%Sword%'])
  merke(Number(mitUebersetzung[0].n) > Number(nurOriginal[0].n), 'Uebersetzung weitet die Trefferzahl',
    `${nurOriginal[0].n} -> ${mitUebersetzung[0].n}`)
  merke(Number(nurOriginal[0].n) === 0, 'ohne Uebersetzung waere die Liste leer', String(nurOriginal[0].n))

  // ---- 5) Englische Eingaben bleiben unveraendert (kein Schaden angerichtet)
  const englischAntwort = await gm.lookupItems('Sword', 5)
  const englisch = englischAntwort.treffer
  const mEnglisch = begriffe.muster('Sword')
  merke(mEnglisch.uebersetzt === false, 'englische Eingabe wird nicht als deutsch behandelt',
    JSON.stringify(mEnglisch.begriffe))
  merke(englisch.length > 0, 'englische Suche funktioniert weiterhin', String(englisch.length))

  // ---- 6) Unsinn findet nichts und wird nicht erfunden
  const unsinnAntwort = await gm.lookupItems('qqqzzzxxxyyy')
  const unsinn = unsinnAntwort.treffer
  merke(unsinn.length === 0, 'unsinnige Eingabe findet nichts', String(unsinn.length))
  const mUnsinn = begriffe.muster('qqqzzzxxxyyy')
  merke(mUnsinn.uebersetzt === false, 'und wird nicht uebersetzt', JSON.stringify(mUnsinn.begriffe))

  // ---- 7) Das Woerterbuch erfindet keine Beziehungen
  // "Knochen" darf nicht zu "Koch" werden, nur weil beides ein Wort ist.
  merke(begriffe.normalisiere('Knochen') === 'knochen', 'Umlaute werden nur vereinheitlicht',
    begriffe.normalisiere('Knochen'))
  const knochenAntwort = await gm.lookupItems('Knochen', 3)
  const knochen = knochenAntwort.treffer
  const kochTreffer = knochen.filter(r => /koch/i.test(r.name))
  merke(kochTreffer.length === 0, 'kein Beugsungs-Unfug ("Knochen" trifft nichts mit "Koch")',
    knochen.slice(0, 2).map(r => r.name).join(' | ') || 'keine Treffer')

  // ---- 8) Kein toter Eintrag im Woerterbuch
  // "Priester" muss irgendwo etwas finden. In welcher Tabelle, ist egal -
  // "High Elf" steht in keinem Item, aber in Creature-Namen. Entscheidend ist
  // nur: jeder Eintrag findet irgendwo etwas.
  const totenZeilen = []
  for (const [de, en] of Object.entries(begriffe.alle)) {
    const i = await db.query('world', 'SELECT COUNT(*) AS n FROM item_template WHERE name LIKE ?', [`%${en}%`])
    const c = await db.query('world', 'SELECT COUNT(*) AS n FROM creature_template WHERE name LIKE ? OR subname LIKE ?', [`%${en}%`, `%${en}%`])
    const g = await db.query('world', 'SELECT COUNT(*) AS n FROM gameobject_template WHERE name LIKE ?', [`%${en}%`])
    const n = Number(i[0].n) + Number(c[0].n) + Number(g[0].n)
    if (n === 0) totenZeilen.push(`${de} -> ${en}`)
  }
  merke(totenZeilen.length === 0, 'kein toter Eintrag im Wörterbuch',
    totenZeilen.length ? `${totenZeilen.length} ohne jeden Treffer: ${totenZeilen.join(', ')}` : `${begriffe.anzahl} geprueft`)

  // ---- 9) Die Uebersetzung ist selbst nicht der Fehler
  // Gegenprobe: eine deutsche Vokabel muss wirklich englisch werden und nicht
  // auf Deutsch stehen bleiben - sonst sucht man ins Leere.
  merke(begriffe.uebersetzeWort('Priester') === 'Priest', 'Priester wird zu Priest (nicht zu Priester)',
    String(begriffe.uebersetzeWort('Priester')))
  merke(begriffe.uebersetzeWort('Schwert') === 'Sword', 'Schwert wird zu Sword', String(begriffe.uebersetzeWort('Schwert')))

  console.log('')
  let ok = 0
  for (const s of schritte) {
    console.log(`${s.ok ? 'OK   ' : 'FEHLT'}  ${s.name}${s.zusatz ? '   [' + s.zusatz + ']' : ''}`)
    if (s.ok) ok++
  }
  console.log(`\n${ok}/${schritte.length} bestanden`)

  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok === schritte.length ? 0 : 1)
})().catch(async e => {
  console.error('Abbruch:', e.message)
  console.error(e.stack)
  await db.closeAll()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
})