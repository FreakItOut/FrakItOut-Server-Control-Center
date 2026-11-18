'use strict'

const fs = require('fs')
const configEditor = require('./config-editor')

/*
 * Server-Raten aus der worldserver.conf.
 *
 * Die genauen Schluesselnamen unterscheiden sich je nach Core-Version
 * (AzerothCore, TrinityCore, CMaNGOS) und tragen teils einen Punkt am Ende.
 * Deshalb werden die vorhandenen "Rates.*"-Eintraege gelesen und zur
 * Bearbeitung angeboten, statt eine feste Liste zu erfinden.
 *
 * Schreibgeschuetzt sind ausschliesslich Schluessel mit dem Praefix
 * "Rates." bzw. "Rate." - so kann in der worldserver.conf nichts
 * versehentlich ueberschrieben werden.
 */

const RATE_KEY_RE = /^Rates?\./i

/*
 * Sinnvolle Anfangswerte, falls eine Config noch keine Raten enthaelt
 */
const DEFAULTS = [
  ['Rates.Loot.', '1.0'],
  ['Rates.Health.', '1.0'],
  ['Rates.Craft.', '1.0'],
  ['Rates.Quest.', '1.0'],
  ['Rates.Reputation.', '1.0'],
  ['Rates.Honor.', '1.0'],
  ['Rates.Dungeon.', '1.0'],
  ['Rates.Battle.', '1.0'],
  ['Rates.Whisper.', '1.0']
]

/*
 * Gruppen fuer die Oberflaeche.
 *
 * Eine worldserver.conf hat schnell ueber 90 Rate-Schluessel (die des
 * AzerothCore-Repacks hat 96). Als eine flache Liste ist das nicht zu
 * bedienen: der gesuchte Wert geht in der Masse unter.
 *
 * Die Reihenfolge ist Absicht: zuerst, was den SPIELER betrifft, dann was
 * ihn voranbringt, dann seine eigenen Werte im Kampf, erst danach Welt,
 * Gegner und Marktplatz. Wer eine Rate sucht, sucht fast immer in den
 * ersten drei Gruppen.
 *
 * "match" wird der Reihe nach geprueft; der erste Treffer gewinnt. Kein
 * Treffer -> "other".
 */
const GROUPS = [
  {
    id: 'character',
    // Stufe, Talente, Fertigkeiten, Begleiter, Erholungsbonus
    match: [/^Rates?\.XP\./i, /^Rates?\.Talent/i, /^Rates?\.Skill\./i, /^Rates?\.Pet\./i, /^Rates?\.Rest/i]
  },
  {
    id: 'reputation',
    // Ansehen, Ehre, Arenapunkte, Schlachtfelder
    match: [/^Rates?\.Reputation/i, /^Rates?\.Honor/i, /^Rates?\.ArenaPoints/i, /^Rates?\.Battleground/i]
  },
  {
    id: 'combat',
    // Die Werte des Spielers selbst: Ressourcen, Regeneration, Laufweg
    match: [
      /^Rates?\.(Health|Mana|Rage|RunicPower|Focus|Energy)/i,
      /^Rates?\.MoveSpeed/i,
      /^Rates?\.Damage\./i,
      /^Rates?\.MissChanceMultiplier/i
    ]
  },
  {
    id: 'loot',
    // Was der Spieler bekommt und was es kostet
    match: [
      /^Rates?\.Drop\./i,
      /^Rates?\.(SellValue|BuyValue)\./i,
      /^Rates?\.Reward/i,
      /^Rates?\.RepairCost/i,
      /^Rates?\.(Loot|Money)/i
    ]
  },
  {
    id: 'world',
    // Die Gegenseite: wie stark und zaeh Kreaturen sind
    match: [/^Rates?\.Creature/i, /^Rates?\.Corpse/i]
  },
  {
    id: 'economy',
    // Auktionshaus und Instanz-Zuruecksetzung
    match: [/^Rates?\.Auction/i, /^Rates?\.InstanceResetTime/i]
  },
  {
    id: 'other',
    //alles, was in keine Gruppe passt
    match: []
  }
]

function groupOf (key) {
  for (const g of GROUPS) {
    if (g.match.some(re => re.test(key))) return g.id
  }
  return 'other'
}

/*
 * Die Beschreibung eines Schalters - oder null, wenn keine hinterlegt
 * ist. Fuer Tests und fuer die Pruefung, ob alle Raten beschrieben sind.
 */
function hilfeZu (key) {
  return HILFE[key] || null
}

/*
 * Anzeigenamen fuer die gaengigen Raten.
 * `key` ist der stabile Bezeichner, an dem die Oberflaeche die Uebersetzung
 * haengt; `label` ist der deutsche Anzeigename als Rueckfall.
 */
const LABELS = {
  loot: { de: 'Loot', en: 'Loot' },
  health: { de: 'Regeneration', en: 'Regeneration' },
  craft: { de: 'Handwerk', en: 'Crafting' },
  quest: { de: 'Quests', en: 'Quests' },
  reputation: { de: 'Ruf', en: 'Reputation' },
  honor: { de: 'Ehre', en: 'Honor' },
  dungeon: { de: 'Instanzen', en: 'Dungeons' },
  battle: { de: 'Schlachtfelder', en: 'Battlegrounds' },
  whisper: { de: 'Geflüster', en: 'Whispers' },
  arena: { de: 'Arena', en: 'Arena' },
  taxi: { de: 'Taxi', en: 'Taxi' },
  mail: { de: 'Post', en: 'Mail' },
  auction: { de: 'Auktion', en: 'Auction' }
}

