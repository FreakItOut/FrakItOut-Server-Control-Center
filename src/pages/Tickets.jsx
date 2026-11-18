import React, { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { formatDate } from '../lib/constants'
import Modal from '../components/Modal'

/*
 * Support-Tickets aus gm_ticket. Das Panel liest die Tabelle des Cores und
 * schreibt nur in die Spalten, die auch der Kern benutzt. Tickets werden
 * hier weder angelegt noch geloescht.
 */

function Tickets () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [status, setStatus] = useState('offen')
  const [suche, setSuche] = useState('')
  const [daten, setDaten] = useState({ liste: [], offen: 0, gesamt: 0 })
  const [busy, setBusy] = useState(true)
  const [detail, setDetail] = useState(null)
  const [gm, setGm] = useState([])
  const [kommentar, setKommentar] = useState('')
  const [antwort, setAntwort] = useState('')
  const [zielGuid, setZielGuid] = useState('')

  const laden = async () => {
    setBusy(true)
    try {
      const r = await api.tickets.liste({ status, suche })
      setDaten(r)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const detailAktualisieren = async id => {
    try {
      const r = await api.tickets.liste({ status: 'alle' })
      const frisch = (r.liste || []).find(x => x.id === id)
      if (frisch) setDetail(frisch)
    } catch (_) {}
  }

  useEffect(() => {
    const id = setTimeout(laden, suche ? 300 : 0)
    return () => clearTimeout(id)
  }, [status, suche])

  useEffect(() => {
    api.tickets.gmCharaktere().then(r => setGm(r.liste || [])).catch(() => {})
  }, [])

  const oeffnen = ticket => {
    setDetail(ticket)
    setKommentar(ticket.comment || '')
    setAntwort(ticket.response || '')
    setZielGuid(ticket.assignedTo ? String(ticket.assignedTo) : '')
  }

  const aktion = async (okKey, fn) => {
    setBusy(true)
    try {
      await fn()
      await laden()
      await detailAktualisieren(detail.id)
      toast(t(`tickets.${okKey}`), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const speichernKommentar = () => aktion('commentSavedOk', () => api.tickets.kommentar({ id: detail.id, text: kommentar }))
  const sendenAntwort = () => aktion('replySentOk', () => api.tickets.antworten({ id: detail.id, text: antwort }))
  const zuweisen = () => aktion('assignedOk', () => api.tickets.zuweisen({ id: detail.id, guid: Number(zielGuid) }))
  const schliessen = () => aktion('closedOk', () => api.tickets.schliessen({ id: detail.id }))
  const wiederOeffnen = () => aktion('reopenedOk', () => api.tickets.oeffnen({ id: detail.id }))

  const alter = iso => {
    if (!iso) return '—'
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 0) return '—'
    const std = Math.floor(ms / 3600000)
    if (std < 24) return t('tickets.ageHours', { n: Math.max(1, std) })
    return t('tickets.ageDays', { n: Math.floor(std / 24) })
  }

  const zaehler = useMemo(() => {
    const offen = daten.liste.filter(x => !x.completed).length
    return { offen, gesamt: daten.liste.length }
  }, [daten])

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('tickets.title')}</h3>
        <div className="inline">
          <span className={`pill ${daten.offen ? 'ban' : 'online'}`}>
            {t('tickets.openCount', { n: daten.offen })}
          </span>
          <button className="btn sm" onClick={laden} disabled={busy}>{t('tickets.reload')}</button>
        </div>
      </div>
      <div className="card-body tight">
        <div className="inline" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)' }}>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 150 }}>
            <option value="offen">{t('tickets.statusOpen')}</option>
            <option value="geschlossen">{t('tickets.statusClosed')}</option>
            <option value="alle">{t('tickets.statusAll')}</option>
          </select>
          <input
            type="text"
            value={suche}
            onChange={e => setSuche(e.target.value)}
            placeholder={t('tickets.search')}
            style={{ maxWidth: 280 }}
          />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {t('tickets.count', { n: zaehler.gesamt })}
          </span>
        </div>
        {busy && !daten.liste.length ? (
          <div className="empty">{t('tickets.loading')}</div>
        ) : !daten.liste.length ? (
          <div className="empty">{t('tickets.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('tickets.status')}</th>
                  <th>{t('tickets.subject')}</th>
                  <th>{t('tickets.character')}</th>
                  <th>{t('tickets.age')}</th>
                  <th>{t('tickets.assignee')}</th>
                  <th>{t('tickets.changed')}</th>
                </tr>
              </thead>
              <tbody>
                {daten.liste.map(x => (
                  <tr
                    key={x.id}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => oeffnen(x)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        oeffnen(x)
                      }
                    }}
                  >
                    <td>
                      <span className={`pill ${x.completed ? 'offline' : 'ban'}`}>
                        {t(x.completed ? 'tickets.closed' : 'tickets.open')}
                      </span>
                    </td>
                    <td>
                      <div>{x.description ? String(x.description).slice(0, 70) : t('tickets.noText')}</div>
                      <div className="muted" style={{ fontSize: 11 }}>#{x.id} · {x.name || '—'}</div>
                    </td>
                    <td>
                      {x.character
                        ? <span>{x.character.name} <span className="muted">({t('tickets.level', { n: x.character.level })})</span></span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>{alter(x.createTime)}</td>
                    <td>{x.assignedName || <span className="muted">—</span>}</td>
                    <td className="muted">{x.lastModified ? formatDate(x.lastModified) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail ? (
        <Modal
          size="lg"
          title={t('tickets.detailTitle', { id: detail.id })}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDetail(null)}>{t('tickets.closeDialog')}</button>
              {detail.completed
                ? <button className="btn" disabled={busy} onClick={wiederOeffnen}>{t('tickets.reopen')}</button>
                : <button className="btn danger" disabled={busy} onClick={schliessen}>{t('tickets.closeTicket')}</button>}
            </>
          }
        >
          <div className="grid cols-2" style={{ marginBottom: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 11.5 }}>{t('tickets.from')}</div>
              <strong>{detail.name || '—'}</strong>
              {detail.character ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {detail.character.name} · {t('tickets.level', { n: detail.character.level })}
                  {detail.character.online ? ` · ${t('tickets.online')}` : ''}
                </div>
              ) : null}
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11.5 }}>{t('tickets.meta')}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t('tickets.created', { when: detail.createTime ? formatDate(detail.createTime) : '—' })}
                <br />
                {t('tickets.position', {
                  map: detail.mapId,
                  x: Math.round(detail.posX),
                  y: Math.round(detail.posY)
                })}
              </div>
            </div>
          </div>

          <div className="preset-box" style={{ whiteSpace: 'pre-wrap' }}>
            {detail.description || t('tickets.noText')}
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>{t('tickets.assignTitle')}</label>
            <div className="inline">
              <select value={zielGuid} onChange={e => setZielGuid(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">{t('tickets.assignNone')}</option>
                {gm.map(c => (
                  <option key={c.guid} value={c.guid}>{c.name} ({c.level})</option>
                ))}
              </select>
              <button className="btn sm" disabled={busy || !zielGuid || String(detail.assignedTo) === String(zielGuid)} onClick={zuweisen}>
                {t('tickets.assign')}
              </button>
              {detail.assignedName ? <span className="muted">{t('tickets.assignedTo', { name: detail.assignedName })}</span> : null}
            </div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>{t('tickets.comment')}</label>
            <textarea
              rows={2}
              value={kommentar}
              onChange={e => setKommentar(e.target.value)}
              placeholder={t('tickets.commentHint')}
            />
            <button className="btn sm" style={{ marginTop: 6 }} disabled={busy || !kommentar.trim()} onClick={speichernKommentar}>
              {t('tickets.saveComment')}
            </button>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>{t('tickets.reply')}</label>
            <textarea
              rows={3}
              value={antwort}
              onChange={e => setAntwort(e.target.value)}
              placeholder={t('tickets.replyHint')}
            />
            <button className="btn sm primary" style={{ marginTop: 6 }} disabled={busy || !antwort.trim()} onClick={sendenAntwort}>
              {t('tickets.sendReply')}
            </button>
            <div className="hint">{t('tickets.replyNote')}</div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export default Tickets
