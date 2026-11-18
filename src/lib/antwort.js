// Antwort des Worldserver aufbereiten.
//
// Der Core liefert die Ausgabe eines Befehls im SOAP-Rueckkanal, im
// Element <result>. Zwei Formen muessen unterschieden werden:
//
//   "server info"  ->  "AzerothCore rev. ...&#xD;Connected players: 0..."
//                     eine mehrzeilige Ausgabe, die man lesen will
//
//   "kick Spieler" ->  ""  oder  "Player kicked."
//                     eine Zeile, die in einen Kurzhinweis passt
//
// Fuer die Konsolenseite wird die volle Ausgabe gezeigt. Fuer die
// Schnellaktionen und die GM-Werkzeuge nur die erste Zeile - der
// Kurzhinweis ist 380 Pixel breit und hat keine Hoehenbegrenzung; eine
// vollstaendige Serverausgabe darin wuerde das Fenster zudecken.

// Die erste sinnvolle Zeile, gekuerzt auf eine laesbare Laenge.
export function ersteZeile (text, max = 90) {
  if (!text) return ''
  const zeile = String(text)
    .split('\n')
    .map(z => z.trim())
    .find(z => z.length)
  if (!zeile) return ''
  return zeile.length > max ? zeile.slice(0, max - 1) + '…' : zeile
}

// Vollstaendige Antwort, aber ohne unbegrenzt zu wachsen. Ein Befehl
// wie "reload all" kann bei diesem Server sehr viel zurueckgeben.
export function vollstaendig (text, maxZeilen = 60) {
  if (!text) return ''
  const zeilen = String(text).split('\n')
  if (zeilen.length <= maxZeilen) return zeilen.join('\n')
  return zeilen.slice(0, maxZeilen).join('\n') +
    `\n… (${zeilen.length - maxZeilen} weitere Zeilen)`
}