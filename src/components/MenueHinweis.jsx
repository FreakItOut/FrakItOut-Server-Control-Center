import React, { useCallback, useRef, useState } from 'react'

/*
 * Kurzer Hinweis beim Ueberfahren eines Menuepunkts.
 *
 * Warum nicht das title-Attribut des Browsers: der zeigt nach etwa einer
 * Sekunde ein rechteckiges Fenster mit "Server Start / Stop" - also genau
 * das, was ohnehin schon daselbe steht. Hier steht die Funktion.
 *
 * Warum ausserhalb der Seitenleiste: die hat overflow-y: auto. Ein Hinweis
 * als Kind davon wuerde am Rand abgeschnitten - bei "Einstellungen" ganz
 * unten also genau dort, wo man ihn braucht. Deshalb wird der Hinweis als
 * Geschwister nach der Leiste gerendert und fest am Bildschirm ausgerichtet.
 *
 * Das Overlay selbst ist pointer-events: none. Dadurch kann die Maus nicht
 * darauf bleiben, der Knopf verliert den Hover nie unerwartet, und es
 * braucht keinen Trick mit einem unsichtbaren Steg.
 */

const VERZOEGERUNG = 200 // ms bis der Hinweis erscheint

export default function MenueHinweis ({ wert, onFertig }) {
  if (!wert || !wert.beschreibung) return null

  // Oberkante so, dass die Box neben der Zeile sitzt, aber im Bildschirm
  // bleibt. 26 px ist die halbe Hoehe der Box (Padding und Zeilenhöhe).
  const oben = Math.max(8, Math.min(wert.y + wert.hoehe / 2 - 26, window.innerHeight - 76))

  return (
    <div className="menue-hinweis" style={{ left: wert.x, top: oben }} role="tooltip">
      <div className="mh-titel">{wert.titel}</div>
      <div className="mh-text">{wert.beschreibung}</div>
    </div>
  )
}

/*
 * Zustand fuer den Hinweis. Getrennt vom Anzeigeteil, damit nur ein
 * Overlay existiert - bei einem je Knopf wuerde beim Wechsel zur naechsten
 * Zeile kurz nichts zu sehen sein.
 */
export function useMenueHinweis () {
  const [wert, setWert] = useState(null)
  const timer = useRef(null)

  const zeige = useCallback((ereignis, eintrag) => {
    if (!eintrag || !Array.isArray(eintrag) || !eintrag[1]) return
    /*
     * Wichtig: das Element jetzt festhalten, nicht im Timer.
     * React setzt ereignis.currentTarget nach dem Handler auf null - im
     * setTimeout waere es weg und getBoundingClientRect() wuerde auf null
     * laufen. Der Knopf verschwaende lautlos, ohne jeden Fehler in der
     * Konsole. Genau das ist beim ersten Versuch passiert.
     */
    const knopf = ereignis.currentTarget
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const r = knopf.getBoundingClientRect()
      setWert({
        titel: eintrag[0],
        beschreibung: eintrag[1],
        x: r.right,
        y: r.top,
        hoehe: r.height
      })
    }, VERZOEGERUNG)
  }, [])

  const verberge = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
    setWert(null)
  }, [])

  return { wert, zeige, verberge }
}