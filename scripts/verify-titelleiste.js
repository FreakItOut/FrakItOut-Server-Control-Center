'use strict'

/*
 * Prueft, ob der Fensterrahmen zur Titelleiste passt.
 *
 * Aufruf: .\node_modules\electron\dist\electron.exe scripts\verify-titelleiste.js
 *
 * Worum es geht: Die Titelleiste malt das Panel selbst, als flache Flaeche. Die
 * drei Fensterknoepfe zeichnet Windows, und die bekommen nur eine einzige
 * Farbe. Zwischen beiden entsteht dadurch ein hellerer oder dunklerer
 * Fleck - genau der, der in der EXE auffaellt.
 *
 * Der Test besteht aus zwei Teilen, die unterschiedlich viel taugen:
 *
 *   1. Vergleich der Quellen. main.js und styles.css werden gelesen und
 *      ihre Farben verglichen. Laeuft immer, braucht kein Bild und keine
 *      freie Bildschirmflaeche. Stimmen beide ueberein, kann der
 *      Knopfblock nicht auffallen.
 *
 *   2. Messung am Bildschirm. Nur moeglich, wenn kein Vollbildprogramm
 *      davor liegt. Genau daran ist der erste Versuch gescheitert: Auf
 *      dem Rechner lief ein Spiel im exklusiven Vollbild, die Messung las
 *      den Wuestensand und meldete 900 gleiche Pixel - vollstaendig
 *      wertlos, ohne eine einzige Warnung. Teil 2 prueft deshalb vorher,
 *      ob das Fenster wirklich oben liegt, und verweigert die Messung,
 *      wenn nicht.
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const BERICHT = path.join(os.tmpdir(), 'titelleiste.txt')
const zeilen = []
fs.writeFileSync(BERICHT, '', 'utf8')
const sag = z => {
  zeilen.push(String(z))
  fs.appendFileSync(BERICHT, String(z) + '\n', 'utf8')
}
let schlecht = 0
const pruefe = (c, l) => {
  if (c) sag('  OK   ' + l)
  else { schlecht++; sag('  FAIL ' + l) }
}

// Abstand zweier Farben. Reicht eine Zahl als "faellt auf"?
function abstand (a, b) {
  const n = h => parseInt(h.slice(1), 16)
  const x = n(a); const y = n(b)
  const dr = ((x >> 16) & 255) - ((y >> 16) & 255)
  const dg = ((x >> 8) & 255) - ((y >> 8) & 255)
  const db = (x & 255) - (y & 255)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function pixel (img, x, y) {
  const { width, height } = img.getSize()
  if (x < 0 || y < 0 || x >= width || y >= height) return null
  const buf = img.getBitmap()
  const i = (y * width + x) * 4
  const hx = v => v.toString(16).padStart(2, '0')
  return `#${hx(buf[i + 2])}${hx(buf[i + 1])}${hx(buf[i])}`
}

// Wo liegt die Grenze zwischen "man sieht es" und "man sieht es nicht"?
// Erfahrungsgemaess etwa 8 - darunter verschwindet der Unterschied neben
// dem hellen Text und den Kanten.
const GRUENZE = 8

// Wert, an dem sich Rahmen und Leiste ausrichten MUESSEN.
const SOLL = '#08080a'

// Einen Wert aus einer Datei lesen. Nicht geraten, nicht fest verdrahtet.
function liesAus (datei, muster) {
  const s = fs.readFileSync(path.join(__dirname, '..', datei), 'utf8')
  const m = muster.exec(s)
  return m ? m[1].toLowerCase() : null
}

require('../electron/main')
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const warte = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  const schranke = setTimeout(() => { sag('ABBRUCH'); process.exit(2) }, 90000)

  let f = null
  for (let i = 0; i < 100; i++) {
    if (BrowserWindow.getAllWindows().length) { f = BrowserWindow.getAllWindows()[0]; break }
    await warte(200)
  }
  if (!f) { sag('  FAIL kein Fenster'); clearTimeout(schranke); process.exit(1) }

  // ================= Teil 1: der Quellvergleich =================
  sag('=== 1. Fensterrahmen gegen Leiste, aus den Quellen ===')
  sag('  Das laeuft immer - kein Bild noetig, keine freie Bildschirmflaeche.')

  const rahmenFarbe = liesAus('electron/main.js', /color:\s*'(#[0-9a-fA-F]{3,8})'/)
  const leistenFarbe = liesAus('src/styles.css', /\.titlebar\s*\{[\s\S]*?background:\s*(#[0-9a-fA-F]{3,8})\s*;/)

  sag(`  electron/main.js  titleBarOverlay.color : ${rahmenFarbe}`)
  sag(`  src/styles.css    .titlebar background  : ${leistenFarbe}`)
  sag(`  gewollt                                : ${SOLL}`)

  pruefe(Boolean(rahmenFarbe), 'der Fensterrahmen nennt eine Farbe')
  pruefe(Boolean(leistenFarbe), 'die Titelleiste nennt eine Farbe')
  pruefe(rahmenFarbe === SOLL, `der Rahmen steht auf der vereinbarten Farbe ${SOLL}`)
  pruefe(leistenFarbe === SOLL, `die Leiste steht auf der vereinbarten Farbe ${SOLL}`)
  if (rahmenFarbe && leistenFarbe) {
    const d = abstand(rahmenFarbe, leistenFarbe)
    sag(`  Abstand Rahmen zu Leiste: ${d.toFixed(0)}   Grenze: ${GRUENZE}`)
    pruefe(d <= GRUENZE, `Rahmen und Leiste sind farblich gleich (${d.toFixed(0)})`)
  }

  sag('')
  sag('=== 2. Hoehe von Rahmen und Leiste ===')
  const rahmenHoehe = liesAus('electron/main.js', /height:\s*(\d+)\s*\r?\n\s*\}/)
  const leistenHoehe = liesAus('src/styles.css', /\.titlebar\s*\{[\s\S]*?height:\s*(\d+)px/)
  sag(`  titleBarOverlay.height : ${rahmenHoehe}`)
  sag(`  .titlebar height       : ${leistenHoehe}`)
  pruefe(
    Boolean(rahmenHoehe) && Boolean(leistenHoehe) && Number(rahmenHoehe) === Number(leistenHoehe),
    `beide sind gleich hoch (${rahmenHoehe} / ${leistenHoehe})`
  )

  // ================= Teil 2: die Messung =================
  sag('')
  sag('=== 3. Messung am Bildschirm ===')
  sag('  Nur moeglich, wenn kein Vollbildprogramm davor liegt.')

  f.show()
  f.setAlwaysOnTop(true, 'screen-saver')
  await warte(2000)

  const r = f.getBounds()
  const bildschirm = screen.getDisplayMatching(r)
  const quellen = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(bildschirm.size.width * bildschirm.scaleFactor),
      height: Math.round(bildschirm.size.height * bildschirm.scaleFactor)
    }
  })
  const quelle = quellen.find(q => q.display_id === String(bildschirm.id)) || quellen[0]
  const img = quelle.thumbnail
  const sx = img.getSize().width / bildschirm.size.width
  const sy = img.getSize().height / bildschirm.size.height
  const wx = x => Math.round(r.x * sx)
  const wy = y => Math.round(r.y * sy)

  const inhalt = await f.capturePage()
  f.setAlwaysOnTop(false)
  await warte(300)

  const iB = inhalt.getSize()
  sag(`  Fenster ${r.width} x ${r.height}, Skalierung ${bildschirm.scaleFactor}`)
  sag(`  Fensterinhalt aufgenommen: ${iB.width} x ${iB.height}`)

  /*
   * Den Fensterinhalt immer speichern, auch wenn die Messung am
   * Bildschirm ausfaellt. Der zeigt die Leiste, wie das Panel sie malt -
   * und genau die sieht man sonst nie zu sehen. Fuer den Ausschnitt
   * zuerst 70 Pixel: die Leiste und ein Streifen darunter, damit man
   * sieht, wie sie zum Rest des Fensters passt.
   */
  if (iB.width) {
    fs.writeFileSync(path.join(os.tmpdir(), 'titelleiste-inhalt.png'), inhalt.toPNG())
    try {
      const ausschnitt = await f.capturePage({ x: 0, y: 0, width: iB.width, height: 70 })
      fs.writeFileSync(path.join(os.tmpdir(), 'titelleiste-ausschnitt.png'), ausschnitt.toPNG())
      sag(`  Ausschnitt der Leiste gespeichert: ${path.join(os.tmpdir(), 'titelleiste-ausschnitt.png')}`)
    } catch (e) {
      sag(`  Ausschnitt nicht moeglich: ${e.message}`)
    }
  }

  // Gegenprobe: zeigt der Bildschirm ueberhaupt dieses Fenster?
  const paare = [
    { name: 'links in der Leiste', bx: 400, by: 8 },
    { name: 'Mitte des Fensters', bx: 400, by: 300 },
    { name: 'rechts neben den Knoepfen', bx: r.width - 200, by: 8 }
  ]
  let treffer = 0
  for (const p of paare) {
    const a = pixel(img, wx(p.bx), wy(p.by))
    const b = pixel(inhalt, p.bx, p.by)
    const d = a && b ? abstand(a, b) : 999
    sag(`  ${p.name.padEnd(26)} Bildschirm ${a}  Fenster ${b}   Abstand ${d.toFixed(0)}`)
    if (d <= GRUENZE) treffer++
  }

  if (iB.width && treffer >= 2) {
    sag('  Das Fenster liegt oben - es wird gemessen.')
    sag('')
    sag('   y   Leiste       Rahmen       Abstand')
    const knopfX = r.width - 40
    let schlechtester = 0
    for (let dy = 1; dy <= 33; dy += 2) {
      const leiste = pixel(inhalt, 400, dy)
      const rahmen = pixel(img, wx(knopfX), wy(dy))
      if (!leiste || !rahmen) continue
      const d = abstand(leiste, rahmen)
      if (d > schlechtester) schlechtester = d
      sag(`  ${String(dy).padStart(3)}   ${leiste}     ${rahmen}      ${d.toFixed(0).padStart(3)}`)
    }
    sag('')
    sag(`  Groesster Abstand: ${schlechtester.toFixed(0)}   Grenze: ${GRUENZE}`)
    pruefe(schlechtester <= GRUENZE, `am Bildschirm ist kein Rand zu sehen (${schlechtester.toFixed(0)})`)
    fs.writeFileSync(path.join(os.tmpdir(), 'titelleiste.png'), img.toPNG())
    fs.writeFileSync(path.join(os.tmpdir(), 'titelleiste-inhalt.png'), inhalt.toPNG())
  } else {
    sag('')
    sag('  UEBERSPRUNGEN. Ein anderes Fenster liegt davor - vermutlich ein')
    sag('  Spiel im Vollbild, das sich nicht ueberlagern laesst. Der Vergleich')
    sag('  in Teil 1 gilt trotzdem: er liest die Farben aus den Quellen und')
    sag('  braucht kein Bild. Fuer die Aufnahme muss das Programm, das den')
    sag('  Bildschirm belegt, in den Hintergrund.')
  }

  clearTimeout(schranke)
  sag('')
  sag(schlecht ? `${schlecht} FEHLGESCHLAGEN` : 'ALLE PRUEFUNGEN BESTANDEN')
  process.exit(schlecht ? 1 : 0)
})