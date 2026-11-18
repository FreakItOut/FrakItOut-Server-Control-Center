import React, { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { formatNumber } from '../lib/constants'

// Obergrenze laut NpcBot-Konfiguration: 0 - 10000
const MAX_BOTS = 10000
const PRESETS = [0, 100, 200, 500, 1000, 2000, 5000]

/*
 * Reihenfolge, in der nach dem Schluessel fuer die Gesamtanzahl gesucht wird.
 * Mehrere Schluessel in einer Gruppe gehoeren zusammen und werden gemeinsam
 * gesetzt - mod-playerbots begrenzt ueber Min- und MaxRandomBots, und nur
 * einen davon zu aendern wuerde die zweite Grenze auf dem alten Wert lassen.
 *
 * Reihenfolge ist wichtig: NpcBots-Dateien enthalten auch AiPlayerbot-Schluessel,
 * dort ist aber "Continents.Count" der richtige.
 */
const COUNT_GROUPS = [
  ['NpcBot.WanderingBots.Continents.Count'],
  ['AiPlayerbot.RandomBotsTotalCount'],
  ['AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots'],
  ['AiPlayerbot.RandomBots'],
  ['AiPlayerbot.RandomBotCount'],
  ['NpcBot.MaxBots']
]

// "Enabled" statt "Enable" ist die Schreibweise von mod-playerbots
const ENABLE_KEYS = ['AiPlayerbot.Enable', 'AiPlayerbot.Enabled', 'NpcBot.Enable', 'NpcBot.Enable.All']

/*
 * Waehrend die Zahl im Eingabefeld getippt wird, wird der Bereich nicht
 * zurueckgesetzt - sonst kaeme man waehrend des Tippens nicht an die
 * naechste Zahl. Erst beim Verlassen des Feldes wird neu berechnet.
 */
function clampLive (value) {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return { valid: false, text: '' }
  if (n < 0 || n > MAX_BOTS) return { valid: false, text: String(n) }
  return { valid: true, text: String(n) }
}

function CountField ({ label, hint, value, onChange, disabled }) {
  const { t } = useI18n()
  const [text, setText] = useState(value)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setText(value)
  }, [value])

  const live = clampLive(text)
  const state = text === '' ? 'leer' : live.valid ? 'ok' : 'ungueltig'

  const commit = () => {
    setDirty(false)
    if (!live.valid) {
      setText(value)
      return
    }
    if (Number(text) !== value) onChange(Number(text))
  }

  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        min="0"
        max={MAX_BOTS}
        value={text}
        disabled={disabled}
        onChange={e => {
          setText(e.target.value)
          setDirty(true)
        }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const step = e.key === 'ArrowUp' ? 1 : -1
            const base = parseInt(text, 10) || 0
            const next = Math.min(MAX_BOTS, Math.max(0, base + step * (e.shiftKey ? 10 : 1)))
            setText(String(next))
            setDirty(true)
          }
        }}
        style={{ borderColor: state === 'ungueltig' ? 'var(--red)' : state === 'ok' ? 'var(--green)' : undefined }}
      />
      <div className="hint" style={state === 'ungueltig' ? { color: 'var(--red)' } : undefined}>
        {state === 'ungueltig'
          ? t('bots.invalidNumber', { max: formatNumber(MAX_BOTS) })
          : hint}
      </div>
    </div>
  )
}

/*
 * Auswahl der playerbots.conf. Ohne Auswahl sucht das Panel selbst
 * (playerbots.conf neben der worldserver.conf, sonst die worldserver.conf).
 * Mit Auswahl wird genau die genannte Datei gelesen und geschrieben.
 */
