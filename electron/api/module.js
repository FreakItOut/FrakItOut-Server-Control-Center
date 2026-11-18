'use strict'

/*
 * Moduleinstellungen.
 *
 * AzerothCore laedt die Konfiguration der Module aus einem eigenen
 * Ordner: <configs>/modules/*.conf. Auf einer vollstaendigen Repack
 * liegen dort ueber 70 Dateien mit ueber 5000 Schaltern - Playerbots
 * allein hat rund 900.
 *
 * Das Panel konnte davon bisher nichts sehen: der Konfigurations-Editor
 * kannte nur worldserver.conf und authserver.conf. Die Module waren also
 * vorhanden, aber nur ueber den Texteditor erreichbar.
 *
 * Beschreibungen
 * --------------
 * Die Module erklaeren sich selbst, nur auf zwei Arten:
 *
 *  1. mit einem "Description:"-Block, wie der Kern es in der
 *     worldserver.conf tut (transmog.conf ist vollstaendig so gebaut)
 *  2. mit einem schlichten Kommentar ueber dem Schluessel
 *
 * Beides wird hier gelesen - bevorzugt die Description, weil sie
 * ausfuehrlicher ist. Was uebrig bleibt (etwa zwei Drittel der
 * Schalter) zeigt nur den Schluesselnamen. Lieber keine Erklaerung
 * erfinden als eine falsche.
 */

const fs = require('fs')
const path = require('path')
const store = require('../store')
const sicherung = require('./sicherung')
const sicherungModul = require('./sicherung')
const backupApi = require('./backup')

// Fortschritt an das Fenster (Klonen, SQL-Import). Ohne init() still.
let win = null
function init (windowRef) {
  win = windowRef
}
function melden (nutzlast) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send('modules:progress', nutzlast)
  }
}

// --------------------------------------------------------------------------
// Wo liegen die Modul-Configs?
// --------------------------------------------------------------------------

/*
 * Mehrere Orte sind ueblich, je nach Aufbau der Repack. Gesucht wird in
 * allen; gefunden wird der, in dem die meisten Dateien liegen - nicht
 * der erste, der irgendetwas findet. Sonst gewinnt ein verirrtes
 * einzelnes Verzeichnis.
 */
function moduleOrdner () {
  const s = store.read().server
  const worldDir = s.worldConfDir || path.dirname(s.worldExe || '')
  const basis = new Set()
  for (const d of [worldDir, path.dirname(worldDir), path.join(path.dirname(worldDir), 'configs')]) {
    if (d) basis.add(d)
  }

  let best = null
  let besteAnzahl = 0
  for (const b of basis) {
    for (const kandidat of [path.join(b, 'modules'), b]) {
      if (!fs.existsSync(kandidat) || !fs.statSync(kandidat).isDirectory()) continue
      const anzahl = leseDateien(kandidat).length
      if (anzahl > besteAnzahl) {
        besteAnzahl = anzahl
        best = kandidat
      }
    }
  }
  return best
}

function leseDateien (ordner) {
  try {
    return fs.readdirSync(ordner).filter(f => /\.conf$/i.test(f) && !/\.bak$/i.test(f))
  } catch (_) {
    return []
  }
}

// --------------------------------------------------------------------------
// Beschreibungen aus der Datei selbst lesen
// --------------------------------------------------------------------------

/*
 * Eigene deutsche Texte fuer die Schluessel, bei denen sich das lohnt.
 *
 * Warum nur ein Teil: die Modul-Configs enthalten rund 1600 Erklaerungen,
 * fast alle englisch und je eine fuer einen anderen Schluessel. Die
 * kann man nicht uebersetzen, ohne sie zu erfinden - und eine erfundene
 * Erklaerung ist schlimmer als ein englisches Original, weil sie
 * scheinbar sicher klingt.
 *
 * Diese 45 sind anders: fuer sie gibt es eine zweite, unabhaengige
 * Quelle. Yulon fuehrt sie in seinen Manifesten mit Label und Text, und
 * das deckt sich mit dem, was in der Modul-Datei steht. Zwei Quellen,
 * die dasselbe sagen - das ist eine Uebersetzung, keine Vermutung.
 * Gesammelt von scripts/holt-modulttexte.js.
 *
 * Alles andere zeigt weiter den Originaltext des Modulautors. Wer das
 * uebersetzen will, tut das an der Quelle - im Modul selbst - nicht hier
 * im Panel, wo es beim naechsten Update verloren ginge.
 */
