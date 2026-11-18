import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import Modal from '../components/Modal'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { formatBytes, formatDateTime, formatNumber } from '../lib/constants'

// Ein Satz, wie lange "vorher" ist, aus einem ISO-Zeitpunkt
function zeitpunkt (iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatDateTime(Math.floor(d.getTime() / 1000))
}

// Der Zeitstempel ist Teil des Dateinamens: 2026-10-14_22_25_37
// Fuer die Anzeige lesbar machen - "22 25 37" sieht nach einem Fehler aus.
function stampText (stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})_(\d{2})$/.exec(stamp || '')
  if (!m) return stamp || '—'
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${m[3]}.${m[2]}.${m[1]}, ${p(m[4])}:${p(m[5])}:${p(m[6])}`
}

function Backup () {
  const { toast, status } = useStatus()
  const { t } = useI18n()

  const [statusDaten, setStatusDaten] = useState(null)
  const [liste, setListe] = useState({ ordner: '', sets: [], files: [], plan: null })
  const [laeuft, setLaeuft] = useState(false)
  const [meldung, setMeldung] = useState('')
  // Live-Fortschritt der Übernahme (Prozent + letzte Protokollzeile)
  const [migrationFortschritt, setMigrationFortschritt] = useState(null)
  // Aktueller Sicherungsordner (änderbar, z. B. zweite Platte)
  const [backupOrdner, setBackupOrdner] = useState('')
  // Update-Sicherungen aus dem Verlauf (Rollback auf "vor dem Update")
  const [updateSicherungen, setUpdateSicherungen] = useState([])
  // Datenbankgrößen für den Wiederherstellungs-Dialog
  const [dbGroessen, setDbGroessen] = useState(null)
  const [frage, setFrage] = useState(null)
  // Drei Ansichten statt einer langen Seite.
  const [reiter, setReiter] = useState(() => {
    try { return localStorage.getItem('backup.tab') || 'sichern' } catch (_) { return 'sichern' }
  })
  const reiterWechseln = r => {
    setReiter(r)
    try { localStorage.setItem('backup.tab', r) } catch (_) {}
  }
  const [plan, setPlan] = useState({
    enabled: false,
    intervalHours: 6,
    keep: 10,
    compress: true
  })
  // Zweites Sicherungsziel (andere Platte/NAS)
  const [mirror, setMirror] = useState({ dir: '', keep: 5 })
  const [mirrorStatus, setMirrorStatus] = useState(null)

  const laden = async () => {
    try {
      const [s, l] = await Promise.all([api.backup.status(), api.backup.list()])
      setStatusDaten(s)
      setListe(l)
      setBackupOrdner(l.ordner || '')
      if (s && s.mirror) setMirror({ dir: s.mirror.dir || '', keep: s.mirror.keep || 5 })
      setMirrorStatus((s && s.mirrorStatus) || null)
      if (l.plan) {
        setPlan({
          enabled: Boolean(l.plan.enabled),
          intervalHours: l.plan.intervalHours || 6,
          keep: l.plan.keep || 10,
          compress: l.plan.compress !== false
        })
      }
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  useEffect(() => {
    laden()
    // Rückhol-Anker nachziehen: soll auch nach Seitenwechsel sichtbar bleiben
    api.installer.fremdRueckholInfo()
      .then(r => { if (r && r.ok) setRueckhol(r) })
      .catch(() => {})
    // Zuletzt gewählten Fremd-Ordner vorbefüllen
    api.installer.fremdLetzterOrdner()
      .then(r => { if (r && r.ordner) setFremdOrdner(alt => alt || r.ordner) })
      .catch(() => {})
    // Gemerktes Übernahme-Ergebnis (überlebt den Panel-Neustart)
    api.installer.fremdErgebnis()
      .then(r => { if (r && r.ok && r.ergebnis) setFremdErgebnis(r.ergebnis) })
      .catch(() => {})
    // Sicherungen, die vor Update-Läufen gezogen wurden (Rollback im Verlauf)
    api.installer.updateVerlauf()
      .then(r => setUpdateSicherungen((r.verlauf || []).filter(e => e.sicherung)))
      .catch(() => {})
    // Datenbankgrößen für den Restore-Dialog
    api.system.dbGroessen()
      .then(r => { if (r && r.ok) setDbGroessen(r.groessen) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const ab = api.on('backup:progress', p => {
      if (p && p.meldung) setMeldung(p.meldung)
      if (p && ['fertig', 'auto-fertig', 'auto-fehler'].includes(p.phase)) setMeldung('')
      if (p && (p.phase === 'fertig' || p.phase === 'auto-fertig')) laden()
    })
    return () => (typeof ab === 'function' ? ab() : undefined)
  }, [])

  /*
   * Die Übernahme läuft über den Installer-Lauf und meldet dort Status
   * (Prozent) und Log-Zeilen — die Backup-Seite zeigte bisher nur den
   * statischen Text "Import läuft". Mit diesem Abo sieht man den echten
   * Fortschritt, auch wenn die Seite die ganze Zeit offen bleibt.
   */
  useEffect(() => {
    const ab = api.on('installer:progress', ev => {
      if (!ev) return
      if (ev.type === 'status' && ev.status && ev.status.running) {
        setMigrationFortschritt(f => ({ percent: ev.status.percent || 0, zeile: (f && f.zeile) || '' }))
      }
      if (ev.type === 'log' && ev.line) {
        setMigrationFortschritt(f => ({ percent: (f && f.percent) || 0, zeile: ev.line }))
      }
      if (ev.type === 'done' || ev.type === 'error') setMigrationFortschritt(null)
    })
    return () => (typeof ab === 'function' ? ab() : undefined)
  }, [])

  const sichern = async () => {
    setLaeuft(true)
    setMeldung(t('backup.running'))
    try {
      const r = await api.backup.create()
      let msg = t('backup.done', { name: r.stamp })
      if (r.compressed) msg += ` · ${formatBytes(r.size)}`
      if (r.removed && r.removed.length) msg += ' · ' + t('backup.pruned', { count: r.removed.length })
      toast(msg, r.hinweis ? 'warn' : 'ok')
      if (r.hinweis) toast(r.hinweis, 'warn')
      setMeldung('')
      laden()
    } catch (e) {
      setMeldung('')
      toast(e.message, 'err')
    } finally {
      setLaeuft(false)
    }
  }

  const wiederherstellen = async arg => {
    setFrage(null)
    setLaeuft(true)
    setMeldung(t('backup.restoring'))
    try {
      const r = await api.backup.restore(arg)
      toast(
        r.count > 1
          ? t('backup.restoredAll', { count: r.count, stamp: r.safety })
          : t('backup.restored', { name: r.restored[0], sicherung: r.safety }),
        'ok'
      )
      setMeldung('')
      laden()
    } catch (e) {
      setMeldung('')
      toast(e.message, 'err')
    } finally {
      setLaeuft(false)
    }
  }

  const loeschen = async stamp => {
    setFrage(null)
    try {
      const r = await api.backup.remove({ stamp })
      toast(t('backup.deleted', { name: t(r.removed.length === 1 ? 'backup.dbFile' : 'backup.dbFiles', { count: r.removed.length }) }), 'ok')
      laden()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const ordner = async () => {
    try {
      const r = await api.backup.openFolder()
      toast(t('backup.folderReady', { ordner: r.ordner }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const planSpeichern = async () => {
    try {
      const r = await api.backup.saveSettings({ auto: plan })
      setListe(l => ({ ...l, plan: r.plan }))
      toast(t('backup.autoSaved'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const mirrorSpeichern = async () => {
    try {
      const r = await api.backup.spiegelSetzen(mirror)
      setMirror({ dir: r.dir || '', keep: r.keep || 5 })
      toast(t('backup.mirrorSaved'), 'ok')
      laden()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const jetztAusloesen = async () => {
    setLaeuft(true)
    setMeldung(t('backup.running'))
    try {
      const r = await api.backup.runNow()
      if (r.ok) toast(t('backup.autoDone', { size: formatBytes(r.size) }), 'ok')
      else toast(r.error || t('backup.autoStatusOff'), 'err')
      setMeldung('')
      laden()
    } catch (e) {
      setMeldung('')
      toast(e.message, 'err')
    } finally {
      setLaeuft(false)
    }
  }

  const serverLaeuft = Boolean(status.world?.running || status.auth?.running)
  const wz = statusDaten?.tools
  const anzSicherungen = liste.sets.length
  const belegt = statusDaten?.belegt ?? 0
  // Aelteste Sicherung, die noch nie geprueft wurde - der Fall, der bei
  // einer langen Kette am ehesten weh tut.
  const aeltesteOhneTest = liste.sets.length
    ? [...liste.sets].reverse().find(s => !s.test)
    : null

  /*
   * Sicherungsvergleich fuer die Rueckfrage: Alter der Sicherung und - wenn
   * ein Test vorliegt - Konten/Charaktere/Items gegenueber dem Live-Stand.
   * Eine deutlich kleinere Charakterzahl ist ein Warnsignal.
   */
  const frageSet = frage && frage.art !== 'remove'
    ? (frage.art === 'restoreAll'
        ? liste.sets.find(s => s.stamp === frage.stamp)
        : liste.sets.find(s => s.files.some(f => f.file === frage.file)))
    : null
  const frageTest = frageSet ? frageSet.test : null
  const frageAlterTage = frageSet
    ? Math.floor((Date.now() - new Date(frageSet.created).getTime()) / 86400000)
    : null
  const vergleichWarnung = (() => {
    if (!frageSet) return false
    if (frageAlterTage > 7) return true
    const v = (frageTest && frageTest.vergleich) || []
    return v.some(x => x.tabelle === 'characters' && x.backup != null && x.live != null && x.backup < x.live * 0.9)
  })()

  /*
   * Datenbankgroessen + Wiederherstellungstest. Beides beantwortet die
   * Frage "kann ich mich auf die Sicherung verlassen?", bevor es drauf
   * ankommt.
   */
  const [groessen, setGroessen] = useState(null)
  const [verifyLaeuft, setVerifyLaeuft] = useState(false)
  const [verifyMeldung, setVerifyMeldung] = useState('')

  useEffect(() => {
    api.backup.groessen().then(r => {
      if (r && r.ok) setGroessen(r.groessen)
    }).catch(() => {})
  }, [])

  const sicherungTesten = async stamp => {
    setVerifyLaeuft(true)
    setVerifyMeldung(t('backup.verifyLaeuft'))
    try {
      const r = await api.backup.verify(stamp ? { stamp } : undefined)
      setVerifyMeldung(t('backup.verifyOk', { stamp: r.stamp, details: r.details.map(d => `${d.db} ${d.ok ? '✓' : '✗'}`).join(', ') }))
      laden()
    } catch (e) {
      setVerifyMeldung('')
      toast(e.message, 'err')
    } finally {
      setVerifyLaeuft(false)
    }
  }

  const verifizierungSchalten = async checked => {
    try {
      await api.backup.saveSettings({ verify: checked })
      laden()
      toast(checked ? t('backup.verifyAn') : t('backup.verifyAus'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /*
   * Vom alten Server übernehmen: eigene MySQL des fremden Server-Ordners
   * kurz auf freiem Port starten (nur lesend), acore_characters sichern
   * und in die eigene Datenbank spielen. Der alte Server wird nicht
   * verändert; vorher läuft eine Sicherheitssicherung des Ziels.
   */
  const [fremdOrdner, setFremdOrdner] = useState('')
  // Abweichendes Datenverzeichnis des alten Servers (my.ini: datadir=)
  const [fremdDatadir, setFremdDatadir] = useState('')
  const [fremdBestaetigt, setFremdBestaetigt] = useState(false)
  const [fremdKonten, setFremdKonten] = useState(true)
  const [fremdBotsDb, setFremdBotsDb] = useState(true)
  const [fremdPlayerbotsConf, setFremdPlayerbotsConf] = useState(true)
  const [fremdWorldConf, setFremdWorldConf] = useState(true)
  // Weltdatenbank: Standard AUS - sie ersetzt die offizielle Welt-DB komplett
  const [fremdWorldDb, setFremdWorldDb] = useState(false)
  // Echte Spieler beim Öffnen der Bestätigung (Warnung + Ansage im Spiel)
  const [fremdOnline, setFremdOnline] = useState(null)
  // Vorab-Zählung: Zahlen anzeigen, BEVOR bestätigt wird
  const [fremdZaehlung, setFremdZaehlung] = useState(null)
  const [fremdZaehlt, setFremdZaehlt] = useState(false)
  /*
   * Rückhol-Anker: Stempel der Sicherheitssicherung, die VOR der letzten
   * Übernahme gezogen wurde. Solange er gesetzt ist, bietet die Karte den
   * markierten Rückhol-Knopf an (persistiert, überlebt Seitenwechsel).
   */
  const [rueckhol, setRueckhol] = useState(null)
  // Ergebnis-Karte der letzten Übernahme in dieser Sitzung
  const [fremdErgebnis, setFremdErgebnis] = useState(null)

  const fremdOrdnerWaehlen = async () => {
    try {
      const p = await api.system.pickFolder({ title: t('backup.fremdOrdnerTitel') })
      if (p) {
        setFremdOrdner(p)
        setFremdBestaetigt(false)
        setFremdZaehlung(null)
      }
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const fremdDatadirWaehlen = async () => {
    try {
      const p = await api.system.pickFolder({ title: t('backup.fremdDatadirTitel') })
      if (p) {
        setFremdDatadir(p)
        setFremdZaehlung(null)
      }
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const fremdZaehlen = async () => {
    setFremdZaehlt(true)
    setFremdZaehlung(null)
    try {
      const r = await api.installer.fremdDbZaehlen({ mysqldOrdner: fremdOrdner, datadir: fremdDatadir || undefined })
      setFremdZaehlung(r)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setFremdZaehlt(false)
    }
  }

  const fremdUebernehmen = async () => {
    setLaeuft(true)
    setMeldung(t('backup.fremdLaeuft'))
    try {
      const r = await api.installer.fremdDb({
        mysqldOrdner: fremdOrdner,
        datadir: fremdDatadir || undefined,
        konten: fremdKonten,
        botDb: fremdBotsDb,
        playerbotsConf: fremdPlayerbotsConf,
        worldConf: fremdWorldConf,
        worldDb: fremdWorldDb
      })
      const vergleich = r.charaktere >= 0 && r.zielCharaktere != null
        ? t('backup.fremdVergleich', { quelle: r.charaktere, ziel: r.zielCharaktere })
        : ''
      toast(t('backup.fremdFertig', { db: r.db, ziel: r.ziel, mb: (r.groesse / 1024 / 1024).toFixed(1) }) + ' ' + vergleich, 'ok')
      // Ergebnis-Karte statt nur Toast - und der Rückhol-Anker ist frisch
      setFremdErgebnis(r)
      api.installer.fremdRueckholInfo().then(z => { if (z && z.ok) setRueckhol(z) }).catch(() => {})
      setMeldung('')
      laden()
    } catch (e) {
      setMeldung('')
      toast(e.message, 'err')
    } finally {
      setLaeuft(false)
      setFremdBestaetigt(false)
    }
  }

  /*
   * Auf den Stand vor der letzten Übernahme zurücksetzen: dieselbe
   * Wiederherstellungs-Routine wie bei den Sicherungen, danach den Anker
   * verwerfen, damit der Knopf verschwindet.
   */
  const rueckholStarten = async () => {
    if (!rueckhol || laeuft) return
    await wiederherstellen({ stamp: rueckhol.stamp })
    try { await api.installer.fremdRueckholVerwerfen() } catch (_) {}
    setRueckhol(null)
    setFremdErgebnis(null)
  }

  /*
   * Anker-Sicherung testen: der Wiederherstellungstest spielt die
   * Sicherung in Wegwerf-Datenbanken - bisher nur die NEUESTE, der Anker
   * ist oft älter. Hier gezielt der Anker-Stempel.
   */
  const [pruefLaeuft, setPruefLaeuft] = useState(false)
  const rueckholPruefen = async () => {
    if (!rueckhol || pruefLaeuft) return
    setPruefLaeuft(true)
    try {
      const r = await api.backup.verify({ stamp: rueckhol.stamp })
      const details = (r.details || []).map(d => `${d.db} ${d.ok ? '✓' : '✗'}`).join(', ')
      toast(t('backup.rueckholPruefungOk', { stamp: r.stamp, details }), r.ok ? 'ok' : 'warn')
      laden()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setPruefLaeuft(false)
    }
  }

  // Eine bestimmte Sicherung testen (nicht nur die neueste oder den Anker)

  /*
   * Der Anker ist nur wert, was seine Dateien gelten: hat das Aufräumen
   * die gemerkte Migrations-Sicherung bereits gelöscht, zeigt der Knopf
   * sonst auf nichts. Dann steht statt des Knopfes ein Hinweis.
   */
  const rueckholDa = rueckhol
    ? ((liste && liste.sets) || []).some(s => s.stamp === rueckhol.stamp)
    : false

  // Für die Update-Sicherungen: existieren die Stempel noch im Ordner?
  const vorhandeneStamps = new Set(((liste && liste.sets) || []).map(s => s.stamp))

  return (
    <>
      <div className="tabs">
        {[
          { key: 'sichern', label: t('backup.tabBackup') },
          { key: 'wiederherstellen', label: t('backup.tabRestore') },
          { key: 'uebernahme', label: t('backup.tabImport') }
        ].map(r => (
          <button
            key={r.key}
            className={`tab ${reiter === r.key ? 'active' : ''}`}
            onClick={() => reiterWechseln(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid cols-3">
        <div className="stat">
          <div className="label">{t('backup.statBackups')}</div>
          <div className={`value ${anzSicherungen ? 'green' : 'gold'}`}>
            {formatNumber(anzSicherungen)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {anzSicherungen
              ? t('backup.newest', { date: zeitpunkt(liste.sets[0].created) })
              : t('backup.none')}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('backup.statDbs')}</div>
          <div className={`value ${statusDaten?.reachable ? 'green' : 'gold'}`} style={{ fontSize: 20 }}>
            {statusDaten?.reachable ? t('backup.reachable') : t('backup.unreachable')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {(statusDaten?.databases || []).map(d => d.name).join(' · ') || '—'}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('backup.statTools')}</div>
          <div className={`value ${wz?.dumpLokal && wz?.clientLokal ? 'green' : 'gold'}`} style={{ fontSize: 20 }}>
            {wz?.dumpLokal && wz?.clientLokal ? t('backup.toolsOk') : t('backup.toolsPath')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {wz?.dir || t('backup.toolsPathHint')}
          </div>
        </div>
      </div>

      {/*
       * Die Tatsache, nicht nur die Konfiguration.
       *
       * Bisher stand hier der Zeitplan - aber nicht, dass seit dem
       * letzten Start nie ein Backup gelaufen ist. Wer sich auf eine
       * Sicherung verlaesst, sah eine konfigurierte Seite und sonst
       * nichts. Genau diese Luege muss weg.
       */}
      {!anzSicherungen ? (
        <div className="error-box mb0" style={{ marginBottom: 12 }}>
          {t('backup.neverRun')}
          {!plan.enabled ? (
            <div style={{ marginTop: 6 }}>{t('backup.neverRunAutoOff')}</div>
          ) : null}
        </div>
      ) : statusDaten?.letzte ? (
        <div className="info-box mb0" style={{ marginBottom: 12 }}>
          {t('backup.lastRun', { when: statusDaten.letzte.zeitpunkt })}
          {statusDaten?.letzterTest ? (
            <span style={{ marginLeft: 10 }}>
              {statusDaten.letzterTest.ok ? '✓' : '✗'} {t('backup.verifyLetzte', { when: new Date(statusDaten.letzterTest.zeit).toLocaleString() })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/*
        * Der Pruefstatus je Sicherung. Die monatliche Pruefung lief bisher
        * nur fuer die neueste; aeltere Sicherungen konnten unbemerkt
        * ungetestet bleiben. Hier steht die aelteste ungepruefte Karte.
        */}
      {anzSicherungen && aeltesteOhneTest && !verifyLaeuft ? (
        <div className="warn-box mb0" style={{ marginBottom: 12 }}>
          <span>{t('backup.verifyOldestHint', { stamp: aeltesteOhneTest.stamp })}</span>
          <button
            className="btn sm"
            style={{ marginLeft: 10 }}
            onClick={() => sicherungTesten(aeltesteOhneTest.stamp)}
          >
            {t('backup.verifyOne')}
          </button>
        </div>
      ) : null}

      {/*
        * Datenbankgroessen: worauf zeigt die Sicherung eigentlich?
        * characters ist fast immer die groesste Tabelle - so sieht man,
        * wie der Speicher sich fuellt, ohne SQL abzusetzen.
        */}
      {groessen && groessen.length ? (
        <div className="card" style={{ marginBottom: 12 }} hidden={reiter !== 'wiederherstellen'}>
          <div className="card-head">
            <h3>{t('backup.groessenTitle')}</h3>
          </div>
          <div className="card-body">
            <table>
              <tbody>
                {groessen.map(g => (
                  <tr key={g.name}>
                    <td className="mono">{g.name}</td>
                    <td style={{ textAlign: 'right' }}>{g.mb} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inline mt" style={{ alignItems: 'center' }}>
              <button className="btn" onClick={sicherungTesten} disabled={verifyLaeuft || !anzSicherungen}>
                {verifyLaeuft ? t('backup.verifyLaeuft') : t('backup.verifyJetzt')}
              </button>
              <label className="check-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={!!statusDaten?.verify}
                  onChange={e => verifizierungSchalten(e.target.checked)}
                />
                <span>{t('backup.verifyMonat')}</span>
              </label>
            </div>
            <div className="hint">{t('backup.verifyHint')}</div>
            {verifyMeldung ? <div className="info-box mt">{verifyMeldung}</div> : null}
          </div>
        </div>
      ) : null}

      {/*
        * Vom alten Server übernehmen: Die Charaktere des Repacks (oder
        * eines sonstigen zweiten Servers) in die eigene Datenbank holen.
        * Der fremde Server wird nur LESEND gestartet und unverändert
        * wieder beendet; das Ziel wird vorher gesichert.
        */}
      <div className="card" hidden={reiter !== 'uebernahme'}>
        <div className="card-head"><h3>{t('backup.fremdTitle')}</h3></div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>{t('backup.fremdIntro')}</p>
          <div className="inline mb0">
            <button className="btn" onClick={fremdOrdnerWaehlen}>{t('backup.fremdOrdner')}</button>
            {fremdOrdner
              ? <span className="mono" style={{ wordBreak: 'break-all' }}>{fremdOrdner}</span>
              : <span className="muted">{t('backup.fremdKein')}</span>}
          </div>
          <div className="inline mb0" style={{ marginTop: 6 }}>
            <button className="btn" onClick={fremdDatadirWaehlen}>{t('backup.fremdDatadir')}</button>
            {fremdDatadir
              ? <span className="mono" style={{ wordBreak: 'break-all' }}>{fremdDatadir}</span>
              : <span className="muted">{t('backup.fremdDatadirStandard')}</span>}
          </div>
          {rueckhol && !laeuft ? (
            rueckholDa ? (
              <div className="warn-box" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 240px' }}>{t('backup.rueckholHinweis', { stamp: rueckhol.stamp })}</span>
                <button className="btn" onClick={rueckholPruefen} disabled={pruefLaeuft || laeuft}>
                  {pruefLaeuft ? t('backup.rueckholPruefungLaeuft') : t('backup.rueckholPruefen')}
                </button>
                <button className="btn danger" onClick={rueckholStarten}>{t('backup.rueckholKnopf')}</button>
              </div>
            ) : (
              <div className="info-box" style={{ marginTop: 12, fontSize: 12 }}>
                {t('backup.rueckholWeg', { stamp: rueckhol.stamp })}
              </div>
            )
          ) : null}
          {!fremdBestaetigt ? (
            <div className="mt">
              <label className="check-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={fremdKonten} onChange={e => setFremdKonten(e.target.checked)} />
                <span>
                  {t('backup.fremdKonten')}
                  <span className="hint-line">{t('backup.fremdKontenHint')}</span>
                </span>
              </label>
              <label className="check-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={fremdBotsDb} onChange={e => setFremdBotsDb(e.target.checked)} />
                <span>
                  {t('backup.fremdBotsDb')}
                  <span className="hint-line">{t('backup.fremdBotsDbHint')}</span>
                </span>
              </label>
              <label className="check-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={fremdPlayerbotsConf} onChange={e => setFremdPlayerbotsConf(e.target.checked)} />
                <span>
                  {t('backup.fremdPlayerbotsConf')}
                  <span className="hint-line">{t('backup.fremdPlayerbotsConfHint')}</span>
                </span>
              </label>
              <label className="check-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={fremdWorldConf} onChange={e => setFremdWorldConf(e.target.checked)} />
                <span>
                  {t('backup.fremdWorldConf')}
                  <span className="hint-line">{t('backup.fremdWorldConfHint')}</span>
                </span>
              </label>
              <label className="check-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={fremdWorldDb} onChange={e => setFremdWorldDb(e.target.checked)} />
                <span>
                  {t('backup.fremdWorldDb')}
                  <span className="hint-line">{t('backup.fremdWorldDbHint')}</span>
                </span>
              </label>
              <div className="inline mb0">
                <button className="btn" disabled={!fremdOrdner || laeuft || fremdZaehlt} onClick={fremdZaehlen}>
                  {fremdZaehlt ? t('backup.fremdZaehlt') : t('backup.fremdZaehlen')}
                </button>
                <button
                  className="btn primary"
                  disabled={!fremdOrdner || laeuft}
                  onClick={async () => {
                    // Echte Spieler zählen (Bots zählen nicht) - die Box warnt
                    // und der Lauf macht eine Ansage im Spiel
                    try {
                      const z = await api.system.spielerOnline()
                      setFremdOnline(z && typeof z.online === 'number' ? z.online : null)
                    } catch (_) {
                      setFremdOnline(null)
                    }
                    setFremdBestaetigt(true)
                  }}
                >
                  {t('backup.fremdStart')}
                </button>
              </div>
              {fremdZaehlung ? (
                <div className="info-box mt">
                  {fremdZaehlung.welten >= 0
                    ? t('backup.fremdZaehlungResultWelten', {
                      charaktere: fremdZaehlung.charaktere < 0 ? '?' : fremdZaehlung.charaktere,
                      konten: fremdZaehlung.konten < 0 ? '?' : fremdZaehlung.konten,
                      welten: fremdZaehlung.welten,
                      db: fremdZaehlung.charsDb
                    })
                    : t('backup.fremdZaehlungResult', {
                      charaktere: fremdZaehlung.charaktere < 0 ? '?' : fremdZaehlung.charaktere,
                      konten: fremdZaehlung.konten < 0 ? '?' : fremdZaehlung.konten,
                      db: fremdZaehlung.charsDb
                    })}
                  {fremdZaehlung.groessen ? (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {[
                        fremdZaehlung.groessen.charsMb >= 0 ? `${t('backup.groesseChars')} ${fremdZaehlung.groessen.charsMb} MB` : '',
                        fremdZaehlung.groessen.worldMb >= 0 ? `${t('backup.groesseWelt')} ${fremdZaehlung.groessen.worldMb} MB` : '',
                        fremdZaehlung.groessen.botsMb >= 0 ? `${t('backup.groesseBots')} ${fremdZaehlung.groessen.botsMb} MB` : ''
                      ].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {fremdZaehlung && fremdZaehlung.botsDb && !fremdZaehlung.zielBots ? (
                <div className="warn-box mt" style={{ fontSize: 12 }}>
                  {t('backup.fremdBotModulFehlt', { db: fremdZaehlung.botsDb })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt">
              <div className="error-box">{t('backup.fremdWarnung')}</div>
              {fremdOnline != null ? (
                <div className={fremdOnline > 0 ? 'warn-box' : 'ok-box'} style={{ marginBottom: 10 }}>
                  {fremdOnline > 0
                    ? t('backup.fremdOnlineWarn', { n: fremdOnline })
                    : t('backup.fremdOnlineLeer')}
                </div>
              ) : null}
              <div className="inline">
                <button className="btn danger" onClick={fremdUebernehmen} disabled={laeuft}>
                  {t('backup.fremdJa')}
                </button>
                <button className="btn" onClick={() => setFremdBestaetigt(false)}>{t('backup.abort')}</button>
              </div>
            </div>
          )}
          <div className="hint">{t('backup.fremdHint')}</div>
          {fremdErgebnis ? (
            <div className="ok-box" style={{ marginTop: 12 }}>
              <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>
                  {t('backup.fremdErgebnisTitle')}
                  {fremdErgebnis.zeit ? ` · ${new Date(fremdErgebnis.zeit).toLocaleString()}` : ''}
                </span>
                <button
                  className="btn sm"
                  onClick={() => {
                    setFremdErgebnis(null)
                    api.installer.fremdErgebnisVerwerfen().catch(() => {})
                  }}
                >
                  {t('backup.ergebnisVerwerfen')}
                </button>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {fremdErgebnis.charaktere >= 0 && fremdErgebnis.zielCharaktere != null ? (
                  <li>{t('backup.fremdErgebnisChars', { quelle: fremdErgebnis.charaktere, ziel: fremdErgebnis.zielCharaktere })}{' '}{fremdErgebnis.charaktere === fremdErgebnis.zielCharaktere ? '✓' : '⚠'}</li>
                ) : null}
                {fremdErgebnis.kontenVergleich && fremdErgebnis.kontenVergleich.quelle >= 0 ? (
                  <li>{t('backup.fremdErgebnisKonten', { quelle: fremdErgebnis.kontenVergleich.quelle, ziel: fremdErgebnis.kontenVergleich.ziel })}{' '}{fremdErgebnis.kontenVergleich.ok ? '✓' : '⚠'}</li>
                ) : null}
                {fremdErgebnis.kontenVergleich && fremdErgebnis.kontenVergleich.ohneSrp6 > 0 ? (
                  <li>{t('backup.fremdErgebnisSrp6', { count: fremdErgebnis.kontenVergleich.ohneSrp6 })}</li>
                ) : null}
                {fremdErgebnis.kontenVergleich && fremdErgebnis.kontenVergleich.waise > 0 ? (
                  <li>{t('backup.fremdErgebnisWaise', { count: fremdErgebnis.kontenVergleich.waise })}</li>
                ) : null}
                {fremdErgebnis.botsDb ? <li>{t('backup.fremdErgebnisBots', { db: fremdErgebnis.botsDb.db })}</li> : null}
                {fremdErgebnis.worldDb ? (
                  <li>
                    {fremdErgebnis.worldDb.quelle >= 0 && fremdErgebnis.worldDb.ziel >= 0
                      ? t('backup.fremdErgebnisWorldVergleich', {
                        db: fremdErgebnis.worldDb.db,
                        quelle: fremdErgebnis.worldDb.quelle,
                        ziel: fremdErgebnis.worldDb.ziel
                      }) + ' ' + (fremdErgebnis.worldDb.ok ? '✓' : '⚠')
                      : t('backup.fremdErgebnisWorld', { db: fremdErgebnis.worldDb.db })}
                  </li>
                ) : null}
                {fremdErgebnis.playerbotsConf ? <li>{t('backup.fremdErgebnisConf')}</li> : null}
                {fremdErgebnis.raten ? <li>{t('backup.fremdErgebnisRaten', { count: fremdErgebnis.raten.übernommen })}</li> : null}
                {fremdErgebnis.neuGestartet && (fremdErgebnis.neuGestartet.world != null || fremdErgebnis.neuGestartet.auth != null) ? (
                  <li>
                    {t('backup.fremdErgebnisServer', {
                      world: fremdErgebnis.neuGestartet.world == null ? '–' : (fremdErgebnis.neuGestartet.world ? '✓' : '⚠'),
                      auth: fremdErgebnis.neuGestartet.auth == null ? '–' : (fremdErgebnis.neuGestartet.auth ? '✓' : '⚠')
                    })}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card" hidden={reiter !== 'sichern'}>
        <div className="card-head">
          <h3>{t('backup.autoHead')}</h3>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {plan.enabled && plan.intervalHours > 0
              ? `${t('backup.autoStatus')}: ${t('backup.autoStatusOn')}`
              : `${t('backup.autoStatus')}: ${t('backup.autoStatusOff')}`}
          </span>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>{t('backup.autoText')}</p>

          <div className="field">
            <label className="inline" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={plan.enabled}
                disabled={laeuft}
                style={{ width: 'auto' }}
                onChange={e => setPlan(p => ({ ...p, enabled: e.target.checked }))}
              />
              {t('backup.autoEnabled')}
            </label>
          </div>

          <div className="row">
            <div className="field">
              <label>{t('backup.autoInterval')}</label>
              <div className="inline">
                <input
                  type="number"
                  min="1"
                  max="168"
                  style={{ width: 90 }}
                  value={plan.intervalHours}
                  disabled={!plan.enabled || laeuft}
                  onChange={e => setPlan(p => ({ ...p, intervalHours: Number(e.target.value) || 1 }))}
                />
                <span className="muted">{t('backup.autoHours')}</span>
              </div>
            </div>
            <div className="field">
              <label>{t('backup.autoKeep')}</label>
              <div className="inline">
                <input
                  type="number"
                  min="1"
                  max="999"
                  style={{ width: 90 }}
                  value={plan.keep}
                  disabled={laeuft}
                  onChange={e => setPlan(p => ({ ...p, keep: Number(e.target.value) || 1 }))}
                />
                <span className="muted">{t('backup.autoKeepUnit')}</span>
              </div>
            </div>
          </div>

          <div className="field">
            <label className="inline" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={plan.compress}
                disabled={laeuft}
                style={{ width: 'auto' }}
                onChange={e => setPlan(p => ({ ...p, compress: e.target.checked }))}
              />
              {t('backup.autoCompress')}
            </label>
          </div>

          <div className="inline mt">
            <button className="btn primary" disabled={laeuft} onClick={planSpeichern}>
              {t('backup.autoSave')}
            </button>
            <button className="btn" disabled={laeuft || !statusDaten?.reachable} onClick={jetztAusloesen}>
              {t('backup.autoNow')}
            </button>
          </div>

          <div className="hint" style={{ marginTop: 10 }}>
            {t('backup.diskUsed')}: <strong>{formatBytes(belegt)}</strong>
            {anzSicherungen ? ' · ' + t('backup.setsKept', { count: anzSicherungen, size: formatBytes(belegt) }) : ''}
          </div>
        </div>
      </div>

      {/*
        * Zweites Sicherungsziel: eine Kopie auf eine andere Platte/NAS.
        * Fällt die Hauptplatte aus, ist die Sicherung sonst mit weg.
        */}
      <div className="card" hidden={reiter !== 'sichern'}>
        <div className="card-head">
          <h3>{t('backup.mirrorTitle')}</h3>
          {mirrorStatus ? (
            <span className={`pill ${mirrorStatus.ok ? 'online' : 'offline'}`}>
              {mirrorStatus.ok ? t('backup.mirrorOk') : t('backup.mirrorFail')}
            </span>
          ) : null}
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>{t('backup.mirrorHint')}</p>
          <div className="field">
            <label>{t('backup.mirrorDir')}</label>
            <div className="inline">
              <input
                type="text"
                className="mono"
                value={mirror.dir}
                onChange={e => setMirror(m => ({ ...m, dir: e.target.value }))}
                placeholder={t('backup.mirrorNone')}
                style={{ flex: 1, minWidth: 220 }}
              />
              <button
                className="btn sm"
                disabled={laeuft}
                onClick={async () => {
                  try {
                    const p = await api.system.pickFolder({ title: t('backup.mirrorChoose') })
                    if (p) setMirror(m => ({ ...m, dir: p }))
                  } catch (e) {
                    toast(e.message, 'err')
                  }
                }}
              >
                {t('backup.mirrorChoose')}
              </button>
              {mirror.dir ? (
                <button className="btn sm" onClick={() => setMirror(m => ({ ...m, dir: '' }))}>
                  {t('backup.mirrorClear')}
                </button>
              ) : null}
            </div>
          </div>
          <div className="inline" style={{ marginTop: 8 }}>
            <div className="field" style={{ width: 140, margin: 0 }}>
              <label>{t('backup.mirrorKeep')}</label>
              <input
                type="number"
                min="1"
                max="99"
                value={mirror.keep}
                onChange={e => setMirror(m => ({ ...m, keep: Number(e.target.value) || 1 }))}
                style={{ width: 90 }}
              />
            </div>
            <button className="btn primary" onClick={mirrorSpeichern}>{t('backup.mirrorSave')}</button>
          </div>
          <div className="hint">{t('backup.mirrorKeepHint')}</div>
          {mirrorStatus ? (
            <div className={`info-box mt ${mirrorStatus.ok ? '' : 'error-box'}`}>
              {mirrorStatus.ok
                ? t('backup.mirrorLast', {
                  when: new Date(mirrorStatus.zeit).toLocaleString(),
                  n: mirrorStatus.dateien,
                  dir: mirrorStatus.dir
                })
                : t('backup.mirrorError', {
                  when: new Date(mirrorStatus.zeit).toLocaleString(),
                  fehler: mirrorStatus.fehler || ''
                })}
            </div>
          ) : (
            <div className="hint">{t('backup.mirrorNever')}</div>
          )}
        </div>
      </div>

      <div className="card" hidden={reiter !== 'sichern'}>
        <div className="card-head">
          <h3>{t('backup.createHead')}</h3>
          <span className="muted mono" style={{ fontSize: 11.5 }}>{liste.ordner}</span>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>{t('backup.createText')}</p>

          {!statusDaten?.reachable && statusDaten ? (
            <div className="error-box">{t('backup.dbDown')}</div>
          ) : null}

          {serverLaeuft ? (
            <div className="info-box">{t('backup.serverRunning')}</div>
          ) : null}

          <div className="inline mt">
            <button className="btn primary" disabled={laeuft || !statusDaten?.reachable} onClick={sichern}>
              {t('backup.createNow')}
            </button>
            <button className="btn" disabled={laeuft} onClick={ordner}>
              {t('backup.openFolder')}
            </button>
            {/*
             * Sicherungsordner ändern: das Backend kann es längst (backup.dir),
             * bisher nur per Hand in der config.json.
             */}
            <button
              className="btn"
              disabled={laeuft}
              onClick={async () => {
                try {
                  const p = await api.system.pickFolder({ title: t('backup.dirTitel') })
                  if (!p) return
                  await api.backup.saveSettings({ dir: p })
                  toast(t('backup.dirGesetzt', { pfad: p }), 'ok')
                  laden()
                } catch (e) {
                  toast(e.message, 'err')
                }
              }}
            >
              {t('backup.dirWaehlen')}
            </button>
            <button className="btn" disabled={laeuft} onClick={laden}>
              {t('backup.refresh')}
            </button>
          </div>
          {backupOrdner ? (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6, wordBreak: 'break-all' }}>
              {t('backup.dirAktuell')} <span className="mono">{backupOrdner}</span>{' '}
              {t('backup.dirHinweis')}
            </div>
          ) : null}

          {laeuft && meldung ? (
            <div className="info-box mt0">
              {meldung}
              {migrationFortschritt ? ` · ${migrationFortschritt.percent} %` : ''}
              {migrationFortschritt && migrationFortschritt.zeile ? (
                <div className="mono" style={{ fontSize: 11.5, marginTop: 4, wordBreak: 'break-all' }}>
                  {migrationFortschritt.zeile}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        * Update-Sicherungen: die DB-Sicherung VOR jedem Update. Ein
        * missratenes Update lässt sich so auf den Stand davor zurückrollen.
        */}
      {updateSicherungen.length ? (
        <div className="card" hidden={reiter !== 'uebernahme'}>
          <div className="card-head"><h3>{t('backup.updateSicherungen')}</h3></div>
          <div className="card-body">
            <p style={{ marginTop: 0 }}>{t('backup.updateSicherungenIntro')}</p>
            {updateSicherungen.map(e => (
              <div key={e.zeit} className="inline" style={{ marginBottom: 6, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(e.zeit).toLocaleString()} · {e.ok ? '✓' : '✕'} ·{' '}
                  <span className="mono">{e.sicherung}</span>
                  {e.dauerMin != null ? ` · ${e.dauerMin} min` : ''}
                </span>
                <button
                  className="btn sm"
                  disabled={laeuft || !vorhandeneStamps.has(e.sicherung)}
                  onClick={() => setFrage({ art: 'restoreAll', stamp: e.sicherung, name: e.sicherung, count: 1 })}
                >
                  {vorhandeneStamps.has(e.sicherung) ? t('backup.updateZurueck') : t('backup.updateWeg')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card" hidden={reiter !== 'wiederherstellen'}>
        <div className="card-head">
          <h3>{t('backup.listHead', { count: anzSicherungen })}</h3>
        </div>
        <div className="card-body tight">
          {!anzSicherungen ? (
            <div className="empty">{t('backup.noSets')}</div>
          ) : (
            liste.sets.map(g => (
              <div key={g.stamp} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                <div className="inline" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong className="mono" style={{ fontSize: 13 }}>{stampText(g.stamp)}</strong>
                    {g.test ? (
                      <span
                        className={`pill ${g.test.ok ? 'online' : 'offline'}`}
                        style={{ marginLeft: 6, fontSize: 10 }}
                        title={t('backup.verifyBadgeWhen', { when: new Date(g.test.zeit).toLocaleString() })}
                      >
                        {t(g.test.ok ? 'backup.verifyBadgeOk' : 'backup.verifyBadgeFail')}
                      </span>
                    ) : (
                      <span
                        className="pill offline"
                        style={{ marginLeft: 6, fontSize: 10, opacity: 0.65 }}
                      >
                        {t('backup.verifyBadgeUnknown')}
                      </span>
                    )}
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {t('backup.createdWith')} {zeitpunkt(g.created)} · {formatBytes(g.size)} · {t(g.files.length === 1 ? 'backup.dbFile' : 'backup.dbFiles', { count: g.files.length })}
                    </div>
                    {g.test && (g.test.vergleich || []).length ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {g.test.vergleich.map(v => `${v.tabelle}: ${v.backup == null ? '?' : formatNumber(v.backup)} / ${v.live == null ? '?' : formatNumber(v.live)}`).join(' · ')}
                      </div>
                    ) : null}
                  </div>
                  <div className="inline">
                    <button
                      className="btn sm"
                      disabled={laeuft}
                      onClick={() => setFrage({ art: 'restoreAll', stamp: g.stamp, name: g.stamp, count: g.files.length })}
                    >
                      {t('backup.restoreAll')}
                    </button>
                    <button
                      className="btn sm"
                      disabled={laeuft}
                      onClick={() => setFrage({ art: 'remove', stamp: g.stamp, name: g.stamp })}
                    >
                      {t('backup.delete')}
                    </button>
                    <button
                      className="btn sm"
                      disabled={laeuft || verifyLaeuft}
                      onClick={() => sicherungTesten(g.stamp)}
                    >
                      {t('backup.verifyOne')}
                    </button>
                  </div>
                </div>
                <div className="inline" style={{ marginTop: 6 }}>
                  {g.files.map(f => (
                    <span key={f.file} className="inline" style={{ gap: 4 }}>
                      <span className="mono" style={{ fontSize: 11.5 }}>{f.db || f.name}</span>
                      <span className="muted" style={{ fontSize: 11 }}>{formatBytes(f.size)}</span>
                      <button
                        className="btn sm"
                        disabled={laeuft}
                        onClick={() => setFrage({ art: 'restoreOne', file: f.file, name: f.name, db: f.db })}
                      >
                        {t('backup.restoreThis')}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="info-box">
        <strong>{t('backup.important')}</strong>{' '}
        {t('backup.hintA')}
        <br />
        {t('backup.hintB')}
      </div>

      {frage ? (
        <Modal
          title={
            frage.art === 'remove'
              ? t('backup.confirmDeleteTitle')
              : (frage.art === 'restoreAll' ? t('backup.confirmRestoreAllTitle') : t('backup.confirmRestoreTitle'))
          }
          onClose={() => setFrage(null)}
          footer={
            <>
              <button className="btn" onClick={() => setFrage(null)}>{t('backup.abort')}</button>
              <button
                className="btn primary"
                disabled={laeuft}
                onClick={() => {
                  if (frage.art === 'remove') return loeschen(frage.stamp)
                  if (frage.art === 'restoreAll') {
                    return wiederherstellen(
                      frage.dbs && frage.dbs.length ? { stamp: frage.stamp, dbs: frage.dbs } : { stamp: frage.stamp }
                    )
                  }
                  return wiederherstellen({ file: frage.file })
                }}
              >
                {frage.art === 'remove' ? t('backup.confirmDelete') : t('backup.confirmRestore')}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            {frage.art === 'remove'
              ? t('backup.confirmDeleteText', { name: frage.name })
              : (frage.art === 'restoreAll'
                  ? t('backup.confirmRestoreAllText', { name: frage.name, count: frage.count })
                  // Bei einer einzelnen Datei den DATENBANKnamen nennen. Der
                  // Dateiname ist ein Zeitstempel plus Datenbank - dreimal
                  // derselbe Text waere fuer drei Knöpfe nuetzlos.
                  : t('backup.confirmRestoreDb', { db: frage.db || frage.name }))}
          </p>
          {frage.art !== 'remove' ? (
            <>
              <div className="error-box">{t('backup.restoreOverwrite')}</div>
              <p>{t('backup.restoreSafety')}</p>
              {frageSet ? (
                <div className={vergleichWarnung ? 'warn-box' : 'info-box'} style={{ marginBottom: 10 }}>
                  <div>{t('backup.compareAge', { tage: frageAlterTage })}</div>
                  {frageTest && (frageTest.vergleich || []).length ? (
                    <table style={{ marginTop: 6 }}>
                      <thead>
                        <tr><th>{t('backup.compareTable')}</th><th>{t('backup.compareBackup')}</th><th>{t('backup.compareLive')}</th></tr>
                      </thead>
                      <tbody>
                        {frageTest.vergleich.map(v => (
                          <tr key={v.tabelle}>
                            <td className="mono">{v.tabelle}</td>
                            <td>{v.backup == null ? '—' : formatNumber(v.backup)}</td>
                            <td>{v.live == null ? '—' : formatNumber(v.live)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{t('backup.compareNoTest')}</div>
                  )}
                  {vergleichWarnung ? <div style={{ marginTop: 6 }}><strong>{t('backup.compareWarn')}</strong></div> : null}
                </div>
              ) : null}
              {/*
                * Teil-Restore: nur die gewaehlten Datenbanken zurueckholen.
                * Leere Auswahl = alles. Sinnvoll, wenn z. B. nur die
                * Charakter-Datenbank einen Rueckschritt braucht.
                */}
              {frage.art === 'restoreAll' ? (
                <div style={{ marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('backup.restoreWahl')}</div>
                  {['acore_auth', 'acore_characters', 'acore_world', 'acore_playerbots'].map(dbName => {
                    // Größe aus der R25-Route (auth/chars/world/bots)
                    const groesseKey = dbName === 'acore_auth' ? 'auth'
                      : dbName === 'acore_characters' ? 'chars'
                        : dbName === 'acore_world' ? 'world' : 'bots'
                    const mb = dbGroessen ? dbGroessen[groesseKey] : null
                    return (
                      <label className="check-row" key={dbName} style={{ display: 'inline-flex', marginRight: 14 }}>
                        <input
                          type="checkbox"
                          checked={frage.dbs ? frage.dbs.includes(dbName) : false}
                          onChange={e => {
                            const alt = frage.dbs || []
                            setFrage(f => ({
                              ...f,
                              dbs: e.target.checked ? [...alt, dbName] : alt.filter(x => x !== dbName)
                            }))
                          }}
                        />
                        <span className="mono">{dbName}</span>
                        {mb != null && mb >= 0 ? <span className="muted" style={{ fontSize: 11 }}>{' '}· {mb} MB</span> : null}
                      </label>
                    )
                  })}
                </div>
              ) : null}
              {serverLaeuft ? <div className="error-box">{t('backup.restoreRunningHint')}</div> : null}
            </>
          ) : null}
        </Modal>
      ) : null}
    </>
  )
}

export default Backup
