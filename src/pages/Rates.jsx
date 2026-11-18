import React, { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

// Voreinstellungen als Schnellwahl
const PRESETS = [0.25, 0.5, 1, 2, 3, 5, 10]
const MAX_RATE = 20

const fmt = v => {
  const n = parseFloat(String(v).replace(',', '.'))
  if (!Number.isFinite(n)) return String(v)
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

function RateRow ({ entry, onChange, disabled }) {
  const { t, lang } = useI18n()
  const num = Number.isFinite(entry.number) ? entry.number : 0
  const invalid = !Number.isFinite(entry.number)
  // Schieberegler braucht eine Zahl im erlaubten Bereich
  const sliderValue = Math.min(MAX_RATE, Math.max(0, num))

  /*
   * Der Name kommt aus den Teilen des Schluessels, die das Backend
   * mitliefert. Faellt die Uebersetzung aus - neuer Schluessel in einem
   * Fork, fuer den es noch keinen Text gibt - bleibt der deutsche Name
   * des Backends stehen. So ist nie eine leere Zeile zu sehen.
   */
  const label = (entry.parts && entry.parts.length)
    ? entry.parts.map(p => t(`rates.part.${p}`)).join(' — ')
    : entry.label

  /*
   * Der Hilfetext kommt aus der worldserver.conf des installierten
   * Cores - das Backend liefert ihn je Sprache mit. Ohne ihn bleibt nur
   * der Schluesselname, und bei Geschwistern wie Rate.Drop.Item.* ist
   * dann nicht mehr unterscheidbar, welcher Wert was tut.
   */
  const help = (entry.help && entry.help[lang]) || ''

  return (
    <div
      className="card"
      style={{ marginBottom: 8, opacity: disabled ? 0.6 : 1 }}
    >
      <div className="card-body" style={{ padding: '10px 12px' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="rates-beschriftung">
            <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
            <div className="mono muted" style={{ fontSize: 11 }}>{entry.key}</div>
            {help ? <div className="rates-hilfe">{help}</div> : null}
          </div>

          <div style={{ flex: 2, minWidth: 160 }}>
            <input
              type="range"
              min="0"
              max={MAX_RATE}
              step="0.25"
              value={sliderValue}
              disabled={disabled || invalid}
              onChange={e => onChange(entry.key, e.target.value)}
              style={{ width: '100%', accentColor: '#21d021' }}
            />
            <div className="muted" style={{ fontSize: 10.5, display: 'flex', justifyContent: 'space-between' }}>
              <span>0x</span><span>{MAX_RATE}x</span>
            </div>
          </div>

          <div style={{ flex: '0 0 96px', minWidth: 96 }}>
            <input
              type="text"
              className="mono"
              value={entry.value}
              disabled={disabled}
              onChange={e => onChange(entry.key, e.target.value)}
              style={{
                borderColor: invalid ? 'var(--red)' : undefined,
                color: invalid ? 'var(--red)' : undefined
              }}
            />
          </div>

          <div
            style={{
              flex: '0 0 auto',
              display: 'flex',
              gap: 4,
              flexWrap: 'nowrap',
              justifyContent: 'flex-end'
            }}
          >
            {PRESETS.map(p => (
              <button
                key={p}
                className="btn sm"
                disabled={disabled}
                style={num === p ? { borderTopColor: 'var(--gold)', color: '#fff' } : undefined}
                onClick={() => onChange(entry.key, String(p))}
                title={t('rates.timesRate', { p })}
              >
                {p}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Rates () {
  const { toast, status } = useStatus()
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  // Nach dem Speichern wirken die Raten erst nach einem Weltneustart
  const [neustartNoetig, setNeustartNoetig] = useState(false)
  const [nurAbweichend, setNurAbweichend] = useState(false)
  const [presetFaktor, setPresetFaktor] = useState('2')
  const [presetBereiche, setPresetBereiche] = useState({ xp: true, loot: true, rep: true, skill: false })

  const load = async () => {
    try {
      const res = await api.rates.get()
      setData(res)
      setEntries(res.entries || [])
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const setValue = (key, value) => {
    setEntries(list => list.map(e => (e.key === key ? { ...e, value } : e)))
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
      const res = await api.rates.save({ entries: changed })
      /*
       * Die meisten Raten wirken sofort per SOAP "reload config" - das
       * automatisch anstoßen, statt unnötig auf den Neustart zu warten.
       */
      let reloadOk = false
      try {
        const r = await api.soap.send('reload config')
        reloadOk = !!(r && (r.antwort || r.ok))
      } catch (_) {}
      toast(reloadOk
        ? t('rates.savedReload', { count: res.updated.length })
        : t('rates.saved', { count: res.updated.length }), 'ok')
      // Conf wirkt erst nach dem Weltneustart - Hinweis mit Aktion stehen lassen
      setNeustartNoetig(true)
      load()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const applyAll = async value => {
    setEntries(list => list.map(e => ({ ...e, value: String(value) })))
  }

  /*
   * Alle Raten auf den Core-Standard zurücksetzen (DEFAULTS aus dem Backend).
   * Schreibt direkt in die worldserver.conf; wirksam nach dem Weltneustart.
   */
  const resetStandard = async () => {
    if (!window.confirm(t('rates.resetFrage'))) return
    setBusy(true)
    try {
      const res = await api.rates.reset({})
      toast(t('rates.resetOk', { count: res.changed }), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Die Eintraege gruppiert in der Reihenfolge, die das Backend liefert.
   * Die Reihenfolge steht bewusst nicht hier: sonst gibt es zwei Stellen,
   * an denen sie sich aendern liesse, und irgendwann zeigen Backend und
   * Liste etwas anderes.
   */
  /*
   * "Nur Abweichungen zeigen".
   *
   * Der Standard einer Rate ist 1.0. Bei 96 Werten in sechs Gruppen ist
   * die Frage "was habe ich verstellt?" die haeufigste - und sie ist nur
   * zu beantworten, wenn man alles durchscrollt.
   *
   * Verglichen wird mit dem gespeicherten Stand (data), nicht mit einem
   * Wert aus dem Backend: sonst wuerden die gerade Bearbeiteten Werte
   * verschwinden, sobald man sie auf 1.0 zurueckstellt - und man
   * wuerde nicht sehen, dass man sie zurueckgestellt hat.
   */
  const nurAbweichungen = useMemo(() => {
    if (!nurAbweichend) return entries
    const original = new Map((data?.entries || []).map(o => [o.key, fmt(o.value)]))
    return entries.filter(e => {
      const stand = original.get(e.key)
      if (stand === undefined) return true
      return fmt(stand) !== fmt(e.value)
    })
  }, [entries, data, nurAbweichend])

  const gruppen = useMemo(() => {
    if (!data || !data.groups) return []
    return data.groups.map(g => ({
      id: g.id,
      titel: t(`rates.group.${g.id}`),
      liste: nurAbweichungen.filter(e => e.group === g.id)
    })).filter(g => g.liste.length)
  }, [data, nurAbweichungen, t])

  const createDefaults = async () => {
    setBusy(true)
    try {
      const res = await api.rates.createDefaults()
      toast(
        res.added
          ? t('rates.defaultsAdded', { count: res.added, keys: res.keys.join(', ') })
          : t('rates.defaultsExist'),
        'ok'
      )
      load()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  /*
   * Wie viele Werte weichen vom gespeicherten Stand ab? Das ist die Zahl,
   * die die Antwort auf "was habe ich verstellt?" liefert - und dieselbe
   * Zahl braucht die Uebersicht fuer ihre Kachel.
   *
   * Wichtig: Dieser Hook muss VOR dem fruehen Return stehen. Ein Hook
   * hinter einem bedingten Return wird nur beim ersten Durchlauf
   * aufgerufen - React meldet dann "Rendered more hooks than during the
   * previous render", und die Seite bleibt komplett leer.
   */
  const geaenderteZahl = useMemo(() => {
    if (!data) return 0
    const original = new Map((data.entries || []).map(o => [o.key, fmt(o.value)]))
    return entries.filter(e => {
      const stand = original.get(e.key)
      return stand !== undefined && stand !== fmt(e.value)
    }).length
  }, [entries, data])

  const PRESET_BEREICHE = [
    { key: 'xp', label: 'rates.presetXp', test: k => k.startsWith('Rate.XP') || k === 'Rate.Talent' || k === 'Rate.Talent.Pet' },
    { key: 'loot', label: 'rates.presetLoot', test: k => k.startsWith('Rate.Drop') },
    { key: 'rep', label: 'rates.presetRep', test: k => k.startsWith('Rate.Reputation') || k === 'Rate.Honor' || k.startsWith('Rate.ArenaPoints') },
    { key: 'skill', label: 'rates.presetSkill', test: k => k.startsWith('Rate.Skill') }
  ]
  const presetZiele = useMemo(
    () => entries.filter(e => PRESET_BEREICHE.some(b => presetBereiche[b.key] && b.test(e.key))),
    [entries, presetBereiche]
  )

  const presetAnwenden = () => {
    if (!presetZiele.length) return
    const keys = new Set(presetZiele.map(e => e.key))
    setEntries(list => list.map(e => keys.has(e.key) ? { ...e, value: String(presetFaktor) } : e))
    toast(t('rates.presetApplied', { n: keys.size, faktor: presetFaktor }), 'ok')
  }

  if (!data) return <div className="spinner">{t('rates.loading')}</div>

  const allDefaults = entries.length > 0 && entries.every(e => fmt(e.value) === '1.0')

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>{t('rates.head', { count: entries.length })}</h3>
          <div className="inline">
            <button className="btn sm" onClick={load}>{t('rates.reload')}</button>
          </div>
        </div>
        <div className="card-body">
          {data.error ? (
            <div className="error-box mb0">
              {data.error}
              <div style={{ marginTop: 6 }}>
                {t('rates.pathHintA')} <strong>{t('rates.pathMenu')}</strong> {t('rates.pathHintB')}
              </div>
            </div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                {t('rates.source')} <span className="mono">{data.path}</span>
              </div>

              {entries.length ? (
                <div className="preset-box">
                  <div className="inline" style={{ marginBottom: 6 }}>
                    <strong style={{ fontSize: 12.5 }}>{t('rates.presetTitle')}</strong>
                    <span className="muted" style={{ fontSize: 11.5 }}>{t('rates.presetHint')}</span>
                  </div>
                  <div className="inline" style={{ marginBottom: 6 }}>
                    {[1, 2, 5, 10].map(v => (
                      <button
                        key={v}
                        className={`btn sm ${String(presetFaktor) === String(v) ? 'primary' : ''}`}
                        onClick={() => setPresetFaktor(String(v))}
                      >
                        {v === 1 ? t('rates.presetBlizzlike') : `${v}x`}
                      </button>
                    ))}
                    <span className="muted" style={{ fontSize: 11.5 }}>{t('rates.presetFactor', { faktor: presetFaktor })}</span>
                  </div>
                  <div className="inline" style={{ marginBottom: 8 }}>
                    {PRESET_BEREICHE.map(b => (
                      <label key={b.key} className="check-row" style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={!!presetBereiche[b.key]}
                          onChange={e => setPresetBereiche(p => ({ ...p, [b.key]: e.target.checked }))}
                        />
                        {t(b.label)}
                      </label>
                    ))}
                  </div>
                  <div className="inline">
                    <button className="btn primary sm" disabled={busy || !presetZiele.length} onClick={presetAnwenden}>
                      {t('rates.presetApply', { n: presetZiele.length })}
                    </button>
                  </div>
                </div>
              ) : null}

              {entries.length ? (
                <div className="inline mb0" style={{ marginBottom: 12 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{t('rates.allOn')}</span>
                  {PRESETS.map(p => (
                    <button key={p} className="btn sm" onClick={() => applyAll(p)}>
                      {p}x
                    </button>
                  ))}
                  <button className="btn sm" onClick={resetStandard} disabled={busy}>
                    {t('rates.resetStandard')}
                  </button>
                  {allDefaults ? <span className="pill info">{t('rates.allNormal')}</span> : null}
                </div>
              ) : null}

              {/*
               * Der Filter "nur Abweichungen".
               *
               * Gezeigt wird, wie viele Werte vom Standard abweichen -
               * damit man auch weiss, dass der Filter nichts findet, weil
               * nichts geaendert wurde, und nicht weil er kaputt ist.
               */}
              {entries.length ? (
                <div className="inline mb0" style={{ marginBottom: 12 }}>
                  <label className="check-row" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={nurAbweichend}
                      onChange={e => setNurAbweichend(e.target.checked)}
                    />
                    {t('rates.onlyChanged')}
                  </label>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t('rates.changedSummary', {
                      changed: geaenderteZahl,
                      total: entries.length
                    })}
                  </span>
                </div>
              ) : null}

              {entries.length === 0 ? (
                <div>
                  <div className="info-box mb0">
                    {t('rates.emptyA')} <span className="mono">worldserver.conf</span>{' '}
                    {t('rates.emptyB')} <span className="mono">Rates.</span>{' '}
                    {t('rates.emptyC')}
                  </div>
                  <button className="btn primary mt" disabled={busy} onClick={createDefaults}>
                    {t('rates.addDefaults')}
                  </button>
                </div>
              ) : (
                <>
                  {gruppen.map(g => (
                    <div key={g.id} className="rates-gruppe">
                      <div className="rates-gruppe-kopf">
                        <h4>{g.titel}</h4>
                        <span className="muted">{g.liste.length}</span>
                      </div>
                      {g.liste.map(e => (
                        <RateRow
                          key={e.key}
                          entry={e}
                          disabled={busy}
                          onChange={setValue}
                        />
                      ))}
                    </div>
                  ))}

                  <div className="inline mt">
                    <button className="btn primary" disabled={busy || !changed.length} onClick={save}>
                      {t('rates.save')}{changed.length ? t('rates.countSuffix', { count: changed.length }) : ''}
                    </button>
                    <button className="btn" disabled={busy || !changed.length} onClick={() => setEntries(data.entries)}>
                      {t('rates.reset')}
                    </button>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {changed.length ? t('rates.unsaved') : t('rates.noChanges')}
                    </span>
                  </div>
                  {neustartNoetig ? (
                    <div className="info-box mt" style={{ fontSize: 12 }}>
                      {t('rates.restartHint')}{' '}
                      <button
                        className="btn sm"
                        onClick={async () => {
                          try {
                            await api.server.restart('world')
                            toast(t('rates.restartDone'), 'ok')
                            setNeustartNoetig(false)
                          } catch (e) {
                            toast(e.message, 'err')
                          }
                        }}
                      >
                        {t('rates.restartBtn')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><h3>{t('rates.commonValues')}</h3></div>
          <div className="card-body" style={{ fontSize: 12.5, lineHeight: 1.85 }}>
            <strong>0.5x</strong> {t('rates.value05')}<br />
            <strong>1.0x</strong> {t('rates.value10')}<br />
            <strong>2.0x</strong> {t('rates.value20')}<br />
            <strong>5.0x</strong> {t('rates.value50')}<br />
            <strong>10.0x</strong> {t('rates.value100')}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>{t('rates.afterSave')}</h3></div>
          <div className="card-body" style={{ fontSize: 12.5 }}>
            <p style={{ marginTop: 0 }}>
              {t('rates.runningInfo')}{' '}
              <strong style={{ color: status.world?.running ? 'var(--c-green)' : 'var(--c-red)' }}>
                {status.world?.running ? t('rates.yes') : t('rates.no')}
              </strong>.
            </p>
            <p>
              {t('rates.restartHintA')} <strong>{t('rates.restartMenu')}</strong>{' '}
              {t('rates.restartHintB')} <span className="mono">.bak</span>
              {t('rates.restartHintC')}
            </p>
            <div className="inline mb0">
              <button
                className="btn sm"
                disabled={!status.world?.running}
                title={t('rates.restartBtnHint')}
                onClick={() => api.server.restart('world').then(() => toast(t('rates.restartDone'), 'ok')).catch(e => toast(e.message, 'err'))}
              >
                {t('rates.restartBtn')}
              </button>
              <button
                className="btn sm"
                disabled={!status.world?.running}
                title={t('rates.reloadBtnHint')}
                onClick={() => api.soap.send('reload config').then(r => toast(t('rates.reloadDone', { antwort: (r.antwort || '').split('\n')[0].trim() || 'OK' }), 'ok')).catch(e => toast(e.message, 'err'))}
              >
                {t('rates.reloadBtn')}
              </button>
            </div>
            <div className="info-box mb0">
              {t('rates.warning')}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Rates