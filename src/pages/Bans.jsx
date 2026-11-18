import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { formatDate } from '../lib/constants'
import { useI18n } from '../i18n'
import Modal from '../components/Modal'

const PAGE_SIZE = 100

function banDuration (seconds, t) {
  if (!seconds) return t('bans.permanent')
  const days = Math.round(seconds / 86400)
  if (days >= 1) return t('bans.days', { count: days })
  const hours = Math.round(seconds / 3600)
  return t('bans.hours', { count: hours })
}

function Bans () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [tab, setTab] = useState('accounts')
  const [data, setData] = useState({ accounts: [], ips: [] })
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [nurAktiv, setNurAktiv] = useState(true)
  const [loading, setLoading] = useState(true)
  const [ipEntry, setIpEntry] = useState('')
  const [ipReason, setIpReason] = useState('')
  const [ipDays, setIpDays] = useState('0')
  // Rueckfrage vor dem Sperren und vor dem Loesen. Ohne sie ist ein
  // Klick auf "Sperren" sofort wirksam - und eine falsch eingetragene
  // Adresse sperrt den ganzen Adressraum.
  const [ipFrage, setIpFrage] = useState(null)
  const [ipLoeschFrage, setIpLoeschFrage] = useState(null)

  const load = async (bereich = tab, p = page, s = search, a = nurAktiv) => {
    setLoading(true)
    try {
      const [alles, seite] = await Promise.all([
        api.bans.list(),
        api.bans.page({
          bereich,
          search: s,
          aktiv: a ? '1' : 'all',
          limit: PAGE_SIZE,
          offset: p * PAGE_SIZE
        })
      ])
      setData(alles)
      setRows(seite.rows || [])
      setTotal(Number(seite.total) || 0)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(tab, page, search, nurAktiv) }, [tab, page, search, nurAktiv])

  // Filter- oder Reiterwechsel beginnt wieder auf Seite 1.
  useEffect(() => { setPage(0) }, [tab, search, nurAktiv])

  const unbanAccount = async row => {
    try {
      await api.bans.unbanAccount(row.account)
      toast(t('bans.unbanned'), 'ok')
      load(tab, page, search, nurAktiv)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const unbanIp = async row => {
    try {
      await api.bans.unbanIp(row.id)
      toast(t('bans.ipRemoved'), 'ok')
      load(tab, page, search, nurAktiv)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const banIp = async () => {
    try {
      await api.bans.banIp({ entry: ipEntry, bantime: Number(ipDays) * 86400, banreason: ipReason, banby: 'Panel' })
      toast(t('bans.ipBanned', { ip: ipEntry }), 'ok')
      setIpEntry('')
      setIpReason('')
      setIpDays('0')
      load(tab, page, search, nurAktiv)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  // Abgelaufene Bans aus den Tabellen entfernen (die UI zeigt sie nur als "aufgehoben")
  const aufraeumen = async () => {
    if (!window.confirm(t('bans.cleanupConfirm'))) return
    try {
      const r = await api.bans.aufraeumen()
      toast(t('bans.cleanupDone', { n: r.entfernt }), 'ok')
      load(tab, page, search, nurAktiv)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  return (
    <>
      <div className="tabs">
        <div className={`tab${tab === 'accounts' ? ' active' : ''}`} onClick={() => setTab('accounts')}>
          {t('bans.tabAccounts', { count: data.accounts.filter(a => a.active).length })}
        </div>
        <div className={`tab${tab === 'ips' ? ' active' : ''}`} onClick={() => setTab('ips')}>
          {t('bans.tabIps', { count: data.ips.filter(a => a.active).length })}
        </div>
      </div>

      <div className="inline" style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder={t('bans.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <label className="check-row" style={{ margin: 0, fontSize: 12.5 }}>
          <input type="checkbox" checked={nurAktiv} onChange={e => setNurAktiv(e.target.checked)} />
          {t('bans.onlyActive')}
        </label>
        <span className="muted" style={{ fontSize: 12 }}>{t('bans.count', { n: total })}</span>
      </div>

      {loading ? (
        <div className="spinner">{t('bans.loading')}</div>
      ) : tab === 'accounts' ? (
        <>
        <div className="card">
          <div className="card-head">
            <h3>{t('bans.accountsHeading')}</h3>
            <button className="btn sm" onClick={aufraeumen}>{t('bans.cleanup')}</button>
          </div>
          <div className="card-body tight">
            {!rows.length ? (
              <div className="empty">{t('bans.emptyAccounts')}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th><th>Name</th><th>{t('bans.reason')}</th><th>{t('bans.duration')}</th>
                      <th>{t('bans.by')}</th><th>{t('bans.date')}</th><th>{t('bans.status')}</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id}>
                        <td className="mono">{r.account}</td>
                        <td><strong>{r.username || '—'}</strong></td>
                        <td>{r.banreason}</td>
                        <td>{banDuration(r.bantime, t)}</td>
                        <td className="muted">{r.banby}</td>
                        <td className="muted">{formatDate(r.bannedate)}</td>
                        <td>
                          {r.active ? <span className="pill ban">{t('bans.badgeActive')}</span> : <span className="pill offline">{t('bans.badgeLifted')}</span>}
                        </td>
                        <td className="right">
                          {r.active ? <button className="btn sm success" onClick={() => unbanAccount(r)}>{t('bans.revoke')}</button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {Math.ceil(total / PAGE_SIZE) > 1 ? (
          <div className="inline" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {t('bans.pageOf', { page: page + 1, pages: Math.ceil(total / PAGE_SIZE) })}
            </span>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('bans.back')}</button>
            <button className="btn sm" disabled={page >= Math.ceil(total / PAGE_SIZE) - 1} onClick={() => setPage(p => p + 1)}>{t('bans.next')}</button>
          </div>
        ) : null}
        </>
      ) : (
        <>
          <div className="card">
            <div className="card-head"><h3>{t('bans.ipBlockHeading')}</h3></div>
            <div className="card-body">
              <div className="row">
                <div className="field">
                  <label>{t('bans.ipAddress')}</label>
                  <input type="text" value={ipEntry} onChange={e => setIpEntry(e.target.value)} placeholder={t('bans.ipPlaceholder')} />
                </div>
                <div className="field">
                  <label>{t('bans.reason')}</label>
                  <input type="text" value={ipReason} onChange={e => setIpReason(e.target.value)} list="ban-gruende" />
                  <datalist id="ban-gruende">
                    {[t('bans.grundCheat'), t('bans.grundWerbung'), t('bans.grundBeleidigung'), t('bans.grundBot')].map(g => <option key={g} value={g} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label>{t('bans.daysLabel')}</label>
                  <input type="number" min="0" value={ipDays} onChange={e => setIpDays(e.target.value)} />
                </div>
              </div>
              <button className="btn danger" disabled={!ipEntry} onClick={() => setIpFrage(true)}>{t('bans.ipBlock')}</button>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>{t('bans.ipListHeading', { count: total })}</h3></div>
            <div className="card-body tight">
              {!rows.length ? (
                <div className="empty">{t('bans.emptyIps')}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>ID</th><th>IP</th><th>{t('bans.reason')}</th><th>{t('bans.duration')}</th><th>{t('bans.by')}</th><th>{t('bans.date')}</th><th></th></tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id}>
                          <td className="mono muted">{r.id}</td>
                          <td className="mono">{r.entry}</td>
                          <td>{r.banreason}</td>
                          <td>{banDuration(r.bantime, t)}</td>
                          <td className="muted">{r.banby}</td>
                          <td className="muted">{formatDate(r.bannedate)}</td>
                          <td className="right">
                            <button className="btn sm success" onClick={() => setIpLoeschFrage(r)}>{t('bans.remove')}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {Math.ceil(total / PAGE_SIZE) > 1 ? (
            <div className="inline" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {t('bans.pageOf', { page: page + 1, pages: Math.ceil(total / PAGE_SIZE) })}
              </span>
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('bans.back')}</button>
              <button className="btn sm" disabled={page >= Math.ceil(total / PAGE_SIZE) - 1} onClick={() => setPage(p => p + 1)}>{t('bans.next')}</button>
            </div>
          ) : null}

          {/*
           * Rueckfrage vor dem Sperren einer Adresse.
           *
           * Eine IP-Sperre wirkt auf den ganzen Adressraum. Ein Tippfehler
           * sperrt damit nicht einen einzelnen Spieler, sondern alle, die
           * gerade dieselbe Adresse benutzen - im schlimmsten Fall den
           * eigenen Rechner.
           */}
          {ipFrage ? (
            <Modal
              title={t('bans.ipBlockTitle')}
              onClose={() => setIpFrage(null)}
              footer={
                <>
                  <button className="btn" onClick={() => setIpFrage(null)}>{t('bans.abort')}</button>
                  <button
                    className="btn danger"
                    onClick={() => {
                      setIpFrage(null)
                      banIp()
                    }}
                  >
                    {t('bans.ipBlockConfirm')}
                  </button>
                </>
              }
            >
              <p style={{ marginTop: 0 }}>{t('bans.ipBlockText')}</p>
              <div className="mono" style={{ fontSize: 13, color: '#e8ecf0' }}>{ipEntry}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                {t('bans.ipBlockDuration', { duration: banDuration(Number(ipDays) * 86400, t) })}
                {ipReason ? ` · ${t('bans.reason')}: ${ipReason}` : ''}
              </div>
            </Modal>
          ) : null}

          {ipLoeschFrage ? (
            <Modal
              title={t('bans.ipUnblockTitle')}
              onClose={() => setIpLoeschFrage(null)}
              footer={
                <>
                  <button className="btn" onClick={() => setIpLoeschFrage(null)}>{t('bans.abort')}</button>
                  <button
                    className="btn success"
                    onClick={() => {
                      const ziel = ipLoeschFrage
                      setIpLoeschFrage(null)
                      unbanIp(ziel)
                    }}
                  >
                    {t('bans.ipUnblockConfirm')}
                  </button>
                </>
              }
            >
              <p style={{ marginTop: 0 }}>{t('bans.ipUnblockText')}</p>
              <div className="mono" style={{ fontSize: 13, color: '#e8ecf0' }}>{ipLoeschFrage.entry}</div>
            </Modal>
          ) : null}
        </>
      )}
    </>
  )
}

export default Bans