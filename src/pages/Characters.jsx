import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { className, raceName, genderName, formatMoney, formatPlaytime, mapName, formatDateTime, formatNumber } from '../lib/constants'
import Modal from '../components/Modal'

const PAGE_SIZE = 50

function Characters () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const navigate = useNavigate()
  // Suche auch über die URL (#/characters?search=…) - verlinkbar, z. B.
  // vom Kontonamen auf der Charakter-Detailseite.
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loeschZiel, setLoeschZiel] = useState(null)
  // Bots ausblenden: Bei Servern mit Playerbots sind Tausende Bot-Charaktere
  // in der Liste - der Schalter filtert server-seitig über die Konto-Präfixe.
  // Zustand gemerkt (localStorage), sonst springt er bei jedem Start zurück.
  const [ohneBots, setOhneBots] = useState(() => localStorage.getItem('panel:charsOhneBots') === '1')
  // Nur gerade eingeloggte Charaktere (server-seitig, Count zieht mit)
  const [nurOnline, setNurOnline] = useState(() => localStorage.getItem('panel:charsNurOnline') === '1')
  // Sortierung. Ohne sie muss man bei 2003 Zeichen blaettern, um die
  // hoechste Stufe oder das meiste Gold zu finden. Zustand gemerkt
  // (localStorage), damit die Sortierung den Neustart übersteht.
  const [sort, setSort] = useState(() => localStorage.getItem('panel:charsSort') || '')
  const [dir, setDir] = useState(() => localStorage.getItem('panel:charsDir') === 'desc' ? 'desc' : 'asc')

  // Nach einer Spalte sortieren. Ein zweiter Klick dreht die Richtung um.
  const sortieren = spalte => {
    const neu = sort === spalte && dir === 'asc' ? 'desc' : 'asc'
    setSort(spalte)
    setDir(neu)
    setPage(0)
    try {
      localStorage.setItem('panel:charsSort', spalte)
      localStorage.setItem('panel:charsDir', neu)
    } catch (_) {}
    load(search, 0, spalte, neu)
  }

  /*
   * CSV-Export der aktuellen Filter-/Sortier-Liste (bis 10.000 Zeilen).
   * UTF-8-BOM und Semikolon: so öffnet Excel die Datei ohne Import-Dialog.
   */
  const csvExport = async () => {
    try {
      const alle = await api.characters.list({
        search,
        limit: 10000,
        offset: 0,
        sort,
        dir,
        ohneBots,
        nurOnline
      })
      const liste = Array.isArray(alle) ? alle : []
      const kopf = ['GUID', 'Name', 'Account', 'Class', 'Race', 'Level', 'Gold', 'Guild', 'Online', 'Playminutes']
      const zeilen = [kopf.join(';')]
      for (const c of liste) {
        zeilen.push([
          c.guid,
          c.name,
          c.username || c.account,
          className(c.classId, t),
          raceName(c.race, t),
          c.level,
          (Number(c.money || 0) / 10000).toFixed(2).replace('.', ','),
          c.guild || '',
          c.online ? 'yes' : 'no',
          Math.round(Number(c.totaltime || 0) / 60)
        ].map(v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`).join(';'))
      }
      const blob = new Blob(['\uFEFF' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `charaktere-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast(t('characters.csvOk', { n: liste.length }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  // Die Sortierpfeile an der Ueberschrift.
  const pfeil = spalte => {
    if (sort !== spalte) return ''
    return dir === 'asc' ? ' ▲' : ' ▼'
  }

  const kopf = (spalte, titel, klasse = '') => (
    <th
      className={`${klasse} sortable`}
      onClick={() => sortieren(spalte)}
      title={t('characters.sortBy', { column: titel })}
    >
      {titel}{pfeil(spalte)}
    </th>
  )

  const load = async (s = search, p = page, srt = sort, rchtung = dir) => {
    setLoading(true)
    try {
      const [list, count] = await Promise.all([
        api.characters.list({
          search: s,
          limit: PAGE_SIZE,
          offset: p * PAGE_SIZE,
          sort: srt,
          dir: rchtung,
          ohneBots,
          nurOnline
        }),
        api.characters.count({ search: s, ohneBots, nurOnline })
      ])
      setRows(list)
      setTotal(count)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(search, 0), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { load(search, page) }, [page])

  useEffect(() => { load(search, 0) }, [ohneBots])

  useEffect(() => { load(search, 0) }, [nurOnline])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const remove = async row => {
    // Erst fragen, WAS betroffen ist - nicht nur ob. Ein Loeschvorgang
    // nimmt je nach Charakter ueber 500 Zeilen mit, das gehoert vorher gesagt.
    let vorschau = null
    try {
      vorschau = await api.characters.deletePreview(row.guid)
    } catch (e) {
      toast(e.message, 'err')
      return
    }
    setLoeschZiel(vorschau)
  }

  const quickLevel = async (row, level) => {
    try {
      await api.characters.update(row.guid, { level })
      toast(t('characters.levelSet', { name: row.name, level }), 'ok')
      load(search, page)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const loeschBestaetigen = async () => {
    const z = loeschZiel
    setLoeschZiel(null)
    if (!z) return
    try {
      const r = await api.characters.delete({ guid: z.guid, bestaetigt: true })
      toast(t('characters.deletedWith', { name: z.name, count: r.zeilen || 0 }), 'ok')
      load(search, page)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  return (
    <>
    <div className="card">
      <div className="card-head">
        <h3>{t('characters.head', { count: Number(total) || 0 })}</h3>
        <div className="inline">
          <input
            type="text"
            placeholder={t('characters.search')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            style={{ width: 240 }}
          />
          <label className="check-row" style={{ margin: 0, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={ohneBots}
              onChange={e => {
                setOhneBots(e.target.checked)
                try { localStorage.setItem('panel:charsOhneBots', e.target.checked ? '1' : '0') } catch (_) {}
              }}
            />
            {t('characters.ohneBots')}
          </label>
          <label className="check-row" style={{ margin: 0, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={nurOnline}
              onChange={e => {
                setNurOnline(e.target.checked)
                try { localStorage.setItem('panel:charsNurOnline', e.target.checked ? '1' : '0') } catch (_) {}
              }}
            />
            {t('characters.nurOnline')}
          </label>
          <button className="btn sm" onClick={csvExport} disabled={loading}>{t('characters.csv')}</button>
        </div>
      </div>
      <div className="card-body tight">
        {loading ? (
          <div className="spinner">{t('characters.loading')}</div>
        ) : !rows.length ? (
          <div className="empty">{t('characters.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>GUID</th>
                  {kopf('name', t('characters.name'))}
                  <th>{t('characters.accountCol')}</th>
                  {kopf('class', t('characters.class'))}
                  {kopf('race', t('characters.race'))}
                  <th>G</th>
                  {kopf('level', t('characters.level'), 'num')}
                  {kopf('money', t('characters.gold'), 'num')}
                  <th>Map</th>
                  <th>{t('characters.status')}</th>
                  {kopf('totaltime', t('characters.playtime'))}
                  <th>{t('characters.onlineSince')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.guid}>
                    <td className="mono muted">{c.guid}</td>
                    <td>
                      <strong>{c.name}</strong>
                      {c.bot ? (
                        <span className="pill offline" style={{ marginLeft: 6, fontSize: 10 }} title={c.username || ''}>
                          {t('characters.botTag')}
                        </span>
                      ) : null}
                      {c.guild ? <span className="muted"> · {c.guild}</span> : null}
                    </td>
                    <td className="mono muted">
                      {c.username
                        ? <Link to={`/accounts?search=${encodeURIComponent(c.username)}`}>{c.username}</Link>
                        : c.account}
                    </td>
                    <td>{className(c.classId, t)}</td>
                    <td>{raceName(c.race, t)}</td>
                    <td className="muted">{genderName(c.gender, t)}</td>
                    <td className="num">
                      <select
                        value={c.level}
                        onChange={e => quickLevel(c, Number(e.target.value))}
                        style={{ width: 68, padding: '3px 6px' }}
                      >
                        {Array.from({ length: 80 }, (_, i) => i + 1).map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{formatMoney(c.money)}</td>
                    <td className="muted">{mapName(c.map, t)} <span className="mono">({c.map})</span></td>
                    <td>
                      <span className={`pill ${c.online ? 'online' : 'offline'}`}>{c.online ? 'online' : 'offline'}</span>
                    </td>
                    <td className="muted">{formatPlaytime(c.totaltime)}</td>
                    <td className="muted">{c.logintime ? formatDateTime(Math.floor(new Date(c.logintime).getTime() / 1000)) : '—'}</td>
                    <td className="right">
                      <div className="inline" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => navigate(`/characters/${c.guid}`)}>{t('characters.details')}</button>
                        <button className="btn sm danger" onClick={() => remove(c)}>{t('characters.delete')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pages > 1 ? (
        <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('characters.pageOf', { page: page + 1, pages })}</span>
          <div className="inline">
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('characters.back')}</button>
            <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>{t('characters.next')}</button>
          </div>
        </div>
      ) : null}
    </div>

      {loeschZiel ? (
        <Modal
          title={t('characters.deleteTitle', { name: loeschZiel.name })}
          onClose={() => setLoeschZiel(null)}
          footer={
            <>
              <button className="btn" onClick={() => setLoeschZiel(null)}>{t('characters.abort')}</button>
              <button className="btn danger" disabled={loeschZiel.online} onClick={loeschBestaetigen}>
                {t('characters.deleteConfirmBtn')}
              </button>
            </>
          }
        >
          {loeschZiel.online ? (
            <div className="error-box">{t('characters.deleteOnline')}</div>
          ) : null}
          <p style={{ marginTop: 0 }}>
            {t('characters.deleteCount', { count: loeschZiel.zeilen, name: loeschZiel.name })}
          </p>
          {loeschZiel.hustiere > 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>
              {t('characters.deletePets', { count: loeschZiel.hustiere })}
            </p>
          ) : null}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t('characters.deleteTables', { count: loeschZiel.tabellen })}
          </div>
          <div className="results" style={{ marginTop: 6 }}>
            {loeschZiel.posten.map(p => (
              <div key={p.tabelle} className="result-row">
                <span className="mono" style={{ fontSize: 12 }}>{p.tabelle}</span>
                <span className="meta">{formatNumber(p.rows)}</span>
              </div>
            ))}
          </div>
          <div className="info-box" style={{ fontSize: 12, marginTop: 10 }}>
            {t('characters.deleteWarning')}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

export default Characters