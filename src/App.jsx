import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import MenueHinweis, { useMenueHinweis } from './components/MenueHinweis'
import CommandPalette from './components/CommandPalette'
import api from './lib/api'
import Toast from './components/Toast'
import { useI18n, LANGUAGES } from './i18n'
import Dashboard from './pages/Dashboard'
import ServerControl from './pages/ServerControl'
import Realms from './pages/Realms'
import Characters from './pages/Characters'
import CharacterDetail from './pages/CharacterDetail'
import Accounts from './pages/Accounts'
import Bots from './pages/Bots'
import Backup from './pages/Backup'
import Rates from './pages/Rates'
import Modules from './pages/Modules'
import ConnectOptions from './pages/ConnectOptions'
import Bans from './pages/Bans'
import Online from './pages/Online'
import GmTools from './pages/GmTools'
import Console from './pages/Console'
import ConfigEditor from './pages/ConfigEditor'
import Settings from './pages/Settings'
import Setup from './pages/Setup'
import Hilfe from './pages/Hilfe'
import Audit from './pages/Audit'
import Tickets from './pages/Tickets'
import Werkzeuge from './pages/Werkzeuge'
import Guilds from './pages/Guilds'
import Wirtschaft from './pages/Wirtschaft'

const StatusContext = createContext({ status: { world: {}, auth: {} }, refresh: () => {}, toast: () => {} })
export const useStatus = () => useContext(StatusContext)

/*
 * Die Versionsnummer steht nirgends mehr im Panel.
 *
 * In der Titelleiste war sie Ballast, in der Startmeldung des Uebersicht-
 * Dashboards sagte sie nichts, was nicht ohnehin am Fenstertitel steht.
 * Sie steht nur noch im Dateinamen der EXE - dort, wo man sie beim
 * Suchen einer bestimmten Version auch erwartet.
 */

/*
 * Reihenfolge der linken Leiste.
 *
 * Sie folgt dem Arbeitsablauf, nicht der Entstehungsreihenfolge der Seiten:
 * erst der taegliche Betrieb, dann die Spielerverwaltung, dann die
 * Laufzeit-Konfiguration des Servers, zuletzt Anschluss und Grundeinstellungen.
 * Connect Optionen und Einstellungen stehen bewusst am Ende - sie werden
 * beim Einrichten gebraucht, nicht beim Spielen.
 */
const NAV_GROUPS = [
  {
    key: 'operations',
    items: [
      { to: '/', key: 'dashboard', icon: '▤', end: true },
      { to: '/server', key: 'server', icon: '▶' },
      { to: '/console', key: 'console', icon: '>' }
    ]
  },
  {
    key: 'players',
    items: [
      { to: '/realms', key: 'realms', icon: '◈' },
      { to: '/accounts', key: 'accounts', icon: '+' },
      // Direkt nach "Acc erstellen": ein Charakter gehoert zu einem Konto.
      // Ohne diesen Eintrag war die Seite nur ueber die Detailansicht erreichbar.
      { to: '/characters', key: 'characters', icon: '☺' },
      { to: '/guilds', key: 'guilds', icon: '⚑' },
      { to: '/online', key: 'online', icon: '●' },
      { to: '/tickets', key: 'tickets', icon: '✉' },
      { to: '/bans', key: 'bans', icon: '⊘' },
      { to: '/gm', key: 'gm', icon: '✦' }
    ]
  },
  {
    key: 'server',
    items: [
      { to: '/bots', key: 'bots', icon: '☖' },
      { to: '/rates', key: 'rates', icon: '⚡' },
      // Direkt neben den Raten: beides sind Schalter in der Serverkonfiguration,
      // und die Module erklaeren den Server weitgehend.
      { to: '/modules', key: 'modules', icon: '⚙' },
      { to: '/config', key: 'config', icon: '⚒' },
      { to: '/backup', key: 'backup', icon: '⛁' },
      { to: '/wirtschaft', key: 'wirtschaft', icon: '¤' }
    ]
  },
  {
    key: 'system',
    items: [
      { to: '/settings', key: 'settings', icon: '⇄' },
      { to: '/options', key: 'options', icon: '⚙' },
      { to: '/werkzeuge', key: 'werkzeuge', icon: '⚗' },
      { to: '/protokoll', key: 'protokoll', icon: '≡' },
      { to: '/hilfe', key: 'hilfe', icon: '?' }
    ]
  }
]

