'use strict'

/*
 * Nachts-Wartung: optionaler Zeitplan, der das Server-Update von selbst
 * durchlaeuft - Sicherung hat der Update-Durchlauf schon eingebaut, und
 * laufende Server stoppt/restartet update() ebenfalls selbst. Der Timer
 * lebt im Panel: laeuft das Panel nicht, findet auch keine Wartung statt
 * (deshalb der Hinweistext in der Oberflaeche).
 */

let store = null
let win = null
let timer = null

function init (storeRef, windowRef) {
  store = storeRef
  win = windowRef
}

function send (channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, payload)
  }
}

function einstellungen () {
  try {
    return store.read().maintenance || {}
  } catch (_) {
    return {}
  }
}

function plan () {
  const m = einstellungen()
  return {
    enabled: m.enabled === true,
    stunde: Math.min(23, Math.max(0, Number(m.stunde) || 3)),
    minute: Math.min(59, Math.max(0, Number.isInteger(m.minute) ? m.minute : 0)),
    // 0 = täglich, 1..7 = Mo..So (JS: 1=Mo .. 0=So)
    wochentag: Math.min(7, Math.max(0, Number(m.wochentag) || 0)),
    // Wartung nur bei leerem Server (keine Spieler online)
    nurBeiLeer: m.nurBeiLeer === true,
    warteMinuten: Math.min(120, Math.max(5, Number(m.warteMinuten) || 15)),
    warteVersuche: Math.min(20, Math.max(1, Number(m.warteVersuche) || 8)),
    botKontoPraefixe: String(m.botKontoPraefixe || 'rndbot, ahbot, playerbots'),
    // Täglicher Weltserver-Neustart: Speicherhygiene bei Dauerbetrieb.
    restartAktiv: m.restartAktiv === true,
    restartStunde: Math.min(23, Math.max(0, Number.isInteger(m.restartStunde) ? m.restartStunde : 6)),
    restartMinute: Math.min(59, Math.max(0, Number.isInteger(m.restartMinute) ? m.restartMinute : 0)),
    // Vorwarnzeit in Sekunden, die der Core selbst im Spiel ansagt
    restartVorwarnSek: Math.min(600, Math.max(15, Number(m.restartVorwarnSek) || 60)),
    // Speicherhygiene: Neustart, wenn der Worldserver über dieser Schwelle liegt (0 = aus)
    restartRamMb: Math.max(0, Number(m.restartRamMb) || 0),
    // Datenbank-Wartung (ANALYZE/OPTIMIZE) nach Plan
    dbAktiv: m.dbAktiv === true,
    dbWochentag: Math.min(7, Math.max(0, Number.isInteger(Number(m.dbWochentag)) ? Number(m.dbWochentag) : 7)),
    dbStunde: Math.min(23, Math.max(0, Number.isInteger(Number(m.dbStunde)) ? Number(m.dbStunde) : 4)),
    dbMinute: Math.min(59, Math.max(0, Number.isInteger(Number(m.dbMinute)) ? Number(m.dbMinute) : 30)),
    dbModus: m.dbModus === 'optimize' ? 'optimize' : 'analyze',
    // Nach der Wartung zusaetzlich CHECK TABLE (Integritaet)
    dbCheck: m.dbCheck === true,
    letzteDbWartung: m.letzteDbWartung || null,
    letzteDbPruefung: m.letzteDbPruefung || null,
    // Abgelaufene Bans taeglich aufraeumen
    banCleanup: m.banCleanup === true,
    banCleanupStunde: Math.min(23, Math.max(0, Number.isInteger(Number(m.banCleanupStunde)) ? Number(m.banCleanupStunde) : 5)),
    banCleanupMinute: Math.min(59, Math.max(0, Number.isInteger(Number(m.banCleanupMinute)) ? Number(m.banCleanupMinute) : 0)),
    banCleanupNurMelden: m.banCleanupNurMelden === true,
    letzteBanReinigung: m.letzteBanReinigung || null,
    // Letzter Wartungslauf (Zeit + Ergebnis) für die Oberfläche
    letzterLauf: m.letzterLauf || null,
    // Letzter (geplanter oder manueller) Weltserver-Neustart
    letzterRestart: m.letzterRestart || null,
    // Nächste Termine (die Übersicht zeigt sie an)
    naechsterLauf: m.enabled === true ? naechsterLauf(Number(m.stunde) || 3, Number(m.minute) || 0, Math.min(7, Math.max(0, Number(m.wochentag) || 0))).toISOString() : null,
    naechsterRestart: m.restartAktiv === true ? naechsterLauf(Math.min(23, Math.max(0, Number.isInteger(m.restartStunde) ? m.restartStunde : 6)), Math.min(59, Math.max(0, Number.isInteger(m.restartMinute) ? m.restartMinute : 0))).toISOString() : null,
    naechsteDbWartung: m.dbAktiv === true ? naechsterLauf(Math.min(23, Math.max(0, Number.isInteger(Number(m.dbStunde)) ? Number(m.dbStunde) : 4)), Math.min(59, Math.max(0, Number.isInteger(Number(m.dbMinute)) ? Number(m.dbMinute) : 30)), Math.min(7, Math.max(0, Number.isInteger(Number(m.dbWochentag)) ? Number(m.dbWochentag) : 7))).toISOString() : null,
    naechsteBanReinigung: m.banCleanup === true ? naechsterLauf(Math.min(23, Math.max(0, Number.isInteger(Number(m.banCleanupStunde)) ? Number(m.banCleanupStunde) : 5)), Math.min(59, Math.max(0, Number.isInteger(Number(m.banCleanupMinute)) ? Number(m.banCleanupMinute) : 0))).toISOString() : null
  }
}

