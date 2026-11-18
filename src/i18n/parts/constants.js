// Spielbegriffe aus src/lib/constants.js
export default {
  de: {
    constants: {
      class: {
        1: 'Krieger',
        2: 'Paladin',
        3: 'Jäger',
        4: 'Schurke',
        5: 'Priester',
        6: 'Todesritter',
        7: 'Schamane',
        8: 'Magier',
        9: 'Hexer',
        10: 'Mönch',
        11: 'Druide',
        12: 'Dämonenjäger'
      },
      race: {
        1: 'Mensch',
        2: 'Ork',
        3: 'Zwerg',
        4: 'Nachtelf',
        5: 'Untoter',
        6: 'Tauren',
        7: 'Gnom',
        8: 'Troll',
        9: 'Goblin',
        10: 'Blutelf',
        11: 'Draenei',
        12: 'Draenei (QC)',
        26: 'Mensch (CD)'
      },
      gender: { 0: 'Männlich', 1: 'Weiblich' },
      unknown: 'Unbekannt',
      /*
       * Kartennamen. Bewusst nur die, die eindeutig sind - eine falsche
       * Beschriftung ist schlimmer als "Map <Nummer>". Die IDs stammen aus der
       * Spalte map; die Spalten zone/instance_teleport haben nichts damit zu
       * tun.
       *
       * Warum das hier korrigiert wurde: 530 war als "Twisting Nether"
       * bezeichnet und 571 als "Outland". Beides falsch - 530 ist The Outland
       * und 571 ist Norsca. Genau auf diesen beiden Karten standen in dieser
       * Datenbank 461 der 1171 Charaktere, die Anzeige war also falsch fuer
       * fast jeden.
       */
      map: {
        0: 'Eastern Kingdoms',
        1: 'Kalimdor',
        530: 'The Outland',
        571: 'Norsca',
        249: 'Uldum',
        855: "Scholazar's Oasis"
      },
      quality: ['Schlecht', 'Gewöhnlich', 'Ungewöhnlich', 'Selten', 'Episch', 'Legendär', 'Artefakt'],
      gm: {
        0: 'Kein GM',
        1: 'Moderator',
        2: 'Spielleiter',
        3: 'Administrator'
      }
    }
  },
  en: {
    constants: {
      class: {
        1: 'Warrior',
        2: 'Paladin',
        3: 'Hunter',
        4: 'Rogue',
        5: 'Priest',
        6: 'Death Knight',
        7: 'Shaman',
        8: 'Mage',
        9: 'Warlock',
        10: 'Monk',
        11: 'Druid',
        12: 'Demon Hunter'
      },
      race: {
        1: 'Human',
        2: 'Orc',
        3: 'Dwarf',
        4: 'Night Elf',
        5: 'Undead',
        6: 'Tauren',
        7: 'Gnome',
        8: 'Troll',
        9: 'Goblin',
        10: 'Blood Elf',
        11: 'Draenei',
        12: 'Draenei (QC)',
        26: 'Human (CD)'
      },
      gender: { 0: 'Male', 1: 'Female' },
      unknown: 'Unknown',
      map: {
        0: 'Eastern Kingdoms',
        1: 'Kalimdor',
        530: 'The Outland',
        571: 'Norsca',
        249: 'Uldum',
        855: "Scholazar's Oasis"
      },
      quality: ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact'],
      gm: {
        0: 'No GM',
        1: 'Moderator',
        2: 'Game Master',
        3: 'Administrator'
      }
    }
  }
}