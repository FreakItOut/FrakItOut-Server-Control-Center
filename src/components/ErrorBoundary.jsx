import React from 'react'
import { useI18n } from '../i18n'

/*
 * Auffangnetz fuer Zeichenfehler.
 *
 * Ohne diese Klasse beendet ein einziger Fehler in einer Komponente die
 * gesamte Darstellung - das Fenster bleibt dann schwarz und man sieht keine
 * Ursache. Hier wird stattdessen eine lesbare Meldung mit dem Fehlertext
 * angezeigt, damit man das Problem melden kann.
 */

// Ersatztexte, falls die Uebersetzung (noch) nicht geladen ist.
const ERSATZ = {
  'fehler.titel': 'The view could not be rendered',
  'fehler.hinweis': 'Please report the text below so the error can be fixed.',
  'fehler.neuLaden': 'Reload'
}

class ErrorBoundary extends React.Component {
  constructor (props) {
    super(props)
    this.state = { fehler: null, info: '' }
    this.neuLaden = this.neuLaden.bind(this)
  }

  static getDerivedStateFromError (fehler) {
    return { fehler }
  }

  componentDidCatch (fehler, info) {
    // Zusaetzlich in die Konsole, damit die Entwicklerwerkzeuge den Stack zeigen.
    console.error('Darstellungsfehler:', fehler, info)
    this.setState({ info: (info && info.componentStack) || '' })
  }

  neuLaden () {
    window.location.reload()
  }

  text (key) {
    const t = this.props.t
    const wert = typeof t === 'function' ? t(key) : key
    if (wert === key) return ERSATZ[key] || key
    return wert
  }

  render () {
    if (!this.state.fehler) return this.props.children

    return (
      <div style={{ padding: 24, fontFamily: 'Segoe UI, sans-serif', color: '#e6e6e6', background: '#2a2e33', minHeight: '100vh' }}>
        <h2 style={{ marginTop: 0 }}>{this.text('fehler.titel')}</h2>
        <p>{this.text('fehler.hinweis')}</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#1e2126', padding: 12, borderRadius: 8, overflow: 'auto' }}>
          {String((this.state.fehler && this.state.fehler.stack) || this.state.fehler)}
        </pre>
        {this.state.info ? (
          <pre style={{ whiteSpace: 'pre-wrap', background: '#1e2126', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>
            {this.state.info}
          </pre>
        ) : null}
        <button
          onClick={this.neuLaden}
          style={{ marginTop: 12, padding: '8px 16px', borderRadius: 6, border: '1px solid #555', background: '#3a4048', color: '#eee', cursor: 'pointer' }}
        >
          {this.text('fehler.neuLaden')}
        </button>
      </div>
    )
  }
}

/*
 * Der Fehlerrahmen liegt innerhalb der Sprachverwaltung, damit die Meldung
 * uebersetzt erscheint. Als Klassenkomponente kann er keine Hooks nutzen,
 * deshalb reicht dieser kleine Wrapper die t-Funktion weiter.
 */
export function AppErrorBoundary ({ children }) {
  const { t } = useI18n()
  return <ErrorBoundary t={t}>{children}</ErrorBoundary>
}

export default ErrorBoundary