/*
 * Wie viele Spieler sind gerade online? Fuer den "nur bei leerem
 * Server"-Schalter. Schlägt die Abfrage fehl (DB aus, frische
 * Installation), gilt der Server als leer - die Wartung darf laufen.
 */
async function spielerOnline () {
  return require('./spieler').zaehleEchteSpieler()
}

/*
 * Naechster Lauf: heute zur Uhrzeit, wenn die noch vor uns liegt,
 * sonst morgen. timer.ms vom Betrieb in Minuten - ein Auge haengt an
 * jeder Minute, damit keine Minutenlogik im Renderer nötig wird.
 */
function naechsterLauf (h, min, wochentag = 0) {
  const jetzt = new Date()
  const ziel = new Date(jetzt)
  ziel.setHours(h, min, 0, 0)
  if (ziel.getTime() <= jetzt.getTime()) ziel.setDate(ziel.getDate() + 1)
  // Wochentag: 1..7 = Mo..So (JS: 0=So). 0 = täglich.
  if (wochentag > 0) {
    const geplant = wochentag === 7 ? 0 : wochentag
    for (let i = 0; i < 8 && ziel.getDay() !== geplant; i++) {
      ziel.setDate(ziel.getDate() + 1)
    }
  }
  return ziel
}

let laeuftGerade = false

async function ausfuehren (versuch = 1) {
  if (laeuftGerade) return { ok: false, uebersprungen: true }
  const m = einstellungen()

  /*
   * Nur bei leerem Server: Sind Spieler online, wird verschoben - ohne die
   * Sperre zu halten (ein manueller Lauf bleibt möglich). Nach den
   * Versuchen läuft die Wartung trotzdem: nie updaten wäre schlimmer als
   * einmal zu einer ungewöhnlichen Zeit zu stoppen.
   */
  if (m.nurBeiLeer) {
    const online = await spielerOnline()
    if (online > 0 && versuch <= m.warteVersuche) {
      const meldung = `Wartung verschoben: ${online} Spieler online - nächster Versuch in ${m.warteMinuten} min (Versuch ${versuch}/${m.warteVersuche}).`
      send('maintenance:progress', { phase: 'warte', meldung })
      require('./notify').melde('Wartung verschoben', meldung)
      setTimeout(() => { ausfuehren(versuch + 1).catch(() => {}) }, m.warteMinuten * 60 * 1000)
      return { ok: false, verschoben: true, online }
    }
    if (online > 0) {
      send('maintenance:progress', { phase: 'warte', meldung: `${online} Spieler online und Wartezeit abgelaufen - die Wartung läuft trotzdem.` })
    }
  }

  laeuftGerade = true
  const root = (store.read().server || {}).rootDir || ''
  send('maintenance:progress', { phase: 'start', meldung: 'Automatische Wartung läuft …' })
  try {
    const installer = require('./installer')
    const r = await installer.update({ root })
    send('maintenance:progress', { phase: 'fertig', meldung: 'Automatische Wartung abgeschlossen.' })
    try {
      store.write({ maintenance: { letzterLauf: { zeit: new Date().toISOString(), ok: true, meldung: 'erfolgreich' } } })
    } catch (_) {}
    return { ok: true, result: r }
  } catch (e) {
    send('maintenance:progress', { phase: 'fehler', meldung: `Automatische Wartung fehlgeschlagen: ${e.message}` })
    try {
      store.write({ maintenance: { letzterLauf: { zeit: new Date().toISOString(), ok: false, meldung: e.message } } })
    } catch (_) {}
    return { ok: false, error: e.message }
  } finally {
    laeuftGerade = false
  }
}

