import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import Modal from '../components/Modal'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

const EMPTY = {
  id: null,
  name: '',
  address: '127.0.0.1',
  port: 8085,
  icon: 0,
  timezone: 1,
  security: 0,
  population: 0
}

function Realms () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [realms, setRealms] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)

  const SECURITY = [
    ['0', t('realms.securityOpen')],
    ['1', t('realms.securityWowAccounts')],
    ['2', t('realms.securityWowAndPvp')],
    ['3', t('realms.securityAll')]
  ]

  const load = async () => {
    try {
      setRealms(await api.realms.list())
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    try {
      if (edit.id) await api.realms.update(edit)
      else await api.realms.create(edit)
      toast(t('realms.saved'), 'ok')
      setEdit(null)
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const remove = async realm => {
    if (!window.confirm(t('realms.deleteConfirm', { name: realm.name }))) return
    try {
      await api.realms.delete({ id: realm.id })
      toast(t('realms.deleted'), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /*
   * Wartungsmodus: OFFLINE-Bit in realmlist.flags. Der Authserver liest die
   * Realm-Liste nur beim Start - deshalb startet er hier neu (kurze Pause
   * für neue Logins, laufende Spiel-Sessions bleiben unberührt).
   */
  const wartung = async realm => {
    const offline = (Number(realm.realmflags) & 2) !== 2
    if (!window.confirm(t(offline ? 'realms.wartungAnFrage' : 'realms.wartungAusFrage', { name: realm.name }))) return
    try {
      const res = await api.realms.wartung({ id: realm.id, offline })
      toast(t('realms.wartungDone', { name: realm.name, auth: res.authNeu ? t('realms.wartungAuth') : '' }), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  if (loading) return <div className="spinner">{t('realms.loading')}</div>

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('realms.title', { count: realms.length })}</h3>
          <button className="btn primary sm" onClick={() => setEdit({ ...EMPTY })}>{t('realms.create')}</button>
        </div>
        <div className="card-body tight">
          {!realms.length ? (
            <div className="empty">{t('realms.empty')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th><th>{t('realms.name')}</th><th>{t('realms.address')}</th><th>{t('realms.port')}</th>
                    <th>Icon</th><th>{t('realms.timezone')}</th><th>{t('realms.access')}</th><th>{t('realms.status')}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {realms.map(r => (
                    <tr key={r.id}>
                      <td className="mono muted">{r.id}</td>
                      <td><strong>{r.name}</strong></td>
                      <td className="mono">{r.address}</td>
                      <td className="mono">{r.port}</td>
                      <td className="num">{r.icon}</td>
                      <td className="num">{r.timezone}</td>
                      <td>{SECURITY.find(s => s[0] === String(r.allowedSecurityLevel))?.[1] || r.allowedSecurityLevel}</td>
                      <td>
                        {(Number(r.realmflags) & 2) === 2
                          ? <span className="pill offline">{t('realms.wartungAn')}</span>
                          : <span className="pill online">{t('realms.wartungAus')}</span>}
                      </td>
                      <td className="right">
                        <div className="inline" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm" onClick={() => wartung(r)}>
                            {(Number(r.realmflags) & 2) === 2 ? t('realms.wartungBeenden') : t('realms.wartungStarten')}
                          </button>
                          <button className="btn sm" onClick={() => setEdit({
                            id: r.id,
                            name: r.name,
                            address: r.address,
                            port: r.port,
                            icon: r.icon,
                            timezone: r.timezone,
                            security: r.allowedSecurityLevel,
                            population: r.population
                          })}>{t('realms.edit')}</button>
                          <button className="btn sm danger" onClick={() => remove(r)}>{t('realms.delete')}</button>
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

      <div className="info-box">
        {t('realms.clientNote1')}<span className="mono"> realmlist.wtf</span> {t('realms.clientNote2')}
      </div>

      {edit ? (
        <Modal
          title={edit.id ? t('realms.editTitle') : t('realms.createTitle')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>{t('realms.cancel')}</button>
              <button className="btn primary" onClick={save}>{t('realms.save')}</button>
            </>
          }
        >
          <div className="field">
            <label>{t('realms.name')}</label>
            <input type="text" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label>{t('realms.addressLabel')}</label>
              <input type="text" value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('realms.port')}</label>
              <input type="number" value={edit.port} onChange={e => setEdit({ ...edit, port: e.target.value })} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>{t('realms.iconId')}</label>
              <input type="number" value={edit.icon} onChange={e => setEdit({ ...edit, icon: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('realms.timezone')}</label>
              <input type="number" value={edit.timezone} onChange={e => setEdit({ ...edit, timezone: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('realms.population')}</label>
              <select value={edit.population} onChange={e => setEdit({ ...edit, population: e.target.value })}>
                <option value="0">{t('realms.popEmpty')}</option>
                <option value="1">{t('realms.popLow')}</option>
                <option value="2">{t('realms.popMid')}</option>
                <option value="3">{t('realms.popHigh')}</option>
                <option value="4">{t('realms.popFull')}</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>{t('realms.securityLevel')}</label>
            <select value={String(edit.security)} onChange={e => setEdit({ ...edit, security: e.target.value })}>
              {SECURITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

export default Realms