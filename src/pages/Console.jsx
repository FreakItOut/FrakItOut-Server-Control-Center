import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { ersteZeile, vollstaendig } from '../lib/antwort'
import { istAbschaltung, verzoegerung } from '../lib/abschaltung'
import Modal from '../components/Modal'
import LiveConsole from '../components/LiveConsole'

/*
 * Schnellbefehle.
 *
 * "server info" hat hier bis eben "server info 1" geschickt, und das
 * scheiterte mit HTTP 500 und der Hilfezeile des Befehls:
 *
 *   Syntax: .server info Display server version and the number of
 *   connected players.
 *
 * Die Endung "1" stammt aus der TrinityCore-Dokumentation, wo
 * "server info" ein Argument erwartet. AzerothCore erwartet keines - der
 * Core weist jeden Zusatz als falsche Verwendung ab. Auch das Beispiel im
 * Eingabefeld nannte denselben unbrauchbaren Befehl.
 *
 * Der Core nimmt Befehle ohne Ruecksicht auf die Schriftgroesse:
 * "SERVER INFO" liefert dasselbe wie "server info".
 */
const PRESETS = [
  { cmd: 'server info', labelKey: 'console.presetInfo' },
  { cmd: 'gm ingame', labelKey: 'console.presetGm3' },
  { cmd: 'ban character test 1w Cheating', labelKey: 'console.presetBan' },
  { cmd: 'unban account all', labelKey: 'console.presetUnban' },
  { cmd: 'reload config', labelKey: 'console.presetReload' },
  { cmd: 'save', labelKey: 'console.presetSave' },
  { cmd: 'server shutdown 1 0', labelKey: 'console.presetShutdown' }
]

const STORAGE_KEY = 'console.history'

function loadHistory () {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch (_) {
    return []
  }
}

