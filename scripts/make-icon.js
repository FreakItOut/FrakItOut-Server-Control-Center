// Erzeugt build/icon.ico aus einem PNG mit mehreren Groessen.
// ICO ist ein einfacher Container: Kopf + Verzeichniseintraege + Bilddaten.
// Ab Windows Vista duerfen die Eintraege PNG-kodiert sein.
//
//   node scripts/make-icon.js quelle.png build/icon.ico
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const QUELLE = process.argv[2]
const ZIEL = process.argv[3]
if (!QUELLE || !ZIEL) {
  console.error('Aufruf: node scripts/make-icon.js <quelle.png> <ziel.ico>')
  process.exit(1)
}

const GROESSEN = [16, 24, 32, 48, 64, 128, 256]
const TMP = path.join(os.tmpdir(), 'ac-icon-' + Date.now())
fs.mkdirSync(TMP, { recursive: true })

// ---- 1) Jede Groesse als PNG erzeugen ----
// Das PowerShell landet in einer Datei: inline uebergeben zerlegt es sich
// an den Pfaden und Klammern.
const ps = ['Add-Type -AssemblyName System.Drawing',
  "[System.Drawing.Image]::FromFile('" + QUELLE + "') | ForEach-Object { $src = $_ }"]

for (const n of GROESSEN) {
  ps.push('$bmp = New-Object System.Drawing.Bitmap ' + n + ', ' + n)
  ps.push('$g = [System.Drawing.Graphics]::FromImage($bmp)')
  ps.push('$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic')
  ps.push('$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality')
  ps.push('$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality')
  ps.push('$g.Clear([System.Drawing.Color]::Transparent)')
  ps.push('$g.DrawImage($src, 0, 0, ' + n + ', ' + n + ')')
  ps.push('$g.Dispose()')
  ps.push("$bmp.Save('" + path.join(TMP, n + '.png') + "', [System.Drawing.Imaging.ImageFormat]::Png)")
  ps.push('$bmp.Dispose()')
}
ps.push('$src.Dispose()')

const psDatei = path.join(TMP, 'resize.ps1')
fs.writeFileSync(psDatei, ps.join('\r\n'), 'utf8')
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psDatei], { stdio: 'inherit' })

// ---- 2) ICO zusammensetzen ----
const bilder = GROESSEN.map(n => ({ n, daten: fs.readFileSync(path.join(TMP, n + '.png')) }))
const kopfGroesse = 6
const eintragGroesse = 16
const datenStart = kopfGroesse + eintragGroesse * bilder.length

let gesamt = datenStart
for (const b of bilder) {
  b.offset = gesamt
  gesamt += b.daten.length
}

const ico = Buffer.alloc(gesamt)
ico.writeUInt16LE(0, 0)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(bilder.length, 4)

bilder.forEach((b, i) => {
  const p = kopfGroesse + i * eintragGroesse
  ico.writeUInt8(b.n >= 256 ? 0 : b.n, p)
  ico.writeUInt8(b.n >= 256 ? 0 : b.n, p + 1)
  ico.writeUInt8(0, p + 2)
  ico.writeUInt8(0, p + 3)
  ico.writeUInt16LE(1, p + 4)
  ico.writeUInt16LE(32, p + 6)
  ico.writeUInt32LE(b.daten.length, p + 8)
  ico.writeUInt32LE(b.offset, p + 12)
  b.daten.copy(ico, b.offset)
})

fs.mkdirSync(path.dirname(ZIEL), { recursive: true })
fs.writeFileSync(ZIEL, ico)
fs.rmSync(TMP, { recursive: true, force: true })

// ---- 3) Gegenprobe: die ICO wieder einlesen ----
const pruef = fs.readFileSync(ZIEL)
const anzahl = pruef.readUInt16LE(4)
console.log('icon.ico geschrieben: ' + ZIEL + '  (' + (pruef.length / 1024).toFixed(1) + ' KB)')
console.log('Verzeichnis: ' + anzahl + ' Eintraege')
let fehler = 0
for (let i = 0; i < anzahl; i++) {
  const p = 6 + i * 16
  const breite = pruef.readUInt8(p) || 256
  const laenge = pruef.readUInt32LE(p + 8)
  const versatz = pruef.readUInt32LE(p + 12)
  const ok = versatz + laenge <= pruef.length
  if (!ok) fehler++
  console.log('  ' + String(breite).padStart(3) + 'px  ' + String(laenge).padStart(7) + ' Bytes @ ' + versatz + (ok ? '' : '  <-- ausserhalb!'))
}
console.log(fehler ? 'FEHLER: ' + fehler + ' Eintraege ungueltig' : 'Alle Eintraege innerhalb der Datei.')
process.exitCode = fehler ? 1 : 0