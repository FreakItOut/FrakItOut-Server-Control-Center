import React, { useEffect, useMemo, useRef, useState } from 'react'
import api from '../lib/api'
import { useStatus } from '../App'
import { useI18n } from '../i18n'

/*
 * Globale Befehlspalette (Strg+K): Seiten und ein paar haeufige Aktionen
 * ohne Suchen in der Seitenleiste. Bewusst klein gehalten - sie soll den
 * Weg abkuerzen, nicht die Bedienung ersetzen.
 */
export default function CommandPalette ({ open, onClose, pages }) {
  const { t } = useI18n()
  const { toast } = useStatus()
  const [suche, setSuche] = useState('')
  const [aktiv, setAktiv] = useState(0)
  const [dynamisch, setDynamisch] = useState([])
  const inputRef = useRef(null)
  const listeRef = useRef(null)

  const befehle = useMemo(() => {
    const seiten = (pages || []).map(p => ({
      id: 'seite:' + p.to,
      label: p.label,
      art: t('palette.pages'),
      run: () => { window.location.hash = '#' + p.to }
    }))
    const aktionen = [
      {
        id: 'start-all',
        label: t('palette.startAll'),
        art: t('palette.actions'),
        run: async () => {
          await api.server.startAll({ delay: 5, waitDb: true })
          toast(t('palette.started'), 'ok')
        }
      },
      {
        id: 'stop-all',
        label: t('palette.stopAll'),
        art: t('palette.actions'),
        run: async () => {
          if (!window.confirm(t('palette.stopConfirm'))) return
          await api.server.stopAll({ stopDb: true })
          toast(t('palette.stopped'), 'ok')
        }
      },
      {
        id: 'backup',
        label: t('palette.backup'),
        art: t('palette.actions'),
        run: async () => {
          const r = await api.backup.create()
          toast(t('palette.backupDone', { stamp: r.stamp }), 'ok')
        }
      }
    ]
    return [...seiten, ...aktionen]
  }, [pages, t, toast])

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    const statisch = !s ? befehle : befehle.filter(b => (b.label + ' ' + b.art).toLowerCase().includes(s))
    return [...statisch, ...dynamisch]
  }, [befehle, suche, dynamisch])

  // Konten und Charaktere erst ab zwei Zeichen suchen - die Palette soll
  // beim Oeffnen sofort da sein, nicht auf die Datenbank warten.
  useEffect(() => {
    if (!open) {
      setDynamisch([])
      return
    }
    const q = suche.trim()
    if (q.length < 2) {
      setDynamisch([])
      return
    }
    let lebendig = true
    const timer = setTimeout(async () => {
      try {
        const [konten, charaktere, items, kreaturen] = await Promise.all([
          api.accounts.list({ search: q, limit: 8 }).catch(() => []),
          api.characters.list({ search: q, limit: 8, offset: 0 }).catch(() => []),
          q.length >= 3 ? api.gm.items(q).catch(() => []) : [],
          q.length >= 3 ? api.gm.creatures(q).catch(() => []) : []
        ])
        if (!lebendig) return
        const k = (Array.isArray(konten) ? konten : []).map(a => ({
          id: 'konto:' + a.id,
          label: a.username,
          art: t('palette.account'),
          run: () => { window.location.hash = '#/accounts?search=' + encodeURIComponent(a.username) }
        }))
        const c = (Array.isArray(charaktere) ? charaktere : []).map(x => ({
          id: 'char:' + x.guid,
          label: x.name,
          art: t('palette.character'),
          run: () => { window.location.hash = '#/characters/' + x.guid }
        }))
        const iQuelle = items && Array.isArray(items.treffer) ? items.treffer : (Array.isArray(items) ? items : [])
        const cQuelle = kreaturen && Array.isArray(kreaturen.treffer) ? kreaturen.treffer : (Array.isArray(kreaturen) ? kreaturen : [])
        const i = iQuelle.slice(0, 6).map(x => ({
          id: 'item:' + x.entry,
          label: `${x.name} (${x.entry})`,
          art: t('palette.item'),
          run: () => { window.location.hash = '#/gm?tab=items&search=' + encodeURIComponent(x.name) }
        }))
        const cr = cQuelle.slice(0, 6).map(x => ({
          id: 'npc:' + x.entry,
          label: `${x.name} (${x.entry})`,
          art: t('palette.creature'),
          run: () => { window.location.hash = '#/gm?tab=creatures&search=' + encodeURIComponent(x.name) }
        }))
        setDynamisch([...k, ...c, ...i, ...cr])
      } catch (_) {
        if (lebendig) setDynamisch([])
      }
    }, 250)
    return () => {
      lebendig = false
      clearTimeout(timer)
    }
  }, [open, suche, t])

  useEffect(() => {
    if (!open) return
    setSuche('')
    setAktiv(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    setAktiv(0)
  }, [suche])

  useEffect(() => {
    if (!open) return
    const zeile = listeRef.current?.querySelector('.palette-zeile.aktiv')
    if (zeile && zeile.scrollIntoView) zeile.scrollIntoView({ block: 'nearest' })
  }, [aktiv, open])

  if (!open) return null

  const ausfuehren = async befehl => {
    if (!befehl) return
    onClose()
    try {
      await befehl.run()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const onKeyDown = e => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAktiv(i => Math.min(gefiltert.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAktiv(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ausfuehren(gefiltert[aktiv])
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
        <div className="palette-kopf">
          <span className="palette-symbol">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={suche}
            onChange={e => setSuche(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-liste" ref={listeRef}>
          {!gefiltert.length ? (
            <div className="palette-leer">{t('palette.empty')}</div>
          ) : (
            gefiltert.map((b, i) => (
              <button
                key={b.id}
                type="button"
                className={`palette-zeile ${i === aktiv ? 'aktiv' : ''}`}
                onMouseEnter={() => setAktiv(i)}
                onClick={() => ausfuehren(b)}
              >
                <span>{b.label}</span>
                <span className="palette-art">{b.art}</span>
              </button>
            ))
          )}
        </div>
        <div className="palette-fuss">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('palette.navigate')}</span>
          <span><kbd>Enter</kbd> {t('palette.run')}</span>
        </div>
      </div>
    </div>
  )
}