function clockString () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Seitentitel aus dem Sprachpaket; der Schluessel ist einfach der Pfad
function lookupTitle (t, pfad) {
  const eintrag = t(`page.${pfad}`)
  if (Array.isArray(eintrag)) return eintrag
  // Rueckfall, falls jemand eine Seite ohne Eintrag im Sprachpaket einbaut.
    // Name wie in der Titelleiste, damit nirgends der alte Produktname steht.
    return [t('app.title'), '']
}

function App () {
  const { t, lang, setLang } = useI18n()
  const [status, setStatus] = useState({ world: { running: false }, auth: { running: false } })
  const [dbOk, setDbOk] = useState(null)
  const [counts, setCounts] = useState(null)
  const [toasts, setToasts] = useState([])
  const [clock, setClock] = useState(clockString())
  // Filter fuer die gewachsene Navigation: 16 Seiten sind sonst viel Liste.
  const [navSuche, setNavSuche] = useState('')
  const [sidebarKollabiert, setSidebarKollabiert] = useState(() => {
    try { return localStorage.getItem('panel.sidebarCollapsed') === '1' } catch (_) { return false }
  })
  // Globale Befehlspalette (Strg+K)
  const [paletteOffen, setPaletteOffen] = useState(false)
  // Meldungsverlauf in der Titelzeile
  const [meldungen, setMeldungen] = useState([])
  const [meldungenOffen, setMeldungenOffen] = useState(false)
  const [notifyFilter, setNotifyFilter] = useState('alle')
  // Angeheftete Seiten (Schluessel aus NAV_GROUPS), in der Konfiguration gespeichert.
  const [favoriten, setFavoriten] = useState([])

  useEffect(() => {
    api.settings.get()
      .then(cfg => {
        const f = cfg && cfg.panel && cfg.panel.favorites
        if (Array.isArray(f)) setFavoriten(f.filter(x => typeof x === 'string'))
      })
      .catch(() => {})
  }, [])

  const favoritUmschalten = key => {
    setFavoriten(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      api.settings.save({ panel: { favorites: next } }).catch(() => {})
      return next
    })
  }
  const location = useLocation()
  const { wert: hinweis, zeige: hinweisZeige, verberge: hinweisVerberge } = useMenueHinweis()

  // Einrichtungsassistent: solange Pfade oder Datenbank fehlen, ist die
  // Oberfläche nicht benutzbar. Dann erst den Assistenten zeigen.
  const [setup, setSetup] = useState(null) // null = noch nicht geprueft
  const [setupOffen, setSetupOffen] = useState(false)

  useEffect(() => {
    api.system
      .setupStatus()
      .then(setSetup)
      .catch(() => setSetup({ eingerichtet: true, offen: [] }))
  }, [])

  /*
   * Zuletzt besuchte Seite wiederherstellen: Nach einem Panel-Neustart
   * landet man da, wo man war - nicht jedes Mal auf der Übersicht. Nur bei
   * leerem Hash; wer gezielt eine Seite anspringt, wird nicht abgefangen.
   */
  useEffect(() => {
    try {
      const gesp = localStorage.getItem('panel:letzteSeite')
      const hash = window.location.hash || ''
      if (gesp && gesp !== '/' && (!hash || hash === '#/' || hash === '#')) {
        window.location.hash = '#' + gesp
      }
    } catch (_) {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('panel:letzteSeite', location.pathname) } catch (_) {}
  }, [location.pathname])

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.server.status())
    } catch (_) {
      /* ignorieren */
    }
  }, [])

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }, [])

  useEffect(() => {
    refresh()
    let unsubscribe
    if (window.api && typeof window.api.on === 'function') {
      unsubscribe = window.api.on('server:status', setStatus)
    }
    const iv = setInterval(refresh, 8000)
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
      clearInterval(iv)
    }
  }, [refresh])

  // Datenbankstatus und Kennzahlen fuer die Statusleiste
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await api.settings.testAll()
        if (!alive) return
        setDbOk(Object.values(res).some(r => r.ok))
        try {
          const s = await api.dashboard.stats()
          if (alive) setCounts(s)
        } catch (_) {}
      } catch (_) {
        if (alive) setDbOk(false)
      }
    }
    poll()
    const iv = setInterval(poll, 15000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [])

  useEffect(() => {
    const iv = setInterval(() => setClock(clockString()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Fertig: Zustand neu pruefen, damit der Assistent nicht wieder aufpoppt.
  // Der Nutzer darf den Assistenten aber jederzeit verlassen, auch wenn
  // noch etwas fehlt - sonst saesse er in einer Schleife fest, etwa weil
  // die Datenbank gerade nicht laeuft. Was fehlt, laesst sich in den
  // Einstellungen nachbessern.
  const [setupAusgelassen, setSetupAusgelassen] = useState(false)
  const setupFertig = useCallback(() => {
    setSetupOffen(false)
    setSetupAusgelassen(true)
    api.system.setupStatus().then(setSetup).catch(() => {})
  }, [])

  // Aus den Einstellungen heraus erneut aufrufbar
  useEffect(() => {
    const oeffnen = () => setSetupOffen(true)
    window.addEventListener('panel:setup', oeffnen)
    return () => window.removeEventListener('panel:setup', oeffnen)
  }, [])

  const setupLaufend = setupOffen || (setup && !setup.eingerichtet && !setupAusgelassen)

  // Seitentitel und Navigation kommen aus dem Sprachpaket
  const titel = lookupTitle(t, location.pathname)
  const navLabels = useMemo(() => {
    const map = {}
    for (const gruppe of NAV_GROUPS) for (const item of gruppe.items) if (item.key) map[item.key] = t(`nav.${item.key}`)
    return map
  }, [t])
  const navFilter = navSuche.trim().toLowerCase()
  const navGruppen = NAV_GROUPS
    .map(gruppe => ({
      ...gruppe,
      items: gruppe.items.filter(item =>
        !favoriten.includes(item.key) &&
        (!navFilter || navLabels[item.key].toLowerCase().includes(navFilter))
      )
    }))
    .filter(gruppe => gruppe.items.length)
  const favoritenSeiten = NAV_GROUPS.flatMap(gruppe => gruppe.items)
    .filter(item => favoriten.includes(item.key))
    .filter(item => !navFilter || navLabels[item.key].toLowerCase().includes(navFilter))
  const paletteSeiten = NAV_GROUPS.flatMap(gruppe => gruppe.items)
    .map(item => ({ to: item.to, label: navLabels[item.key] }))

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOffen(o => !o)
      } else if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarKollabiert(v => {
          const neu = !v
          try { localStorage.setItem('panel.sidebarCollapsed', neu ? '1' : '0') } catch (_) {}
          return neu
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { setPaletteOffen(false) }, [location.pathname])

  useEffect(() => {
    api.notify.list().then(r => setMeldungen((r && r.liste) || [])).catch(() => {})
    const ab = api.on('notify:event', e => {
      if (e) setMeldungen(prev => [e, ...prev].slice(0, 50))
    })
    return () => { try { ab && ab() } catch (_) {} }
  }, [])

  const ungelesen = meldungen.filter(m => !m.gelesen).length
  const sichtbareMeldungen = notifyFilter === 'ungelesen' ? meldungen.filter(m => !m.gelesen) : meldungen
  const meldungsZiel = m => {
    const text = `${m.titel || ''} ${m.text || ''}`.toLowerCase()
    if (/backup|sicherung/.test(text)) return '#/backup'
    if (/modul/.test(text)) return '#/modules'
    if (/update/.test(text)) return '#/'
    return '#/server'
  }
  const meldungenOeffnen = () => setMeldungenOffen(o => !o)
  const world = status.world || {}
  const auth = status.auth || {}

  const navEintrag = (item, istFavorit) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
      /* Das title-Attribut blieb: es zeigt den Namen auch dann,
         wenn der Hinweis ausbleibt - etwa weil eine Seite keine
         Beschreibung im Sprachpaket hat. Der Hinweis ist die
         Ausbesserung, nicht der Ersatz. */
      title={navLabels[item.key]}
      onMouseEnter={e => hinweisZeige(e, lookupTitle(t, item.to))}
      onMouseLeave={hinweisVerberge}
      onFocus={e => hinweisZeige(e, lookupTitle(t, item.to))}
      onBlur={hinweisVerberge}
    >
      <span className="nb-icon">{item.icon}</span>
      <span>{navLabels[item.key]}</span>
      {item.to === '/online' && counts?.online ? (
        <span className="nb-badge">{counts.online}</span>
      ) : null}
      {item.to === '/characters' && counts?.characters ? (
        <span className="nb-badge">{counts.characters}</span>
      ) : null}
      <span
        className={`nav-star ${istFavorit ? 'an' : ''}`}
        role="button"
        tabIndex={-1}
        title={t(istFavorit ? 'nav.unfavorite' : 'nav.favorite')}
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          favoritUmschalten(item.key)
        }}
      >
        ★
      </span>
    </NavLink>
  )

  // Solange die Einrichtung unvollstaendig ist, gibt es nichts zu bedienen.
  if (setupLaufend) {
    return (
      <Setup
        onFertig={setupFertig}
        onAbbrechen={() => setSetupOffen(false)}
        zwang={!!setup && !setup.eingerichtet}
      />
    )
  }

  return (
    <StatusContext.Provider value={{ status, refresh, toast, dbOk, counts }}>
      <div className="app">
        <div className="titlebar">
          <span className="app-icon">
            <img src="./logo-freak.png" alt="" />
          </span>
          <span className="tb-text">{t('app.title')}</span>
          <div className="tb-right">
            <button
              className="tb-bell"
              title={t('notify.title')}
              aria-label={t('notify.title')}
              onClick={meldungenOeffnen}
            >
              🔔
              {ungelesen ? <span className="tb-badge">{ungelesen > 9 ? '9+' : ungelesen}</span> : null}
            </button>
            <span className="tb-time">{clock}</span>
            {meldungenOffen ? (
              <div className="notify-panel">
                <div className="notify-panel-head">
                  <strong>{t('notify.title')}</strong>
                  <div className="notify-tools">
                    <select value={notifyFilter} onChange={e => setNotifyFilter(e.target.value)}>
                      <option value="alle">{t('notify.all')}</option>
                      <option value="ungelesen">{t('notify.unread')}</option>
                    </select>
                    <button
                      className="btn sm"
                      disabled={!ungelesen}
                      onClick={() => api.notify.gelesen()
                        .then(() => setMeldungen(prev => prev.map(m => ({ ...m, gelesen: true }))))
                        .catch(() => {})}
                    >
                      {t('notify.markRead')}
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => api.notify.leeren().then(() => setMeldungen([])).catch(() => {})}
                      disabled={!meldungen.length}
                    >
                      {t('notify.clear')}
                    </button>
                    <button className="btn sm" onClick={() => setMeldungenOffen(false)}>✕</button>
                  </div>
                </div>
                {!sichtbareMeldungen.length ? (
                  <div className="notify-empty">{meldungen.length ? t('notify.noUnread') : t('notify.empty')}</div>
                ) : (
                  <div className="notify-list">
                    {sichtbareMeldungen.map(m => (
                      <div
                        key={m.id}
                        className={`notify-eintrag ${m.gelesen ? '' : 'neu'}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setMeldungenOffen(false)
                          window.location.hash = meldungsZiel(m)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setMeldungenOffen(false)
                            window.location.hash = meldungsZiel(m)
                          }
                        }}
                      >
                        <div className="notify-meta">
                          <span>{new Date(m.zeit).toLocaleString()}</span>
                        </div>
                        <div className="notify-titel">{m.titel}</div>
                        {m.text ? <div className="notify-text">{m.text}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="body">
          <aside className={`sidebar${sidebarKollabiert ? ' kollabiert' : ''}`}>
            <div className="nav-kopf">
              {!sidebarKollabiert ? (
                <input
                  type="text"
                  className="nav-suche"
                  placeholder={t('nav.search')}
                  value={navSuche}
                  onChange={e => setNavSuche(e.target.value)}
                  aria-label={t('nav.search')}
                />
              ) : null}
              <button
                className="nav-collapse"
                title={t(sidebarKollabiert ? 'nav.expand' : 'nav.collapse')}
                aria-label={t(sidebarKollabiert ? 'nav.expand' : 'nav.collapse')}
                onClick={() => setSidebarKollabiert(v => {
                  const neu = !v
                  try { localStorage.setItem('panel.sidebarCollapsed', neu ? '1' : '0') } catch (_) {}
                  return neu
                })}
              >
                {sidebarKollabiert ? '»' : '«'}
              </button>
            </div>

            <div className="nav-scroll">
              {favoritenSeiten.length ? (
                <div className="nav-gruppe">
                  <div className="nav-gruppe-titel">{t('nav.favorites')}</div>
                  {favoritenSeiten.map(item => navEintrag(item, true))}
                </div>
              ) : null}

              {navGruppen.map(gruppe => (
                <div className="nav-gruppe" key={gruppe.key}>
                  <div className="nav-gruppe-titel">{t(`nav.group.${gruppe.key}`)}</div>
                  {gruppe.items.map(item => navEintrag(item, false))}
                </div>
              ))}

              {navFilter && !navGruppen.length && !favoritenSeiten.length ? (
                <div className="nav-leer">{t('nav.noResults')}</div>
              ) : null}
            </div>

            {/*
              Das Markenzeichen gehoert sichtbar in die Leiste. Die Gruppen
              und die Suche sparen genug Hoehe, dass das Logo unten Platz
              hat - es wird nur etwas kleiner als in der alten Fassung.
            */}
            <div className="nav-brand">
              <img
                src="./logo-freak.png"
                alt="FrakItOut"
                onError={e => { e.currentTarget.closest('.nav-brand')?.remove() }}
              />
            </div>
          </aside>

          {/*
            Liegt als Geschwister nach der Leiste, nicht darin: deren
            overflow-y: auto wuerde den Kasten unten abschneiden.
          */}
          <MenueHinweis wert={hinweis} />
          <CommandPalette open={paletteOffen} onClose={() => setPaletteOffen(false)} pages={paletteSeiten} />

          <div className="main">
            <header className="topbar">
              <div>
                <h2>{titel[0]}</h2>
                <div className="sub">{titel[1]}</div>
              </div>
              <div className="status-chips">
                <span className="chip">
                  <span className={`dot ${world.running ? (world.phase === 'starting' ? 'starting' : 'on') : 'off'}`} />
                  {t('app.chips.world')}
                </span>
                <span className="chip">
                  <span className={`dot ${auth.running ? (auth.phase === 'starting' ? 'starting' : 'on') : 'off'}`} />
                  {t('app.chips.auth')}
                </span>
                <span className="chip">
                  <span className={`dot ${dbOk ? 'on' : 'off'}`} />
                  {t('app.chips.db')}
                </span>
              </div>
            </header>

            <main className="content">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/server" element={<ServerControl />} />
                <Route path="/realms" element={<Realms />} />
                <Route path="/characters" element={<Characters />} />
                <Route path="/guilds" element={<Guilds />} />
                <Route path="/characters/:guid" element={<CharacterDetail />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/bots" element={<Bots />} />
                <Route path="/rates" element={<Rates />} />
      <Route path="/modules" element={<Modules />} />
                <Route path="/bans" element={<Bans />} />
                <Route path="/online" element={<Online />} />
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/gm" element={<GmTools />} />
                <Route path="/console" element={<Console />} />
                <Route path="/config" element={<ConfigEditor />} />
                <Route path="/backup" element={<Backup />} />
                <Route path="/wirtschaft" element={<Wirtschaft />} />
                <Route path="/settings" element={<ConnectOptions />} />
                <Route path="/options" element={<Settings />} />
                <Route path="/protokoll" element={<Audit />} />
                <Route path="/werkzeuge" element={<Werkzeuge />} />
                <Route path="/hilfe" element={<Hilfe />} />
                <Route path="*" element={<div className="empty">{t('app.notFound')}</div>} />
              </Routes>
            </main>
          </div>
        </div>

        <footer className="statusbar">
          <label className="sb-lang" title={t('app.language.label')}>
            <span className="sb-lang-label">{t('app.language.label')}</span>
            <select
              className="sb-lang-select"
              value={lang}
              onChange={e => setLang(e.target.value)}
              aria-label={t('app.language.label')}
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <span className="sb-item">
            {t('app.status.emulator')}{' '}
            <span className={world.running ? 'sb-on' : 'sb-off'}>
              {world.running ? t('app.status.on') : t('app.status.off')}
            </span>
          </span>
          <span className="sb-item">
            {t('app.status.auth')}{' '}
            <span className={auth.running ? 'sb-on' : 'sb-off'}>
              {auth.running ? t('app.status.on') : t('app.status.off')}
            </span>
          </span>
          <span className="sb-item">
            {t('app.status.db')}{' '}
            <span className={dbOk ? 'sb-on' : 'sb-off'}>{dbOk ? t('app.status.on') : t('app.status.off')}</span>
          </span>
          {counts ? (
            <span className="sb-item">
              {t('app.status.accounts')} <span className="sb-on">{counts.accounts}</span> ·{' '}
              {t('app.status.characters')} <span className="sb-on">{counts.characters}</span> ·{' '}
              {t('app.status.online')} <span className="sb-on">{counts.online}</span>
            </span>
          ) : null}
          <span className="sb-note">
            {world.running && auth.running ? t('app.status.coreWarning') : t('app.status.ready')}
          </span>
        </footer>
      </div>

      <Toast items={toasts} />
    </StatusContext.Provider>
  )
}

export default App