const EIGENE_TEXTE = {
  'ALE.Enabled': { de: 'Lua-Engine einschalten.', en: 'Enable or disable the ALE LuaEngine.' },
  'ALE.ScriptPath': { de: 'Ordner mit den Skripten, aus denen geladen wird. Pfad darf relativ oder absolut sein.', en: 'Sets the location of the script folder to load scripts from. The path can be relative or absolute.' },
  'AOELoot.Enable': { de: 'Flächenloot einschalten.', en: 'Enables the module.' },
  'AOELoot.Group': { de: 'Flächenloot auch in einer Gruppe.', en: 'Enables area loot if the player is in a group.' },
  'AOELoot.Message': { de: 'Meldung beim Flächenloot.', en: 'The area-loot message.' },
  'AOELoot.Range': { de: 'Reichweite, in der nach Beute gesucht wird. Standard 55,0, Bereich 5,0 bis 100,0.', en: 'Maximum reach range search loot. Default: 55.0. Range: 5.0 - 100.0.' },
  'Arena1v1.Announcer': { de: 'Warteschlange im Chat ansagen. Arena.QueueAnnouncer.Enable muss eingeschaltet sein.', en: 'Announce 1v1 arena queue status to chat. Arena.QueueAnnouncer.Enable must be enabled.' },
  'Arena1v1.Costs': { de: 'Kosten für das Anlegen eines Teams. Standard 400.000 Kupfer.', en: 'Costs for create an arena team. Default: 400000 - (40 gold).' },
  'Arena1v1.Enable': { de: 'Die 1v1-Arena einschalten.', en: 'Enable the 1v1 arena.' },
  'Arena1v1.MinLevel': { de: 'Mindeststufe für ein Team. Standard 80.', en: 'Min level to create an arena team. Default: 80.' },
  'Arena1v1.PreventHealingTalents': { de: 'Verhindert, dass jemand Heiltalente nimmt.', en: 'If enabled, it prevents people from having healing talents.' },
  'AuctionHouseBot.AdvancedListingRules.UseDropRates.Enabled': { de: 'Beim Einstellen die Drop-Chancen aus dem Spiel verwenden. Seltene Gegenstände erscheinen dadurch seltener am Auktionhaus.', en: 'Use the in-game drop rates of enemies and gameobjects to decide whether an item is listed. Makes rare items appear less often.' },
  'AuctionHouseBot.Buyer.Enabled': { de: 'Der Kauf-Bot: Gegenstände kaufen.', en: 'Enable or disable the buying bot.' },
  'AuctionHouseBot.EnableSeller': { de: 'Der Verkaufs-Bot: Gegenstände einstellen.', en: 'Enable or disable the part of the bot that puts items up for auction.' },
  'AuctionHouseBot.GUIDs': { de: 'GUIDs der Charaktere, die als Bot auftreten. Eine Zahl oder mehrere, durch Komma getrennt, ohne Leerzeichen. Eine GUID von 0 wird ignoriert. Kein Bot-Charakter verwenden, das lässt den Server üblicherweise abstürzen.', en: 'The character GUIDs used to create auctions and interact with them. One value or several separated by commas, no spaces. A GUID of 0 is ignored. Do not use a bot character, that will likely crash the server.' },
  'AuctionHouseBot.ItemsPerCycle': { de: 'Wie viele Gegenstände je Durchlauf eingestellt werden. Jeder Durchlauf wird von einem zufällig gewählten Bot übernommen.', en: 'How many items to post on the auction house every house update.' },
  'AuctionHouseBot.MinutesBetweenSellCycle': { de: 'Wartezeit zwischen zwei Verkaufsdurchläufen. Eine Zahl wartet genau so viele Minuten, „3:15" wartet zufällig zwischen 3 und 15 Minuten.', en: 'How many minutes to wait before selling items again. A single number waits X minutes, a pair like 3:15 waits a random time between X and Y.' },
  'BeastMaster.AllowedClasses': { de: 'Klassen-IDs, die Haustiere adoptieren dürfen, durch Komma getrennt. 0 = alle Klassen. Zählt nur, wenn „Nur Jäger" aus ist.', en: 'Comma-separated class ids allowed to adopt pets (0 = all classes). Only used when Hunters-only is off.' },
  'BeastMaster.Enable': { de: 'Der Beastmaster-NPC: Klassen können Hunter-Haustiere zähmen, in der Stallung halten und benutzen.', en: 'Master switch for the Beastmaster NPC that lets classes tame, stable and use hunter pets.' },
  'BeastMaster.HunterOnly': { de: 'Aus: dann darf jede Klasse Haustiere zähmen.', en: 'When on, only Hunters may use the Beastmaster.' },
  'BeastMaster.MinLevel': { de: 'Stufe, die ein Charakter erreicht haben muss, bevor er ein Haustier adoptiert. 0 = keine Bedingung.', en: 'Level a character must reach before adopting a pet (0 = no requirement).' },
  'BotLevelBrackets.CheckFlaggedFrequency': { de: 'Wie oft (in Sekunden) markierte Bots erneut geprüft werden.', en: 'The frequency in seconds at which flagged bots are re-checked.' },
  'BotLevelBrackets.CheckFrequency': { de: 'Wie oft (in Sekunden) die Stufenverteilung der Bots geprüft wird.', en: 'The frequency in seconds at which the bot level distribution check runs.' },
  'BotLevelBrackets.Enabled': { de: 'Stufenbereiche einschalten.', en: 'Enables the module.' },
  'BotLevelBrackets.IgnoreArenaTeamBots': { de: 'Bots in Arenateams in Ruhe lassen — sonst zerfällt die Teamzusammensetzung.', en: 'Bots in arena teams are excluded from bracket calculations, so team compositions stay intact.' },
  'BotLevelBrackets.IgnoreGuildBotsWithRealPlayers': { de: 'Bots in Gilden mit mindestens einem echten Spieler in Ruhe lassen.', en: 'Bots in a guild with at least one real player are excluded from bracket calculations.' },
  'DungeonMaster.Rewards.BaseGold': { de: 'Grundbelohnung an Gold, in Kupfer. Standard 50.000.', en: 'Base gold reward, in copper. Default: 50000 (5g).' },
  'DungeonMaster.Roguelike.Enable': { de: 'Den Roguelike-Modus einschalten.', en: 'Master switch for Roguelike Mode.' },
  'DungeonMaster.Scaling.LevelBand': { de: 'Stufenfenster für die Auswahl der Kreaturen. Standard 3.', en: 'Creature selection window. Default: 3.' },
  'IndividualProgression.Enable': { de: 'Individual Progression einschalten. Achtung: Datenbankänderungen eines AzerothCore-Moduls lassen sich über Einstellungen nicht rückgängig machen — abgeschaltet bleiben zum Beispiel wiederhergestellte Vanilla-Quests und NPC-Werte bestehen.', en: 'Enable the module. Note that like all AzerothCore modules, database changes cannot be undone through config settings.' },
  'IndividualProgression.EnforceGroupRules': { de: 'Nur mit Spielern derselben Fortschrittsphase eine Gruppe bilden.', en: 'Only allow players to group with others in the same progression phase.' },
  'IndividualProgression.QuestXPFix': { de: 'Ursprüngliche Quest-Erfahrung wiederherstellen. In Patch 2.3.0 und 3.0.2 wurde die Vanilla- und TBC-Quest-Erfahrung als Aufhol-Mechanismus erhöht.', en: 'Quest XP for Vanilla and TBC quests was boosted as a catchup mechanism; this brings affected quests closer to their original values.' },
  'IndividualProgression.VanillaHealingAdjustment': { de: 'Anpassung der Heilkraft vor dem Abschluss von Vanilla-Inhalten und dem Öffnen des Dunklen Portals. Linear je Stufe zwischen 11 und 60. Vorschlag: 0,5.', en: 'Adjustment to player healing power before completing Vanilla content. Applied linearly per level between 11 and 60. Suggested: 0.5.' },
  'IndividualProgression.VanillaPowerAdjustment': { de: 'Anpassung der Angriffskraft vor dem Abschluss von Vanilla-Inhalten und dem Öffnen des Dunklen Portals. Linear je Stufe zwischen 11 und 60. Vorschlag: 0,5 bis 0,6.', en: 'Adjustment to player attack power before completing Vanilla content. Applied linearly per level between 11 and 60. Suggested: between 0.5 and 0.6.' },
  'LearnSpells.Announce': { de: 'Beim Anmelden kurz darauf hinweisen, dass Zauber automatisch gelernt werden.', en: 'Show a short message at login telling the player auto-learn is active.' },
  'LearnSpells.Enable': { de: 'Hauptschalter: Zeichen lernen ihre Klassenzauber beim Stufenaufstieg von selbst, ohne Lehrmeister.', en: 'Master switch: characters learn their class spells automatically on level-up, no trainer visits.' },
  'LearnSpells.MaxLevel': { de: 'Ab dieser Stufe keine Zauber mehr automatisch lernen.', en: 'Stop auto-learning spells past this level.' },
  'LearnSpells.OnFirstLogin': { de: 'Einem neuen Zeichen sofort alle Zauber bis zu seiner Stufe geben. Praktisch für Sofort-Stufen-Server.', en: 'Give a brand-new character every spell up to its level at once. Handy for instant-level servers.' },
  'QuestParty.Enable': { de: 'Quest-Loot-Partie einschalten.', en: 'Enable or disable the Quest Loot Party module.' },
  'QuestParty.Message': { de: 'Die Meldung im Chat ein- oder ausschalten.', en: 'Enable or disable the Quest Loot Party message.' },
  'Transmogrification.Enable': { de: 'Transmog einschalten. Ausgeschaltet sieht niemand ein verwandeltes Stück — die Datenbank bleibt aber erhalten.', en: 'Enables or disables transmog. Players will not see any transmogrified item while disabled, but the database stays intact.' },
  'Transmogrification.AllowHiddenTransmog': { de: 'Erlaubt „unsichtbare" Verwandelungen: Gegenstände können ohne sichtbares Aussehen gewählt werden.', en: 'Enables hiding equipment through transmog. Players can pick an "invisible" appearance for items.' },
  'Transmogrification.ShowSetDisclaimer': { de: 'Spieler bekommen einen Chathinweis, wenn sie ein Stück aus einem Set verwandeln: die Setboni bleiben aktiv, auch wenn dietooltip sie nicht zeigt. Abschaltbar mit .transmog disclaimer off.', en: 'Players receive a chat notice when transmogrifying a set item, explaining that set bonuses stay active even though the tooltip does not show them.' },
  'Transmogrification.UseCollectionSystem': { de: 'Sammlung wie in Legion: Jedes Aussehen ausgerüsteter oder per Quest belegter Gegenstände ist nutzbar. Ausgeschaltet braucht man das Original im Beutel.', en: 'Legion-style appearance collection. Any equipped or quested appearance can be used. When disabled the item must be in the bags.' },
  'Transmogrification.UseVendorInterface': { de: 'Eine Händler-Oberfläche für die Auswahl nutzen — mit Vorschau beim Strg-Klick. Ausgeschaltet bleibt das Auswahlmenü ohne Vorschau.', en: 'Use a fake vendor interface for item selection, with ctrl-click previews. When disabled the gossip menu is used without previews.' }
}

/*
 * Ist der Text brauchbar, oder ist es Beiwerk?
 *
 * In den Modul-Configs stehen ueber manchen Schluesseln keine
 * Erklaerungen, sondern Angaben zu Werten:
 *
 *     #        Default:     0  - (Disabled)
 *     #                     1  - (Enabled)
 *
 * Der Parser nahm die erste Zeile als Beschreibung. In der Anzeige stand
 * dann "0 - (Disabled)" - das ist keine Erklaerung, sondern Beiwerk, und
 * schadet mehr als es nuetzt.
 */
const RE_WERTZEILE = /\d+(?:\.\d+)?\s*-\s*\([^)]*\)/g