/*
 * Die Teile eines Rate-Schluessels in lesbare Woerter zerlegen.
 *
 * Reicht den ganzen Schluessel als einen Namen zu zeigen, bekommt man
 * zwölf Zeilen "XP.*" untereinander und kann sie nicht unterscheiden.
 * Zerlegt in Teile wird daraus "Erfahrung — Töten" gegen "Erfahrung —
 * Quests" - auch in der Liste unterscheidbar, und der technische Name
 * steht ohnehin eine Zeile darunter.
 *
 * Die Uebersetzung haengt im Frontend an diesen Teilen (rates.part.*).
 * Unbekannte Teile bleiben, wie sie sind - so geht nichts verloren, wenn
 * ein Fork neue Schluessel mitbringt.
 */
const TEILE = {
  // Familien
  xp: { de: 'Erfahrung', en: 'Experience' },
  talent: { de: 'Talente', en: 'Talents' },
  skill: { de: 'Fertigkeiten', en: 'Skills' },
  pet: { de: 'Begleiter', en: 'Pets' },
  rest: { de: 'Erholung', en: 'Rest' },
  reputation: { de: 'Ruf', en: 'Reputation' },
  honor: { de: 'Ehre', en: 'Honor' },
  arenapoints: { de: 'Arenapunkte', en: 'Arena points' },
  health: { de: 'Lebenspunkte', en: 'Health' },
  mana: { de: 'Mana', en: 'Mana' },
  rage: { de: 'Wut', en: 'Rage' },
  runicpower: { de: 'Runenmacht', en: 'Runic power' },
  focus: { de: 'Fokus', en: 'Focus' },
  energy: { de: 'Energie', en: 'Energy' },
  movespeed: { de: 'Laufgeschwindigkeit', en: 'Move speed' },
  damage: { de: 'Schaden', en: 'Damage' },
  misschancemultiplier: { de: 'Trefferchance', en: 'Miss chance' },
  drop: { de: 'Beute', en: 'Loot drop' },
  sellvalue: { de: 'Verkaufswert', en: 'Sell value' },
  buyvalue: { de: 'Kaufwert', en: 'Buy value' },
  reward: { de: 'Belohnung', en: 'Reward' },
  repaircost: { de: 'Reparaturkosten', en: 'Repair cost' },
  creature: { de: 'Kreaturen', en: 'Creatures' },
  corpse: { de: 'Leichen', en: 'Corpses' },
  auction: { de: 'Auktionshaus', en: 'Auction house' },
  instanceresettime: { de: 'Instanz-Zurücksetzung', en: 'Instance reset' },
  // Eigenschaften
  kill: { de: 'Töten', en: 'Kills' },
  quest: { de: 'Quests', en: 'Quests' },
  df: { de: 'Dungeonfinder', en: 'Dungeon Finder' },
  explore: { de: 'Erkunden', en: 'Exploration' },
  player: { de: 'Spieler', en: 'Player' },
  npc: { de: 'NSCs', en: 'NPCs' },
  fall: { de: 'Fallschaden', en: 'Fall damage' },
  targetcreature: { de: 'auf Kreaturen', en: 'vs creatures' },
  targetplayer: { de: 'auf Spieler', en: 'vs players' },
  onlyaffectsplayer: { de: 'wirkt nur auf Spieler', en: 'affects players only' },
  discovery: { de: 'Entdecken', en: 'Discovery' },
  income: { de: 'Zugang', en: 'gain' },
  loss: { de: 'Verlust', en: 'loss' },
  ingame: { de: 'im Spiel', en: 'in game' },
  offline: { de: 'offline', en: 'offline' },
  intavernorcity: { de: 'in Wirtshaus oder Stadt', en: 'in tavern or city' },
  inwilderness: { de: 'in der Wildnis', en: 'in the wilderness' },
  maxbonus: { de: 'Höchstbonus', en: 'maximum bonus' },
  levelxp: { de: 'Stufenerfahrung', en: 'level experience' },
  gain: { de: 'Zuwachs', en: 'gain' },
  lowlevel: { de: 'niedrige Stufe', en: 'low level' },
  recruitafriendbonus: { de: 'Freunde-werben-Bonus', en: 'recruit-a-friend bonus' },
  item: { de: 'Gegenstände', en: 'items' },
  poor: { de: 'Schlecht', en: 'Poor' },
  normal: { de: 'Normal', en: 'Normal' },
  uncommon: { de: 'Ungewöhnlich', en: 'Uncommon' },
  rare: { de: 'Rar', en: 'Rare' },
  rareelite: { de: 'Rar-Elite', en: 'Rare elite' },
  elite: { de: 'Elite', en: 'Elite' },
  worldboss: { de: 'Weltboss', en: 'World boss' },
  epic: { de: 'Episch', en: 'Epic' },
  legendary: { de: 'Legendär', en: 'Legendary' },
  artifact: { de: 'Artefakt', en: 'Artifact' },
  heirloom: { de: 'Erbstück', en: 'Heirloom' },
  referenced: { de: 'Loot-Gruppen', en: 'Loot groups' },
  referencedamount: { de: 'Loot-Gruppen-Menge', en: 'Loot group amount' },
  groupamount: { de: 'Gruppenmenge', en: 'Group amount' },
  money: { de: 'Geld', en: 'Money' },
  questmoney: { de: 'Questgeld', en: 'Quest money' },
  bonusmoney: { de: 'Bonusgeld', en: 'Bonus money' },
  aggro: { de: 'Bedrohung', en: 'Aggro' },
  decay: { de: 'Verfall', en: 'Decay' },
  looted: { de: 'geleert', en: 'after looting' },
  time: { de: 'Laufzeit', en: 'Duration' },
  deposit: { de: 'Anzahlung', en: 'Deposit' },
  cut: { de: 'Gebühr', en: 'Cut' },
  hp: { de: 'Lebenspunkte', en: 'Health' },
  spelldamage: { de: 'Zauberschaden', en: 'Spell damage' },
  battlegroundkillav: { de: 'Alteractal', en: 'Alterac Valley' },
  battlegroundkillwsg: { de: 'Kriegshymnenschlucht', en: 'Warsong Gulch' },
  battlegroundkillab: { de: 'Arathibecken', en: 'Arathi Basin' },
  battlegroundkilleots: { de: 'Auge des Sturms', en: 'Eye of the Storm' },
  battlegroundkillsota: { de: 'Strand der Uralten', en: 'Strand of the Ancients' },
  battlegroundkillic: { de: 'Insel der Eroberung', en: 'Isle of Conquest' },
  battlegroundbonus: { de: 'Schlachtfeld-Bonus', en: 'Battleground bonus' },
  battleground: { de: 'Schlachtfelder', en: 'Battlegrounds' },
  wsg: { de: 'Kriegshymnenschlucht', en: 'Warsong Gulch' },
  ab: { de: 'Arathibecken', en: 'Arathi Basin' },
  av: { de: 'Alteractal', en: 'Alterac Valley' },
  eots: { de: 'Auge des Sturms', en: 'Eye of the Storm' },
  sota: { de: 'Strand der Uralten', en: 'Strand of the Ancients' },
  ic: { de: 'Insel der Eroberung', en: 'Isle of Conquest' },
  '2v2': { de: '2v2', en: '2v2' },
  '3v3': { de: '3v3', en: '3v3' },
  // Schluessel ohne Punkt im Namen: Rate.ArenaPoints2v2 usw. wuerden sonst
  // als ein einziges unbekanntes Teil durchgehen.
  arenapoints2v2: { de: 'Arenapunkte 2v2', en: 'Arena points 2v2' },
  arenapoints3v3: { de: 'Arenapunkte 3v3', en: 'Arena points 3v3' },
  rewardquestmoney: { de: 'Questgeld', en: 'Quest money' },
  rewardbonusmoney: { de: 'Bonusgeld', en: 'Bonus money' }
}

