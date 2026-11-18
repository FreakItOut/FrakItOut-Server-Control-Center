import React, { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

function ConfigEditor () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [file, setFile] = useState('world')
  const [data, setData] = useState(null)
  const [lines, setLines] = useState([])
  const [term, setTerm] = useState('')
  const [onlySettings, setOnlySettings] = useState(true)
  const [dirty, setDirty] = useState(false)
  // Gespeicherte Konfiguration wirkt erst nach einem Server-Neustart
  const [neustartNoetig, setNeustartNoetig] = useState(false)

  const load = async f => {
    try {
      const res = await api.config.read(f)
      setData(res)
      // Eine unerwartete Antwort darf die Seite nicht mit einem
      // "undefined.map" abrissen - lieber leer anzeigen.
      setLines(Array.isArray(res && res.lines) ? res.lines : [])
      setDirty(false)
    } catch (e) {
      toast(e.message, 'err')
      setData(null)
      setLines([])
    }
  }

  const switchFile = f => {
    if (f === file) return
    if (dirty && !window.confirm(t('configEditor.discard'))) return
    setFile(f)
  }

  useEffect(() => { load(file); loadSicherungen(file) }, [file])

  // "q" statt "t", damit der Suchbegriff nicht mit t() aus useI18n kollidiert
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return lines.map((l, i) => ({ l, i }))
    return lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => {
        if (l.type === 'setting') return l.key.toLowerCase().includes(q) || String(l.value).toLowerCase().includes(q)
        return !onlySettings && l.raw.toLowerCase().includes(q)
      })
  }, [lines, term, onlySettings])

  /*
   * Einfacher Block-Diff: gemeinsamer Anfang und Ende werden uebersprungen,
   * dazwischen stehen die geaenderten Zeilen. Fuer Konfigurationsdateien
   * reicht das und bleibt auch bei 3000 Zeilen schnell.
   */
  const diff = useMemo(() => {
    if (!dirty || !data || !Array.isArray(data.lines)) return null
    const alt = data.lines
    const neu = lines
    let start = 0
    while (start < alt.length && start < neu.length && alt[start] === neu[start]) start++
    let endeAlt = alt.length - 1
    let endeNeu = neu.length - 1
    while (endeAlt >= start && endeNeu >= start && alt[endeAlt] === neu[endeNeu]) {
      endeAlt--
      endeNeu--
    }
    const entfernt = alt.slice(start, endeAlt + 1)
    const hinzugefuegt = neu.slice(start, endeNeu + 1)
    if (!entfernt.length && !hinzugefuegt.length) return null
    return { start, entfernt, hinzugefuegt }
  }, [dirty, data, lines])

  const update = (index, value) => {
    setLines(prev => prev.map((l, i) => (i === index && l.type === 'setting' ? { ...l, value } : l)))
    setDirty(true)
  }

  const toggleBool = index => {
    setLines(prev =>
      prev.map((l, i) => {
        if (i !== index) return l
        const v = String(l.value).trim().toLowerCase()
        const next = v === '0' || v === 'false' || v === '' ? '1' : '0'
        return { ...l, value: next }
      })
    )
    setDirty(true)
  }

  const save = async () => {
    if (!window.confirm(t('configEditor.confirmSave', { path: data.path }))) return
    try {
      await api.config.save({ file, lines })
      toast(t('configEditor.saved'), 'ok')
      setDirty(false)
      // Conf-Änderungen liest der Server erst beim Start - ohne Hinweis
      // wundert man sich, dass die Änderung "nicht wirkt".
      setNeustartNoetig(true)
      load(file)
      loadSicherungen(file)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /*
   * Sicherungen mit Zeitstempel.
   *
   * Bisher gab es genau eine: "<datei>.bak", und die wurde bei jedem
   * Speichern ueberschrieben. Nach dem zweiten Speichern war der Stand
   * von vor dem ersten weg. Bei 4957 Zeilen worldserver.conf heisst das:
   * drei falsch gesetzte Raten und nur noch der letzte brauchbare Stand.
   */
  const [sicherungen, setSicherungen] = useState(null)

  const loadSicherungen = async f => {
    try {
      const res = await api.config.sicherungen({ file: f })
      setSicherungen(res)
    } catch (_) {
      setSicherungen(null)
    }
  }

  const stufeZurueckspielen = async eintrag => {
    if (!window.confirm(t('configEditor.restoreConfirm', { name: eintrag.name }))) return
    try {
      await api.config.sicherungZurueckspielen({ file, pfad: eintrag.pfad })
      toast(t('configEditor.restored'), 'ok')
      load(file)
      loadSicherungen(file)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  return (
    <>
      <div className="inline mb0" style={{ marginBottom: 14 }}>
        <div className="tabs" style={{ margin: 0, border: 'none' }}>
          <div className={`tab${file === 'world' ? ' active' : ''}`} onClick={() => switchFile('world')}>
            worldserver.conf
          </div>
          <div className={`tab${file === 'auth' ? ' active' : ''}`} onClick={() => switchFile('auth')}>
            authserver.conf
          </div>
        </div>
      </div>

      {!data ? (
        <div className="error-box">
          {t('configEditor.loadError')}
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h3>{data.path}</h3>
              <div className="inline">
                <input
                  type="text"
                  placeholder={t('configEditor.searchPlaceholder')}
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  style={{ width: 220 }}
                />
                <label className="check-row" style={{ fontSize: 12 }}>
                  <input type="checkbox" checked={onlySettings} onChange={e => setOnlySettings(e.target.checked)} />
                  {t('configEditor.onlyLines')}
                </label>
                <button className="btn sm" onClick={() => { setTerm(''); setLines(data.lines); setDirty(false) }}>{t('configEditor.reset')}</button>
                <button className="btn primary sm" disabled={!dirty} onClick={save}>{t('common.save')}{dirty ? ' •' : ''}</button>
              </div>
            </div>
            <div className="card-body tight">
              {neustartNoetig ? (
                <div className="info-box" style={{ marginBottom: 10, fontSize: 12 }}>
                  {t('configEditor.restartHint')}{' '}
                  <button
                    className="btn sm"
                    onClick={() => api.server.restart('world')
                      .then(() => { toast(t('configEditor.restartDone'), 'ok'); setNeustartNoetig(false) })
                      .catch(e => toast(e.message, 'err'))}
                  >
                    {t('configEditor.restartBtn')}
                  </button>
                </div>
              ) : null}
              <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr><th style={{ width: '42%' }}>{t('configEditor.setting')}</th><th>{t('common.value')}</th><th style={{ width: 90 }}>{t('configEditor.type')}</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ l, i }) =>
                      l.type === 'setting' ? (
                        <tr key={i}>
                          <td className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{l.key}</td>
                          <td style={{ whiteSpace: 'normal' }}>
                            <input
                              type="text"
                              className="mono"
                              value={l.value}
                              onChange={e => update(i, e.target.value)}
                              style={{ fontSize: 12.5, padding: '4px 8px' }}
                            />
                          </td>
                          <td>
                            <button className="btn sm" onClick={() => toggleBool(i)} title={t('configEditor.toggleBool')}>
                              {['0', '1', 'true', 'false', ''].includes(String(l.value).trim().toLowerCase()) ? 'bool' : 'text'}
                            </button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={i}>
                          <td colSpan={3} className="mono muted" style={{ whiteSpace: 'pre-wrap', fontSize: 11.5 }}>
                            {l.raw.trim() || ' '}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {diff ? (
            <details className="editor-diff" open>
              <summary>
                {t('configEditor.diffTitle', { added: diff.hinzugefuegt.length, removed: diff.entfernt.length })}
              </summary>
              <div className="editor-diff-body">
                {diff.entfernt.slice(0, 200).map((l, i) => (
                  <div key={'a' + i} className="diff-zeile minus">
                    - {l.type === 'setting' ? `${l.key} = ${l.value}` : l.raw}
                  </div>
                ))}
                {diff.hinzugefuegt.slice(0, 200).map((l, i) => (
                  <div key={'n' + i} className="diff-zeile plus">
                    + {l.type === 'setting' ? `${l.key} = ${l.value}` : l.raw}
                  </div>
                ))}
                {diff.entfernt.length > 200 || diff.hinzugefuegt.length > 200 ? (
                  <div className="muted">{t('configEditor.diffMore', { n: Math.max(diff.entfernt.length, diff.hinzugefuegt.length) })}</div>
                ) : null}
              </div>
            </details>
          ) : null}

          <div className="info-box">
            {t('configEditor.hint1')} <span className="mono">#</span> {t('configEditor.hint2')}{' '}
            <span className="mono">.bak</span>{t('configEditor.hint3')}
          </div>

          {/*
           * Sicherungen mit Zeitstempel.
           *
           * Die klassische ".bak" gibt es weiterhin - sie ist der schnelle
           * Rueckweg fuer "hab ich eben kaputtgemacht". Darueber hinaus
           * liegen versionierte Staende, jede mit eigenem Zeitstempel.
           */}
          {sicherungen && (sicherungen.liste.length || sicherungen.alt) ? (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="card-head">
                <h3>{t('configEditor.backupsTitle')}</h3>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {t('configEditor.backupsCount', { count: sicherungen.liste.length })}
                </span>
              </div>
              <div className="card-body tight">
                {sicherungen.liste.length ? (
                  <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th>{t('configEditor.backupsWhen')}</th><th className="num">{t('configEditor.backupsSize')}</th><th></th></tr>
                      </thead>
                      <tbody>
                        {sicherungen.liste.map(s => (
                          <tr key={s.pfad}>
                            <td className="mono" style={{ fontSize: 12 }}>{s.name.replace(/\.[^.]+$/, '')}</td>
                            <td className="num muted">{Math.round(s.groesse / 1024)} KB</td>
                            <td className="right">
                              <button className="btn sm" onClick={() => stufeZurueckspielen(s)}>
                                {t('configEditor.backupsRestore')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">{t('configEditor.backupsEmpty')}</div>
                )}
                {sicherungen.alt ? (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                    {t('configEditor.backupOld')}: <span className="mono">{sicherungen.alt}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

export default ConfigEditor