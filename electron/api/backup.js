'use strict'

const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { spawn } = require('child_process')
const store = require('../store')
const db = require('../db')

/*
 * Sichern und Wiederherstellen der Server-Datenbank.
 *
 * Grundsatz: es wird nichts geloescht und nichts ueberschrieben, was man nicht
 * wiederbekommt. Deshalb
 *   - legt jede Sicherung neue Dateien an (Zeitstempel im Namen),
 *   - legt das Wiederherstellen VORHER automatisch eine eigene Sicherung an
 *     und bricht ab, wenn das nicht gelingt,
 *   - verweigert das Wiederherstellen, solange World- oder Authserver laufen -
 *     ein Restore mitten im Betrieb ergibt eine inkonsistente Datenbank.
 *
 * Aufbau einer Sicherung: je Datenbank EINE Datei, damit sich eine einzelne
 * zurueckspielen laesst. Der gemeinsame Zeitstempel im Namen fasst sie zu einer
 * Sicherung zusammen:
 *
 *   wowpanel_2026-10-14_15_30_00__acore_auth.sql.gz
 *   wowpanel_2026-10-14_15_30_00__acore_characters.sql.gz
 *   wowpanel_2026-10-14_15_30_00__acore_world.sql.gz
 *
 * Komprimiert wird ueber das eingebaute zlib. Windows bringt kein gzip mit,
 * und ein externes Programm waere eine Abhaengigkeit, die der Nutzer erst
 * installieren muesste.
 *
 * Das Passwort kommt nicht auf die Kommandozeile: Prozesslisten sind fuer
 * jeden lesbar. Stattdessen wird eine temporaere my.ini geschrieben, die
 * mysqldump/mysql per --defaults-extra-file lesen und die danach geloescht
 * wird.
 */

const TRENNER = '__'
const PRAEFIX = 'wowpanel_'

// Häufig: Werte aus der Konfiguration kommen als Text daher
function int (v, fallback = 0) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

let win = null

function init (windowRef) {
  win = windowRef
}

function melden (nutzlast) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send('backup:progress', nutzlast)
  }
}

// ---------------------------------------------------------------- Pfade

function serverWurzel () {
  const s = store.read().server
  return s.rootDir || s.workDir || s.worldConfDir || path.dirname(s.worldExe || '') || os.homedir()
}

/*
 * Wohin die Sicherungen gehen. Voreingestellt neben dem Server - dort sucht
 * ein Administrator sie zuerst. Über config.json (backup.dir) änderbar.
 */
function backupDir () {
  const eingestellt = (store.read().backup && store.read().backup.dir) || ''
  if (eingestellt) return path.resolve(eingestellt)
  return path.join(serverWurzel(), 'backups')
}

