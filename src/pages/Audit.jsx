import React, { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

/*
 * Aktionsprotokoll: wer hat im Panel was ausgeloest, und ist es
 * durchgelaufen? Die Eintraege liegen rolling in der Panel-Konfiguration
 * (max. 500). Filter und Suche arbeiten auf dieser Liste - es wird nichts
 * nachgeladen, was nicht schon im Speicher steht.
 */

const BEREICHE = [
  'accounts',
  'characters',
  'bans',
  'server',
  'backup',
  'modules',
  'config',
  'rates',
  'settings',
  'gm',
  'installer',
  'realms',
  'maintenance'
]

function Audit () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [eintraege, setEintraege] = useState([])
  const [gesamt, setGesamt] = useState(0)
  const [bereich, setBereich] = useState('alle')
  const [suche, setSuche] = useState('')
  const [busy, setBusy] = useState(true)

  const laden = async () => {
    setBusy(true)
    try {
      const r = await api.audit.liste({ limit: 500 })
      setEintraege(r.liste || [])
      setGesamt(r.gesamt || 0)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    laden()
  }, [])

  const sichtbar = useMemo(() => {
    const text = suche.trim().toLowerCase()
    return eintraege.filter(e => {
      if (bereich !== 'alle' && e.bereich !== bereich) return false
      if (!text) return true
      return `${e.details || ''}`.toLowerCase().includes(text)
    })
  }, [eintraege, bereich, suche])

  const exportieren = () => {
    const text = sichtbar.map(e => {
      const zeit = new Date(e.zeit).toLocaleString()
      const aktion = t(`audit.action.${e.aktion}`)
      return `[${zeit}] ${t(`audit.area.${e.bereich}`)} · ${aktion} · ${e.details || '-'} · ${e.ok ? t('audit.ok') : t('audit.failed')}`
    }).join('\r\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `panel-protokoll-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  const leeren = async () => {
    if (!window.confirm(t('audit.clearConfirm'))) return
    try {
      await api.audit.leeren()
      setEintraege([])
      setGesamt(0)
      toast(t('audit.cleared'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('audit.title')}</h3>
        <div className="inline">
          <span className="pill info">{t('audit.count', { n: sichtbar.length, gesamt })}</span>
          <button className="btn sm" onClick={laden} disabled={busy}>{t('audit.reload')}</button>
          <button className="btn sm" onClick={exportieren} disabled={!sichtbar.length}>{t('audit.export')}</button>
          <button className="btn sm danger" onClick={leeren} disabled={!gesamt}>{t('audit.clear')}</button>
        </div>
      </div>
      <div className="card-body tight">
        <div className="hint" style={{ padding: '9px 12px 0' }}>{t('audit.intro')}</div>
        <div className="inline" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)' }}>
          <select value={bereich} onChange={e => setBereich(e.target.value)} style={{ width: 170 }}>
            <option value="alle">{t('audit.allAreas')}</option>
            {BEREICHE.map(b => (
              <option key={b} value={b}>{t(`audit.area.${b}`)}</option>
            ))}
          </select>
          <input
            type="text"
            value={suche}
            onChange={e => setSuche(e.target.value)}
            placeholder={t('audit.search')}
            style={{ maxWidth: 260 }}
          />
          <span className="muted" style={{ fontSize: 11.5 }}>{t('audit.retention')}</span>
        </div>
        {!sichtbar.length ? (
          <div className="empty">{busy ? t('audit.loading') : t('audit.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('audit.time')}</th>
                  <th>{t('audit.areaColumn')}</th>
                  <th>{t('audit.actionColumn')}</th>
                  <th>{t('audit.details')}</th>
                  <th>{t('audit.result')}</th>
                </tr>
              </thead>
              <tbody>
                {sichtbar.map(e => (
                  <tr key={e.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>
                      {new Date(e.zeit).toLocaleString()}
                    </td>
                    <td>{t(`audit.area.${e.bereich}`)}</td>
                    <td>{t(`audit.action.${e.aktion}`)}</td>
                    <td className="mono" style={{ fontSize: 11.5, wordBreak: 'break-word' }}>{e.details || '—'}</td>
                    <td>
                      <span className={`pill ${e.ok ? 'online' : 'offline'}`}>
                        {e.ok ? t('audit.ok') : t('audit.failed')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Audit