/*
 * Geplanter Weltserver-Neustart: Speicherhygiene bei Dauerbetrieb. Läuft
 * der Server, wird er sauber beendet (Charaktere werden gespeichert) und
 * wieder angestellt. Läuft er nicht, passiert nichts.
 */
const schlaf = ms => new Promise(r => setTimeout(r, ms))

async function weltserverNeustarten (versuch = 1) {
  const serverManager = require('../server-manager')
  const st = serverManager.status()
  if (!st.world || !st.world.running) {
    send('maintenance:progress', { phase: 'restart', meldung: 'Geplanter Neustart übersprungen - der Worldserver läuft nicht.' })
    return { ok: false, uebersprungen: true }
  }

  /*
   * Derselbe Spielerschutz wie bei der Wartung: Sind Spieler online und
   * der Schalter steht, wird verschoben (alle 15 min, bis zur Versuche-
   * Grenze) - der geplante Neustart soll Freunde nicht rauswerfen.
   */
  const p = plan()
  if (p.nurBeiLeer) {
    const online = await spielerOnline()
    if (online > 0 && versuch <= p.warteVersuche) {
      const meldung = `Geplanter Neustart verschoben: ${online} Spieler online - nächster Versuch in ${p.warteMinuten} min (Versuch ${versuch}/${p.warteVersuche}).`
      send('maintenance:progress', { phase: 'restart', meldung })
      require('./notify').melde('Neustart verschoben', meldung)
      setTimeout(() => { weltserverNeustarten(versuch + 1).catch(() => {}) }, p.warteMinuten * 60 * 1000)
      return { ok: false, verschoben: true, online }
    }
    if (online > 0) {
      send('maintenance:progress', { phase: 'restart', meldung: `${online} Spieler online und Wartezeit abgelaufen - der Neustart läuft trotzdem (mit Ansage im Spiel).` })
    }
  }

  /*
   * Freundlicher Weg: der Core selbst kündigt den Shutdown im Spiel an
   * ("server shutdown <sek>") und speichert beim Herunterfahren. Nur wenn
   * SOAP nicht antwortet oder der Prozess die Frist überschreitet, fällt
   * das Panel auf den harten Stop zurück.
   */
  const vorwarnSek = plan().restartVorwarnSek
  let sanft = false
  try {
    const soap = require('./soap')
    await soap.send(`server shutdown ${vorwarnSek}`)
    sanft = true
    send('maintenance:progress', { phase: 'restart', meldung: `Neustart im Spiel angesagt - der Worldserver fährt in ${vorwarnSek} s herunter.` })
  } catch (e) {
    send('maintenance:progress', { phase: 'restart', meldung: 'SOAP nicht erreichbar - direkter Stop.' })
  }

  const fristMs = (sanft ? vorwarnSek * 1000 : 0) + 45000
  const deadline = Date.now() + fristMs
  while (Date.now() < deadline && serverManager.status().world.running) await schlaf(1000)

  if (serverManager.status().world.running) {
    send('maintenance:progress', { phase: 'restart', meldung: 'Prozess hat die Frist überschritten - harter Stop.' })
    try { serverManager.stop('world') } catch (_) {}
    for (let i = 0; i < 60 && serverManager.status().world.running; i++) await schlaf(1000)
  }

  send('maintenance:progress', { phase: 'restart', meldung: 'Worldserver wird neu gestartet ...' })
  const r = await serverManager.start('world')
  // Hat der Auto-Restart ihn schon angestellt, gilt das als Erfolg.
  const ok = (r && r.ok) || (r && /läuft bereits/i.test(r.error || ''))
  /*
   * Ergebnis merken: "lief der nächtliche Neustart?" soll man später
   * beantworten können - bisher stand es nur im Momentan-Log.
   */
  try {
    store.write({
      maintenance: {
        letzterRestart: {
          zeit: new Date().toISOString(),
          ok: !!ok,
          meldung: ok ? 'erfolgreich' : ((r && r.error) || 'unbekannt')
        }
      }
    })
  } catch (_) {}
  if (ok) {
    require('./notify').melde('Worldserver neu gestartet', 'Geplanter Neustart abgeschlossen - Spieler können sich wieder verbinden.')
  } else {
    require('./notify').melde('Worldserver-Neustart fehlgeschlagen', (r && r.error) || 'unbekannt')
  }
  return r
}