function zeitstempel (d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`
  )
}

/*
 * mysqldump.exe bzw. mysql.exe. Beide liegen bei jedem Repack direkt neben
 * der mysqld.exe, die das Panel schon kennt. Findet sich dort nichts, wird
 * über den Pfad gesucht - dann kümmert sich Windows darum.
 */
function toolName (werkzeug) {
  const ms = store.read().server.mysqlServer || {}
  if (ms.exe) {
    const daneben = path.join(path.dirname(ms.exe), `${werkzeug}.exe`)
    if (fs.existsSync(daneben)) return daneben
  }
  // bewusst nur der Basisname: execFile durchsucht den PATH
  return `${werkzeug}.exe`
}

function werkzeuge () {
  const dump = toolName('mysqldump')
  const client = toolName('mysql')
  const gefunden = p => path.isAbsolute(p) && fs.existsSync(p)
  return {
    dump,
    client,
    // false heisst: kommt aus dem PATH, Fundort unbekannt
    dumpLokal: gefunden(dump),
    clientLokal: gefunden(client),
    dir: path.isAbsolute(dump) ? path.dirname(dump) : null
  }
}

// -------------------------------------------------------- Zugangsdaten

function verbindung () {
  const m = store.read().mysql || {}
  const port = Number(m.port)
  return {
    host: m.host || '127.0.0.1',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3306,
    user: m.user || 'root',
    password: m.password || ''
  }
}

function datenbanken () {
  const m = store.read().mysql || {}
  return [...new Set([m.authDb, m.charDb, m.worldDb].filter(Boolean))]
}

// Temporäre my.ini mit den Zugangsdaten. Wird immer wieder entfernt.
function defaultsDatei () {
  const v = verbindung()
  const datei = path.join(os.tmpdir(), `wowpanel-dump-${process.pid}-${Date.now()}.ini`)
  fs.writeFileSync(
    datei,
    ['[client]', `host=${v.host}`, `port=${v.port}`, `user=${v.user}`, `password=${v.password}`, ''].join('\n'),
    { encoding: 'utf8', mode: 0o600 }
  )
  return datei
}

// -------------------------------------------------------- Prozesse
// -------------------------------------------------------- Aktionen

/*
 * Eine Datei je Datenbank, optional komprimiert.
 *
 * mysqldump schreibt nach stdout, nicht in eine Datei. Deshalb wird die
 * Ausgabe durch zlib gepiped und erst dadurch auf die Platte geschrieben.
 * So bleibt der Speicherbedarf unabhaengig von der Datenbankgroesse - eine
 * Welt-Datenbank sind ueber 300 MB, die als Zeichenkette im Speicher waeren
 * mehr als unangenehm.
 */
function dumpNach (dbName, ziel, ini, komprimieren) {
  const args = [
    `--defaults-extra-file=${ini}`,
    '--databases',
    dbName,
    '--single-transaction',
    '--quick',
    '--default-character-set=utf8mb4'
  ]
  // Ein Wegfall dieser Schalter ist kein Grund, kein Backup zu machen -
  // gesichert wird trotzdem, nur eben ohne Routinen und Events.
  const varianten = [
    { args: [...args, '--routines', '--events', '--triggers'] },
    { args: [...args, '--triggers'] }
  ]

  return new Promise((resolve, reject) => {
    // Kette immer:  mysqldump -> [gzip] -> Datei
    const aus = fs.createWriteStream(ziel)
    const gz = komprimieren ? zlib.createGzip({ level: 6 }) : null
    // Die Senke ist immer die Datei. Ohne Komprimierung fliesst der Dump
    // direkt hinein, mit Komprimierung zuerst durch den Gzip-Strom.
    const senke = aus

    let erledigt = false
    const scheitern = e => {
      if (erledigt) return
      erledigt = true
      try {
        if (gz) gz.destroy()
        aus.destroy()
      } catch (_) {}
      try {
        if (fs.existsSync(ziel)) fs.unlinkSync(ziel)
      } catch (_) {}
      reject(e)
    }

    aus.on('error', scheitern)
    if (gz) {
      gz.on('error', scheitern)
      // Der Gzip-Strom ist die Quelle fuer die Datei - nicht umgekehrt.
      // Ein fs.WriteStream kann nichts "an einen Gzip senden".
      gz.pipe(aus)
    }
    senke.on('finish', () => {
      if (erledigt) return
      erledigt = true
      resolve()
    })

    const starten = (vollArgs, ersterVersuch) => {
      const bin = toolName('mysqldump')
      let p
      try {
        p = spawn(bin, vollArgs, { windowsHide: true })
      } catch (e) {
        scheitern(new Error(`${bin} konnte nicht gestartet werden: ${e.message}`))
        return
      }
      let meldung = ''
      p.stderr.on('data', d => {
        meldung += d.toString()
        if (meldung.length > 8000) meldung = meldung.slice(-8000)
      })
      p.stdout.on('error', scheitern)
      p.stdout.pipe(gz || senke)
      p.on('error', e => scheitern(new Error(`${path.basename(bin)}: ${e.message}`)))
      p.on('close', code => {
        if (erledigt) return
        if (code === 0) {
          // mysqldump schliesst stdout von selbst. Bei Komprimierung muss
          // die Kette gzip -> Datei erst zu Ende geschrieben werden; das
          // 'finish' der Datei oben loest dann den Promise auf.
          return
        }
        if (ersterVersuch) {
          // Auf die vereinfachte Variante zurueckfallen
          try {
            if (gz) gz.destroy()
            aus.destroy()
            if (fs.existsSync(ziel)) fs.unlinkSync(ziel)
          } catch (_) {}
          starten(varianten[1].args, false)
          return
        }
        scheitern(new Error(meldung.trim() || `${path.basename(bin)} endete mit Code ${code}.`))
      })
    }
    starten(varianten[0].args, true)
  })
}

// Alle Datenbanken nacheinander in je eine Datei.
/*
 * Die konfigurierten Datenbanken plus optionale, wenn sie auf dem Server
 * existieren: acore_playerbots (mod-playerbots) hat nach einer Migration
 * echten Bot-Zustand drin - ohne sie wäre der Bot-Bestand nicht gesichert.
 */
async function datenbankenAktive () {
  const basis = datenbanken()
  try {
    const rows = await db.execute('auth', 'SHOW DATABASES')
    const vorhanden = new Set(
      Array.isArray(rows) ? rows.map(r => Object.values(r)[0]).filter(Boolean) : []
    )
    if (vorhanden.has('acore_playerbots')) basis.push('acore_playerbots')
  } catch (_) {}
  return [...new Set(basis)]
}

async function create () {
  const dbs = await datenbankenAktive()
  if (!dbs.length) {
    throw new Error('Keine Datenbanknamen eingestellt. Unter „Einstellungen - MySQL-Verbindung" prüfen.')
  }
  const probe = await db.test('auth')
  if (!probe.ok) {
    throw new Error(`Die Datenbank ist nicht erreichbar: ${probe.error}`)
  }

  const auto = store.read().backup?.auto || {}
  const komprimieren = auto.compress !== false

  const ziel = backupDir()
  fs.mkdirSync(ziel, { recursive: true })

  /*
   * Platzprüfung VOR dem Dump: Sicherungen schreiben die volle DB-Größe
   * (ggf. gepackt) auf die Platte. Auf einer fast vollen Platte bricht der
   * Dump mittendrin ab und hinterlässt halbe Dateien - besonders ärgerlich
   * bei der unbeaufsichtigten Nacht-Sicherung.
   */
  let hinweis = null
  const [frei, dbGroesse] = await Promise.all([freierPlatzBytes(ziel), datenbankGroesseBytes(dbs)])
  if (frei != null && dbGroesse > 0) {
    const mb = b => (b / 1024 / 1024).toFixed(0)
    if (frei < dbGroesse * 1.5) {
      throw new Error(
        `Zu wenig Plattenplatz für die Sicherung: die Datenbank braucht etwa ${mb(dbGroesse)} MB, ` +
          `frei sind ${mb(frei)} MB. Bitte zuerst Platz schaffen (alte Sicherungen, Downloads) ` +
          'oder die Sicherung auf ein anderes Laufwerk legen.'
      )
    }
    if (frei < dbGroesse * 3) {
      hinweis = `Wenig Plattenplatz: ${mb(frei)} MB frei bei ca. ${mb(dbGroesse)} MB Datenbank - nur knapp über dem Bedarf.`
    }
  }

  const stempel = zeitstempel()

  const ini = defaultsDatei()
  const dateien = []
  try {
    for (const name of dbs) {
      const datei = path.join(ziel, `${PRAEFIX}${stempel}${TRENNER}${name}.sql${komprimieren ? '.gz' : ''}`)
      melden({ phase: 'dump', db: name, meldung: `Sichere ${name} …` })
      await dumpNach(name, datei, ini, komprimieren)
      dateien.push(beschreiben(datei))
    }
  } finally {
    try {
      fs.unlinkSync(ini)
    } catch (_) {}
  }

  const summe = dateien.reduce((a, d) => a + d.size, 0)
  melden({ phase: 'fertig', stamp: stempel, meldung: `Sicherung fertig (${mb(summe)})` })

  // Aufraeumen gehoert zur Sicherung dazu: sonst waechst der Ordner ohne Grenze
  const aufgeraeumt = aufraeumen()

  // Kopie auf das zweite Ziel. Ein Fehler dort macht die Sicherung nicht
  // kaputt, wird aber gemeldet und auf der Backup-Seite angezeigt.
  const spiegel = await spiegele(dateien, stempel)

  return {
    ok: true,
    stamp: stempel,
    files: dateien,
    size: summe,
    compressed: komprimieren,
    removed: aufgeraeumt,
    spiegel,
    hinweis
  }
}

function mb (bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/*
 * Freier Platz auf dem Laufwerk des Ordners (bytes) - null wenn nicht
 * prüfbar. fs.statfs gibt es ab Node 18.15.
 */
async function freierPlatzBytes (ordner) {
  try {
    const st = await require('fs').promises.statfs(ordner)
    return Number(st.bavail) * Number(st.bsize)
  } catch (_) {
    return null
  }
}

/*
 * Geschätzte Größe der beteiligten Datenbanken (Daten + Indizes, bytes).
 * -1 = nicht ermittelbar; die Platzprüfung wird dann übersprungen.
 */
async function datenbankGroesseBytes (dbs) {
  try {
    const platzhalter = dbs.map(() => '?').join(', ')
    const rows = await db.query(
      'auth',
      `SELECT SUM(data_length + index_length) AS b FROM information_schema.tables WHERE table_schema IN (${platzhalter})`,
      dbs
    )
    const b = Array.isArray(rows) && rows.length ? Number(rows[0].b) : NaN
    return Number.isFinite(b) && b > 0 ? b : -1
  } catch (_) {
    return -1
  }
}

/*
 * Eine (gepackte) Sicherungsdatei zurückspielen. Entpacken und Einspielen
 * laufen in einem Rohr: die Datei ist mehrere hundert MB gross und soll
 * nicht als Ganzes im Speicher stehen.
 */
function spieleEin (datei, ini, umbenennen = null) {
  return new Promise((resolve, reject) => {
    const bin = toolName('mysql')
    let p
    try {
      p = spawn(bin, [`--defaults-extra-file=${ini}`, '--default-character-set=utf8mb4'], {
        windowsHide: true
      })
    } catch (e) {
      reject(new Error(`${bin} konnte nicht gestartet werden: ${e.message}`))
      return
    }

    const quelle = fs.createReadStream(datei)
    const gz = datei.toLowerCase().endsWith('.gz') ? zlib.createGunzip() : null

    /*
     * Umbenenn-Strom: ersetzt das Datenbank-Token im Dump-Byte-Strom. Damit
     * laesst sich eine Sicherung zur Probe in Wegwerf-Datenbanken spielen
     * (Wiederherstellungstest), ohne die echten Datenbanken anzufassen.
     * Byteweise mit Restpuffer: das Token darf nicht an einer
     * Chunk-Grenze zerrissen werden.
     */
    const umbenennStrom = umbenennen
      ? (() => {
        const { Transform } = require('stream')
        const such = Buffer.from('`' + umbenennen.von + '`', 'utf8')
        const ersatz = Buffer.from('`' + umbenennen.nach + '`', 'utf8')
        let rest = Buffer.alloc(0)
        return new Transform({
          transform (chunk, enc, cb) {
            const buf = Buffer.concat([rest, chunk])
            const teile = []
            let pos = 0
            let idx
            while ((idx = buf.indexOf(such, pos)) !== -1) {
              if (idx > pos) teile.push(buf.slice(pos, idx))
              teile.push(ersatz)
              pos = idx + such.length
            }
            const behalten = Math.min(such.length - 1, buf.length - pos)
            if (behalten > 0) {
              rest = buf.slice(buf.length - behalten)
              if (buf.length - pos - behalten > 0) teile.push(buf.slice(pos, buf.length - behalten))
            } else {
              rest = Buffer.alloc(0)
              if (buf.length > pos) teile.push(buf.slice(pos))
            }
            this.push(Buffer.concat(teile))
            cb()
          },
          flush (cb) {
            if (rest.length) this.push(rest)
            cb()
          }
        })
      })()
      : null

    let fehler = ''
    let erledigt = false
    const scheitern = e => {
      if (erledigt) return
      erledigt = true
      try {
        p.kill()
        if (gz) gz.destroy()
        quelle.destroy()
      } catch (_) {}
      reject(e)
    }

    p.stderr.on('data', d => {
      fehler += d.toString()
      if (fehler.length > 8000) fehler = fehler.slice(-8000)
    })
    p.on('error', e => scheitern(new Error(`${path.basename(bin)}: ${e.message}`)))
    /*
     * Bricht mysql mitten im Strom ab (z. B. SQL-Fehler im Dump), schreibt
     * die Quelle sonst in eine geschlossene Pipe. Ein unbehandeltes EPIPE
     * beendet den ganzen Panel-Prozess. EPIPE wird deshalb geschluckt; der
     * close-Handler meldet gleich darauf den echten Fehler aus stderr.
     */
    p.stdin.on('error', e => {
      if (e.code === 'EPIPE') {
        try { quelle.destroy() } catch (_) {}
        return
      }
      scheitern(new Error(`${path.basename(bin)}: ${e.message}`))
    })
    if (umbenennStrom) umbenennStrom.on('error', scheitern)
    if (gz) {
      gz.on('error', scheitern)
      if (umbenennStrom) {
        quelle.pipe(gz).pipe(umbenennStrom).pipe(p.stdin)
      } else {
        quelle.pipe(gz).pipe(p.stdin)
      }
    } else if (umbenennStrom) {
      quelle.on('error', scheitern)
      quelle.pipe(umbenennStrom).pipe(p.stdin)
    } else {
      quelle.on('error', scheitern)
      quelle.pipe(p.stdin)
    }

    const timer = setTimeout(() => scheitern(new Error('Zeitüberschreitung beim Wiederherstellen.')), 30 * 60 * 1000)
    p.on('close', code => {
      clearTimeout(timer)
      if (erledigt) return
      erledigt = true
      if (code === 0) resolve()
      else reject(new Error(fehler.trim() || `${path.basename(bin)} endete mit Code ${code}.`))
    })
  })
}

/*
 * Ein einzelnes SQL-Skript in eine bestimmte Datenbank spielen (Modul-SQL).
 * Gleiche Rohr-Logik wie spieleEin, aber mit explizitem --database und ohne
 * Umbenennung - Moduldateien enthalten kein CREATE DATABASE.
 */
function spieleEinInDb (datei, ini, datenbank) {
  return new Promise((resolve, reject) => {
    const bin = toolName('mysql')
    let p
    try {
      p = spawn(bin, [
        `--defaults-extra-file=${ini}`,
        '--default-character-set=utf8mb4',
        `--database=${datenbank}`
      ], { windowsHide: true })
    } catch (e) {
      reject(new Error(`${bin} konnte nicht gestartet werden: ${e.message}`))
      return
    }

    const quelle = fs.createReadStream(datei)
    const gz = datei.toLowerCase().endsWith('.gz') ? zlib.createGunzip() : null
    let fehler = ''
    let erledigt = false
    const scheitern = e => {
      if (erledigt) return
      erledigt = true
      try {
        p.kill()
        if (gz) gz.destroy()
        quelle.destroy()
      } catch (_) {}
      reject(e)
    }

    p.stderr.on('data', d => {
      fehler += d.toString()
      if (fehler.length > 8000) fehler = fehler.slice(-8000)
    })
    p.on('error', e => scheitern(new Error(`${path.basename(bin)}: ${e.message}`)))
    // Siehe spieleEin: ohne diesen Handler beendet ein frueher mysql-Abbruch
    // den ganzen Panel-Prozess mit einem unbehandelten EPIPE.
    p.stdin.on('error', e => {
      if (e.code === 'EPIPE') {
        try { quelle.destroy() } catch (_) {}
        return
      }
      scheitern(new Error(`${path.basename(bin)}: ${e.message}`))
    })
    if (gz) {
      gz.on('error', scheitern)
      quelle.pipe(gz).pipe(p.stdin)
    } else {
      quelle.on('error', scheitern)
      quelle.pipe(p.stdin)
    }

    const timer = setTimeout(() => scheitern(new Error('Zeitüberschreitung beim Einspielen.')), 30 * 60 * 1000)
    p.on('close', code => {
      clearTimeout(timer)
      if (erledigt) return
      erledigt = true
      if (code === 0) resolve()
      else reject(new Error(fehler.trim() || `${path.basename(bin)} endete mit Code ${code}.`))
    })
  })
}

/*
 * Wiederherstellen. Lehnt ab, solange ein Server laeuft - ein Restore in den
 * laufenden Betrieb hinein ergibt eine Datenbank, die weder alt noch neu ist.
 *
 * Ohne "file" wird die komplette Sicherung zum Zeitpunkt "stamp" zurueckgespielt,
 * mit "file" nur diese eine Datenbank.
 */
async function restore ({ file, stamp, dbs } = {}) {
  const ziel = backupDir()
  const gruppen = gruppiereAlle()
  let dateien = []

  if (file) {
    const aufgeloest = path.resolve(file)
    if (path.dirname(aufgeloest) !== path.resolve(ziel)) {
      throw new Error('Die Datei liegt nicht im Backup-Ordner.')
    }
    if (!fs.existsSync(aufgeloest)) {
      throw new Error(`Die Sicherung wurde nicht gefunden: ${path.basename(aufgeloest)}`)
    }
    dateien = [aufgeloest]
  } else if (stamp) {
    const g = gruppen.find(x => x.stamp === stamp)
    if (!g) throw new Error(`Keine Sicherung zum Zeitpunkt ${stamp} gefunden.`)
    dateien = g.files.map(f => f.file)
  } else {
    throw new Error('Keine Sicherung angegeben.')
  }

  for (const d of dateien) {
    const stat = fs.statSync(d)
    if (stat.size === 0) throw new Error(`Die Sicherungsdatei ist leer: ${path.basename(d)}`)
  }

  /*
   * Solange ein Server laeuft, wird nicht wiederhergestellt. Die World- und
   * Character-Datenbank werden im laufenden Betrieb beschrieben - eine
   * Wiederherstellung hinein ergibt einen Stand, der weder der alte noch der
   * neue ist. Deshalb: laufende Server sauber beenden, zurueckspielen, und
   * die beendeten danach wieder anfahren.
   */
  const serverManager = require('../server-manager')
  const statusVorher = serverManager.status()
  const gestoppt = []
  for (const k of ['world', 'auth']) {
    if (statusVorher[k] && statusVorher[k].running) {
      melden({ phase: 'stop', meldung: `${k === 'world' ? 'Worldserver' : 'Authserver'} wird für die Wiederherstellung beendet …` })
      try { serverManager.stop(k) } catch (_) {}
      gestoppt.push(k)
    }
  }
  if (gestoppt.length) await new Promise(r => setTimeout(r, 5000))

  /*
   * Teil-Restore: nur die gewaehlten Datenbanken zurueckspielen (z. B. nur
   * acore_characters, wenn ein Charakter-Import schiefging). Ohne Angabe
   * kommen alle Dateien der Sicherung in die Datenbank.
   */
  const nurDbs = Array.isArray(dbs) && dbs.length ? dbs : null
  if (nurDbs) {
    const gefiltert = dateien.filter(d => {
      const name = path.basename(d)
      return nurDbs.some(n => name.includes(n))
    })
    if (!gefiltert.length) {
      throw new Error('In der gewählten Sicherung liegen keine Dateien für die Auswahl: ' + nurDbs.join(', '))
    }
    dateien = gefiltert
  }

  // Vorher automatisch sichern. Ohne diese Sicherung waere der alte Stand
  // endgueltig weg - deshalb bricht der Restore ab, wenn sie nicht klappt.
  melden({ phase: 'vorher', meldung: 'Vor dem Wiederherstellen wird der aktuelle Stand gesichert …' })
  const sicherung = await create()

  melden({ phase: 'restore', stamp: stamp || path.basename(dateien[0]), meldung: 'Wiederherstellen läuft …' })
  const ini = defaultsDatei()
  try {
    for (const d of dateien) {
      await spieleEin(d, ini)
    }
    // Pools koennen noch Daten aus der alten Fassung halten
    await db.closeAll()
    melden({ phase: 'fertig', stamp: stamp || path.basename(dateien[0]) })

    // Was vorher lief, laeuft wieder - der Worldserver soll seinen Stand
    // neu einlesen, nicht den alten Cache behalten.
    for (const k of gestoppt) {
      melden({ phase: 'restart', meldung: `${k === 'world' ? 'Worldserver' : 'Authserver'} wird wieder gestartet …` })
      try { await serverManager.start(k) } catch (_) {}
    }

    return {
      ok: true,
      restored: dateien.map(d => path.basename(d)),
      count: dateien.length,
      safety: sicherung.stamp,
      gestoppt
    }
  } finally {
    try {
      fs.unlinkSync(ini)
    } catch (_) {}
  }
}

/*
 * Wiederherstellungstest: die neueste Sicherung in Wegwerf-Datenbanken
 * spielen (Name um "_verify_tmp" erweitert), Tabellenzahl gegen das
 * Original vergleichen, Wegwerf-DBs loeschen. Ein Backup, das nie
 * zurueckgespielt wurde, ist ein Blatt Lot - so wird es zu einem Beweis.
 *
 * Laeuft mit angeschalteten Servern, denn die echten Datenbanken werden
 * nicht angefasst.
 */
/*
 * Zaehlt Zeilen einer Tabelle in einer beliebigen Datenbank. Fuer den
 * Sicherungsvergleich: derselbe Zaehler laeuft einmal gegen die
 * Wegwerf-Datenbank und einmal gegen den Live-Stand.
 */
async function zaehle (dbName, tabelle) {
  const name = String(dbName || '').replace(/`/g, '')
  const t = String(tabelle || '').replace(/`/g, '')
  if (!name || !t) return null
  try {
    const rows = await db.query('auth', `SELECT COUNT(*) AS c FROM \`${name}\`.\`${t}\``)
    return rows && rows.length ? Number(rows[0].c) : null
  } catch (_) {
    return null
  }
}

