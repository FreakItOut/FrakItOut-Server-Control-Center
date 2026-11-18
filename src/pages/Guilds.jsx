import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { formatDate, formatMoney, className } from '../lib/constants'
import Modal from '../components/Modal'

/*
 * Gilden-Übersicht: Mitgliederzahl, Leiter, Gildenbank und Mitgliederliste.
 * Rein lesend - Gildenverwaltung bleibt im Spiel.
 */

function Guilds () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [suche, setSuche] = useState('')
  const [daten, setDaten] = useState({ verfuegbar: true, liste: [] })
  const [busy, setBusy] = useState(true)
  const [detail, setDetail] = useState(null)
  const [detailBusy, setDetailBusy] = useState(false)

  const laden = async () => {
    setBusy(true)
    try {
      setDaten(await api.guilds.liste({ suche }))
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const id = setTimeout(laden, suche ? 300 : 0)
    return () => clearTimeout(id)
  }, [suche])

  const oeffnen = async gilde => {
    setDetailBusy(true)
    try {
      setDetail(await api.guilds.detail({ id: gilde.id }))
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setDetailBusy(false)
    }
  }

  if (!daten.verfuegbar) {
    return <div className="card"><div className="card-body"><div className="empty">{t('guilds.notAvailable')}</div></div></div>
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('guilds.title')}</h3>
          <div className="inline">
            <span className="pill info">{t('guilds.count', { n: daten.liste.length })}</span>
            <button className="btn sm" onClick={laden} disabled={busy}>{t('guilds.reload')}</button>
          </div>
        </div>
        <div className="card-body tight">
          <div className="inline" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-soft)' }}>
            <input
              type="text"
              value={suche}
              onChange={e => setSuche(e.target.value)}
              placeholder={t('guilds.search')}
              style={{ maxWidth: 280 }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>{t('guilds.readOnly')}</span>
          </div>
          {busy && !daten.liste.length ? (
            <div className="empty">{t('guilds.loading')}</div>
          ) : !daten.liste.length ? (
            <div className="empty">{t('guilds.empty')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('guilds.name')}</th>
                    <th>{t('guilds.members')}</th>
                    <th>{t('guilds.avgLevel')}</th>
                    <th>{t('guilds.leader')}</th>
                    <th>{t('guilds.bank')}</th>
                    <th>{t('guilds.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {daten.liste.map(g => (
                    <tr
                      key={g.id}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => oeffnen(g)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          oeffnen(g)
                        }
                      }}
                    >
                      <td><strong>{g.name}</strong></td>
                      <td>{g.mitglieder}</td>
                      <td>{g.schnitt || '—'}</td>
                      <td>{g.leaderName || <span className="muted">—</span>}</td>
                      <td>{g.bankGold ? formatMoney(g.bankGold) : <span className="muted">—</span>}</td>
                      <td className="muted">{g.erstellt ? formatDate(g.erstellt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {detail ? (
        <Modal
          size="lg"
          title={t('guilds.detailTitle', { name: detail.gilde.name })}
          onClose={() => setDetail(null)}
          footer={<button className="btn" onClick={() => setDetail(null)}>{t('guilds.close')}</button>}
        >
          <div className="grid cols-3" style={{ marginBottom: 10 }}>
            <div className="stat">
              <div className="label">{t('guilds.members')}</div>
              <div className="value" style={{ fontSize: 20 }}>{detail.mitglieder.length}</div>
            </div>
            <div className="stat">
              <div className="label">{t('guilds.bank')}</div>
              <div className="value" style={{ fontSize: 20 }}>{formatMoney(detail.gilde.bankGold)}</div>
            </div>
            <div className="stat">
              <div className="label">{t('guilds.created')}</div>
              <div className="value" style={{ fontSize: 15 }}>{detail.gilde.erstellt ? formatDate(detail.gilde.erstellt) : '—'}</div>
            </div>
          </div>
          {detail.gilde.motd ? (
            <div className="info-box" style={{ marginBottom: 8 }}><strong>MOTD:</strong> {detail.gilde.motd}</div>
          ) : null}
          {detail.gilde.info ? (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{detail.gilde.info}</div>
          ) : null}
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table>
              <thead>
                <tr>
                  <th>{t('guilds.member')}</th>
                  <th>{t('guilds.rank')}</th>
                  <th>{t('guilds.level')}</th>
                  <th>{t('guilds.class')}</th>
                  <th>{t('guilds.status')}</th>
                  <th>{t('guilds.lastSeen')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.mitglieder.map(m => (
                  <tr key={m.guid}>
                    <td>
                      <Link to={`/characters/${m.guid}`} onClick={() => setDetail(null)}>{m.name}</Link>
                    </td>
                    <td>{m.rankName || m.rank}</td>
                    <td>{m.level}</td>
                    <td>{className(m.classId, t)}</td>
                    <td>
                      <span className={`pill ${m.online ? 'online' : 'offline'}`}>
                        {t(m.online ? 'guilds.online' : 'guilds.offline')}
                      </span>
                    </td>
                    <td className="muted">{m.zuletzt ? formatDate(m.zuletzt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}
      {detailBusy ? <div className="spinner">{t('guilds.loadingDetail')}</div> : null}
    </>
  )
}

export default Guilds
