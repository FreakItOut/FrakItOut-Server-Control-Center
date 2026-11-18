import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import de from './de'
import en from './en'
import api from '../lib/api'
import { setLocale } from '../lib/constants'

export const LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' }
]

// Die Seittexte liegen in src/i18n/parts/<seite>.js und werden hier
// automatisch eingesammelt - pro Seite eine Datei, damit mehrere
// Bearbeiter nicht an derselben Datei arbeiten muessen.
const partModule = import.meta.glob('./parts/*.js', { eager: true })

function deepMerge (ziel, quelle) {
  for (const key of Object.keys(quelle || {})) {
    const q = quelle[key]
    if (q && typeof q === 'object' && !Array.isArray(q)) {
      if (!ziel[key] || typeof ziel[key] !== 'object' || Array.isArray(ziel[key])) ziel[key] = {}
      deepMerge(ziel[key], q)
    } else if (q !== undefined) {
      ziel[key] = q
    }
  }
  return ziel
}

function buildDict (base, sprache) {
  const out = JSON.parse(JSON.stringify(base))
  for (const m of Object.values(partModule)) {
    const teil = m && m.default
    if (teil && teil[sprache]) deepMerge(out, teil[sprache])
  }
  return out
}

const DICTS = {
  de: buildDict(de, 'de'),
  en: buildDict(en, 'en')
}

// "a.b.c" -> { a: { b: { c: ... } } }
function lookup (dict, key) {
  if (!dict || !key) return undefined
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key]
  let cur = dict
  for (const part of String(key).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

// {name} einsetzen
function interpolate (text, vars) {
  if (typeof text !== 'string' || !vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))
}

const I18nContext = createContext({ lang: 'de', t: k => k, setLang: () => {}, languages: LANGUAGES })

export function useI18n () {
  return useContext(I18nContext)
}

export function I18nProvider ({ children }) {
  const [lang, setLangState] = useState('de')

  // Sprache aus der Panel-Konfiguration laden
  useEffect(() => {
    let alive = true
    api.settings
      .get()
      .then(cfg => {
        if (!alive) return
        const code = cfg && cfg.panel && cfg.panel.language
        if (code && DICTS[code]) setLangState(code)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const setLang = useCallback(code => {
    if (!DICTS[code]) return
    setLangState(code)
    api.settings.save({ panel: { language: code } }).catch(() => {})
    // Fenstertitel sofort anpassen
    document.documentElement.lang = code
  }, [])

  // Systemsprache uebernehmen, falls nichts gespeichert ist
  useEffect(() => {
    let aborted = false
    api.settings
      .get()
      .then(cfg => {
        if (aborted) return
        const gespeichert = cfg && cfg.panel && cfg.panel.language
        if (gespeichert && DICTS[gespeichert]) return
        const system = String(navigator.language || navigator.userLanguage || 'de').slice(0, 2).toLowerCase()
        if (DICTS[system]) {
          setLangState(system)
          api.settings.save({ panel: { language: system } }).catch(() => {})
        }
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = useCallback(
    (key, vars) => {
      // Fehlt die Uebersetzung, bleibt der deutsche Text stehen - besser als
      // ein roher Schluessel im Bildschirm.
      const wert = lookup(DICTS[lang], key) ?? lookup(DICTS.de, key)
      if (wert === undefined) return key
      return interpolate(wert, vars)
    },
    [lang]
  )

  const wert = useMemo(() => {
    // Zahlen- und Datumsformate in constants.js folgen der Sprache.
    // Muss synchron vor dem Rendern passieren - im useEffect waere das
    // einen Renderzyklus zu spaet und das Datum bliebe im alten Format.
    setLocale(lang)
    return { lang, t, setLang, languages: LANGUAGES }
  }, [lang, t, setLang])

  return <I18nContext.Provider value={wert}>{children}</I18nContext.Provider>
}

export default I18nProvider