import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { formatDate } from '../lib/constants'

/*
 * Werkzeuge fuer den Betrieb: Kontosicherheit, eine rein lesende
 * Datenbank-Konsole und das Log-Archiv. Drei verwandte Aufgaben, ein Ort -
 * damit die Navigation nicht um drei Seiten waechst.
 */

const TABS = [
  { key: 'sicherheit', label: 'werkzeuge.tabSecurity' },
  { key: 'sql', label: 'werkzeuge.tabSql' },
  { key: 'logs', label: 'werkzeuge.tabLogs' }
]

/* ------------------------------------------------------ Kontosicherheit */

function KontoZeile ({ konto, aktionen }) {
  const { t } = useI18n()
  return (
    <tr>
      <td>
        <a href={`#/accounts?search=${encodeURIComponent(konto.username)}`} className="mono">{konto.username}</a>
        {konto.online ? <span className="pill online" style={{ marginLeft: 6, fontSize: 10 }}>{t('werkzeuge.online')}</span> : null}
      </td>
      <td>{konto.gmlevel > 0 ? <span className="pill info">GM {konto.gmlevel}</span> : <span className="muted">—</span>}</td>
      <td className="muted">{konto.lastLogin ? formatDate(konto.lastLogin) : t('werkzeuge.never')}</td>
      <td className="mono muted" style={{ fontSize: 11.5 }}>{konto.lastIp || '—'}</td>
      <td>{aktionen}</td>
    </tr>
  )
}

