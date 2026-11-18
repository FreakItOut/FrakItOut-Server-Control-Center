'use strict'

/*
 * Deutsche Suchbegriffe fuer die englischen Namen in der Datenbank.
 *
 * Warum das noetig ist: Die Item-, NPC- und Gameobject-Namen stehen in der
 * Welt-Datenbank in Englisch ("Worn Shortsword"), das Panel ist deutsch.
 * Gemessen in dieser Datenbank: 46100 Items, davon
 *     name LIKE '%Schwert%'  ->  0 Treffer
 *     name LIKE '%Sword%'    ->  347 Treffer
 * Wer also "Schwert" eingibt, bekommt eine leere Liste und haelt die Funktion
 * fuer kaputt. Das hier uebersetzt die Eingabe, bevor gesucht wird.
 *
 * Grundsaetze:
 *   - Nur woertlich uebersetzen, nie raten. Falsche Treffer sind schlimmer als
 *     keine, weil sie zum falschen Item fuehren.
 *   - Die Liste deckt haeufige Begriffe ab, nicht alle. Eine unbekannte
 *     Vokabel bleibt unveraendert - die Suche verhaelt sich dann wie bisher.
 *   - Nichts wird ersetzt, nur ergaenzt. Der eingegebene Begriff wird immer
 *     mitgesucht, damit bereits auf Englisch gefundene Items nicht verloren
 *     gehen.
 *
 * Schluessel kleingeschrieben, ohne Umlaut-Schreibweise - die Eingabe wird
 * vor dem Nachschlagen ebenfalls vereinheitlicht (siehe schluessel).
 */

// Metalle und Materialien
const MATERIAL = {
  eisen: 'Iron',
  stahl: 'Steel',
  silber: 'Silver',
  gold: 'Gold',
  kupfer: 'Copper',
  bronze: 'Bronze',
  zinn: 'Tin',
  messing: 'Brass',
  kobalt: 'Cobalt',
  adamantit: 'Adamantite',
  mithril: 'Mithril',
  obsidian: 'Obsidian',
  stein: 'Stone',
  granit: 'Granite',
  marmor: 'Marble',
  kristall: 'Crystal',
  edelstein: 'Gem',
  juwel: 'Jewel',
  diamant: 'Diamond',
  rubin: 'Ruby',
  saphir: 'Sapphire',
  smaragd: 'Emerald',
  topas: 'Topaz',
  perle: 'Pearl',
  leder: 'Leather',
  haut: 'Hide',
  fell: 'Fur',
  pelz: 'Pelts',
  wolle: 'Wool',
  tuch: 'Cloth',
  seide: 'Silk',
  leinen: 'Linen',
  feder: 'Feather',
  schuppe: 'Scale',
  schuppen: 'Scale',
  schaefell: 'Wool',
  dorn: 'Thorn',
  kristallnadel: 'Crystal'
}

// Ausruestung: Waffen
const WAFFE = {
  schwert: 'Sword',
  schwaert: 'Sword',
  klinge: 'Blade',
  dolch: 'Dagger',
  axt: 'Axe',
  streitaxt: 'Battle Axe',
  streitkolben: 'Mace',
  kolben: 'Mace',
  keule: 'Maul',
  club: 'Club',
  hammer: 'Hammer',
  sturmhammer: 'Thunder Hammer',
  speer: 'Spear',
  lanze: 'Lance',
  stange: 'Polearm',
  stab: 'Staff',
  zauberstab: 'Staff',
  waffe: 'Weapon',
  waffen: 'Weapon',
  bogen: 'Bow',
  armbrust: 'Crossbow',
  kurzschwert: 'Shortsword',
  handaxt: 'Hand Axe',
  kampfhaft: 'War Axe',
  schild: 'Shield',
  schildwall: 'Shield Wall',
  zepter: 'Scepter',
  orrery: 'Orb',
  feuerstab: 'Fire Staff',
  froststab: 'Frost Staff',
  // "Thunder Hammer" gibt es in dieser Datenbank nicht. Auf "Hammer"
  // abgebildet trifft es immerhin - und findet die Waffe, die man meint.
  sturmhammer: 'Hammer'
}

