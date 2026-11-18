import React, { useEffect, useRef } from 'react'

function Modal ({ title, children, onClose, footer, size }) {
  const boxRef = useRef(null)

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Beim Oeffnen das erste Eingabefeld fokussieren. Ohne das landet der
  // Tastaturfokus je nach Fensterzustand auf dem Hintergrund-Dokument und
  // getippte Zeichen bleiben wirkungslos.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const feld = box.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
    if (!feld) return
    const id = window.setTimeout(() => {
      feld.focus()
      if (typeof feld.select === 'function') feld.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal${size === 'lg' ? ' lg' : ''}`} ref={boxRef}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export default Modal