/*
 * Was der Schalter tut.
 *
 * Der englische Text stammt nicht aus dieser Datei, sondern aus der
 * worldserver.conf des installierten Cores. Dort dokumentiert AzerothCore
 * jeden Schalter selbst:
 *
 *     #    Rate.XP.Kill
 *     #        Description: Experience rates (outside battleground)
 *
 * Ausgelesen von scripts/holt-raten-beschreibungen.js. Das ist die
 * beste moegliche Quelle: der Core, genau in der Version, die laeuft.
 * Selbstgeschriebene Erklaerungen waeren eine zweite Wahrheit, die
 * irgendwann auseinanderlaeuft.
 *
 * Zwei Ergaenzungen gegenueber dem Core-Text:
 *
 *  - Der Core gibt Geschwistern denselben Text ("Drop rates for money
 *    and items based on quality." bei allen acht Drop.Item.*). Hier
 *    steht die Qualitaet mit drin, sonst ist die Zeile nicht von
 *    der darunter zu unterscheiden.
 *
 *  - Der Core beschriftet die Kaufwerte faelschlich mit "Item Sale
 *    Value". Fuer BuyValue steht hier "Kaufpreis".
 *
 * Die Beschreibung erscheint in der Oberflaeche als Hilfetext unter dem
 * Namen - der technische Schluessel steht weiterhin darunter.
 */
