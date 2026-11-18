import React, { useCallback, useEffect, useState } from 'react'
import api from '../lib/api'
import { useI18n, LANGUAGES } from '../i18n'
import SetupInstall from '../components/SetupInstall'

/*
 * Einrichtungsassistent.
 *
 * Erscheint beim ersten Start, solange der Einrichtungszustand Luecken hat,
 * und laesst sich aus den Einstellungen jederzeit erneut aufrufen.
 */

const SCHRITTE = ['server', 'datenbank', 'pruefen']

function Setup ({ onFertig, onAbbrechen, zwang }) {
  const { t, lang, setLang } = useI18n()
  const [schritt, setSchritt] = useState(0)
  // 'vorhanden' = bestehenden Server einbinden, 'installation' = Quellen
  // herunterladen, bauen und die portable Datenbank automatisch aufsetzen.
  const [modus, setModus] = useState('vorhanden')
  const [installLaeuft, setInstallLaeuft] = useState(false)
  const [cfg, setCfg] = useState(null)
  const [vorschlaege, setVorschlaege] = useState([])
  const [erkannt, setErkannt] = useState(null)
  const [serverOrdner, setServerOrdner] = useState('')
  const [test, setTest] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    let aktiv = true
    Promise.all([
      api.settings.get().catch(() => null),
      api.system.suggestServerDirs().catch(() => [])
    ]).then(([c, v]) => {
      if (!aktiv) return
      if (c) setCfg(c)
      setVorschlaege(v || [])
      // Ohne vorhandenen Server ist die automatische Einrichtung der
      // sinnvollere Startpunkt - der Nutzer kann trotzdem umschalten.
      const hatServer = c && c.server && c.server.worldExe
      if (!hatServer && !(v || []).length) setModus('installation')
    })
    return () => { aktiv = false }
  }, [])

  const setze = (bereich, key, wert) =>
    setCfg(c => ({ ...c, [bereich]: { ...c[bereich], [key]: wert } }))

  // Serverordner waehlen und automatisch uebernehmen
  const uebernehmen = useCallback(async ordner => {
    if (!ordner) return
    setServerOrdner(ordner)
    setBusy(true)
    setFehler('')
    setErkannt(null)
    try {
      const r = await api.system.detectRepack(ordner)
      if (!r.ok) {
        setFehler(r.error || t('setup.detectFailed'))
        return
      }
      setErkannt(r)
      // Alles in EIN server-Objekt zusammenfuehren. Ein spaeterer
      // ...spread auf 'server' wuerde die zuvor gesetzten Pfade wieder
      // ueberschreiben - deshalb nicht aufteilen.
      setCfg(c => {
        const server = {
          ...c.server,
          // Der vom Nutzer gewaehlte Ordner IST die Serverwurzel. Ohne sie
          // bleibt der alte Wert stehen und spaeteres "Erkennen und
          // uebernehmen" in den Einstellungen laeuft wieder ins Leere.
          rootDir: ordner,
          worldExe: r.server.worldExe || c.server.worldExe,
          authExe: r.server.authExe || c.server.authExe,
          worldConfDir: r.server.worldConfDir || c.server.worldConfDir,
          authConfDir: r.server.authConfDir || c.server.authConfDir,
          // Leer bedeutet bewusst: der Server nutzt sein eigenes
          // Arbeitsverzeichnis. Deshalb nicht mit || c.server.workDir
          // auffuellen.
          workDir: r.server.workDir || ''
        }
        if (r.mysqlServer && r.mysqlServer.exe) {
          server.mysqlServer = { ...(c.server.mysqlServer || {}), ...r.mysqlServer }
        }
        /*
         * Die fest verlinkte Bot-Datei gehoert zum jeweiligen Server. Zeigt
         * sie in einen fremden Ordner (etwa den des bisherigen Repacks),
         * wuerde die Bot-Seite weiter die Konfiguration eines anderen
         * Servers bearbeiten - deshalb abkoppeln. Innerhalb des neuen
         * Servers bleibt der Verweis erhalten.
         */
        const altBot = String((c.server || {}).botFile || '')
        const altKlein = altBot.toLowerCase()
        const zielKlein = ordner.toLowerCase()
        // Pfadvergleich ohne path-Modul: im Renderer gibt es das nicht.
        if (altKlein && !altKlein.startsWith(zielKlein + '\\') && !altKlein.startsWith(zielKlein + '/')) {
          server.botFile = ''
        }
        const naechste = { ...c, server }
        if (r.mysql) {
          const port = Number(r.mysql.port)
          naechste.mysql = {
            ...c.mysql,
            // Host und Port gehoeren dazu: zeigt die Conf auf eine entfernte
            // Datenbank, waere der uebernommene 127.0.0.1 schlicht falsch.
            host: r.mysql.host || c.mysql.host,
            port: Number.isInteger(port) && port > 0 && port < 65536 ? port : c.mysql.port,
            authDb: r.mysql.authDb || c.mysql.authDb,
            charDb: r.mysql.charDb || c.mysql.charDb,
            worldDb: r.mysql.worldDb || c.mysql.worldDb,
            user: r.mysql.user || c.mysql.user,
            password: r.mysql.password || c.mysql.password
          }
        }
        return naechste
      })
    } catch (e) {
      setFehler(e.message)
    } finally {
      setBusy(false)
    }
  }, [t])

  const ordnerSuchen = async () => {
    try {
      const p = await api.system.pickFolder({ title: t('setup.pickTitle') })
      if (p) await uebernehmen(p)
    } catch (e) {
      setFehler(e.message)
    }
  }

  const speichern = async () => {
    setBusy(true)
    setFehler('')
    try {
      await api.settings.save(cfg)
      return true
    } catch (e) {
      setFehler(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  // Pruefung: Pfade vorhanden, Datenbank erreichbar
  const pruefen = async () => {
    if (!(await speichern())) return
    setTest({ laeuft: true })
    try {
      const st = await api.system.setupStatus()
      const res = await api.settings.testAll()
      setTest(alt => ({ ...alt, laeuft: false, status: st, db: res }))
    } catch (e) {
      setTest(alt => ({ ...alt, laeuft: false, fehler: e.message }))
    }
  }

  // Datenbank starten - als Windows-Dienst oder als mitgeliefertes mysqld
  const dbStarten = async () => {
    setBusy(true)
    setTest(alt => ({ ...alt, dbStart: null }))
    try {
      const msg = await api.server.startDatabase()
      setTest(alt => ({ ...alt, dbStart: msg || t('setup.dbStartOk') }))
      // MySQL braucht einen Moment, bevor es Verbindungen annimmt
      window.setTimeout(pruefen, 4000)
    } catch (e) {
      setTest(alt => ({ ...alt, dbStart: e.message, dbStartFehler: true }))
    } finally {
      setBusy(false)
    }
  }

  const weiter = async () => {
    if (schritt === 1) {
      if (!(await speichern())) return
    }
    setSchritt(s => Math.min(SCHRITTE.length - 1, s + 1))
  }

  if (!cfg) return <div className="setup"><div className="spinner">{t('setup.loading')}</div></div>

  const serverOk = erkannt && erkannt.server && erkannt.server.worldExe
  const dbOk = test && test.db && Object.values(test.db).every(r => r.ok)
  const schritte = modus === 'installation' ? ['installation'] : SCHRITTE
  const wechsleModus = m => {
    setModus(m)
    setSchritt(0)
    setFehler('')
  }

  return (
    <div className="setup">
      <div className="setup-box">
        <div className="setup-head">
          <img className="setup-logo" src="./logo.png" alt="" />
          <div className="setup-head-text">
            <h1>{t('setup.title')}</h1>
            <div className="sub">{t('setup.subtitle')}</div>
          </div>
          <label className="setup-lang" title={t('app.language.label')}>
            <span className="setup-lang-label">{t('app.language.label')}</span>
            <select
              value={lang}
              onChange={e => setLang(e.target.value)}
              aria-label={t('app.language.label')}
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="setup-modes">
          <button
            className={modus === 'installation' ? 'mode-card aktiv' : 'mode-card'}
            onClick={() => wechsleModus('installation')}
            disabled={installLaeuft}
          >
            <strong>{t('setup.mode.install')}</strong>
            <span>{t('setup.mode.installHint')}</span>
          </button>
          <button
            className={modus === 'vorhanden' ? 'mode-card aktiv' : 'mode-card'}
            onClick={() => wechsleModus('vorhanden')}
            disabled={installLaeuft}
          >
            <strong>{t('setup.mode.existing')}</strong>
            <span>{t('setup.mode.existingHint')}</span>
          </button>
        </div>

        <ol className="setup-steps">
          {schritte.map((s, i) => (
            <li key={s} className={i === schritt ? 'aktiv' : i < schritt ? 'fertig' : ''}>
              <span className="punkt">{i < schritt ? '✓' : i + 1}</span>
              {t(`setup.step.${s}`)}
            </li>
          ))}
        </ol>

        {fehler ? <div className="error-box">{fehler}</div> : null}

        {/* ---------- Automatische Einrichtung aus den Originalquellen ---------- */}
        {modus === 'installation' && (
          <div className="setup-body">
            <SetupInstall onFertig={onFertig} onAbbrechen={onAbbrechen} zwang={zwang} onLaufend={setInstallLaeuft} />
          </div>
        )}

        {/* ---------- Schritt 1: Serverordner ---------- */}
        {modus === 'vorhanden' && schritt === 0 && (
          <div className="setup-body">
            <p>{t('setup.serverIntro')}</p>
            <div className="row">
              <input
                className="flex-1 mono"
                value={serverOrdner}
                placeholder="C:\AzerothCore"
                onChange={e => setServerOrdner(e.target.value)}
              />
              <button className="btn" onClick={ordnerSuchen} disabled={busy}>{t('setup.browse')}</button>
              <button className="btn primary" onClick={() => uebernehmen(serverOrdner)} disabled={busy || !serverOrdner.trim()}>
                {t('setup.detect')}
              </button>
            </div>

            {vorschlaege.length > 0 && (
              <div className="setup-suggest">
                <div className="label">{t('setup.suggested')}</div>
                {vorschlaege.map(v => (
                  <button key={v.dir} className="suggest-row" onClick={() => uebernehmen(v.dir)}>
                    <span className="mono">{v.dir}</span>
                    <span className="badge">{v.layout === 'repack' ? t('setup.layoutRepack') : t('setup.layoutStandard')}</span>
                  </button>
                ))}
              </div>
            )}

            {serverOk && (
              <div className="info-box">
                <div><strong>{t('setup.foundWorld')}</strong> <span className="mono">{erkannt.server.worldExe}</span></div>
                {erkannt.server.authExe
                  ? <div><strong>{t('setup.foundAuth')}</strong> <span className="mono">{erkannt.server.authExe}</span></div>
                  : <div className="warn-line">{t('setup.noAuth')}</div>}
                <div><strong>{t('setup.foundConf')}</strong> <span className="mono">{erkannt.server.worldConfDir}</span></div>
                {erkannt.notes && erkannt.notes.map((n, i) => <div key={i} className="hint">{n}</div>)}
              </div>
            )}
          </div>
        )}

        {/* ---------- Schritt 2: Datenbank ---------- */}
        {modus === 'vorhanden' && schritt === 1 && (
          <div className="setup-body">
            <p>{t('setup.dbIntro')}</p>
            <div className="row">
              <div className="field"><label>{t('settings.host')}</label>
                <input value={cfg.mysql.host} onChange={e => setze('mysql', 'host', e.target.value)} /></div>
              <div className="field sm"><label>{t('settings.port')}</label>
                <input value={cfg.mysql.port} onChange={e => setze('mysql', 'port', e.target.value)} /></div>
            </div>
            <div className="row">
              <div className="field"><label>{t('settings.user')}</label>
                <input value={cfg.mysql.user} onChange={e => setze('mysql', 'user', e.target.value)} /></div>
              <div className="field"><label>{t('settings.password')}</label>
                <input type="password" value={cfg.mysql.password} onChange={e => setze('mysql', 'password', e.target.value)} /></div>
            </div>
            <div className="row">
              <div className="field"><label>{t('settings.authDb')}</label>
                <input className="mono" value={cfg.mysql.authDb} onChange={e => setze('mysql', 'authDb', e.target.value)} /></div>
              <div className="field"><label>{t('settings.charDb')}</label>
                <input className="mono" value={cfg.mysql.charDb} onChange={e => setze('mysql', 'charDb', e.target.value)} /></div>
              <div className="field"><label>{t('settings.worldDb')}</label>
                <input className="mono" value={cfg.mysql.worldDb} onChange={e => setze('mysql', 'worldDb', e.target.value)} /></div>
            </div>
            <div className="info-box mb0">{t('setup.dbHint')}</div>
          </div>
        )}

        {/* ---------- Schritt 3: Pruefen ---------- */}
        {modus === 'vorhanden' && schritt === 2 && (
          <div className="setup-body">
            <p>{t('setup.testIntro')}</p>
            <div className="inline mb">
              <button className="btn" onClick={pruefen} disabled={busy || (test && test.laeuft)}>
                {t('setup.runTest')}
              </button>
              <button className="btn" onClick={dbStarten} disabled={busy}>
                {t('setup.startDb')}
              </button>
            </div>

            {test && test.dbStart && (
              <div className="info-box">{test.dbStart}</div>
            )}

            {test && !test.laeuft && (
              <div className="setup-result">
                {test.fehler ? <div className="error-box">{test.fehler}</div> : null}
                {test.status && test.status.schritte.map(s => (
                  <div key={s.key} className={s.ok ? 'ok' : s.key === 'db' ? 'warn' : 'bad'}>
                    <span>{s.ok ? '✓' : s.key === 'db' ? '!' : '✕'}</span> {t(`setup.check.${s.key}`)}
                  </div>
                ))}
                {test.db && Object.entries(test.db).map(([k, v]) => (
                  <div key={k} className={v.ok ? 'ok' : 'bad'}>
                    <span>{v.ok ? '✓' : '✕'}</span> {t(`setup.dbName.${k}`)}
                    {!v.ok && v.error ? <span className="hint"> — {v.error}</span> : null}
                  </div>
                ))}
              </div>
            )}

            {test && !test.laeuft && !dbOk && (
              <div className="warn-box">
                {t('setup.dbDownHint')}
              </div>
            )}

            <div className="info-box mb0">{t('setup.testHint')}</div>
          </div>
        )}

        {modus === 'vorhanden' && schritt === 2 && test && !test.laeuft && (
          <div className={dbOk ? 'info-box mb0' : 'warn-box mb0'}>
            {dbOk ? t('setup.allGood') : t('setup.finishAnyway', { offen: (test.status && test.status.offen || []).map(k => t(`setup.check.${k}`)).join(', ') })}
          </div>
        )}

        {modus === 'vorhanden' && (
        <div className="setup-foot">
          {zwang ? null : (
            <button className="btn" onClick={onAbbrechen}>{t('common.cancel')}</button>
          )}
          <span className="flex-1" />
          {schritt > 0 && (
            <button className="btn" onClick={() => setSchritt(s => s - 1)}>{t('setup.back')}</button>
          )}
          {schritt < SCHRITTE.length - 1 ? (
            <button
              className="btn primary"
              onClick={weiter}
              disabled={schritt === 0 ? !serverOk : busy}
            >
              {t('setup.next')}
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={async () => { if (await speichern()) onFertig(test) }}
              disabled={busy}
              title={t('setup.finishHint')}
            >
              {t('setup.finish')}
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

export default Setup