function brauchbar (text) {
  if (!text) return false
  /*
   * Abschnittsmarken wie "## 10-player heroic raids" stehen in manchen
   * Modulen vor mehreren Schluesseln. Sie bezeichnen einen Abschnitt,
   * nicht den einzelnen Schalter - als Beschreibung waeren sie
   * irrefuehrend ("Hier stehen 33 Beschreibungen, die alle '## Default
   * for all raids' sagen").
   */
  if (/^\s*##/.test(text)) return false
  // Reine Angaben zu Werten: "0 - (Disabled)", "1 - (Enabled)"
  const ohneWerte = text.replace(RE_WERTZEILE, '').trim()
  return ohneWerte.length >= 4
}

const RE_BESCH = /^#\s+Description:\s*(.+)$/
const RE_DEFAULT = /^#\s+Default:/
const RE_SETZ = /^([A-Z][A-Za-z0-9_.]*)\s*=/

/*
 * Die Ueberschrift ueber einem Schluessel - mit oder ohne Einrueckung:
 *
 *     #    Rate.XP.Kill          (worldserver.conf, vier Leerzeichen)
 *     # IndividualProgression.Enable   (Modul-Configs, ein Leerzeichen)
 *
 * Die erste Fassung verlangte zwei Leerzeichen und fand deshalb in den
 * Modul-Configs gar keine Beschreibungen.
 */
const RE_KOPF = /^#\s{0,6}([A-Z][A-Za-z0-9_.]*\.{0,3})$/
const RE_TRENN = /^[-*=._#]{3,}$/

/*
 * Abschnitts-Ueberschrift ueber einem Schluessel. In playerbots.conf
 * stehen ueber den Werten Ueberschriften wie
 *
 *     #        QUESTS
 *     #        COMBAT
 *
 * Die werden nicht zur Beschreibung, sondern zur Gruppe. Sonst hiesse
 * jede Zeile im Abschnitt "QUESTS".
 */
function gruppeAus (zeilen, index) {
  for (let j = index - 1; j >= 0 && index - j < 40; j--) {
    const z = zeilen[j].trim()
    if (z === '' || z === '#') continue
    if (!z.startsWith('#')) break
    const rein = z.replace(/^#\s*/, '').trim()
    if (!rein || RE_TRENN.test(rein)) continue
    // Nur grossgeschriebene Worte sind Ueberschriften
    if (rein === rein.toUpperCase() && rein.length > 2 && /[A-Z]/.test(rein)) return rein
    break
  }
  return null
}

/*
 * Alle Schluessel einer .conf mit Wert und Beschreibung lesen.
 *
 * Liefert auch die Zeilennummer - die gebraucht wird, um zu sehen, was
 * das Panel geaendert hat, und um zurueckzusetzen.
 */
function parseConf (text) {
  const roh = text.split(/\r?\n/)
  const zeilen = roh.map(l => l.trim())

  // ---- 1. Description-Bloecke einsammeln ----
  const ausBeschreibung = new Map()
  for (let i = 0; i < zeilen.length; i++) {
    const b = RE_BESCH.exec(zeilen[i])
    if (!b) continue
    let text2 = b[1].trim()
    let j = i + 1
    while (j < zeilen.length && zeilen[j].startsWith('#') &&
           !RE_DEFAULT.test(zeilen[j]) && !RE_BESCH.test(zeilen[j])) {
      if (zeilen[j].trim()) {
        const ohne = zeilen[j].replace(/^#\s+/, '').trim()
        if (ohne) text2 += ' ' + ohne
      }
      j++
    }
    text2 = text2.replace(/\s+/g, ' ').trim()
    // Die nackte Kommentarzeile am Ende des Blocks landet sonst im Text
    // und der Beschreibung erscheint ein einsames "#" hinten dran.
    text2 = text2.replace(/(?:\s*#)+$/, '').trim()

    const gefunden = []
    for (let k = j; k < zeilen.length && k < j + 40; k++) {
      const z = zeilen[k]
      if (RE_BESCH.test(z)) break
      if (z === '') continue
      if (!z.startsWith('#')) break
      for (const m of z.matchAll(/\(([A-Za-z][A-Za-z0-9_.]*)\)/g)) gefunden.push(m[1])
      for (const m of z.matchAll(/([A-Z][A-Za-z0-9_.]*)\s*=\s*[\d.]+/g)) gefunden.push(m[1])
    }

    if (gefunden.length) {
      for (const k of gefunden) if (!ausBeschreibung.has(k)) ausBeschreibung.set(k, text2)
    } else {
      const koepfe = []
      for (let k = i - 1; k >= 0 && i - k < 12; k--) {
        const z = zeilen[k].trim()
        // Leer und nacktes "#" sind Abstandhalter, kein Inhalt
        if (z === '' || z === '#') continue
        const kh = RE_KOPF.exec(z)
        if (kh) { koepfe.unshift(kh[1]); continue }
        break
      }
      for (const kopf of koepfe) {
        if (kopf.endsWith('...')) {
          const p = kopf.slice(0, -3)
          for (const z of roh) {
            const m = RE_SETZ.exec(z.trim())
            if (m && (m[1] === p || m[1].startsWith(p))) {
              if (!ausBeschreibung.has(m[1])) ausBeschreibung.set(m[1], text2)
            }
          }
        } else if (!ausBeschreibung.has(kopf)) {
          ausBeschreibung.set(kopf, text2)
        }
      }
    }
  }

  // ---- 2. Schluessel und Werte ----
  const eintraege = []
  for (let i = 0; i < roh.length; i++) {
    const m = RE_SETZ.exec(roh[i].trim())
    if (!m) continue
    const key = m[1]

    // ---- 3. schlichter Kommentar direkt darueber ----
    let kommentar = null
    const teile = []
    let schritte = 0
    for (let j = i - 1; j >= 0 && schritte < 4; j--) {
      const z = zeilen[j]
      if (z === '') continue
      if (!z.startsWith('#')) break
      const rein = z.replace(/^#\s*/, '').trim()
      if (!rein || RE_TRENN.test(rein) || RE_BESCH.test(z) || RE_DEFAULT.test(z)) continue
      // Der Kopf, also "IndividualProgression.Enable", ist der Name
      // selbst und keine Erklaerung.
      if (rein === key) break
      /*
       * Beispiele fuer die Konsole sind keine Erklaerung. Bei
       * mod_weather_vibe.conf steht ueber WeatherVibe.Enable:
       *
       *     # .wvibe set <zoned> <type0|1|2|3|86> <percentage0.100>
       *     # .wvibe show (lists last-applied entries)
       *     # toggle module
       *
       * Ohne die Filterung steht im Panel eine halbe Seite Beispiel und
       * die eigentliche Aussage ganz hinten.
       */
      if (/^\.[a-zA-Z]/.test(rein) || /<[a-zA-Z]/.test(rein)) continue
      teile.unshift(rein)
      schritte++
    }
    if (teile.length) kommentar = teile.join(' ')

    // ---- 4. der Wert: alles rechts vom ersten Gleichheitszeichen ----
    const wert = roh[i].trim().slice(m[0].length).replace(/^\s*=\s*/, '').replace(/\s+#.*$/, '').trim()

    /*
     * Vorrang: eigene deutsche Texte, dann die Description aus der
     * Datei, dann der Kommentar. Und nur, was auch eine Erklaerung
     * ist - siehe brauchbar().
     */
    const eigener = EIGENE_TEXTE[key]
    const ausDatei = brauchbar(ausBeschreibung.get(key)) ? ausBeschreibung.get(key) : null
    const ausKommentar = brauchbar(kommentar) ? kommentar : null

    /*
     * Bei eigenen Texten kommen beide Sprachen mit; die Oberflaeche waehlt.
     * Sonst gibt es nur den Originaltext des Modulautors - der ist
     * englisch, und eine erfundene deutsche Fassung waere schlimmer.
     */
    const eintrag = {
      key,
      value: wert,
      help: eigener ? eigener.de : (ausDatei || ausKommentar) || null,
      hilfe: eigener ? { de: eigener.de, en: eigener.en } : null,
      quelle: eigener ? 'uebersetzt' : (ausDatei ? 'description' : (ausKommentar ? 'kommentar' : null)),
      gruppe: gruppeAus(zeilen, i),
      zeile: i + 1
    }
    eintraege.push(eintrag)
  }
  return eintraege
}

// --------------------------------------------------------------------------
// Was das Panel anbietet
// --------------------------------------------------------------------------

/*
 * Alle Module mit ihren Einstellungen. Der Ordner mit den meisten Dateien
 * gewinnt - siehe moduleOrdner().
 */
/*
 * Version eines Moduls: die Module liegen als Git-Submodule unter
 * source/modules. Kurz-Hash und Datum des letzten Commits - ohne git
 * bleibt es leer, das darf die Seite nicht stören.
 */
function modulVersion (id) {
  try {
    const root = ((store.read().server || {}).rootDir) || ''
    const dir = path.join(root, 'source', 'modules', id)
    if (!fs.existsSync(dir)) return { version: '', versionZeit: null }
    const { execFileSync } = require('child_process')
    const version = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim()
    let versionZeit = null
    try {
      versionZeit = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%cI'], { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        .toString().trim() || null
    } catch (_) {}
    return { version, versionZeit }
  } catch (_) {
    return { version: '', versionZeit: null }
  }
}

function list () {
  const ordner = moduleOrdner()
  if (!ordner) return { ordner: null, module: [], hinweis: 'Kein Modul-Ordner gefunden.' }

  const module = []
  for (const datei of leseDateien(ordner).sort()) {
    const voll = path.join(ordner, datei)
    let stat = null
    try { stat = fs.statSync(voll) } catch (_) {}
    const modulId = datei.replace(/\.conf$/i, '')
    module.push({
      id: modulId,
      datei,
      pfad: voll,
      groesse: stat ? stat.size : 0,
      geaendert: stat ? stat.mtime.toISOString() : null,
      // Git-Stand des Moduls (leer, wenn keins gefunden)
      ...modulVersion(modulId),
      // Die Zahl wird erst beim Lesen genau bekannt - fuer die Liste
      // genuegt ein Hinweis darauf, dass es welche gibt.
      schluessel: null,
      hatSicherung: fs.existsSync(voll + '.bak'),
      // Ist das Modul eingeschaltet? Das wird aus der Datei gelesen, weil
      // es im Namen keine einheitliche Regel gibt: "AutoRevive.Enable",
      // "DesertionWarnings.Enabled", "ALE.Enabled", "Module.Enable" - alles
      // kommt vor.
      ...modulStatus(voll)
    })
  }

  return {
    ordner,
    module,
    hinweis: null
  }
}

/*
 * Liest den Enable-Status eines Moduls.
 *
 * Die Namen der Schalter unterscheiden sich von Modul zu Modul. Gesucht
 * wird deshalb nach jedem Schalter, dessen Name auf ".Enable" oder
 * ".Enabled" endet - und gewertet wird:
 *
 *   - "aktiv"    mindestens ein Schalter steht auf 1 oder true
 *   - "aus"      es gibt Schalter, aber alle stehen auf 0 oder false
 *   - "unklar"   es gibt keinen solchen Schalter
 *
 * Manche Module haben mehrere: ChallengeModes.Enable = 0, aber
 * Hardcore.Enable = 1. Fuer den Admin zaehlt, dass etwas laeuft - also
 * gilt "aktiv", sobald mindestens einer eingeschaltet ist. Die Anzahl der
 * eingeschalteten Schalter wird mitgegeben, damit man die Genauigkeit
 * sieht.
 */
function modulStatus (voll) {
  const leer = { status: 'unklar', enableGesamt: 0, enableAn: 0, enableSchluessel: [] }
  let text = ''
  try { text = fs.readFileSync(voll, 'utf8') } catch (_) { return leer }

  const schluessel = []
  for (const z of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w.]*\.Enabled?)\s*=\s*(.*?)\s*$/.exec(z)
    if (!m) continue
    schluessel.push({ key: m[1], wert: m[2] })
  }
  if (!schluessel.length) return leer

  let an = 0
  for (const s of schluessel) {
    const w = String(s.wert).trim().toLowerCase().replace(/^["']|["']$/g, '')
    if (w === '1' || w === 'true' || w === 'yes' || w === 'on') an++
  }
  return {
    status: an > 0 ? 'aktiv' : 'aus',
    enableGesamt: schluessel.length,
    enableAn: an,
    enableSchluessel: schluessel.map(s => s.key)
  }
}

/*
 * Die Einstellungen eines Moduls. `pfad` muss aus dieser Liste stammen -
 * ein Pfad von aussen wuerde beliebige Dateien oeffnen.
 */
function read ({ pfad, suche = '' } = {}) {
  const ordner = moduleOrdner()
  if (!ordner) throw new Error('Kein Modul-Ordner gefunden. Pfad in den Einstellungen prüfen.')

  const ziel = erlaubt(pfad, ordner)
  const text = fs.readFileSync(ziel, 'utf8')
  const alle = parseConf(text)

  const t = String(suche || '').trim().toLowerCase()
  const eintraege = t
    ? alle.filter(e =>
      e.key.toLowerCase().includes(t) ||
      String(e.value).toLowerCase().includes(t) ||
      String(e.help || '').toLowerCase().includes(t) ||
      String(e.gruppe || '').toLowerCase().includes(t))
    : alle

  const mitBeschreibung = alle.filter(e => e.help).length
  const uebersetzt = alle.filter(e => e.quelle === 'uebersetzt').length
  const sicherung = ziel + '.bak'

  return {
    pfad: ziel,
    ordner,
    datei: path.basename(ziel),
    gesamt: alle.length,
    mitBeschreibung,
    uebersetzt,
    eintraege,
    sicherung: fs.existsSync(sicherung) ? {
      pfad: sicherung,
      geaendert: fs.statSync(sicherung).mtime.toISOString()
    } : null,
    // Die Gruppen in der Reihenfolge, in der sie in der Datei stehen
    gruppen: [...new Set(alle.map(e => e.gruppe).filter(Boolean))]
  }
}

/*
 * Werte setzen. Die Sicherung entsteht dabei von selbst - dieselbe
 * Logik wie beim Konfigurations-Editor, damit es nicht zwei geben muss.
 */
function save ({ pfad, eintraege } = {}) {
  const ordner = moduleOrdner()
  if (!ordner) throw new Error('Kein Modul-Ordner gefunden.')
  const ziel = erlaubt(pfad, ordner)

  const sauber = (eintraege || []).filter(e => e && e.key && /^([A-Z][A-Za-z0-9_.]*)$/.test(e.key.trim()))
  if (!sauber.length) throw new Error('Keine gültigen Einstellungen übergeben.')

  const zeilen = fs.readFileSync(ziel, 'utf8').split(/\r?\n/)

  const gewollt = new Map()
  for (const e of sauber) gewollt.set(e.key.trim(), String(e.value ?? '').trim())

  // Nur Schluessel anfassen, die es wirklich gibt. Sonst koennte ein
  // Tippfehler einen neuen Schluessel in die Datei schreiben, den der
  // Core nicht kennt.
  const vorhanden = new Set()
  for (const z of zeilen) {
    const m = RE_SETZ.exec(z.trim())
    if (m) vorhanden.add(m[1])
  }
  const unbekannt = [...gewollt.keys()].filter(k => !vorhanden.has(k))
  if (unbekannt.length) {
    throw new Error(
      `Diese Schluessel gibt es in ${path.basename(ziel)} nicht: ` + unbekannt.slice(0, 5).join(', ') +
      (unbekannt.length > 5 ? ` und ${unbekannt.length - 5} weitere.` : '.')
    )
  }

  const raus = zeilen.map(z => {
    const m = RE_SETZ.exec(z.trim())
    if (!m) return z
    if (!gewollt.has(m[1])) return z
    // Kommentar und Einrueckung bleiben erhalten
    const einrueckung = (/^(\s*)/.exec(z) || [''])[1]
    const kommentar = /\s+#.*$/.exec(z) ? z.slice(z.indexOf('#')) : ''
    return `${einrueckung}${m[1]} = ${gewollt.get(m[1])}${kommentar}`
  })

  const gesichert = sicherungModul.sichern(ziel)

  fs.writeFileSync(ziel, raus.join('\n'), 'utf8')
  // Modul-Konfig geändert -> Neustart ausstehend
  try { require('../store').write({ restartNoetig: true }) } catch (_) {}

  return {
    ok: true,
    pfad: ziel,
    sicherung: gesichert.alt && fs.existsSync(gesichert.alt) ? gesichert.alt : null,
    sicherungen: gesichert.neu ? [gesichert.neu] : [],
    geaendert: sauber.length
  }
}

/*
 * Die Sicherung zurueckspielen. Das ist das, was in Yulon ein "remove"
 * macht: nicht loeschen, sondern den Zustand vor der Aenderung wiederherstellen.
 */
function zuruecksetzen ({ pfad } = {}) {
  const ordner = moduleOrdner()
  if (!ordner) throw new Error('Kein Modul-Ordner gefunden.')
  const ziel = erlaubt(pfad, ordner)
  const sicherung = ziel + '.bak'
  if (!fs.existsSync(sicherung)) {
    throw new Error(`Für ${path.basename(ziel)} gibt es keine Sicherung.`)
  }
  fs.copyFileSync(sicherung, ziel)
  return {
    ok: true,
    pfad: ziel,
    wiederhergestellt: sicherung
  }
}

/*
 * Kein beliebiger Pfad von aussen: die Datei muss im gefundenen
 * Modul-Ordner liegen. Sonst koennte ueber die Schnittstelle jede
 * Datei auf der Platte gelesen und ueberschrieben werden.
 */
function erlaubt (pfad, ordner) {
  if (typeof pfad !== 'string' || !pfad) {
    throw new Error('Kein Modul angegeben.')
  }
  const aufgeloest = path.resolve(pfad)
  const wurzel = path.resolve(ordner)
  if (!aufgeloest.startsWith(wurzel + path.sep)) {
    throw new Error('Dieses Modul liegt nicht im Modul-Ordner.')
  }
  if (!fs.existsSync(aufgeloest)) {
    throw new Error('Die Datei gibt es nicht mehr: ' + path.basename(aufgeloest))
  }
  return aufgeloest
}

/*
 * Die Sicherungen eines Moduls auflisten.
 *
 * Die Modul-Liste zeigt bisher nur ein Zeichen fuer "es gibt eine .bak".
 * Seit dem Panel versionierte Sicherungen gibt es, liegen die aber in
 * einem Ordner daneben - und die Liste wusste nichts davon. Sie
 * beantwortete damit nur die halbe Frage.
 */
function sicherungenListen ({ pfad } = {}) {
  const ordner = moduleOrdner()
  if (!ordner) throw new Error('Kein Modul-Ordner gefunden.')
  const ziel = erlaubt(pfad, ordner)
  return {
    pfad: ziel,
    // Der Dateiname ohne Pfad - im Renderer gibt es kein "path" von Node.
    datei: path.basename(ziel),
    ordner: sicherung.sicherungsOrdner(ziel),
    alt: fs.existsSync(ziel + '.bak') ? ziel + '.bak' : null,
    altName: fs.existsSync(ziel + '.bak') ? path.basename(ziel + '.bak') : null,
    liste: sicherung.listen(ziel)
  }
}

/*
 * Eine aeltere Stufe zurueckspielen. Der jetzige Stand wird vorher
 * gesichert - sonst waere der Zustand, den man gerade wiederherstellt,
 * verloren.
 */
function sicherungZurueckspielen ({ pfad, datei } = {}) {
  const ordner = moduleOrdner()
  if (!ordner) throw new Error('Kein Modul-Ordner gefunden.')
  const ziel = erlaubt(pfad, ordner)
  if (!datei) throw new Error('Keine Sicherungsdatei angegeben.')
  // Die Sicherung muss zum Modul gehoeren - sonst wuerde ein fremder
  // Pfad zurueckgespielt.
  const erlaubtOrdner = path.resolve(sicherung.sicherungsOrdner(ziel))
  const aufgeloest = path.resolve(datei)
  if (!aufgeloest.startsWith(erlaubtOrdner + path.sep)) {
    throw new Error('Diese Sicherung gehoert nicht zu diesem Modul.')
  }
  return sicherung.zurueckspielen(ziel, aufgeloest)
}

// --------------------------------------------------------------------------
// Modul-Installation und -Verwaltung (Runde 32)
// --------------------------------------------------------------------------

const KNOWN_MODULES = [
  { name: 'playerbots', url: 'https://github.com/mod-playerbots/mod-playerbots.git', hinweis: 'Playerbots (Bots)' },
  { name: 'ahbot', url: 'https://github.com/azerothcore/mod-ahbot.git', hinweis: 'Auktionshaus-Bot' },
  { name: 'autobalance', url: 'https://github.com/azerothcore/mod-autobalance.git', hinweis: 'Instanzen skalieren (AutoBalance)' },
  { name: 'eluna', url: 'https://github.com/azerothcore/mod-eluna.git', hinweis: 'Lua-Engine' },
  { name: 'solo-lfg', url: 'https://github.com/azerothcore/mod-solo-lfg.git', hinweis: 'Solo-Gruppensuche' },
  { name: 'transmog', url: 'https://github.com/azerothcore/mod-transmog.git', hinweis: 'Transmogrification' },
  { name: 'individual-progression', url: 'https://github.com/ZhengPeiRu21/mod-individual-progression.git', hinweis: 'Individuelle Progression' },
  { name: 'solocraft', url: 'https://github.com/azerothcore/mod-solocraft.git', hinweis: 'Solo-Craft (allein spielbar)' },
  { name: 'cfbg', url: 'https://github.com/azerothcore/mod-cfbg.git', hinweis: 'Cross-Faction Battlegrounds' },
  { name: 'duel-reset', url: 'https://github.com/azerothcore/mod-duel-reset.git', hinweis: 'Duell-Fähigkeiten zurücksetzen' },
  { name: 'progression-system', url: 'https://github.com/azerothcore/mod-progression-system.git', hinweis: 'Progression-System' }
]

function quellenOrdner () {
  const root = ((store.read().server || {}).rootDir) || ''
  if (!root) throw new Error('Kein Serverordner eingestellt.')
  return path.join(root, 'source', 'modules')
}

function gitAusfuehren (args, opts = {}) {
  return new Promise(resolve => {
    try {
      const { execFile } = require('child_process')
      execFile('git', args, { timeout: opts.timeoutMs || 10 * 60 * 1000, windowsHide: true }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          out: String(stdout || '').trim(),
          err: String(stderr || (err && err.message) || '').trim()
        })
      })
    } catch (e) {
      resolve({ ok: false, out: '', err: e.message })
    }
  })
}

function namePruefen (name) {
  const n = String(name || '').trim()
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(n)) {
    throw new Error('Ungültiger Modulname (2–64 Zeichen: Buchstaben, Zahlen, . _ -).')
  }
  return n
}

/*
 * Git-Quelle vereinfachen: vollständige URL, GitHub-Kurzform "owner/repo",
 * SSH-Adresse, /tree/-Pfade, Query-Anhänge und fehlendes ".git" werden
 * auf eine klare HTTPS-URL gebracht. Der Modulname kommt aus dem Repo.
 */
function normalisiereQuelle (eingabe) {
  let s = String(eingabe || '').trim()
  if (!s) throw new Error('Bitte eine Git-URL oder „owner/repo“ angeben.')
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`
  if (/^(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(s)) s = `https://${s}`
  if (/^git@github\.com:/i.test(s)) s = 'https://github.com/' + s.replace(/^git@github\.com:/i, '')
  s = s.replace(/[?#].*$/, '').replace(/\/tree\/.*$/i, '').replace(/\/blob\/.*$/i, '').replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(s)) throw new Error('Bitte eine Git-URL (https://…) oder „owner/repo“ angeben.')
  if (/^https?:\/\/github\.com\//i.test(s) && !/\.git$/i.test(s)) s += '.git'
  const roh = s.replace(/\.git$/i, '').split('/').filter(Boolean).pop() || ''
  let name = roh.replace(/^mod[-_]/i, '')
  if (name.length < 2) name = roh || 'modul'
  return { url: s, name: namePruefen(name) }
}

async function freierPlatzGb (ordner) {
  for (const ziel of [ordner, path.dirname(ordner || '.'), path.dirname(path.dirname(ordner || '.'))]) {
    try {
      const st = await fs.promises.statfs(ziel)
      return Math.round((Number(st.bavail) * Number(st.bsize)) / 1e9 * 10) / 10
    } catch (_) {}
  }
  return null
}

/*
 * Vorabprüfung: Name frei, Git vorhanden, Repository erreichbar, Platz.
 * Verhindert das übliche "erst klonen, dann feststellen, dass der Name
 * belegt ist".
 */
async function vorpruefen ({ url, name } = {}) {
  const q = normalisiereQuelle(url)
  const modul = namePruefen(name || q.name)
  const ordner = quellenOrdner()
  const ziel = path.join(ordner, modul)
  const belegt = fs.existsSync(ziel)
  const git = await gitAusfuehren(['--version'], { timeoutMs: 10000 })
  let urlOk = false
  let urlFehler = ''
  if (belegt) {
    return {
      ok: false,
      url: q.url,
      name: modul,
      ziel,
      belegt: true,
      gitOk: git.ok,
      urlOk: false,
      freiGb: await freierPlatzGb(ordner),
      fehler: `Modul "${modul}" ist bereits vorhanden (${ziel}).`
    }
  }
  if (git.ok) {
    const ls = await gitAusfuehren(['ls-remote', '--heads', q.url], { timeoutMs: 25000 })
    urlOk = ls.ok
    if (!ls.ok) {
      const zeilen = `${ls.err || ''}\n${ls.out || ''}`.split(/\r?\n/).map(z => z.trim()).filter(Boolean)
      urlFehler = zeilen.slice(-1)[0] || 'unbekannter Fehler'
    }
  }
  const freiGb = await freierPlatzGb(ordner)
  let fehler = ''
  if (!git.ok) fehler = 'Git wurde nicht gefunden. Bitte Git installieren und im PATH haben.'
  else if (belegt) fehler = `Modul "${modul}" ist bereits vorhanden (${ziel}).`
  else if (!urlOk) fehler = `Repository nicht erreichbar: ${urlFehler}`
  return {
    ok: !fehler,
    url: q.url,
    name: modul,
    ziel,
    belegt,
    gitOk: git.ok,
    urlOk,
    freiGb,
    fehler
  }
}

/*
 * Konfiguration nachziehen: sucht .conf.dist auch in tieferen Ebenen und
 * legt fehlende Dateien im Modul-Konfigurationsordner an. Vorhandene
 * Dateien werden nie überschrieben.
 */
function konfigurationNachziehen ({ name } = {}) {
  const modul = namePruefen(name)
  const basis = path.join(quellenOrdner(), modul)
  if (!fs.existsSync(basis)) throw new Error(`Modul "${modul}" ist nicht installiert.`)
  const konfZiel = moduleOrdner()
  if (!konfZiel) throw new Error('Modul-Konfigurationsordner wurde nicht gefunden.')
  const kopiert = []
  const vorhanden = []
  const skip = new Set(['.git', 'data', 'sql', 'tests', 'test', 'docs', 'node_modules'])
  const lauf = (dir, tiefe) => {
    if (tiefe > 8) return
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const voll = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (skip.has(e.name.toLowerCase())) continue
        lauf(voll, tiefe + 1)
      } else if (/\.conf\.dist$/i.test(e.name)) {
        const ziel = path.join(konfZiel, e.name.replace(/\.dist$/i, ''))
        if (fs.existsSync(ziel)) {
          vorhanden.push(path.basename(ziel))
          continue
        }
        try {
          fs.mkdirSync(konfZiel, { recursive: true })
          fs.copyFileSync(voll, ziel)
          kopiert.push(path.basename(ziel))
        } catch (_) {}
      }
    }
  }
  lauf(basis, 0)
  return { ok: true, name: modul, kopiert, vorhanden, ziel: konfZiel }
}

/*
 * Mehrere Module nacheinander installieren. Ein Fehler bei einem Modul
 * stoppt die Liste nicht - am Ende steht ein Sammelbericht.
 */
async function mehrfachInstallieren ({ urls = [], sqlImport = false } = {}) {
  const liste = (Array.isArray(urls) ? urls : String(urls || '').split(/\r?\n/))
    .map(z => String(z || '').trim())
    .filter(Boolean)
  if (!liste.length) throw new Error('Keine URLs angegeben.')
  const ergebnisse = []
  for (let i = 0; i < liste.length; i++) {
    melden({ phase: 'mehrfach', index: i + 1, gesamt: liste.length, text: `Installiere ${i + 1}/${liste.length}: ${liste[i]}` })
    try {
      const r = await installieren({ url: liste[i], sqlImport })
      ergebnisse.push({ url: liste[i], ok: true, ...r })
    } catch (e) {
      ergebnisse.push({ url: liste[i], ok: false, error: e.message })
    }
  }
  const ok = ergebnisse.filter(x => x.ok).length
  return { ok: true, installiert: ok, fehler: ergebnisse.length - ok, ergebnisse }
}

/*
 * Modul installieren: klonen, Submodule holen, Konfiguration nach
 * <configs>/modules kopieren, SQL-Dateien auflisten. Den Bau erzwingt der
 * Merker buildNoetig - sonst übersprünge das Update den Build, weil der
 * Core-HEAD unverändert ist.
 */
async function installieren ({ url, name, sqlImport } = {}) {
  const q = normalisiereQuelle(url)
  const quelle = q.url
  const modul = namePruefen(name || q.name)
  const ordner = quellenOrdner()
  fs.mkdirSync(ordner, { recursive: true })
  const ziel = path.join(ordner, modul)
  if (fs.existsSync(ziel)) throw new Error(`Modul "${modul}" ist bereits vorhanden (${ziel}).`)

  melden({ phase: 'klone', text: `Klone ${modul} von GitHub …` })
  const r = await gitAusfuehren(['clone', '--depth', '1', quelle, ziel], { timeoutMs: 45 * 60 * 1000 })
  if (!r.ok) {
    // Die letzte Zeile trägt den echten Grund ("Repository not found" usw.),
    // die erste ist nur "Cloning into ...".
    const zeilen = `${r.err || ''}\n${r.out || ''}`.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    throw new Error(`git clone fehlgeschlagen: ${zeilen.slice(-1)[0] || 'unbekannter Fehler'}`)
  }
  await gitAusfuehren(['-C', ziel, 'submodule', 'update', '--init', '--recursive'], { timeoutMs: 30 * 60 * 1000 })

  melden({ phase: 'konfiguration', text: 'Lege die Konfiguration an …' })
  // Konfiguration anlegen: *.conf.dist aus dem Modul nach <configs>/modules
  const confs = []
  const konfZiel = moduleOrdner()
  const kopiereConfs = (dir, tiefe = 0) => {
    if (!dir || !konfZiel || tiefe > 3) return
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const voll = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'data') continue
        kopiereConfs(voll, tiefe + 1)
      } else if (/\.conf\.dist$/i.test(e.name)) {
        const zielConf = path.join(konfZiel, e.name.replace(/\.dist$/i, ''))
        if (!fs.existsSync(zielConf)) {
          try {
            fs.mkdirSync(konfZiel, { recursive: true })
            fs.copyFileSync(voll, zielConf)
            confs.push(path.basename(zielConf))
          } catch (_) {}
        }
      }
    }
  }
  kopiereConfs(ziel)

  // SQL-Begleiter: Dateien unter data/sql sammeln (Hinweis, kein Auto-Import)
  melden({ phase: 'sql', text: 'Sammle SQL-Begleiter …' })
  const sql = []
  const sammleSql = (dir, tiefe = 0) => {
    if (tiefe > 6) return
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const voll = path.join(dir, e.name)
      if (e.isDirectory()) sammleSql(voll, tiefe + 1)
      else if (/\.sql$/i.test(e.name)) sql.push(path.relative(ziel, voll))
    }
  }
  sammleSql(path.join(ziel, 'data', 'sql'))

  const readme = ['README.md', 'readme.md', 'README.txt'].map(f => path.join(ziel, f)).find(p => fs.existsSync(p)) || null

  /*
   * Optionaler SQL-Import direkt nach der Installation. Der bestehende
   * Ablauf sichert vorher die Datenbank; ein Fehler macht die Installation
   * nicht rückgängig, wird aber im Ergebnis gemeldet.
   */
  let sqlErgebnis = null
  if (sqlImport === true && sql.length) {
    melden({ phase: 'sqlImport', text: 'Spiele SQL-Begleiter ein (Sicherung zuerst) …' })
    try {
      sqlErgebnis = await sqlEinspielen({ name: modul })
    } catch (e) {
      sqlErgebnis = { ok: false, error: e.message }
    }
  }

  store.write({ buildNoetig: true })
  try { store.write({ restartNoetig: true }) } catch (_) {}
  melden({ phase: 'fertig', text: '' })

  return {
    ok: true,
    name: modul,
    pfad: ziel,
    confs,
    sql: sql.slice(0, 50),
    sqlAnzahl: sql.length,
    sqlErgebnis,
    readme: readme ? path.basename(readme) : null
  }
}

/*
 * Modul-Updates pruefen, ohne zu ziehen: git fetch, dann Abstand zum
 * Upstream zaehlen. So sieht man vor dem Pull, ob und wie viel sich
 * aendert; erst "aktualisieren" zieht und erzwingt den Neubau.
 */
async function pruefen ({ name } = {}) {
  const ordner = quellenOrdner()
  const ziele = []
  if (name) {
    ziele.push(namePruefen(name))
  } else {
    try {
      for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (e.isDirectory() && fs.existsSync(path.join(ordner, e.name, '.git'))) ziele.push(e.name)
      }
    } catch (_) {}
  }
  const ergebnis = []
  for (const m of ziele) {
    const ziel = path.join(ordner, m)
    if (!fs.existsSync(ziel)) {
      ergebnis.push({ name: m, ok: false, hinter: 0, vorne: 0, fehler: 'Modul nicht installiert.' })
      continue
    }
    const fetch = await gitAusfuehren(['-C', ziel, 'fetch', '--quiet'], { timeoutMs: 10 * 60 * 1000 })
    const upstream = await gitAusfuehren(['-C', ziel, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 15000 })
    const version = await gitAusfuehren(['-C', ziel, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 15000 })
    let hinter = 0
    let vorne = 0
    let fehler = fetch.ok ? '' : (fetch.err || '').split('\n').filter(Boolean).pop() || 'git fetch fehlgeschlagen'
    if (!upstream.ok && !fehler) fehler = 'Kein Upstream-Branch gesetzt.'
    if (fetch.ok && upstream.ok) {
      const zaehler = await gitAusfuehren(['-C', ziel, 'rev-list', '--left-right', '--count', 'HEAD...@{u}'], { timeoutMs: 30000 })
      if (zaehler.ok) {
        const [a, b] = zaehler.out.split(/\s+/).map(Number)
        vorne = Number.isFinite(a) ? a : 0
        hinter = Number.isFinite(b) ? b : 0
      } else {
        fehler = 'Abstand zum Upstream nicht lesbar.'
      }
    }
    ergebnis.push({
      name: m,
      ok: !fehler,
      hinter,
      vorne,
      version: version.ok ? version.out : '',
      upstream: upstream.ok ? upstream.out : '',
      fehler
    })
  }
  return { ok: true, module: ergebnis }
}

