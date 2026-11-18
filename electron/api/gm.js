'use strict'

const db = require('../db')
const schema = require('../db-schema')
const begriffe = require('../woe-begriffe')

function int (v, fallback = 0) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/*
 * Suchbegriff aufbereiten.
 *
 * Die Namen in der Datenbank sind englisch, die Oberflaeche ist deutsch.
 * Deshalb wird nicht nur der eingegebene Begriff gesucht, sondern auch seine
 * englische Entsprechung. Reihenfolge der Muster = absteigende Genauigkeit:
 * erst der ganze Begriff, dann der uebersetzte Satz, dann Einzelwoerter. Die
 * Oberflaeche sortiert nach dieser Reihenfolge, damit das exakte Ergebnis
 * oben steht und der breitere Treffer darunter.
 *
 * Maximal 8 Muster: mehr OR-Verbindungen machen die Abfrage langsamer, ohne
 * spuerbar mehr zu finden.
 */
function vorbereiten (search) {
  const m = begriffe.muster(search)
  if (!m.vollstaendig.length) return null
  const begriffeListe = m.begriffe.slice(0, 8)
  const reihenfolge = new Map(begriffeListe.map((b, i) => [b.toLowerCase(), i]))
  return {
    sql: begriffeListe.map(() => 'name LIKE ?').join(' OR '),
    werte: begriffeListe.map(b => `%${b}%`),
    // 0 = exakt getippt, 1 = uebersetzter Satz, 2 = Einzelwort
    rang: (rowName) => {
      const n = String(rowName || '').toLowerCase()
      if (n.includes(String(search || '').trim().toLowerCase())) return 0
      if (reihenfolge.has(n)) return 0
      return 2
    },
    uebersetzt: m.uebersetzt,
    suchbegriff: String(search || '').trim(),
    begriffe: m.begriffe
  }
}

/*
 * Ergebnisse sortieren: exakte Treffer zuerst, danach die kuerzeren Namen -
 * "Worn Shortsword" ist naher an "Schwert" als "The Blade of Crazed Defilers".
 */
function sortieren (zeilen, vor) {
  return zeilen
    .map((z, i) => ({ z, i }))
    .sort((a, b) => {
      const ra = vor.rang(a.z.name)
      const rb = vor.rang(b.z.name)
      if (ra !== rb) return ra - rb
      const la = String(a.z.name || '').length
      const lb = String(b.z.name || '').length
      if (la !== lb) return la - lb
      return a.i - b.i
    })
    .map(x => x.z)
}

async function lookupItems (search, limit = 40) {
  const vor = vorbereiten(search)
  if (!vor) return { treffer: [], uebersetzt: false, suchbegriff: '', begriffe: [] }
  const rows = await db.query('world', `
    SELECT entry, name, quality, ItemLevel, RequiredLevel, InventoryType, class, subclass, displayid, stackable
    FROM item_template
    WHERE ${vor.sql}
    LIMIT ?
  `, [...vor.werte, Math.max(int(limit, 40), vor.werte.length * 4)])
  const treffer = sortieren(rows, vor).slice(0, int(limit, 40)).map(r => ({
    entry: int(r.entry),
    name: r.name,
    quality: int(r.quality),
    itemLevel: int(r.ItemLevel),
    requiredLevel: int(r.RequiredLevel),
    inventoryType: int(r.InventoryType),
    class: int(r.class),
    subclass: int(r.subclass),
    displayId: int(r.displayid),
    stackable: int(r.stackable)
  }))
  return { treffer, uebersetzt: vor.uebersetzt, suchbegriff: vor.suchbegriff, begriffe: vor.begriffe }
}

async function lookupCreatures (search, limit = 40) {
  const vor = vorbereiten(search)
  if (!vor) return { treffer: [], uebersetzt: false, suchbegriff: '', begriffe: [] }
  const rows = await db.query('world', `
    SELECT entry, name, subname, minlevel, maxlevel, faction, npcflag
    FROM creature_template
    WHERE ${vor.sql}
    LIMIT ?
  `, [...vor.werte, Math.max(int(limit, 40), vor.werte.length * 4)])
  const treffer = sortieren(rows, vor).slice(0, int(limit, 40)).map(r => ({
    entry: int(r.entry),
    name: r.name,
    subname: r.subname || '',
    minLevel: int(r.minlevel),
    maxLevel: int(r.maxlevel),
    faction: int(r.faction),
    npcflag: int(r.npcflag)
  }))
  return { treffer, uebersetzt: vor.uebersetzt, suchbegriff: vor.suchbegriff, begriffe: vor.begriffe }
}

async function lookupGameObjects (search, limit = 40) {
  const vor = vorbereiten(search)
  if (!vor) return { treffer: [], uebersetzt: false, suchbegriff: '', begriffe: [] }
  const rows = await db.query('world', `
    SELECT entry, name, type, displayId, size
    FROM gameobject_template
    WHERE ${vor.sql}
    LIMIT ?
  `, [...vor.werte, Math.max(int(limit, 40), vor.werte.length * 4)])
  const treffer = sortieren(rows, vor).slice(0, int(limit, 40)).map(r => ({
    entry: int(r.entry),
    name: r.name,
    type: int(r.type),
    displayId: int(r.displayid),
    size: int(r.size)
  }))
  return { treffer, uebersetzt: vor.uebersetzt, suchbegriff: vor.suchbegriff, begriffe: vor.begriffe }
}

