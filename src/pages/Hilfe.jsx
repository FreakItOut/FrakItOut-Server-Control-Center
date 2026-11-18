import React from 'react'
import { useI18n } from '../i18n'

/*
 * In-App-Hilfe: die Kernworkflows in Kurzform. Alles existiert als
 * Funktion im Panel - hier ist nur der Wegweiser. Bewusst knapp: jede
 * Sektion nennt den Ort im Panel und die zwei bis drei Schritte.
 */

const SCHRITTE = [
  { key: 'connect', ziel: '#/settings' },
  { key: 'start', ziel: '#/server' },
  { key: 'update', ziel: '#/options' },
  { key: 'sicherung', ziel: '#/backup' },
  { key: 'migration', ziel: '#/backup' },
  { key: 'bots', ziel: '#/bots' },
  { key: 'konsole', ziel: '#/console' }
]

function Hilfe () {
  const { t } = useI18n()
  return (
    <>
      <div className="info-box">
        <strong>{t('hilfe.intro')}</strong> {t('hilfe.intro2')}
      </div>
      {SCHRITTE.map(s => (
        <div className="card" key={s.key}>
          <div className="card-head">
            <h3>{t(`hilfe.${s.key}.titel`)}</h3>
            <button className="btn sm" onClick={() => (window.location.hash = s.ziel)}>
              {t('hilfe.zumOrt')}
            </button>
          </div>
          <div className="card-body">
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {[1, 2, 3].map(n => {
                const schritt = t(`hilfe.${s.key}.schritt${n}`)
                if (!schritt || schritt.startsWith('hilfe.')) return null
                return <li key={n} style={{ marginBottom: 4 }}>{schritt}</li>
              })}
            </ol>
          </div>
        </div>
      ))}
    </>
  )
}

export default Hilfe
