import React, { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

/*
 * Moduleinstellungen.
 *
 * AzerothCore laedt die Modul-Konfiguration aus <configs>/modules. Auf
 * einer vollstaendigen Repack sind das ueber 70 Dateien mit ueber 5000
 * Schaltern - Playerbots allein hat rund 900, das Wettermodul ueber 2000.
 *
 * Bis hierher war davon nichts zu sehen: der Konfigurations-Editor
 * kannte nur worldserver.conf und authserver.conf. Die Schalter waren
 * vorhanden, aber nur ueber einen externen Texteditor erreichbar - und
 * ohne jede Beschreibung.
 *
 * Der Aufbau: links die Module, rechts die Einstellungen des gewaehlten.
 * Bei mod_weather_vibe.conf mit 2047 Schaltern ist die Suche kein
 * Komfort, sondern Voraussetzung - ohne sie waere die Seite unbrauchbar.
 */

function wertAendern (liste, key, wert) {
  return liste.map(e => (e.key === key ? { ...e, value: wert } : e))
}

function Modules () {
  const { toast } = useStatus()
  const { t, lang } = useI18n()

  const [daten, setDaten] = useState(null)
  const [gewaehlt, setGewaehlt] = useState(null)
  const [eintraege, setEintraege] = useState(null)
  const [original, setOriginal] = useState(null)
  const [suche, setSuche] = useState('')
  const [nurBeschrieben, setNurBeschrieben] = useState(false)
  const [nurGeaendert, setNurGeaendert] = useState(false)
  const [modulFilter, setModulFilter] = useState('alle')
  /*
   * Die versionierten Sicherungen des gewaehlten Moduls.
   *
   * Die Marke "hat Sicherung" in der Liste kommt aus einer einzelnen
   * .bak-Datei. Seit es versionierte Staende gibt, liegen die in einem
   * Ordner daneben - die Liste wusste nichts davon und beantwortete
   * damit nur die halbe Frage.
   */
  const [sicherungen, setSicherungen] = useState(null)

  /*
   * Wie viele Module haben den jeweiligen Status? fuer die Auswahl im
   * Filter.
   */
  const zaehlerStatus = status => (daten.module || []).filter(m => m.status === status).length
  const [laedt, setLaedt] = useState(false)
  const [busy, setBusy] = useState(false)
  // Nach dem Speichern wirken Modul-Einstellungen erst nach einem Neustart
  const [neustartNoetig, setNeustartNoetig] = useState(false)

  /*
   * Modul-Installation/Verwaltung: die Conf-Liste (daten.module) kennt nur
   * konfigurierte Module. Hier geht es um die QUELLEN unter source/modules.
   */
  const [installUrl, setInstallUrl] = useState('')
  const [installBusy, setInstallBusy] = useState(false)
  const [installSql, setInstallSql] = useState(false)
  const [vorpruefung, setVorpruefung] = useState(null)
  const [mehrfachErgebnis, setMehrfachErgebnis] = useState(null)
  const [buildBusy, setBuildBusy] = useState(false)
  const [buildMeldung, setBuildMeldung] = useState('')
  const [pruefBusy, setPruefBusy] = useState(false)
  const [pruefungen, setPruefungen] = useState({})
  const [autoCheck, setAutoCheck] = useState(() => {
    try { return localStorage.getItem('modules.autoCheck') !== '0' } catch (_) { return true }
  })
  const [installSchritt, setInstallSchritt] = useState('')
  const [installErgebnis, setInstallErgebnis] = useState(null)
  const [siteImported, setSiteImported] = useState(null)
  // Modul-SQL: welches Modul läuft gerade, und was kam heraus?
  const [sqlBusy, setSqlBusy] = useState('')
  const [sqlSchritt, setSqlSchritt] = useState('')
  const [sqlErgebnis, setSqlErgebnis] = useState(null)
  const ladeInstalliert = async () => {
    try {
      setSiteImported(await api.modules.installierte())
    } catch (_) {
      setSiteImported(null)
    }
  }
  useEffect(() => { ladeInstalliert() }, [])

  const modulePruefen = async (still = false) => {
    setPruefBusy(true)
    try {
      const r = await api.modules.pruefen({})
      const map = {}
      for (const m of r.module || []) map[m.name] = m
      setPruefungen(map)
      try { localStorage.setItem('modules.checkAt', String(Date.now())) } catch (_) {}
      if (!still) {
        const offen = (r.module || []).filter(m => m.hinter > 0).length
        const fehler = (r.module || []).filter(m => !m.ok).length
        toast(t('modules.checkDone', { n: (r.module || []).length, offen, fehler }), 'ok')
      }
    } catch (e) {
      if (!still) toast(e.message, 'err')
    } finally {
      setPruefBusy(false)
    }
  }

  // Hoechstens einmal pro Tag automatisch pruefen, ohne zu ziehen.
  useEffect(() => {
    if (!autoCheck) return undefined
    let letzte = 0
    try { letzte = Number(localStorage.getItem('modules.checkAt') || 0) } catch (_) {}
    if (Date.now() - letzte < 24 * 60 * 60 * 1000) return undefined
    const timer = setTimeout(() => { modulePruefen(true) }, 1200)
    return () => clearTimeout(timer)
  }, [autoCheck])

  /*
   * Fortschritt der Modul-Installation (Klonen -> Submodule -> Konfiguration
   * -> SQL). Ohne diese Anzeige stand bei großen Modulen minutenlang nur
   * "installiere …" da.
   */
  useEffect(() => {
    const ab = api.on('modules:progress', p => {
      if (!p) return
      setInstallSchritt(p.phase === 'fertig' ? '' : (p.text || ''))
      if (p.phase === 'sql' && p.gesamt) setSqlSchritt(p.text || '')
    })
    return () => { try { ab && ab() } catch (_) {} }
  }, [])

  // SQL-Begleiter eines Moduls einspielen (mit Sicherung davor)
  const sqlEinspielen = async name => {
    if (!window.confirm(t('modules.sqlFrage', { name }))) return
    setSqlBusy(name)
    setSqlErgebnis(null)
    setSqlSchritt('')
    try {
      const r = await api.modules.sqlEinspielen({ name })
      setSqlErgebnis(r)
      ladeInstalliert()
      const teile = [t('modules.sqlOk', { n: r.gespielt })]
      if (r.abgelehnt && r.abgelehnt.length) teile.push(t('modules.sqlAbgelehnt', { n: r.abgelehnt.length }))
      if (r.uebersprungen && r.uebersprungen.length) teile.push(t('modules.sqlUebersprungen', { n: r.uebersprungen.length }))
      if (r.fehler && r.fehler.length) teile.push(t('modules.sqlFehler', { n: r.fehler.length }))
      toast(teile.join(' '), r.ok ? 'ok' : 'warn')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setSqlBusy('')
      setSqlSchritt('')
    }
  }

  /*
   * "Konfiguration öffnen": die Conf liegt in der Liste unter einem anderen
   * Namen als der Quellordner (individual-progression -> individualProgression).
   * Der Installer liefert die passende Datei, hier wird sie nur ausgewählt.
   */
  const konfOeffnen = datei => {
    const treffer = ((daten && daten.module) || []).find(m => m.datei === datei)
    if (treffer) {
      setGewaehlt(treffer.pfad)
      setSuche('')
      setModulFilter('alle')
    } else {
      toast(t('modules.konfNichtGefunden', { datei }), 'warn')
    }
  }
  useEffect(() => {
    const ab = api.on('installer:progress', p => {
      if (p) setBuildMeldung(p.meldung || p.text || '')
    })
    return () => { try { ab && ab() } catch (_) {} }
  }, [])

  const konfNachziehen = async name => {
    try {
      const r = await api.modules.konfigurationNachziehen({ name })
      toast(
        r.kopiert.length
          ? t('modules.confCreated', { n: r.kopiert.length })
          : t('modules.confExists', { n: r.vorhanden.length }),
        r.kopiert.length ? 'ok' : 'warn'
      )
      await ladeInstalliert()
      await ladeListe(r.kopiert[0])
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const baueJetzt = async () => {
    if (!window.confirm(t('modules.buildFrage'))) return
    setBuildBusy(true)
    setBuildMeldung('')
    try {
      const root = await api.settings.get().then(c => c.server && c.server.rootDir).catch(() => '')
      await api.installer.update({ root })
      toast(t('modules.buildFertig'), 'ok')
      await ladeInstalliert()
      await ladeListe()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBuildBusy(false)
      setBuildMeldung('')
    }
  }

  /*
   * Ein Modul installieren: erst prüfen (Name frei, Git, Repo erreichbar,
   * Platz), dann bestätigen, dann klonen. Danach wird die neue Conf direkt
   * ausgewählt.
   */
  const installiereEinzel = async (url, erwarteterName) => {
    const vp = await api.modules.vorpruefen({ url })
    setVorpruefung(vp)
    if (!vp.ok) {
      toast(vp.fehler || t('modules.preflightFail'), 'err')
      return null
    }
    if (!window.confirm(t('modules.installFrageDetails', {
      name: vp.name,
      ziel: vp.ziel,
      frei: vp.freiGb == null ? '—' : vp.freiGb
    }))) return null
    const r = await api.modules.installieren({ url, name: erwarteterName || undefined, sqlImport: installSql })
    setInstallErgebnis(r)
    setVorpruefung(null)
    setInstallUrl('')
    await ladeInstalliert()
    await ladeListe(r.confs && r.confs[0])
    return r
  }

  const installieren = async () => {
    const zeilen = installUrl.split(/\r?\n/).map(z => z.trim()).filter(Boolean)
    if (!zeilen.length) return
    setInstallBusy(true)
    setInstallErgebnis(null)
    setMehrfachErgebnis(null)
    setVorpruefung(null)
    try {
      if (zeilen.length > 1) {
        if (!window.confirm(t('modules.installMultiFrage', { n: zeilen.length }))) return
        const r = await api.modules.mehrfachInstallieren({ urls: zeilen, sqlImport: installSql })
        setMehrfachErgebnis(r)
        await ladeInstalliert()
        await ladeListe()
        toast(
          t('modules.installMultiDone', { ok: r.installiert, fehler: r.fehler }),
          r.fehler ? 'warn' : 'ok'
        )
      } else {
        await installiereEinzel(zeilen[0])
      }
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setInstallBusy(false)
    }
  }

  const katalogInstallieren = async v => {
    setInstallBusy(true)
    setInstallErgebnis(null)
    setMehrfachErgebnis(null)
    try {
      setInstallUrl(v.url)
      await installiereEinzel(v.url, v.name)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setInstallBusy(false)
    }
  }

  const ladeListe = async bevorzugt => {
    try {
      const res = await api.modules.list()
      setDaten(res)
      if (bevorzugt) {
        const treffer = res.module.find(m => m.datei === bevorzugt)
        if (treffer) {
          setGewaehlt(treffer.pfad)
          return res
        }
      }
      if (res.module.length && !res.module.some(m => m.pfad === gewaehlt)) {
        // Das groesste zuerst ist selten das, was man sucht; das erste
        // Modul im Alphabet ist der uebliche Einstieg.
        setGewaehlt(res.module[0].pfad)
      }
      return res
    } catch (e) {
      toast(e.message, 'err')
      return null
    }
  }

  useEffect(() => { ladeListe() }, [])

  // Eine aeltere Stufe zurueckspielen. Der aktuelle Stand wird vorher
  // gesichert - sonst waere der Zustand, den man gerade wiederherstellt,
  // verloren.
  const stufeZurueckspielen = async eintrag => {
    if (!window.confirm(t('modules.restoreConfirm', { name: eintrag.name }))) return
    try {
      await api.modules.sicherungZurueckspielen({ pfad: gewaehlt, datei: eintrag.pfad })
      toast(t('modules.restored'), 'ok')
      await ladeModul(gewaehlt)
      await ladeListe()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const ladeModul = async pfad => {
    setLaedt(true)
    setSuche('')
    try {
      const res = await api.modules.read({ pfad })
      setEintraege(res.eintraege)
      setOriginal(res.eintraege)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setLaedt(false)
    }
    // Die Sicherungen unabhaengig laden - ein Fehler dabei darf das
    // Modul nicht unlesbar machen.
    try {
      setSicherungen(await api.modules.sicherungen({ pfad }))
    } catch (_) {
      setSicherungen(null)
    }
  }

  useEffect(() => {
    if (gewaehlt) ladeModul(gewaehlt)
  }, [gewaehlt])

  const geaendert = useMemo(() => {
    if (!eintraege || !original) return []
    return eintraege.filter(e => {
      const o = original.find(x => x.key === e.key)
      return o && o.value !== e.value
    })
  }, [eintraege, original])

  const sichtbar = useMemo(() => {
    if (!eintraege) return []
    const t = suche.trim().toLowerCase()
    const geaenderteKeys = new Set(geaendert.map(e => e.key))
    return eintraege.filter(e => {
      if (nurGeaendert && !geaenderteKeys.has(e.key)) return false
      if (nurBeschrieben && !e.help) return false
      if (!t) return true
      return (
        e.key.toLowerCase().includes(t) ||
        String(e.value).toLowerCase().includes(t) ||
        String(e.help || '').toLowerCase().includes(t) ||
        String(e.gruppe || '').toLowerCase().includes(t)
      )
    })
  }, [eintraege, suche, nurBeschrieben, nurGeaendert, geaendert])

  const speichern = async () => {
    if (!gewaehlt || !geaendert.length) return
    setBusy(true)
    try {
      const res = await api.modules.save({
        pfad: gewaehlt,
        eintraege: geaendert.map(e => ({ key: e.key, value: e.value }))
      })
      toast(t('modules.saved', { count: res.geaendert }), 'ok')
      setNeustartNoetig(true)
      await ladeModul(gewaehlt)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const zuruecksetzen = async () => {
    if (!gewaehlt) return
    if (!window.confirm(t('modules.resetConfirm'))) return
    setBusy(true)
    try {
      await api.modules.reset({ pfad: gewaehlt })
      toast(t('modules.resetDone'), 'ok')
      await ladeModul(gewaehlt)
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (!daten) return <div className="spinner">{t('modules.loading')}</div>

  const mitSicherung = Boolean(eintraege && gewaehlt && daten.module.find(m => m.pfad === gewaehlt)?.hatSicherung)

  return (
    <>
      {/*
        * Module installieren/verwalten: klont das Repo nach source/modules,
        * legt die Konfiguration an und setzt buildNoetig - der Bau läuft
        * beim nächsten Update (erzwungen, auch ohne Core-Änderung).
        */}
      <details className="card details-card">
        <summary className="card-head">
          <h3>{t('modules.installTitle')}</h3>
        </summary>
        <div className="card-body">
          <div className="inline" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              className="btn sm"
              disabled={pruefBusy || installBusy || !(siteImported && siteImported.module && siteImported.module.length)}
              onClick={() => modulePruefen(false)}
            >
              {pruefBusy ? t('modules.checkLaeuft') : t('modules.checkBtn')}
            </button>
            <button
              className="btn sm"
              disabled={installBusy || !(siteImported && siteImported.module && siteImported.module.length)}
              onClick={async () => {
                if (!window.confirm(t('modules.updateAllFrage'))) return
                setInstallBusy(true)
                try {
                  const r = await api.modules.aktualisieren({})
                  const geaendert = (r.module || []).filter(m => m.geaendert).length
                  toast(t('modules.updateAllOk', { n: (r.module || []).length, geaendert }), 'ok')
                  ladeInstalliert()
                } catch (e) {
                  toast(e.message, 'err')
                } finally {
                  setInstallBusy(false)
                }
              }}
            >
              {t('modules.updateAll')}
            </button>
          </div>
          <label className="check-row" style={{ marginBottom: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={autoCheck}
              onChange={e => {
                setAutoCheck(e.target.checked)
                try { localStorage.setItem('modules.autoCheck', e.target.checked ? '1' : '0') } catch (_) {}
              }}
            />
            {t('modules.autoCheck')}
          </label>
          <p style={{ marginTop: 0 }}>{t('modules.installIntro')}</p>
          <div className="field">
            <label>{t('modules.installUrl')}</label>
            <textarea
              rows={2}
              value={installUrl}
              onChange={e => setInstallUrl(e.target.value)}
              placeholder={'azerothcore/mod-transmog\nhttps://github.com/azerothcore/mod-autobalance.git'}
              className="mono"
              style={{ width: '100%' }}
            />
          </div>
          <div className="inline" style={{ marginTop: 8 }}>
            <label className="check-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={installSql} onChange={e => setInstallSql(e.target.checked)} />
              {t('modules.sqlAfterInstall')}
            </label>
            <button
              className="btn primary"
              disabled={installBusy || !installUrl.trim()}
              onClick={installieren}
            >
              {installBusy
                ? t('modules.installLaeuft')
                : (installUrl.split(/\r?\n/).filter(z => z.trim()).length > 1
                    ? t('modules.installMultiBtn')
                    : t('modules.installBtn'))}
            </button>
          </div>
          <div className="hint">{t('modules.installHint')}</div>
          {vorpruefung ? (
            <div className={vorpruefung.ok ? 'info-box mt' : 'error-box mt'} style={{ fontSize: 12 }}>
              {vorpruefung.ok
                ? t('modules.preflightOk', {
                  name: vorpruefung.name,
                  ziel: vorpruefung.ziel,
                  frei: vorpruefung.freiGb == null ? '—' : vorpruefung.freiGb
                })
                : vorpruefung.fehler}
            </div>
          ) : null}
          {installSchritt ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{installSchritt}</div>
          ) : null}
          {sqlSchritt ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sqlSchritt}</div>
          ) : null}

          {siteImported && siteImported.vorschlaege ? (
            <div className="mt" style={{ fontSize: 12 }}>
              <span className="muted">{t('modules.vorschlaege')}</span>{' '}
              {siteImported.vorschlaege.map(v => (
                <button
                  key={v.name}
                  className="btn sm"
                  style={{ margin: '2px 4px 2px 0' }}
                  title={v.url}
                  disabled={installBusy}
                  onClick={() => katalogInstallieren(v)}
                >
                  {v.hinweis}
                </button>
              ))}
            </div>
          ) : null}

          {installErgebnis ? (
            <div className="ok-box mt" style={{ fontSize: 12 }}>
              <div>{t('modules.installOk', { name: installErgebnis.name })}</div>
              {installErgebnis.confs && installErgebnis.confs.length ? (
                <div>{t('modules.installConfs', { liste: installErgebnis.confs.join(', ') })}</div>
              ) : (
                <div className="muted">{t('modules.installNoConf')}</div>
              )}
              {installErgebnis.sqlAnzahl ? (
                <div>{t('modules.installSql', { n: installErgebnis.sqlAnzahl })}</div>
              ) : null}
              <div style={{ marginTop: 8 }}><strong>{t('modules.nextSteps')}</strong></div>
              <div className="inline" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                {(installErgebnis.confs || []).map(c => (
                  <button key={c} className="btn sm" onClick={() => konfOeffnen(c)}>
                    {t('modules.openConf')}
                  </button>
                ))}
                {!(installErgebnis.confs || []).length ? (
                  <button className="btn sm" onClick={() => konfNachziehen(installErgebnis.name)}>
                    {t('modules.confPull')}
                  </button>
                ) : null}
                {installErgebnis.sqlAnzahl && !installErgebnis.sqlErgebnis ? (
                  <button
                    className="btn sm"
                    disabled={!!sqlBusy || installBusy}
                    onClick={() => sqlEinspielen(installErgebnis.name)}
                  >
                    {t('modules.sqlBtn')}
                  </button>
                ) : null}
                <button className="btn sm" disabled={buildBusy} onClick={baueJetzt}>
                  {buildBusy ? t('modules.buildLaeuft') : t('modules.buildNow')}
                </button>
              </div>
              {installErgebnis.sqlErgebnis ? (
                <div className={installErgebnis.sqlErgebnis.ok ? 'info-box mt' : 'error-box mt'}>
                  {installErgebnis.sqlErgebnis.ok
                    ? t('modules.sqlOk', { n: installErgebnis.sqlErgebnis.gespielt || 0 })
                    : (installErgebnis.sqlErgebnis.error || t('modules.sqlFailed'))}
                </div>
              ) : null}
              {buildMeldung ? <div className="muted mono" style={{ marginTop: 4 }}>{buildMeldung}</div> : null}
              <div className="hint">{t('modules.installBuildHint')}</div>
            </div>
          ) : null}

          {mehrfachErgebnis ? (
            <div className="mt" style={{ fontSize: 12 }}>
              <strong>{t('modules.multiHead', { ok: mehrfachErgebnis.installiert, fehler: mehrfachErgebnis.fehler })}</strong>
              {(mehrfachErgebnis.ergebnisse || []).map(e => (
                <div
                  key={e.url}
                  className="inline"
                  style={{ justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}
                >
                  <span className="mono">{e.name || e.url}</span>
                  <span className={e.ok ? 'muted' : ''} style={e.ok ? undefined : { color: 'var(--c-red)' }}>
                    {e.ok
                      ? t('modules.multiLine', { conf: (e.confs || []).length, sql: e.sqlAnzahl || 0 })
                      : e.error}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {siteImported && siteImported.module && siteImported.module.length ? (
            <div className="mt">
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('modules.installiertTitel')}</div>
              {siteImported.module.map(m => (
                <div key={m.name} className="inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {m.name}
                    {m.version ? ` · ${m.version}` : ''}
                    {m.versionZeit ? ` · ${new Date(m.versionZeit).toLocaleDateString()}` : ''}
                    {m.sqlAnzahl ? ` · ${t('modules.sqlCount', { n: m.sqlAnzahl })}` : ''}
                    {m.konf && m.konf.length ? null : (
                      <>
                        <span className="muted">{` · ${t('modules.noConf')}`}</span>
                        <button
                          className="btn sm"
                          style={{ marginLeft: 6 }}
                          disabled={installBusy}
                          onClick={() => konfNachziehen(m.name)}
                        >
                          {t('modules.confPull')}
                        </button>
                      </>
                    )}
                    {pruefungen[m.name] ? (
                      pruefungen[m.name].ok ? (
                        pruefungen[m.name].hinter > 0
                          ? <span className="pill info" style={{ marginLeft: 6 }}>{t('modules.checkBehind', { n: pruefungen[m.name].hinter })}</span>
                          : <span className="pill online" style={{ marginLeft: 6 }}>{t('modules.checkCurrent')}</span>
                      ) : (
                        <span className="pill ban" style={{ marginLeft: 6 }} title={pruefungen[m.name].fehler}>{t('modules.checkError')}</span>
                      )
                    ) : null}
                  </span>
                  <span className="inline">
                    {m.konf && m.konf.length ? (
                      <button className="btn sm" onClick={() => konfOeffnen(m.konf[0])}>
                        {t('modules.openConf')}
                      </button>
                    ) : null}
                    {m.sqlAnzahl ? (
                      <button
                        className="btn sm"
                        disabled={!!sqlBusy || installBusy}
                        title={t('modules.sqlHint')}
                        onClick={() => sqlEinspielen(m.name)}
                      >
                        {sqlBusy === m.name ? t('modules.sqlLaeuft') : t('modules.sqlBtn')}
                      </button>
                    ) : null}
                    <button
                      className="btn sm"
                      disabled={installBusy}
                      onClick={async () => {
                        setInstallBusy(true)
                        try {
                          const r = await api.modules.aktualisieren({ name: m.name })
                          const eintrag = (r.module || [])[0] || {}
                          toast(t('modules.updateOk', { name: m.name, geaendert: eintrag.geaendert ? t('modules.updateJa') : t('modules.updateNein') }), eintrag.ok ? 'ok' : 'warn')
                          ladeInstalliert()
                        } catch (e) {
                          toast(e.message, 'err')
                        } finally {
                          setInstallBusy(false)
                        }
                      }}
                    >
                      {t('modules.updateBtn')}
                    </button>
                    <button
                      className="btn sm danger"
                      disabled={installBusy}
                      onClick={async () => {
                        if (!window.confirm(t('modules.removeFrage', { name: m.name }))) return
                        setInstallBusy(true)
                        try {
                          await api.modules.entfernen({ name: m.name })
                          toast(t('modules.removeOk', { name: m.name }), 'ok')
                          ladeInstalliert()
                          ladeListe()
                        } catch (e) {
                          toast(e.message, 'err')
                        } finally {
                          setInstallBusy(false)
                        }
                      }}
                    >
                      {t('modules.removeBtn')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {sqlErgebnis ? (
            <div className="ok-box mt" style={{ fontSize: 12 }}>
              <div>
                {t('modules.sqlResultHead', {
                  name: sqlErgebnis.name,
                  gespielt: sqlErgebnis.gespielt,
                  gesamt: sqlErgebnis.gesamt
                })}
              </div>
              {sqlErgebnis.sicherung ? (
                <div className="muted">{t('modules.sqlBackup', { stamp: sqlErgebnis.sicherung })}</div>
              ) : null}
              {sqlErgebnis.hinweis === 'bereitsVorhanden' ? (
                <div>{t('modules.sqlBereitsVorhanden')}</div>
              ) : null}
              {sqlErgebnis.fehler && sqlErgebnis.fehler.length ? (
                <div>
                  {sqlErgebnis.fehler.map((f, i) => (
                    <div key={i}>
                      <span className="mono">{f.datei}</span>: {f.fehler}
                    </div>
                  ))}
                  {sqlErgebnis.offen && sqlErgebnis.offen.length
                    ? <div className="muted">{t('modules.sqlOffen', { n: sqlErgebnis.offen.length })}</div>
                    : null}
                </div>
              ) : null}
              {sqlErgebnis.abgelehnt && sqlErgebnis.abgelehnt.length ? (
                <div>
                  {t('modules.sqlAbgelehntTitel')}
                  {sqlErgebnis.abgelehnt.map((f, i) => (
                    <div key={i}><span className="mono">{f.datei}</span>: {f.grund}</div>
                  ))}
                </div>
              ) : null}
              {sqlErgebnis.uebersprungen && sqlErgebnis.uebersprungen.length ? (
                <div className="muted">
                  {t('modules.sqlUebersprungenTitel', { n: sqlErgebnis.uebersprungen.length })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>

      <div className="card">
        <div className="card-head">
          <h3>{t('modules.head', { count: daten.module.length })}</h3>
          <div className="inline">
            <button className="btn sm" onClick={ladeListe}>{t('modules.reload')}</button>
          </div>
        </div>
        <div className="card-body">
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {t('modules.source')} <span className="mono">{daten.ordner}</span>
          </div>

          <div className="modules-layout">
            {/* ---------------- Modulliste ---------------- */}
            <div className="modules-liste">
              <input
                type="text"
                className="mb"
                placeholder={t('modules.searchModules')}
                value={suche}
                onChange={e => {
                  const w = e.target.value
                  setSuche(w)
                  // Die Modul-Suche und die Einstellungssuche teilen sich
                  // das Feld - aber nicht die Bedeutung. Sobald ein Modul
                  // gewaehlt ist, gehoert die Suche den Schluesseln.
                  if (!gewaehlt || w) setGewaehlt(null)
                }}
              />
              {/*
               * Filter nach Ein/Aus. Ohne ihn muss man alle 76 Module
               * durchgehen, um die 17 deaktivierten zu finden.
               */}
              <select
                value={modulFilter}
                onChange={e => setModulFilter(e.target.value)}
                style={{ marginTop: 6, width: '100%' }}
              >
                <option value="alle">{t('modules.filterAll', { count: daten.module.length })}</option>
                <option value="aktiv">{t('modules.filterAktiv', { count: zaehlerStatus('aktiv') })}</option>
                <option value="aus">{t('modules.filterAus', { count: zaehlerStatus('aus') })}</option>
              </select>
              <div className="modules-liste-inner">
                {daten.module
                  .filter(m => !suche || m.datei.toLowerCase().includes(suche.toLowerCase()))
                  .filter(m => {
                    if (modulFilter === 'alle') return true
                    if (modulFilter === 'aktiv') return m.status === 'aktiv'
                    if (modulFilter === 'aus') return m.status === 'aus'
                    return true
                  })
                  .map(m => (
                    <button
                      key={m.pfad}
                      className={`modules-eintrag${m.pfad === gewaehlt ? ' aktiv' : ''}`}
                      onClick={() => { setGewaehlt(m.pfad); setSuche('') }}
                      title={m.pfad}
                    >
                      {/*
                       * Ist das Modul eingeschaltet?
                       *
                       * Ohne diese Angabe muss man jedes Modul
                       * oeffnen und nach dem Enable-Schalter suchen. Bei
                       * 76 Modulen mit 291 Enable-Schaltern - davon 127
                       * eingeschaltet - ist das die haeufigste Frage
                       * ueberhaupt.
                       */}
                      {m.status === 'aktiv' ? (
                        <span className="modules-status aktiv" title={t('modules.statusOn', { count: m.enableAn, total: m.enableGesamt })}>
                          ● {m.enableAn}/{m.enableGesamt}
                        </span>
                      ) : m.status === 'aus' ? (
                        <span className="modules-status aus" title={t('modules.statusOff')}>○</span>
                      ) : null}
                      <span className="modules-eintrag-name">{m.id}</span>
                      {m.hatSicherung ? <span className="modules-marke" title={t('modules.hasBackup')}>◷</span> : null}
                    </button>
                  ))}
                {!daten.module.length ? <div className="empty">{t('modules.none')}</div> : null}
              </div>
            </div>

            {/* ---------------- Einstellungen ---------------- */}
            <div className="module-detail">
              {!gewaehlt ? (
                <div className="empty">{t('modules.pickOne')}</div>
              ) : laedt || !eintraege ? (
                /*
                 * Beide Bedingungen muessen da sein: nach dem Anklicken
                 * ist "gewaehlt" gesetzt, "laedt" aber erst im naechsten
                 * Durchlauf. Ohne das "!eintraege" laeuft der Block einmal
                 * mit noch leerer Liste und bricht mit
                 * "Cannot read properties of null" ab.
                 */
                <div className="spinner">{t('modules.loadingModule')}</div>
              ) : (
                <>
                  {(() => {
                    const m = daten.module.find(x => x.pfad === gewaehlt)
                    return m ? (
                      <div className="muted mono" style={{ fontSize: 11.5, marginBottom: 8 }}>
                        {m.datei}
                        {m.version ? ` · ${m.version}` : ''}
                        {m.versionZeit ? ` · ${new Date(m.versionZeit).toLocaleDateString()}` : ''}
                      </div>
                    ) : null
                  })()}
                  <div className="inline mb">
                    <input
                      type="text"
                      placeholder={t('modules.searchSettings')}
                      value={suche}
                      onChange={e => setSuche(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <label className="inline" style={{ gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={nurBeschrieben}
                        onChange={e => setNurBeschrieben(e.target.checked)}
                      />
                      {t('modules.onlyDescribed')}
                    </label>
                    <label className="inline" style={{ gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={nurGeaendert}
                        onChange={e => setNurGeaendert(e.target.checked)}
                      />
                      {t('modules.onlyChanged')}
                    </label>
                  </div>

                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                    {t('modules.showing', { shown: sichtbar.length, total: eintraege.length })}
                    {' · '}
                    {t('modules.described', {
                      count: eintraege.filter(e => e.help).length,
                      total: eintraege.length
                    })}
                    {eintraege.some(e => e.quelle === 'uebersetzt') ? (
                      <>
                        {' · '}
                        {t('modules.translated', { count: eintraege.filter(e => e.quelle === 'uebersetzt').length })}
                      </>
                    ) : null}
                  </div>

                  <div className="module-settings">
                    {sichtbar.map(e => {
                      // Eigene Texte kommen in beiden Sprachen; alles
                      // andere ist der Originalsatz des Modulautors.
                      const uebersetzt = Boolean(e.hilfe)
                      const hilfe = uebersetzt ? (e.hilfe[lang] || e.help) : e.help
                      return (
                      <div key={e.key} className="module-setting">
                        <div className="module-setting-text">
                          <div className="mono" style={{ fontSize: 11.5 }}>{e.key}</div>
                          {hilfe ? (
                            <div className={`module-setting-help${uebersetzt ? ' eigen' : ''}`}>
                              {hilfe}
                              {/*
                               * Alles, was nicht eigener Text ist, kommt
                               * aus der Quelldatei - und die ist englisch.
                               * Die Marke sagt das offen, statt es zu
                               * verstecken.
                               */}
                              {!uebersetzt ? (
                                <span className="module-herkunft" title={t('modules.originalTooltip')}>EN</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <input
                          type="text"
                          className="mono module-setting-value"
                          value={e.value}
                          disabled={busy}
                          onChange={ev => setEintraege(l => wertAendern(l, e.key, ev.target.value))}
                        />
                      </div>
                      )
                    })}
                    {!sichtbar.length ? <div className="empty">{t('modules.noMatch')}</div> : null}
                  </div>

                  <div className={`inline mt save-bar${geaendert.length ? ' hat-aenderungen' : ''}`}>
                    <button className="btn primary" disabled={busy || !geaendert.length} onClick={speichern}>
                      {t('modules.save')}{geaendert.length ? ` (${geaendert.length})` : ''}
                    </button>
                    <button className="btn" disabled={busy || !geaendert.length} onClick={() => setEintraege(original)}>
                      {t('modules.discard')}
                    </button>
                    {mitSicherung ? (
                      <button className="btn" disabled={busy} onClick={zuruecksetzen} title={t('modules.resetTooltip')}>
                        {t('modules.reset')}
                      </button>
                    ) : null}
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {geaendert.length ? t('modules.unsaved') : t('modules.noChanges')}
                    </span>
                  </div>

                  {neustartNoetig ? (
                    <div className="info-box mt" style={{ fontSize: 12 }}>
                      {t('modules.restartHint')}{' '}
                      <button
                        className="btn sm"
                        onClick={() => api.server.restart('world')
                          .then(() => { toast(t('modules.restartDone'), 'ok'); setNeustartNoetig(false) })
                          .catch(e => toast(e.message, 'err'))}
                      >
                        {t('modules.restartBtn')}
                      </button>
                    </div>
                  ) : null}

                  {/*
                   * Die versionierten Sicherungen.
                   *
                   * Die Marke in der Modulliste zeigt nur, dass es eine
                   * ".bak" gibt. Hier stehen die einzelnen Staende mit
                   * Datum - und eine davon laesst sich zurueckspielen.
                   */}
                  {sicherungen && (sicherungen.liste.length || sicherungen.alt) ? (
                    <div className="mt" style={{ fontSize: 11.5 }}>
                      <div className="muted" style={{ marginBottom: 5 }}>
                        {t('modules.backupsTitle')}
                        {sicherungen.liste.length
                          ? ` · ${t('modules.backupsCount', { count: sicherungen.liste.length })}`
                          : ''}
                      </div>
                      {sicherungen.liste.length ? (
                        <div className="results" style={{ maxHeight: 150, overflowY: 'auto' }}>
                          {sicherungen.liste.map(s => (
                            <div key={s.pfad} className="result-row">
                              <span className="mono" style={{ fontSize: 11 }}>{s.name.replace(/\.[^.]+$/, '')}</span>
                              <span className="meta">{Math.round(s.groesse / 1024)} KB</span>
                              <button className="btn sm" onClick={() => stufeZurueckspielen(s)}>
                                {t('modules.backupRestore')}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {sicherungen.alt ? (
                        <div className="muted" style={{ marginTop: 5 }}>
                          {t('modules.backupOld')}: <span className="mono">{sicherungen.altName}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="info-box">
        {t('modules.note1')} <strong>Server Start / Stop</strong> {t('modules.note2')}
      </div>
      <div className="info-box">
        {t('modules.note3')}
      </div>
    </>
  )
}

export default Modules
