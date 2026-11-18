import React from 'react'

const ICONS = { ok: '✓', err: '✕', info: 'i' }

function Toast ({ items }) {
  if (!items || !items.length) return null
  return (
    <div className="toasts">
      {items.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <strong style={{ marginRight: 8 }}>{ICONS[t.type] || 'i'}</strong>
          {t.message}
        </div>
      ))}
    </div>
  )
}

export default Toast