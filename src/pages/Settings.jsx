import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

function Settings () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [cfg, setCfg] = useState(null)
  const [tests, setTests] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confList, setConfList] = useState(null)
  const [cfgPath, setCfgPath] = useState('')
  // MySQL-Port-Tool
  const [portNeu, setPortNeu] = useState('')
  const [portBestaetigt, setPortBestaetigt] = useState(false)
  // Reiter statt einer sehr langen Seite; die Auswahl bleibt erhalten.
  const [reiter, setReiter] = useState(() => {
    try { return localStorage.getItem('settings.tab') || 'verbindung' } catch (_) { return 'verbindung' }
  })
  const reiterWechseln = r => {
    setReiter(r)
    try { localStorage.setItem('settings.tab', r) } catch (_) {}
  }

  useEffect(() => {
    api.settings.get().then(setCfg).catch(e => toast(e.message, 'err'))
    api.settings.filePath().then(setCfgPath).catch(() => {})
  }, [])

  // Wird config.json von aussen geaendert, uebernimmt das Panel die Werte
  // sofort - ohne Neustart.
  useEffect(() => {
    if (!window.api || typeof window.api.on !== 'function') return undefined
    const abmelden = window.api.on('config:changed', neu => {
      setCfg(neu)
      toast(t('settings.externalChange'), 'ok')
    })
    return typeof abmelden === 'function' ? abmelden : undefined
  }, [t, toast])

  const reloadFile = async () => {
    try {
      setCfg(await api.settings.reload())
      setTests(null)
      toast(t('settings.fileReloaded'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const openFile = async () => {
    try {
      await api.settings.openFile()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /* Konfiguration exportieren/importieren (Umzug, Support) */
  const exportieren = async () => {
    try {
      const r = await api.system.configExport()
      if (r && r.ok) toast(t('settings.configExportOk', { pfad: r.pfad }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const importieren = async () => {
    try {
      const r = await api.system.configImport()
      if (r && r.ok) {
        toast(t('settings.configImportOk'), 'ok')
        setCfg(r.config)
      } else if (r && r.error) {
        toast(r.error, 'err')
      }
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /* Diagnosebericht: alles Wissenswerte in eine Datei (Passwörter maskiert) */
  const diagnose = async () => {
    try {
      const r = await api.system.diagnoseExport()
      if (r && r.ok) toast(t('settings.diagnoseOk', { pfad: r.pfad }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /* SOAP-Verbindung direkt pruefen (gehört zu den SOAP-Zugangsdaten) */
  const [soapBusy, setSoapBusy] = useState(false)
  const [soapErgebnis, setSoapErgebnis] = useState(null)

  const soapTest = async () => {
    setSoapBusy(true)
    setSoapErgebnis(null)
    try {
      const r = await api.settings.testSoap()
      const erste = String((r && r.antwort) || '').split('\n')[0].trim()
      setSoapErgebnis({ ok: true, text: erste || 'HTTP 200' })
    } catch (e) {
      setSoapErgebnis({ ok: false, text: e.message })
    } finally {
      setSoapBusy(false)
    }
  }

  if (!cfg) return <div className="spinner">{t('settings.loading')}</div>

  // Die Datei wird von Hand bearbeitet. Fehlt ein Abschnitt oder ist er
  // nicht sauber aufgebaut, darf die Seite nicht abstuerzen - dann laesst
  // sich die Datei gerade nicht mehr reparieren.
  const mysql = cfg.mysql && typeof cfg.mysql === 'object' ? cfg.mysql : {}
  const server = cfg.server && typeof cfg.server === 'object' ? cfg.server : {}
  const soap = cfg.soap && typeof cfg.soap === 'object' ? cfg.soap : {}
  const panel = cfg.panel && typeof cfg.panel === 'object' ? cfg.panel : {}
  const webhook = cfg.webhook && typeof cfg.webhook === 'object' ? cfg.webhook : {}
  const pfadOderLeer = wert => (typeof wert === 'string' ? wert : '')

  const set = (section, key, value) => {
    setCfg({ ...cfg, [section]: { ...cfg[section], [key]: value } })
  }

  // Ordner aus dem uebergeordneten Verzeichnis ableiten (Konfiguration liegt
  // bei AzerothCore direkt neben der Binary)
  const dirnameOf = p => {
    if (!p) return ''
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
    return i > 0 ? p.slice(0, i) : ''
  }

  const browseExe = async (key, confKey, label) => {
    try {
      const picked = await api.system.pickFile({
        title: t('settings.pickTitle', { label }),
        filters: [
          { name: t('settings.filterPrograms'), extensions: ['exe'] },
          { name: t('settings.filterAllFiles'), extensions: ['*'] }
        ],
        startDir: server[key] || server[confKey]
      })
      if (!picked) return
      setCfg(c => ({
        ...c,
        server: {
          ...c.server,
          [key]: picked,
          [confKey]: dirnameOf(picked)
        }
      }))
      toast(t('settings.labelSet', { label }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const MYSQL_CANDIDATES = [
      'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe',
      'C:\\xampp\\mysql\\bin\\mysqld.exe',
      'C:\\Program Files\\MariaDB 10.11\\bin\\mysqld.exe',
      'C:\\Program Files\\MariaDB 10.4\\bin\\mysqld.exe'
    ]

  // Serverwurzel per Explorer waehlen und alles daraus ableiten
  const browseRoot = async () => {
    try {
      const picked = await api.system.pickFolder({
        title: t('settings.pickRootTitle'),
        defaultPath: server.rootDir
      })
      if (!picked) return
      setCfg(c => ({ ...c, server: { ...c.server, rootDir: picked } }))
      toast(t('settings.rootSet'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const detectAndApply = async () => {
    const dir = server.rootDir
    if (!dir) {
      toast(t('settings.pickRootFirst'), 'info')
      return
    }
    setBusy(true)
    try {
      const r = await api.system.detectRepack(dir)
      if (!r.ok) {
        toast(r.error || t('settings.nothingFound'), 'err')
        return
      }

      setCfg(c => ({
        ...c,
        server: {
          ...c.server,
          rootDir: dir,
          worldExe: r.server.worldExe || c.server.worldExe,
          authExe: r.server.authExe || c.server.authExe,
          worldConfDir: r.server.worldConfDir || c.server.worldConfDir,
          authConfDir: r.server.authConfDir || c.server.authConfDir,
          workDir: r.server.workDir || c.server.workDir,
          mysqlServer: {
            ...(c.server.mysqlServer || {}),
            exe: r.mysqlServer.exe || (c.server.mysqlServer || {}).exe,
            dataDir: r.mysqlServer.dataDir || (c.server.mysqlServer || {}).dataDir,
            extraArgs: r.mysqlServer.extraArgs || ''
          }
        },
        // Datenbankdaten aus der worldserver.conf uebernehmen
        mysql: r.mysql
          ? {
              ...c.mysql,
              host: r.mysql.host || c.mysql.host,
              port: r.mysql.port || c.mysql.port,
              user: r.mysql.user || c.mysql.user,
              password: r.mysql.password || c.mysql.password,
              authDb: r.mysql.authDb || c.mysql.authDb,
              charDb: r.mysql.charDb || c.mysql.charDb,
              worldDb: r.mysql.worldDb || c.mysql.worldDb
            }
          : c.mysql
      }))

      toast(
        t('settings.layoutDetected', {
          layout: r.layout === 'repack' ? 'Repack' : t('settings.layoutStandard')
        }),
        'ok'
      )
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // mysqld.exe über Explorer wählen
  const browseMysql = async () => {
    try {
      const picked = await api.system.pickFile({
        title: t('settings.pickMysqldTitle'),
        filters: [
          { name: t('settings.filterPrograms'), extensions: ['exe'] },
          { name: t('settings.filterAllFiles'), extensions: ['*'] }
        ]
      })
      if (!picked) return
      setCfg(c => ({
        ...c,
        server: {
          ...c.server,
          mysqlServer: {
            ...(c.server.mysqlServer || {}),
            exe: picked,
            dataDir: dirnameOf(picked)
          }
        }
      }))
      toast(t('settings.mysqldSet'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const detectMysql = async () => {
    try {
      const res = await api.system.checkPaths(MYSQL_CANDIDATES)
      const hit = MYSQL_CANDIDATES.find(c => res[c] && res[c].exists)
      if (!hit) {
        toast(t('settings.mysqldNotFound'), 'info')
        return
      }
      setCfg(c => ({
        ...c,
        server: {
          ...c.server,
          mysqlServer: { ...(c.server.mysqlServer || {}), exe: hit, dataDir: dirnameOf(hit) }
        }
      }))
      toast(t('settings.found', { path: hit }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  // Datenverzeichnis (--datadir) der mysqld.exe waehlen
  const browseMysqlDataDir = async () => {
    try {
      const picked = await api.system.pickFolder({
        title: t('settings.pickDataDirTitle'),
        defaultPath: server.mysqlServer?.dataDir
      })
      if (!picked) return
      setCfg(c => ({
        ...c,
        server: {
          ...c.server,
          mysqlServer: { ...(c.server.mysqlServer || {}), dataDir: picked }
        }
      }))
      toast(t('settings.dataDirSet'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const browseDir = async (key, label) => {
    try {
      const picked = await api.system.pickFolder({
        title: t('settings.pickTitle', { label }),
        defaultPath: server[key]
      })
      if (!picked) return
      set('server', key, picked)
      toast(t('settings.labelSet', { label }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.settings.save(cfg)
      toast(t('settings.saved'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // Ordnerinhalt anzeigen, damit man sieht, ob die conf-Dateien dort liegen
  const showConfList = async () => {
    try {
      const dir = server.worldConfDir || ''
      const files = await api.system.listConf(dir)
      setConfList(files)
      if (!files.length) toast(t('settings.noConfFiles', { dir }), 'info')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  // Haeufige Installationsorte durchsuchen
  const autoDetect = async () => {
    const guesses = [
      'C:\\AzerothCore\\bin\\worldserver\\worldserver.exe',
      'C:\\Program Files\\AzerothCore\\bin\\worldserver\\worldserver.exe',
      `${process.env.SystemDrive || 'C'}\\AzerothCore\\bin\\worldserver\\worldserver.exe`
    ]
    try {
      const res = await api.system.checkPaths(guesses)
      const hit = guesses.find(g => res[g] && res[g].exists)
      if (!hit) {
        toast(t('settings.pathsNotFound'), 'info')
        return
      }
      setCfg(c => ({
        ...c,
        server: { ...c.server, worldExe: hit, worldConfDir: dirnameOf(hit) }
      }))
      toast(t('settings.worldserverFound', { path: hit }), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const testAll = async () => {
    setBusy(true)
    try {
      const res = await api.settings.testAll()
      setTests(res)
      const ok = Object.values(res).every(r => r.ok)
      toast(ok ? t('settings.allDbOk') : t('settings.someDbDown'), ok ? 'ok' : 'err')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="tabs">
        {[
          { key: 'verbindung', label: t('settings.tabConnection') },
          { key: 'pfade', label: t('settings.tabPaths') },
          { key: 'verhalten', label: t('settings.tabBehavior') },
          { key: 'wartung', label: t('settings.tabMaintenance') }
        ].map(r => (
          <button
            key={r.key}
            className={`tab ${reiter === r.key ? 'active' : ''}`}
            onClick={() => reiterWechseln(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="card" hidden={reiter !== 'verhalten'}>
        <div className="card-head"><h3>{t('settings.configFileTitle')}</h3></div>
        <div className="card-body">
          <div className="info-box mb0">
            {t('settings.configFileHint')}
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
            <code className="mono flex-1" style={{ wordBreak: 'break-all' }}>
              {cfgPath || '…'}
            </code>
            <button className="btn sm" onClick={openFile}>{t('settings.openFile')}</button>
            <button className="btn sm" onClick={reloadFile}>{t('settings.reloadFile')}</button>
            <button className="btn sm" onClick={() => window.dispatchEvent(new Event('panel:setup'))}>
              {t('setup.openWizard')}
            </button>
            <button className="btn sm" onClick={exportieren}>{t('settings.configExport')}</button>
            <button className="btn sm" onClick={importieren}>{t('settings.configImport')}</button>
            <button className="btn sm" onClick={diagnose}>{t('settings.diagnoseBtn')}</button>
          </div>
        </div>
      </div>

      {/*
        * Tray, Windows-Autostart und Benachrichtigungen gehoeren zusammen:
        * der Tray haelt das Panel am Leben (wichtig fuer die Nachts-Wartung),
        * der Autostart sorgt dafuer, dass es nach dem Login wieder da ist.
        */}
      <div className="card" hidden={reiter !== 'verhalten'}>
        <div className="card-head"><h3>{t('settings.panelTitle')}</h3></div>
        <div className="card-body">
          <label className="check-row">
            <input type="checkbox" checked={!!panel.inTray} onChange={e => { set('panel', 'inTray', e.target.checked); api.settings.save({ panel: { inTray: e.target.checked } }).catch(() => {}) }} />
            <span>
              {t('settings.panelTray')}
              <span className="hint-line">{t('settings.panelTrayHint')}</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={!!panel.autostart} onChange={e => { set('panel', 'autostart', e.target.checked); api.settings.save({ panel: { autostart: e.target.checked } }).catch(() => {}) }} />
            <span>
              {t('settings.panelAutostart')}
              <span className="hint-line">{t('settings.panelAutostartHint')}</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={panel.meldungen !== false} onChange={e => { set('panel', 'meldungen', e.target.checked); api.settings.save({ panel: { meldungen: e.target.checked } }).catch(() => {}) }} />
            <span>
              {t('settings.panelMeldungen')}
              <span className="hint-line">{t('settings.panelMeldungenHint')}</span>
            </span>
          </label>
          <div className="inline" style={{ marginTop: 8 }}>
            <button
              className="btn sm"
              onClick={() => api.notify.test().then(() => toast(t('settings.notifyTestOk'), 'ok')).catch(e => toast(e.message, 'err'))}
            >
              {t('settings.notifyTest')}
            </button>
            <span className="hint">{t('settings.notifyTestHint')}</span>
          </div>
        </div>
      </div>

      {/*
        * Discord-Webhook: dieselben Ereignisse wie die Desktop-Meldungen,
        * aber in einen Kanal, den die Freunde lesen. URL setzen, testen, fertig.
        */}
      <div className="card" hidden={reiter !== 'verhalten'}>
        <div className="card-head"><h3>{t('settings.webhookTitle')}</h3></div>
        <div className="card-body">
          <div className="field">
            <label>{t('settings.webhookUrl')}</label>
            <input
              type="text"
              className="mono"
              placeholder="https://discord.com/api/webhooks/..."
              value={webhook.url || ''}
              onChange={e => set('webhook', 'url', e.target.value)}
            />
          </div>
          <div className="inline mb0">
            <button
              className="btn"
              onClick={() => api.settings.save({ webhook: { url: webhook.url || '', aktiv: true } }).then(() => toast(t('settings.webhookGespeichert'), 'ok')).catch(e => toast(e.message, 'err'))}
              disabled={!webhook.url || !String(webhook.url).startsWith('https://')}
            >
              {t('common.save')}
            </button>
            <button
              className="btn"
              disabled={!webhook.url || !String(webhook.url).startsWith('https://')}
              onClick={() => api.webhook.testen().then(() => toast(t('settings.webhookTestOk'), 'ok')).catch(e => toast(e.message, 'err'))}
            >
              {t('settings.webhookTest')}
            </button>
          </div>
          <div className="hint">{t('settings.webhookHint')}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card" hidden={reiter !== 'verbindung'}>
          <div className="card-head"><h3>{t('settings.mysqlTitle')}</h3></div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label>{t('settings.host')}</label>
                <input type="text" value={mysql.host} onChange={e => set('mysql', 'host', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('settings.port')}</label>
                <input type="number" value={mysql.port} onChange={e => set('mysql', 'port', Number(e.target.value))} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>{t('settings.user')}</label>
                <input type="text" value={mysql.user} onChange={e => set('mysql', 'user', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('settings.password')}</label>
                <input type="password" value={mysql.password} onChange={e => set('mysql', 'password', e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>{t('settings.authDb')}</label>
                <input type="text" value={mysql.authDb} onChange={e => set('mysql', 'authDb', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('settings.charDb')}</label>
                <input type="text" value={mysql.charDb} onChange={e => set('mysql', 'charDb', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('settings.worldDb')}</label>
                <input type="text" value={mysql.worldDb} onChange={e => set('mysql', 'worldDb', e.target.value)} />
              </div>
            </div>
            <div className="info-box mb0">
              {t('settings.dbDefaults1')} <span className="mono">ac_auth</span>,{' '}
              <span className="mono">ac_characters</span>, <span className="mono">ac_world</span>.
            </div>
            {/*
              * Port-Tool: Der Port steckt in fünf Stellen (my.ini, drei .conf,
              * Panel-Konfiguration). Von Hand aenderbar, aber fehleranfällig -
              * der Knopf macht alle Stellen auf einmal mit .bak-Backup.
              */}
            <div style={{ marginTop: 10, borderTop: '1px solid #444', paddingTop: 8 }}>
              <div className="inline mb0">
                <div className="field" style={{ width: 120, margin: 0 }}>
                  <label>{t('settings.portNeuLabel')}</label>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={portNeu}
                    onChange={e => setPortNeu(e.target.value)}
                  />
                </div>
                <button
                  className="btn"
                  disabled={busy || !portNeu || Number(portNeu) === Number(mysql.port)}
                  onClick={() => setPortBestaetigt(true)}
                >
                  {t('settings.portAendernBtn')}
                </button>
              </div>
              {portBestaetigt ? (
                <div className="mt">
                  <div className="error-box">{t('settings.portAendernWarn')}</div>
                  <div className="inline">
                    <button
                      className="btn danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          const r = await api.installer.mysqlPortAendern({ neuerPort: Number(portNeu) })
                          toast(t('settings.portAendernOk', { alt: r.vorher, neu: r.port }), 'ok')
                          setCfg(await api.settings.get())
                          setPortBestaetigt(false)
                        } catch (e) {
                          toast(e.message, 'err')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      {t('backup.fremdJa')}
                    </button>
                    <button className="btn" onClick={() => setPortBestaetigt(false)}>{t('backup.abort')}</button>
                  </div>
                </div>
              ) : null}
              <div className="hint mt">{t('settings.portAendernHint')}</div>
            </div>
          </div>
        </div>

        <div className="card" hidden={reiter !== 'pfade'}>
          <div className="card-head">
            <h3>{t('settings.rootTitle')}</h3>
          </div>
          <div className="card-body">
            <div className="field">
              <label>{t('settings.rootLabel')}</label>
              <div className="inline">
                <input
                  type="text"
                  className="mono flex-1"
                  value={server.rootDir || ''}
                  placeholder={t('settings.rootPlaceholder')}
                  onChange={e =>
                    setCfg(c => ({ ...c, server: { ...c.server, rootDir: e.target.value } }))
                  }
                />
                <button className="btn" disabled={busy} onClick={browseRoot}>{t('settings.folderBtn')}</button>
                <button className="btn primary" disabled={busy} onClick={detectAndApply}>
                  {t('settings.detectApply')}
                </button>
              </div>
              <div className="hint">
                {t('settings.rootHint')}
              </div>
            </div>

            <div className="info-box mb0">
              <strong>{t('settings.whyTitle')}</strong> {t('settings.why1')}{' '}
              <span className="mono">configs\</span>{t('settings.why2')}
              <span className="mono">DataDir = "Daten"</span>{t('settings.why3')}{' '}
              <em>{t('settings.rootWord')}</em> {t('settings.why4')}
            </div>
          </div>
        </div>

        <div className="card" hidden={reiter !== 'pfade'}>
          <div className="card-head">
            <h3>{t('settings.workDirTitle')}</h3>
          </div>
          <div className="card-body">
            <div className="field">
              <label>{t('settings.workDirLabel')}</label>
              <div className="inline">
                <input
                  type="text"
                  className="mono flex-1"
                  value={server.workDir || ''}
                  placeholder={t('settings.workDirPlaceholder')}
                  onChange={e =>
                    setCfg(c => ({ ...c, server: { ...c.server, workDir: e.target.value } }))
                  }
                />
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => browseDir('workDir', t('settings.workDirName'))}
                >
                  {t('settings.folderBtn')}
                </button>
              </div>
              <div className="hint">
                {t('settings.workDirHint')}
              </div>
            </div>
          </div>
        </div>

        <div className="card" hidden={reiter !== 'pfade'}>
          <div className="card-head">
            <h3>{t('settings.pathsTitle')}</h3>
            <button className="btn sm" disabled={busy} onClick={autoDetect}>
              {t('settings.autoSearchPaths')}
            </button>
          </div>
          <div className="card-body">
            <div className="field">
              <label>{t('settings.worldExeLabel')}</label>
              <div className="inline">
                <input
                  type="text"
                  className="mono flex-1"
                  value={server.worldExe}
                  onChange={e => set('server', 'worldExe', e.target.value)}
                />
                <button className="btn" disabled={busy} onClick={() => browseExe('worldExe', 'worldConfDir', 'Worldserver')}>
                  {t('settings.fileBtn')}
                </button>
                <button className="btn" disabled={busy} onClick={() => browseDir('worldConfDir', t('settings.worldConfFolder'))}>
                  {t('settings.folderBtn')}
                </button>
              </div>
              <div className="hint">
                {t('settings.worldExeHint')}
              </div>
            </div>

            <div className="field">
              <label>{t('settings.authExeLabel')}</label>
              <div className="inline">
                <input
                  type="text"
                  className="mono flex-1"
                  value={server.authExe}
                  onChange={e => set('server', 'authExe', e.target.value)}
                />
                <button className="btn" disabled={busy} onClick={() => browseExe('authExe', 'authConfDir', 'Authserver')}>
                  {t('settings.fileBtn')}
                </button>
                <button className="btn" disabled={busy} onClick={() => browseDir('authConfDir', t('settings.authConfFolder'))}>
                  {t('settings.folderBtn')}
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t('settings.worldConfDirLabel')}</label>
              <div className="inline">
                <input type="text" className="mono flex-1" value={server.worldConfDir} onChange={e => set('server', 'worldConfDir', e.target.value)} />
                <button className="btn" disabled={busy} onClick={() => browseDir('worldConfDir', t('settings.worldConfFolder'))}>
                  {t('settings.folderBtn')}
                </button>
                <button className="btn sm" disabled={busy} onClick={showConfList} title={t('settings.showContentsTitle')}>
                  {t('settings.contents')}
                </button>
              </div>
              <div className="hint">{t('settings.confDirHint')}</div>
            </div>

            <div className="field">
              <label>{t('settings.authConfDirLabel')}</label>
              <div className="inline">
                <input type="text" className="mono flex-1" value={server.authConfDir} onChange={e => set('server', 'authConfDir', e.target.value)} />
                <button className="btn" disabled={busy} onClick={() => browseDir('authConfDir', t('settings.authConfFolder'))}>
                  {t('settings.folderBtn')}
                </button>
                <button className="btn sm" disabled={busy} onClick={showConfList} title={t('settings.showContentsTitle')}>
                  {t('settings.contents')}
                </button>
              </div>
            </div>

            <div className="field">
              <label>{t('settings.mysqlServerLabel')}</label>
              <div className="inline">
                <input
                  type="text"
                  className="mono flex-1"
                  value={server.mysqlServer?.exe || ''}
                  placeholder="C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe"
                  onChange={e =>
                    setCfg(c => ({
                      ...c,
                      server: {
                        ...c.server,
                        mysqlServer: { ...(c.server.mysqlServer || {}), exe: e.target.value }
                      }
                    }))
                  }
                />
                <button className="btn" disabled={busy} onClick={browseMysql}>{t('settings.fileBtn')}</button>
                <button className="btn" disabled={busy} onClick={() => browseMysqlDataDir()}>{t('settings.folderBtn')}</button>
                <button className="btn sm" disabled={busy} onClick={detectMysql}>{t('settings.searchBtn')}</button>
              </div>
              <div className="hint">
                {t('settings.mysqlServerHint')}
              </div>
            </div>

            <div className="field">
              <label>{t('settings.extraArgsLabel')}</label>
              <input
                type="text"
                className="mono"
                value={server.mysqlServer?.extraArgs || ''}
                placeholder="--standalone --console"
                onChange={e =>
                  setCfg(c => ({
                    ...c,
                    server: {
                      ...c.server,
                      mysqlServer: {
                        ...(c.server.mysqlServer || {}),
                        extraArgs: e.target.value
                      }
                    }
                  }))
                }
              />
              <div className="hint">
                <span className="mono">--standalone</span> {t('settings.argsHint1')}{' '}
                <span className="mono">--console</span> {t('settings.argsHint2')}
              </div>
            </div>

            {confList ? (
              <div className="info-box">
                <strong>{t('settings.confFilesFound')}</strong>
                <div className="mono" style={{ marginTop: 6 }}>
                  {confList.length ? confList.join('\n') : t('settings.noConfFilesList')}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card" hidden={reiter !== 'verbindung'}>
        <div className="card-head"><h3>{t('settings.soapTitle')}</h3></div>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>{t('settings.host')}</label>
              <input type="text" value={soap.host} onChange={e => set('soap', 'host', e.target.value)} />
            </div>
            <div className="field">
              <label>{t('settings.port')}</label>
              <input type="number" value={soap.port} onChange={e => set('soap', 'port', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>{t('settings.user')}</label>
              <input type="text" value={soap.user} onChange={e => set('soap', 'user', e.target.value)} />
            </div>
            <div className="field">
              <label>{t('settings.password')}</label>
              <input type="password" value={soap.password} onChange={e => set('soap', 'password', e.target.value)} />
            </div>
          </div>
          <div className="info-box mb0">
            {t('settings.soapHint1')} <span className="mono">SOAP.Enabled</span>,{' '}
            <span className="mono">SOAP.IP</span> {t('settings.and')}{' '}
            <span className="mono">SOAP.Port</span> {t('settings.soapHint2')}
          </div>
          <div className="inline mt">
            <button className="btn" onClick={soapTest} disabled={soapBusy}>
              {soapBusy ? t('settings.soapTesting') : t('settings.soapTest')}
            </button>
            {soapErgebnis ? (
              <span className={soapErgebnis.ok ? 'green' : 'red'} style={{ wordBreak: 'break-all' }}>
                {soapErgebnis.ok ? '✓ ' : '✕ '}{soapErgebnis.text}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {tests ? (
        <div className="card" hidden={reiter !== 'verbindung'}>
          <div className="card-head"><h3>{t('settings.connectionTest')}</h3></div>
          <div className="card-body">
            {Object.entries(tests).map(([k, v]) => (
              <div key={k} className={v.ok ? 'ok-box' : 'error-box'} style={{ marginBottom: 8 }}>
                <strong>{k}</strong>: {v.ok ? t('settings.connected') : v.error}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="inline">
        <button className="btn primary" disabled={busy} onClick={save}>{t('settings.save')}</button>
        <button className="btn" disabled={busy} onClick={testAll}>{t('settings.testConnection')}</button>
      </div>

      <div hidden={reiter !== 'wartung'}>
        <ProfileKarte />
        <WartungsKarte />
        <ProtokollKarte />
      </div>

      {/* Der Pfad kommt vom Backend. Fest eingetragen waere das eine
          Luege: das Panel legt die Datei neben die EXE, weicht aber auf
          %APPDATA% aus, wenn der Desktop gerade nicht beschreibbar ist. */}
      <div className="info-box mt" hidden={reiter !== 'wartung'}>
        {t('settings.infoCfg1')} <span className="mono">config.json</span> {t('settings.infoCfg2')}{' '}
        <span className="mono">{cfgPath || '%APPDATA%\\wowpanel'}</span>{t('settings.infoCfg3')}
      </div>
    </>
  )
}

export default Settings

/* ================================================================== */
/* Serverprofile                                                      */
/* ================================================================== */

function ProfileKarte () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [liste, setListe] = useState([])
  const [aktiv, setAktiv] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Bestätigung vor dem Wechsel: Er stoppt laufende Server - ein Versehen
  // soll nicht den laufenden Betrieb kosten.
  const [wechselFrage, setWechselFrage] = useState(null)
  const [loeschFrage, setLoeschFrage] = useState(null)

  const laden = async () => {
    try {
      const r = await api.profile.list()
      setListe(r.liste || [])
      setAktiv(r.aktiv || '')
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  React.useEffect(() => { laden() }, [])

  const speichern = async () => {
    if (!name.trim()) { toast(t('settings.profilNameNoetig'), 'err'); return }
    setBusy(true)
    try {
      const r = await api.profile.speichern(name.trim())
      toast(t('settings.profilGespeichert', { name: r.name }), 'ok')
      setName('')
      laden()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const aktivieren = async name2 => {
    setWechselFrage(null)
    setBusy(true)
    try {
      await api.profile.aktivieren(name2)
      toast(t('settings.profilAktiv', { name: name2 }), 'ok')
      laden()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const loeschen = async name2 => {
    setLoeschFrage(null)
    setBusy(true)
    try {
      await api.profile.loeschen(name2)
      laden()
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>{t('settings.profilTitle')}</h3></div>
      <div className="card-body">
        <p style={{ marginTop: 0 }}>{t('settings.profilIntro')}</p>
        <div className="inline mb0">
          <input
            style={{ maxWidth: 220 }}
            placeholder={t('settings.profilNamePlatz')}
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button className="btn" onClick={speichern} disabled={busy}>{t('settings.profilSpeichern')}</button>
        </div>
        {wechselFrage ? (
          <div className="mt">
            <div className="error-box">
              {t('settings.profilAktivWarn', { name: wechselFrage })}
            </div>
            <div className="inline">
              <button className="btn danger" onClick={() => aktivieren(wechselFrage)} disabled={busy}>
                {t('backup.fremdJa')}
              </button>
              <button className="btn" onClick={() => setWechselFrage(null)}>{t('backup.abort')}</button>
            </div>
          </div>
        ) : null}
        {loeschFrage ? (
          <div className="mt">
            <div className="error-box">{t('settings.profilLoeschWarn', { name: loeschFrage })}</div>
            <div className="inline">
              <button className="btn danger" onClick={() => loeschen(loeschFrage)} disabled={busy}>
                {t('backup.fremdJa')}
              </button>
              <button className="btn" onClick={() => setLoeschFrage(null)}>{t('backup.abort')}</button>
            </div>
          </div>
        ) : null}
        {liste.length ? (
          <table>
            <tbody>
              {liste.map(p => (
                <tr key={p.name}>
                  <td className={p.name === aktiv ? '' : 'muted'} style={{ fontWeight: p.name === aktiv ? 700 : 400 }}>
                    {p.name}{p.name === aktiv ? ` (${t('settings.profilAktivLabel')})` : ''}
                  </td>
                  <td className="muted">{(p.daten.server || {}).rootDir || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {p.name !== aktiv ? (
                      <button className="btn sm" onClick={() => setWechselFrage(p.name)} disabled={busy}>
                        {t('settings.profilAktivieren')}
                      </button>
                    ) : null}
                    <button
                      className="btn sm"
                      onClick={() => setLoeschFrage(p.name)}
                      disabled={busy}
                      title={t('settings.profilLoeschen')}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted mt">{t('settings.profilLeer')}</div>
        )}
        <div className="hint mt">{t('settings.profilHint')}</div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Nachts-Wartung                                                     */
/* ================================================================== */

function WartungsKarte () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(false)
  const [stunde, setStunde] = useState(3)
  const [minute, setMinute] = useState(0)
  // 0 = täglich, 1..7 = Mo..So
  const [wochentag, setWochentag] = useState(0)
  const [nurBeiLeer, setNurBeiLeer] = useState(false)
  const [botPraefixe, setBotPraefixe] = useState('rndbot, ahbot, playerbots')
  const [restartAktiv, setRestartAktiv] = useState(false)
  const [restartStunde, setRestartStunde] = useState(6)
  const [restartMinute, setRestartMinute] = useState(0)
  const [restartVorwarn, setRestartVorwarn] = useState(60)
  // Speicherhygiene: Neustart über RAM-Schwelle (0 = aus)
  const [restartRam, setRestartRam] = useState(0)
  const [letzterRestart, setLetzterRestart] = useState(null)
  const [dbAktiv, setDbAktiv] = useState(false)
  const [dbWochentag, setDbWochentag] = useState(7)
  const [dbStunde, setDbStunde] = useState(4)
  const [dbMinute, setDbMinute] = useState(30)
  const [dbModus, setDbModus] = useState('analyze')
  const [dbCheck, setDbCheck] = useState(false)
  const [letzteDbWartung, setLetzteDbWartung] = useState(null)
  const [letzteDbPruefung, setLetzteDbPruefung] = useState(null)
  const [banCleanup, setBanCleanup] = useState(false)
  const [banStunde, setBanStunde] = useState(5)
  const [banMinute, setBanMinute] = useState(0)
  const [banNurMelden, setBanNurMelden] = useState(false)
  const [letzteBanReinigung, setLetzteBanReinigung] = useState(null)
  const [pruefBusy, setPruefBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lauf, setLauf] = useState(null)
  const [letzterLauf, setLetzterLauf] = useState(null)
  const [praefixTest, setPraefixTest] = useState(null)

  React.useEffect(() => {
    api.maintenance.get().then(p => {
      setEnabled(!!p.enabled)
      setStunde(p.stunde)
      setMinute(p.minute)
      setWochentag(p.wochentag || 0)
      setNurBeiLeer(!!p.nurBeiLeer)
      setBotPraefixe(p.botKontoPraefixe || 'rndbot, ahbot, playerbots')
      setRestartAktiv(!!p.restartAktiv)
      setRestartStunde(p.restartStunde)
      setRestartMinute(p.restartMinute)
      setRestartVorwarn(p.restartVorwarnSek)
      setRestartRam(p.restartRamMb || 0)
      setLetzterRestart(p.letzterRestart || null)
      setLetzterLauf(p.letzterLauf || null)
      setDbAktiv(!!p.dbAktiv)
      setDbWochentag(p.dbWochentag == null ? 7 : p.dbWochentag)
      setDbStunde(p.dbStunde == null ? 4 : p.dbStunde)
      setDbMinute(p.dbMinute == null ? 30 : p.dbMinute)
      setDbModus(p.dbModus || 'analyze')
      setDbCheck(!!p.dbCheck)
      setLetzteDbWartung(p.letzteDbWartung || null)
      setLetzteDbPruefung(p.letzteDbPruefung || null)
      setBanCleanup(!!p.banCleanup)
      setBanStunde(p.banCleanupStunde == null ? 5 : p.banCleanupStunde)
      setBanMinute(p.banCleanupMinute == null ? 0 : p.banCleanupMinute)
      setBanNurMelden(!!p.banCleanupNurMelden)
      setLetzteBanReinigung(p.letzteBanReinigung || null)
    }).catch(() => {})
    if (window.api && typeof window.api.on === 'function') {
      return window.api.on('maintenance:progress', ev => setLauf(ev.meldung || ''))
    }
    return undefined
  }, [])

  const basis = () => ({
    enabled,
    stunde: Number(stunde) || 3,
    minute: Number(minute) || 0,
    wochentag: Number(wochentag) || 0,
    nurBeiLeer,
    warteMinuten: 15,
    botKontoPraefixe: botPraefixe,
    restartAktiv,
    restartStunde: Number(restartStunde) || 6,
    restartMinute: Number(restartMinute) || 0,
    restartVorwarnSek: Number(restartVorwarn) || 60,
    restartRamMb: Number(restartRam) || 0,
    dbAktiv,
    dbWochentag: Number(dbWochentag) || 0,
    dbStunde: Number(dbStunde) || 0,
    dbMinute: Number(dbMinute) || 0,
    dbModus,
    dbCheck,
    banCleanup,
    banCleanupStunde: Number(banStunde) || 0,
    banCleanupMinute: Number(banMinute) || 0,
    banCleanupNurMelden: banNurMelden
  })

  const speichern = async (neuEnabled) => {
    setBusy(true)
    try {
      const patch = basis()
      patch.enabled = !!neuEnabled
      const r = await api.maintenance.save(patch)
      setEnabled(!!neuEnabled)
      toast(
        neuEnabled
          ? t('settings.wartungAn', { zeit: `${String(r.plan.stunde).padStart(2, '0')}:${String(r.plan.minute).padStart(2, '0')}` })
          : t('settings.wartungAus'),
        'ok'
      )
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const restartSpeichern = async (neuAktiv) => {
    setBusy(true)
    try {
      const patch = basis()
      patch.restartAktiv = !!neuAktiv
      const r = await api.maintenance.save(patch)
      setRestartAktiv(!!neuAktiv)
      toast(
        neuAktiv
          ? t('settings.restartAn', { zeit: `${String(r.plan.restartStunde).padStart(2, '0')}:${String(r.plan.restartMinute).padStart(2, '0')}` })
          : t('settings.restartAus'),
        'ok'
      )
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const dbSpeichern = async patch => {
    setBusy(true)
    try {
      await api.maintenance.save({ ...basis(), ...patch })
      toast(t('settings.dbWartungGespeichert'), 'ok')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const jetztLaufen = async () => {
    setBusy(true)
    try {
      const r = await api.maintenance.runNow()
      toast(r.ok ? t('settings.wartungFertig') : t('settings.wartungFehler', { fehler: r.error || '' }), r.ok ? 'ok' : 'err')
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const pruefungStarten = async () => {
    setPruefBusy(true)
    try {
      const r = await api.maintenance.dbPruefenJetzt()
      setLetzteDbPruefung({
        zeit: new Date().toISOString(),
        ok: r.ok === true,
        geprueft: r.geprueft || 0,
        auffaellig: r.auffaellig || [],
        meldung: r.error || ''
      })
      toast(
        r.ok
          ? t('settings.dbPruefungOk', { n: r.geprueft || 0 })
          : t('settings.dbPruefungAuffaellig', { n: (r.auffaellig || []).length || 1 }),
        r.ok ? 'ok' : 'err'
      )
    } catch (e) {
      toast(e.message, 'err')
    } finally {
      setPruefBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>{t('settings.wartungTitle')}</h3></div>
      <div className="card-body">
        <p style={{ marginTop: 0 }}>{t('settings.wartungIntro')}</p>
        <div className="inline mb0">
          <label className="check-row" style={{ marginRight: 16 }}>
            <input type="checkbox" checked={enabled} onChange={e => speichern(e.target.checked)} disabled={busy} />
            {t('settings.wartungAktiv')}
          </label>
          <div className="field" style={{ width: 110, margin: 0 }}>
            <label>{t('settings.wartungUhr')}</label>
            <div className="inline mb0">
              <input
                type="number" min="0" max="23" value={stunde}
                onChange={e => setStunde(e.target.value)}
                onBlur={() => api.maintenance.save({ ...basis() }).catch(() => {})}
                style={{ width: 60 }}
              />
              <span className="muted">:</span>
              <input
                type="number" min="0" max="59" value={minute}
                onChange={e => setMinute(e.target.value)}
                onBlur={() => api.maintenance.save({ ...basis() }).catch(() => {})}
                style={{ width: 60 }}
              />
            </div>
          </div>
          <div className="field" style={{ width: 150, margin: 0 }}>
            <label>{t('settings.wochentag')}</label>
            <select
              value={wochentag}
              onChange={e => {
                const v = Number(e.target.value)
                setWochentag(v)
                api.maintenance.save({ ...basis(), wochentag: v }).catch(() => {})
              }}
              style={{ width: 130 }}
            >
              <option value={0}>{t('settings.wtTgl')}</option>
              <option value={1}>{t('settings.wt1')}</option>
              <option value={2}>{t('settings.wt2')}</option>
              <option value={3}>{t('settings.wt3')}</option>
              <option value={4}>{t('settings.wt4')}</option>
              <option value={5}>{t('settings.wt5')}</option>
              <option value={6}>{t('settings.wt6')}</option>
              <option value={7}>{t('settings.wt7')}</option>
            </select>
          </div>
          <button className="btn" onClick={jetztLaufen} disabled={busy}>{t('settings.wartungJetzt')}</button>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={nurBeiLeer}
            onChange={e => { setNurBeiLeer(e.target.checked); api.maintenance.save({ ...basis(), nurBeiLeer: e.target.checked }).then(() => toast(t('settings.wartungNurLeerGespeichert'), 'ok')).catch(err => toast(err.message, 'err')) }}
            disabled={busy}
          />
          <span>
            {t('settings.wartungNurLeer')}
            <span className="hint-line">{t('settings.wartungNurLeerHint')}</span>
          </span>
        </label>
        <div className="field" style={{ maxWidth: 340 }}>
          <label>{t('settings.wartungBotPraefixe')}</label>
          <div className="inline" style={{ gap: 8 }}>
            <input
              type="text"
              value={botPraefixe}
              onChange={e => setBotPraefixe(e.target.value)}
              onBlur={() => api.maintenance.save({ ...basis(), botKontoPraefixe: botPraefixe }).then(() => toast(t('settings.wartungBotPraefixeGespeichert'), 'ok')).catch(err => toast(err.message, 'err'))}
              style={{ flex: 1 }}
            />
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  const r = await api.accounts.botPraefixTest()
                  setPraefixTest(r)
                } catch (e) {
                  toast(e.message, 'err')
                }
              }}
            >
              {t('settings.wartungPraefixTest')}
            </button>
          </div>
          <div className="hint">{t('settings.wartungBotPraefixeHint')}</div>
          {praefixTest ? (
            <div className={praefixTest.anzahl > 0 ? 'info-box mt' : 'error-box mt'} style={{ fontSize: 12 }}>
              {praefixTest.anzahl > 0
                ? t('settings.wartungPraefixOk', {
                  n: praefixTest.anzahl,
                  gesamt: praefixTest.gesamt,
                  beispiele: praefixTest.beispiele.join(', ')
                })
                : t('settings.wartungPraefixKeine', { praefixe: praefixTest.praefixe.join(', ') })}
            </div>
          ) : null}
        </div>
        <div className="hint">{t('settings.wartungHinweis')}</div>
        {letzterLauf ? (
          <div className={`info-box mt ${letzterLauf.ok ? '' : 'error-box'}`}>
            {t('settings.letzterLauf', {
              zeit: new Date(letzterLauf.zeit).toLocaleString(),
              ergebnis: letzterLauf.ok ? '✓ erfolgreich' : `✕ ${letzterLauf.meldung}`
            })}
          </div>
        ) : null}
        {/*
         * Manueller Neustart mit derselben Logik wie der geplante: SOAP-Ansage,
         * Leer-Check, harter Stop als Rückfall. Praktisch nach Konfig-Änderungen.
         */}
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={async () => {
            if (!window.confirm(t('settings.restartJetztFrage'))) return
            try {
              await api.maintenance.restartNow()
              toast(t('settings.restartJetztOk'), 'ok')
            } catch (e) {
              toast(e.message, 'err')
            }
          }}
        >
          {t('settings.restartJetzt')}
        </button>

        <div style={{ marginTop: 12, borderTop: '1px solid #444', paddingTop: 10 }}>
          <div className="inline mb0">
            <label className="check-row" style={{ marginRight: 16 }}>
              <input type="checkbox" checked={restartAktiv} onChange={e => restartSpeichern(e.target.checked)} disabled={busy} />
              {t('settings.restartAktiv')}
            </label>
            <div className="field" style={{ width: 110, margin: 0 }}>
              <label>{t('settings.wartungUhr')}</label>
              <div className="inline mb0">
                <input
                  type="number" min="0" max="23" value={restartStunde}
                  onChange={e => setRestartStunde(e.target.value)}
                  style={{ width: 60 }}
                />
                <span className="muted">:</span>
                <input
                  type="number" min="0" max="59" value={restartMinute}
                  onChange={e => setRestartMinute(e.target.value)}
                  style={{ width: 60 }}
                />
              </div>
            </div>
            <div className="field" style={{ width: 140, margin: 0 }}>
              <label>{t('settings.restartVorwarn')}</label>
              <input
                type="number" min="15" max="600" value={restartVorwarn}
                onChange={e => setRestartVorwarn(e.target.value)}
                style={{ width: 80 }}
              />
            </div>
            {/* Speicherhygiene: Neustart, wenn der Worldserver über X MB liegt (0 = aus) */}
            <div className="field" style={{ width: 160, margin: 0 }} title={t('settings.restartRamHint')}>
              <label>{t('settings.restartRam')}</label>
              <input
                type="number" min="0" max="65536" value={restartRam}
                onChange={e => setRestartRam(Math.max(0, Number(e.target.value) || 0))}
                onBlur={() => api.maintenance.save({ ...basis() }).then(() => toast(t('settings.restartRamGespeichert'), 'ok')).catch(err => toast(err.message, 'err'))}
                style={{ width: 90 }}
              />
            </div>
          </div>
          <div className="hint">{t('settings.restartHint')}</div>
          {letzterRestart ? (
            <div className={`info-box mt ${letzterRestart.ok ? '' : 'error-box'}`}>
              {t('settings.letzterRestart', {
                zeit: new Date(letzterRestart.zeit).toLocaleString(),
                ergebnis: letzterRestart.ok ? '✓ erfolgreich' : `✕ ${letzterRestart.meldung}`
              })}
            </div>
          ) : null}
        </div>

        {/*
         * Datenbank-Wartung: ANALYZE ist sicher und schnell, OPTIMIZE
         * rebuildet Tabellen und kann dauern. Standard: wöchentlich.
         */}
        <div style={{ marginTop: 12, borderTop: '1px solid #444', paddingTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('settings.dbWartungTitle')}</div>
          <div className="inline mb0">
            <label className="check-row" style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={dbAktiv}
                disabled={busy}
                onChange={e => { setDbAktiv(e.target.checked); dbSpeichern({ dbAktiv: e.target.checked }) }}
              />
              {t('settings.dbWartungAktiv')}
            </label>
            <div className="field" style={{ width: 150, margin: 0 }}>
              <label>{t('settings.wochentag')}</label>
              <select
                value={dbWochentag}
                disabled={busy}
                onChange={e => { const v = Number(e.target.value); setDbWochentag(v); dbSpeichern({ dbWochentag: v }) }}
                style={{ width: 130 }}
              >
                <option value={0}>{t('settings.wtTgl')}</option>
                <option value={1}>{t('settings.wt1')}</option>
                <option value={2}>{t('settings.wt2')}</option>
                <option value={3}>{t('settings.wt3')}</option>
                <option value={4}>{t('settings.wt4')}</option>
                <option value={5}>{t('settings.wt5')}</option>
                <option value={6}>{t('settings.wt6')}</option>
                <option value={7}>{t('settings.wt7')}</option>
              </select>
            </div>
            <div className="field" style={{ width: 110, margin: 0 }}>
              <label>{t('settings.wartungUhr')}</label>
              <div className="inline mb0">
                <input type="number" min="0" max="23" value={dbStunde} onChange={e => setDbStunde(e.target.value)} onBlur={() => dbSpeichern({ dbStunde: Number(dbStunde) || 0, dbMinute: Number(dbMinute) || 0 })} style={{ width: 60 }} />
                <span className="muted">:</span>
                <input type="number" min="0" max="59" value={dbMinute} onChange={e => setDbMinute(e.target.value)} onBlur={() => dbSpeichern({ dbStunde: Number(dbStunde) || 0, dbMinute: Number(dbMinute) || 0 })} style={{ width: 60 }} />
              </div>
            </div>
            <div className="field" style={{ width: 140, margin: 0 }}>
              <label>{t('settings.dbWartungModus')}</label>
              <select
                value={dbModus}
                disabled={busy}
                onChange={e => { const v = e.target.value; setDbModus(v); dbSpeichern({ dbModus: v }) }}
                style={{ width: 120 }}
              >
                <option value="analyze">{t('settings.dbAnalyze')}</option>
                <option value="optimize">{t('settings.dbOptimize')}</option>
              </select>
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.maintenance.dbWartungJetzt()
                  toast(r.ok ? t('settings.dbWartungFertig') : t('settings.dbWartungFehler', { fehler: r.error || '' }), r.ok ? 'ok' : 'err')
                } catch (e) {
                  toast(e.message, 'err')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('settings.dbWartungJetzt')}
            </button>
          </div>
          <div className="hint">{t('settings.dbWartungHint')}</div>
          {letzteDbWartung ? (
            <div className={`info-box mt ${letzteDbWartung.ok ? '' : 'error-box'}`}>
              {t('settings.dbLetzte', {
                zeit: new Date(letzteDbWartung.zeit).toLocaleString(),
                modus: letzteDbWartung.modus || '',
                ergebnis: letzteDbWartung.ok ? `✓ ${letzteDbWartung.meldung || ''}` : `✕ ${letzteDbWartung.meldung || ''}`
              })}
            </div>
          ) : null}
          <div className="inline" style={{ marginTop: 8 }}>
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={dbCheck}
                disabled={busy}
                onChange={e => { setDbCheck(e.target.checked); dbSpeichern({ dbCheck: e.target.checked }) }}
              />
              {t('settings.dbCheckNachWartung')}
            </label>
            <button className="btn" disabled={busy || pruefBusy} onClick={pruefungStarten}>
              {pruefBusy ? t('settings.dbPruefungLaeuft') : t('settings.dbPruefungJetzt')}
            </button>
          </div>
          <div className="hint">{t('settings.dbPruefungHint')}</div>
          {letzteDbPruefung ? (
            <div className={`info-box mt ${letzteDbPruefung.ok ? '' : 'error-box'}`}>
              {t('settings.dbLetztePruefung', {
                zeit: new Date(letzteDbPruefung.zeit).toLocaleString(),
                n: letzteDbPruefung.geprueft || 0,
                ergebnis: letzteDbPruefung.ok
                  ? '✓'
                  : `✕ ${(letzteDbPruefung.auffaellig || []).length || 0} Auffälligkeiten`
              })}
              {(letzteDbPruefung.auffaellig || []).length ? (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer' }}>{t('settings.dbPruefungDetails')}</summary>
                  <div className="mono" style={{ fontSize: 11.5, marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                    {letzteDbPruefung.auffaellig.map((a, i) => (
                      <div key={i}>{a.db} · {a.tabelle} · {a.typ}: {a.text}</div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        {/*
         * Abgelaufene Bans: taeglich aufraeumen oder nur zaehlen.
         */}
        <div style={{ marginTop: 12, borderTop: '1px solid #444', paddingTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('settings.banCleanupTitle')}</div>
          <div className="inline mb0">
            <label className="check-row" style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={banCleanup}
                disabled={busy}
                onChange={e => { setBanCleanup(e.target.checked); dbSpeichern({ banCleanup: e.target.checked }) }}
              />
              {t('settings.banCleanupAktiv')}
            </label>
            <div className="field" style={{ width: 110, margin: 0 }}>
              <label>{t('settings.wartungUhr')}</label>
              <div className="inline mb0">
                <input
                  type="number" min="0" max="23" value={banStunde}
                  onChange={e => setBanStunde(e.target.value)}
                  onBlur={() => dbSpeichern({ banCleanupStunde: Number(banStunde) || 0, banCleanupMinute: Number(banMinute) || 0 })}
                  style={{ width: 60 }}
                />
                <span className="muted">:</span>
                <input
                  type="number" min="0" max="59" value={banMinute}
                  onChange={e => setBanMinute(e.target.value)}
                  onBlur={() => dbSpeichern({ banCleanupStunde: Number(banStunde) || 0, banCleanupMinute: Number(banMinute) || 0 })}
                  style={{ width: 60 }}
                />
              </div>
            </div>
            <label className="check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={banNurMelden}
                disabled={busy}
                onChange={e => { setBanNurMelden(e.target.checked); dbSpeichern({ banCleanupNurMelden: e.target.checked }) }}
              />
              {t('settings.banCleanupNurMelden')}
            </label>
          </div>
          <div className="hint">{t('settings.banCleanupHint')}</div>
          {letzteBanReinigung ? (
            <div className={`info-box mt ${letzteBanReinigung.ok ? '' : 'error-box'}`}>
              {letzteBanReinigung.ok
                ? t('settings.banCleanupLetzte', {
                  zeit: new Date(letzteBanReinigung.zeit).toLocaleString(),
                  n: letzteBanReinigung.anzahl || 0,
                  art: letzteBanReinigung.nurGemeldet ? t('settings.banCleanupGefunden') : t('settings.banCleanupEntfernt')
                })
                : t('settings.banCleanupFehler', {
                  zeit: new Date(letzteBanReinigung.zeit).toLocaleString(),
                  fehler: letzteBanReinigung.meldung || ''
                })}
            </div>
          ) : null}
        </div>
        <div style={{ marginTop: 12, borderTop: '1px solid #444', paddingTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('settings.reparaturTitel')}</div>
          <button
            className="btn"
            onClick={async () => {
              if (!window.confirm(t('settings.reparaturFrage'))) return
              try {
                const root = await api.settings.get().then(c => c.server && c.server.rootDir).catch(() => '')
                await api.installer.quelleReparieren({ root })
                toast(t('settings.reparaturOk'), 'ok')
              } catch (e) {
                toast(e.message, 'err')
              }
            }}
          >
            {t('settings.reparaturBtn')}
          </button>
          <div className="hint">{t('settings.reparaturHint')}</div>
        </div>
        {lauf ? <div className="muted mono" style={{ marginTop: 6 }}>{lauf}</div> : null}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Protokoll-Browser                                                  */
/* ================================================================== */

function ProtokollKarte () {
  const { toast } = useStatus()
  const { t } = useI18n()
  const [liste, setListe] = useState(null)

  React.useEffect(() => {
    api.installer.protokolle().then(r => setListe(r.liste || [])).catch(() => setListe([]))
  }, [])

  const oeffnen = async pfad => {
    try {
      await api.installer.protokollOeffnen(pfad)
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const datum = ms => {
    try { return new Date(ms).toLocaleString() } catch (_) { return '' }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>{t('settings.logTitle')}</h3></div>
      <div className="card-body">
        <div className="hint" style={{ marginBottom: 8 }}>{t('settings.logHint')}</div>
        {liste === null ? (
          <div className="spinner" />
        ) : liste.length === 0 ? (
          <div className="muted">{t('settings.logLeer')}</div>
        ) : (
          <table>
            <tbody>
              {liste.map(f => (
                <tr key={f.pfad}>
                  <td className="mono">{f.name}</td>
                  <td className="muted">{datum(f.geaendert)} · {f.groesseKb} KB</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm" onClick={() => oeffnen(f.pfad)}>{t('settings.logOeffnen')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