function BotFileCard ({ daten, onNeuLaden }) {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [pfad, setPfad] = useState(daten.ausgewaehlt || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setPfad(daten.ausgewaehlt || '') }, [daten.ausgewaehlt])

  const benutzt = daten.ausgewaehlt || ''
  // Fehlt die eingestellte Datei, darf das nicht stillschweigend auf eine
  // andere ausweichen - der Nutzer soll es sehen und selbst entscheiden.
  const fehlt = benutzt && !daten.file ? benutzt : ''

  const setzen = async wert => {
    setBusy(true)
    try {
      const res = await api.bots.setFile({ path: wert })
      toast(wert ? t('bots.fileApplied', { path: res.path }) : t('bots.fileReset'), 'ok')
      onNeuLaden()
      return true
    } catch (e) {
      toast(e.message, 'err')
      return false
    } finally {
      setBusy(false)
    }
  }

  const waehlen = async () => {
    try {
      const datei = await api.system.pickFile({
        title: t('bots.fileBrowse'),
        filters: [{ name: t('bots.fileFilter'), extensions: ['conf', 'dist', 'cnf', 'cfg'] }],
        defaultPath: pfad || daten.path || undefined
      })
      if (!datei) return
      setPfad(datei)
      await setzen(datei)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('bots.fileHead')}</h3>
        {benutzt ? (
          <span className="muted" style={{ fontSize: 11.5 }}>{t('bots.fileUserChosen')}</span>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>{t('bots.fileAutoFound')}</span>
        )}
      </div>
      <div className="card-body">
        <div className="field">
          <label>{t('bots.fileUsed')}</label>
          <div className="mono" style={{
            fontSize: 12.5,
            padding: '6px 10px',
            border: '1px solid var(--line)',
            borderRadius: 4,
            background: 'var(--bg2)',
            color: daten.path ? 'var(--text)' : 'var(--muted)',
            wordBreak: 'break-all'
          }}>
            {daten.path || '—'}
          </div>
        </div>

        {fehlt ? <div className="error-box">{t('bots.fileMissing')}</div> : null}

        <div className="field mt">
          <label>{t('bots.fileLabel')}</label>
          <input
            type="text"
            className="mono"
            value={pfad}
            placeholder={t('bots.filePlaceholder')}
            disabled={busy}
            onChange={e => setPfad(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setzen(pfad.trim()) }}
            style={{ fontSize: 12.5 }}
          />
          <div className="hint">{t('bots.fileHint')}</div>
        </div>

        <div className="inline mt">
          <button className="btn" disabled={busy} onClick={waehlen}>
            {t('bots.fileBrowse')}
          </button>
          <button
            className="btn primary"
            disabled={busy || pfad.trim() === benutzt}
            onClick={() => setzen(pfad.trim())}
          >
            {t('bots.fileApply')}
          </button>
          <button
            className="btn"
            disabled={busy || !benutzt}
            onClick={() => { setPfad(''); setzen('') }}
          >
            {t('bots.fileClear')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Bots () {
  const { toast, status } = useStatus()
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  // Die playerbots.conf von mod-playerbots hat ueber 800 Eintraege. Ohne
  // Filter ist die Liste nicht bedienbar, und bei jedem Tastendruck wuerden
  // alle Zeilen neu gezeichnet.
  const [filter, setFilter] = useState('')
  // Live-Zahl: die Konfiguration sagt den Soll-Stand, hier steht der Ist-Stand.
  const [live, setLive] = useState(null)
  // Bot-Konten: reichen sie für die konfigurierte Bot-Anzahl?
  const [konten, setKonten] = useState(null)

  useEffect(() => {
    let aktiv = true
    Promise.all([
      api.accounts.list({ ohneBots: false }).catch(() => null),
      api.accounts.list({ ohneBots: true }).catch(() => null)
    ]).then(([alle, echte]) => {
      if (!aktiv || !Array.isArray(alle)) return
      const echt = Array.isArray(echte) ? echte.length : 0
      setKonten({ botKonten: Math.max(0, alle.length - echt) })
    }).catch(() => {})
    return () => { aktiv = false }
  }, [])

  useEffect(() => {
    let aktiv = true
    const laden = () => {
      api.dashboard.stats()
        .then(s => { if (aktiv) setLive(s) })
        .catch(() => {})
    }
    laden()
    const iv = setInterval(laden, 10000)
    return () => { aktiv = false; clearInterval(iv) }
  }, [])

  const sichtbar = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return entries
    return entries.filter(
      e => e.key.toLowerCase().includes(f) || String(e.value).toLowerCase().includes(f)
    )
  }, [entries, filter])

  const load = async () => {
    try {
      const res = await api.bots.get()
      setData(res)
      setEntries(res.entries || [])
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  useEffect(() => { load() }, [])

  /*
   * Exakter Name zuerst. Der Notfall-Vergleich fasst nur noch das letzte
   * Glied eines Namens an und verlangt eine Punktgrenze - sonst wuerde
   * "Enable" auch "AiPlayerbot.EnableFishingWithMaster" treffen und die
   * Bots-Schaltung auf einen voellig unbeteiligten Schluessel legen.
   */
  const findKey = (...namen) => {
    for (const n of namen) {
      const exakt = entries.find(e => e.key.toLowerCase() === n.toLowerCase())
      if (exakt) return exakt.key
    }
    for (const n of namen) {
      const kurz = n.split('.').pop().toLowerCase()
      const lose = entries.find(e => {
        const k = e.key.toLowerCase()
        return k === kurz || k.endsWith('.' + kurz)
      })
      if (lose) return lose.key
    }
    return null
  }

  /*
   * Die erste Gruppe, von der mindestens ein Schluessel wirklich in der
   * Datei steht. Bewusst nur exakt verglichen: bei einem Treffer an der
   * falschen Stelle wuerde der Bot-Zaehler auf einen unbeteiligten
   * Schluessel geschrieben.
   */
  const countGruppe = useMemo(() => {
    for (const gruppe of COUNT_GROUPS) {
      const vorhanden = gruppe
        .map(k => entries.find(e => e.key.toLowerCase() === k.toLowerCase())?.key)
        .filter(Boolean)
      if (vorhanden.length) return vorhanden
    }
    return []
  }, [entries])

  const totalKey = countGruppe[0] || null
  const enableKey = findKey(...ENABLE_KEYS)
  const randomKey = findKey('AiPlayerbot.RandomBots', 'NpcBot.WanderingBots.RandomBots.Enable')
  const perAccountKey = findKey('AiPlayerbot.RandomBotsPerAccount')

  // Ist das NpcBot- oder das PlayerBots-Modul im Spiel?
  const usesNpcBot = entries.some(e => /^NpcBot\./i.test(e.key))
  const usesPlayerBots = entries.some(e => /^AiPlayerbot\./i.test(e.key))

  const getValue = key => {
    if (!key) return 0
    const hit = entries.find(e => e.key === key)
    return hit ? parseInt(hit.value, 10) || 0 : 0
  }

  const setValue = (key, value) => {
    if (!key) return
    setEntries(list => list.map(e => (e.key === key ? { ...e, value: String(value) } : e)))
  }

  // Setzt alle Schluessel einer Gruppe - z. B. Min- und MaxRandomBots
  const setGruppe = (gruppe, value) => {
    if (!gruppe || !gruppe.length) return
    setEntries(list =>
      list.map(e => (gruppe.includes(e.key) ? { ...e, value: String(value) } : e))
    )
  }

  const changed = useMemo(() => {
    if (!data) return []
    return entries.filter(e => {
      const orig = (data.entries || []).find(o => o.key === e.key)
      return orig && orig.value !== e.value
    })
  }, [entries, data])

  const save = async () => {
    setBusy(true)
    try {
      const res = await api.bots.save({ file: data.file, entries: changed })
      let msg = t('bots.saved', {
        count: res.updated.length,
        extra: res.added.length ? t('bots.newCount', { count: res.added.length }) : ''
      })
      if (res.added.length) msg += t('bots.created', { keys: res.added.join(', ') })
      msg += t('bots.restart')
      toast(msg, 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const createFile = async () => {
    setBusy(true)
    try {
      const res = await api.bots.createFile()
      toast(res.created ? t('bots.fileCreated') : t('bots.fileExists'), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Bot-Konto anlegen: mod-playerbots meldet sich mit Spielkonten an der
   * Auth-Datenbank an. Ohne ein Konto mitpassendem Passwort fehlen im Log
   * "account not found"-Zeilen, und keine Bot läuft an.
   */
  const [botKontoName, setBotKontoName] = useState('playerbots')
  const [botKontoPass, setBotKontoPass] = useState('')
  const botKontoAnlegen = async () => {
    if (!botKontoName.trim() || !botKontoPass) {
      toast(t('bots.kontoEingaben'), 'err')
      return
    }
    if (botKontoPass.length > 16) {
      toast(t('bots.kontoPasswortLang'), 'err')
      return
    }
    setBusy(true)
    try {
      await api.accounts.create({ name: botKontoName.trim(), password: botKontoPass, email: '' })
      toast(t('bots.kontoErstellt', { name: botKontoName.trim() }), 'ok')
      setBotKontoPass('')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Bot-Konten in Serie: nach einer Übernahme oder auf einem frischen Server
   * fehlen oft hunderte Konten. Angelegt werden nur fehlende Indizes
   * (<praefix>0…N-1) - vorhandene bleiben unangetastet.
   */
  const [serieAnzahl, setSerieAnzahl] = useState(200)
  const [seriePraefix, setSeriePraefix] = useState('rndbot')
  const [seriePass, setSeriePass] = useState('')
  const [serieLaeuft, setSerieLaeuft] = useState(false)
  const [serieFortschritt, setSerieFortschritt] = useState(0)
  const serieAnlegen = async () => {
    const praefix = seriePraefix.trim().toLowerCase()
    const anzahl = Math.max(1, Math.min(2000, Number(serieAnzahl) || 1))
    if (!praefix) {
      toast(t('bots.serieEingaben'), 'err')
      return
    }
    if (!seriePass || seriePass.length < 4 || seriePass.length > 16) {
      toast(t('bots.kontoEingaben'), 'err')
      return
    }
    if (!window.confirm(t('bots.serieFrage', { n: anzahl, praefix }))) return
    setSerieLaeuft(true)
    setSerieFortschritt(0)
    let erstellt = 0
    let fehler = 0
    try {
      // Vorhandene Konten einmal holen - nur fehlende Indizes anlegen.
      const alle = await api.accounts.list({ ohneBots: false }).catch(() => [])
      const vorhanden = new Set((Array.isArray(alle) ? alle : []).map(a => String(a.username || '').toLowerCase()))
      for (let i = 0; i < anzahl; i++) {
        const name = `${praefix}${i}`
        if (vorhanden.has(name.toLowerCase())) {
          setSerieFortschritt(i + 1)
          continue
        }
        try {
          await api.accounts.create({ name, password: seriePass, email: '' })
          erstellt++
        } catch (_) {
          fehler++
        }
        setSerieFortschritt(i + 1)
      }
      toast(t('bots.serieFertig', { erstellt, fehler }), fehler ? 'warn' : 'ok')
      setSeriePass('')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setSerieLaeuft(false)
    }
  }

  const total = getValue(totalKey)

  // Weichen die Schluessel einer Gruppe voneinander ab, ist das ein
  // Hinweis: mod-playerbots begrenzt ueber Min- und MaxRandomBots, und
  // nur eine davon umzustellen wuerde eine alte Grenze stehen lassen.
  const gruppeUneinheitlich =
    countGruppe.length > 1 && countGruppe.some(k => getValue(k) !== total)

  if (!data) return <div className="spinner">{t('bots.loading')}</div>

  const dateiKarte = <BotFileCard daten={data} onNeuLaden={load} />

  if (!data.file) {
    return (
      <>
        {dateiKarte}
        <div className="card">
          <div className="card-head"><h3>PlayerBots</h3></div>
          <div className="card-body">
            <div className="error-box">{data.message}</div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="grid cols-3">
        <div className="stat">
          <div className="label">{t('bots.activeBots')}</div>
          <div className={`value ${getValue(enableKey) > 0 ? 'green' : 'gold'}`}>
            {getValue(enableKey) > 0 ? t('bots.yes') : t('bots.no')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{enableKey || t('bots.keyNotFound')}</div>
        </div>
        <div className="stat">
          <div className="label">{t('bots.totalBots')}</div>
          <div className="value gold">{formatNumber(total)}</div>
          <div className="muted mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
            {countGruppe.join(', ') || t('bots.noKey')}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('bots.worldserver')}</div>
          <div className={`value ${status.world?.running ? 'green' : 'gold'}`} style={{ fontSize: 22 }}>
            {status.world?.running ? t('bots.running') : t('bots.stopped')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {changed.length ? t('bots.changesPending', { count: changed.length }) : t('bots.noChanges')}
          </div>
        </div>
      </div>

      {gruppeUneinheitlich ? (
        <div className="info-box">
          {t('bots.groupDiffers')}{' '}
          {countGruppe.map(k => (
            <span className="mono" key={k}>{k} = {getValue(k)} </span>
          ))}
          <br />
          {t('bots.groupHint')}
        </div>
      ) : null}

      {/* Nur zeigen, wenn wirklich automatisch gesucht wurde. Bei einer
          selbst gewaehlten Datei waere der Hinweis schlicht falsch. */}
      {data.source === 'auto' && data.primary === false ? (
        <div className="info-box">
          {t('bots.fallbackA')}{' '}
          <span className="mono">playerbots.conf</span>{' '}
          {t('bots.fallbackB')}{' '}
          <span className="mono">worldserver.conf</span>{' '}
          {t('bots.fallbackC')}
        </div>
      ) : null}

      <div className="card">
        <div className="card-head"><h3>{t('bots.kontoTitle')}</h3></div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>{t('bots.kontoIntro')}</p>
          <div className="inline mb0">
            <div className="field" style={{ width: 180 }}>
              <label>{t('bots.kontoName')}</label>
              <input value={botKontoName} onChange={e => setBotKontoName(e.target.value)} />
            </div>
            <div className="field" style={{ width: 180 }}>
              <label>{t('bots.kontoPasswort')}</label>
              <input type="password" value={botKontoPass} onChange={e => setBotKontoPass(e.target.value)} />
            </div>
            <button className="btn primary" onClick={botKontoAnlegen} disabled={busy}>
              {t('bots.kontoAnlegen')}
            </button>
          </div>
          <div className="hint">{t('bots.kontoHint')}</div>

          <div style={{ marginTop: 12, borderTop: '1px solid #444', paddingTop: 10 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('bots.serieTitel')}</div>
            <div className="inline mb0">
              <div className="field" style={{ width: 110 }}>
                <label>{t('bots.serieAnzahlLabel')}</label>
                <input
                  type="number"
                  min="1"
                  max="2000"
                  value={serieAnzahl}
                  onChange={e => setSerieAnzahl(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                />
              </div>
              <div className="field" style={{ width: 150 }}>
                <label>{t('bots.seriePraefixLabel')}</label>
                <input value={seriePraefix} onChange={e => setSeriePraefix(e.target.value)} />
              </div>
              <div className="field" style={{ width: 180 }}>
                <label>{t('bots.kontoPasswort')}</label>
                <input type="password" value={seriePass} onChange={e => setSeriePass(e.target.value)} />
              </div>
              <button className="btn" onClick={serieAnlegen} disabled={busy || serieLaeuft}>
                {serieLaeuft ? t('bots.serieLaeuft', { n: serieFortschritt }) : t('bots.serieAnlegen')}
              </button>
            </div>
            <div className="hint">{t('bots.serieHint')}</div>
          </div>
        </div>
      </div>

      {!data.found ? (
        <div className="card">
          <div className="card-head"><h3>{t('bots.noSettings')}</h3></div>
          <div className="card-body">
            <p style={{ marginTop: 0 }}>
              {t('bots.noEntries1')}{' '}
              <span className="mono">{data.path}</span>{' '}
              {t('bots.noEntries2')}{' '}
              <span className="mono"> NpcBot.</span> {t('bots.oder')} <span className="mono">AiPlayerbot.</span>{' '}
              {t('bots.noEntries3')}
            </p>
            <p>
              {t('bots.createHint1')} <span className="mono">playerbots.conf</span>{' '}
              {t('bots.createHint2')}
            </p>
            <button className="btn primary" disabled={busy} onClick={createFile}>
              {t('bots.createFile')}
            </button>
            <div className="hint" style={{ marginTop: 8 }}>
              {t('bots.willCreateIn')} {data.path.replace(/[^\\/]+$/, '')}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h3>{t('bots.countHead')}</h3>
              {live && Number.isFinite(live.online) ? (
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {t('bots.liveOnline', {
                    bots: Math.max(0, live.online - (Number.isFinite(live.onlineEchte) ? live.onlineEchte : live.online))
                  })}
                </span>
              ) : null}
              <span className="muted mono" style={{ fontSize: 11.5 }}>{data.path}</span>
            </div>
            <div className="card-body">
              {usesNpcBot && usesPlayerBots ? (
                <div className="info-box mb0" style={{ fontSize: 11.5 }}>
                  {t('bots.bothModules1')} <strong>{t('bots.bothWord')}</strong>{' '}
                  {t('bots.bothModules2')}
                </div>
              ) : null}

              <div className="row mt">
                <CountField
                  label={t('bots.enableLabel')}
                  hint={enableKey || t('bots.noEnableKey')}
                  value={getValue(enableKey)}
                  disabled={!enableKey}
                  onChange={v => setValue(enableKey, v)}
                />
                <CountField
                  label={t('bots.totalLabel', { max: formatNumber(MAX_BOTS) })}
                  hint={countGruppe.length > 1
                    ? countGruppe.join(' + ')
                    : (totalKey || t('bots.noCountKey'))}
                  value={total}
                  disabled={!totalKey}
                  onChange={v => setGruppe(countGruppe, v)}
                />
              </div>

              {(() => {
                if (!konten || !total) return null
                const pro = Math.max(1, Number(getValue(perAccountKey)) || 1)
                const noetig = Math.ceil(Number(total) / pro)
                if (noetig <= konten.botKonten) return null
                return (
                  <div className="warn-box" style={{ marginBottom: 12, fontSize: 12 }}>
                    {t('bots.kontenWarn', { noetig, vorhanden: konten.botKonten })}
                  </div>
                )
              })()}

              <div className="inline" style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 12 }}>{t('bots.presets')}</span>
                {PRESETS.map(p => (
                  <button
                    key={p}
                    className="btn sm"
                    disabled={!totalKey}
                    style={total === p ? { borderTopColor: 'var(--gold)', color: '#fff' } : undefined}
                    onClick={() => setGruppe(countGruppe, p)}
                  >
                    {formatNumber(p)}
                  </button>
                ))}
              </div>

              {randomKey || perAccountKey ? (
                <div className="row">
                  <CountField
                    label={t('bots.randomPerZone')}
                    hint={randomKey || t('bots.noKeyShort')}
                    value={getValue(randomKey)}
                    disabled={!randomKey}
                    onChange={v => setValue(randomKey, v)}
                  />
                  <CountField
                    label={t('bots.randomPerAccount')}
                    hint={perAccountKey || t('bots.noKeyShort')}
                    value={getValue(perAccountKey)}
                    disabled={!perAccountKey}
                    onChange={v => setValue(perAccountKey, v)}
                  />
                </div>
              ) : null}

              {changed.length ? (
                <div className="info-box">
                  {t('bots.pendingChanges')}{' '}
                  {changed.map(c => <span className="mono" key={c.key}>{c.key} = {c.value} </span>)}
                  <br />
                  {t('bots.restartNeeded')}
                  <div className="mt">
                    <button
                      className="btn sm"
                      disabled={!status.world?.running}
                      onClick={() => api.server.restart('world').then(() => toast(t('bots.restartDone'), 'ok')).catch(e => toast(e.message, 'err'))}
                    >
                      {t('bots.restartBtn')}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="inline mt">
                <button className="btn primary" disabled={busy || !changed.length} onClick={save}>
                  {t('bots.save')}
                </button>
                <button className="btn" disabled={busy || !changed.length} onClick={() => setEntries(data.entries)}>
                  {t('bots.reset')}
                </button>
              </div>
            </div>
          </div>

          {dateiKarte}

          <div className="card">
            <div className="card-head">
              <h3>{t('bots.allSettings', { count: entries.length })}</h3>
              {entries.length > 40 ? (
                <input
                  type="text"
                  className="mono"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder={t('bots.filterPlaceholder')}
                  style={{ fontSize: 12, padding: '4px 8px', width: 220 }}
                />
              ) : null}
            </div>
            <div className="card-body tight">
              <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr><th style={{ width: '48%' }}>{t('bots.key')}</th><th>{t('bots.value')}</th></tr>
                  </thead>
                  <tbody>
                    {sichtbar.map(e => (
                      <tr key={e.key}>
                        <td className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{e.key}</td>
                        <td>
                          <input
                            type="text"
                            className="mono"
                            value={e.value}
                            onChange={ev =>
                              setEntries(list => list.map(x => (x.key === e.key ? { ...x, value: ev.target.value } : x)))
                            }
                            style={{ fontSize: 12.5, padding: '4px 8px' }}
                          />
                        </td>
                      </tr>
                    ))}
                    {!sichtbar.length ? (
                      <tr>
                        <td colSpan={2} className="muted" style={{ textAlign: 'center', padding: 14 }}>
                          {t('bots.filterEmpty')}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {sichtbar.length !== entries.length ? (
                <div className="hint" style={{ marginTop: 8 }}>
                  {t('bots.filterCount', { shown: sichtbar.length, total: entries.length })}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      <div className="info-box">
        <strong>{t('bots.important')}</strong>{' '}
        {t('bots.hintA')}{' '}
        <span className="mono">0</span> {t('bots.rangeTo')}{' '}
        <span className="mono">10000</span>.{' '}
        {t('bots.hintB')}
      </div>
    </>
  )
}

export default Bots