/*
 * Datenbank-Wartung nach Plan: ANALYZE (sicher, schnell) oder OPTIMIZE
 * (rebuildet Tabellen, kann dauern). Ergebnis und Fehler werden gemerkt,
 * damit die Einstellungen den letzten Lauf zeigen koennen.
 */
async function dbWarten () {
  const m = einstellungen()
  const modus = m.dbModus === 'optimize' ? 'optimize' : 'analyze'
  send('maintenance:progress', { phase: 'db', meldung: `Datenbank-Wartung (${modus}) läuft …` })
  try {
    const r = await require('./system').dbWartung({ modus })
    const meldung = `${r.tabellen || 0} Tabellen in ${r.dauerSek || 0} s`
    try {
      store.write({ maintenance: { letzteDbWartung: { zeit: new Date().toISOString(), ok: true, meldung, modus } } })
    } catch (_) {}
    send('maintenance:progress', { phase: 'db', meldung: `Datenbank-Wartung abgeschlossen: ${meldung}.` })
    require('./notify').melde('Datenbank-Wartung abgeschlossen', meldung)
    /*
     * Optionaler Integritaetscheck direkt danach. Fehler dabei sind ein
     * eigener Befund und machen die Wartung nicht rueckwirkend kaputt.
     */
    if (m.dbCheck) {
      try {
        await dbPruefen()
      } catch (_) {}
    }
    return { ok: true, result: r }
  } catch (e) {
    try {
      store.write({ maintenance: { letzteDbWartung: { zeit: new Date().toISOString(), ok: false, meldung: e.message, modus } } })
    } catch (_) {}
    send('maintenance:progress', { phase: 'db', meldung: `Datenbank-Wartung fehlgeschlagen: ${e.message}` })
    require('./notify').melde('Datenbank-Wartung fehlgeschlagen', e.message)
    return { ok: false, error: e.message }
  }
}

/*
 * Abgelaufene Bans: taeglich nach Plan oder manuell. "Nur melden" zaehlt
 * die betroffenen Eintraege, ohne sie zu loeschen - fuer Server, auf denen
 * ein abgelaufener Ban noch nachvollziehbar bleiben soll.
 */
async function banAufraeumen () {
  const m = einstellungen()
  const nurMelden = m.banCleanupNurMelden === true
  send('maintenance:progress', {
    phase: 'bans',
    meldung: nurMelden ? 'Abgelaufene Bans werden gezählt …' : 'Abgelaufene Bans werden entfernt …'
  })
  try {
    const r = await require('./bans').aufraeumen({ nurMelden })
    const anzahl = nurMelden ? (r.betroffen || 0) : (r.entfernt || 0)
    const eintrag = {
      zeit: new Date().toISOString(),
      ok: true,
      nurGemeldet: nurMelden,
      anzahl
    }
    try { store.write({ maintenance: { letzteBanReinigung: eintrag } }) } catch (_) {}
    if (anzahl > 0) {
      require('./notify').melde(
        nurMelden ? 'Abgelaufene Bans gefunden' : 'Abgelaufene Bans entfernt',
        `${anzahl} Einträge${nurMelden ? ' (nicht gelöscht)' : ''}.`
      )
    }
    send('maintenance:progress', {
      phase: 'bans',
      meldung: `${anzahl} abgelaufene Ban-Einträge ${nurMelden ? 'gefunden' : 'entfernt'}.`
    })
    return { ok: true, ...r, anzahl }
  } catch (e) {
    const eintrag = { zeit: new Date().toISOString(), ok: false, meldung: e.message }
    try { store.write({ maintenance: { letzteBanReinigung: eintrag } }) } catch (_) {}
    send('maintenance:progress', { phase: 'bans', meldung: `Ban-Bereinigung fehlgeschlagen: ${e.message}` })
    require('./notify').melde('Ban-Bereinigung fehlgeschlagen', e.message)
    return { ok: false, error: e.message }
  }
}

/*
 * Datenbank-Integritaet: CHECK TABLE fuer alle Tabellen der drei Datenbanken.
 * Meldet nur Tabellen, die nicht "status ok" zurueckgeben. Laeuft in
 * Bloecken, damit die Anweisung nicht zu lang wird.
 */