function SicherheitTab () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [daten, setDaten] = useState(null)
  const [busy, setBusy] = useState(false)

  const laden = async () => {
    setBusy(true)
    try {
      setDaten(await api.security.uebersicht())
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { laden() }, [])

  const kontoAktion = async (fn, okKey) => {
    setBusy(true)
    try {
      await fn()
      toast(t(okKey), 'ok')
      await laden()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (!daten) return <div className="empty">{busy ? t('werkzeuge.loading') : t('werkzeuge.noData')}</div>

  const z = daten.zahlen
  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 12 }}>
        <div className="stat clickable">
          <div className="label">{t('werkzeuge.statGm')}</div>
          <div className={`value ${z.gm ? 'gold' : 'green'}`}>{z.gm}</div>
          <div className="sub">{t('werkzeuge.statGmHint')}</div>
        </div>
        <div className="stat clickable">
          <div className="label">{t('werkzeuge.statLocked')}</div>
          <div className={`value ${z.gesperrt ? 'red' : 'green'}`}>{z.gesperrt}</div>
          <div className="sub">{t('werkzeuge.statLockedHint')}</div>
        </div>
        <div className="stat clickable">
          <div className="label">{t('werkzeuge.statFailed')}</div>
          <div className={`value ${z.fehlversuche ? 'gold' : 'green'}`}>{z.fehlversuche}</div>
          <div className="sub">{t('werkzeuge.statFailedHint')}</div>
        </div>
        <div className="stat clickable">
          <div className="label">{t('werkzeuge.statNoMail')}</div>
          <div className={`value ${z.ohneEmail ? 'gold' : 'green'}`}>{z.ohneEmail}</div>
          <div className="sub">{t('werkzeuge.statNoMailHint')}</div>
        </div>
        <div className="stat clickable">
          <div className="label">{t('werkzeuge.statInactive')}</div>
          <div className={`value ${z.inaktiv ? 'gold' : 'green'}`}>{z.inaktiv}</div>
          <div className="sub">{t('werkzeuge.statInactiveHint')}</div>
        </div>
        <div className="stat clickable">
          <div className="label">{t('werkzeuge.statIps')}</div>
          <div className={`value ${z.ipGruppen ? 'gold' : 'green'}`}>{z.ipGruppen}</div>
          <div className="sub">{t('werkzeuge.statIpsHint')}</div>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
        {t('werkzeuge.securityStand', { when: formatDate(daten.stand), n: daten.gesamt })}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h3>{t('werkzeuge.gmTitle')}</h3></div>
        <div className="card-body tight">
          {!daten.gm.length ? <div className="empty">{t('werkzeuge.gmEmpty')}</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>{t('werkzeuge.account')}</th><th>{t('werkzeuge.gmLevel')}</th><th>{t('werkzeuge.lastLogin')}</th><th>{t('werkzeuge.lastIp')}</th><th />
                </tr></thead>
                <tbody>
                  {daten.gm.map(k => (
                    <KontoZeile
                      key={k.id}
                      konto={k}
                      aktionen={(
                        <button
                          className="btn sm"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(t('werkzeuge.revokeConfirm', { name: k.username }))) return
                            kontoAktion(() => api.accounts.setGmLevel({ accountId: k.id, gmlevel: 0 }), 'werkzeuge.revoked')
                          }}
                        >
                          {t('werkzeuge.revoke')}
                        </button>
                      )}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h3>{t('werkzeuge.lockedTitle')}</h3></div>
        <div className="card-body tight">
          {!daten.gesperrt.length ? <div className="empty">{t('werkzeuge.lockedEmpty')}</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>{t('werkzeuge.account')}</th><th>{t('werkzeuge.gmLevel')}</th><th>{t('werkzeuge.lastLogin')}</th><th>{t('werkzeuge.lastIp')}</th><th />
                </tr></thead>
                <tbody>
                  {daten.gesperrt.map(k => (
                    <KontoZeile
                      key={k.id}
                      konto={k}
                      aktionen={(
                        <button
                          className="btn sm"
                          disabled={busy}
                          onClick={() => kontoAktion(() => api.accounts.setLocked({ accountId: k.id, locked: false }), 'werkzeuge.unlocked')}
                        >
                          {t('werkzeuge.unlock')}
                        </button>
                      )}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h3>{t('werkzeuge.failedTitle')}</h3></div>
        <div className="card-body tight">
          {!daten.fehlversuche.length ? <div className="empty">{t('werkzeuge.failedEmpty')}</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>{t('werkzeuge.account')}</th><th>{t('werkzeuge.failedCount')}</th><th>{t('werkzeuge.lastLogin')}</th><th>{t('werkzeuge.lastIp')}</th><th />
                </tr></thead>
                <tbody>
                  {daten.fehlversuche.map(k => (
                    <tr key={k.id}>
                      <td><a href={`#/accounts?search=${encodeURIComponent(k.username)}`} className="mono">{k.username}</a></td>
                      <td>{k.failedLogins}</td>
                      <td className="muted">{k.lastLogin ? formatDate(k.lastLogin) : t('werkzeuge.never')}</td>
                      <td className="mono muted" style={{ fontSize: 11.5 }}>{k.lastIp || '—'}</td>
                      <td>
                        <button
                          className="btn sm"
                          disabled={busy}
                          onClick={() => kontoAktion(() => api.accounts.setLocked({ accountId: k.id, locked: false }), 'werkzeuge.resetFailedOk')}
                        >
                          {t('werkzeuge.resetFailed')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t('werkzeuge.ipsTitle')}</h3></div>
        <div className="card-body">
          {!daten.ipGruppen.length ? <div className="empty">{t('werkzeuge.ipsEmpty')}</div> : (
            daten.ipGruppen.map(g => (
              <div key={g.ip} style={{ marginBottom: 10 }}>
                <div className="mono" style={{ fontSize: 12.5 }}>{g.ip} <span className="muted">· {t('werkzeuge.ipCount', { n: g.konten.length })}</span></div>
                <div className="inline" style={{ marginTop: 2 }}>
                  {g.konten.map(k => (
                    <a key={k.id} href={`#/accounts?search=${encodeURIComponent(k.username)}`} className="pill info" style={{ textDecoration: 'none' }}>
                      {k.username}{k.gmlevel > 0 ? ` · GM${k.gmlevel}` : ''}
                    </a>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

/* --------------------------------------------------------- SQL-Konsole */

function SqlTab () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [dbKind, setDbKind] = useState('world')
  const [sql, setSql] = useState('SELECT * FROM item_template LIMIT 10')
  const [ergebnis, setErgebnis] = useState(null)
  const [fehler, setFehler] = useState('')
  const [busy, setBusy] = useState(false)
  const [verlauf, setVerlauf] = useState([])

  const verlaufLaden = () => api.sql.verlauf().then(r => setVerlauf(r.liste || [])).catch(() => {})

  useEffect(() => { verlaufLaden() }, [])

  const ausfuehren = async () => {
    if (!sql.trim() || busy) return
    setBusy(true)
    setFehler('')
    try {
      const r = await api.sql.ausfuehren({ dbKind, sql })
      setErgebnis(r)
      verlaufLaden()
    } catch (e) {
      setErgebnis(null)
      setFehler(e.message)
      verlaufLaden()
    } finally {
      setBusy(false)
    }
  }

  const csv = () => {
    if (!ergebnis) return
    const kopf = ergebnis.spalten.join(';')
    const zeilen = ergebnis.rows.map(r => ergebnis.spalten.map(s => {
      const w = r[s] == null ? '' : String(r[s])
      return /[;"\n]/.test(w) ? `"${w.replace(/"/g, '""')}"` : w
    }).join(';'))
    const blob = new Blob(['\ufeff' + [kopf, ...zeilen].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `abfrage-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('werkzeuge.sqlTitle')}</h3>
        <span className="pill info">{t('werkzeuge.sqlReadOnly')}</span>
      </div>
      <div className="card-body">
        <div className="inline" style={{ marginBottom: 8 }}>
          <select value={dbKind} onChange={e => setDbKind(e.target.value)} style={{ width: 170 }}>
            <option value="auth">{t('werkzeuge.dbAuth')}</option>
            <option value="chars">{t('werkzeuge.dbChars')}</option>
            <option value="world">{t('werkzeuge.dbWorld')}</option>
          </select>
          <span className="muted" style={{ fontSize: 11.5 }}>{t('werkzeuge.sqlLimit')}</span>
        </div>
        <textarea
          className="mono"
          rows={5}
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              ausfuehren()
            }
          }}
          placeholder={t('werkzeuge.sqlPlaceholder')}
          style={{ width: '100%' }}
        />
        <div className="inline" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={ausfuehren} disabled={busy || !sql.trim()}>
            {busy ? t('werkzeuge.sqlRunning') : t('werkzeuge.sqlRun')}
          </button>
          <button className="btn" onClick={csv} disabled={!ergebnis}>{t('werkzeuge.sqlExport')}</button>
          <span className="hint">{t('werkzeuge.sqlHint')}</span>
        </div>

        {fehler ? <div className="error-box mt">{fehler}</div> : null}

        {ergebnis ? (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
              {t('werkzeuge.sqlResult', { n: ergebnis.anzahl, ms: ergebnis.dauerMs })}
              {ergebnis.gekuerzt ? ` · ${t('werkzeuge.sqlTruncated', { n: 200 })}` : ''}
            </div>
            {!ergebnis.rows.length ? <div className="empty">{t('werkzeuge.sqlEmpty')}</div> : (
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table>
                  <thead><tr>{ergebnis.spalten.map(s => <th key={s}>{s}</th>)}</tr></thead>
                  <tbody>
                    {ergebnis.rows.map((r, i) => (
                      <tr key={i}>
                        {ergebnis.spalten.map(s => <td key={s} className="mono" style={{ fontSize: 11.5 }}>{r[s] == null ? 'NULL' : String(r[s])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <div style={{ marginTop: 14, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
          <div className="inline" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 12.5 }}>{t('werkzeuge.sqlHistory')}</strong>
            <button
              className="btn sm"
              disabled={!verlauf.length}
              onClick={() => api.sql.verlaufLeeren().then(verlaufLaden).catch(() => {})}
            >
              {t('werkzeuge.sqlHistoryClear')}
            </button>
          </div>
          {!verlauf.length ? <div className="muted" style={{ fontSize: 12 }}>{t('werkzeuge.sqlHistoryEmpty')}</div> : (
            verlauf.map((v, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                className="mono"
                style={{ fontSize: 11.5, cursor: 'pointer', padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}
                onClick={() => { setSql(v.sql); setDbKind(v.dbKind) }}
                onKeyDown={e => { if (e.key === 'Enter') { setSql(v.sql); setDbKind(v.dbKind) } }}
              >
                <span className={`pill ${v.ok ? 'online' : 'offline'}`} style={{ fontSize: 9, marginRight: 6 }}>
                  {v.ok ? 'OK' : 'ERR'}
                </span>
                {v.sql.slice(0, 120)}
                <span className="muted"> · {v.dauerMs} ms</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- Log-Archiv */

function markiere (text, q) {
  if (!q) return text
  const stelle = String(text).toLowerCase().indexOf(q.toLowerCase())
  if (stelle < 0) return text
  return (
    <>
      {text.slice(0, stelle)}
      <mark>{text.slice(stelle, stelle + q.length)}</mark>
      {text.slice(stelle + q.length)}
    </>
  )
}

function LogsTab () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [dateien, setDateien] = useState([])
  const [pfad, setPfad] = useState('')
  const [text, setText] = useState('')
  const [stufe, setStufe] = useState('alle')
  const [kontext, setKontext] = useState(2)
  const [ergebnis, setErgebnis] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.logs.dateien().then(r => {
      const liste = r.dateien || []
      setDateien(liste)
      if (liste.length) setPfad(liste[0].pfad)
    }).catch(e => toast(e.message, 'err'))
  }, [])

  const suchen = async () => {
    if (!pfad || busy) return
    setBusy(true)
    try {
      setErgebnis(await api.logs.suche({ pfad, text, stufe, kontext }))
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const exportieren = () => {
    if (!ergebnis) return
    const inhalt = ergebnis.treffer.map(x => `[${x.zeile}] ${x.text}`).join('\r\n')
    const blob = new Blob([inhalt], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `log-${ergebnis.datei}-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  if (!dateien.length) {
    return <div className="card"><div className="card-body"><div className="empty">{t('werkzeuge.logsNone')}</div></div></div>
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('werkzeuge.logsTitle')}</h3>
        <span className="pill info">{t('werkzeuge.logsNote')}</span>
      </div>
      <div className="card-body">
        <div className="inline" style={{ marginBottom: 8 }}>
          <select value={pfad} onChange={e => { setPfad(e.target.value); setErgebnis(null) }} style={{ minWidth: 240 }}>
            {dateien.map(d => (
              <option key={d.pfad} value={d.pfad}>
                {d.name} · {d.art === 'rotation' ? t('werkzeuge.logRotation') : t('werkzeuge.logCurrent')}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') suchen() }}
            placeholder={t('werkzeuge.logSearch')}
            style={{ maxWidth: 260 }}
          />
          <select value={stufe} onChange={e => setStufe(e.target.value)} style={{ width: 150 }}>
            <option value="alle">{t('werkzeuge.logAll')}</option>
            <option value="fehler">{t('werkzeuge.logErrors')}</option>
            <option value="warnung">{t('werkzeuge.logWarnings')}</option>
          </select>
          <select value={kontext} onChange={e => setKontext(Number(e.target.value))} style={{ width: 130 }}>
            <option value={0}>{t('werkzeuge.logContext0')}</option>
            <option value={2}>{t('werkzeuge.logContext2')}</option>
            <option value={5}>{t('werkzeuge.logContext5')}</option>
          </select>
          <button className="btn primary sm" onClick={suchen} disabled={busy}>
            {busy ? t('werkzeuge.logRunning') : t('werkzeuge.logRun')}
          </button>
          <button className="btn sm" onClick={exportieren} disabled={!ergebnis || !ergebnis.treffer.length}>
            {t('werkzeuge.logExport')}
          </button>
        </div>
        {ergebnis ? (
          <>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
              {t('werkzeuge.logResult', {
                n: ergebnis.trefferGesamt,
                zeilen: ergebnis.zeilen,
                datei: ergebnis.datei
              })}
              {ergebnis.gekuerzt ? ` · ${t('werkzeuge.logTruncated')}` : ''}
            </div>
            {!ergebnis.treffer.length ? <div className="empty">{t('werkzeuge.logNoMatch')}</div> : (
              <div className="console" style={{ maxHeight: 460 }}>
                {ergebnis.treffer.map((x, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    {x.vor.map((z, j) => (
                      <div key={`v${j}`} className="line dim">{[x.zeile - x.vor.length + j]} · {z}</div>
                    ))}
                    <div className="line red">[{x.zeile}] · {markiere(x.text, text.trim())}</div>
                    {x.nach.map((z, j) => (
                      <div key={`n${j}`} className="line dim">{[x.zeile + 1 + j]} · {z}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="empty">{t('werkzeuge.logHint')}</div>
        )}
        <div className="hint">{t('werkzeuge.logSafety')}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- Rahmen */

export default function Werkzeuge () {
  const { t } = useI18n()
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('werkzeuge.tab') || 'sicherheit' } catch (_) { return 'sicherheit' }
  })

  const wechseln = key => {
    setTab(key)
    try { localStorage.setItem('werkzeuge.tab', key) } catch (_) {}
  }

  return (
    <>
      <div className="tabs">
        {TABS.map(x => (
          <button key={x.key} className={`tab ${tab === x.key ? 'active' : ''}`} onClick={() => wechseln(x.key)}>
            {t(x.label)}
          </button>
        ))}
      </div>
      {tab === 'sicherheit' ? <SicherheitTab /> : null}
      {tab === 'sql' ? <SqlTab /> : null}
      {tab === 'logs' ? <LogsTab /> : null}
    </>
  )
}
