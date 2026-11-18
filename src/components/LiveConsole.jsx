import React, { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useServerLog, clearLogs } from '../lib/serverLogStore'
import { useStatus } from '../App'
import { useI18n } from '../i18n'
import { vollstaendig } from '../lib/antwort'

/*
 * Die eine Serverkonsole: Live-Ausgabe fuer World, Auth und Datenbank,
 * Suche, Nur-Fehler, Datei/Kopieren und die Befehlseingabe fuer den
 * Worldserver. Wird auf der Konsolen-Seite verwendet; die Server-Seite
 * zeigt nur noch einen kompakten Verweis.
 */

function useKindLabels () {
  const { t } = useI18n()
  return {
    world: t('serverControl.kindWorld'),
    auth: t('serverControl.kindAuth'),
    db: t('serverControl.kindDb')
  }
}

function colorize (stream, line) {
  if (stream === 'stderr') return 'red'
  if (stream !== 'stdout') return stream
  if (/\b(error|fatal|failed|exception|ERROR:)\b/i.test(line)) return 'red'
  if (/\b(warning|warn|deprecated)\b/i.test(line)) return 'yellow'
  if (/\b(loaded|ready|started|initialized|success)\b/i.test(line)) return 'green'
  return ''
}

function LogView ({ kind, springToken = 0 }) {
  const { t } = useI18n()
  const { toast } = useStatus()
  const KIND_LABEL = useKindLabels()
  const lines = useServerLog(kind)
  const boxRef = useRef(null)
  const stickRef = useRef(true)
  const [markiere, setMarkiere] = useState(-1)
  const [suche, setSuche] = useState(() => {
    try { return localStorage.getItem(`panel:logFilter:${kind}`) || '' } catch (_) { return '' }
  })
  const [nurFehler, setNurFehler] = useState(() => {
    try { return localStorage.getItem(`panel:logNurFehler:${kind}`) === '1' } catch (_) { return false }
  })

  const suchText = suche.trim().toLowerCase()
  const sichtbar = lines.filter(l => {
    if (nurFehler) {
      const art = colorize(l.stream, l.line)
      if (art !== 'red' && art !== 'yellow') return false
    }
    if (suchText) return String(l.line).toLowerCase().includes(suchText)
    return true
  })
  // Erste rote Zeile in der aktuellen Ansicht - Ziel des Sprungknopfs.
  const ersterFehler = sichtbar.findIndex(l => colorize(l.stream, l.line) === 'red')

  const springeZumFehler = () => {
    if (ersterFehler < 0) return
    setMarkiere(ersterFehler)
    stickRef.current = false
    // Nach dem Rendern scrollen - die Zeile muss dafuer existieren.
    requestAnimationFrame(() => {
      const el = boxRef.current && boxRef.current.querySelectorAll('.line')[ersterFehler]
      if (el) el.scrollIntoView({ block: 'center' })
    })
  }

  useEffect(() => {
    if (springToken > 0) springeZumFehler()
  }, [springToken])

  useEffect(() => {
    // Filterwechsel: die gemerkte Zeilennummer passt nicht mehr.
    setMarkiere(-1)
  }, [suche, nurFehler, kind])

  useEffect(() => {
    const box = boxRef.current
    if (box && stickRef.current) box.scrollTop = box.scrollHeight
  }, [sichtbar.length, suchText, nurFehler])

  return (
    <div>
      <div className="inline" style={{ marginBottom: 6 }}>
        <input
          type="text"
          placeholder={t('serverControl.logSuche')}
          value={suche}
          onChange={e => {
            setSuche(e.target.value)
            try { localStorage.setItem(`panel:logFilter:${kind}`, e.target.value) } catch (_) {}
          }}
          style={{ width: 220 }}
        />
        <label className="check-row" style={{ margin: 0, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={nurFehler}
            onChange={e => {
              setNurFehler(e.target.checked)
              try { localStorage.setItem(`panel:logNurFehler:${kind}`, e.target.checked ? '1' : '0') } catch (_) {}
            }}
          />
          {t('serverControl.logNurFehler')}
        </label>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {t('serverControl.logZeilen', { sichtbar: sichtbar.length, gesamt: lines.length })}
        </span>
        <button
          className="btn sm"
          onClick={springeZumFehler}
          disabled={ersterFehler < 0}
          title={t('serverControl.logErsterFehlerHint')}
        >
          {t('serverControl.logErsterFehler')}
        </button>
        <button
          className="btn sm"
          onClick={() => api.server.logOeffnen(kind).catch(e => toast(e.message, 'err'))}
          title={t('serverControl.logDateiHint')}
        >
          {t('serverControl.logDatei')}
        </button>
        <button
          className="btn sm"
          title={t('serverControl.logKopierenHint')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(sichtbar.map(l => l.line).join('\n'))
              toast(t('serverControl.logKopiert', { n: sichtbar.length }), 'ok')
            } catch (e) {
              toast(e.message, 'err')
            }
          }}
        >
          {t('serverControl.logKopieren')}
        </button>
      </div>
      <div
        className="console"
        ref={boxRef}
        onScroll={e => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {!lines.length ? (
          <div className="line dim">{t('serverControl.logEmpty', { kind: KIND_LABEL[kind] })}</div>
        ) : !sichtbar.length ? (
          <div className="line dim">{t('serverControl.logNichts')}</div>
        ) : (
          sichtbar.map((l, i) => (
            <div key={i} className={`line ${colorize(l.stream, l.line)}${markiere === i ? ' markiert' : ''}`}>
              {l.line}
            </div>
          ))
        )}
        <div className="line prompt">&gt; _</div>
      </div>
    </div>
  )
}

export default function LiveConsole () {
  const { t } = useI18n()
  const KIND_LABEL = useKindLabels()
  const [kind, setKind] = useState('world')
  const [befehl, setBefehl] = useState('')
  const [befehlBusy, setBefehlBusy] = useState(false)
  const [befehlAntwort, setBefehlAntwort] = useState(null)
  // Zaehler: Klick auf ein Fehler-Badge springt zur ersten Fehlerzeile.
  const [springToken, setSpringToken] = useState(0)
  const worldLines = useServerLog('world')
  const authLines = useServerLog('auth')
  const dbLines = useServerLog('db')
  const listen = { world: worldLines, auth: authLines, db: dbLines }
  const fehlerPro = liste => (liste || []).reduce((n, l) => n + (colorize(l.stream, l.line) === 'red' ? 1 : 0), 0)

  const sendeBefehl = async e => {
    e.preventDefault()
    const cmd = befehl.trim()
    if (!cmd || befehlBusy) return
    setBefehlBusy(true)
    try {
      const res = await api.soap.send(cmd)
      setBefehlAntwort({ ok: true, text: vollstaendig(res.antwort) })
      setBefehl('')
    } catch (err) {
      setBefehlAntwort({ ok: false, text: err.message })
    } finally {
      setBefehlBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('serverControl.consoleHead')}</h3>
        <div className="console-tools">
          {['world', 'auth', 'db'].map(k => {
            const n = (listen[k] || []).length
            const fehler = fehlerPro(listen[k])
            return (
              <button
                key={k}
                className={`btn sm ${kind === k ? 'primary' : ''}`}
                onClick={() => {
                  setKind(k)
                  if (fehler) setSpringToken(n => n + 1)
                }}
              >
                {KIND_LABEL[k]}
                {n ? <span className="muted" style={{ marginLeft: 5 }}>({n})</span> : null}
                {fehler ? (
                  <span style={{ marginLeft: 5, color: 'var(--c-red)' }} title={t('serverControl.logFehlerBadge', { n: fehler })}>
                    ●{fehler}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      <div className="card-body">
        <div className="inline mb0" style={{ marginBottom: 8 }}>
          <button className="btn sm" onClick={() => document.querySelector('.console')?.scrollTo({ top: 999999 })}>
            {t('serverControl.scrollDown')}
          </button>
          <button className="btn sm" onClick={() => clearLogs(kind)}>
            {t('serverControl.clearOne', { kind: KIND_LABEL[kind] })}
          </button>
          <button className="btn sm" onClick={() => ['world', 'auth', 'db'].forEach(k => clearLogs(k))}>
            {t('serverControl.clearAll')}
          </button>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {t('serverControl.logKept')}
          </span>
        </div>
        <LogView kind={kind} springToken={springToken} />
        {kind === 'world' ? (
          <>
            <form className="console-eingabe" onSubmit={sendeBefehl}>
              <span className="console-prompt">&gt;</span>
              <input
                type="text"
                value={befehl}
                onChange={e => setBefehl(e.target.value)}
                placeholder={t('serverControl.commandPlaceholder')}
                aria-label={t('serverControl.commandPlaceholder')}
              />
              <button className="btn sm primary" disabled={befehlBusy || !befehl.trim()}>
                {befehlBusy ? t('serverControl.sending') : t('serverControl.send')}
              </button>
            </form>
            {befehlAntwort ? (
              <pre className={`befehl-ausgabe ${befehlAntwort.ok ? '' : 'error-box'}`}>
                {befehlAntwort.text || (befehlAntwort.ok ? t('serverControl.sentNoAnswer') : '')}
              </pre>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
