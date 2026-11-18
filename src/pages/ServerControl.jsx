import React, { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useServerLog } from '../lib/serverLogStore'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import Modal from '../components/Modal'

// Prozessnamen sind Fachbegriffe, "Datenbank" heisst im Englischen "Database".
function useKindLabels () {
  const { t } = useI18n()
  return {
    world: t('serverControl.kindWorld'),
    auth: t('serverControl.kindAuth'),
    db: t('serverControl.kindDb')
  }
}

function colorize (stream, line) {
  if (stream === 'stderr') return 'red'
  if (stream !== 'stdout') return stream
  if (/\b(error|fatal|failed|exception|ERROR:)\b/i.test(line)) return 'red'
  if (/\b(warn|warning)\b/i.test(line)) return 'yellow'
  if (/\b(ready|started|success|accepted)\b/i.test(line)) return 'green'
  return ''
}

// Laufzeit als kurzer Text: "3 h 12 min", "5 min 40 s", "20 s"
function laufzeitText (seitIso) {
  const seit = new Date(seitIso)
  if (isNaN(seit.getTime())) return '?'
  let s = Math.max(0, Math.floor((Date.now() - seit.getTime()) / 1000))
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

/*
 * Kompakter Verweis auf die gemeinsame Konsole. Die vollstaendige
 * Live-Ausgabe, Suche und Befehlseingabe stehen auf der Konsolen-Seite.
 */
function KonsoleHinweis ({ listen, fehlerPro }) {
  const { t } = useI18n()
  const KIND_LABEL = useKindLabels()
  let treffer = null
  for (const kind of ['world', 'auth', 'db']) {
    const zeile = (listen[kind] || []).slice().reverse().find(l => colorize(l.stream, l.line) === 'red')
    if (zeile) { treffer = { kind, line: zeile.line }; break }
  }
  const gesamt = ['world', 'auth', 'db'].reduce((n, k) => n + (listen[k] || []).length, 0)
  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('serverControl.consoleHead')}</h3>
        <button className="btn sm" onClick={() => (window.location.hash = '#/console')}>
          {t('serverControl.openConsole')}
        </button>
      </div>
      <div className="card-body">
        <div className="inline" style={{ marginBottom: 8 }}>
          {['world', 'auth', 'db'].map(k => {
            const fehler = fehlerPro(listen[k])
            return (
              <span key={k} className="pill offline">
                {KIND_LABEL[k]}
                <span className="muted" style={{ marginLeft: 5 }}>{(listen[k] || []).length}</span>
                {fehler ? <span style={{ marginLeft: 5, color: 'var(--c-red)' }}>●{fehler}</span> : null}
              </span>
            )
          })}
          <span className="muted" style={{ fontSize: 11.5 }}>{t('serverControl.logKept')}</span>
        </div>
        <div className={`detail-line ${treffer ? 'hat-fehler' : ''}`}>
          {treffer
            ? <><strong>{KIND_LABEL[treffer.kind]}:</strong> <span className="mono">{treffer.line}</span></>
            : (gesamt ? t('serverControl.noErrors') : t('serverControl.logNochLeer'))}
        </div>
      </div>
    </div>
  )
}

