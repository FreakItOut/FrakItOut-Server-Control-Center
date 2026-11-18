'use strict'

/*
 * Reproduziert den Serverstart unter echten Electron-Bedingungen.
 * Testet, ob stdio:['inherit',...] ohne Konsolen-Elternprozess funktioniert.
 *
 * Aufruf:  npx electron scripts/electron-console-test.js
 */

const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const BASE = 'C:\\German Repack Legenden 4.4.5'
const LOG = 'C:/Users/FreakItOut/AppData/Local/Temp/opencode/electron-test.log'

const mode = process.argv[2] || 'inherit' // inherit | ignore
const waitMs = Number(process.argv[3] || 70000)

fs.writeFileSync(LOG, '')
const say = m => {
  fs.appendFileSync(LOG, m + '\n')
  console.log(m)
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  // Existiert ueberhaupt eine Konsole?
  say('=== Umgebung ===')
  say(`Electron: ${process.versions.electron}`)
  say(`platform: ${process.platform}`)
  say(`process.stdout istTTY: ${!!process.stdout.isTTY}`)
  say(`argv-Modus fuer stdin: ${mode}`)

  // 1. Datenbank starten (unabhaengig vom Test)
  say('\n=== Datenbank ===')
  const db = spawn(BASE + '\\_Server\\mysql\\bin\\mysqld.exe', [
    '--standalone',
    '--console',
    '--datadir=' + BASE + '\\_Server\\mysql\\data'
  ], { cwd: BASE + '\\_Server\\mysql', detached: true, stdio: 'ignore' })
  db.unref()
  say(`mysqld PID ${db.pid}`)
  await new Promise(r => setTimeout(r, 15000))

  // 2. Worldserver mit der zu testenden Variante
  say('\n=== Worldserver ===')
  let child = null
  let count = 0
  let buf = ''

  if (mode === 'start') {
    // echtes Konsolenfenster -> gueltiger stdin-Handle
    say('Variante: cmd /c start (eigenes Konsolenfenster)')
    child = spawn(
      'cmd.exe',
      ['/c', 'start', '', '/min', BASE + '\\worldserver.exe'],
      { cwd: BASE, detached: true, windowsHide: true, stdio: 'ignore' }
    )
    child.unref()
    await new Promise(r => setTimeout(r, 5000))
  } else {
    const stdio = mode === 'ignore' ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'pipe', 'pipe']
    say(`stdio: ${JSON.stringify(stdio)}`)
    child = spawn(BASE + '\\worldserver.exe', [], {
      cwd: BASE,
      detached: true,
      windowsHide: false,
      stdio
    })
    const pump = d => {
      buf += d.toString()
      const l = buf.split(/\r?\n/)
      buf = l.pop()
      l.filter(x => x.trim()).forEach(x => { count++; say('[out] ' + x) })
    }
    child.stdout.on('data', pump)
    child.stderr.on('data', pump)
  }

  child.on('exit', code => say(`>>> BEENDET code=${code}`))
  say(`Launcher-PID ${child.pid}`)
  say(`warte ${Math.round(waitMs / 1000)}s ...`)

  await new Promise(r => setTimeout(r, waitMs))

  let alive = false
  try {
    const tl = require('child_process').execSync(
      'tasklist /FI "IMAGENAME eq worldserver.exe" /NH',
      { encoding: 'utf8', windowsHide: true }
    )
    alive = tl.includes('worldserver.exe')
  } catch (_) {}

  say('\n=== Ergebnis ===')
  say(`abgegriffene Logzeilen: ${count}`)
  say(`Worldserver noch aktiv: ${alive}`)
  say(alive ? 'ERGEBNIS: LAEUFT' : 'ERGEBNIS: ABSTURZ')

  try {
    require('child_process').execSync('taskkill /F /IM worldserver.exe', { windowsHide: true })
  } catch (_) {}
  await new Promise(r => setTimeout(r, 3000))
  try { db.kill() } catch (_) {}
  await new Promise(r => setTimeout(r, 2000))

  app.quit()
})

app.on('window-all-closed', () => {})