function Console () {
  const { t, lang } = useI18n()
  const { status } = useStatus()
  const [command, setCommand] = useState('')
  // Spieler-Ansage (announce) als eigenes Feld
  const [ansage, setAnsage] = useState('')
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [shutdownFrage, setShutdownFrage] = useState(null)
  const [ansicht, setAnsicht] = useState('live')

  useEffect(() => { setHistory(loadHistory()) }, [])

  const send = async e => {
    e && e.preventDefault()
    const cmd = command.trim()
    if (!cmd || busy) return

    /*
     * Befehle, die den Server stilllegen, werden erst nach einer
     * Rueckfrage gesendet. Geprueft wird der Text, nicht der Preset -
     * sonst waere die Absicherung wertlos, sobald jemand den Befehl von
     * Hand eintippt.
     */
    if (istAbschaltung(cmd)) {
      setShutdownFrage(cmd)
      return
    }

    await sende(cmd)
  }

  const sende = async cmd => {
    setBusy(true)
    // Die Antwort des Servers wird mitgenommen, damit sie im Verlauf
    // landet. Sie stand vorher in keiner Eigenschaft - der Server
    // antwortete mit ihr, das Panel zeigte "gesendet (HTTP 200)" und
    // ließ sie fallen. Genau daran ist der Fehler mit "server info 1"
    // unbemerkt geblieben: die Antwort "Syntax: .server info" stand im
    // HTTP-Körper und nirgends im Fenster.
    let ausgabe = ''
    let gutGelaufen = false
    try {
      const res = await api.soap.send(cmd)
      ausgabe = vollstaendig(res.antwort)
      gutGelaufen = true
      setLastResult({
        ok: true,
        msg: t('console.sent', { cmd, status: res.status }),
        out: ausgabe
      })
    } catch (err) {
      gutGelaufen = false
      // Die Fehlermeldung enthaelt den Wortlaut des Servers; die kommt
      // schon in msg. Deshalb bleibt out leer.
      setLastResult({ ok: false, msg: err.message, out: '' })
    } finally {
      setBusy(false)
      setCommand('')
      setHistory(h => {
        const next = [{ cmd, ts: Date.now(), out: ausgabe, ok: gutGelaufen }, ...h].slice(0, 50)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    }
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }

  // Verlauf als Textdatei exportieren (Support/Fortschreibung)
  const exportHistory = () => {
    try {
      const text = history
        .map(h => `[${new Date(h.ts).toLocaleString()}] ${h.ok ? 'OK' : 'FEHLER'} > ${h.cmd}\n${h.out || ''}\n`)
        .join('\n')
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `konsole-verlauf-${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setLastResult({ ok: false, msg: e.message, out: '' })
    }
  }

  return (
    <>
      <div className="tabs">
        <button className={`tab ${ansicht === 'live' ? 'active' : ''}`} onClick={() => setAnsicht('live')}>
          {t('console.tabLive')}
        </button>
        <button className={`tab ${ansicht === 'befehle' ? 'active' : ''}`} onClick={() => setAnsicht('befehle')}>
          {t('console.tabCommands')}
        </button>
      </div>

      {ansicht === 'live' ? <LiveConsole /> : null}

      {ansicht === 'befehle' ? (
        <>
      <div className="info-box" style={{ marginBottom: 16 }}>
        {t('console.introBeforeSoap')} <strong>{t('console.soap')}</strong> {t('console.introAfterSoap')}{' '}
        <span className="mono">worldserver.conf</span> {t('console.introAfterConf')}
        <div className="mono" style={{ marginTop: 8, color: '#c8a44d' }}>
          SOAP.Enabled = 1
          <br />
          SOAP.IP = &quot;127.0.0.1&quot;
          <br />
          SOAP.Port = 7878
        </div>
        {t('console.credsBefore')} <strong>{t('console.settings')}</strong>{t('console.credsAfter')}{' '}
        {t(status.world?.running ? 'console.runningYes' : 'console.runningNo')}.
        <div style={{ marginTop: 8 }}>
          <button
            className="btn sm"
            disabled={busy}
            title={t('console.soapResetHint')}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await api.soap.zugangNeuSetzen()
                setLastResult({ ok: true, msg: `${t('console.soapResetOk')} (${r.user} / ${r.password})` })
              } catch (e) {
                setLastResult({ ok: false, msg: e.message })
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('console.soapReset')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t('console.sendTitle')}</h3>
          {status.world?.running ? null : <span className="pill offline">{t('console.worldStopped')}</span>}
        </div>
        <div className="card-body">
          <form onSubmit={send} className="inline mb0">
            <input
              type="text"
              className="flex-1 mono"
              placeholder={t('console.placeholder')}
              value={command}
              onChange={e => setCommand(e.target.value)}
              list="console-befehle"
              style={{ maxWidth: 520 }}
            />
            {/*
             * Vorschläge aus den Presets + häufigen Befehlen; Freitext bleibt.
             */}
            <datalist id="console-befehle">
              {[...new Set([
                ...PRESETS.map(p => p.cmd),
                'server info',
                'reload config',
                'saveall',
                'announce ',
                'server shutdown 60'
              ])].map(c => <option key={c} value={c} />)}
            </datalist>
            <button className="btn primary" disabled={busy || !command.trim()}>{t('console.send')}</button>
          </form>

          {/*
           * Ansage: Text eingeben, der Weg über "announce" ist Standard -
           * Zeilenumbrüche raus, leere Ansagen gar nicht erst senden.
           */}
          <form
            className="inline mb0"
            style={{ marginTop: 10 }}
            onSubmit={async e => {
              e.preventDefault()
              const text = ansage.replace(/[\r\n]+/g, ' ').trim()
              if (!text) return
              setBusy(true)
              try {
                const r = await api.soap.send(`announce ${text}`)
                setLastResult({ ok: true, msg: t('console.ansageOk', { antwort: ersteZeile(r.antwort) || 'OK' }), out: vollstaendig(r.antwort) })
                setAnsage('')
              } catch (err) {
                setLastResult({ ok: false, msg: err.message, out: '' })
              } finally {
                setBusy(false)
              }
            }}
          >
            <input
              type="text"
              className="flex-1 mono"
              placeholder={t('console.ansagePlatz')}
              value={ansage}
              onChange={e => setAnsage(e.target.value)}
              style={{ maxWidth: 520 }}
            />
            <button className="btn" disabled={busy || !ansage.trim()}>{t('console.ansageSenden')}</button>
          </form>

          <div className="mt">
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('console.quick')}</div>
            <div className="inline">
              {PRESETS.map(p => (
                <button
                  key={p.cmd}
                  className="btn sm"
                  onClick={() => setCommand(p.cmd)}
                  title={p.cmd}
                >
                  {t(p.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {lastResult ? (
            <div className={`${lastResult.ok ? 'ok-box' : 'error-box'} mt`}>
              <div>{lastResult.msg}</div>
              {/*
               * Die Ausgabe des Servers. Vorher stand hier nur der
               * Satz "gesendet (HTTP 200)" - die Antwort kam an und
               * wurde nicht angezeigt.
               */}
              {lastResult.out ? <pre className="befehl-ausgabe">{lastResult.out}</pre> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t('console.historyTitle')}</h3>
          <div className="inline">
            <button className="btn sm" onClick={exportHistory} disabled={!history.length}>{t('console.export')}</button>
            <button className="btn sm" onClick={clearHistory}>{t('console.clear')}</button>
          </div>
        </div>
        <div className="card-body tight">
          {!history.length ? (
            <div className="empty">{t('console.empty')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>{t('console.time')}</th>
                    <th style={{ width: '38%' }}>{t('console.command')}</th>
                    <th>{t('console.answer')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="clickable" onClick={() => setCommand(h.cmd)}>
                      <td className="muted mono">
                        {new Date(h.ts).toLocaleTimeString(lang)}
                      </td>
                      <td className="mono">{h.cmd}</td>
                      {/*
                       * Alte Eintraege aus localStorage haben kein "out"
                       * und kein "ok" - die sind vor dieser Aenderung
                       * gespeichert worden. Sie bekommen deshalb keine
                       * falsche Angabe, sondern gar keine.
                       */}
                      <td className="mono verlauf-antwort">
                        {h.out
                          ? ersteZeile(h.out, 120)
                          : (h.ok === false
                            ? <span className="verlauf-fehler">{t('console.failed')}</span>
                            : (h.ok === true ? <span className="muted">—</span> : null))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/*
       * Rueckfrage vor dem Herunterfahren.
       *
       * "server shutdown" beendet den Worldserver sofort. Der Befehl steht
       * als Knopf direkt neben "Speichern" und "Alles neu laden", und ein
       * Fehlklick faellt nicht auf, weil die Konsole danach ohnehin leer
       * ist - der Server ist dann naemlich weg.
       */}
      {shutdownFrage ? (
        <Modal
          title={t('console.shutdownTitle')}
          onClose={() => setShutdownFrage(null)}
          footer={
            <>
              <button className="btn" onClick={() => setShutdownFrage(null)}>{t('console.shutdownAbort')}</button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  const cmd = shutdownFrage
                  setShutdownFrage(null)
                  sende(cmd)
                }}
              >
                {t('console.shutdownConfirmBtn')}
              </button>
            </>
          }
        >
          <div className="error-box">{t('console.shutdownWarning')}</div>
          <p style={{ marginTop: 12, marginBottom: 6 }}>
            {t('console.shutdownCommand')}
          </p>
          <div className="mono" style={{ fontSize: 13, color: '#e8ecf0' }}>{shutdownFrage}</div>
          {verzoegerung(shutdownFrage) ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {t('console.shutdownDelay', {
                seconds: verzoegerung(shutdownFrage).sekunden,
                count: verzoegerung(shutdownFrage).sekunden
              })}
            </p>
          ) : null}
          <div className="info-box" style={{ fontSize: 12, marginTop: 10 }}>
            {t('console.shutdownCancelHint')}
          </div>
        </Modal>
      ) : null}
        </>
      ) : null}
    </>
  )
}

export default Console