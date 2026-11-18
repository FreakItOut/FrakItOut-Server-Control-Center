import React, { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

/*
 * Connect Optionen - hier steht bewusst nur die IP-Adresse des Servers.
 * Alle anderen Pfade, Zugangsdaten und Optionen stehen unter "Einstellungen".
 */
function ConnectOptions () {
  const { toast, status } = useStatus()
  const { t } = useI18n()
  const [net, setNet] = useState(null)
  const [form, setForm] = useState({ address: '', port: 8085, bindIp: '0.0.0.0', realmId: '' })
  const [hint, setHint] = useState(null)
  // Solange der Nutzer eintippt, darf die automatische Abfrage den Text
  // nicht ueberschreiben - sonst springt das Feld unerwartet zurueck.
  const dirty = useRef(false)

  const load = async ({ keepForm = false } = {}) => {
    try {
      const res = await api.network.get()
      setNet(res)
      if (!keepForm && !dirty.current) {
        setForm({
          address: res.address || '',
          port: res.port || 8085,
          bindIp: res.bindIp || '0.0.0.0',
          realmId: ''
        })
      }
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  useEffect(() => {
    load()
    const iv = setInterval(() => load({ keepForm: true }), 15000)
    return () => clearInterval(iv)
  }, [])

  const change = patch => {
    dirty.current = true
    setForm(f => ({ ...f, ...patch }))
  }

  const saveRealmIp = async () => {
    try {
      const res = await api.network.setRealmAddress({
        ip: form.address,
        port: Number(form.port),
        realmId: form.realmId || null
      })
      // gespeichert -> Felder wieder aus der Datenbank uebernehmen
      dirty.current = false
      setHint({
        ok: true,
        text:
          t('connectOptions.realmIpSet', { count: res.updated, addr: `${form.address}:${form.port}` }) +
          (res.hint ? ' ' + res.hint.replace(/_/g, ' ') : '')
      })
      toast(t('connectOptions.serverIpSaved'), 'ok')
      await load()
    } catch (e) {
      setHint({ ok: false, text: e.message })
      toast(e.message, 'err')
    }
  }

  const saveConfIp = async () => {
    try {
      await api.network.setConfIp({ bindIp: form.bindIp })
      dirty.current = false
      toast(t('connectOptions.bindIpSaved'), 'ok')
      await load()
    } catch (e) {
      setHint({ ok: false, text: e.message })
      toast(e.message, 'err')
    }
  }

  const copyAddress = () => {
    navigator.clipboard
      ?.writeText(`${form.address}:${form.port}`)
      .then(() => toast(t('connectOptions.addressCopied'), 'ok'))
      .catch(() => toast(t('connectOptions.copyFailed'), 'err'))
  }

  /* ---------- WoW-Client: realmlist.wtf bequem setzen ---------- */
  const [clientDir, setClientDir] = useState('')
  const [clientInfo, setClientInfo] = useState(null)
  const [clientBusy, setClientBusy] = useState(false)

  const clientWaehlen = async () => {
    try {
      const p = await api.system.pickFolder({ title: t('connectOptions.clientFolderTitle') })
      if (!p) return
      setClientDir(p)
      const pr = await api.system.clientPruefen({ clientDir: p })
      setClientInfo(pr)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const realmlistSetzen = async () => {
    setClientBusy(true)
    try {
      // Ohne Port: der Client verbindet sich mit dem Authserver (Standard 3724).
      const r = await api.system.realmlistSetzen({ clientDir, adresse: form.address || '127.0.0.1' })
      if (r.ok) {
        setClientInfo({ ok: true, notizen: [t('connectOptions.clientSetOk', { zeile: r.zeile }), ...(r.gesichert ? [t('connectOptions.clientBackupNote')] : [])] })
        toast(t('connectOptions.clientSetDone'), 'ok')
      } else {
        setClientInfo({ ok: false, notizen: [r.error] })
        toast(r.error, 'err')
      }
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setClientBusy(false)
    }
  }

  /* ---------- Freunde einlassen: LAN-Zugriff ---------- */
  const [freundeInfo, setFreundeInfo] = useState(null)
  const [freundeBusy, setFreundeBusy] = useState(false)
  const [lan, setLan] = useState(null)

  useEffect(() => {
    api.system.lanAdresse().then(r => setLan(r)).catch(() => {})
  }, [])

  const freundeOeffnen = async () => {
    setFreundeBusy(true)
    try {
      const ziel = (lan && lan.adressen && lan.adressen[0] && lan.adressen[0].adresse) || ''
      const r = await api.system.freundeOeffnen({ adresse: ziel })
      if (r.ok) {
        setFreundeInfo({ ok: true, schritte: r.schritte, adresse: r.adresse })
        toast(t('connectOptions.freundeFertig', { adresse: r.adresse }), 'ok')
        await load()
      } else {
        setFreundeInfo({ ok: false, schritte: [{ ok: false, text: r.error }] })
        toast(r.error, 'err')
      }
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setFreundeBusy(false)
    }
  }

  const freundeSchliessen = async () => {
    setFreundeBusy(true)
    try {
      const r = await api.system.freundeSchliessen()
      if (r.ok) {
        setFreundeInfo({ ok: true, schritte: r.schritte, adresse: '127.0.0.1' })
        toast(t('connectOptions.freundeZu'), 'ok')
        await load()
      } else {
        toast(r.error, 'err')
      }
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setFreundeBusy(false)
    }
  }

  if (!net) return <div className="spinner">{t('connectOptions.loading')}</div>
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('connectOptions.title')}</h3>
          <button className="btn sm" onClick={load}>{t('connectOptions.reload')}</button>
        </div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>{t('connectOptions.clientAddress')}</label>
              <input
                type="text"
                className="mono"
                value={form.address}
                placeholder={t('connectOptions.clientAddressPlaceholder')}
                onChange={e => change({ address: e.target.value })}
              />
              <div className="hint">
                {t('connectOptions.clientAddressHint1')}{' '}
                <span className="mono">address</span> {t('connectOptions.clientAddressHint2')}{' '}
                <span className="mono">ac_auth.realmlist</span>.
              </div>
            </div>
            <div className="field" style={{ maxWidth: 130 }}>
              <label>{t('connectOptions.port')}</label>
              <input
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={e => change({ port: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{t('connectOptions.appliesTo')}</label>
              <select value={form.realmId} onChange={e => change({ realmId: e.target.value })}>
                <option value="">{t('connectOptions.allRealms')}</option>
                {(Array.isArray(net.realms) ? net.realms : []).map(r => (
                  <option key={r.id} value={r.id}>
                    {t('connectOptions.realmOnly', { name: r.name, id: r.id })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>{t('connectOptions.bindIpLabel')}</label>
              <input
                type="text"
                className="mono"
                value={form.bindIp}
                onChange={e => change({ bindIp: e.target.value })}
              />
              <div className="hint">
                <span className="mono">0.0.0.0</span>{' '}
                {t('connectOptions.bindIpHint')}
              </div>
            </div>
          </div>

          <div className="inline">
            <button className="btn primary" disabled={!form.address} onClick={saveRealmIp}>
              {t('connectOptions.saveRealmAddress')}
            </button>
            <button className="btn" disabled={!form.bindIp} onClick={saveConfIp}>
              {t('connectOptions.saveBindIp')}
            </button>
            <button
              className="btn sm"
              title={t('connectOptions.copyAddressTitle')}
              onClick={copyAddress}
            >
              {t('connectOptions.copyAddress')}
            </button>
          </div>

          {hint ? (
            <div className={`${hint.ok ? 'ok-box' : 'error-box'} mt`}>{hint.text}</div>
          ) : null}

          {net.dbError ? (
            <div className="error-box mt">
              {t('connectOptions.dbErrorPrefix')} {net.dbError}.{' '}
              {t('connectOptions.dbErrorHint1')}{' '}
              <strong>{t('connectOptions.dbErrorLink')}</strong>.
            </div>
          ) : null}

          <div className="info-box mt">
            <strong>{t('connectOptions.clientInfoTitle')}</strong> {t('connectOptions.clientInfo1')}{' '}
            <span className="mono">realmlist.wtf</span>
            {t('connectOptions.clientInfo2')}{' '}
            <span className="mono">hosts</span>
            {t('connectOptions.clientInfo3')}
            <div className="mono" style={{ marginTop: 6, color: '#c8a44d' }}>
              {form.address || '127.0.0.1'}&nbsp;&nbsp;localhost
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t('connectOptions.clientCard')}</h3></div>
        <div className="card-body">
          <div className="inline mb0">
            <button className="btn" onClick={clientWaehlen}>{t('connectOptions.clientChoose')}</button>
            {clientDir
              ? <span className="mono" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis' }}>{clientDir}</span>
              : <span className="muted">{t('connectOptions.clientNone')}</span>}
          </div>
          <div className="inline mt">
            <button className="btn primary" disabled={!clientDir || clientBusy} onClick={realmlistSetzen}>
              {t('connectOptions.clientSet')}
            </button>
            <span className="hint">{t('connectOptions.clientHint')}</span>
          </div>
          {clientInfo && clientInfo.notizen && clientInfo.notizen.length ? (
            <div className={`mt ${clientInfo.ok === false ? 'error-box' : 'info-box'}`}>
              {clientInfo.notizen.map((n, i) => <div key={i}>{n}</div>)}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        * Freunde einlassen: mit einem Klick LAN-IP in die Realm-Adresse,
        * Firewall auf und zurück. Der Client des Freundes braucht die
        * LAN-IP in seiner realmlist.wtf.
        */}
      <div className="card">
        <div className="card-head"><h3>{t('connectOptions.freundeTitle')}</h3></div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>{t('connectOptions.freundeIntro')}</p>
          <div className="inline mb0">
            <span className="mono">
              {lan && lan.adressen && lan.adressen.length
                ? lan.adressen.map(a => a.adresse).join(', ')
                : t('connectOptions.freundeKeinNetz')}
            </span>
          </div>
          <div className="inline mt">
            <button className="btn primary" onClick={freundeOeffnen} disabled={freundeBusy || !lan || !lan.ok}>
              {t('connectOptions.freundeOeffnen')}
            </button>
            <button className="btn" onClick={freundeSchliessen} disabled={freundeBusy}>
              {t('connectOptions.freundeZurueck')}
            </button>
          </div>
          <div className="hint">{t('connectOptions.freundeHint')}</div>
          {freundeInfo && freundeInfo.schritte ? (
            <div className={`${freundeInfo.ok ? 'info-box' : 'error-box'} mt`}>
              {freundeInfo.schritte.map((s, i) => (
                <div key={i}>{s.ok ? '✓' : '✕'} {s.text}</div>
              ))}
              {freundeInfo.ok && freundeInfo.adresse ? (
                <div className="mt">{t('connectOptions.freundeClientHinweis', { adresse: freundeInfo.adresse })}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t('connectOptions.status')}</h3></div>
        <div className="card-body">
          <table>
            <tbody>
              <tr>
                <td className="muted">Worldserver</td>
                <td className={status.world?.running ? '' : 'muted'}>
                  {status.world?.running
                    ? t('connectOptions.running', { pid: status.world.pid })
                    : t('connectOptions.stopped')}
                </td>
              </tr>
              <tr>
                <td className="muted">Authserver</td>
                <td className={status.auth?.running ? '' : 'muted'}>
                  {status.auth?.running
                    ? t('connectOptions.running', { pid: status.auth.pid })
                    : t('connectOptions.stopped')}
                </td>
              </tr>
              <tr>
                <td className="muted">{t('connectOptions.realmsRegistered')}</td>
                <td>{Array.isArray(net.realms) ? net.realms.length : '—'}</td>
              </tr>
              <tr>
                <td className="muted">{t('connectOptions.currentRealmAddress')}</td>
                <td className="mono">{net.address}:{net.port}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

export default ConnectOptions