function ServerCard ({ kind }) {
  const { t } = useI18n()
  const KIND_LABEL = useKindLabels()
  const { status, refresh, toast } = useStatus()
  const [busy, setBusy] = useState(false)
  const st = status[kind] || {}
  const running = !!st.running
  const starting = running && st.phase === 'starting'
  const logLines = useServerLog(kind)
  const logText = starting ? logLines.slice(-500).map(l => l.line).join('\n') : ''
  const fortschritt = !starting ? null
    : (/World initialized|Starting up anti-freeze|Playerbots.*[Rr]eady/i.test(logText) ? 3
      : (/Starting Map System|Loading Playerbots|Initialize Commands|Starting Game Event/i.test(logText) ? 2
        : (/Loading Modules Configuration|Using modules configuration|Using configuration file/i.test(logText) ? 1 : 0)))
  const phasen = [
    t('serverControl.phaseConfig'),
    t('serverControl.phaseModules'),
    t('serverControl.phaseWorld'),
    t('serverControl.phaseReady')
  ]

  const run = async fn => {
    setBusy(true)
    try {
      const res = await fn()
      if (res && res.ok === false) toast(res.error, 'err')
      else toast(t('serverControl.actionDone', { kind: KIND_LABEL[kind] }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{KIND_LABEL[kind]}</h3>
        <span className={`pill ${starting ? 'info' : running ? 'online' : 'offline'}`}>
          {starting ? t('serverControl.starting') : running ? t('serverControl.running') : t('serverControl.stopped')}
        </span>
      </div>
      <div className="card-body">
        <div className="inline mb0">
          <button className="btn success" disabled={busy || running} onClick={() => run(() => api.server.start(kind))}>
            {t('serverControl.start')}
          </button>
          <button className="btn danger" disabled={busy || !running} onClick={() => run(() => api.server.stop(kind))}>
            {t('serverControl.stop')}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.server.restart(kind))}>
            {t('serverControl.restart')}
          </button>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {running ? t('serverControl.pid', { pid: st.pid }) : t('serverControl.noProcess')}
          </span>
        </div>
        {running && st.seit ? (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {t('serverControl.uptime', { dauer: laufzeitText(st.seit) })}
          </div>
        ) : null}
        {kind !== 'db' && fortschritt != null ? (
          <div className="start-phasen mt">
            {phasen.map((p, i) => (
              <span key={p} className={i <= fortschritt ? 'aktiv' : ''}>{p}</span>
            ))}
          </div>
        ) : null}
        {kind !== 'db' ? (
          <div className="info-box mt" style={{ fontSize: 11.5 }}>
            {t('serverControl.stopHint1')} <span className="mono">CTRL+C</span>{' '}
            {t('serverControl.stopHint2')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/*
 * Datenbank-Karte. Bevorzugt wird ein vorhandener Windows-Dienst gesteuert,
 * weil das der Normalfall bei einer XAMPP-/MariaDB-Installation ist. Findet
 * sich kein Dienst, wird die mysqld.exe direkt gestartet.
 */
function DatabaseCard () {
  const { t } = useI18n()
  const { status, refresh, toast } = useStatus()
  const [busy, setBusy] = useState(false)
  const [services, setServices] = useState([])
  const [admin, setAdmin] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Letzte DB-Wartung (ANALYZE/OPTIMIZE) für die Anzeige
  const [letzteWartung, setLetzteWartung] = useState(null)
  useEffect(() => {
    api.system.dbWartungLetzte()
      .then(r => setLetzteWartung(r.letzte || null))
      .catch(() => {})
  }, [])

  const dbProc = status.db || {}

  const probe = async () => {
    try {
      const res = await api.mysql.services()
      setServices(res.services || [])
      setAdmin(!!res.admin)
    } catch (_) {
      setServices([])
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    probe()
    const iv = setInterval(probe, 10000)
    return () => clearInterval(iv)
  }, [])

  // Der erste laufende Dienst gilt als der aktive
  const activeService = services.find(s => s.running) || null
  const running = !!dbProc.running || !!activeService
  const starting = !!dbProc.running && dbProc.phase === 'starting'

  const act = async fn => {
    setBusy(true)
    try {
      await fn()
      toast(t('serverControl.actionDone', { kind: t('serverControl.kindDb') }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
      setTimeout(() => { probe(); refresh() }, 1500)
    }
  }

  const useService = activeService

  const start = () =>
    act(() =>
      useService
        ? api.mysql.serviceAction(activeService.name, 'start')
        : api.server.start('db').then(r => {
            if (r && r.ok === false) throw new Error(r.error)
          })
    )
  const stop = () =>
    act(() =>
      useService
        ? api.mysql.serviceAction(activeService.name, 'stop')
        : api.server.stop('db')
    )
  const restart = () =>
    act(() =>
      useService
        ? api.mysql.serviceAction(activeService.name, 'restart')
        : api.server.restart('db')
    )

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('serverControl.dbTitle')}</h3>
        <span className={`pill ${starting ? 'info' : running ? 'online' : 'offline'}`}>
          {starting ? t('serverControl.starting') : running ? t('serverControl.running') : t('serverControl.stopped')}
        </span>
      </div>
      <div className="card-body">
        <div className="inline mb0">
          <button className="btn success" disabled={busy || running} onClick={start}>{t('serverControl.start')}</button>
          <button className="btn danger" disabled={busy || !running} onClick={stop}>{t('serverControl.stop')}</button>
          <button className="btn primary" disabled={busy} onClick={restart}>{t('serverControl.restart')}</button>
          <button className="btn sm" disabled={busy} onClick={() => { probe(); refresh() }}>{t('common.refresh')}</button>
          {/*
           * Datenbank-Wartung: ANALYZE (sicher) und OPTIMIZE (rebuildet,
           * kann Minuten dauern). Nach großen Übernahmen sinnvoll.
           */}
          <button
            className="btn sm"
            disabled={busy || !running}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await api.system.dbWartung({ modus: 'analyze' })
                setLetzteWartung({ modus: r.modus, zeit: new Date().toISOString(), tabellen: r.tabellen, dauerSek: r.dauerSek })
                toast(t('serverControl.dbAnalyzeOk', { n: r.tabellen, s: r.dauerSek }), r.fehler && r.fehler.length ? 'warn' : 'ok')
              } catch (e) {
                toast(e.message, 'err')
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('serverControl.dbAnalyze')}
          </button>
          <button
            className="btn sm"
            disabled={busy || !running}
            onClick={async () => {
              if (!window.confirm(t('serverControl.dbOptimizeFrage'))) return
              setBusy(true)
              try {
                const r = await api.system.dbWartung({ modus: 'optimize' })
                setLetzteWartung({ modus: r.modus, zeit: new Date().toISOString(), tabellen: r.tabellen, dauerSek: r.dauerSek })
                toast(t('serverControl.dbOptimizeOk', { n: r.tabellen, s: r.dauerSek }), r.fehler && r.fehler.length ? 'warn' : 'ok')
              } catch (e) {
                toast(e.message, 'err')
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('serverControl.dbOptimize')}
          </button>
        </div>

        {letzteWartung ? (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {t('serverControl.dbLetzte', {
              modus: letzteWartung.modus,
              zeit: new Date(letzteWartung.zeit).toLocaleString(),
              n: letzteWartung.tabellen,
              s: letzteWartung.dauerSek
            })}
          </div>
        ) : null}

        <div className="mt" style={{ fontSize: 12 }}>
          <div className="muted">{t('serverControl.controlVia')}{' '}<strong style={{ color: '#d7dce2' }}>
            {useService
              ? t('serverControl.winService', { name: activeService.displayName || activeService.name })
              : dbProc.running
                ? t('serverControl.directMode')
                : services.length
                  ? t('serverControl.notStarted')
                  : t('serverControl.noneFound')}
          </strong></div>

          {dbProc.running && dbProc.seit ? (
            <div className="muted" style={{ fontSize: 11.5 }}>
              {t('serverControl.uptime', { dauer: laufzeitText(dbProc.seit) })}
            </div>
          ) : null}

          {!loaded ? (
            <div className="hint">{t('serverControl.searching')}</div>
          ) : null}

          {loaded && !services.length ? (
            <div className="info-box mt" style={{ fontSize: 11.5 }}>
              {t('serverControl.noServiceHint1')}{' '}
              <strong>{t('serverControl.dbPathLabel')}</strong>{t('serverControl.noServiceHint2')}
            </div>
          ) : null}

          {services.length && !admin ? (
            <div className="info-box mt" style={{ fontSize: 11.5 }}>
              {t('serverControl.adminHint1')} <span className="mono">mysqld.exe</span>
              {t('serverControl.adminHintEnd')}
            </div>
          ) : null}

          {services.length && admin ? (
            <div className="hint" style={{ marginTop: 6 }}>
              {t('serverControl.foundServices')}{' '}
              {services.map(s => (
                <span key={s.name} className="mono" style={{ marginRight: 10 }}>
                  {s.name} ({s.status})
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/*
 * Startet alle Komponenten in fester Reihenfolge:
 * Datenbank -> nach <delay> s Authserver -> nach <delay> s Worldserver
 */
const SEQUENCE = [
  { key: 'db', labelKey: 'serverControl.kindDb', icon: '🗄' },
  { key: 'auth', labelKey: 'serverControl.kindAuth', icon: '🔑' },
  { key: 'world', labelKey: 'serverControl.kindWorld', icon: '🌍' }
]

/*
 * Ressourcen der drei Prozesse: RAM und bisher verbrauchte CPU-Zeit.
 * "Warum ist der Server langsam?" beantwortet das, ohne den Task-Manager
 * zu oeffnen.
 */
function MetrikenCard () {
  const { t } = useI18n()
  const KIND_LABEL = useKindLabels()
  const [werte, setWerte] = useState({ world: null, auth: null, db: null })
  const [verlauf, setVerlauf] = useState(null)

  useEffect(() => {
    let aktiv = true
    const laden = () => {
      api.server.metriken().then(w => {
        if (aktiv) setWerte(w || {})
      }).catch(() => {})
    }
    laden()
    const iv = setInterval(laden, 5000)
    return () => { aktiv = false; clearInterval(iv) }
  }, [])

  useEffect(() => {
    let aktiv = true
    const laden = () => api.systemverlauf.get()
      .then(r => { if (aktiv) setVerlauf(r) })
      .catch(() => {})
    laden()
    const iv = setInterval(laden, 60000)
    return () => { aktiv = false; clearInterval(iv) }
  }, [])

  const stunden = (verlauf && verlauf.stunden) || []
  const letzte24 = stunden.slice(-24)
  const maxRam = Math.max(1, ...letzte24.map(e => Number(e.worldRam) || 0))

  return (
    <div className="card">
      <div className="card-head"><h3>{t('serverControl.metricsTitle')}</h3></div>
      <div className="card-body">
        <div className="grid cols-3">
          {['world', 'auth', 'db'].map(kind => {
            const w = werte[kind]
            const min = w && w.seitMs ? Math.max(0, Math.round((Date.now() - w.seitMs) / 60000)) : null
            return (
              <div className="stat" key={kind} style={{ padding: '9px 11px' }}>
                <div className="label">{KIND_LABEL[kind]}</div>
                <div className="value" style={{ fontSize: 14, marginTop: 4 }}>
                  {w
                    ? t('serverControl.metricsWerte', { ram: w.ramMb, cpu: w.cpuSek, min: min === null ? '—' : min })
                    : <span className="muted">{t('serverControl.metricsAus')}</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--line-soft)', marginTop: 12, paddingTop: 10 }}>
          <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ fontSize: 12.5 }}>{t('serverControl.verlaufTitle')}</strong>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {verlauf ? t('serverControl.verlaufSamples', { n: verlauf.messungen }) : '—'}
            </span>
          </div>
          {!letzte24.length ? (
            <div className="hint">{t('serverControl.verlaufEmpty')}</div>
          ) : (
            <>
              <div className="inline" style={{ gap: 16, marginBottom: 6, fontSize: 12, flexWrap: 'wrap' }}>
                <span className="muted">{t('serverControl.verlaufRam', { mb: verlauf.ramMax24 })}</span>
                <span className="muted">{t('serverControl.verlaufCpu', { p: verlauf.cpuMax24 })}</span>
                <span className="muted">{t('serverControl.verlaufDb', { mb: verlauf.aktuell ? verlauf.aktuell.dbMb : 0, diff: verlauf.dbWachstum })}</span>
                <span className="muted">{t('serverControl.verlaufDisk', { gb: verlauf.freiMin == null ? '—' : verlauf.freiMin })}</span>
              </div>
              <div className="spark-bars" style={{ height: 60 }}>
                {letzte24.map(e => (
                  <div
                    key={e.stunde}
                    className="spark-col"
                    title={`${new Date(e.stunde).toLocaleString()} · ${e.worldRam} MB`}
                  >
                    <div className="spark-bar" style={{ height: `${Math.max(3, Math.round(((Number(e.worldRam) || 0) / maxRam) * 100))}%` }} />
                  </div>
                ))}
              </div>
              <div className="hint">{t('serverControl.verlaufLegend')}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StartAllCard () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [delay, setDelay] = useState(10)
  const [waitDb, setWaitDb] = useState(false)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [phases, setPhases] = useState({ db: 'idle', auth: 'idle', world: 'idle' })
  // Automatischer Neustart bei Crash - Einstellung liegt in der config.json
  const [autoRestart, setAutoRestart] = useState(false)
  // Komponenten automatisch starten, wenn das Panel öffnet
  const [autoStartAuth, setAutoStartAuth] = useState(false)
  const [autoStartWorld, setAutoStartWorld] = useState(false)
  // Dienst-Waechter: Portueberwachung und optionaler Neustart bei Haenger
  const [watchdog, setWatchdog] = useState({ enabled: true, autoRestart: false })
  const boxRef = useRef(null)

  useEffect(() => {
    let aktiv = true
    api.settings.get().then(cfg => {
      if (!aktiv) return
      setAutoRestart(!!(cfg.server && cfg.server.autoRestart))
      setAutoStartAuth(!!(cfg.server && cfg.server.autoStartAuth))
      setAutoStartWorld(!!(cfg.server && cfg.server.autoStartWorld))
    }).catch(() => {})
    api.server.watchdog().then(w => {
      if (aktiv && w) setWatchdog({ enabled: w.enabled !== false, autoRestart: w.autoRestart === true })
    }).catch(() => {})
    return () => { aktiv = false }
  }, [])

  const waechterSetzen = async (patch) => {
    const neu = { ...watchdog, ...patch }
    setWatchdog(neu)
    try {
      await api.server.watchdogSetzen(neu)
      toast(
        patch.autoRestart != null
          ? (patch.autoRestart ? t('serverControl.watchdogRestartOn') : t('serverControl.watchdogRestartOff'))
          : (patch.enabled ? t('serverControl.watchdogOn') : t('serverControl.watchdogOff')),
        'ok'
      )
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const schalteOption = async (schluessel, wert, setWert) => {
    setWert(wert)
    try {
      await api.settings.save({ server: { [schluessel]: wert } })
      toast(
        schluessel === 'autoRestart'
          ? (wert ? t('serverControl.autoRestartOn') : t('serverControl.autoRestartOff'))
          : (wert ? t('serverControl.autoStartOn') : t('serverControl.autoStartOff')),
        'ok'
      )
    } catch (e) {
      toast(e.message)
    }
  }

  useEffect(() => {
    if (!window.api || typeof window.api.on !== 'function') return undefined
    return window.api.on('server:startAll', p => {
      if (p.step === 'state') {
        setBusy(!!p.running)
        return
      }
      if (p.step === 'begin') {
        setLog([])
        setPhases({ db: 'idle', auth: 'idle', world: 'idle' })
      }
      if (['db', 'auth', 'world'].includes(p.step)) {
        setPhases(prev => ({ ...prev, [p.step]: p.state }))
      }
      setLog(l => [...l, { ...p, id: `${Date.now()}-${Math.random()}` }].slice(-80))
    })
  }, [])

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [log])

  const start = async () => {
    setBusy(true)
    setLog([])
    setPhases({ db: 'idle', auth: 'idle', world: 'idle' })
    try {
      await api.server.startAll({ delay: Number(delay), waitDb })
    } catch (e) {
      toast(e.message, 'err')
      setBusy(false)
    }
  }

  const stopAll = async () => {
    try {
      await api.server.stopAll({ stopDb: true })
      toast(t('serverControl.stopAllToast'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Rueckfrage vor "Alles beenden".
   *
   * Der Knopf beendet Authserver, Worldserver UND die Datenbank - in
   * umgekehrter Reihenfolge zum Start. Ohne Rueckfrage ist das ein
   * Klick, und danach ist der Server weg, samt allem, was die Bots
   * gerade speichern wollten.
   */
  const [stopAllFrage, setStopAllFrage] = useState(false)

  const stateKey = { idle: 'serverControl.stateWaiting', start: 'serverControl.stateStart', ok: 'serverControl.stateOk', fail: 'serverControl.stateFail', ready: 'serverControl.stateReady', wait: 'serverControl.stateWarn' }
  const stateColor = { start: 'var(--c-blue)', ok: 'var(--c-green)', fail: 'var(--c-red)', ready: 'var(--c-cyan)', wait: 'var(--c-yellow)' }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('serverControl.startAllTitle')}</h3>
        {busy ? <span className="pill info">{t('serverControl.sequenceRunning')}</span> : <span className="pill offline">{t('serverControl.stateReady')}</span>}
      </div>
      <div className="card-body">
        <div className="inline mb0" style={{ marginBottom: 12 }}>
          <button className="btn success" disabled={busy} onClick={start}>
            {t('serverControl.startAll')}
          </button>
          <button className="btn danger" onClick={() => setStopAllFrage(true)}>
            {t('serverControl.stopAll')}
          </button>
          {/*
           * Alltag nach Konfig-Änderungen: alles einmal neu (DB → Auth → World).
           * Vorher musste man stoppen, warten und getrennt starten.
           */}
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.server.stopAll({ stopDb: true })
                await new Promise(r => setTimeout(r, 2000))
                await api.server.startAll({ delay: Number(delay), waitDb })
              } catch (e) {
                toast(e.message, 'err')
                setBusy(false)
              }
            }}
          >
            {t('serverControl.restartAll')}
          </button>

          <div className="field" style={{ margin: 0, width: 92 }}>
            <label>{t('serverControl.delayLabel')}</label>
            <input
              type="number"
              min="0"
              max="300"
              value={delay}
              onChange={e => setDelay(Math.max(0, Number(e.target.value)))}
            />
          </div>
          <label className="check-row" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={waitDb} onChange={e => setWaitDb(e.target.checked)} />
            {t('serverControl.waitDb')}
          </label>
          <label className="check-row" style={{ marginTop: 14, marginLeft: 16 }} title={t('serverControl.autoRestartHint')}>
            <input type="checkbox" checked={autoRestart} onChange={e => schalteOption('autoRestart', e.target.checked, setAutoRestart)} />
            {t('serverControl.autoRestart')}
          </label>
          <label className="check-row" style={{ marginTop: 14, marginLeft: 16 }} title={t('serverControl.autoStartHint')}>
            <input type="checkbox" checked={autoStartWorld} onChange={e => schalteOption('autoStartWorld', e.target.checked, setAutoStartWorld)} />
            {t('serverControl.autoStartWorld')}
          </label>
          <label className="check-row" style={{ marginTop: 14, marginLeft: 16 }} title={t('serverControl.autoStartHint')}>
            <input type="checkbox" checked={autoStartAuth} onChange={e => schalteOption('autoStartAuth', e.target.checked, setAutoStartAuth)} />
            {t('serverControl.autoStartAuth')}
          </label>
        </div>
        {/*
         * Der Waechter greift, wenn der Prozess weiterlaeuft, aber kein
         * Port mehr offen ist. Der automatische Neustart ist bewusst
         * getrennt: erst nur melden ist der sichere Standard.
         */}
        <div className="inline" style={{ marginBottom: 12 }}>
          <label className="check-row" style={{ margin: 0 }} title={t('serverControl.watchdogHint')}>
            <input type="checkbox" checked={!!watchdog.enabled} onChange={e => waechterSetzen({ enabled: e.target.checked })} />
            {t('serverControl.watchdog')}
          </label>
          <label className="check-row" style={{ margin: '0 0 0 16px' }} title={t('serverControl.watchdogRestartHint')}>
            <input
              type="checkbox"
              checked={!!watchdog.autoRestart}
              disabled={!watchdog.enabled}
              onChange={e => waechterSetzen({ autoRestart: e.target.checked })}
            />
            {t('serverControl.watchdogRestart')}
          </label>
          <span className="hint">{t('serverControl.watchdogHint')}</span>
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          {SEQUENCE.map((s, i) => (
            <div className="stat" key={s.key} style={{ padding: '9px 11px' }}>
              <div className="label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>{i + 1}.</span>
                <span>{s.icon}</span>
                <span>{t(s.labelKey)}</span>
              </div>
              <div
                className="value"
                style={{
                  fontSize: 15,
                  marginTop: 4,
                  color: stateColor[phases[s.key]] || 'var(--text-dim)'
                }}
              >
                {t(stateKey[phases[s.key]] || 'serverControl.stateWaiting')}
              </div>
            </div>
          ))}
        </div>

        <div className="console" ref={boxRef} style={{ height: 150 }}>
          {!log.length ? (
            <div className="line dim">
              {t('serverControl.sequence', { delay })}
            </div>
          ) : (
            log.map(l => (
              <div key={l.id} className={`line ${l.state === 'fail' ? 'red' : l.state === 'ok' ? 'green' : l.state === 'wait' ? 'yellow' : 'cyan'}`}>
                {l.message}
              </div>
            ))
          )}
        </div>

        <div className="info-box mt" style={{ fontSize: 11.5 }}>
          {t('serverControl.sequenceHint')}
        </div>
      </div>

      {/*
       * Rueckfrage vor "Alles beenden".
       *
       * Beendet werden Authserver, Worldserver und die Datenbank - in
       * umgekehrter Reihenfolge zum Start, damit der Worldserver noch
       * sauber speichern kann. Eben deshalb wird die Datenbank zuletzt
       * beendet: waere sie vorher weg, verliert der Worldserver den
       * Stand.
       *
       * Der Knopf und diese Rueckfrage muessen in derselben Komponente
       * stehen - sonst sieht der Knopf den Zustand nicht. Das war der
       * Fehler in der ersten Fassung: der Knopf war in StartAllCard,
       * die Rueckfrage in ServerControl.
       */}
      {stopAllFrage ? (
        <Modal
          title={t('serverControl.stopAllTitle')}
          onClose={() => setStopAllFrage(false)}
          footer={
            <>
              <button className="btn" onClick={() => setStopAllFrage(false)}>{t('serverControl.stopAllAbort')}</button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  setStopAllFrage(false)
                  stopAll()
                }}
              >
                {t('serverControl.stopAllConfirm')}
              </button>
            </>
          }
        >
          <div className="error-box">{t('serverControl.stopAllWarning')}</div>
          <div style={{ marginTop: 12 }}>
            <div>{t('serverControl.stopAllList')}</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12.5 }}>
              <li>{t('serverControl.kindAuth')}</li>
              <li>{t('serverControl.kindWorld')}</li>
              <li>{t('serverControl.kindDb')}</li>
            </ul>
          </div>
          <div className="info-box" style={{ fontSize: 12, marginTop: 10 }}>
            {t('serverControl.stopAllHint')}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function ServerControl () {
  const { t } = useI18n()
  const KIND_LABEL = useKindLabels()
  // Zwei Ansichten statt einer langen Seite: Steuerung, Ressourcen.
  const [ansicht, setAnsicht] = useState('steuerung')
  const [ereignisse, setEreignisse] = useState([])
  const [verlaufDienst, setVerlaufDienst] = useState('alle')
  const [verlaufArt, setVerlaufArt] = useState('alle')
  /*
   * Alle drei Log-Ströme abonnieren: sonst blieben die Zähler an den Tabs
   * stehen, und man sieht nicht, dass im anderen Tab gerade Errors kommen.
   */
  const worldLines = useServerLog('world')
  const authLines = useServerLog('auth')
  const dbLines = useServerLog('db')
  const listen = { world: worldLines, auth: authLines, db: dbLines }
  const fehlerPro = liste => (liste || []).reduce((n, l) => n + (colorize(l.stream, l.line) === 'red' ? 1 : 0), 0)

  useEffect(() => {
    if (ansicht !== 'verlauf') return undefined
    const laden = () => api.server.ereignisse()
      .then(r => setEreignisse((r && r.liste) || []))
      .catch(() => setEreignisse([]))
    laden()
    const iv = setInterval(laden, 10000)
    return () => clearInterval(iv)
  }, [ansicht])

  const ereignisArt = art => t(`serverControl.event${art.charAt(0).toUpperCase()}${art.slice(1)}`)
  const gefilterteEreignisse = ereignisse.filter(e =>
    (verlaufDienst === 'alle' || e.kind === verlaufDienst) &&
    (verlaufArt === 'alle' || e.art === verlaufArt)
  )
  const abstuerze24h = ereignisse.filter(e =>
    e.art === 'crash' && Date.now() - new Date(e.zeit).getTime() < 24 * 60 * 60 * 1000
  ).length

  const verlaufExportieren = () => {
    try {
      const text = gefilterteEreignisse
        .map(e => `[${new Date(e.zeit).toLocaleString()}] ${KIND_LABEL[e.kind] || e.kind} · ${ereignisArt(e.art)} · ${e.text}`)
        .join('\r\n')
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `server-verlauf-${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (_) {}
  }

  return (
    <>
      <div className="tabs">
        <button className={`tab ${ansicht === 'steuerung' ? 'active' : ''}`} onClick={() => setAnsicht('steuerung')}>
          {t('serverControl.tabControl')}
        </button>
        <button className={`tab ${ansicht === 'ressourcen' ? 'active' : ''}`} onClick={() => setAnsicht('ressourcen')}>
          {t('serverControl.tabResources')}
        </button>
        <button className={`tab ${ansicht === 'verlauf' ? 'active' : ''}`} onClick={() => setAnsicht('verlauf')}>
          {t('serverControl.tabHistory')}
        </button>
      </div>

      {ansicht === 'steuerung' ? (
        <>
          <StartAllCard />

          <div className="grid cols-3">
            <ServerCard kind="world" />
            <ServerCard kind="auth" />
            <DatabaseCard />
          </div>

          <KonsoleHinweis listen={listen} fehlerPro={fehlerPro} />
        </>
      ) : null}

      {ansicht === 'ressourcen' ? <MetrikenCard /> : null}

      {ansicht === 'verlauf' ? (
        <div className="card">
          <div className="card-head">
            <h3>{t('serverControl.historyTitle')}</h3>
            <div className="inline">
              <span className={`pill ${abstuerze24h ? 'ban' : 'offline'}`}>
                {t('serverControl.historyCrashes', { n: abstuerze24h })}
              </span>
              <button className="btn sm" onClick={verlaufExportieren} disabled={!gefilterteEreignisse.length}>
                {t('serverControl.historyExport')}
              </button>
            </div>
          </div>
          <div className="card-body tight">
            <div className="inline" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)' }}>
              <select value={verlaufDienst} onChange={e => setVerlaufDienst(e.target.value)} style={{ width: 160 }}>
                <option value="alle">{t('serverControl.historyAllServices')}</option>
                <option value="world">{KIND_LABEL.world}</option>
                <option value="auth">{KIND_LABEL.auth}</option>
                <option value="db">{KIND_LABEL.db}</option>
              </select>
              <select value={verlaufArt} onChange={e => setVerlaufArt(e.target.value)} style={{ width: 150 }}>
                <option value="alle">{t('serverControl.historyAllEvents')}</option>
                <option value="start">{t('serverControl.eventStart')}</option>
                <option value="stop">{t('serverControl.eventStop')}</option>
                <option value="exit">{t('serverControl.eventExit')}</option>
                <option value="crash">{t('serverControl.eventCrash')}</option>
                <option value="hang">{t('serverControl.eventHang')}</option>
              </select>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {t('serverControl.historyCount', { n: gefilterteEreignisse.length })}
              </span>
            </div>
            {!gefilterteEreignisse.length ? (
              <div className="empty">{t('serverControl.historyEmpty')}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{t('serverControl.historyTime')}</th><th>{t('serverControl.historyService')}</th><th>{t('serverControl.historyEvent')}</th><th>{t('serverControl.historyText')}</th></tr>
                  </thead>
                  <tbody>
                    {gefilterteEreignisse.map((e, i) => (
                      <tr key={i}>
                        <td className="muted">{new Date(e.zeit).toLocaleString()}</td>
                        <td>{KIND_LABEL[e.kind] || e.kind}</td>
                        <td>
                          <span className={`pill ${e.art === 'crash' ? 'ban' : e.art === 'start' ? 'online' : 'offline'}`}>
                            {ereignisArt(e.art)}
                          </span>
                        </td>
                        <td className="muted">{e.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}


      {/*
       * Die Rueckfrage vor "Alles beenden" steht in StartAllCard - dort
       * liegt auch der Knopf. Sie kann hier nicht stehen: die beiden
       * gehoeren in dieselbe Komponente, sonst sieht der Knopf den
       * Zustand nicht.
       */}
    </>
  )
}

export default ServerControl