const HILFE = {
  // ---------- Kampf & Regeneration ----------
  'Rate.MoveSpeed.Player': { de: 'Laufgeschwindigkeit der Spieler.', en: 'Movement speed rate for players.' },
  'Rate.MoveSpeed.NPC': { de: 'Laufgeschwindigkeit der NPCs.', en: 'Movement speed rate for NPCs.' },
  'Rate.Damage.Fall': { de: 'Schaden durch Stürze.', en: 'Damage after fall rate.' },
  'Rate.Health': { de: 'Geschwindigkeit der Lebenspunkte-Regeneration.', en: 'Health regeneration rate.' },
  'Rate.Mana': { de: 'Geschwindigkeit der Mana-Regeneration.', en: 'Mana regeneration rate.' },
  'Rate.Rage.Income': { de: 'Geschwindigkeit, mit der Wut aufgebaut wird.', en: 'Rage gain rate.' },
  'Rate.Rage.Loss': { de: 'Geschwindigkeit, mit der Wut abfließt.', en: 'Rage decay rate.' },
  'Rate.RunicPower.Income': { de: 'Geschwindigkeit, mit der Runenmacht aufgebaut wird.', en: 'Runic power gain rate.' },
  'Rate.RunicPower.Loss': { de: 'Geschwindigkeit, mit der Runenmacht abfließt.', en: 'Runic power decay rate.' },
  'Rate.Focus': { de: 'Geschwindigkeit der Fokus-Regeneration.', en: 'Focus regeneration rate.' },
  'Rate.Energy': { de: 'Geschwindigkeit der Energie-Regeneration.', en: 'Energy regeneration rate.' },
  'Rate.MissChanceMultiplier.TargetCreature': {
    de: 'Trefferchance gegen Kreaturen, die 3 oder mehr Stufen über dem Spieler stehen. Größerer Wert bedeutet öfter daneben. Wirkt nicht, wenn der Unterschied unter 3 Stufen liegt.',
    en: 'Hit chance against creatures 3 or more levels above the player. A higher value means more misses. Does not apply when the level difference is under 3.'
  },
  'Rate.MissChanceMultiplier.TargetPlayer': {
    de: 'Trefferchance gegen Spieler, die 3 oder mehr Stufen über dem Spieler stehen. Größerer Wert bedeutet öfter daneben. Wirkt nicht, wenn der Unterschied unter 3 Stufen liegt.',
    en: 'Hit chance against players 3 or more levels above the player. A higher value means more misses. Does not apply when the level difference is under 3.'
  },
  'Rate.MissChanceMultiplier.OnlyAffectsPlayer': {
    de: 'Nur die Trefferchance der Spieler verändern, nicht die der Kreaturen. Auf 1 stellen, damit das gewünschte Gefechtsgefühl nur für Spieler gilt.',
    en: 'Only change the miss chance of players, not of creatures. Set to 1 to make the desired combat feel apply to players alone.'
  },

  // ---------- Charakter & Stufen ----------
  'Rate.Talent': { de: 'Geschwindigkeit, mit der Talente gesetzt werden dürfen.', en: 'Talent point rate.' },
  'Rate.Talent.Pet': { de: 'Geschwindigkeit, mit der Begleitertalente gesetzt werden dürfen.', en: 'Pet talent point rate.' },
  'Rate.Skill.Discovery': { de: 'Geschwindigkeit, mit der Berufe und Rezepte entdeckt werden.', en: 'Skill discovery rate.' },
  'Rate.Pet.LevelXP': {
    de: 'Wie viel Erfahrung ein Begleiter zum Stufenaufstieg braucht. Kleinerer Wert heißt schneller hoch.',
    en: 'How much experience a pet needs to level up. A lower value means it levels faster.'
  },
  'Rate.Rest.InGame': { de: 'Geschwindigkeit des ruhe-basierten Erfahrungsbonus, wenn der Charakter im Sitzen ist.', en: 'Rested XP gain while sitting in game.' },
  'Rate.Rest.Offline.InTavernOrCity': {
    de: 'Geschwindigkeit des ruhe-basieten Erfahrungsbonus offline, wenn der Charakter in einem Gasthaus oder einer Stadt ruht.',
    en: 'Rested XP gain offline while resting in a tavern or city.'
  },
  'Rate.Rest.Offline.InWilderness': {
    de: 'Geschwindigkeit des ruhe-basierten Erfahrungsbonus offline, wenn der Charakter in freier Wildnis ruht.',
    en: 'Rested XP gain offline while resting in the wilderness.'
  },
  'Rate.Rest.MaxBonus': { de: 'Obergrenze des ruhe-basierten Erfahrungsbonus.', en: 'Upper limit for the rested XP bonus.' },
  'Rate.XP.Kill': { de: 'Erfahrung für das Töten von Kreaturen, außerhalb von Schlachtfeldern.', en: 'Experience from killing creatures, outside battlegrounds.' },
  'Rate.XP.Quest': { de: 'Erfahrung für abgeschlossene Quests, außerhalb von Schlachtfeldern.', en: 'Experience from completed quests, outside battlegrounds.' },
  'Rate.XP.Quest.DF': { de: 'Erfahrung für Quests der Dungeon-Suche (LFG).', en: 'Experience from Dungeon Finder quests.' },
  'Rate.XP.Explore': { de: 'Erfahrung für das Erkunden neuer Gebiete.', en: 'Experience from exploring new areas.' },
  'Rate.XP.Pet': { de: 'Erfahrung für das Töten von Kreaturen mit einem Begleiter.', en: 'Experience from killing creatures with a pet.' },
  'Rate.XP.BattlegroundKillAV': { de: 'Erfahrung für ehrliche Kills im Alteractal. Wird nicht von Rate.XP.Kill beeinflusst; wirkt nur bei Battleground.GiveXPForKills = 1.', en: 'Experience for honorable kills in Alterac Valley. Not affected by Rate.XP.Kill; only works if Battleground.GiveXPForKills = 1.' },
  'Rate.XP.BattlegroundKillWSG': { de: 'Erfahrung für ehrliche Kills in der Kriegshymnenschlucht. Wird nicht von Rate.XP.Kill beeinflusst; wirkt nur bei Battleground.GiveXPForKills = 1.', en: 'Experience for honorable kills in Warsong Gulch. Not affected by Rate.XP.Kill; only works if Battleground.GiveXPForKills = 1.' },
  'Rate.XP.BattlegroundKillAB': { de: 'Erfahrung für ehrliche Kills im Arathibecken. Wird nicht von Rate.XP.Kill beeinflusst; wirkt nur bei Battleground.GiveXPForKills = 1.', en: 'Experience for honorable kills in Arathi Basin. Not affected by Rate.XP.Kill; only works if Battleground.GiveXPForKills = 1.' },
  'Rate.XP.BattlegroundKillEOTS': { de: 'Erfahrung für ehrliche Kills im Auge des Sturms. Wird nicht von Rate.XP.Kill beeinflusst; wirkt nur bei Battleground.GiveXPForKills = 1.', en: 'Experience for honorable kills in Eye of the Storm. Not affected by Rate.XP.Kill; only works if Battleground.GiveXPForKills = 1.' },
  'Rate.XP.BattlegroundKillSOTA': { de: 'Erfahrung für ehrliche Kills am Strand der Uralten. Wird nicht von Rate.XP.Kill beeinflusst; wirkt nur bei Battleground.GiveXPForKills = 1.', en: 'Experience for honorable kills in Strand of the Ancients. Not affected by Rate.XP.Kill; only works if Battleground.GiveXPForKills = 1.' },
  'Rate.XP.BattlegroundKillIC': { de: 'Erfahrung für ehrliche Kills auf der Insel der Eroberung. Wird nicht von Rate.XP.Kill beeinflusst; wirkt nur bei Battleground.GiveXPForKills = 1.', en: 'Experience for honorable kills in Isle of Conquest. Not affected by Rate.XP.Kill; only works if Battleground.GiveXPForKills = 1.' },
  'Rate.XP.BattlegroundBonus': {
    de: 'Erfahrung für Ziele im Schlachtfeld, etwa Flaggen oder eroberte Basen.',
    en: 'Experience for battleground objectives such as flag captures or base assaults.'
  },

  // ---------- Ruf, Ehre & PvP ----------
  'Rate.Reputation.Gain': { de: 'Geschwindigkeit des Rufsgewinns.', en: 'Reputation gain rate.' },
  'Rate.Reputation.LowLevel.Kill': { de: 'Ruf beim Töten untergeordneter Kreaturen (graue).', en: 'Reputation from killing low level (grey) creatures.' },
  'Rate.Reputation.LowLevel.Quest': { de: 'Rufgewinn durch Quests.', en: 'Reputation gain from quests.' },
  'Rate.Reputation.RecruitAFriendBonus': { de: 'Rufbonus für das Werben eines Freundes.', en: 'Reputation bonus for recruiting a friend.' },
  'Rate.Reputation.Gain.WSG': {
    de: 'Rufbonus in der Kriegshymnenschlucht. Wird zusätzlich zum allgemeinen Rate.Reputation.Gain gerechnet.',
    en: 'Reputation bonus in Warsong Gulch. Applied in addition to the global Rate.Reputation.Gain.'
  },
  'Rate.Reputation.Gain.AB': {
    de: 'Rufbonus im Arathibecken. Wird zusätzlich zum allgemeinen Rate.Reputation.Gain gerechnet.',
    en: 'Reputation bonus in Arathi Basin. Applied in addition to the global Rate.Reputation.Gain.'
  },
  'Rate.Reputation.Gain.AV': {
    de: 'Rufbonus im Alteractal. Wird zusätzlich zum allgemeinen Rate.Reputation.Gain gerechnet.',
    en: 'Reputation bonus in Alterac Valley. Applied in addition to the global Rate.Reputation.Gain.'
  },
  'Rate.Honor': { de: 'Geschwindigkeit des Ehregewinns.', en: 'Honor gain rate.' },
  'Rate.ArenaPoints': { de: 'Geschwindigkeit des Arenapunktegewinns.', en: 'Arena points gain rate.' },
  'Rate.ArenaPoints2v2': { de: 'Arenapunkte im 2v2-Rahmen.', en: 'Arena points gain rate for the 2v2 bracket.' },
  'Rate.ArenaPoints3v3': { de: 'Arenapunkte im 3v3-Rahmen.', en: 'Arena points gain rate for the 3v3 bracket.' },

  // ---------- Beute & Geld ----------
  'Rate.Drop.Item.Poor': { de: 'Beutechance für Gegenstände der Qualität „Schlecht".', en: 'Drop rate for items of Poor quality.' },
  'Rate.Drop.Item.Normal': { de: 'Beutechance für Gegenstände der Qualität „Normal".', en: 'Drop rate for items of Normal quality.' },
  'Rate.Drop.Item.Uncommon': { de: 'Beutechance für Gegenstände der Qualität „Ungewöhnlich".', en: 'Drop rate for items of Uncommon quality.' },
  'Rate.Drop.Item.Rare': { de: 'Beutechance für Gegenstände der Qualität „Rar".', en: 'Drop rate for items of Rare quality.' },
  'Rate.Drop.Item.Epic': { de: 'Beutechance für Gegenstände der Qualität „Episch".', en: 'Drop rate for items of Epic quality.' },
  'Rate.Drop.Item.Legendary': { de: 'Beutechance für Gegenstände der Qualität „Legendär".', en: 'Drop rate for items of Legendary quality.' },
  'Rate.Drop.Item.Artifact': { de: 'Beutechance für Artefakte.', en: 'Drop rate for artifacts.' },
  'Rate.Drop.Item.Referenced': { de: 'Beutechance für verweiste Beutepakete.', en: 'Drop rate for referenced loot.' },
  'Rate.Drop.Money': { de: 'Beutechance für Geld.', en: 'Drop rate for money.' },
  'Rate.Drop.Item.ReferencedAmount': {
    de: 'Menge der verwiesenen Beutepakete. Lässt viele Raidbossen zusätzliche Beute fallen.',
    en: 'Amount of referenced loot. Makes many raid bosses (and others) drop additional loot.'
  },
  'Rate.Drop.Item.GroupAmount': {
    de: 'Menge der gruppierten Gegenstände. Lässt viele Instanzbossen zusätzliche Beute fallen.',
    en: 'Amount of grouped items. Makes many dungeon bosses (and others) drop additional loot.'
  },
  'Rate.SellValue.Item.Poor': { de: 'Verkaufspreis für Gegenstände der Qualität „Schlecht".', en: 'Sale price for items of Poor quality.' },
  'Rate.SellValue.Item.Normal': { de: 'Verkaufspreis für Gegenstände der Qualität „Normal".', en: 'Sale price for items of Normal quality.' },
  'Rate.SellValue.Item.Uncommon': { de: 'Verkaufspreis für Gegenstände der Qualität „Ungewöhnlich".', en: 'Sale price for items of Uncommon quality.' },
  'Rate.SellValue.Item.Rare': { de: 'Verkaufspreis für Gegenstände der Qualität „Rar".', en: 'Sale price for items of Rare quality.' },
  'Rate.SellValue.Item.Epic': { de: 'Verkaufspreis für Gegenstände der Qualität „Episch".', en: 'Sale price for items of Epic quality.' },
  'Rate.SellValue.Item.Legendary': { de: 'Verkaufspreis für Gegenstände der Qualität „Legendär".', en: 'Sale price for items of Legendary quality.' },
  'Rate.SellValue.Item.Artifact': { de: 'Verkaufspreis für Artefakte.', en: 'Sale price for artifacts.' },
  'Rate.SellValue.Item.Heirloom': { de: 'Verkaufspreis für Erbstücke.', en: 'Sale price for heirlooms.' },
  'Rate.BuyValue.Item.Poor': { de: 'Kaufpreis für Gegenstände der Qualität „Schlecht".', en: 'Purchase price for items of Poor quality.' },
  'Rate.BuyValue.Item.Normal': { de: 'Kaufpreis für Gegenstände der Qualität „Normal".', en: 'Purchase price for items of Normal quality.' },
  'Rate.BuyValue.Item.Uncommon': { de: 'Kaufpreis für Gegenstände der Qualität „Ungewöhnlich".', en: 'Purchase price for items of Uncommon quality.' },
  'Rate.BuyValue.Item.Rare': { de: 'Kaufpreis für Gegenstände der Qualität „Rar".', en: 'Purchase price for items of Rare quality.' },
  'Rate.BuyValue.Item.Epic': { de: 'Kaufpreis für Gegenstände der Qualität „Episch".', en: 'Purchase price for items of Epic quality.' },
  'Rate.BuyValue.Item.Legendary': { de: 'Kaufpreis für Gegenstände der Qualität „Legendär".', en: 'Purchase price for items of Legendary quality.' },
  'Rate.BuyValue.Item.Artifact': { de: 'Kaufpreis für Artefakte.', en: 'Purchase price for artifacts.' },
  'Rate.BuyValue.Item.Heirloom': { de: 'Kaufpreis für Erbstücke.', en: 'Purchase price for heirlooms.' },
  'Rate.RewardQuestMoney': {
    de: 'Geld aus Questbelohnungen. Berührt den Maxstufen-Bonus nicht.',
    en: 'Money awarded by quests. Does not affect the max level bonus.'
  },
  'Rate.RewardBonusMoney': {
    de: 'Zusatzgeld aus Questbelohnungen, wenn der Charakter auf Maximalstufe ist.',
    en: 'Extra money awarded by quests when the character is at max level.'
  },
  'Rate.RepairCost': { de: 'Kosten für Reparaturen.', en: 'Repair cost rate.' },

  // ---------- Gegner & Bosse ----------
  'Rate.Creature.Aggro': { de: 'Wirkungsradius der Bedrohung, in Prozent.', en: 'Aggro radius percentage.' },
  'Rate.Corpse.Decay.Looted': {
    de: 'Wie lange Kreaturenleichen nach dem Plündern liegen bleiben.',
    en: 'How long creature corpses stay after they have been looted.'
  },
  'Rate.Creature.Normal.Damage': { de: 'Nahkampfschaden normaler Kreaturen.', en: 'Melee damage of normal creatures.' },
  'Rate.Creature.Elite.Elite.Damage': { de: 'Nahkampfschaden elitierter Kreaturen.', en: 'Melee damage of elite creatures.' },
  'Rate.Creature.Elite.RARE.Damage': { de: 'Nahkampfschaden seltener Kreaturen.', en: 'Melee damage of rare creatures.' },
  'Rate.Creature.Elite.RAREELITE.Damage': { de: 'Nahkampfschaden sehr seltener Kreaturen.', en: 'Melee damage of rare elite creatures.' },
  'Rate.Creature.Elite.WORLDBOSS.Damage': { de: 'Nahkampfschaden von Weltbossen.', en: 'Melee damage of world bosses.' },
  'Rate.Creature.Normal.SpellDamage': { de: 'Zauberschaden normaler Kreaturen.', en: 'Spell damage of normal creatures.' },
  'Rate.Creature.Elite.Elite.SpellDamage': { de: 'Zauberschaden elitierter Kreaturen.', en: 'Spell damage of elite creatures.' },
  'Rate.Creature.Elite.RARE.SpellDamage': { de: 'Zauberschaden seltener Kreaturen.', en: 'Spell damage of rare creatures.' },
  'Rate.Creature.Elite.RAREELITE.SpellDamage': { de: 'Zauberschaden sehr seltener Kreaturen.', en: 'Spell damage of rare elite creatures.' },
  'Rate.Creature.Elite.WORLDBOSS.SpellDamage': { de: 'Zauberschaden von Weltbossen.', en: 'Spell damage of world bosses.' },
  'Rate.Creature.Normal.HP': { de: 'Lebenspunkte normaler Kreaturen.', en: 'Health of normal creatures.' },
  'Rate.Creature.Elite.Elite.HP': { de: 'Lebenspunkte elitierter Kreaturen.', en: 'Health of elite creatures.' },
  'Rate.Creature.Elite.RARE.HP': { de: 'Lebenspunkte seltener Kreaturen.', en: 'Health of rare creatures.' },
  'Rate.Creature.Elite.RAREELITE.HP': { de: 'Lebenspunkte sehr seltener Kreaturen.', en: 'Health of rare elite creatures.' },
  'Rate.Creature.Elite.WORLDBOSS.HP': { de: 'Lebenspunkte von Weltbossen.', en: 'Health of world bosses.' },

  // ---------- Instanzen & Marktplatz ----------
  'Rate.InstanceResetTime': {
    de: 'Abstand zwischen den Zurücksetzungen von Instanzen. Größerer Wert heißt länger. Wirkt erst, wenn instance_reset in der Zeichendatenbank geleert wurde.',
    en: 'Time between instance resets. A higher value means longer. Only takes effect after clearing instance_reset in the characters database.'
  },
  'Rate.Auction.Time': { de: 'Laufzeit der Auktionen.', en: 'How long an auction runs.' },
  'Rate.Auction.Deposit': { de: 'Anzahlung beim Einstellen eines Angebots.', en: 'Deposit charged when an auction is listed.' },
  'Rate.Auction.Cut': { de: 'Gebühr, die das Auktionshaus vom Erlös einbehält.', en: 'Fee the auction house takes from the final price.' }
}

