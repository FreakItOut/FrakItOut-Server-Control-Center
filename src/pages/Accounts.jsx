import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import Modal from '../components/Modal'
import { useStatus } from '../App'
import { formatDate, gmLevelName } from '../lib/constants'
import { useI18n } from '../i18n'

// Eine Seite Konten. Bei Repacks mit hunderten Bot-Konten bleibt die
// Tabelle so schnell; die Suche laeuft ohnehin in der Datenbank.
const PAGE_SIZE = 100

function AccountModal ({ account, onClose, onSaved }) {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [pw, setPw] = useState('')
  const [gm, setGm] = useState(account ? account.gmlevel : 0)
  const [email, setEmail] = useState(account ? account.email || '' : '')
  const [username, setUsername] = useState('')

  const isNew = !account

  const create = async () => {
    try {
      // Das Backend legt die E-Mail dann leer an, wie AzerothCore es tut
      await api.accounts.create({ username, password: pw, gmlevel: gm })
      toast(t('accounts.created', { name: username }), 'ok')
      onSaved()
      onClose()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const save = async () => {
    try {
      if (pw) await api.accounts.setPassword({ accountId: account.id, password: pw })
      await api.accounts.setGmLevel({ accountId: account.id, gmlevel: gm })
      await api.accounts.setEmail({ accountId: account.id, email })
      toast(t('accounts.saved'), 'ok')
      onSaved()
      onClose()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  return (
    <Modal
      title={isNew ? t('accounts.createTitle') : t('accounts.editTitle', { name: account.username })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('accounts.cancel')}</button>
          <button className="btn primary" onClick={isNew ? create : save}>{t('accounts.save')}</button>
        </>
      }
    >
      {isNew ? (
        <div className="field">
          <label>{t('accounts.username')}</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={t('accounts.usernamePlaceholder')}
            autoFocus
          />
        </div>
      ) : (
        <div className="info-box mb0">
          ID {account.id} · {t('accounts.charactersCount', { count: account.characters })} · {gmLevelName(account.gmlevel, t)}
          {account.lastLogin ? ` · ${t('accounts.lastLoginAt', { date: formatDate(account.lastLogin) })}` : ''}
        </div>
      )}

      <div className="field mt">
        <label>{t('accounts.password')}</label>
        <input
          type="text"
          value={pw}
          onChange={e => setPw(e.target.value)}
          placeholder={isNew ? t('accounts.pwPlaceholderNew') : t('accounts.pwPlaceholderKeep')}
        />
        {!isNew ? <div className="hint">{t('accounts.pwHint')}</div> : null}
      </div>

      <div className="row">
        {isNew ? null : (
          <div className="field">
            <label>{t('accounts.email')}</label>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>{t('accounts.gmLevel')}</label>
          <select value={gm} onChange={e => setGm(Number(e.target.value))}>
            {[0, 1, 2, 3].map(v => <option key={v} value={v}>{v} — {gmLevelName(v, t)}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

/* Dialog zum Zuruecksetzen des Passworts */
function PasswordResetModal ({ account, onClose, onSaved }) {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  const mismatch = pw2.length > 0 && pw !== pw2
  const tooShort = pw.length > 0 && pw.length < 4

  const submit = async () => {
    if (tooShort) {
      toast(t('accounts.pwTooShort'), 'err')
      return
    }
    if (pw !== pw2) {
      toast(t('accounts.pwMismatch'), 'err')
      return
    }
    setBusy(true)
    try {
      await api.accounts.setPassword({ accountId: account.id, password: pw })
      toast(t('accounts.pwResetDone', { name: account.username }), 'ok')
      onSaved()
      onClose()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const suggest = () => {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let s = ''
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)]
    setPw(s)
    setPw2(s)
    setShow(true)
  }

  return (
    <Modal
      title={t('accounts.resetTitle', { name: account.username })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('accounts.cancel')}</button>
          <button
            className="btn primary"
            disabled={busy || !pw || pw !== pw2 || tooShort}
            onClick={submit}
          >
            {t('accounts.pwSet')}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t('accounts.newPassword')}</label>
        <div className="inline mb0">
          <input
            type={show ? 'text' : 'password'}
            className="flex-1 mono"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoFocus
          />
          <button className="btn sm" onClick={() => setShow(s => !s)}>
            {show ? t('accounts.hide') : t('accounts.show')}
          </button>
        </div>
        <div className="hint" style={tooShort ? { color: 'var(--red)' } : undefined}>
          {tooShort ? t('accounts.minChars') : t('accounts.minChars')}
        </div>
      </div>

      <div className="field">
        <label>{t('accounts.newPasswordRepeat')}</label>
        <input
          type={show ? 'text' : 'password'}
          className="mono"
          value={pw2}
          onChange={e => setPw2(e.target.value)}
          style={mismatch ? { borderColor: 'var(--red)' } : undefined}
        />
        <div className="hint" style={mismatch ? { color: 'var(--red)' } : undefined}>
          {mismatch ? t('accounts.mismatchHint') : t('accounts.repeatHint')}
        </div>
      </div>

      <div className="inline mb0">
        <button className="btn sm" onClick={suggest}>{t('accounts.randomPw')}</button>
      </div>

      <div className="info-box mt" style={{ fontSize: 12 }}>
        {t('accounts.resetNote')}
      </div>
    </Modal>
  )
}

function Accounts () {
  const { toast } = useStatus()
  const { t } = useI18n()
  // Suche auch über die URL (#/accounts?search=…) - verlinkbar aus der
  // Charakterliste (Konto-Spalte) heraus.
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  // Mehrfachauswahl gilt nur fuer die aktuelle Seite und wird beim
  // Blaettern/Filterwechsel geleert - kein versehentliches Loeschen ueber Seiten.
  const [auswahl, setAuswahl] = useState([])
  const [bulkFrage, setBulkFrage] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [loginFilter, setLoginFilter] = useState('all')
  // Bot-Konten ausblenden (Zustand gemerkt): bei Repack-Übernahmen liegen
  // 200+ Bot-Konten in der Tabelle - die echten gehen sonst unter.
  const [ohneBots, setOhneBots] = useState(() => localStorage.getItem('panel:accountsOhneBots') === '1')
  // edit: undefined = Dialog zu, null = neuen Account anlegen, Objekt = bearbeiten
  const [edit, setEdit] = useState(undefined)
  const [banFor, setBanFor] = useState(null)
  const [banReason, setBanReason] = useState(t('accounts.defaultBanReason'))
  const [banTime, setBanTime] = useState('0')
  // null = Dialog zu, Objekt = Account, dessen Passwort zurückgesetzt wird
  const [resetFor, setResetFor] = useState(null)

  // Anmelde-Filter und Bot-Filter laufen jetzt in der Datenbankabfrage
  // (accounts.page), damit Seitenzahl und Treffer zusammenpassen.

  const load = async (s = search, p = page, f = loginFilter) => {
    setLoading(true)
    try {
      const r = await api.accounts.page({
        search: s,
        ohneBots,
        filter: f,
        limit: PAGE_SIZE,
        offset: p * PAGE_SIZE
      })
      setRows(r.rows || [])
      setTotal(Number(r.total) || 0)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  // CSV der gefilterten Liste (UTF-8-BOM, Semikolon - Excel ohne Import-Dialog)
  const csvExport = async () => {
    try {
      // Fuer den Export die vollstaendige Trefferliste laden, nicht nur
      // die gerade sichtbare Seite.
      const alle = await api.accounts.list({ search, ohneBots, filter: loginFilter })
      const kopf = ['ID', 'Account', 'Email', 'GM', 'Characters', 'Status', 'LastLogin']
      const zeilen = [kopf.join(';')]
      for (const a of alle) {
        const status = a.banned ? 'banned' : a.locked ? 'locked' : a.online ? 'online' : 'active'
        zeilen.push([a.id, a.username, a.email || '', a.gmlevel || 0, a.characters || 0, status, a.lastLogin || '']
          .map(v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`)
          .join(';'))
      }
      const blob = new Blob(['\uFEFF' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `konten-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast(t('accounts.csvOk', { n: alle.length }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (page !== 0) {
        setPage(0)
        return
      }
      load(search, 0, loginFilter)
    }, 250)
    return () => clearTimeout(timer)
  }, [search, ohneBots, loginFilter])

  useEffect(() => {
    load(search, page, loginFilter)
  }, [page])

  useEffect(() => { setAuswahl([]) }, [page, search, ohneBots, loginFilter])

  const doBan = async () => {
    try {
      await api.bans.banAccount({
        account: banFor.id,
        bantime: Number(banTime) * 86400,
        banreason: banReason,
        banby: 'Panel'
      })
      toast(t('accounts.banned', { name: banFor.username }), 'ok')
      setBanFor(null)
      load(search, page, loginFilter)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const unban = async row => {
    try {
      await api.bans.unbanAccount(row.id)
      toast(t('accounts.unbanned'), 'ok')
      load(search, page, loginFilter)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const remove = async row => {
    if (!window.confirm(t('accounts.deleteConfirm', { name: row.username, count: row.characters }))) return
    try {
      await api.accounts.delete({ id: row.id })
      toast(t('accounts.deleted'), 'ok')
      load(search, page, loginFilter)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const alleGewaehlt = rows.length > 0 && rows.every(r => auswahl.includes(r.id))
  const umschalten = id => setAuswahl(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const alleUmschalten = () => setAuswahl(alleGewaehlt ? [] : rows.map(r => r.id))

  const bulkAusfuehren = async () => {
    if (!bulkFrage) return
    setBulkBusy(true)
    let erledigt = 0
    try {
      // Vor dem Loeschen mehrerer Konten immer sichern. Schlaegt die
      // Sicherung fehl, wird nicht geloescht - lieber abbrechen als
      // ohne Rueckweg arbeiten.
      if (bulkFrage.art === 'delete') {
        try {
          const sicherung = await api.backup.create()
          toast(t('accounts.bulkBackup', { stamp: sicherung.stamp }), 'ok')
        } catch (e) {
          toast(t('accounts.bulkBackupFehler', { fehler: e.message }), 'err')
          return
        }
      }
      for (const id of bulkFrage.ids) {
        try {
          if (bulkFrage.art === 'ban') {
            await api.bans.banAccount({
              account: id,
              bantime: Number(banTime) * 86400,
              banreason: banReason || t('accounts.defaultBanReason'),
              banby: 'Panel'
            })
          } else if (bulkFrage.art === 'unban') {
            await api.bans.unbanAccount(id)
          } else {
            await api.accounts.delete({ id })
          }
          erledigt++
        } catch (_) {}
      }
      toast(t('accounts.bulkDone', { n: erledigt }), 'ok')
      setBulkFrage(null)
      setAuswahl([])
      load(search, page, loginFilter)
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('accounts.title', { count: total })}</h3>
          <div className="inline">
            <input
              type="text"
              placeholder={t('accounts.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <button className="btn primary sm" onClick={() => setEdit(null)}>{t('accounts.create')}</button>
          </div>
        </div>
        <div style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={loginFilter}
            onChange={e => setLoginFilter(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="all">{t('accounts.loginFilterAll')}</option>
            <option value="7d">{t('accounts.loginFilter7d')}</option>
            <option value="30d">{t('accounts.loginFilter30d')}</option>
            <option value="never">{t('accounts.loginFilterNever')}</option>
            <option value="nochars">{t('accounts.loginFilterNoChars')}</option>
            <option value="gm">{t('accounts.loginFilterGm')}</option>
          </select>
          <label className="check-row" style={{ margin: 0, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={ohneBots}
              onChange={e => {
                setOhneBots(e.target.checked)
                try { localStorage.setItem('panel:accountsOhneBots', e.target.checked ? '1' : '0') } catch (_) {}
              }}
            />
            {t('accounts.ohneBots')}
          </label>
          <button className="btn sm" onClick={csvExport} disabled={loading}>{t('accounts.csv')}</button>
        </div>
      <div className="card-body tight">
          {auswahl.length ? (
            <div className="bulk-bar">
              <strong>{t('accounts.selected', { n: auswahl.length })}</strong>
              <button className="btn sm danger" onClick={() => setBulkFrage({ art: 'ban', ids: [...auswahl] })}>
                {t('accounts.bulkBan')}
              </button>
              <button className="btn sm success" onClick={() => setBulkFrage({ art: 'unban', ids: [...auswahl] })}>
                {t('accounts.bulkUnban')}
              </button>
              <button className="btn sm danger" onClick={() => setBulkFrage({ art: 'delete', ids: [...auswahl] })}>
                {t('accounts.bulkDelete')}
              </button>
              <button className="btn sm" onClick={() => setAuswahl([])}>{t('accounts.clearSelection')}</button>
            </div>
          ) : null}
          {loading ? (
            <div className="spinner">{t('accounts.loading')}</div>
          ) : !rows.length ? (
            <div className="empty">{t('accounts.empty')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input
                        type="checkbox"
                        checked={alleGewaehlt}
                        onChange={alleUmschalten}
                        aria-label={t('accounts.selectAll')}
                      />
                    </th>
                    <th>ID</th><th>{t('accounts.username')}</th><th>GM</th>
                    <th className="num">{t('accounts.chars')}</th><th>{t('accounts.status')}</th>
                    <th>{t('accounts.lastOnline')}</th><th>{t('accounts.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(a => (
                    <tr key={a.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={auswahl.includes(a.id)}
                          onChange={() => umschalten(a.id)}
                          aria-label={t('accounts.selectOne', { name: a.username })}
                        />
                      </td>
                      <td className="mono muted">{a.id}</td>
                      <td>
                        <strong>{a.username}</strong>
                        {a.email ? (
                          <div className="muted" style={{ fontSize: 11 }}>{a.email}</div>
                        ) : null}
                      </td>
                      <td>
                        {a.gmlevel > 0 ? (
                          <span className="pill gm">GM{a.gmlevel}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {a.characters ? (
                          <Link to={`/characters?search=${encodeURIComponent(a.username)}`}>{a.characters}</Link>
                        ) : a.characters}
                      </td>
                      <td>
                        {a.banned ? <span className="pill ban">{t('accounts.badgeBanned')}</span>
                          : a.locked ? <span className="pill ban">{t('accounts.badgeLocked')}</span>
                          : a.online ? <span className="pill online">{t('accounts.badgeOnline')}</span>
                          : <span className="pill offline">{t('accounts.badgeActive')}</span>}
                      </td>
                      <td className="muted">{formatDate(a.lastLogin)}</td>
                      <td className="right">
                        <div className="inline" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <button
                            className="btn sm"
                            onClick={() => setResetFor(a)}
                            title={t('accounts.resetTooltip', { name: a.username })}
                            aria-label={t('accounts.resetAria')}
                          >
                            🔑
                          </button>
                          <button
                            className="btn sm"
                            onClick={() => setEdit(a)}
                            title={t('accounts.editTooltip')}
                            aria-label={t('accounts.editAria')}
                          >
                            ✎
                          </button>
                          {a.banned ? (
                            <button
                              className="btn sm success"
                              onClick={() => unban(a)}
                              title={t('accounts.unbanTooltip')}
                              aria-label={t('accounts.unbanAria')}
                            >
                              ⛌
                            </button>
                          ) : (
                            <button
                              className="btn sm danger"
                              onClick={() => { setBanFor(a); setBanReason(''); setBanTime('0') }}
                              title={t('accounts.banTooltip')}
                              aria-label={t('accounts.banAria')}
                            >
                              ⊘
                            </button>
                          )}
                          <button
                            className="btn sm danger"
                            onClick={() => remove(a)}
                            title={t('accounts.deleteTooltip')}
                            aria-label={t('accounts.deleteAria')}
                          >
                            🗑
                          </button>
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

      {Math.ceil(total / PAGE_SIZE) > 1 ? (
        <div className="inline" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('accounts.pageOf', { page: page + 1, pages: Math.ceil(total / PAGE_SIZE) })}
          </span>
          <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            {t('accounts.back')}
          </button>
          <button
            className="btn sm"
            disabled={page >= Math.ceil(total / PAGE_SIZE) - 1}
            onClick={() => setPage(p => p + 1)}
          >
            {t('accounts.next')}
          </button>
        </div>
      ) : null}

      <div className="info-box">
        {t('accounts.legendPrefix')} <strong>{t('accounts.actions')}</strong>:{' '}
        <strong>🔑</strong> {t('accounts.legendReset')} ·{' '}
        <strong>✎</strong> {t('accounts.legendEdit')} · <strong>⊘</strong> {t('accounts.legendBan')}{' '}
        <strong>⛌</strong> {t('accounts.legendUnban')} · <strong>🗑</strong> {t('accounts.legendDelete')}
      </div>

      <div className="info-box">
        {t('accounts.srpNote')}
      </div>

      {edit !== undefined ? (
        <AccountModal account={edit} onClose={() => setEdit(undefined)} onSaved={() => load(search, page, loginFilter)} />
      ) : null}

      {resetFor ? (
        <PasswordResetModal
          account={resetFor}
          onClose={() => setResetFor(null)}
          onSaved={() => load(search, page, loginFilter)}
        />
      ) : null}

      {banFor ? (
        <Modal
          title={t('accounts.banTitle', { name: banFor.username })}
          onClose={() => setBanFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setBanFor(null)}>{t('accounts.cancel')}</button>
              <button className="btn danger" onClick={doBan}>{t('accounts.ban')}</button>
            </>
          }
        >
          <div className="field">
            <label>{t('accounts.reason')}</label>
            <input type="text" value={banReason} onChange={e => setBanReason(e.target.value)} list="ban-gruende-konto" />
            <datalist id="ban-gruende-konto">
              {[t('bans.grundCheat'), t('bans.grundWerbung'), t('bans.grundBeleidigung'), t('bans.grundBot')].map(g => <option key={g} value={g} />)}
            </datalist>
          </div>
          <div className="field">
            <label>{t('accounts.durationDays')}</label>
            <input type="number" min="0" value={banTime} onChange={e => setBanTime(e.target.value)} />
          </div>
          <div className="info-box mb0">
            {t('accounts.banNote1')} <span className="mono">account_banned</span>
            {t('accounts.banNote2')} <span className="mono">reload ban</span>{' '}
            {t('accounts.banNote3')}
          </div>
        </Modal>
      ) : null}

      {bulkFrage ? (
        <Modal
          title={t(bulkFrage.art === 'ban'
            ? 'accounts.bulkBanTitle'
            : bulkFrage.art === 'unban'
              ? 'accounts.bulkUnbanTitle'
              : 'accounts.bulkDeleteTitle')}
          onClose={() => !bulkBusy && setBulkFrage(null)}
          footer={
            <>
              <button className="btn" disabled={bulkBusy} onClick={() => setBulkFrage(null)}>{t('accounts.cancel')}</button>
              <button
                className={bulkFrage.art === 'unban' ? 'btn success' : 'btn danger'}
                disabled={bulkBusy}
                onClick={bulkAusfuehren}
              >
                {bulkBusy ? t('accounts.bulkLaeuft') : t('accounts.bulkConfirm')}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>{t('accounts.bulkCount', { n: bulkFrage.ids.length })}</p>
          {bulkFrage.art === 'ban' ? (
            <>
              <div className="field">
                <label>{t('accounts.reason')}</label>
                <input type="text" value={banReason} onChange={e => setBanReason(e.target.value)} list="ban-gruende-konto" />
              </div>
              <div className="field">
                <label>{t('accounts.durationDays')}</label>
                <input type="number" min="0" value={banTime} onChange={e => setBanTime(e.target.value)} />
              </div>
            </>
          ) : (
            <div className={bulkFrage.art === 'delete' ? 'error-box' : 'info-box'}>
              {t(bulkFrage.art === 'unban' ? 'accounts.bulkUnbanHint' : 'accounts.bulkDeleteHint')}
            </div>
          )}
        </Modal>
      ) : null}

      <BulkPasswortKarte />
    </>
  )
}

/*
 * Bulk-Reset für übernommene Konten: Konten aus einem alten Server mit
 * veraltetem Passwort-Format (sha_pass_hash statt SRP6) können sich nicht
 * einloggen. Mit einem Passwort werden ALLE solchen Konten auf einmal
 * nutzbar gemacht - statt jedes Konto einzeln durchzuklicken.
 */
function BulkPasswortKarte () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [pass, setPass] = useState('')
  const [frage, setFrage] = useState(false)
  const [busy, setBusy] = useState(false)
  // Vorab-Zahl: WIE VIELE Konten sind überhaupt betroffen? (-1 = unklar)
  const [anzahl, setAnzahl] = useState(null)

  const frageZahl = async () => {
    try {
      setAnzahl(await api.accounts.ohneSrp6Anzahl())
    } catch (_) {
      setAnzahl(-1)
    }
  }

  useEffect(() => { frageZahl() }, [])

  const starten = async () => {
    setFrage(false)
    setBusy(true)
    try {
      const r = await api.accounts.bulkPasswortReset({ password: pass })
      toast(t('accounts.bulkOk', { n: r.konten }), 'ok')
      setPass('')
      frageZahl()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>{t('accounts.bulkTitel')}</h3></div>
      <div className="card-body">
        <p style={{ marginTop: 0 }}>{t('accounts.bulkIntro')}</p>
        {anzahl > 0 ? (
          <div className="info-box mb0" style={{ marginBottom: 10 }}>
            {t('accounts.bulkAnzahl', { n: anzahl })}
          </div>
        ) : anzahl === 0 ? (
          <div className="ok-box mb0" style={{ marginBottom: 10 }}>
            {t('accounts.bulkLeer')}
          </div>
        ) : null}
        {!frage ? (
          <div className="inline mb0">
            <div className="field" style={{ width: 200, margin: 0 }}>
              <label>{t('accounts.bulkPasswort')}</label>
              <input
                type="password"
                value={pass}
                onChange={e => setPass(e.target.value)}
                placeholder={t('accounts.bulkPasswortPlatz')}
              />
            </div>
            <button className="btn" disabled={busy || !pass || anzahl === 0} onClick={() => setFrage(true)}>
              {t('accounts.bulkBtn')}
            </button>
          </div>
        ) : (
          <div className="mt">
            <div className="error-box">{t('accounts.bulkWarn')}</div>
            <div className="inline">
              <button className="btn danger" onClick={starten} disabled={busy}>
                {t('backup.fremdJa')}
              </button>
              <button className="btn" onClick={() => setFrage(false)}>{t('backup.abort')}</button>
            </div>
          </div>
        )}
        <div className="hint">{t('accounts.bulkHint')}</div>
      </div>
    </div>
  )
}

export default Accounts