// Item direkt in character_inventory + item_instance schreiben (offline-faehig)
async function sendItem ({ guid, itemEntry, count = 1 }) {
  const g = int(guid)
  const item = int(itemEntry)
  const cnt = Math.max(1, int(count, 1))

  const ch = await db.query('chars', 'SELECT guid, online FROM characters WHERE guid = ?', [g])
  if (!ch.length) throw new Error('Charakter nicht gefunden.')
  if (int(ch[0].online) > 0) {
    throw new Error('Charakter ist online. Bitte erst ausloggen.')
  }

  const it = await db.query('world', 'SELECT entry, stackable FROM item_template WHERE entry = ?', [item])
  if (!it.length) throw new Error(`Item ${item} existiert nicht in item_template.`)

  // Freien Bag-Slot suchen (bag 255 = normale Tasche, slots 0..11 sind Equipslots 0-18)
  const used = await db.query('chars', 'SELECT bag, slot FROM character_inventory WHERE guid = ?', [g])
  const taken = new Set(used.map(u => `${u.bag}:${u.slot}`))
  let bag = 255
  let slot = -1
  for (let s = 19; s < 38; s++) {
    if (!taken.has(`255:${s}`)) {
      slot = s
      break
    }
  }
  if (slot === -1) {
    // in eine der 4 Bags (guid 1..4 -> bag 0..3, slots 0..35)
    for (let bagGuid = 1; bagGuid <= 4; bagGuid++) {
      for (let s = 0; s < 36; s++) {
        if (!taken.has(`${bagGuid - 1}:${s}`)) {
          bag = bagGuid - 1
          slot = s
          break
        }
      }
      if (slot !== -1) break
    }
  }
  if (slot === -1) throw new Error('Keine freien Bag-Slots. Item kann nicht zugestellt werden.')

  /*
   * Die Tabelle item_instance ist zwischen den Core-Versionen komplett
   * umgebaut worden. Frueher gab es ownerEnchantment, ownerFlags,
   * ownerCreationMail, ownerCount und enchantment1..3; heute heissen die
   * Gegenstuecke creatorGuid, flags, randomPropertyId und enchantments.
   *
   * Ein INSERT mit den alten Namen scheitert komplett - das Item wird dann
   * gar nicht erst zugestellt. Deshalb wird nur geschrieben, was es wirklich
   * gibt.
   *
   * Name und Wert stehen bewusst gemeinsam in einem Paar: so koennen
   * Platzhalter und Parameter nicht auseinanderlaufen, was bei zwei
   * getrennten Listen leicht passiert.
   */
  const inst = await schema.spalten('chars', 'item_instance')
  const paare = []
  const setze = (name, wert) => {
    if (!inst.has(name)) return
    paare.push({ name, wert })
  }

  setze('itemEntry', { param: item })
  setze('owner_guid', { param: g })
  setze('creatorGuid', 0)
  setze('giftCreatorGuid', 0)
  setze('ownerCount', { param: cnt })   // alte Fassung
  setze('count', { param: cnt })        // neue Fassung
  setze('duration', 0)
  setze('ownerEnchantment', -1)
  setze('ownerFlags', 0)
  setze('ownerCreationMail', 0)
  setze('flags', 0)
  setze('randomPropertyId', 0)
  setze('durability', 0)
  setze('playedTime', 0)
  // "enchantments" ist NOT NULL ohne Standard und muss mitgegeben werden
  setze('enchantments', '0 0 0 0 ')
  for (let i = 1; i <= 3; i++) setze(`enchantment${i}`, 0)

  const spalten = paare.map(p => `\`${p.name}\``).join(', ')
  // Werte, die keine Parameter sind, kommen direkt ins SQL und muessen
  // deshalb Text in Anfuehrungszeichen bekommen - sonst liest MySQL
  // "0 0 0 0" als Ausdruck und meldet einen Syntaxfehler.
  const zitieren = w => `'${String(w).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
  const platzhalter = paare.map(p => {
    if (!p.wert || typeof p.wert !== 'object') return typeof p.wert === 'string' ? zitieren(p.wert) : String(p.wert)
    return '?'
  }).join(', ')
  const parameter = paare.filter(p => p.wert && typeof p.wert === 'object').map(p => p.wert.param)

  /*
   * Wichtig: item_instance.guid ist im modernen Core ein normaler
   * Primaerschluessel OHNE AUTO_INCREMENT - der Server vergibt die Nummer
   * selbst. Ein INSERT liefert darueber hinaus kein insertId; ohne eigene
   * Vergabe bekaeme jedes Item die guid 0 und alle stuenden in Konflikt.
   */
  const maxRow = await db.query('chars', 'SELECT MAX(guid) AS m FROM item_instance')
  const itemInstanceGuid = int(maxRow[0] ? maxRow[0].m : 0) + 1
  if (itemInstanceGuid <= 0) throw new Error('Item-GUID konnte nicht vergeben werden.')

  const insert = await db.execute(
    'chars',
    `INSERT INTO item_instance (${spalten}, \`guid\`) VALUES (${platzhalter}, ?)`,
    [...parameter, itemInstanceGuid]
  )
  if (insert && insert.affectedRows && insert.affectedRows === 0) {
    throw new Error('Item konnte nicht angelegt werden.')
  }

  await db.execute('chars', 'INSERT INTO character_inventory (guid, item, slot) VALUES (?, ?, ?)', [
    g,
    itemInstanceGuid,
    slot
  ])

  return { ok: true, itemInstanceGuid, bag, slot }
}

async function deleteItem ({ guid, itemGuid }) {
  await db.execute('chars', 'DELETE FROM character_inventory WHERE guid = ? AND item = ?', [
    int(guid),
    int(itemGuid)
  ])
  await db.execute('chars', 'DELETE FROM item_instance WHERE guid = ?', [int(itemGuid)])
  return { ok: true }
}

module.exports = {
  lookupItems,
  lookupCreatures,
  lookupGameObjects,
  sendItem,
  deleteItem
}