async function dbPruefen () {
  send('maintenance:progress', { phase: 'dbcheck', meldung: 'Datenbank-Integrität wird geprüft …' })
  try {
    const r = await require('./system').dbPruefen()
    const meldung = `${r.geprueft || 0} Tabellen in ${r.dauerSek || 0} s, ${(r.auffaellig || []).length} Auffälligkeiten`
    try {
      store.write({
        maintenance: {
          letzteDbPruefung: {
            zeit: new Date().toISOString(),
            ok: r.ok === true,
            meldung,
            geprueft: r.geprueft || 0,
            auffaellig: (r.auffaellig || []).slice(0, 20)
          }
        }
      })
    } catch (_) {}
    send('maintenance:progress', { phase: 'dbcheck', meldung: `Integritätsprüfung abgeschlossen: ${meldung}.` })
    require('./notify').melde(
      r.ok ? 'Datenbank-Integrität in Ordnung' : 'Datenbank-Integrität: Auffälligkeiten',
      meldung
    )
    return { ok: r.ok === true, ...r }
  } catch (e) {
    try {
      store.write({
        maintenance: {
          letzteDbPruefung: { zeit: new Date().toISOString(), ok: false, meldung: e.message, geprueft: 0, auffaellig: [] }
        }
      })
    } catch (_) {}
    send('maintenance:progress', { phase: 'dbcheck', meldung: `Integritätsprüfung fehlgeschlagen: ${e.message}` })
    require('./notify').melde('Integritätsprüfung fehlgeschlagen', e.message)
    return { ok: false, error: e.message }
  }
}

function planStarten () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const p = plan()
  /*
   * Der Minuten-Timer läuft unabhängig vom Update-Schalter: auch der
   * geplante Weltserver-Neustart will zu seiner Uhrzeit angetipft werden,
   * auch wenn das automatische Update aus ist.
   */
  let letzterStartTag = ''
  let letzterRestartTag = ''
  let letzterDbTag = ''
  let letzterBanTag = ''
  let letzteRamPruefung = 0
  timer = setInterval(() => {
    const jetzt = new Date()
    const schluessel = `${jetzt.getFullYear()}-${jetzt.getMonth()}-${jetzt.getDate()}`
    /*
     * Wochentag: 0 = täglich, 1..7 = Mo..So. JS liefert 0=So..6=Sa,
     * deshalb die Umrechnung - sonst liefe "Montag" am Sonntag.
     */
    const geplanterTag = p.wochentag === 0 ? -1 : p.wochentag === 7 ? 0 : p.wochentag
    const tagPasst = geplanterTag === -1 || jetzt.getDay() === geplanterTag
    if (p.enabled && tagPasst && jetzt.getHours() === p.stunde && jetzt.getMinutes() === p.minute && letzterStartTag !== schluessel) {
      letzterStartTag = schluessel
      ausfuehren().catch(() => {})
    }
    if (p.restartAktiv && jetzt.getHours() === p.restartStunde && jetzt.getMinutes() === p.restartMinute && letzterRestartTag !== schluessel) {
      letzterRestartTag = schluessel
      weltserverNeustarten().catch(() => {})
    }
    const dbTagPasst = p.dbWochentag === 0 ? true : jetzt.getDay() === (p.dbWochentag === 7 ? 0 : p.dbWochentag)
    if (p.dbAktiv && dbTagPasst && jetzt.getHours() === p.dbStunde && jetzt.getMinutes() === p.dbMinute && letzterDbTag !== schluessel) {
      letzterDbTag = schluessel
      dbWarten().catch(() => {})
    }
    /*
     * Ban-Bereinigung: taeglich zur eingestellten Uhrzeit. Der Tag wird
     * gemerkt, damit der Minutentakt nicht mehrfach ausloest.
     */
    if (p.banCleanup && jetzt.getHours() === p.banCleanupStunde && jetzt.getMinutes() === p.banCleanupMinute && letzterBanTag !== schluessel) {
      letzterBanTag = schluessel
      banAufraeumen().catch(() => {})
    }
    /*
     * Speicherhygiene: Bot-Server fressen binnen Stunden RAM. Ist eine
     * Schwelle gesetzt, wird höchstens alle 30 Minuten geprüft und bei
     * Überschreitung der vorhandene Neustart-Ablauf (Ansage, Leer-Check,
     * harter Stop) ausgelöst.
     */
    if (p.restartRamMb > 0 && Date.now() - letzteRamPruefung > 30 * 60 * 1000) {
      letzteRamPruefung = Date.now()
      ;(async () => {
        try {
          const m = await require('../server-manager').metriken()
          const ram = Number(m && m.world && m.world.ramMb) || 0
          if (ram > p.restartRamMb) {
            send('maintenance:progress', {
              phase: 'restart',
              meldung: `Arbeitsspeicher ${ram} MB über Schwelle ${p.restartRamMb} MB - Neustart wird angesetzt.`
            })
            await weltserverNeustarten()
          }
        } catch (_) {}
      })()
    }
  }, 60000)
  if (timer.unref) timer.unref()
  return {
    ok: true,
    enabled: p.enabled,
    restartAktiv: p.restartAktiv,
    naechster: p.enabled ? naechsterLauf(p.stunde, p.minute, p.wochentag).toISOString() : null,
    naechsterRestart: p.restartAktiv ? naechsterLauf(p.restartStunde, p.restartMinute).toISOString() : null,
    naechsteDbWartung: p.dbAktiv ? naechsterLauf(p.dbStunde, p.dbMinute, p.dbWochentag).toISOString() : null,
    naechsteBanReinigung: p.banCleanup ? naechsterLauf(p.banCleanupStunde, p.banCleanupMinute).toISOString() : null
  }
}

