import React, { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { className, raceName, formatPlaytime, formatNumber } from '../lib/constants'
import DiagnoseCard from '../components/DiagnoseCard'

function Dashboard () {
  const { status, dbOk, toast } = useStatus()
  const { t } = useI18n()
  const [stats, setStats] = useState(null)
  const [online, setOnline] = useState([])
  const [confFiles, setConfFiles] = useState([])
  // Update-Hinweis: einmal pro Start pruefen und zeigen, solange Updates
  // offen sind. Fehlschlag (kein Repo, offline) bleibt stumm.
  const [updateInfo, setUpdateInfo] = useState(null)
  const aktivFlag = useRef(false)
  // Direktstart aus der Übersicht: Fortschritt anzeigen, solange es läuft
  const [updateLaeuft, setUpdateLaeuft] = useState(null)
  const [updateFrage, setUpdateFrage] = useState(false)
  const [onlineFrage, setOnlineFrage] = useState(null)
  // Serverstand aus der install-state.json (ein Blick, welchen Stand man betreibt)
  const [serverStand, setServerStand] = useState(null)
  // Letzte Sicherung: Alter + Auto-Status, damit man "nie gesichert" sieht
  const [backupInfo, setBackupInfo] = useState(null)
  // RAM des Welt-/Authservers und nächste Wartungs-/Neustart-Termine
  const [metriken, setMetriken] = useState(null)
  const [wartung, setWartung] = useState(null)
  // Online-Verlauf (stuendlich verdichtet, 30 Tage)
  const [statistik, setStatistik] = useState(null)
  // Verlauf der letzten Update-Läufe + Zustand des "jetzt sichern"-Knopfs
  const [verlauf, setVerlauf] = useState([])
  const [sichert, setSichert] = useState(false)
  // Konfig geändert, aber der Worldserver läuft noch mit dem alten Stand?
  const [restartNoetig, setRestartNoetig] = useState(false)
  // Modul installiert/aktualisiert, aber die gebaute EXE kennt es noch nicht?
  const [buildNoetig, setBuildNoetig] = useState(false)
  // Nach einem Core-Update ergaenzte .dist-Schluessel sichtbar machen.
  const [migration, setMigration] = useState(null)
  // Build-Profil fürs Update (Kern-Auslastung: full/balanced/background)
  const [buildProfil, setBuildProfil] = useState(() => {
    try { return localStorage.getItem('panel:buildProfile') || 'balanced' } catch (_) { return 'balanced' }
  })

  useEffect(() => {
    api.installer.updateVerlauf()
      .then(r => setVerlauf(r.verlauf || []))
      .catch(() => {})
  }, [])

  // Datenbankgrößen für die Platten-Aufstellung (einmal beim Öffnen)
  const [dbGroessen, setDbGroessen] = useState(null)
  const [fragmentierung, setFragmentierung] = useState(null)
  useEffect(() => {
    api.system.dbGroessen()
      .then(r => {
        if (r && r.ok) {
          setDbGroessen(r.groessen)
          setFragmentierung(r.fragmentierung || null)
        }
      })
      .catch(() => {})
  }, [])
  const boxRef = useRef(null)
  const stick = useRef(true)
  // Taktgeber fuer das Dashboard: bei DB-Fehler langsamer werden.
  const dbOkRef = useRef(dbOk)
  useEffect(() => { dbOkRef.current = dbOk }, [dbOk])

  useEffect(() => {
    api.installer.migration().then(r => setMigration(r && r.migration)).catch(() => {})
  }, [])

  useEffect(() => {
    let aktiv = true
    const laden = () => api.statistik.get()
      .then(r => { if (aktiv) setStatistik(r) })
      .catch(() => {})
    laden()
    const iv = setInterval(laden, 60000)
    return () => { aktiv = false; clearInterval(iv) }
  }, [])

  const load = async () => {
    try {
      const [s, o, b, m, w, rn, bn] = await Promise.all([
        api.dashboard.stats(),
        api.online.list(),
        api.backup.list().catch(() => null),
        api.server.metriken().catch(() => null),
        api.maintenance.get().catch(() => null),
        api.system.restartNoetig().catch(() => null),
        api.system.buildNoetig().catch(() => null)
      ])
      setStats(s)
      setMetriken(m)
      setWartung(w)
      setRestartNoetig(!!(rn && rn.noetig))
      setBuildNoetig(!!(bn && bn.noetig))
      /*
       * online.list liefert { rows } (server-seitiger Bot-Filter) - ohne die
       * Zeile warf online.filter() still einen TypeError und die Übersicht
       * aktualisierte nicht mehr.
       */
      setOnline((o && o.rows) || o || [])
      if (b) {
        setBackupInfo({
          set: (b.sets && b.sets[0]) || null,
          auto: Boolean(b.plan && b.plan.enabled),
          plan: b.plan || null,
          verify: !!b.verify
        })
      } else {
        setBackupInfo(null)
      }
    } catch (_) {
      /* Dashboard bleibt bedienbar, Fehler stehen in der Konsole */
    }
  }

  useEffect(() => {
    let aktiv = true
    let timer = null
    const takt = () => {
      if (!aktiv) return
      load().finally(() => {
        if (!aktiv) return
        // Bei nicht erreichbarer Datenbank nicht alle 5 s erneut klopfen.
        const ms = document.hidden ? 30000 : (dbOkRef.current === false ? 20000 : 5000)
        timer = setTimeout(takt, ms)
      })
    }
    takt()
    const onSichtbar = () => {
      if (!document.hidden && aktiv) {
        clearTimeout(timer)
        takt()
      }
    }
    document.addEventListener('visibilitychange', onSichtbar)
    return () => {
      aktiv = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onSichtbar)
    }
  }, [])

  useEffect(() => {
    api.config
      .available()
      .then(list => setConfFiles(list.filter(c => c.exists).map(c => c.key)))
      .catch(() => {})
  }, [])

  const pruefeUpdates = (erzwingen = false) => {
    api.settings.get().then(cfg => {
      const root = cfg && cfg.server && cfg.server.rootDir
      if (!root || !aktivFlag.current) return
      api.installer.serverStand().then(s => { if (aktivFlag.current && s && s.stand) setServerStand(s) }).catch(() => {})
      return api.installer.checkUpdate({ root, erzwingen }).then(r => {
        if (!aktivFlag.current || !r || !r.ok) return
        // Zeigen, wenn Commits offen sind ODER die Clientdaten (evtl.) alt sind
        const clientAlt = r.clientData && !r.clientData.aktuell
        if (r.verfuegbar || clientAlt) setUpdateInfo(r)
        if (erzwingen) {
          toast(r.verfuegbar
            ? t('dashboard.updatePruefenNeu', { n: r.anzahl || 0 })
            : t('dashboard.updatePruefenKeine'), 'ok')
        }
      }).catch(() => {})
    }).catch(() => {})
  }

  // Eine Prüfung beim Start, danach alle 30 Minuten (der 10-Minuten-Cache
  // aus Runde 4 drosselt; ein Panel im Tray sieht neue Commits so auch).
  useEffect(() => {
    aktivFlag.current = true
    pruefeUpdates()
    const iv = setInterval(pruefeUpdates, 30 * 60 * 1000)
    return () => { aktivFlag.current = false; clearInterval(iv) }
  }, [])

  /*
   * Plattenwächter: Backups, DB und Logs wachsen weiter. Ab 5 GB frei
   * erscheint eine dauerhafte Warnung, bevor MySQL mit kryptischen Fehlern
   * abschmiert.
   */
  const [platz, setPlatz] = useState(null)
  const [platzAufstellung, setPlatzAufstellung] = useState(null)
  const [raeumt, setRaeumt] = useState(false)
  useEffect(() => {
    let aktiv = true
    const laden = () => {
      api.system.freierPlatz().then(r => {
        if (aktiv) setPlatz(r)
      }).catch(() => {})
    }
    laden()
    const iv = setInterval(laden, 60000)
    return () => { aktiv = false; clearInterval(iv) }
  }, [])

  const aufstellungLaden = () => {
    api.system.platzAufstellung().then(r => {
      if (r && r.ok) setPlatzAufstellung(r)
    }).catch(() => {})
  }
  useEffect(() => { aufstellungLaden() }, [])

  /*
   * Direktstart: Update aus der Übersicht anstoßen, ohne den Umweg über
   * den Assistenten. Der Fortschritt kommt über 'installer:progress' -
   * die Übersicht zeigt Prozent und Schritt, solange es läuft.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api || typeof window.api.on !== 'function') return undefined
    return window.api.on('installer:progress', ev => {
      if (!ev) return
      if (ev.status && ev.status.running) setUpdateLaeuft({ percent: ev.status.percent, stepKey: ev.status.stepKey })
      if (ev.type === 'done') {
        setUpdateLaeuft(null)
        setUpdateInfo(null)
        pruefeUpdates()
        /*
         * Neustart-Ergebnisse: Ein fehlgeschlagener Server-Start ist kein
         * "Update fertig" - dann kommt eine Warnung statt des Erfolgs-Toasts.
         */
        const ng = ev.neuGestartet || {}
        const fehler = []
        if (ng.world === false) fehler.push('World')
        if (ng.auth === false) fehler.push('Auth')
        if (fehler.length) {
          toast(t('dashboard.updateServerWarn', { server: fehler.join(', ') }), 'warn')
        } else if (!clientAktion.current) {
          toast(t('dashboard.updateFertig'), 'ok')
        }
      }
      if (ev.type === 'error') {
        setUpdateLaeuft(null)
        toast(t('dashboard.updateFehler', { fehler: ev.message || '' }), 'err')
      }
    })
  }, [t])

  const updateStarten = async () => {
    setUpdateFrage(false)
    const root = await api.settings.get().then(c => c.server && c.server.rootDir).catch(() => '')
    try {
      const r = await api.installer.update({ root, buildProfile: buildProfil })
      if (r && r.status) setUpdateLaeuft({ percent: r.status.percent, stepKey: r.status.stepKey })
      else setUpdateLaeuft({ percent: 0, stepKey: '' })
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const updateAbbrechen = async () => {
    try {
      await api.installer.cancel()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /*
   * Clientdaten-Aktualisierung aus der Übersicht: der Check merkt, wenn
   * dbc/maps/vmaps/mmaps nicht zum Core-Stand passen - bisher war der
   * Hinweis aber unsichtbar (die Update-Karte hängt an "Commits offen").
   */
  const clientAktion = useRef(false)
  const [clientBusy, setClientBusy] = useState(false)
  const clientDatenStarten = async () => {
    if (clientBusy) return
    const root = await api.settings.get().then(c => c.server && c.server.rootDir).catch(() => '')
    if (!root) {
      toast(t('dashboard.clientKeinRoot'), 'err')
      return
    }
    clientAktion.current = true
    setClientBusy(true)
    try {
      await api.installer.clientDataUpdate({ root })
      toast(t('dashboard.clientFertig'), 'ok')
      pruefeUpdates()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      clientAktion.current = false
      setClientBusy(false)
      setUpdateLaeuft(null)
    }
  }

  const downloadsRaeumen = async () => {
    setRaeumt(true)
    try {
      const r = await api.system.downloadsRaeumen()
      toast(t('dashboard.platzRaeumung', { n: r.entfernt, mb: r.mb }), 'ok')
      aufstellungLaden()
      api.system.freierPlatz().then(p => setPlatz(p)).catch(() => {})
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setRaeumt(false)
    }
  }

  const pdbRaeumen = async () => {
    setRaeumt(true)
    try {
      const r = await api.system.pdbRaeumen()
      toast(t('dashboard.platzRaeumung', { n: r.entfernt, mb: r.mb }), 'ok')
      aufstellungLaden()
      api.system.freierPlatz().then(p => setPlatz(p)).catch(() => {})
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setRaeumt(false)
    }
  }

  const logsRaeumen = async () => {
    setRaeumt(true)
    try {
      const r = await api.system.logsRaeumen()
      toast(t('dashboard.platzRaeumung', { n: r.entfernt, mb: r.mb }), 'ok')
      aufstellungLaden()
      api.system.freierPlatz().then(p => setPlatz(p)).catch(() => {})
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setRaeumt(false)
    }
  }

  /*
   * Letzte Auffälligkeiten: ERROR-Zeilen der Serverlogs, damit man nicht
   * erst beim "warum geht gestern nichts?" in die Logs graben muss.
   */
  const [auffaelligkeiten, setAuffaelligkeiten] = useState(null)
  useEffect(() => {
    const laden = () => api.system.auffaelligkeiten().then(r => {
      if (r && r.ok) setAuffaelligkeiten(r.treffer)
    }).catch(() => {})
    laden()
    const iv = setInterval(laden, 120000)
    return () => clearInterval(iv)
  }, [])

  const world = status.world || {}
  const auth = status.auth || {}
  const anyRunning = world.running || auth.running

  // Farbige Statuszeilen im Stil der Referenz
  const lines = []
  const push = (cls, text) => lines.push({ cls, text })

  // Ohne Versionsnummer. Die steht an keiner Stelle mehr im Panel: in der
  // Titelleiste war sie Ballast, und in der Startmeldung sagt sie nichts,
  // was nicht schon am Fenstertitel steht.
  push('system', t('dashboard.started'))

  if (dbOk) {
    // Nur noch die Aussage, ob die Datenbank antwortet. Die Zeile mit der
    // Homepage-Adresse war doppelt: die Adresse aendert sich ohnehin, und
    // sie stand direkt ueber "Datenbank erreichbar".
    push('green', t('dashboard.dbReachable'))
  } else {
    push('red', t('dashboard.dbUnreachable'))
    push('yellow', t('dashboard.dbHint'))
  }

  if (confFiles.length) {
    push('cyan', t('dashboard.confFilesFound', { files: confFiles.join(', ') }))
  }

  if (updateInfo) {
    if (updateInfo.verfuegbar) {
      push('yellow', t('dashboard.updateAvailable', { n: updateInfo.anzahl, local: updateInfo.lokal, remote: updateInfo.remote }))
    }
    if (updateInfo.clientData && !updateInfo.clientData.aktuell) {
      push('yellow', t('dashboard.clientDataStale', { loaded: updateInfo.clientData.geladen, remote: updateInfo.clientData.remote }))
    }
  }

  if (platz && platz.ok && platz.freiGb < 5) {
    push('red', t('dashboard.plattenplatz', { gb: platz.freiGb.toFixed(1) }))
  }

  if (stats && stats.realmWartung) push('yellow', t('dashboard.realmWartung'))

  if (!world.running) {
    push('yellow', t('dashboard.worldNotRunning'))
  }
  if (!auth.running) {
    push('yellow', t('dashboard.authNotRunning'))
  }
  if (world.running && auth.running) {
    push('green', t('dashboard.bothOnline', { pid: world.pid }))
  }

  /*
   * Arbeitsspeicher, Serverstand und die reine Kontenzahl stehen auf den
   * Statistik-Kacheln bzw. der Server-Seite. Im Statusfenster bleiben nur
   * Meldungen, die eine Entscheidung verlangen - sonst wird die Uebersicht
   * zur Textwand.
   */
  if (wartung && (wartung.enabled || wartung.restartAktiv)) {
    const teile = []
    if (wartung.enabled && wartung.naechsterLauf) {
      teile.push(t('dashboard.wartungUpdate', { zeit: new Date(wartung.naechsterLauf).toLocaleString() }))
    }
    if (wartung.restartAktiv && wartung.naechsterRestart) {
      teile.push(t('dashboard.wartungRestart', { zeit: new Date(wartung.naechsterRestart).toLocaleString() }))
    }
    if (teile.length) push('yellow', teile.join(' · '))
  }
  if (verlauf.length) {
    const e = verlauf[0]
    push(e.ok ? 'cyan' : 'yellow', t(e.ok ? 'dashboard.verlaufOk' : 'dashboard.verlaufFehler', {
      zeit: new Date(e.zeit).toLocaleString(),
      dauer: e.dauerMin != null ? e.dauerMin : '?'
    }))
  }
  // Konfig geändert, aber noch nicht neu gestartet?
  if (restartNoetig) {
    push('yellow', t('dashboard.restartNoetig'))
  }
  // Modul-Änderung eingebaut? Erst nach dem nächsten Update/Bau.
  if (buildNoetig) {
    push('yellow', t('dashboard.buildNoetig'))
  }

  if (updateLaeuft) {
    const schritt = updateLaeuft.stepKey ? t(`setup.install.step.${updateLaeuft.stepKey}`) : ''
    push('cyan', t('dashboard.updateLaeuft', { percent: updateLaeuft.percent, schritt }))
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('dashboard.serverStatus')}</h3>
          <div className="console-tools">
            <button className="btn sm" onClick={load}>{t('common.refresh')}</button>
            <button className="btn sm" onClick={() => (window.location.hash = '#/console')}>{t('nav.console')}</button>
            <button className="btn sm" onClick={() => (window.location.hash = '#/online')}>{t('nav.online')}</button>
            <button className="btn sm" onClick={() => pruefeUpdates(true)}>{t('dashboard.updatePruefen')}</button>
            {!world.running && !auth.running ? (
              <button
                className="btn sm success"
                onClick={async () => {
                  try {
                    await api.server.startAll({ delay: 5, waitDb: true })
                    toast(t('dashboard.startAllOk'), 'ok')
                    load()
                  } catch (e) {
                    toast(e.message, 'err')
                  }
                }}
              >
                {t('dashboard.startAll')}
              </button>
            ) : null}
            {world.running ? (
              <button
                className="btn sm"
                onClick={async () => {
                  try {
                    await api.server.restart('world')
                    toast(t('dashboard.worldRestartOk'), 'ok')
                  } catch (e) {
                    toast(e.message, 'err')
                  }
                }}
              >
                {t('dashboard.worldRestart')}
              </button>
            ) : null}
            {updateLaeuft ? (
              <button className="btn sm danger" onClick={updateAbbrechen}>{t('dashboard.updateAbbrechen')}</button>
            ) : null}
          </div>
        </div>
        <div
          className="console"
          ref={boxRef}
          style={{ height: 150 }}
          onScroll={e => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {lines.map((l, i) => (
            <div key={i} className={`line ${l.cls}`}>{l.text}</div>
          ))}
          <div className="line prompt">&gt; _</div>
        </div>

        {/*
          * Direktstart: Der Hinweisblock nennt offene Commits - der Knopf
          * spart den Umweg über den Assistenten. Bestätigung, weil laufende
          * Server gestoppt werden; die Sicherung macht der Update-Lauf selbst.
          */}
        {updateInfo && updateInfo.verfuegbar && !updateLaeuft ? (
          updateFrage ? (
            <div className="inline" style={{ margin: '8px 12px', flexWrap: 'wrap' }}>
              <span className="warn-box" style={{ padding: '6px 10px' }}>{t('dashboard.updateWarn')}</span>
              <button className="btn danger sm" onClick={updateStarten}>{t('dashboard.updateJetzt')}</button>
              <button
                className="btn sm"
                title={t('dashboard.updateProtokollHint')}
                onClick={() => api.installer.protokolle().then(r => {
                  const neu = (r.liste || []).find(x => /update-.*\.log$/i.test(x.name))
                  if (neu) return api.installer.protokollOeffnen(neu.pfad)
                  throw new Error(t('settings.logLeer'))
                }).then(() => {}).catch(e => toast(e.message, 'err'))}
              >
                {t('dashboard.updateProtokoll')}
              </button>
              <button className="btn sm" onClick={() => setUpdateFrage(false)}>{t('backup.abort')}</button>
            </div>
          ) : (
            <div className="inline" style={{ margin: '8px 12px' }}>
              <select
                value={buildProfil}
                onChange={e => {
                  const v = e.target.value
                  setBuildProfil(v)
                  try { localStorage.setItem('panel:buildProfile', v) } catch (_) {}
                }}
                style={{ width: 120 }}
                title={t('dashboard.buildProfilHint')}
              >
                <option value="full">{t('dashboard.profilFull')}</option>
                <option value="balanced">{t('dashboard.profilBalanced')}</option>
                <option value="background">{t('dashboard.profilBackground')}</option>
              </select>
              <button className="btn primary sm" onClick={async () => { setUpdateFrage(true); try { const z = await api.system.spielerOnline(); if (z && typeof z.online === 'number') setOnlineFrage(z.online) } catch (_) {} }}>
                {t('dashboard.updateJetzt')}
              </button>
              {updateInfo.commits && updateInfo.commits.length ? (
                <details>
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>{t('dashboard.updateChangelogKurz', { n: updateInfo.commits.length })}</summary>
                  <div className="mono" style={{ fontSize: 11.5, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                    {updateInfo.commits.map((z, i) => <div key={i}>{z}</div>)}
                  </div>
                </details>
              ) : null}
            </div>
          )
        ) : null}
        {updateInfo && updateInfo.clientData && !updateInfo.clientData.aktuell && !updateLaeuft ? (
          <div className="inline" style={{ margin: '8px 12px', flexWrap: 'wrap' }}>
            <span className="warn-box" style={{ padding: '6px 10px' }}>
              {t('dashboard.clientAlt', {
                geladen: updateInfo.clientData.geladen || '?',
                remote: updateInfo.clientData.remote || '?'
              })}
            </span>
            <button className="btn sm" onClick={clientDatenStarten} disabled={clientBusy}>
              {clientBusy ? t('dashboard.clientLaeuft') : t('dashboard.clientAktualisieren')}
            </button>
          </div>
        ) : null}
        {updateFrage && onlineFrage != null ? (
          <div style={{ margin: '0 12px 8px' }}>
            <span className={onlineFrage > 0 ? 'warn-box' : 'ok-box'} style={{ padding: '6px 10px' }}>
              {onlineFrage > 0 ? t('dashboard.updateOnlineWarn', { n: onlineFrage }) : t('dashboard.updateOnlineLeer')}
            </span>
          </div>
        ) : null}
      </div>

      {migration && !migration.gesehen ? (
        <div className="card migration-card">
          <div className="card-head">
            <h3>{t('dashboard.migrationTitle')}</h3>
            <div className="inline">
              <button className="btn sm" onClick={() => (window.location.hash = '#/config')}>{t('dashboard.migrationOpen')}</button>
              <button
                className="btn sm"
                onClick={() => api.installer.migrationGesehen().then(() => setMigration(m => m ? { ...m, gesehen: true } : m)).catch(() => {})}
              >
                {t('dashboard.migrationDismiss')}
              </button>
            </div>
          </div>
          <div className="card-body">
            <div style={{ marginBottom: 6 }}>
              {t('dashboard.migrationHint', { n: migration.dateien.reduce((s, d) => s + d.anzahl, 0) })}
            </div>
            {migration.dateien.map(d => (
              <details key={d.datei} style={{ marginTop: 4 }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                  {d.datei} · {d.anzahl}
                </summary>
                <div className="mono" style={{ fontSize: 11.5, marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                  {d.keys.join(', ')}
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid cols-4">
        <div className="stat">
          <div className="label">{t('app.chips.world')}</div>
          <div className={`value ${world.running ? (world.phase === 'starting' ? 'gold' : 'green') : 'red'}`}>
            {world.running ? (world.phase === 'starting' ? t('app.status.starting') : t('app.status.on')) : t('app.status.off')}
          </div>
          <div className="sub">{world.pid ? `PID ${world.pid}` : t('dashboard.notStarted')}</div>
        </div>
        <div className="stat">
          <div className="label">{t('app.chips.auth')}</div>
          <div className={`value ${auth.running ? (auth.phase === 'starting' ? 'gold' : 'green') : 'red'}`}>
            {auth.running ? (auth.phase === 'starting' ? t('app.status.starting') : t('app.status.on')) : t('app.status.off')}
          </div>
          <div className="sub">{auth.pid ? `PID ${auth.pid}` : t('dashboard.notStarted')}</div>
        </div>
        <div className="stat">
          <div className="label">{t('app.chips.db')}</div>
          <div className={`value ${dbOk ? 'green' : 'red'}`}>{dbOk ? t('app.status.on') : t('app.status.off')}</div>
          <div className="sub">{stats ? t('dashboard.accountsShort', { count: stats.accounts }) : t('dashboard.notConnected')}</div>
        </div>
        <div className="stat">
          <div className="label">{t('dashboard.playersOnlineShort')}</div>
          <div className="value gold">{online.length}</div>
          <div className="sub">
            {/*
             * Bei Servern mit Playerbots sagt "1500 online" nichts - wenn
             * echte Spieler dazwischen sind, steht hier, wie viele es sind.
             */}
            {stats && stats.onlineEchte != null && stats.onlineEchte < online.length
              ? t('dashboard.davonEchte', { count: stats.onlineEchte })
              : (stats ? t('dashboard.charactersTotal', { count: stats.characters }) : '—')}
          </div>
        </div>
      </div>

      {/*
        * Online-Verlauf: die Uebersicht kannte bisher nur "jetzt". Diese
        * Karte zeigt, wann tatsaechlich etwas los war - und ob der Server
        * waechst oder einschlaeft.
        */}
      {statistik ? (
        <div className="card">
          <div className="card-head">
            <h3>{t('dashboard.onlineHistory')}</h3>
            <button className="btn sm" onClick={() => (window.location.hash = '#/online')}>
              {t('dashboard.onlineHistoryOpen')}
            </button>
          </div>          <div className="card-body">
            <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <span className="muted">{t('dashboard.onlinePeakToday')} </span>
                <strong>{statistik.heute ? statistik.heute.peak : '—'}</strong>
              </div>
              <div>
                <span className="muted">{t('dashboard.onlineAvgToday')} </span>
                <strong>{statistik.heute ? statistik.heute.durchschnitt : '—'}</strong>
              </div>
              <div>
                <span className="muted">{t('dashboard.onlineRecord')} </span>
                <strong>{statistik.rekord ? statistik.rekord.peak : '—'}</strong>
              </div>
              <div>
                <span className="muted">{t('dashboard.onlineSamples')} </span>
                <strong>{statistik.messungen}</strong>
              </div>
            </div>
            {statistik.tage && statistik.tage.length ? (
              <div className="spark-bars">
                {statistik.tage.map(g => {
                  const max = Math.max(1, ...statistik.tage.map(x => x.peak))
                  return (
                    <div key={g.datum} className="spark-col" title={`${g.datum} · ${t('dashboard.onlinePeak', { n: g.peak })}`}>
                      <div className="spark-bar" style={{ height: `${Math.max(4, Math.round((g.peak / max) * 100))}%` }} />
                      <span>{g.datum.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="hint">{t('dashboard.onlineNoData')}</div>
            )}
          </div>
        </div>
      ) : null}

      <NaechsteAufgaben wartung={wartung} backupInfo={backupInfo} />

      <details className="card details-card">
        <summary className="card-head">
          <h3>{t('dashboard.moreMetrics')}</h3>
        </summary>
        <div className="card-body">
          <div className="grid cols-4">
        {/*
         * Was ist im Panel eingestellt?
         *
         * Ohne diese Kachel sieht man auf der Uebersicht nur "1500
         * online" - und nicht, dass alle 96 Raten auf Standard stehen und
         * von 76 Modulen nur 38 laufen.
         */}
        <div className="stat clickable" onClick={() => (window.location.hash = '#/rates')}>
          <div className="label">{t('dashboard.ratesTitle')}</div>
          <div className={`value ${stats?.ratenGeaendert ? 'gold' : 'green'}`}>
            {stats ? t('dashboard.ratesChanged', { count: stats.ratenGeaendert }) : '—'}
          </div>
          <div className="sub">
            {stats ? t('dashboard.ratesTotal', { count: stats.ratenGesamt }) : '—'}
          </div>
        </div>
        <div className="stat clickable" onClick={() => (window.location.hash = '#/modules')}>
          <div className="label">{t('dashboard.modulesTitle')}</div>
          <div className="value green">
            {stats ? t('dashboard.modulesActive', { count: stats.moduleAktiv }) : '—'}
          </div>
          <div className="sub">
            {stats ? t('dashboard.modulesTotal', { count: stats.moduleGesamt, off: stats.moduleAus }) : '—'}
          </div>
        </div>
        {/*
         * Letzte Sicherung: ohne diese Kachel sieht man "nie gesichert"
         * erst auf der Backup-Seite - also praktisch nie.
         */}
        {(() => {
          const satz = backupInfo && backupInfo.set
          const tage = satz
            ? Math.floor((Date.now() - new Date(satz.created).getTime()) / 86400000)
            : null
          const alt = satz && tage > 7
          return (
            <div className="stat clickable" onClick={() => (window.location.hash = '#/backup')}>
              <div className="label">{t('dashboard.backupTitle')}</div>
              <div className={`value ${!satz || alt ? 'red' : backupInfo && !backupInfo.auto ? 'gold' : 'green'}`}>
                {satz
                  ? (tage < 1 ? t('dashboard.backupHeute') : t('dashboard.backupVorTagen', { tage }))
                  : t('dashboard.backupKeine')}
              </div>
              <div className="sub">
                {backupInfo
                  ? (backupInfo.auto ? t('dashboard.backupAutoAn') : t('dashboard.backupAutoAus'))
                  : '—'}
              </div>
              <button
                className="btn sm"
                style={{ marginTop: 6 }}
                disabled={sichert}
                onClick={async e => {
                  e.stopPropagation()
                  setSichert(true)
                  try {
                    const r = await api.backup.create()
                    toast(t('backup.done', { name: r.stamp }), 'ok')
                    load()
                  } catch (err) {
                    toast(err.message, 'err')
                  } finally {
                    setSichert(false)
                  }
                }}
              >
                {sichert ? t('dashboard.backupLaeuft') : t('dashboard.backupJetzt')}
              </button>
            </div>
          )
        })()}
        {/*
         * Bots sind auf diesem Server der größte Posten - "1.500 online"
         * gehört auf die erste Seite, nicht nur auf die Bot-Seite.
         */}
        <div className="stat clickable" onClick={() => (window.location.hash = '#/bots')}>
          <div className="label">{t('dashboard.botsTitle')}</div>
          <div className="value green">
            {stats && stats.onlineEchte != null
              ? formatNumber(Math.max(0, stats.online - stats.onlineEchte))
              : '—'}
          </div>
          <div className="sub">{stats ? t('dashboard.botsOf', { count: formatNumber(stats.characters) }) : '—'}</div>
        </div>
          </div>
        </div>
      </details>

      <details className="card details-card">
        <summary className="card-head">
          <h3>{t('dashboard.systemDetails')}</h3>
        </summary>
        <div className="details-body">
          <DiagnoseCard />

      <GesundheitsKarte />

      {/*
        * Speicherplatz-Aufstellung + Auffälligkeiten: WO geht der Platz
        * hin, und was haben die Serverlogs zu meckern? Beides beantwortet
        * die ueblichen "warum geht nichts mehr?"-Fragen ohne Graben.
        */}
      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h3>{t('dashboard.platzTitle')}</h3>
            {platz && platz.ok ? <span className="muted">{t('dashboard.platzFree', { gb: platz.freiGb.toFixed(1) })}</span> : null}
          </div>
          <div className="card-body">
            {platzAufstellung && platzAufstellung.anteile && platzAufstellung.anteile.length ? (
              <table>
                <tbody>
                  {platzAufstellung.anteile.map(a => (
                    <tr key={a.key}>
                      <td className="muted">{t(`dashboard.platz${a.key.charAt(0).toUpperCase() + a.key.slice(1)}`)}</td>
                      <td style={{ textAlign: 'right' }}>{a.mb} MB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted">{t('dashboard.platzLeer')}</div>
            )}
            {dbGroessen ? (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                {t('dashboard.dbGroessen')}{' '}
                {['auth', 'chars', 'world', 'bots']
                  .map(k => (dbGroessen[k] >= 0 ? `${k} ${formatNumber(dbGroessen[k])} MB` : ''))
                  .filter(Boolean)
                  .join(' · ')}
                {fragmentierung ? (() => {
                  const sum = ['auth', 'chars', 'world', 'bots'].reduce((a, k) => a + Math.max(0, Number(fragmentierung[k]) || 0), 0)
                  return sum >= 10 ? ` · ${t('dashboard.fragmentierung', { mb: formatNumber(sum) })}` : null
                })() : null}
              </div>
            ) : null}
            <div className="inline mt">
              <button className="btn sm" onClick={downloadsRaeumen} disabled={raeumt}>
                {t('dashboard.platzRaeumen')}
              </button>
              {platzAufstellung && platzAufstellung.pdb && platzAufstellung.pdb.length ? (
                <button
                  className="btn sm"
                  onClick={pdbRaeumen}
                  disabled={raeumt}
                  title={t('dashboard.platzPdbHint')}
                >
                  {t('dashboard.platzPdb')} ({platzAufstellung.pdb.reduce((a, p) => a + p.mb, 0)} MB)
                </button>
              ) : null}
              <span className="hint">{t('dashboard.platzRaeumenHint')}</span>
              <button className="btn sm" onClick={logsRaeumen} disabled={raeumt} title={t('dashboard.platzLogsHint')}>
                {t('dashboard.platzLogsRaeumen')}
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>{t('dashboard.auffaelligkeitenTitle')}</h3></div>
          <div className="card-body">
            {!auffaelligkeiten || !auffaelligkeiten.length ? (
              <div className="muted">{t('dashboard.auffaelligkeitenLeer')}</div>
            ) : (
              <div className="mono" style={{ fontSize: 12, maxHeight: 160, overflow: 'auto' }}>
                {auffaelligkeiten.map((a, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <strong>{a.quelle}:</strong> {a.zeile}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t('dashboard.onlineNow')}</h3>
          <button className="btn sm" onClick={() => (window.location.hash = '#/online')}>{t('dashboard.showAll')}</button>
        </div>
        <div className="card-body tight">
          {!online.length ? (
            <div className="empty">{t('dashboard.nobodyOnline')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.name')}</th><th>{t('dashboard.colClass')}</th><th>{t('dashboard.colRace')}</th>
                    <th className="num">{t('dashboard.colLevel')}</th><th>{t('dashboard.colAccount')}</th>
                    <th>{t('dashboard.colPlaytime')}</th><th>{t('dashboard.colZone')}</th>
                  </tr>
                </thead>
                <tbody>
                  {online.slice(0, 10).map(p => (
                    <tr key={p.guid} className="clickable" onClick={() => (window.location.hash = `#/characters/${p.guid}`)}>
                      <td>
                        <strong>{p.name}</strong>{' '}
                        {p.gmlevel > 0 ? <span className="pill gm">GM{p.gmlevel}</span> : null}
                      </td>
                      <td>{className(p.classId, t)}</td>
                      <td>{raceName(p.race, t)}</td>
                      <td className="num">{p.level}</td>
                      <td>{p.username || p.account}</td>
                      <td>{formatPlaytime(p.totaltime)}</td>
                      <td className="muted">{p.zone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
        </div>
      </details>
    </>
  )
}

export default Dashboard

/* ================================================================== */
/* Nächste geplante Aufgaben                                          */
/* ================================================================== */

function NaechsteAufgaben ({ wartung, backupInfo }) {
  const { t } = useI18n()
  const eintraege = []

  if (wartung && wartung.enabled && wartung.naechsterLauf) {
    eintraege.push({ key: 'update', label: t('dashboard.taskUpdate'), when: wartung.naechsterLauf, ziel: 'options' })
  }
  if (wartung && wartung.restartAktiv && wartung.naechsterRestart) {
    eintraege.push({ key: 'restart', label: t('dashboard.taskRestart'), when: wartung.naechsterRestart, ziel: 'options' })
  }
  if (wartung && wartung.dbAktiv && wartung.naechsteDbWartung) {
    eintraege.push({ key: 'db', label: t('dashboard.taskDb'), when: wartung.naechsteDbWartung, ziel: 'options' })
  }
  if (wartung && wartung.banCleanup && wartung.naechsteBanReinigung) {
    eintraege.push({ key: 'bans', label: t('dashboard.taskBans'), when: wartung.naechsteBanReinigung, ziel: 'options' })
  }
  if (backupInfo && backupInfo.plan && backupInfo.plan.active && backupInfo.plan.intervalHours > 0) {
    const basis = backupInfo.set && backupInfo.set.created ? new Date(backupInfo.set.created).getTime() : Date.now()
    eintraege.push({
      key: 'backup',
      label: t('dashboard.taskBackup'),
      when: new Date(basis + backupInfo.plan.intervalHours * 3600000).toISOString(),
      ziel: 'backup'
    })
  }
  if (backupInfo && backupInfo.verify) {
    const jetzt = new Date()
    const naechste = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1, 4, 0, 0)
    if (naechste.getTime() <= jetzt.getTime()) naechste.setMonth(naechste.getMonth() + 1)
    eintraege.push({ key: 'verify', label: t('dashboard.taskVerify'), when: naechste.toISOString(), ziel: 'backup' })
  }

  const liste = eintraege
    .filter(e => e.when && !Number.isNaN(new Date(e.when).getTime()))
    .sort((a, b) => new Date(a.when) - new Date(b.when))

  const oeffnen = ziel => {
    if (ziel === 'backup') {
      window.location.hash = '#/backup'
      return
    }
    try { localStorage.setItem('settings.tab', 'wartung') } catch (_) {}
    window.location.hash = '#/options'
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('dashboard.taskTitle')}</h3>
        <span className="muted" style={{ fontSize: 11.5 }}>{t('dashboard.taskHint')}</span>
      </div>
      <div className="card-body tight">
        {!liste.length ? (
          <div className="empty">{t('dashboard.taskNone')}</div>
        ) : (
          liste.map(e => {
            const zeit = new Date(e.when)
            const ueberfaellig = zeit.getTime() < Date.now()
            return (
              <div
                key={e.key}
                className="inline"
                style={{
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--line-soft)',
                  cursor: 'pointer'
                }}
                role="button"
                tabIndex={0}
                onClick={() => oeffnen(e.ziel)}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    oeffnen(e.ziel)
                  }
                }}
              >
                <span>{e.label}</span>
                <span className="inline" style={{ gap: 8 }}>
                  <span className={ueberfaellig ? 'pill ban' : 'muted'} style={{ fontSize: 12 }}>
                    {ueberfaellig ? t('dashboard.taskOverdue') : ''} {zeit.toLocaleString()}
                  </span>
                  <span className="muted">›</span>
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Gesundheitscheck                                                   */
/* ================================================================== */

function GesundheitsKarte () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [ergebnis, setErgebnis] = useState(null)
  const [busy, setBusy] = useState(false)

  const pruefen = async () => {
    setBusy(true)
    try {
      setErgebnis(await api.system.gesundheitscheck())
    } catch (e) {
      setErgebnis({ ok: false, items: [{ key: 'fehler', ok: false, text: e.message }] })
    } finally {
      setBusy(false)
    }
  }

  // Einmal beim Öffnen prüfen - die Karte soll nicht leer starten.
  useEffect(() => { pruefen() }, [])

  const label = {
    pfade: t('dashboard.healthPfade'),
    db: t('dashboard.healthDb'),
    daten: t('dashboard.healthDaten'),
    soap: t('dashboard.healthSoap'),
    platz: t('dashboard.healthPlatz'),
    zustand: t('dashboard.healthZustand'),
    build: t('dashboard.healthBuild'),
    bots: t('dashboard.healthBots'),
    moduleConf: t('dashboard.healthModuleConf'),
    konten: t('dashboard.healthKonten'),
    realm: t('dashboard.healthRealm'),
    mysql: t('dashboard.healthMysql'),
    ports: t('dashboard.healthPorts'),
    fehler: t('dashboard.healthFehler')
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('dashboard.healthTitle')}</h3>
        <div className="inline">
          <button className="btn sm" onClick={pruefen} disabled={busy}>
            {busy ? t('dashboard.healthLaeuft') : t('dashboard.healthRun')}
          </button>
          {/*
           * Support-Bericht: der Diagnose-Export (R? ) war nie erreichbar -
           * Passwörter sind darin maskiert, der Bericht ist eine Datei.
           */}
          <button
            className="btn sm"
            onClick={async () => {
              try {
                const r = await api.system.diagnoseExport()
                if (r && r.ok) toast(t('dashboard.diagnoseExportOk', { pfad: r.pfad }), 'ok')
              } catch (e) {
                toast(e.message, 'err')
              }
            }}
          >
            {t('dashboard.diagnoseExport')}
          </button>
        </div>
      </div>
      <div className="card-body">
        {!ergebnis ? (
          <div className="muted">{t('dashboard.healthHint')}</div>
        ) : (
          <table>
            <tbody>
              {ergebnis.items.map(it => (
                <tr key={it.key}>
                  <td style={{ width: 30 }}>{it.ok ? '✓' : '✕'}</td>
                  <td className="muted" style={{ width: 130 }}>{label[it.key] || it.key}</td>
                  <td>{it.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}