/*
 * Module aktualisieren (einzeln oder alle): git pull je Ordner. Ändert sich
 * ein Stand, wird der Build erzwungen.
 */
async function aktualisieren ({ name } = {}) {
  const ordner = quellenOrdner()
  const ziele = []
  if (name) {
    ziele.push(namePruefen(name))
  } else {
    try {
      for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (e.isDirectory() && fs.existsSync(path.join(ordner, e.name, '.git'))) ziele.push(e.name)
      }
    } catch (_) {}
  }
  const ergebnis = []
  let geaendert = false
  for (const m of ziele) {
    const ziel = path.join(ordner, m)
    const vorher = await gitAusfuehren(['-C', ziel, 'rev-parse', 'HEAD'], { timeoutMs: 15000 })
    const r = await gitAusfuehren(['-C', ziel, 'pull', '--ff-only'], { timeoutMs: 15 * 60 * 1000 })
    await gitAusfuehren(['-C', ziel, 'submodule', 'update', '--init', '--recursive'], { timeoutMs: 30 * 60 * 1000 })
    const nachher = await gitAusfuehren(['-C', ziel, 'rev-parse', 'HEAD'], { timeoutMs: 15000 })
    const neu = vorher.out !== nachher.out
    if (neu) geaendert = true
    ergebnis.push({
      name: m,
      ok: r.ok,
      geaendert: neu,
      version: (nachher.out || '').slice(0, 8),
      fehler: r.ok ? '' : (r.err || '').split('\n')[0]
    })
  }
  if (geaendert) store.write({ buildNoetig: true })
  return { ok: true, module: ergebnis, buildNoetig: geaendert }
}