/*
 * Welche Tabellen sind fuer den Vergleich aussagekraeftig?
 * Konten, Charaktere/Items und Weltitems - kleine, stabile Tabellen, die
 * eine Sicherung gut charakterisieren. Fehlende Tabellen werden uebersprungen.
 */
function vergleichsTabellen (dbName) {
  const m = store.read().mysql || {}
  if (dbName === m.authDb) return ['account']
  if (dbName === m.charDb) return ['characters', 'item_instance']
  if (dbName === m.worldDb) return ['item_template']
  return []
}

async function verify ({ stamp } = {}) {
  const gruppen = gruppiereAlle().sort((a, b) => (a.created < b.created ? 1 : -1))
  if (!gruppen.length) throw new Error('Keine Sicherung zum Testen vorhanden.')
  /*
   * Ohne Stempel die neueste Sicherung; mit Stempel genau die - der
   * Rückhol-Anker der Migration ist oft älter als die neuesten
   * Auto-Sicherungen und wurde bisher nie geprüft.
   */
  const g = stamp ? gruppen.find(x => x.stamp === stamp) : gruppen[0]
  if (!g) throw new Error(`Keine Sicherung mit Stempel ${stamp} gefunden.`)

  melden({ phase: 'verify', stamp: g.stamp, meldung: `Teste die Sicherung ${g.stamp} in Wegwerf-Datenbanken …` })
  const ini = defaultsDatei()
  const details = []
  try {
    for (const f of g.files) {
      const von = f.db
      if (!von) continue
      const nach = `${von}_verify_tmp`
      try {
        await db.execute('auth', `DROP DATABASE IF EXISTS \`${nach}\``)
      } catch (_) {}
      melden({ phase: 'verify', meldung: `Prüfe ${von} …` })
      await spieleEin(f.file, ini, { von, nach })
      const [orig] = [await db.execute('auth', 'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ?', [von])]
      const [test] = [await db.execute('auth', 'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ?', [nach])]
      const origAnz = orig && orig.length ? Number(orig[0].c) : -1
      const testAnz = test && test.length ? Number(test[0].c) : -1
      /*
       * Inhaltlicher Vergleich, bevor die Wegwerf-Datenbank verschwindet:
       * Konten, Charaktere und Items. Eine Sicherung mit gleicher
       * Tabellenzahl, aber halb so vielen Charakteren, ist trotzdem falsch.
       */
      const vergleich = []
      for (const tabelle of vergleichsTabellen(von)) {
        const backupWert = await zaehle(nach, tabelle)
        const liveWert = await zaehle(von, tabelle)
        if (backupWert === null && liveWert === null) continue
        vergleich.push({ tabelle, backup: backupWert, live: liveWert })
      }
      try {
        await db.execute('auth', `DROP DATABASE IF EXISTS \`${nach}\``)
      } catch (_) {}
      details.push({ db: von, ok: testAnz > 0 && testAnz === origAnz, original: origAnz, test: testAnz, vergleich })
      melden({ phase: 'verify', meldung: `${von}: ${testAnz} Tabellen (Original: ${origAnz}) ${testAnz === origAnz && testAnz > 0 ? '✓' : '✗'}` })
    }
    const ok = details.length > 0 && details.every(d => d.ok)
    require('./notify').melde(ok ? 'Sicherungstest bestanden' : 'Sicherungstest FEHLGESCHLAGEN', `Sicherung ${g.stamp}: ${details.map(d => `${d.db} ${d.ok ? '✓' : '✗'}`).join(', ')}`)
    const eintrag = { stamp: g.stamp, ok, zeit: new Date().toISOString(), details }
    /*
     * Ergebnis je Sicherung merken, nicht nur "der letzte Test". So bleibt
     * sichtbar, welche aeltere Sicherung geprueft wurde - und welche noch
     * nie zurueckgespielt wurde.
     */
    const alteTests = (() => {
      try { return (store.read().backup || {}).tests || {} } catch (_) { return {} }
    })()
    // Nur Stempel behalten, die es noch gibt - sonst waechst das Objekt
    // mit jeder geloeschten Sicherung weiter.
    const vorhanden = new Set(gruppen.map(x => x.stamp))
    const tests = {}
    for (const [stamp, wert] of Object.entries({ ...alteTests, [g.stamp]: eintrag })) {
      if (vorhanden.has(stamp)) tests[stamp] = wert
    }
    store.write({
      backup: {
        letzterTest: eintrag,
        tests
      }
    })
    return { ok, stamp: g.stamp, details }
  } catch (e) {
    require('./notify').melde('Sicherungstest fehlgeschlagen', e.message)
    throw e
  } finally {
    try {
      fs.unlinkSync(ini)
    } catch (_) {}
  }
}

