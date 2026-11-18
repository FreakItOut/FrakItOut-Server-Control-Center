'use strict'

const { execFile } = require('child_process')
const path = require('path')

/*
 * Steuerung der Datenbank auf Windows.
 *
 * AzerothCore laeuft entweder gegen einen bereits installierten Dienst
 * (MySQL80 / MariaDB ...) oder gegen eine direkt gestartete mysqld.exe.
 * Dienst-Steuerung braucht Administratorrechte, der Binär-Modus nicht -
 * daher werden beide Wege angeboten.
 */

function ps (script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').toString().trim()
          reject(new Error(msg || 'PowerShell-Aufruf fehlgeschlagen'))
          return
        }
        resolve((stdout || '').toString())
      }
    )
  })
}

function isAdmin () {
  return new Promise(resolve => {
    ps(
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
    )
      .then(r => resolve(/true/i.test(r)))
      .catch(() => resolve(false))
  })
}

// MySQL-/MariaDB-Dienste suchen
async function listServices () {
  const script = `
$r = @(Get-CimInstance Win32_Service | Where-Object {
  $_.Name -match 'mysql|maria' -or $_.DisplayName -match 'mysql|maria'
} | Select-Object Name, DisplayName, State, PathName)
if ($r.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $r -Compress }
`
  const out = await ps(script)
  let parsed
  try {
    parsed = JSON.parse(out.trim())
  } catch (_) {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map(s => ({
    name: s.Name,
    displayName: s.DisplayName,
    status: s.State,
    imagePath: String(s.PathName || ''),
    running: /running/i.test(String(s.State))
  }))
}

// Dienst starten / stoppen / neu starten
async function serviceAction ({ name, action }) {
  if (!name) throw new Error('Kein Dienstname angegeben.')
  const admin = await isAdmin()
  if (!admin) {
    throw new Error(
      'Zum Steuern von Windows-Diensten sind Administratorrechte nötig. ' +
        'Starte das Panel als Administrator oder trage im Feld „Server-Pfade" die mysqld.exe ein und nutze den Direkt-Modus.'
    )
  }

  const cmd =
    action === 'start'
      ? `Start-Service -Name '${name}' -ErrorAction Stop`
      : action === 'stop'
        ? `Stop-Service -Name '${name}' -Force -ErrorAction Stop`
        : action === 'restart'
          ? `Restart-Service -Name '${name}' -Force -ErrorAction Stop`
          : (() => {
              throw new Error(`Unbekannte Aktion: ${action}`)
            })()

  try {
    await ps(`try { ${cmd}; 'ok' } catch { Write-Error $_.Exception.Message; exit 1 }`, 60000)
    return { ok: true }
  } catch (e) {
    throw new Error(`Dienst "${name}": ${e.message}`)
  }
}

module.exports = { listServices, serviceAction, isAdmin }