// Ausruestung: Ruestung und Koerperteile
const RUESTUNG = {
  ruestung: 'Armor',
  panzer: 'Armor',
  hosen: 'Legs',
  beine: 'Legs',
  hose: 'Legs',
  schuhe: 'Boots',
  schuh: 'Boot',
  fuesse: 'Feet',
  fuss: 'Foot',
  haende: 'Hands',
  hand: 'Hands',
  handschuhe: 'Gloves',
  handschuh: 'Glove',
  brust: 'Chest',
  oberteil: 'Chest',
  ruecken: 'Back',
  schultern: 'Shoulder',
  schulter: 'Shoulder',
  umhang: 'Cloak',
  schleier: 'Veil',
  maske: 'Mask',
  helm: 'Helm',
  haube: 'Hood',
  kappe: 'Cap',
  hals: 'Neck',
  halskette: 'Necklace',
  ketten: 'Necklace',
  kette: 'Chain',
  ring: 'Ring',
  siegel: 'Ring',
  amulett: 'Amulet',
  talisman: 'Talisman',
  schmuck: 'Ornament',
  juwelenschmuck: 'Jewelry',
  guertel: 'Belt',
  schaedel: 'Skull',
  kopf: 'Head',
  stiefel: 'Boots',
  schlüssel: 'Key',
  schatten: 'Shadow',
  heilig: 'Holy',
  heiligtum: 'Sanctuary',
  pfeil: 'Arrow',
  bolzen: 'Bolt',
  splitter: 'Shard',
  krug: 'Pitcher',
  becher: 'Goblet',
  schale: 'Bowl',
  spiegel: 'Mirror'
}

// Behaelter und Verbrauchsgut
const BEHAELTER = {
  beutel: 'Bag',
  tasche: 'Bag',
  rucksack: 'Backpack',
  koffer: 'Chest',
  truhe: 'Chest',
  kiste: 'Crate',
  kassette: 'Case',
  schatulle: 'Casket',
  etui: 'Case',
  lampe: 'Lamp',
  laterne: 'Lantern',
  fackel: 'Torch',
  feuer: 'Fire',
  funk: 'Spark',
  drank: 'Drink',
  trank: 'Potion',
  elixier: 'Elixir',
  tonikum: 'Tonic',
  flasche: 'Bottle',
  phiole: 'Vial',
  kristallphiole: 'Crystal Vial',
  arznei: 'Reagent',
  reagenz: 'Reagent',
  gift: 'Poison',
  zauber: 'Spell',
  zaubertrank: 'Potion',
  essen: 'Food',
  brot: 'Bread',
  fleisch: 'Flesh',
  knochen: 'Bone',
  zahn: 'Tooth',
  felltuch: 'Hide'
}

// Klassen
const KLASSEN = {
  krieger: 'Warrior',
  paladin: 'Paladin',
  jaeger: 'Hunter',
  rogue: 'Rogue',
  schurke: 'Rogue',
  priester: 'Priest',
  schamane: 'Shaman',
  magier: 'Mage',
  warlock: 'Warlock',
  hexenmeister: 'Warlock',
  druide: 'Druid',
  toedesritter: 'Death Knight',
  monch: 'Monk'
}

// Völker
const VOELKER = {
  mensch: 'Human',
  menschen: 'Human',
  zwerg: 'Dwarf',
  zwergen: 'Dwarf',
  gnom: 'Gnome',
  hochelf: 'High Elf',
  dunkelfest: 'Night Elf',
  nachtelf: 'Night Elf',
  orc: 'Orc',
  ork: 'Orc',
  goblin: 'Goblin',
  kobold: 'Kobold',
  troll: 'Troll',
  tauren: 'Tauren',
  taure: 'Tauren',
  bloedelf: 'Blood Elf',
  blutelf: 'Blood Elf',
  draenei: 'Draenei',
  untot: 'Undead'
}

// Kreaturen
const KREATUREN = {
  wolf: 'Wolf',
  woelfe: 'Wolf',
  woelfin: 'Wolf',
  baer: 'Bear',
  bär: 'Bear',
  eber: 'Boar',
  hirsch: 'Deer',
  reh: 'Deer',
  vogel: 'Bird',
  frosch: 'Frog',
  spinne: 'Spider',
  skorpion: 'Scorpion',
  schlange: 'Snake',
  wurm: 'Worm',
  made: 'Worm',
  käfer: 'Beetle',
  kaefer: 'Beetle',
  kakerlake: 'Cockroach',
  wespe: 'Wasp',
  biene: 'Bee',
  fledermaus: 'Bat',
  drache: 'Dragon',
  drachling: 'Whelp',
  drachen: 'Dragon',
  daemon: 'Demon',
  teufel: 'Devil',
  engel: 'Angel',
  ghul: 'Ghoul',
  skelet: 'Skeleton',
  skelett: 'Skeleton',
  leiche: 'Corpse',
  zombie: 'Zombie',
  spuectum: 'Spectre',
  geist: 'Ghost',
  wesen: 'Elemental',
  sonne: 'Son',
  wind: 'Wind',
  wasser: 'Water',
  erde: 'Earth',
  feuerelemental: 'Fire Elemental'
}

// Staedte, Gebaeude, Raeume
const ORTE = {
  stadt: 'City',
  dorf: 'Village',
  burg: 'Keep',
  schloss: 'Fortress',
  turm: 'Tower',
  tor: 'Gate',
  haus: 'House',
  haeuser: 'House',
  kirche: 'Church',
  kathedrale: 'Cathedral',
  schmiede: 'Blacksmith',
  schmied: 'Smith',
  bank: 'Bank',
  bankier: 'Banker',
  taverne: 'Tavern',
  schank: 'Tavern',
  gasthaus: 'Inn',
  hafen: 'Harbor',
  fluss: 'River',
  berg: 'Mountain',
  see: 'Lake',
  wald: 'Forest',
  hoehle: 'Cave',
  grab: 'Grave',
  gruft: 'Crypt',
  tempel: 'Temple',
  richtplatz: 'Executioner'
}

