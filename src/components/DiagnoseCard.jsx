import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { useI18n } from '../i18n'
import { useStatus } from '../App'

/*
 * Zwei Fragen, die man sich im Panel stellt und die bisher niemand
 * beantworten konnte:
 *
 *   1. Enthaelt die laufende EXE den aktuellen Stand?
 *      Am 24.10. war tsconfig.json auf 0 Bytes geklemmt. Ab da schlug
 *      jeder Build fehl - aber electron-builder nimmt trotzdem das alte
 *      dist/ und packt es ein. Ergebnis: eine startende EXE mit dem
 *      Vortagesstand und Exit-Code 0. Zwei Tage lang unbemerkt.
 *
 *   2. Wann und warum ist der Worldserver zuletzt abgestuerzt?
 *      Der Core legt im Ordner "Crashes" einen .txt-Bericht ab. Der
 *      enthaelt Datum, Exception-Code und die Aufrufkette bis zur
 *      Quellzeile. Das ist genau die Information, die man sonst durch
 *      Wuehlen in Logs findet.
 *
 * Beide Angaben kommen aus dem Backend (electron/api/diagnose.js). Hier
 * wird nur angezeigt.
 */
function DiagnoseCard () {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [daten, setDaten] = useState(null)
  const [offen, setOffen] = useState(false)

  useEffect(() => {
    let abgebrochen = false
    const laden = () => {
      api.diagnose.get()
        .then(d => { if (!abgebrochen) setDaten(d) })
        .catch(() => {})
    }
    laden()
    const iv = setInterval(laden, 60000)
    return () => { abgebrochen = true; clearInterval(iv) }
  }, [])

  if (!daten) return null

  const build = daten.build || {}
  const crashes = daten.crashes || {}
  const liste = crashes.liste || []

  // Nichts zu zeigen: im ausgelieferten Programm gibt es keine Quellen,
  // und es gab nie einen Absturz.
  const buildZeigt = build.pruefbar && build.aktuell === false
  const crashZeigt = crashes.verfuegbar && liste.length > 0
  if (!buildZeigt && !crashZeigt) return null

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('dashboard.diagnose')}</h3>
        <div className="inline">
          {crashes.verfuegbar ? (
            <button
              className="btn sm"
              onClick={() => api.diagnose.crashOrdnerOeffnen().catch(e => toast(e.message, 'err'))}
            >
              {t('dashboard.crashOrdner')}
            </button>
          ) : null}
          <button className="btn sm" onClick={() => setOffen(o => !o)}>
            {offen ? t('dashboard.diagnoseHide') : t('dashboard.diagnoseShow')}
          </button>
        </div>
      </div>
      <div className="card-body">
        {buildZeigt ? (
          <div className="error-box" style={{ marginBottom: crashes.verfuegbar && liste.length ? 10 : 0 }}>
            {t('dashboard.buildStale', { minutes: build.alterMinuten })}
            {build.quelle ? (
              <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>{build.quelle}</div>
            ) : null}
          </div>
        ) : null}

        {crashZeigt && offen ? (
          <div className="results" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {liste.map(c => (
              <div key={c.datei} className="result-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 3 }}>
                <div className="inline" style={{ gap: 8 }}>
                  <strong style={{ color: '#f09090' }}>{t('dashboard.crashWhen', { when: c.zeitpunkt })}</strong>
                  <span className="mono" style={{ fontSize: 11 }}>{c.exception}</span>
                  {c.exceptionText ? <span className="muted" style={{ fontSize: 11 }}>{c.exceptionText}</span> : null}
                </div>
                <div style={{ fontSize: 12 }}>{c.ursache.text}</div>
                {c.ursache.hinweis ? (
                  <div className="muted" style={{ fontSize: 11 }}>{c.ursache.hinweis}</div>
                ) : null}
                {c.frames.length ? (
                  <div className="mono" style={{ fontSize: 11, color: '#9fb4c8' }}>
                    {c.frames.slice(0, 4).map(f => f.funktion).join(' → ')}
                  </div>
                ) : null}
                {c.frames.length ? (
                  <div className="mono muted" style={{ fontSize: 10.5 }}>
                    {c.frames[0].datei}:{c.frames[0].zeile}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {crashZeigt && !offen ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {t('dashboard.crashCount', {
              count: liste.length,
              when: liste[0].zeitpunkt,
              cause: liste[0].ursache.kuerzel
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default DiagnoseCard