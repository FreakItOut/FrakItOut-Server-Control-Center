import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useStatus } from '../App'
import { className, raceName, mapName, formatPlaytime, formatDate, gmLevelName } from '../lib/constants'
import { useI18n } from '../i18n'
import { ersteZeile } from '../lib/antwort'

const QUICK = [
  { cmd: 'kick {name}', label: 'online.quickKick' },
  { cmd: 'ban character {name} 1w Cheating', label: 'online.quickBan' },
  { cmd: 'teleport name {name} $home', label: 'online.quickTele' },
  { cmd: 'character customize {name}', label: 'online.quickAppearance' }
]

function Online () {
  const { toast, status } = useStatus()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  // Zustand gemerkt (localStorage): wer Bots dauerhaft einblendet, will das
  // auch nach einem Panel-Neustart so.
  const [hideBots, setHideBots] = useState(() => localStorage.getItem('panel:onlineHideBots') !== '0')
  const [alert, setAlert] = useState(null)
  // Auto-Aktualisierung anhalten, um Zeilen in Ruhe zu lesen
  const [pause, setPause] = useState(false)
  const [suche, setSuche] = useState('')
  const [klasse, setKlasse] = useState('alle')

  const load = async () => {
    try {
      // Der Filter liegt am Backend: die Zählung und der JOIN laufen dort -
      // auch beim "alle Bots"-Alarm bleibt die Zählung korrekt.
      const r = await api.online.list({ includeBots: true })
      setRows(r.rows || r)
      const liste = r.rows || r
      setAlert(
        !liste.length ? 'none'
        : liste.every(x => x.bot) ? 'alleBots'
        : (liste.some(x => x.bot) ? 'mix' : 'real')
      )
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  const views = useMemo(() => {
    const q = suche.trim().toLowerCase()
    return rows.filter(p => {
      if (hideBots && p.bot) return false
      if (klasse !== 'alle' && Number(p.classId) !== Number(klasse)) return false
      if (!q) return true
      return String(p.name || '').toLowerCase().includes(q) ||
        String(p.username || p.account || '').toLowerCase().includes(q) ||
        String(mapName(p.map, t) || '').toLowerCase().includes(q)
    })
  }, [rows, hideBots, klasse, suche, t])
  const botCount = rows.filter(p => p.bot).length
  const klassen = useMemo(() => {
    const map = new Map()
    for (const p of rows) {
      if (!map.has(p.classId)) map.set(p.classId, className(p.classId, t))
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }, [rows, t])

  useEffect(() => {
    load()
    if (pause) return undefined
    const iv = setInterval(load, 4000)
    return () => clearInterval(iv)
  }, [pause])

  const sendCommand = async (tpl, player) => {
    const cmd = tpl.replace('{name}', player.name)
    try {
      const res = await api.soap.send(cmd)
      const sagt = ersteZeile(res.antwort)
      toast(sagt ? t('online.sentWith', { cmd, out: sagt }) : t('online.sent', { cmd }), 'ok')
    } catch (e) {
      toast(t('online.sendError', { msg: e.message }), 'err')
    }
  }

  return (
    <>
      <div className="inline mb0" style={{ marginBottom: 14 }}>
        <button className="btn sm" onClick={load}>{t('online.refresh')}</button>
        <button className={`btn sm ${pause ? 'primary' : ''}`} onClick={() => setPause(p => !p)}>
          {pause ? t('online.weiter') : t('online.pause')}
        </button>
        <button
          className={`btn sm ${hideBots ? 'primary' : 'success'}`}
          onClick={() => setHideBots(h => {
            const neu = !h
            try { localStorage.setItem('panel:onlineHideBots', neu ? '1' : '0') } catch (_) {}
            return neu
          })}
          title={hideBots ? t('online.showBots', { count: botCount }) : t('online.hideBots', { count: botCount })}
        >
          {hideBots
            ? t('online.showBots', { count: botCount })
            : t('online.hideBots', { count: botCount })}
        </button>
        <input
          type="text"
          value={suche}
          onChange={e => setSuche(e.target.value)}
          placeholder={t('online.search')}
          style={{ maxWidth: 220 }}
        />
        <select value={klasse} onChange={e => setKlasse(e.target.value)} style={{ width: 160 }}>
          <option value="alle">{t('online.allClasses')}</option>
          {klassen.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('online.autoRefresh')}
          {status.world?.running ? '' : ` ${t('online.worldStopped')}`}
          {rows.length ? ` · ${t('online.playerCount', { count: views.length, total: rows.length })}` : ''}
        </span>
      </div>

      {alert && !hideBots ? null : null}

      {alert === 'alleBots' && rows.length > 0 ? (
        <div className="info-box mb0" style={{ marginBottom: 12, fontSize: 11.5 }}>
          {t('online.onlyBots', { count: rows.length })}
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <h3>{t('online.title', { count: views.length })}</h3>
        </div>
        <div className="card-body tight">
          {loading ? (
            <div className="spinner">{t('online.loading')}</div>
          ) : !rows.length ? (
            <div className="empty">{t('online.empty')}</div>
          ) : views.length === 0 ? (
            <div className="empty">
              {hideBots && rows.length > 0 && rows.every(p => p.bot)
                ? t('online.onlyBots', { count: rows.length })
                : t('online.noMatch')}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('online.thName')}</th><th>{t('online.thClass')}</th><th>{t('online.thRace')}</th><th className="num">{t('online.thLevel')}</th>
                    <th>{t('online.thAccount')}</th><th>{t('online.thMap')}</th><th>{t('online.thPlaytime')}</th><th>{t('online.thLoggedSince')}</th><th>{t('online.thActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {views.map(p => (
                    <tr key={p.guid}>
                      <td>
                        <strong>{p.name}</strong>{' '}
                        <span className={`pill ${p.bot ? 'offline' : 'online'}`} style={{ fontSize: 10 }}>
                          {p.bot ? t('online.badgeBot') : t('online.badgeOnline')}
                        </span>
                      </td>
                      <td>{className(p.classId, t)}</td>
                      <td>{raceName(p.race, t)}</td>
                      <td className="num">{p.level}</td>
                      <td>
                        {p.username || p.account}
                        {p.gmlevel > 0 ? (
                          <span className="pill gm" style={{ marginLeft: 6, fontSize: 10 }} title={gmLevelName(p.gmlevel, t)}>
                            GM{p.gmlevel}
                          </span>
                        ) : null}
                      </td>
                      <td className="muted">{mapName(p.map, t)}</td>
                      <td className="muted">{formatPlaytime(p.totaltime)}</td>
                      <td className="muted">{formatDate(p.logintime)}</td>
                      <td>
                        <div className="inline">
                          {QUICK.map(q => (
                            <button
                              key={q.cmd}
                              className="btn sm"
                              title={q.cmd.replace('{name}', p.name)}
                              disabled={!status.world?.running || p.bot}
                              onClick={() => sendCommand(q.cmd, p)}
                            >
                              {t(q.label)}
                            </button>
                          ))}
                          <button className="btn sm" onClick={() => navigate(`/characters/${p.guid}`)}>{t('online.details')}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default Online