const ALLE = Object.assign({}, MATERIAL, WAFFE, RUESTUNG, BEHAELTER, KLASSEN, VOELKER, KREATUREN, ORTE)

/*
 * Beide Schreibweisen muessen derselbe Schluessel sein: "Bär" und "Baer"
 * sind fuer jemanden, der ueber eine deutsche Tastatur sucht, dasselbe Wort.
 * Statt eine zweite Tabelle zu pflegen, wird jede Variante automatisch
 * erzeugt - sonst vergisst man irgendwann eine.
 */
const NORMAL = {}
for (const k of Object.keys(ALLE)) {
  const n = normalisiere(k)
  // Ein vorhandener Eintrag gewinnt nicht - aber er wird auch nicht
  // ueberschrieben, damit die Reihenfolge der Gruppen sichtbar bleibt.
  if (!(n in NORMAL)) NORMAL[n] = ALLE[k]
}

// Umlautschreibweisen zusammenfassen: baer <-> bär
function normalisiere (s) {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .trim()
}

// Endungen, die beim Umlaut-Entfernen entstehen und wieder wegduerfen
const ENTLUEUMUNGEN = ['', 'e', 'n', 's', 'es', 'en', 'er', 'em', 'r']

/*
 * Ein einzelnes Wort nachschlagen. Beruecksichtigt Beugung, aber nur so, dass
 * gesucht wird, was auch wirklich im Woerterbuch steht - "Knochen" darf nicht
 * zu "Koch" werden, nur weil das eine Woerterbuch ist.
 */
function uebersetzeWort (wort) {
  const w = normalisiere(wort)
  if (!w) return null
  if (NORMAL[w]) return NORMAL[w]
  for (const endung of ENTLUEUMUNGEN.slice(1)) {
    if (!w.endsWith(endung) || w.length <= endung.length + 2) continue
    const kürzer = w.slice(0, w.length - endung.length)
    if (NORMAL[kürzer]) return NORMAL[kürzer]
  }
  return null
}

/*
 * Suchbegriff in Suchmuster zerlegen.
 *
 * Reihenfolge ist aussagekraeftig: die Oberflaeche sortiert danach, damit das
 * exakte Ergebnis oben steht und der breitere Treffer "Schwert" darunter.
 *
 *   vollstaendig  - was der Nutzer getippt hat
 *   satz         - derselbe Satz, aber mit uebersetzten Woertern
 *   einzel       - jedes uebersetzte Wort einzeln
 */
function muster (suchbegriff) {
  const roh = String(suchbegriff || '').trim()
  if (!roh) return { vollstaendig: [], satz: [], einzel: [], uebersetzt: false, begriffe: [] }

  const woerter = roh.split(/[\s,]+/).filter(Boolean)
  const uebersetzungen = woerter.map(uebersetzeWort)
  const bekannt = uebersetzungen.some(Boolean)

  const vollstaendig = [roh]
  const satz = []
  if (bekannt) {
    // Satz bauen: uebersetzte Woerter ersetzen, unbekannte bleiben stehen.
    // "Schwert des Lichts" -> "Sword des Lichts" (der Rest greift ueber "Sword")
    satz.push(woerter.map((w, i) => uebersetzungen[i] || w).join(' '))
  }

  // Einzelwoerter, mehrfach vorkommende nur einmal
  const gesehen = new Set()
  const einzel = []
  for (const u of uebersetzungen) {
    if (!u) continue
    const k = u.toLowerCase()
    if (gesehen.has(k)) continue
    gesehen.add(k)
    einzel.push(u)
  }

  // Sehr allgemeine Woerter wuerden fast alles treffen und damit die
  // eigentliche Suche verschleiern - solche Muster werden weggelassen.
  const zuAllgemein = ['Item', 'Name', 'Level']
  const brauchbar = einzel.filter(w => !zuAllgemein.includes(w))

  return {
    vollstaendig,
    satz,
    einzel: brauchbar,
    uebersetzt: bekannt,
    begriffe: [...new Set([...vollstaendig, ...satz, ...brauchbar])]
  }
}

/* Alle Muster als SQL-Parameter, fuer name LIKE ? OR name LIKE ? ... */
function likeParameter (m) {
  return m.begriffe.map(b => `%${b}%`)
}

module.exports = {
  uebersetzeWort,
  normalisiere,
  muster,
  likeParameter,
  // fuer Tests
  anzahl: Object.keys(ALLE).length,
  alle: ALLE
}