/*
 * Monatliche Verifikation: am 1. des Monats um 04:00 einmal laufen lassen,
 * wenn "backup.verify" aktiviert ist. Der Tag wird gemerkt, damit die
 * stuendliche Pruefung nicht mehrfach ausloest.
 */
let verifyTimer = null
let letzterVerifyMonat = ''

function verifyPlanStarten () {
  if (verifyTimer) {
    clearInterval(verifyTimer)
    verifyTimer = null
  }
  const plan = () => {
    try {
      return !!(store.read().backup || {}).verify
    } catch (_) {
      return false
    }
  }
  if (!plan()) return
  verifyTimer = setInterval(() => {
    if (!plan()) return
    const jetzt = new Date()
    const schluessel = `${jetzt.getFullYear()}-${jetzt.getMonth()}`
    if (jetzt.getDate() !== 1 || jetzt.getHours() !== 4) return
    if (letzterVerifyMonat === schluessel) return
    if (laeuftGerade) return
    letzterVerifyMonat = schluessel
    verify().catch(() => {})
  }, 60 * 60 * 1000)
  if (verifyTimer.unref) verifyTimer.unref()
}

function beschreiben (datei, extra = {}) {
  const stat = fs.statSync(datei)
  return {
    file: datei,
    name: path.basename(datei),
    dir: path.dirname(datei),
    size: stat.size,
    created: stat.mtime.toISOString(),
    ...extra
  }
}

