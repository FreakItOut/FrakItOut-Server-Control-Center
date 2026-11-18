'use strict'

import { useSyncExternalStore } from 'react'

/*
 * Zentrale Pufferung der Serverausgabe.
 *
 * Wichtig: Die Ausgabe aller Dienste muss auch dann gesammelt werden,
 * wenn ihr Tab gerade nicht offen ist. Sonst waere beim Wechseln nichts
 * zu sehen und bereits Empfangenes ginge verloren.
 *
 * Es werden absichtlich mutierbare Arrays gehalten (Speicherbedarf bei
 * tausenden Zeilen) und Aenderungen ueber eine Versionsnummer gemeldet.
 */

const MAX_LINES = 4000

const lines = { db: [], auth: [], world: [] }
const versions = { db: 0, auth: 0, world: 0 }
const listeners = new Set()

let bound = false

function notify () {
  for (const fn of listeners) fn()
}

function handleEvent (p) {
  if (!p || !p.kind || !lines[p.kind]) return

  if (p.clear) {
    lines[p.kind] = []
    versions[p.kind]++
    notify()
    return
  }

  const list = lines[p.kind]
  list.push({ stream: p.stream, line: p.line })
  if (list.length > MAX_LINES) {
    list.splice(0, list.length - MAX_LINES)
  }
  versions[p.kind]++
  notify()
}

function ensureBound () {
  if (bound) return
  bound = true
  if (typeof window === 'undefined' || !window.api || typeof window.api.on !== 'function') return
  window.api.on('server:log', handleEvent)
}

function subscribe (cb) {
  ensureBound()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function clearLogs (kind) {
  if (!lines[kind]) return
  lines[kind] = []
  versions[kind]++
  notify()
}

export function getLines (kind) {
  return lines[kind] || []
}

export function countLines (kind) {
  return (lines[kind] || []).length
}

// Re-Render, sobald sich der Puffer fuer diesen Dienst aendert
export function useServerLog (kind) {
  useSyncExternalStore(
    subscribe,
    () => versions[kind] || 0
  )
  return lines[kind] || []
}