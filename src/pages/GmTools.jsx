import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import { useStatus } from '../App'
import { qualityName, qualityColor } from '../lib/constants'
import { useI18n } from '../i18n'
import { ersteZeile } from '../lib/antwort'

const TABS = [
  { key: 'items', label: 'Items', fn: 'items', hint: 'gmTools.hintItems' },
  { key: 'creatures', label: 'Creatures', fn: 'creatures', hint: 'gmTools.hintCreatures' },
  { key: 'gameobjects', label: 'Gameobjects', fn: 'gameobjects', hint: 'gmTools.hintGameobjects' }
]

function GmTools () {
  const { toast, status } = useStatus()
  const { t } = useI18n()
  const [tab, setTab] = useState('items')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [uebersetzung, setUebersetzung] = useState(null)
  const [count, setCount] = useState(1)
  const [target, setTarget] = useState('')
  const [searchParams] = useSearchParams()

  const active = TABS.find(t => t.key === tab)

  const sucheAusfuehren = async (q, tabKey = tab) => {
    if (!String(q || '').trim()) return
    const eintrag = TABS.find(x => x.key === tabKey) || active
    try {
      const antwort = await api.gm[eintrag.fn](q)
      setResults(antwort.treffer)
      // Nur melden, wenn wirklich etwas uebersetzt wurde - sonst steht bei
      // jeder englischen Suche ein unnoetiger Hinweis unter den Ergebnissen.
      setUebersetzung(antwort.uebersetzt ? antwort : null)
      if (!antwort.treffer.length) toast(t('gmTools.notFound'), 'info')
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  const doSearch = e => {
    e.preventDefault()
    sucheAusfuehren(search)
  }

  /*
   * Aus der Befehlspalette: #/gm?tab=items&search=... - die Suche laeuft
   * direkt an, damit der Treffer nicht nur in der Palette steht.
   */
  useEffect(() => {
    const q = searchParams.get('search')
    if (!q) return
    const tabKey = searchParams.get('tab') || 'items'
    if (TABS.some(x => x.key === tabKey)) setTab(tabKey)
    setSearch(q)
    sucheAusfuehren(q, tabKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const spawnCommand = row => {
    let cmd = ''
    if (tab === 'items') cmd = `send items "${target || 'Spielername'}" "Items" "Sent via panel" ${row.entry}:${count}`
    if (tab === 'creatures') cmd = `npc load ${row.entry}`
    if (tab === 'gameobjects') cmd = `gobject load ${row.entry}`
    api.soap
      .send(cmd)
      .then(res => {
          /*
           * Der Core antwortet auf "npc add" mit dem Erzeugten, auf
           * "send item" mit dem Slot. Beides steht in der Antwort und
           * wurde vorher nicht angezeigt - der Kurzhinweis meldete nur
           * "Gesendet".
           *
           * Nur die erste Zeile: der Hinweis ist 380 Pixel breit und
           * nicht hoehenbegrenzt.
           */
          const sagt = ersteZeile(res.antwort)
          toast(sagt ? t('gmTools.sent', { cmd, out: sagt }) : t('gmTools.sent', { cmd }), 'ok')
        })
      .catch(err => toast(t('gmTools.sendError', { msg: err.message }), 'err'))
  }

  return (
    <>
      <div className="info-box" style={{ marginBottom: 16 }}>
        {t('gmTools.intro1')} <span className="mono">ac_world</span>
        {t('gmTools.intro2')}{' '}
        <strong>{t('gmTools.strongSend')}</strong> {t('gmTools.intro3')}{' '}
        <strong>{t('gmTools.strongSpawn')}</strong>{' '}
        {t('gmTools.intro4')} {status.world?.running ? t('gmTools.running') : t('gmTools.stopped')}).
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t('gmTools.searchTitle')}</h3>
          <div className="inline">
            <input
              type="text"
              placeholder={t('gmTools.targetPlaceholder')}
              value={target}
              onChange={e => setTarget(e.target.value)}
              style={{ width: 200 }}
            />
            {tab === 'items' ? (
              <input
                type="number"
                min="1"
                value={count}
                onChange={e => setCount(Math.max(1, Number(e.target.value)))}
                style={{ width: 70 }}
              />
            ) : null}
          </div>
        </div>
        <div className="card-body">
          <div className="tabs">
            {TABS.map(def => (
              <div key={def.key} className={`tab${tab === def.key ? ' active' : ''}`} onClick={() => { setTab(def.key); setResults([]); setUebersetzung(null) }}>
                {def.label}
              </div>
            ))}
          </div>

          <form onSubmit={doSearch} className="inline mb0">
            <input
              type="text"
              className="flex-1"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t(active.hint)}
              style={{ maxWidth: 420 }}
            />
            <button className="btn primary">{t('gmTools.searchBtn')}</button>
          </form>

          {/*
            Hinweis, wenn ein deutscher Begriff uebersetzt wurde. Ohne ihn
            wirkt eine leere Trefferliste wie ein Fehler.
          */}
          {uebersetzung ? (
            <div className="hint mt0">
              {t('gmTools.translatedHint', {
                was: uebersetzung.suchbegriff,
                begriffe: uebersetzung.begriffe
                  .filter(b => b.toLowerCase() !== uebersetzung.suchbegriff.toLowerCase())
                  .join(', ') || '…'
              })}
            </div>
          ) : null}

          {results.length ? (
            <div className="results mt">
              {results.map(r => (
                <div key={r.entry} className="result-row">
                  <span style={{ color: tab === 'items' ? qualityColor(r.quality) : 'var(--text)' }}>
                    {r.name}
                  </span>
                  <span className="meta">
                    {tab === 'items' ? `ID ${r.entry} · ${qualityName(r.quality, t)} · iLvl ${r.itemLevel}` : `ID ${r.entry}`}
                    {tab === 'creatures' ? t('gmTools.levelRange', { min: r.minlevel, max: r.maxlevel }) : ''}
                    {r.subname ? ` · ${r.subname}` : ''}
                  </span>
                  <span className="meta">
                    <button className="btn sm" onClick={() => spawnCommand(r)}>
                      {tab === 'items' ? t('gmTools.send') : t('gmTools.spawn')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t('gmTools.commandsTitle')}</h3></div>
        <div className="card-body">
          <div className="muted mono" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            {t('gmTools.cmdNpcAdd', { cmd: 'npc load <spawn-GUID>' })}<br />
            {t('gmTools.cmdNpcDelete', { cmd: 'npc delete' })}<br />
            {t('gmTools.cmdGobjectAdd', { cmd: 'gobject load <spawn-GUID>' })}<br />
            {t('gmTools.cmdSendItem', { cmd: 'send items "Spieler" "Items" "Sent" <ID>:<Anzahl>' })}<br />
            {t('gmTools.cmdTele', { cmd: '.teleport name <Spieler> <Ziel>' })}<br />
            {t('gmTools.cmdAdditem', { cmd: '.additem <ID> <Anzahl>' })}<br />
            {t('gmTools.cmdReloadAll', { cmd: 'reload config' })}<br />
            {t('gmTools.cmdCustomize', { cmd: 'character customize <Name>' })}
          </div>
          <div className="info-box mt" style={{ fontSize: 12 }}>
            {t('gmTools.note1')} <span className="mono">.tele</span>{' '}
            {t('gmTools.note2')} <span className="mono">.additem</span>{' '}
            {t('gmTools.note3')} <span className="mono">send item</span>{' '}
            {t('gmTools.note4')}
          </div>
        </div>
      </div>
    </>
  )
}

export default GmTools