/*
 * Alles im Backup-Ordner lesen, nach Zeitpunkt gruppiert.
 *
 * Der Gruppenname steckt im Dateinamen: alles zwischen PRAEFIX und TRENNER
 * ist der Zeitpunkt, danach der Datenbankname. Dateien aus einer aelteren
 * Fassung (ein einzelner Dump ohne TRENNER) bilden ihre eigene Gruppe -
 * sonst wuerden sie verschwinden.
 */
function gruppiereAlle () {
  const ordner = backupDir()
  if (!fs.existsSync(ordner)) return []

  const gruppen = new Map()
  let namen = []
  try {
    namen = fs.readdirSync(ordner)
  } catch (_) {
    return []
  }

  for (const name of namen) {
    const lower = name.toLowerCase()
    if (!lower.endsWith('.sql') && !lower.endsWith('.sql.gz')) continue
    if (!lower.startsWith(PRAEFIX)) continue

    const voll = path.join(ordner, name)
    let stat
    try {
      stat = fs.statSync(voll)
    } catch (_) {
      continue
    }

    const rest = name.slice(PRAEFIX.length)
    const trenner = rest.indexOf(TRENNER)
    const stamp = trenner === -1 ? rest.replace(/\.sql(\.gz)?$/i, '') : rest.slice(0, trenner)
    let dbName = null
    if (trenner !== -1) {
      dbName = rest.slice(trenner + TRENNER.length).replace(/\.sql(\.gz)?$/i, '')
    }

    if (!gruppen.has(stamp)) {
      gruppen.set(stamp, { stamp, files: [], size: 0, created: stat.mtime.toISOString() })
    }
    const g = gruppen.get(stamp)
    g.files.push({ name, file: voll, db: dbName, size: stat.size, created: stat.mtime.toISOString() })
    g.size += stat.size
    if (stat.mtime.toISOString() > g.created) g.created = stat.mtime.toISOString()
  }

  return [...gruppen.values()].sort((a, b) => b.stamp.localeCompare(a.stamp))
}

