// Erkennt Befehle, die den Server stilllegen.
//
// Wofuer: "server shutdown" faehrt den Worldserver sofort herunter. Der
// Preset steht in der Konsole direkt neben "Speichern" und "Alles neu
// laden" - ein Klick daneben ist ein Serverausfall, und niemand faellt es
// auf, weil die Konsole danach eh leer ist.
//
// Geprueft wird der eingegebene Text, nicht der Preset. Denn der Befehl
// laesst sich auch von Hand eintippen ("server shutdown 5m"), und dann
// waere eine Absicherung, die nur am Preset haengt, wertlos.
//
// Der Punkt am Anfang ist optional: AzerothCore akzeptiert "server
// shutdown" genauso wie ".server shutdown".

// "server shutdown 1 0", ".server shutdown", "shutdown 0"
const RE = /^\s*\.?\s*(?:server\s+shutdown|shutdown)\b/i

export function istAbschaltung (befehl) {
  if (!befehl) return false
  return RE.test(String(befehl))
}

/*
 * Wie lange faellt der Server aus? Steht im Befehl eine Zeitangabe, wird
 * sie uebernommen - "5m" heisst "in 5 Minuten", nicht "sofort". Steht
 * keine drin, ist die Angabe unbekannt, weil der Core dann seinen
 * eigenen Vorgabewert nimmt.
 */
export function verzoegerung (befehl) {
  const m = /\b(\d+)\s*([smhd]?)\b/i.exec(String(befehl || ''))
  if (!m) return null
  const zahl = Number(m[1])
  const einheit = (m[2] || '').toLowerCase()
  const faktor = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[einheit] || 1
  return { zahl, einheit, sekunden: zahl * faktor }
}