function entfernen ({ name } = {}) {
  const modul = namePruefen(name)
  const ziel = path.join(quellenOrdner(), modul)
  if (!fs.existsSync(ziel)) throw new Error(`Modul "${modul}" ist nicht installiert.`)
  fs.rmSync(ziel, { recursive: true, force: true })
  store.write({ buildNoetig: true })
  try { store.write({ restartNoetig: true }) } catch (_) {}
  return { ok: true, name: modul }
}

// --------------------------------------------------------------------------
// Modul-SQL und Konfigurations-Abgleich (Runde 33)
// --------------------------------------------------------------------------

/*
 * Welche Datenbank gehört zu einer SQL-Datei? Die Module legen ihre Skripte
 * unter data/sql/<welt|characters|auth>/... ab, manche auch als db-world.
 * Erkannt wird am Ordnernamen, nicht am Dateinamen - Dateinamen sind frei.
 */
function datenbankSchluessel (rel) {
  const teile = String(rel || '').split(/[\\/]+/).map(s => s.toLowerCase())
  for (const t of teile) {
    const n = t.replace(/^db[-_]/, '').replace(/[-_]/g, '')
    if (n === 'world') return 'worldDb'
    if (n === 'character' || n === 'characters' || n === 'char' || n === 'chars') return 'charDb'
    if (n === 'auth' || n === 'authserver') return 'authDb'
  }
  return null
}