/*
 * Nur Dateien aus dem Backup-Ordner sind fuer die Oberflaeche sichtbar. So kann
 * sie keine fremden Dateien anbieten, und ein Abruf kann nichts ausserhalb
 * des Ordners erreichen.
 */
function list () {
  const gruppen = gruppiereAlle()
  /*
   * Pruefergebnisse je Sicherung. Aeltere Panel-Staende kennen nur
   * letzterTest - der wird fuer seinen Stempel uebernommen, damit die
   * Anzeige nach dem Update nicht leer ist.
   */
  const tests = (() => {
    try {
      const b = store.read().backup || {}
      const alle = { ...(b.tests || {}) }
      if (b.letzterTest && b.letzterTest.stamp) alle[b.letzterTest.stamp] = alle[b.letzterTest.stamp] || b.letzterTest
      return alle
    } catch (_) {
      return {}
    }
  })()
  for (const g of gruppen) g.test = tests[g.stamp] || null
  const einzel = gruppen.flatMap(g => g.files).sort((a, b) => b.created.localeCompare(a.created))
  return {
    ordner: backupDir(),
    sets: gruppen,
    files: einzel,
    tools: werkzeuge(),
    plan: plan(),
    verify: (() => {
      try {
        return !!(store.read().backup || {}).verify
      } catch (_) {
        return false
      }
    })()
  }
}

/*
 * Aufraeumen: behalte die juengsten "keep" Sicherungen, loesche den Rest.
 * Ohne diese Grenze waechst der Ordner um mehrere hundert MB pro Lauf.
 * Gibt die zurueckgeloeschten Namen zurueck, damit die Oberflaeche es zeigt.
 */
function aufraeumen (keepOverride) {
  const auto = store.read().backup?.auto || {}
  const behalten = Number.isInteger(keepOverride) ? keepOverride : int(auto.keep, 10)
  if (!behalten || behalten < 1) return []

  /*
   * Die Migrations-Sicherung bleibt unangetastet: sie ist der Anker für den
   * Rückhol-Knopf auf der Backup-Seite. Dasselbe gilt für die Sicherungen
   * aus dem Update-Verlauf (R28) - sonst zeigen deren Rollback-Knöpfe auf
   * gelöschte Dateien.
   */
  const geschuetzt = new Set()
  try {
    const cfg = store.read()
    const anker = String((cfg.migration || {}).backupStamp || '')
    if (anker) geschuetzt.add(anker)
    const verlauf = Array.isArray(cfg.updateHistory) ? cfg.updateHistory : []
    for (const e of verlauf) {
      if (e && e.sicherung) geschuetzt.add(String(e.sicherung))
    }
  } catch (_) {}
  const gruppen = gruppiereAlle()
  const weg = gruppen.slice(behalten).filter(g => !geschuetzt.has(g.stamp))
  const geloescht = []
  for (const g of weg) {
    for (const f of g.files) {
      try {
        fs.unlinkSync(f.file)
        geloescht.push(f.name)
      } catch (_) {}
    }
  }
  return geloescht
}

// Eine Sicherung samt aller ihrer Dateien loeschen
function remove ({ stamp, file } = {}) {
  const ordner = path.resolve(backupDir())
  let treffer = []
  if (stamp) {
    treffer = gruppiereAlle().filter(g => g.stamp === stamp).flatMap(g => g.files)
    if (!treffer.length) throw new Error(`Keine Sicherung zum Zeitpunkt ${stamp} gefunden.`)
  } else if (file) {
    const voll = path.resolve(file)
    if (path.dirname(voll) !== ordner) throw new Error('Die Datei liegt nicht im Backup-Ordner.')
    if (!fs.existsSync(voll)) throw new Error('Die Datei wurde nicht gefunden.')
    treffer = [{ file: voll, name: path.basename(voll) }]
  } else {
    throw new Error('Keine Sicherung angegeben.')
  }
  for (const f of treffer) fs.unlinkSync(f.file)
  return { ok: true, removed: treffer.map(f => f.name) }
}

