import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { formatMoney, formatNumber } from '../lib/constants'

/*
 * Wirtschaftsübersicht: Goldverteilung, Auktionen und Post. Rein lesend.
 */

function Wirtschaft () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(true)

  const laden = async () => {
    setBusy(true)
    try {
      setD(await api.wirtschaft.uebersicht())
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { laden() }, [])

  if (!d) return <div className="spinner">{busy ? t('wirtschaft.loading') : t('wirtschaft.noData')}</div>

  const gold = d.gold || { summe: 0, max: 0 }
  const auk = d.auktionen
  const post = d.post
  const maxStufe = Math.max(1, ...(d.stufen || []).map(s => s.gold))

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('wirtschaft.title')}</h3>
          <div className="inline">
            <span className="pill info">{t('wirtschaft.stand', { when: new Date(d.stand).toLocaleString() })}</span>
            <button className="btn sm" onClick={laden} disabled={busy}>{t('wirtschaft.reload')}</button>
          </div>
        </div>
        <div className="card-body">
          {d.anteilTop >= 10 ? (
            <div className="warn-box" style={{ marginBottom: 10 }}>
              {t('wirtschaft.outlier', { prozent: d.anteilTop, name: d.top[0] ? d.top[0].name : '—' })}
            </div>
          ) : null}
          <div className="grid cols-4">
            <div className="stat">
              <div className="label">{t('wirtschaft.totalGold')}</div>
              <div className="value" style={{ fontSize: 20 }}>{formatMoney(gold.summe)}</div>
              <div className="sub">{t('wirtschaft.charactersGold', { n: formatNumber(d.charaktere || 0) })}</div>
            </div>
            <div className="stat">
              <div className="label">{t('wirtschaft.auctions')}</div>
              <div className="value" style={{ fontSize: 20 }}>{formatNumber(auk ? auk.anzahl : 0)}</div>
              <div className="sub">{t('wirtschaft.auctionValue', { summe: formatMoney(auk ? auk.sofortsumme : 0) })}</div>
            </div>
            <div className="stat">
              <div className="label">{t('wirtschaft.mails')}</div>
              <div className="value" style={{ fontSize: 20 }}>{formatNumber(post ? post.anzahl : 0)}</div>
              <div className="sub">{t('wirtschaft.mailGold', { summe: formatMoney(post ? post.geld : 0) })}</div>
            </div>
            <div className="stat">
              <div className="label">{t('wirtschaft.topShare')}</div>
              <div className={`value ${d.anteilTop >= 10 ? 'red' : 'green'}`} style={{ fontSize: 20 }}>{d.anteilTop} %</div>
              <div className="sub">{t('wirtschaft.topShareHint')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>{t('wirtschaft.topTitle')}</h3></div>
          <div className="card-body tight">
            {!d.top.length ? <div className="empty">{t('wirtschaft.topEmpty')}</div> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>#</th><th>{t('wirtschaft.character')}</th><th>{t('wirtschaft.level')}</th><th>{t('wirtschaft.gold')}</th></tr>
                  </thead>
                  <tbody>
                    {d.top.map((x, i) => (
                      <tr key={x.guid}>
                        <td className="muted">{i + 1}</td>
                        <td>
                          <Link to={`/characters/${x.guid}`}>{x.name}</Link>
                          {x.online ? <span className="pill online" style={{ marginLeft: 6, fontSize: 10 }}>{t('wirtschaft.online')}</span> : null}
                        </td>
                        <td>{x.level}</td>
                        <td>{formatMoney(x.money)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head"><h3>{t('wirtschaft.bracketsTitle')}</h3></div>
            <div className="card-body">
              {(d.stufen || []).map(s => (
                <div key={s.bereich} style={{ marginBottom: 8 }}>
                  <div className="inline" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                    <span>{t('wirtschaft.bracket', { range: s.bereich })}</span>
                    <span className="muted">{t('wirtschaft.bracketChars', { n: s.charaktere })} · {formatMoney(s.gold)}</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--panel-2)', borderRadius: 4, overflow: 'hidden', marginTop: 3 }}>
                    <div style={{ height: '100%', width: `${Math.max(2, Math.round((s.gold / maxStufe) * 100))}%`, background: 'var(--c-red)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>{t('wirtschaft.marketTitle')}</h3></div>
            <div className="card-body">
              <table>
                <tbody>
                  <tr><td className="muted">{t('wirtschaft.auctionCount')}</td><td>{formatNumber(auk ? auk.anzahl : 0)}</td></tr>
                  <tr><td className="muted">{t('wirtschaft.auctionStart')}</td><td>{formatMoney(auk ? auk.startsumme : 0)}</td></tr>
                  <tr><td className="muted">{t('wirtschaft.auctionBuyout')}</td><td>{formatMoney(auk ? auk.sofortsumme : 0)}</td></tr>
                  <tr><td className="muted">{t('wirtschaft.auctionDeposit')}</td><td>{formatMoney(auk ? auk.kaution : 0)}</td></tr>
                  <tr><td className="muted">{t('wirtschaft.mailCount')}</td><td>{formatNumber(post ? post.anzahl : 0)}</td></tr>
                  <tr><td className="muted">{t('wirtschaft.mailCod')}</td><td>{formatMoney(post ? post.nachnahme : 0)}</td></tr>
                  <tr><td className="muted">{t('wirtschaft.mailItems')}</td><td>{formatNumber(post ? post.mitItems : 0)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Wirtschaft