/* --------------------------------------------- Namen und Beschreibungen */

// "Rates.XP.Kill." -> ["xp", "kill"]
function keyParts (key) {
  return key
    .replace(/^Rates?\./i, '')
    .replace(/\.+$/, '')
    .split('.')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

/*
 * Der Name ohne Uebersetzung. Wird nur als Rueckfall benutzt, wenn das
 * Frontend keinen der Teile kennt.
 *
 * Doppelte Nachbarn fallen raus: "Creature.Elite.Elite" heisst im Kern
 * schlicht Elite - die Verdopplung ist ein Schreibfehler im Core, den man
 * nicht an den Nutzer weiterreichen muss.
 */
function friendlyName (key) {
  const clean = key.replace(/^Rates?\./i, '').replace(/\.+$/, '').trim()
  if (!clean) return key
  if (LABELS[clean.toLowerCase()]) return LABELS[clean.toLowerCase()].de
  const parts = keyParts(key).filter((p, i, a) => p !== a[i - 1])
  if (!parts.length) return clean
  return parts
    .map(p => (TEILE[p] ? TEILE[p].de : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' — ')
}

function parseNumber (v) {
  const n = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

async function get () {
  let cfg
  try {
    cfg = configEditor.readConfig('world')
  } catch (e) {
    return { entries: [], path: null, found: false, error: e.message, groups: [] }
  }

  const entries = []
  for (const l of cfg.lines) {
    if (l.type !== 'setting') continue
    if (!RATE_KEY_RE.test(l.key)) continue
    entries.push({
      key: l.key,
      label: friendlyName(l.key),
      // Die Teile, aus denen das Frontend den Namen in der gewaehlten
      // Sprache zusammensetzt. Faellt weg, wenn keine Uebersetzung passt.
      parts: keyParts(l.key),
      // Was der Schalter tut - je Sprache. Fehlt der Eintrag, zeigt die
      // Oberflaeche nichts an; besser eine leere Zeile als ein erfundener
      // Text.
      help: HILFE[l.key] || null,
      group: groupOf(l.key),
      value: l.value,
      number: parseNumber(l.value)
    })
  }

  // Gruppe mit ihrer Reihenfolge mitliefern. Die Oberflaeche muss die
  // Ordnung nicht selbst kennen - sonst gibt es zwei Stellen, an denen
  // sie sich aendern liesse.
  const groups = GROUPS.map(g => ({
    id: g.id,
    count: entries.filter(e => e.group === g.id).length
  })).filter(g => g.count > 0)

  /*
   * Welche Werte weichen vom Standard ab?
   *
   * Der Standard einer Rate ist 1.0 - so dokumentiert der Core es, und
   * so steht es in fast jeder worldserver.conf. Bei 96 Werten in sechs
   * Gruppen ist die Frage "was habe ich verstellt?" die haeufigste
   * überhaupt - und sie laesst sich nur beantworten, wenn man alles
   * durchscrollt.
   *
   * Die Liste wird deshalb im Backend berechnet. Das Frontend braucht
   * dieselbe Angabe an zwei Stellen: auf der Raten-Seite (als Filter) und
   * auf der Uebersicht (als Kachel). Zweimal berechnet muesste es nicht
   * werden - und zwei Berechnungen koennten auseinanderlaufen.
   */
  const abweichend = entries.filter(e => {
    const n = parseNumber(e.value)
    return n === null ? false : Math.abs(n - 1) > 0.000001
  })

  return {
    path: cfg.path,
    entries,
    groups,
    found: entries.length > 0,
    // Zusammenfassung: wie viele Werte sind ueberhaupt gesetzt, und wie
    // viele davon weichen vom Standard ab.
    veraenderung: {
      gesamt: entries.length,
      abweichend: abweichend.length,
      standard: entries.length - abweichend.length,
      schluessel: abweichend.map(e => e.key)
    },
    error: null
  }
}

// Werte sind dezimale Vielfache, z. B. 0.5 oder 2.0
function isValidRate (v) {
  const n = parseNumber(v)
  return n !== null && n >= 0 && n <= 100
}

async function save ({ entries }) {
  const clean = (entries || []).filter(
    e => e && e.key && RATE_KEY_RE.test(e.key.trim())
  )
  if (!clean.length) throw new Error('Keine gültigen Raten-Einstellungen übergeben.')

  for (const e of clean) {
    if (!isValidRate(e.value)) {
      throw new Error(
        `Ungültiger Wert für ${e.key}: "${e.value}". Erlaubt ist eine Zahl von 0 bis 100 (z. B. 0.5, 1.0, 2.5).`
      )
    }
  }

  const out = clean.map(e => ({ key: e.key.trim(), value: formatRate(e.value) }))
  return configEditor.writeSettings({ file: 'world', entries: out })
}

// 1 -> "1.0", 0.5 -> "0.5", 2 -> "2.0"
function formatRate (v) {
  const n = parseNumber(v)
  if (n === null) return String(v)
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

// Rate-Schluessel in die worldserver.conf eintragen, falls keine vorhanden sind
async function createDefaults () {
  const path = configEditor.resolveTarget('world')
  if (!path) throw new Error('worldserver.conf nicht gefunden.')

  const existing = (await get()).entries.map(e => e.key.toLowerCase().replace(/\.+$/, ''))
  const missing = DEFAULTS.filter(([k]) => {
    const norm = k.toLowerCase().replace(/\.+$/, '')
    return !existing.includes(norm)
  })

  if (!missing.length) return { ok: true, added: 0 }

  const entries = missing.map(([k, v]) => ({ key: k, value: v }))
  const res = configEditor.writeSettings({ file: 'world', entries })
  return { ok: true, added: missing.length, path: res.path, keys: missing.map(m => m[0]) }
}

/*
 * Alle Raten (oder eine Auswahl) auf den Core-Standard zurücksetzen.
 * Die Standardwerte stehen in DEFAULTS - dieselbe Liste, aus der
 * createDefaults() fehlende Schlüssel anlegt.
 */
async function resetStandards ({ entries } = {}) {
  const standard = new Map(DEFAULTS.map(([k, v]) => [String(k).toLowerCase(), String(v)]))
  const aktuell = (await get()).entries
  const auswahl = Array.isArray(entries) && entries.length ? new Set(entries) : null
  const ziel = auswahl ? aktuell.filter(e => auswahl.has(e.key)) : aktuell
  const neu = ziel.map(e => {
    const schluessel = String(e.key).toLowerCase()
    return {
      key: e.key,
      value: standard.has(schluessel) ? standard.get(schluessel) : '1'
    }
  })
  if (!neu.length) return { ok: true, changed: 0 }
  const res = configEditor.writeSettings({ file: 'world', entries: neu })
  return { ok: true, changed: neu.length, path: res.path }
}

module.exports = {
  get,
  save,
  createDefaults,
  resetStandards,
  isValidRate,
  formatRate,
  friendlyName,
  groupOf,
  keyParts,
  hilfeZu,
  DEFAULTS,
  GROUPS,
  HILFE
}