// Ordner im Explorer oeffnen
function ordnerOeffnen () {
  const ziel = backupDir()
  fs.mkdirSync(ziel, { recursive: true })
  return { ok: true, ordner: ziel }
}

/*
 * Vollstaendigkeit: sind die drei Datenbanken wirklich erreichbar und haben
 * sie ueberhaupt Tabellen? Eine leere Datenbank sichern ist zwar erlaubt,
 * man sollte aber wissen, dass es nichts zu sichern gab.
 */
async function status () {
  const dbs = datenbanken()
  const einzel = []
  for (const [art, name] of [['auth', dbs[0]], ['chars', dbs[1]], ['world', dbs[2]], ['bots', dbs[3]]]) {
    if (!name) continue
    const t = await db.test(art)
    let tables = null
    if (t.ok) {
      try {
        const r = await db.query(
          art,
          'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
          [name]
        )
        tables = Number(r[0] ? r[0].n : 0)
      } catch (_) {
        tables = null
      }
    }
    einzel.push({ art, name, ok: t.ok, error: t.ok ? null : t.error, tables })
  }
  const gruppen = gruppiereAlle()
  return {
    ordner: backupDir(),
    databases: einzel,
    reachable: einzel.every(e => e.ok),
    tools: werkzeuge(),
    plan: plan(),
    belegt: gruppen.reduce((a, g) => a + g.size, 0),
    anzahl: gruppen.length,
    /*
     * Wann wurde zuletzt gesichert?
     *
     * Auf der Backup-Seite stand der Zeitplan - aber nicht die Tatsache,
     * dass seit dem letzten Start nie ein Backup gelaufen ist. Wer sich
     * auf eine Sicherung verlaesst, sieht eine konfigurierte Seite und
     * sonst nichts.
     */
    letzte: letzteSicherung(gruppen),
    // Letzter Wiederherstellungstest + Schalter fuer den Monatsplan
    letzterTest: (() => {
      try {
        return (store.read().backup || {}).letzterTest || null
      } catch (_) {
        return null
      }
    })(),
    verify: (() => {
      try {
        return !!(store.read().backup || {}).verify
      } catch (_) {
        return false
      }
    })(),
    // Zweites Sicherungsziel
    mirror: spiegelEinstellungen(),
    mirrorStatus: spiegelStatus()
  }
}

/*
 * Die jüngste Sicherung aus den vorhandenen Gruppen.
 *
 * Der Zeitstempel steckt im Dateinamen (wowpanel_2026-10-14_15_30_00__...).
 * Er wird aus der Gruppe gelesen, nicht aus der Dateizeit - die Datei
 * kann später angefasst worden sein, ohne dass es eine neue Sicherung
 * war.
 */