// "updates", "archive", "old" enthalten oft historische Skripte, die den
// aktuellen Stand zurücksetzen würden - die spielt niemand blind ein.
const RE_SQL_UEBERSPRINGEN = /(^|[\\/])(updates?|archives?|archive[ds]?|old|pending)([\\/]|$)/i

/*
 * Nur ausfuehrbarer SQL-Code: Kommentare und Zeichenketten werden entfernt.
 * Ohne das hielt die Schutzpruefung englischen Text wie
 * 'Frostwolf - Out of Combat - Use Random movement' fuer ein USE-Kommando
 * und lehnte ganze Dateien ab. Backticks bleiben stehen - sie sind
 * Bezeichner (USE `acore_world`), keine Zeichenkette.
 */
function sqlCodeNur (text) {
  const s = String(text || '')
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '-' && s[i + 1] === '-') {
      i += 2
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === '#') {
      i++
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const q = c
      i++
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue }
        if (s[i] === q) {
          if (s[i + 1] === q) { i += 2; continue }
          i++
          break
        }
        i++
      }
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

// USE nur am Anweisungsanfang; DROP/CREATE DATABASE ueberall.
const RE_SQL_VERBOTEN = /(?:^|;)\s*use\s+[`A-Za-z0-9_$]|\b(?:drop|create)\s+database\b/i

function sqlIstSicher (text) {
  return !RE_SQL_VERBOTEN.test(sqlCodeNur(text))
}

/*
 * Alle SQL-Dateien eines Moduls unter data/sql (Fallback: sql/).
 * Liefert je Datei den Ziel-Datenbankschlüssel und einen Grund, falls sie
 * nicht eingespielt werden darf.
 */
function sammleSqlDateien (basis) {
  const out = []
  const lauf = (dir, tiefe) => {
    if (tiefe > 8) return
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const voll = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '.git') continue
        lauf(voll, tiefe + 1)
      } else if (/\.sql$/i.test(e.name)) {
        const rel = path.relative(basis, voll)
        const eintrag = { rel, abs: voll, db: datenbankSchluessel(rel), grund: '' }
        if (RE_SQL_UEBERSPRINGEN.test(rel)) {
          eintrag.db = null
          eintrag.grund = 'Historischer Ordner (updates/archive/old)'
        }
        out.push(eintrag)
      }
    }
  }
  const dataSql = path.join(basis, 'data', 'sql')
  if (fs.existsSync(dataSql)) lauf(dataSql, 0)
  if (!out.length) lauf(path.join(basis, 'sql'), 0)
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/*
 * Passende Konfigurationsdatei(en) zu einem Modulordner. Der Name im
 * Quellbaum und der Name der Conf stimmen selten exakt überein
 * (individual-progression -> individualProgression.conf), deshalb wird
 * normalisiert verglichen: ohne "mod-", ohne Trenner, klein geschrieben.
 */
function konfFuer (name, konfOrdner, dateien) {
  const ordner = konfOrdner || moduleOrdner()
  if (!ordner) return []
  let liste = dateien
  if (!liste) {
    try { liste = fs.readdirSync(ordner) } catch (_) { return [] }
  }
  const norm = s => String(s).toLowerCase().replace(/^mod[-_]/, '').replace(/[^a-z0-9]/g, '')
  const n = norm(name)
  if (!n) return []
  return liste
    .filter(f => /\.conf$/i.test(f))
    .filter(f => norm(String(f).replace(/\.conf$/i, '')) === n)
    .map(f => ({ datei: f, pfad: path.join(ordner, f) }))
}

/*
 * SQL-Begleiter eines Moduls einspielen.
 *
 * Reihenfolge und Schutz:
 *   1. erst eine vollständige Sicherung (bricht ab, wenn sie scheitert)
 *   2. Dateien nach Ziel-Datenbank einsortieren (world/characters/auth)
 *   3. Dateien mit USE / DROP DATABASE / CREATE DATABASE ablehnen und benennen
 *   4. je Datei einzeln einspielen, bei einem Fehler sofort anhalten
 *
 * Ein Fehler mittendrin lässt die Datenbank halb aktualisiert zurück - das
 * ist ohne Transaktion über mehrere Dateien nicht zu vermeiden. Deshalb die
 * Sicherung davor und der ehrliche Hinweis im Ergebnis.
 */
async function sqlEinspielen ({ name } = {}) {
  const modul = namePruefen(name)
  const basis = path.join(quellenOrdner(), modul)
  if (!fs.existsSync(basis)) throw new Error(`Modul "${modul}" ist nicht installiert.`)

  const dateien = sammleSqlDateien(basis)
  if (!dateien.length) throw new Error('Keine SQL-Dateien gefunden (erwartet unter data/sql).')

  const m = store.read().mysql || {}
  const ziele = { worldDb: m.worldDb, charDb: m.charDb, authDb: m.authDb }
  const namen = { worldDb: 'Welt', charDb: 'Charaktere', authDb: 'Auth' }

  const zuSpielen = []
  const abgelehnt = []
  const uebersprungen = []
  for (const d of dateien) {
    if (d.grund) {
      uebersprungen.push({ datei: d.rel, grund: d.grund })
      continue
    }
    if (!d.db) {
      uebersprungen.push({ datei: d.rel, grund: 'Ziel-Datenbank nicht erkennbar (world/characters/auth)' })
      continue
    }
    if (!ziele[d.db]) {
      uebersprungen.push({ datei: d.rel, grund: `Keine ${namen[d.db]}-Datenbank eingestellt` })
      continue
    }
    let text = ''
    try {
      text = fs.readFileSync(d.abs, 'utf8')
    } catch (e) {
      abgelehnt.push({ datei: d.rel, grund: `nicht lesbar: ${e.message}` })
      continue
    }
    if (!sqlIstSicher(text)) {
      abgelehnt.push({ datei: d.rel, grund: 'enthält USE / DROP DATABASE / CREATE DATABASE' })
      continue
    }
    zuSpielen.push({ ...d, datenbank: ziele[d.db] })
  }

  if (!zuSpielen.length) {
    throw new Error(
      `Keine einspielbaren SQL-Dateien (${abgelehnt.length} abgelehnt, ${uebersprungen.length} übersprungen).`
    )
  }

  melden({ phase: 'sicherung', text: 'Sichere die Datenbank vor dem Einspielen …' })
  const sicherung = await backupApi.create()

  const ini = backupApi.defaultsDatei()
  const gespielt = []
  const fehler = []
  let abgebrochen = false
  let offen = []
  try {
    for (let i = 0; i < zuSpielen.length; i++) {
      const d = zuSpielen[i]
      melden({
        phase: 'sql',
        datei: d.rel,
        index: i + 1,
        gesamt: zuSpielen.length,
        text: `Spiele ${path.basename(d.rel)} ein (${i + 1}/${zuSpielen.length}) …`
      })
      try {
        await backupApi.spieleEinInDb(d.abs, ini, d.datenbank)
        gespielt.push({ datei: d.rel, datenbank: d.datenbank })
      } catch (e) {
        fehler.push({ datei: d.rel, datenbank: d.datenbank, fehler: e.message })
        abgebrochen = true
        offen = zuSpielen.slice(i + 1).map(x => x.rel)
        break
      }
    }
  } finally {
    try { fs.unlinkSync(ini) } catch (_) {}
    melden({ phase: 'fertig', text: '' })
  }

  /*
   * Haeufigster Abbruch bei einem erneut eingespielten Modul: der Weltstand
   * enthaelt die Daten schon (Duplicate entry / already exists). Das ist
   * kein Fehler des Panels - der Hinweis erspart die Suche.
   */
  let hinweis = null
  if (fehler.some(f => /Duplicate entry|already exists|ERROR (1050|1060|1061|1062)\b/i.test(f.fehler || ''))) {
    hinweis = 'bereitsVorhanden'
  }

  return {
    ok: fehler.length === 0,
    name: modul,
    gesamt: zuSpielen.length,
    gespielt: gespielt.length,
    dateien: gespielt,
    fehler,
    abgebrochen,
    offen,
    abgelehnt,
    uebersprungen,
    hinweis,
    sicherung: sicherung && (sicherung.stamp || sicherung.stempel) ? (sicherung.stamp || sicherung.stempel) : null
  }
}

/*
 * Fallback, wenn der Ordnername nicht zum Conf-Namen passt (z. B. bewusst
 * umbenanntes Modul): die .conf.dist im Modul selbst suchen und die
 * daraus entstandenen Conf-Dateien zuordnen. Das repariert auch ältere
 * Installationen, bei denen die Liste "keine Konfiguration" zeigte.
 */
function konfAusModul (basis, konfOrdner, dateien) {
  const ordner = konfOrdner || moduleOrdner()
  if (!ordner) return []
  let liste = dateien
  if (!liste) {
    try { liste = fs.readdirSync(ordner) } catch (_) { return [] }
  }
  const vorhanden = new Set(liste.filter(f => /\.conf$/i.test(f)))
  const treffer = new Map()
  const skip = new Set(['.git', 'data', 'sql', 'tests', 'test', 'docs', 'node_modules'])
  const lauf = (dir, tiefe) => {
    if (tiefe > 8) return
    let eintraege = []
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of eintraege) {
      const voll = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (skip.has(e.name.toLowerCase())) continue
        lauf(voll, tiefe + 1)
      } else if (/\.conf\.dist$/i.test(e.name)) {
        const name = e.name.replace(/\.dist$/i, '')
        if (vorhanden.has(name)) treffer.set(name, path.join(ordner, name))
      }
    }
  }
  lauf(basis, 0)
  return [...treffer.entries()].map(([datei, pfad]) => ({ datei, pfad }))
}

function installierte () {
  let ordner = null
  try { ordner = quellenOrdner() } catch (_) {
    return { ordner: null, module: [], vorschlaege: KNOWN_MODULES }
  }
  const konfOrdner = moduleOrdner()
  let konfDateien = null
  if (konfOrdner) {
    try { konfDateien = fs.readdirSync(konfOrdner) } catch (_) {}
  }
  let module = []
  try {
    module = fs.readdirSync(ordner, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(ordner, e.name, '.git')))
      .map(e => {
        const basis = path.join(ordner, e.name)
        const sql = sammleSqlDateien(basis)
        let konf = konfFuer(e.name, konfOrdner, konfDateien)
        if (!konf.length) konf = konfAusModul(basis, konfOrdner, konfDateien)
        return {
          name: e.name,
          pfad: basis,
          ...modulVersion(e.name),
          sqlAnzahl: sql.length,
          konf: konf.map(k => k.datei),
          konfPfad: konf.length ? konf[0].pfad : null
        }
      })
  } catch (_) {}
  return { ordner, module, vorschlaege: KNOWN_MODULES }
}

module.exports = {
  init,
  list,
  read,
  save,
  zuruecksetzen,
  parseConf,
  moduleOrdner,
  brauchbar,
  EIGENE_TEXTE,
  sicherungenListen,
  sicherungZurueckspielen,
  installieren,
  mehrfachInstallieren,
  vorpruefen,
  konfigurationNachziehen,
  normalisiereQuelle,
  aktualisieren,
  pruefen,
  entfernen,
  installierte,
  sqlEinspielen,
  sammleSqlDateien,
  sqlIstSicher,
  konfFuer,
  KNOWN_MODULES
}
