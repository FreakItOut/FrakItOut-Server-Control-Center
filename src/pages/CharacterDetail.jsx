import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import Modal from '../components/Modal'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { className, raceName, genderName, formatMoney, formatPlaytime, formatDate, mapName, qualityName, qualityColor } from '../lib/constants'

function CharacterDetail () {
  const { guid } = useParams()
  const { toast } = useStatus()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [c, setC] = useState(null)
  const [tab, setTab] = useState('info')
  const [editing, setEditing] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [items, setItems] = useState([])
  const [itemHinweis, setItemHinweis] = useState(null)
  const [teleOffen, setTeleOffen] = useState(false)
  const [teleQuelle, setTeleQuelle] = useState('')
  const [karten, setKarten] = useState([])
  const [tele, setTele] = useState({ map: '', x: '', y: '', z: '', o: '0' })
  const [count, setCount] = useState(1)
  // Item-Namen fürs Inventar (die Charakter-DB kennt nur Entry-IDs)
  const [itemNamen, setItemNamen] = useState({})
  // Postfach wird erst beim Öffnen des Reiters geladen.
  const [post, setPost] = useState(null)
  const [postBusy, setPostBusy] = useState(false)

  const load = async () => {
    try {
      const daten = await api.characters.get(guid)
      setC(daten)
      const entries = (daten.inventory || []).map(i => i.itemEntry)
      if (entries.length) {
        api.characters.itemNamen({ entries }).then(liste => {
          const map = {}
          for (const it of liste || []) map[it.entry] = { name: it.name, quality: it.quality, itemLevel: it.itemLevel }
          setItemNamen(map)
        }).catch(() => {})
      }
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  useEffect(() => { load() }, [guid])

  useEffect(() => {
    if (tab !== 'mail') return
    setPostBusy(true)
    api.characters.postfach(guid)
      .then(setPost)
      .catch(e => toast(e.message, 'err'))
      .finally(() => setPostBusy(false))
  }, [tab, guid])

  // Kartenliste einmal holen, nicht bei jedem Oeffnen des Dialogs - sie kommt
  // aus der Datenbank und aendert sich praktisch nie.
  useEffect(() => {
    api.characters.maps()
      .then(r => setKarten(r.karten || []))
      .catch(() => setKarten([]))
  }, [])

  const searchItems = async e => {
    e.preventDefault()
    try {
      // Die Antwort traegt mehr als die Liste: ob uebersetzt wurde und welche
      // englischen Begriffe dazugekommen sind.
      const antwort = await api.gm.items(itemSearch)
      setItems(antwort.treffer)
      setItemHinweis(antwort.uebersetzt ? antwort : null)
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  const sendItem = async item => {
    try {
      const res = await api.gm.sendItem({ guid: Number(guid), itemEntry: item.entry, count })
      toast(t('characterDetail.itemSent', { item: item.name, name: c.name, bag: res.bag, slot: res.slot }), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const removeItem = async inv => {
    try {
      await api.gm.deleteItem({ guid: Number(guid), itemGuid: inv.guid })
      toast(t('characterDetail.itemRemoved'), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const save = async patch => {
    try {
      await api.characters.update(guid, patch)
      toast(t('characterDetail.saved'), 'ok')
      setEditing(false)
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const rename = async name => {
    try {
      await api.characters.rename(guid, name)
      toast(t('characterDetail.renamed'), 'ok')
      setEditing(false)
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const resetTalents = async () => {
    if (!window.confirm(t('characterDetail.confirmTalents', { name: c.name }))) return
    try {
      await api.characters.resetTalents(guid)
      toast(t('characterDetail.talentsReset'), 'ok')
      load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const remove = async () => {
    if (!window.confirm(t('characterDetail.confirmDelete', { name: c.name }))) return
    try {
      await api.characters.remove(guid)
      toast(t('characterDetail.deleted'), 'ok')
      navigate('/characters')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  if (!c) return <div className="spinner">{t('characterDetail.loading')}</div>

  return (
    <>
      <div className="inline mb0" style={{ marginBottom: 14 }}>
        <button className="btn sm" onClick={() => navigate('/characters')}>{t('characterDetail.backToList')}</button>
        <div className="flex-1" />
        <button className="btn sm" onClick={() => setEditing(true)}>{t('characterDetail.edit')}</button>
        <button className="btn sm" onClick={resetTalents}>{t('characterDetail.resetTalents')}</button>
        <button className="btn sm danger" onClick={remove}>{t('characterDetail.delete')}</button>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="label">{t('characterDetail.statChar')}</div>
          <div className="value gold" style={{ fontSize: 22 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {className(c.classId, t)} · {raceName(c.race, t)} · {genderName(c.gender, t)}
            {c.guild ? (
              <>
                {' · '}
                <Link to={`/characters?search=${encodeURIComponent(c.guild)}`}>{`<${c.guild}>`}</Link>
              </>
            ) : null}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('characterDetail.statLevel')}</div>
          <div className="value">{c.level}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {t('characterDetail.account', { account: c.account })}
            {c.username ? (
              <>
                {' · '}
                <Link to={`/characters?search=${encodeURIComponent(c.username)}`}>{c.username}</Link>
              </>
            ) : null}
            {c.bot ? (
              <span className="pill offline" style={{ marginLeft: 6, fontSize: 10 }}>
                {t('characterDetail.botTag')}
              </span>
            ) : null}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('characterDetail.statGold')}</div>
          <div className="value" style={{ fontSize: 22 }}>{formatMoney(c.money)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{t('characterDetail.playtime', { time: formatPlaytime(c.totaltime) })}</div>
        </div>
        <div className="stat">
          <div className="label">{t('characterDetail.statStatus')}</div>
          <div className={`value ${c.online ? 'green' : 'gold'}`} style={{ fontSize: 22 }}>
            {c.online ? t('characterDetail.online') : t('characterDetail.offline')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{mapName(c.map, t)}</div>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>{t('characterDetail.tabInfo')}</div>
        <div className={`tab${tab === 'inv' ? ' active' : ''}`} onClick={() => setTab('inv')}>{t('characterDetail.tabInventory', { count: c.inventory.length })}</div>
        <div className={`tab${tab === 'give' ? ' active' : ''}`} onClick={() => setTab('give')}>{t('characterDetail.tabGive')}</div>
        <div className={`tab${tab === 'spells' ? ' active' : ''}`} onClick={() => setTab('spells')}>{t('characterDetail.tabSpells')}</div>
        <div className={`tab${tab === 'mail' ? ' active' : ''}`} onClick={() => setTab('mail')}>{t('characterDetail.tabMail')}</div>
      </div>

      {tab === 'info' ? (
        <div className="grid cols-2">
          <div className="card">
            <div className="card-head"><h3>{t('characterDetail.dataHead')}</h3></div>
            <div className="card-body">
              <table>
                <tbody>
                  <tr><td className="muted">GUID</td><td className="mono">{c.guid}</td></tr>
                  <tr><td className="muted">{t('characterDetail.accountId')}</td><td className="mono">{c.account}</td></tr>
                  <tr><td className="muted">{t('characterDetail.class')}</td><td>{className(c.classId, t)}</td></tr>
                  <tr><td className="muted">{t('characterDetail.race')}</td><td>{raceName(c.race, t)}</td></tr>
                  <tr><td className="muted">{t('characterDetail.level')}</td><td>{c.level}</td></tr>
                  <tr><td className="muted">{t('characterDetail.health')}</td><td>{c.health}</td></tr>
                  <tr><td className="muted">Mana</td><td>{c.mana}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>{t('characterDetail.positionHead')}</h3></div>
            <div className="card-body">
              <table>
                <tbody>
                  <tr><td className="muted">Map</td><td>{mapName(c.map, t)} ({c.map})</td></tr>
                  <tr><td className="muted">{t('characterDetail.zone')}</td><td className="mono">{c.zone}</td></tr>
                  <tr><td className="muted">X</td><td className="mono">{Number(c.position.x).toFixed(2)}</td></tr>
                  <tr><td className="muted">Y</td><td className="mono">{Number(c.position.y).toFixed(2)}</td></tr>
                  <tr><td className="muted">Z</td><td className="mono">{Number(c.position.z).toFixed(2)}</td></tr>
                  <tr><td className="muted">{t('characterDetail.orientation')}</td><td className="mono">{Number(c.position.o).toFixed(3)}</td></tr>
                </tbody>
              </table>
              <div className="info-box mt" style={{ fontSize: 12 }}>
                {t('characterDetail.positionHint')}
              </div>
              <button
                className="btn primary mt"
                disabled={c.online || teleOffen}
                onClick={() => setTeleOffen(true)}
              >
                {t('characterDetail.teleportOpen')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {teleOffen ? (
        <Modal
          title={t('characterDetail.teleportTitle', { name: c.name })}
          onClose={() => setTeleOffen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setTeleOffen(false)}>{t('characterDetail.abort')}</button>
              <button
                className="btn primary"
                disabled={!teleQuelle && !(tele.map && tele.x !== '' && tele.y !== '' && tele.z !== '')}
                onClick={async () => {
                  try {
                    const daten = teleQuelle
                      ? { guid: Number(guid), fromGuid: Number(teleQuelle) }
                      : {
                          guid: Number(guid),
                          map: Number(tele.map),
                          x: Number(tele.x),
                          y: Number(tele.y),
                          z: Number(tele.z),
                          o: Number(tele.o || 0)
                        }
                    await api.characters.teleport(daten)
                    toast(t('characterDetail.teleportDone'), 'ok')
                    setTeleOffen(false)
                    setTeleQuelle('')
                    load()
                  } catch (e) {
                    toast(e.message, 'err')
                  }
                }}
              >
                {t('characterDetail.teleportGo')}
              </button>
            </>
          }
        >
          {c.online ? <div className="error-box">{t('characterDetail.teleportOnline')}</div> : null}

          <div className="field">
            <label>{t('characterDetail.teleportModeCopy')}</label>
            <input
              type="text"
              className="flex-1"
              placeholder={t('characterDetail.teleportFromPlaceholder')}
              value={teleQuelle}
              onChange={e => setTeleQuelle(e.target.value.replace(/\D/g, ''))}
            />
            <div className="hint" style={{ marginTop: 4 }}>{t('characterDetail.teleportModeCopyHint')}</div>
          </div>

          <div className="field">
            <label>{t('characterDetail.teleportModeCoords')}</label>
            <div className="row">
              <div className="field" style={{ minWidth: 220 }}>
                <label>{t('characterDetail.mapId')}</label>
                <select value={tele.map} onChange={e => setTele(s => ({ ...s, map: e.target.value }))}>
                  <option value="">{t('characterDetail.teleportPickMap')}</option>
                  {karten.map(k => (
                    <option key={k.map} value={k.map}>
                      {k.name ? `${k.name} (${k.map})` : `Map ${k.map}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field"><label>X</label>
                <input type="number" step="0.001" value={tele.x} onChange={e => setTele(s => ({ ...s, x: e.target.value }))} /></div>
              <div className="field"><label>Y</label>
                <input type="number" step="0.001" value={tele.y} onChange={e => setTele(s => ({ ...s, y: e.target.value }))} /></div>
              <div className="field"><label>Z</label>
                <input type="number" step="0.001" value={tele.z} onChange={e => setTele(s => ({ ...s, z: e.target.value }))} /></div>
              <div className="field"><label>{t('characterDetail.orientation')}</label>
                <input type="number" step="0.01" value={tele.o} onChange={e => setTele(s => ({ ...s, o: e.target.value }))} /></div>
            </div>
          </div>
        </Modal>
      ) : null}

      {tab === 'inv' ? (
        <div className="card">
          <div className="card-head">
            <h3>{t('characterDetail.inventoryHead', { count: c.inventory.length })}</h3>
            {c.online ? <span className="pill online">{t('characterDetail.onlinePill')}</span> : null}
          </div>
          <div className="card-body tight">
            {!c.inventory.length ? (
              <div className="empty">{t('characterDetail.inventoryEmpty')}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th className="num">{t('characterDetail.itemGuid')}</th><th>{t('characterDetail.itemName')}</th><th className="num">{t('characterDetail.bag')}</th><th className="num">{t('characterDetail.slot')}</th><th></th></tr>
                  </thead>
                  <tbody>
                    {c.inventory.map(i => (
                      <tr key={i.guid}>
                        <td className="num mono">{i.guid}</td>
                        <td className="mono" title={`#${i.itemEntry}${itemNamen[i.itemEntry] && itemNamen[i.itemEntry].itemLevel ? ` · iLvl ${itemNamen[i.itemEntry].itemLevel}` : ''}`}>
                          {itemNamen[i.itemEntry]
                            ? (
                              <span
                                style={{ color: qualityColor(itemNamen[i.itemEntry].quality) }}
                                title={`${qualityName(itemNamen[i.itemEntry].quality, t)}${itemNamen[i.itemEntry].itemLevel ? ` · iLvl ${itemNamen[i.itemEntry].itemLevel}` : ''}`}
                              >
                                {itemNamen[i.itemEntry].name}
                              </span>
                            )
                            : i.itemEntry}
                        </td>
                        <td className="num">{i.bag === 255 ? t('characterDetail.pouch') : t('characterDetail.bagNum', { bag: i.bag })}</td>
                        <td className="num">{i.slot}</td>
                        <td className="right">
                          <button className="btn sm danger" onClick={() => removeItem(i)}>{t('characterDetail.remove')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'give' ? (
        <>
          {c.online ? (
            <div className="info-box" style={{ marginBottom: 14 }}>
              <strong>{t('characterDetail.onlineTitle', { name: c.name })}</strong>{' '}
              {t('characterDetail.onlineHint')}
            </div>
          ) : null}
          <div className="card">
            <div className="card-head"><h3>{t('characterDetail.searchHead')}</h3></div>
            <div className="card-body">
              <form onSubmit={searchItems} className="inline mb0">
                <input
                  type="text"
                  className="flex-1"
                  placeholder={t('characterDetail.itemPlaceholder')}
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  style={{ maxWidth: 420 }}
                />
                <div className="field" style={{ margin: 0, width: 90 }}>
                  <input type="number" min="1" value={count} onChange={e => setCount(Math.max(1, Number(e.target.value)))} />
                </div>
                <button className="btn primary">{t('characterDetail.search')}</button>
              </form>

              {itemHinweis ? (
                <div className="hint mt0">
                  {t('gmTools.translatedHint', { was: itemHinweis.suchbegriff, begriffe: itemHinweis.begriffe.filter(b => b.toLowerCase() !== itemHinweis.suchbegriff.toLowerCase()).join(', ') || '…' })}
                </div>
              ) : null}

              {items.length ? (
                <div className="results mt">
                  {items.map(it => (
                    <div key={it.entry} className="result-row">
                      <span style={{ color: qualityColor(it.quality) }}>{it.name}</span>
                      <span className="meta">
                        #{it.entry} · {qualityName(it.quality, t)} · iLvl {it.itemLevel} · {t('characterDetail.requiredLevel', { level: it.requiredLevel })}
                      </span>
                      <span className="meta">
                        <button className="btn sm success" disabled={c.online} onClick={() => sendItem(it)}>{t('characterDetail.send')}</button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {tab === 'spells' ? (
        <div className="grid cols-2">
          <div className="card">
            <div className="card-head"><h3>{t('characterDetail.spellsHead', { count: c.spells.length })}</h3></div>
            <div className="card-body">
              <div className="results" style={{ maxHeight: 420 }}>
                {c.spells.map(s => (
                  <div key={s} className="result-row"><span className="mono">{t('characterDetail.spell', { id: s })}</span></div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>{t('characterDetail.talentsHead', { count: c.talents.length })}</h3>
              <button className="btn sm danger" onClick={resetTalents}>{t('characterDetail.reset')}</button>
            </div>
            <div className="card-body">
              {!c.talents.length ? (
                <div className="empty">{t('characterDetail.talentsEmpty')}</div>
              ) : (
                <div className="results" style={{ maxHeight: 420 }}>
                  {c.talents.map(tal => (
                    <div key={tal.talent} className="result-row">
                      <span className="mono">{t('characterDetail.talent', { id: tal.talent })}</span>
                      <span className="meta">{t('characterDetail.rank', { rank: tal.rank })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'mail' ? (
        <div className="card">
          <div className="card-head">
            <h3>{t('characterDetail.mailHead', { count: post ? post.anzahl : 0 })}</h3>
          </div>
          <div className="card-body">
            {postBusy ? <div className="spinner">{t('characterDetail.mailLoading')}</div> : null}
            {!postBusy && post && post.verfuegbar === false ? (
              <div className="empty">{t('characterDetail.mailUnavailable')}</div>
            ) : null}
            {!postBusy && post && post.verfuegbar !== false && !post.liste.length ? (
              <div className="empty">{t('characterDetail.mailEmpty')}</div>
            ) : null}
            {!postBusy && post ? post.liste.map(m => (
              <div key={m.id} className="preset-box" style={{ marginBottom: 10 }}>
                <div className="inline" style={{ justifyContent: 'space-between' }}>
                  <strong>{m.subject || t('characterDetail.mailNoSubject')}</strong>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {m.gesendet ? formatDate(m.gesendet) : ''}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                  {t('characterDetail.mailFrom', { name: m.senderName || t('characterDetail.mailSystem') })}
                  {m.geld ? ` · ${formatMoney(m.geld)}` : ''}
                  {m.nachnahme ? ` · ${t('characterDetail.mailCod', { summe: formatMoney(m.nachnahme) })}` : ''}
                  {m.laeuftAb ? ` · ${t('characterDetail.mailExpires', { when: formatDate(m.laeuftAb) })}` : ''}
                </div>
                {m.body ? <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{m.body}</div> : null}
                {m.items.length ? (
                  <div className="inline" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                    {m.items.map((it, i) => (
                      <span key={i} className="pill" style={{ color: qualityColor(it.quality), borderColor: 'var(--line-soft)' }}>
                        {it.name} × {it.anzahl}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )) : null}
          </div>
        </div>
      ) : null}

      {editing ? (
        <EditModal
          c={c}
          onClose={() => setEditing(false)}
          onSave={save}
          onRename={rename}
        />
      ) : null}
    </>
  )
}

function EditModal ({ c, onClose, onSave, onRename }) {
  const { t } = useI18n()
  const [f, setF] = useState({
    level: c.level,
    money: c.money,
    map: c.map,
    zone: c.zone,
    x: c.position.x,
    y: c.position.y,
    z: c.position.z,
    o: c.position.o
  })
  const [name, setName] = useState(c.name)

  const set = k => e => setF({ ...f, [k]: e.target.value })

  return (
    <Modal
      title={t('characterDetail.editTitle', { name: c.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('characterDetail.cancel')}</button>
          <button className="btn primary" onClick={() => onSave({
            level: Number(f.level),
            money: Number(f.money),
            map: Number(f.map),
            zone: Number(f.zone),
            x: Number(f.x),
            y: Number(f.y),
            z: Number(f.z),
            o: Number(f.o)
          })}>{t('characterDetail.save')}</button>
        </>
      }
    >
      <div className="info-box mb0">
        {t('characterDetail.editHint')}
      </div>
      <div className="row mt">
        <div className="field">
          <label>{t('characterDetail.name')}</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn sm mt" style={{ marginTop: 6 }} onClick={() => onRename(name)}>{t('characterDetail.renameOnly')}</button>
        </div>
        <div className="field">
          <label>{t('characterDetail.levelRange')}</label>
          <input type="number" min="1" max="80" value={f.level} onChange={set('level')} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>{t('characterDetail.goldCopper')}</label>
          <input type="number" value={f.money} onChange={set('money')} />
          <div className="hint">{t('characterDetail.copperHint')}</div>
        </div>
        <div className="field">
          <label>{t('characterDetail.mapId')}</label>
          <input type="number" value={f.map} onChange={set('map')} />
        </div>
        <div className="field">
          <label>{t('characterDetail.zone')}</label>
          <input type="number" value={f.zone} onChange={set('zone')} />
        </div>
      </div>
      <div className="row">
        {['x', 'y', 'z', 'o'].map(k => (
          <div className="field" key={k}>
            <label>{k.toUpperCase()}</label>
            <input type="number" step="0.001" value={f[k]} onChange={set(k)} />
          </div>
        ))}
      </div>
    </Modal>
  )
}

export default CharacterDetail