function letzteSicherung (gruppen) {
  if (!gruppen.length) return null
  // Die Gruppen sind nach Namen sortiert; der Stempel steckt darin.
  let bester = null
  for (const g of gruppen) {
    const stamp = g.stamp || (g.name || '').slice(PRAEFIX.length)
    if (!stamp) continue
    if (!bester || stamp > bester.stamp) bester = { stamp, gruppe: g }
  }
  if (!bester) return null
  // "2026-10-14_15_30_00" -> lesbar
  const m = /^(\d{4})-(\d{2})-(\d{2})[_-](\d{2})[_-](\d{2})/.exec(bester.stamp)
  const zeitpunkt = m
    ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`
    : bester.stamp
  return {
    zeitpunkt,
    stamp: bester.stamp,
    groesse: bester.gruppe.size,
    anzahl: bester.gruppe.anzahl
  }
}

// -------------------------------------------------------- Zeitplan

let timer = null
let laeuftGerade = false

/*
 * Einstellungen des Zeitplans, fertig aufbereitet fuer die Oberflaeche.
 */
function plan () {
  const auto = store.read().backup?.auto || {}
  const stunden = int(auto.intervalHours, 0)
  const aktiv = Boolean(auto.enabled) && stunden > 0
  return {
    enabled: Boolean(auto.enabled),
    intervalHours: stunden,
    keep: Math.max(1, int(auto.keep, 10)),
    compress: auto.compress !== false,
    active: aktiv,
    running: laeuftGerade,
    // Beim Start erst nach einer vollen Periode sichern, nicht sofort -
    // sonst legt jeder Panel-Start ungefragt eine Sicherung an.
    naechster: aktiv && timer ? new Date(timer._idleTimeout + Date.now()).toISOString() : null
  }
}

/*
 * Den Zeitplan neu einstellen. Wird bei jedem Aendern der Einstellungen und
 * beim Start des Panels aufgerufen.
 */
function planStarten () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Verifikations-Planer mit anwerfen (auch, wenn die Sicherung selbst
  // aus ist - ein Test ohne Backup-Plan ist trotzdem sinnvoll).
  try { verifyPlanStarten() } catch (_) {}
  const p = plan()
  if (!p.active) return { ok: true, active: false }

  const ms = Math.max(1, p.intervalHours) * 60 * 60 * 1000
  timer = setInterval(() => {
    automatischSichern()
  }, ms)
  if (timer.unref) timer.unref()
  return { ok: true, active: true, intervalHours: p.intervalHours }
}

function planStoppen () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/*
 * Eine Sicherung im Hintergrund. Ein Fehler wird gemeldet, aber nicht
 * geworfen: ein fehlgeschlagener Hintergrundlauf darf das Panel nicht
 * beeintraechtigen, und erst recht nicht den Aufrufenden.
 */
async function automatischSichern () {
  if (laeuftGerade) return { ok: false, uebersprungen: true }
  laeuftGerade = true
  melden({ phase: 'auto', meldung: 'Automatische Sicherung läuft …' })
  try {
    const r = await create()
    const weg = r.removed || []
    melden({
      phase: 'auto-fertig',
      stamp: r.stamp,
      meldung: weg.length
        ? `Automatische Sicherung fertig (${mb(r.size)}), ${weg.length} alte Datei(en) entfernt.`
        : `Automatische Sicherung fertig (${mb(r.size)}).`
    })
    require('./notify').melde('Automatische Sicherung fertig', `${mb(r.size)} gesichert (${r.stamp}).`)
    return { ok: true, size: r.size, stamp: r.stamp, removed: weg }
  } catch (e) {
    melden({ phase: 'auto-fehler', meldung: `Automatische Sicherung fehlgeschlagen: ${e.message}` })
    require('./notify').melde('Automatische Sicherung fehlgeschlagen', e.message)
    return { ok: false, error: e.message }
  } finally {
    laeuftGerade = false
  }
}

// Einstellungen setzen und den Zeitplan sofort anpassen
/*
 * Zweites Sicherungsziel: eine Kopie auf eine andere Platte/NAS. Die
 * Sicherung selbst gilt auch dann als erfolgreich, wenn die Kopie
 * scheitert - aber der Fehler wird gemeldet und gespeichert.
 */
function spiegelEinstellungen () {
  const b = store.read().backup || {}
  const m = b.mirror || {}
  return { dir: String(m.dir || '').trim(), keep: Math.max(1, int(m.keep, 5)) }
}

function spiegelStatus () {
  try {
    return (store.read().backup || {}).mirrorStatus || null
  } catch (_) {
    return null
  }
}

async function spiegele (dateien, stamp) {
  const m = spiegelEinstellungen()
  if (!m.dir) return { ok: true, uebersprungen: true }
  try {
    await fsp.mkdir(m.dir, { recursive: true })
    for (const d of dateien) {
      await fsp.copyFile(d.file, path.join(m.dir, path.basename(d.file)))
    }
    /*
     * Aufbewahrung im Spiegel: nur ganze Sicherungsgruppen zaehlen. Die
     * Migrations- und Update-Anker bleiben erhalten - sonst zeigt ein
     * Rollback-Knopf auf eine Kopie, die gerade aufgeraeumt wurde.
     */
    const geschuetzt = new Set()
    try {
      const cfg = store.read()
      if (cfg.migration && cfg.migration.backupStamp) geschuetzt.add(String(cfg.migration.backupStamp))
      for (const e of Array.isArray(cfg.updateHistory) ? cfg.updateHistory : []) {
        if (e && e.sicherung) geschuetzt.add(String(e.sicherung))
      }
    } catch (_) {}
    let namen = []
    try { namen = await fsp.readdir(m.dir) } catch (_) {}
    const gruppen = new Map()
    for (const name of namen) {
      if (!/^wowpanel_.*\.sql(\.gz)?$/i.test(name)) continue
      const rest = name.slice(PRAEFIX.length)
      const trenner = rest.indexOf(TRENNER)
      const st = trenner === -1 ? rest.replace(/\.sql(\.gz)?$/i, '') : rest.slice(0, trenner)
      if (!gruppen.has(st)) gruppen.set(st, [])
      gruppen.get(st).push(name)
    }
    const sortiert = [...gruppen.keys()].sort().reverse()
    let entfernt = 0
    for (const st of sortiert.slice(m.keep)) {
      if (geschuetzt.has(st)) continue
      for (const name of gruppen.get(st)) {
        try {
          await fsp.unlink(path.join(m.dir, name))
          entfernt++
        } catch (_) {}
      }
    }
    const status = {
      zeit: new Date().toISOString(),
      ok: true,
      dir: m.dir,
      stamp,
      dateien: dateien.length,
      entfernt,
      fehler: ''
    }
    try { store.write({ backup: { mirrorStatus: status } }) } catch (_) {}
    return status
  } catch (e) {
    const status = {
      zeit: new Date().toISOString(),
      ok: false,
      dir: m.dir,
      stamp,
      dateien: 0,
      entfernt: 0,
      fehler: e.message,
      error: e.message
    }
    try { store.write({ backup: { mirrorStatus: status } }) } catch (_) {}
    try {
      require('./notify').melde('Zweites Sicherungsziel fehlgeschlagen', e.message)
    } catch (_) {}
    return { ok: false, ...status }
  }
}

function spiegelSetzen (patch = {}) {
  const alt = spiegelEinstellungen()
  let dir = patch.dir != null ? String(patch.dir || '').trim() : alt.dir
  const keep = Math.min(99, Math.max(1, Number(patch.keep) || alt.keep))
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      throw new Error(`Zweites Ziel nicht nutzbar: ${e.message}`)
    }
  }
  dir = dir || ''
  store.write({ backup: { mirror: { dir, keep } } })
  return { ok: true, ...spiegelEinstellungen() }
}

async function einstellungenSetzen (patch = {}) {
  // "verify" gehoert zur Backup-Ebene, nicht in "auto" - der Schalter fuer
  // den monatlichen Wiederherstellungstest kommt hier an.
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'verify')) {
    store.write({ backup: { verify: patch.verify === true } })
    try { verifyPlanStarten() } catch (_) {}
    return { ok: true, verify: patch.verify === true }
  }
  // Sicherungsordner (z. B. zweite Platte). Leer = Standardordner.
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'dir')) {
    const dir = String(patch.dir || '').trim()
    if (dir) {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch (e) {
        throw new Error(`Ordner nicht nutzbar: ${e.message}`)
      }
    }
    store.write({ backup: { dir } })
    return { ok: true, dir: backupDir() }
  }
  store.write({ backup: { auto: patch } })
  const p = planStarten()
  return { ok: true, plan: plan(), started: p }
}

module.exports = {
  init,
  create,
  restore,
  list,
  remove,
  status,
  ordnerOeffnen,
  backupDir,
  werkzeuge,
  aufraeumen,
  plan,
  planStarten,
  planStoppen,
  automatischSichern,
  verify,
  verifyPlanStarten,
  spiegelSetzen,
  // Fuer den Uebernahme-Werkzeug: Dump in die eigene Datenbank spielen
  spieleEin,
  // Fuer Modul-SQL: eine Datei in eine bestimmte Datenbank spielen
  spieleEinInDb,
  defaultsDatei,
  einstellungenSetzen,
  // Fuer Pruefskripte: Kopie und Aufbewahrung ohne echten Dump testen
  __intern: { spiegele, spiegelEinstellungen, spiegelStatus }
}