function planStoppen () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function einstellungenSetzen (patch = {}) {
  const alt = einstellungen()
  const zahl = (wert, fallback, min, max) => {
    const n = Number(wert)
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback))
  }
  store.write({
    maintenance: {
      enabled: patch.enabled === true,
      stunde: Number(patch.stunde) || 3,
      minute: Number.isInteger(Number(patch.minute)) ? Number(patch.minute) : 0,
      wochentag: Math.min(7, Math.max(0, Number(patch.wochentag) || 0)),
      nurBeiLeer: patch.nurBeiLeer === true,
      warteMinuten: Number(patch.warteMinuten) || 15,
      botKontoPraefixe: String(patch.botKontoPraefixe || 'rndbot, ahbot, playerbots'),
      restartAktiv: patch.restartAktiv === true,
      restartStunde: Number(patch.restartStunde) || 6,
      restartMinute: Number.isInteger(Number(patch.restartMinute)) ? Number(patch.restartMinute) : 0,
      restartVorwarnSek: Number(patch.restartVorwarnSek) || 60,
      restartRamMb: Math.max(0, Number(patch.restartRamMb) || 0),
      // Neue Felder nur ueberschreiben, wenn sie im Patch stehen - sonst
      // wuerde jedes Speichern der Update-Zeiten die DB-Wartung abschalten.
      dbAktiv: patch.dbAktiv != null ? patch.dbAktiv === true : alt.dbAktiv === true,
      dbWochentag: zahl(patch.dbWochentag != null ? patch.dbWochentag : alt.dbWochentag, 7, 0, 7),
      dbStunde: zahl(patch.dbStunde != null ? patch.dbStunde : alt.dbStunde, 4, 0, 23),
      dbMinute: zahl(patch.dbMinute != null ? patch.dbMinute : alt.dbMinute, 30, 0, 59),
      dbModus: (patch.dbModus || alt.dbModus) === 'optimize' ? 'optimize' : 'analyze',
      dbCheck: patch.dbCheck != null ? patch.dbCheck === true : alt.dbCheck === true,
      banCleanup: patch.banCleanup != null ? patch.banCleanup === true : alt.banCleanup === true,
      banCleanupStunde: zahl(patch.banCleanupStunde != null ? patch.banCleanupStunde : alt.banCleanupStunde, 5, 0, 23),
      banCleanupMinute: zahl(patch.banCleanupMinute != null ? patch.banCleanupMinute : alt.banCleanupMinute, 0, 0, 59),
      banCleanupNurMelden: patch.banCleanupNurMelden != null
        ? patch.banCleanupNurMelden === true
        : alt.banCleanupNurMelden === true
    }
  })
  return { ok: true, plan: plan(), started: planStarten() }
}

module.exports = {
  init,
  plan,
  planStarten,
  planStoppen,
  einstellungenSetzen,
  ausfuehren,
  weltserverNeustarten,
  dbWarten,
  dbPruefen,
  banAufraeumen,
  laeuftGerade: () => laeuftGerade,
  // Fuer Pruefskripte: reine Uhrzeit-/Planlogik ohne Timer
  __intern: { naechsterLauf, plan }
}
