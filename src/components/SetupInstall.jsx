import React, { useCallback, useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useI18n } from '../i18n'

/*
 * Automatische Einrichtung aus den Originalquellen.
 *
 * Der Assistent klont das offizielle AzerothCore-Repository, baut es mit
 * Visual Studio, legt eine portable MySQL-Instanz an und importiert die
 * Datenbank. Alles, was dabei passiert, kommt als Ereignis
 * 'installer:progress' aus dem Hauptprozess; hier wird es nur dargestellt.
 *
 * Wichtig: Die Einrichtung laeuft im Backend weiter, auch wenn dieser
 * Bildschirm neu gezeichnet wird. Der Zustand wird beim Einhaengen deshalb
 * einmal komplett abgefragt.
 */

const TOOLS = ['git', 'cmake', 'vs', 'openssl', 'boost', 'winget']

function SetupInstall ({ onFertig, onAbbrechen, zwang, onLaufend }) {
  const { t } = useI18n()
  const [env, setEnv] = useState(null)
  const [root, setRoot] = useState('')
  const [port, setPort] = useState(3306)
  const [realm, setRealm] = useState('AzerothCore')
  const [profil, setProfil] = useState('balanced')
  const [autoTools, setAutoTools] = useState(true)
  const [clientDaten, setClientDaten] = useState(true)
  const [clientPfad, setClientPfad] = useState('')
  const [playerbots, setPlayerbots] = useState(false)
  const [clientBusy, setClientBusy] = useState(false)
  const [clientHinweis, setClientHinweis] = useState('')
  const [lauf, setLauf] = useState(null)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState('')
  const logRef = useRef(null)

  const pruefen = useCallback(async ziel => {
    setBusy(true)
    setFehler('')
    try {
      const r = await api.installer.environment({ root: ziel || root })
      setEnv(r)
    } catch (e) {
      setFehler(e.message)
    } finally {
      setBusy(false)
    }
  }, [root])

  // Beim Einhaengen: Werkzeuge pruefen und einen eventuell laufenden
  // Installationsvorgang uebernehmen. Zuletzt benutzte Optionen als
  // Vorbefüllung laden - der Wiederholungs- oder Update-Nutzer tippt
  // dann nichts mehr.
  useEffect(() => {
    let aktiv = true
    ;(async () => {
      setBusy(true)
      try {
        const cfg = await api.settings.get()
        const z = (cfg.setup && cfg.setup.zuletzt) || {}
        if (aktiv) {
          if (z.root) setRoot(alt => alt || z.root)
          if (z.realm) setRealm(z.realm)
          if (z.profil) setProfil(z.profil)
          if (typeof z.playerbots === 'boolean') setPlayerbots(z.playerbots)
          if (typeof z.clientDaten === 'boolean') setClientDaten(z.clientDaten)
          if (typeof z.autoTools === 'boolean') setAutoTools(z.autoTools)
          if (z.clientPfad) setClientPfad(z.clientPfad)
        }
        const r = await api.installer.environment({})
        if (!aktiv) return
        setEnv(r)
        setRoot(alt => alt || r.standardRoot)
        const st = await api.installer.status()
        if (!aktiv) return
        setLauf(st)
        if (Array.isArray(st.log)) setLog(st.log)
      } catch (e) {
        if (aktiv) setFehler(e.message)
      } finally {
        if (aktiv) setBusy(false)
      }
    })()
    return () => { aktiv = false }
  }, [])

  // Fortschritt des Backends
  useEffect(() => {
    const ab = api.on('installer:progress', ev => {
      if (!ev) return
      if (ev.type === 'log') {
        setLog(alt => [...alt.slice(-999), ev.line])
        return
      }
      if (ev.status) setLauf(ev.status)
      if (ev.type === 'error') setFehler(ev.message || t('setup.install.failed'))
    })
    return ab
  }, [t])

  // Protokoll immer ans Ende scrollen
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])

  // Der Assistent darf waehrend der Installation nicht den Modus wechseln:
  // sonst koennte ein spaeteres Speichern der alten Pfade die frisch
  // geschriebene Konfiguration ueberschreiben.
  const laeuftGerade = !!(lauf && lauf.running)
  useEffect(() => {
    if (onLaufend) onLaufend(laeuftGerade)
  }, [laeuftGerade, onLaufend])

  const ordnerSuchen = async () => {
    try {
      const p = await api.system.pickFolder({ title: t('setup.install.rootLabel') })
      if (p) {
        setRoot(p)
        await pruefen(p)
      }
    } catch (e) {
      setFehler(e.message)
    }
  }

  const clientOrdnerSuchen = async () => {
    try {
      const p = await api.system.pickFolder({ title: t('setup.install.clientDataLabel') })
      if (p) setClientPfad(p)
    } catch (e) {
      setFehler(e.message)
    }
  }

  const starten = async () => {
    if (!root.trim()) {
      setFehler(t('setup.install.needRoot'))
      return
    }
    setBusy(true)
    setFehler('')
    setLog([])
    setLetzterVorgang('start')
    // Optionen für den nächsten Assistenten-Aufruf merken
    try {
      await api.settings.save({
        setup: {
          zuletzt: { root, realm, profil, playerbots, clientDaten, autoTools, clientPfad }
        }
      })
    } catch (_) {}
    try {
      const r = await api.installer.start({
        root,
        mysqlPort: Number(port) || 3306,
        realmName: realm,
        buildProfile: profil,
        autoInstallTools: autoTools,
        downloadClientData: clientDaten,
        clientDataPath: clientPfad,
        playerbots
      })
      if (r && r.status) setLauf(r.status)
    } catch (e) {
      setFehler(e.message)
    } finally {
      setBusy(false)
    }
  }

  const abbrechen = async () => {
    try {
      await api.installer.cancel()
    } catch (e) {
      setFehler(e.message)
    }
  }

  const logOeffnen = async () => {
    try {
      await api.installer.openLog()
    } catch (e) {
      setFehler(e.message)
    }
  }

  const [updateInfo, setUpdateInfo] = useState(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  // Merkt sich, ob der letzte Lauf eine Installation oder ein Update war.
  // Der Wiederholen-Knopf muss denselben Vorgang starten, sonst beginnt nach
  // einem fehlgeschlagenen Update versehentlich eine komplette Neuinstallation.
  const [letzterVorgang, setLetzterVorgang] = useState('start')

  const pruefeUpdate = async () => {
    setUpdateBusy(true)
    setFehler('')
    try {
      const r = await api.installer.checkUpdate({ root, erzwingen: true })
      setUpdateInfo(r)
    } catch (e) {
      setFehler(e.message)
    } finally {
      setUpdateBusy(false)
    }
  }

  const updateStarten = async () => {
    setBusy(true)
    setFehler('')
    setLog([])
    setLetzterVorgang('update')
    try {
      const r = await api.installer.update({
        root,
        mysqlPort: Number(port) || 3306,
        buildProfile: profil
      })
      if (r && r.status) setLauf(r.status)
    } catch (e) {
      setFehler(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Clientdaten gegen das aktuelle Release ziehen - unabhaengig von einer
  // Einrichtung. Laeuft laenger, deshalb eigener busy-Zustand.
  const clientDatenAktualisieren = async () => {
    setClientBusy(true)
    setClientHinweis(t('setup.install.clientDataRefreshing'))
    setFehler('')
    setLog([])
    try {
      const r = await api.installer.clientDataUpdate({ root })
      setClientHinweis(t('setup.install.clientDataRefreshOk', { tag: r.version || '?' }))
    } catch (e) {
      setClientHinweis('')
      setFehler(e.message)
    } finally {
      setClientBusy(false)
    }
  }
  const werkzeuge = (env && env.werkzeuge) || {}
  const fehlende = TOOLS.filter(k => werkzeuge[k] && !werkzeuge[k].ok)
  const laeuft = !!(lauf && lauf.running)
  const fertig = !!(
    lauf &&
    !lauf.running &&
    !lauf.error &&
    !lauf.abgebrochen &&
    lauf.steps &&
    lauf.steps.length &&
    lauf.steps.every(s => s.state === 'ok')
  )
  // ETA beim Übersetzen: aus dem Prozentverlauf linear schätzen. Stand der
  // Anzeige vorher minutenlang still, obwohl der Compiler arbeitete.
  const [etaText, setEtaText] = useState('')
  const etaVerlauf = useRef([])

  useEffect(() => {
    if (!lauf || !lauf.running || lauf.stepKey !== 'bauen') {
      etaVerlauf.current = []
      setEtaText('')
      return
    }
    const p = Number(lauf.percent) || 0
    const jetzt = Date.now()
    const verlauf = etaVerlauf.current
    if (verlauf.length && p === verlauf[verlauf.length - 1].p) return
    verlauf.push({ p, t: jetzt })
    if (verlauf.length > 20) verlauf.shift()
    // Mindestabstand zwischen den Stützpunkten, sonst springt die Schätzung
    const alt = verlauf[0]
    const dtSek = (jetzt - alt.t) / 1000
    const dp = p - alt.p
    if (dtSek > 15 && dp > 0.5) {
      const restSek = ((100 - p) / dp) * dtSek
      if (restSek > 0 && restSek < 4 * 60 * 60) {
        const min = Math.max(1, Math.round(restSek / 60))
        setEtaText(t('setup.install.eta', { min }))
        return
      }
    }
    setEtaText('')
  }, [lauf && lauf.percent, lauf && lauf.stepKey, t, lauf])

  const prozent = lauf ? Number(lauf.percent) || 0 : 0

  return (
    <div className="install">
      <p>{t('setup.install.intro')}</p>

      <div className="install-actions">
        {!laeuft && !fertig && (
    <>
          <button className="btn primary" onClick={starten} disabled={busy}>
            {t('setup.install.start')}
          </button>
          {!env && <div className="hint-line" style={{color:'orange'}}>{t('setup.install.envLoading')}</div>}
    </>
        )}
        {laeuft && (
          <button className="btn" onClick={abbrechen}>{t('setup.install.cancel')}</button>
        )}
        {fertig && (
          <button className="btn primary" onClick={() => onFertig && onFertig()}>
            {t('setup.install.finish')}
          </button>
        )}
        {lauf && lauf.logDatei && (
          <button className="btn" onClick={logOeffnen}>{t('setup.install.openLog')}</button>
        )}
        <span className="flex-1" />
        {!zwang && onAbbrechen && !laeuft && (
          <button className="btn" onClick={onAbbrechen}>{t('common.cancel')}</button>
        )}
      </div>
      {!laeuft && !fertig ? (
        <>
          <div className="hint-line">{t('setup.install.startHint')}</div>
          {/*
            * Was auf den Nutzer zukommt. Ohne diese Übersicht starteten
            * Nutzer blind einen 30-90-Minuten-Vorgang und brachen dann ab,
            * weil "der Knopf nichts tat" - dabei arbeitete der Compiler.
            */}
          <div className="info-box" style={{ marginTop: 8 }}>
            <strong>{t('setup.install.uebersicht')}</strong> {t('setup.install.uebersichtText')}
          </div>
        </>
      ) : null}

      <div className="row">
        <div className="field">
          <label>{t('setup.install.rootLabel')}</label>
          <input
            className="mono"
            value={root}
            placeholder={env ? env.standardRoot : 'C:\\AzerothCore'}
            onChange={e => setRoot(e.target.value)}
            disabled={laeuft}
          />
        </div>
        <button className="btn" onClick={ordnerSuchen} disabled={busy || laeuft}>
          {t('setup.install.browse')}
        </button>
        <button className="btn" onClick={() => pruefen(root)} disabled={busy || laeuft}>
          {t('setup.install.checkEnv')}
        </button>
      </div>
      <div className="hint-line">{t('setup.install.rootHint')}</div>

      {env && (
        <div className="install-tools">
          {TOOLS.map(k => (
            <span key={k} className={werkzeuge[k] && werkzeuge[k].ok ? 'tool ok' : 'tool missing'}>
              <span>{werkzeuge[k] && werkzeuge[k].ok ? '✓' : '✕'}</span>
              {t(`setup.install.tool.${k}`)}
            </span>
          ))}
        </div>
      )}

      {env && !laeuft && !fertig && (
        <div className="install-update" style={{marginTop:12,padding:12,border:'1px solid #444',borderRadius:8}}>
          <strong>{t('setup.install.updateTitle')}</strong>
          <div style={{marginTop:8}}>
            <button className="btn" onClick={pruefeUpdate} disabled={updateBusy || busy}>
              {updateBusy ? t('setup.install.checking') : t('setup.install.checkUpdate')}
            </button>
            {updateInfo && (
              <span style={{marginLeft:12}}>
                {updateInfo.ok === false
                  ? `${t('setup.install.updateFailed')}${updateInfo.error ? ': ' + updateInfo.error : ''}`
                  : updateInfo.verfuegbar
                    ? t('setup.install.updateAvailable', { n: updateInfo.anzahl })
                    : t('setup.install.upToDate')}
                {updateInfo.ok !== false && updateInfo.lokal ? ` (${updateInfo.lokal} → ${updateInfo.remote})` : ''}
              </span>
            )}
          </div>
          {updateInfo && updateInfo.verfuegbar && (
            <div style={{marginTop:8}}>
              <button className="btn primary" onClick={updateStarten} disabled={busy}>
                {t('setup.install.startUpdate')}
              </button>
            </div>
          )}
          {updateInfo && updateInfo.commits && updateInfo.commits.length > 0 && (
            <details style={{marginTop:8}}>
              <summary style={{cursor:'pointer', fontSize:12}}>{t('setup.install.updateChangelog', { n: updateInfo.commits.length })}</summary>
              <div className="install-log" style={{maxHeight:180, marginTop:6}}>
                {updateInfo.commits.map((z, i) => <div key={i} className="line mono">{z}</div>)}
              </div>
            </details>
          )}
          {updateInfo && updateInfo.clientData && (
            <div style={{marginTop:8, fontSize:12, color: updateInfo.clientData.aktuell ? 'var(--text-dim, #999)' : '#e0a24a'}}>
              {updateInfo.clientData.aktuell
                ? t('setup.install.clientDataAktuell', { tag: updateInfo.clientData.geladen })
                : t('setup.install.clientDataVeraltet', { geladen: updateInfo.clientData.geladen, remote: updateInfo.clientData.remote })}
            </div>
          )}
        </div>
      )}
      {env && fehlende.length > 0 && (
    <div className={autoTools ? 'info-box' : 'warn-box'}>
          {autoTools
            ? t('setup.install.toolsAuto', { liste: fehlende.map(k => t(`setup.install.tool.${k}`)).join(', ') })
            : t('setup.install.toolsMissing', { liste: fehlende.map(k => t(`setup.install.tool.${k}`)).join(', ') })}
        </div>
      )}

      {env && (
        <div className="hint-line">
          {env.mysql && env.mysql.ok
            ? t('setup.install.mysqlReady')
            : t('setup.install.mysqlMissing')}
          {env.mysql && env.mysql.initialisiert ? ` · ${t('setup.install.mysqlInitialized')}` : ''}
          {env.platz && env.platz.freiGb !== null
            ? ` · ${t('setup.install.space', { gb: env.platz.freiGb })}`
            : ''}
        </div>
      )}

      <div className="row">
        <div className="field sm">
          <label>{t('setup.install.portLabel')}</label>
          <input
            type="number"
            min="1024"
            max="65535"
            value={port}
            onChange={e => setPort(e.target.value)}
            disabled={laeuft}
          />
        </div>
        <div className="field">
          <label>{t('setup.install.realmLabel')}</label>
          <input value={realm} onChange={e => setRealm(e.target.value)} disabled={laeuft} />
        </div>
        <div className="field">
          <label>{t('setup.install.profileLabel')}</label>
          <select value={profil} onChange={e => setProfil(e.target.value)} disabled={laeuft}>
            <option value="full">{t('setup.install.profile.full')}</option>
            <option value="balanced">{t('setup.install.profile.balanced')}</option>
            <option value="background">{t('setup.install.profile.background')}</option>
          </select>
        </div>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={autoTools} onChange={e => setAutoTools(e.target.checked)} disabled={laeuft} />
        <span>
          {t('setup.install.autoTools')}
          <span className="hint-line">{t('setup.install.autoToolsHint')}</span>
        </span>
      </label>

      <label className="check-row">
        <input type="checkbox" checked={clientDaten} onChange={e => setClientDaten(e.target.checked)} disabled={laeuft} />
        <span>
          {t('setup.install.downloadData')}
          <span className="hint-line">{t('setup.install.downloadDataHint')}</span>
        </span>
      </label>

      <label className="check-row">
        <input type="checkbox" checked={playerbots} onChange={e => setPlayerbots(e.target.checked)} disabled={laeuft} />
        <span>
          {t('setup.install.playerbots')}
          <span className="hint-line">{t('setup.install.playerbotsHint')}</span>
        </span>
      </label>

      <div className="row">
        <div className="field">
          <label>{t('setup.install.clientDataLabel')}</label>
          <input
            className="mono"
            value={clientPfad}
            placeholder={t('setup.install.clientDataPlaceholder')}
            onChange={e => setClientPfad(e.target.value)}
            disabled={laeuft}
          />
        </div>
        <button className="btn" onClick={clientOrdnerSuchen} disabled={busy || laeuft}>
          {t('setup.install.browse')}
        </button>
        {clientPfad ? (
          <button className="btn" onClick={() => setClientPfad('')} disabled={laeuft}>
            {t('setup.install.clear')}
          </button>
        ) : null}
      </div>
      <div className="hint-line">{t('setup.install.clientDataHint')}</div>

      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={clientDatenAktualisieren} disabled={clientBusy || busy || laeuft || !root.trim()}>
          {clientBusy ? t('setup.install.clientDataRefreshing') : t('setup.install.clientDataRefresh')}
        </button>
        {clientHinweis ? <span style={{ marginLeft: 12, fontSize: 12 }}>{clientHinweis}</span> : null}
      </div>

      {fehler ? <div className="error-box">{fehler}</div> : null}

      {(lauf || log.length > 0) && (
        <div className="install-progress">
          <div className="install-progress-head">
            <strong>
              {lauf && lauf.stepKey
                ? t(`setup.install.step.${lauf.stepKey}`)
                : laeuft
                  ? t('setup.install.waiting')
                  : t('setup.install.progress')}
            </strong>
            <span>
              {prozent} %
              {etaText ? <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{etaText}</span> : null}
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, prozent))}%` }} />
          </div>

          {lauf && lauf.steps && (
            <div className="install-steps">
              {lauf.steps.map(s => (
                <div key={s.key} className={`install-step ${s.state || 'pending'}`}>
                  <span className="punkt">
                    {s.state === 'ok' ? '✓' : s.state === 'fail' ? '✕' : s.state === 'running' ? '…' : ''}
                  </span>
                  {t(`setup.install.step.${s.key}`)}
                </div>
              ))}
            </div>
          )}

          {lauf && lauf.error ? <div className="error-box">{lauf.error}</div> : null}
          {lauf && lauf.abgebrochen ? <div className="warn-box">{t('setup.install.aborted')}</div> : null}
          {fertig ? <div className="ok-box">{t('setup.install.doneText')}</div> : null}

          <div className="install-log" ref={logRef}>
            {log.length
              ? log.map((zeile, i) => <div key={i} className="line">{zeile}</div>)
              : <div className="line dim">{t('setup.install.noLog')}</div>}
          </div>

          <div className="install-actions">
            {laeuft && <button className="btn" onClick={abbrechen}>{t('setup.install.cancel')}</button>}
            {!laeuft && !fertig && (lauf.error || lauf.abgebrochen) && (
              <button
                className="btn primary"
                onClick={letzterVorgang === 'update' ? updateStarten : starten}
                disabled={busy}
              >
                {letzterVorgang === 'update' ? t('setup.install.startUpdate') : t('setup.install.start')}
              </button>
            )}
            {fertig && (
              <button className="btn primary" onClick={() => onFertig && onFertig()}>
                {t('setup.install.finish')}
              </button>
            )}
            {lauf.logDatei && (
              <button className="btn" onClick={logOeffnen}>{t('setup.install.openLog')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SetupInstall
