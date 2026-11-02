/* QuickDev Recorder - service worker.
 * Keeps one recording per browser tab, injects the recorder into the tab's frames, collects what the recorder
 * reports, and plays tours in the page. State lives in chrome.storage.session because the worker can be stopped by the
 * browser at any time. */
importScripts('shared.js')

const T = self.TourdExt
const KEY = (tabId) => `tab:${tabId}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- state, one writer per tab at a time ---------------------------------------------------------------------

const queues = new Map()
function withTab(tabId, fn) {
  const run = (queues.get(tabId) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.session.get(KEY(tabId))
      const state = stored[KEY(tabId)] ?? T.idleState()
      const result = await fn(state)
      await chrome.storage.session.set({ [KEY(tabId)]: state })
      publish(tabId, state)
      return result
    })
  queues.set(tabId, run)
  return run
}

function publish(tabId, state) {
  chrome.runtime.sendMessage({ type: 'state', tabId, state: T.publicState(state) }).catch(() => {})
  const text =
    state.status === 'idle' || state.status === 'stopped' ? '' : String(state.steps.length)
  chrome.action.setBadgeText({ tabId, text }).catch(() => {})
  chrome.action
    .setBadgeBackgroundColor({ tabId, color: state.status === 'paused' ? '#b57600' : '#c4314b' })
    .catch(() => {})
}

// ---- injection -----------------------------------------------------------------------------------------------

/** Runs in the page: starts the recorder if UI5 is there and ready. */
function startRecorderInPage(options) {
  try {
    if (!window.sap || !window.sap.ui) return { ok: false, reason: 'no-ui5' }
    if (!window.__tourdRecorder) return { ok: false, reason: 'no-recorder' }
    if (window.__tourdRecorder.isRecording()) return { ok: true }
    window.__tourdRecorder.start(options)
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      reason: /not ready/i.test(String(e && e.message)) ? 'not-ready' : String(e && e.message),
    }
  }
}

function stopRecorderInPage() {
  try {
    if (window.__tourdRecorder) window.__tourdRecorder.stop()
  } catch (e) {
    /* nothing to stop */
  }
}

function setPausedInPage(paused) {
  try {
    if (!window.__tourdRecorder) return
    if (paused) window.__tourdRecorder.pause()
    else window.__tourdRecorder.resume()
  } catch (e) {
    /* ignore */
  }
}

async function inject(target, options, waitMs) {
  await chrome.scripting.executeScript({ target, files: ['recorder.js'], world: 'MAIN' })
  await chrome.scripting.executeScript({ target, files: ['bridge.js'], world: 'ISOLATED' })
  const deadline = Date.now() + waitMs
  let results = []
  for (;;) {
    results = await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: startRecorderInPage,
      args: [options],
    })
    const started = results.some((r) => r.result && r.result.ok)
    const waiting = results.some(
      (r) => r.result && (r.result.reason === 'not-ready' || r.result.reason === 'no-ui5'),
    )
    if (started || !waiting || Date.now() > deadline) return results
    await sleep(250)
  }
}

const OPTIONS = { bridge: true }

// ---- commands from the panel ---------------------------------------------------------------------------------

async function start(tabId, purpose) {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const state = await withTab(tabId, (s) => {
    Object.assign(s, T.idleState(), {
      status: 'recording',
      startUrl: tab ? tab.url : null,
      purpose: T.PURPOSES.includes(purpose) ? purpose : 'both',
      startedAt: Date.now(),
      t0: Date.now(),
    })
    return s
  })
  let results
  try {
    results = await inject({ tabId, allFrames: true }, OPTIONS, 3000)
  } catch (e) {
    await withTab(tabId, (s) =>
      Object.assign(s, T.idleState(), { error: `This page cannot be recorded (${e.message}).` }),
    )
    return
  }
  if (!results.some((r) => r.result && r.result.ok)) {
    const reasons = results.map((r) => r.result && r.result.reason)
    const error =
      reasons.includes('no-ui5') || reasons.includes('not-ready')
        ? 'This page does not use UI5 (or UI5 is still loading). Open your app and try again.'
        : `The recorder could not start (${reasons.filter(Boolean).join(', ') || 'unknown reason'}).`
    await withTab(tabId, (s) => Object.assign(s, T.idleState(), { error }))
  }
  return state
}

async function stop(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: stopRecorderInPage })
    .catch(() => {})
  return withTab(tabId, (s) => {
    if (s.status === 'recording' || s.status === 'paused') s.status = 'stopped'
  })
}

async function setPaused(tabId, paused) {
  await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: setPausedInPage,
      args: [paused],
    })
    .catch(() => {})
  return withTab(tabId, (s) => {
    if (s.status === 'recording' || s.status === 'paused')
      s.status = paused ? 'paused' : 'recording'
  })
}

function onFrameEvent(tabId, frameId, data) {
  return withTab(tabId, (s) => {
    if (s.status !== 'recording') return
    if (data.type === 'started') {
      // describe the app by its top frame; a reload must not replace what the recording started with
      if (!s.app || (frameId === 0 && s.appFrame !== 0)) {
        s.app = data.app
        s.appFrame = frameId
      }
      if (!s.recorder) s.recorder = data.recorder || ''
    } else if (data.type === 'selector' && data.selector) {
      // UI5's selector for a control arrives a moment after the step it belongs to
      const step = s.steps.find((x) => x._frame === frameId && x._local === data.local)
      if (step && step.control) step.control.selector = data.selector
    } else if (data.type === 'step' && data.step) {
      T.addStep(s, frameId, data.step, Date.now())
      if (data.step.type === 'check') cancelPick(tabId)
    }
  })
}

// ---- checks: point at a control and the recording gets a check of what it shows -----------------------------------

function pickCheckInPage() {
  try {
    if (window.__tourdRecorder && window.__tourdRecorder.isRecording())
      window.__tourdRecorder.pickCheck()
  } catch (e) {
    /* this frame has no recorder */
  }
}

function cancelPickInPage() {
  try {
    if (window.__tourdRecorder) window.__tourdRecorder.cancelPick()
  } catch (e) {
    /* nothing to cancel */
  }
}

function pickToastInPage() {
  try {
    if (window.__tourdRecorder && window.__tourdRecorder.isRecording())
      window.__tourdRecorder.pickToast()
  } catch (e) {
    /* this frame has no recorder or no UI5 */
  }
}

async function pickToast(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: pickToastInPage })
    .catch(() => {})
  return { ok: true }
}

async function pickCheck(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: pickCheckInPage })
    .catch(() => {})
  return { ok: true }
}

async function cancelPick(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: cancelPickInPage })
    .catch(() => {})
  return { ok: true }
}

// ---- tours -----------------------------------------------------------------------------------------------------

/** In the page: the ids of the apps (sap.app/id of every component) that are running. */
function appIdsInPage() {
  try {
    const C =
      window.sap &&
      window.sap.ui &&
      window.sap.ui.require &&
      window.sap.ui.require('sap/ui/core/Component')
    if (!C || !C.registry) return []
    return C.registry
      .filter(() => true)
      .map((c) => (c.getManifestEntry ? c.getManifestEntry('/sap.app/id') : null))
      .filter(Boolean)
  } catch (e) {
    return []
  }
}

/** In the page: is a tour playing, is help shown (by the extension or by the app itself)? */
function liveStateInPage() {
  try {
    const r = window.sap && window.sap.ui && window.sap.ui.require
    const tour = r && r('tourd/live/TourPlayer')
    const help = r && r('tourd/live/HelpLayer')
    return {
      tour: !!(tour && tour.getActive && tour.getActive()),
      help: !!(help && help.getActive && help.getActive()),
    }
  } catch (e) {
    return { tour: false, help: false }
  }
}

async function liveState(tabId) {
  const results = await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: liveStateInPage })
    .catch(() => [])
  return {
    tour: results.some((r) => r.result && r.result.tour),
    help: results.some((r) => r.result && r.result.help),
  }
}

async function appIds(tabId) {
  const results = await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: appIdsInPage })
    .catch(() => [])
  return { ids: [...new Set(results.flatMap((r) => r.result || []))] }
}

function probeUi5() {
  try {
    return !!(window.sap && window.sap.ui && window.sap.ui.require)
  } catch (e) {
    return false
  }
}

/** In the page: UI5 has drawn controls and has nothing left to wait for (what wdi5 waits for before it looks for a control). */
function appReadyInPage() {
  return new Promise(function (resolve) {
    var until = Date.now() + 8000
    function drawn() {
      return !!document.querySelector('[data-sap-ui]')
    }
    function stable() {
      try {
        window.sap.ui.require(
          ['sap/ui/test/RecordReplay'],
          function (RR) {
            RR.waitForUI5({ timeout: 15000 }).then(
              function () {
                resolve(true)
              },
              function () {
                resolve(false)
              },
            )
          },
          function () {
            resolve(false)
          },
        )
      } catch (e) {
        resolve(false)
      }
    }
    function check() {
      if (!(window.sap && window.sap.ui && window.sap.ui.require)) return resolve(false)
      if (drawn()) return stable()
      if (Date.now() > until) return resolve(false)
      setTimeout(check, 200)
    }
    check()
  })
}

function startTourInPage(tour) {
  return new Promise((resolve) => {
    try {
      window.sap.ui.require(
        ['tourd/live/TourPlayer'],
        (Player) => {
          Player.start(tour, { debug: true }).then(
            () => resolve({ ok: true }),
            (e) => resolve({ ok: false, reason: String((e && e.message) || e) }),
          )
        },
        (e) => resolve({ ok: false, reason: String(e) }),
      )
    } catch (e) {
      resolve({ ok: false, reason: String((e && e.message) || e) })
    }
  })
}

function stopTourInPage() {
  try {
    window.sap.ui.require(['tourd/live/TourPlayer'], (Player) => Player.stop())
  } catch (e) {
    /* no tour running */
  }
}

async function playTour(tabId, tour) {
  const probes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: probeUi5,
  })
  const frame = probes.find((p) => p.frameId === 0 && p.result) ?? probes.find((p) => p.result)
  if (!frame)
    return {
      ok: false,
      reason: 'This page does not use UI5, so there is nothing to show the tour in.',
    }
  const target = { tabId, frameIds: [frame.frameId] }
  await chrome.scripting.executeScript({ target, files: ['live-player.js'], world: 'MAIN' })
  const [res] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: startTourInPage,
    args: [tour],
  })
  return res.result ?? { ok: false, reason: 'The page did not answer.' }
}

async function stopTour(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: stopTourInPage })
    .catch(() => {})
  return { ok: true }
}

// ---- tests ------------------------------------------------------------------------------------------------------

function replayInPage(plan) {
  return window.__tourdReplay.run(plan).then(
    (r) => ({ ok: true, ...r }),
    (e) => ({ ok: false, reason: String((e && e.message) || e) }),
  )
}

function stopReplayInPage() {
  try {
    window.__tourdReplay.stop()
  } catch (e) {
    /* nothing runs */
  }
}

/**
 * Opens the app again where the recording started, as a fresh page load, and waits until UI5 is there. A recording
 * is tried from the beginning: after recording the app is in its end state (an order created, a dialog open).
 */
async function reopenAtStart(tabId) {
  const startUrl = await withTab(tabId, (s) => s.startUrl)
  if (!startUrl)
    return { ok: false, reason: 'The address where the recording started is not known.' }
  // "loading" and then "complete" is a page load; a change of the hash alone loads nothing and must not count
  let loading = false
  const loaded = new Promise((resolve) => {
    const done = (ok) => {
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve(ok)
    }
    const listener = (id, info) => {
      if (id !== tabId) return
      if (info.status === 'loading') loading = true
      if (info.status === 'complete' && loading) done(true)
    }
    const timer = setTimeout(() => done(false), 30000)
    chrome.tabs.onUpdated.addListener(listener)
  })
  await chrome.tabs.update(tabId, { url: startUrl })
  // the address alone may change only the hash (nothing loads): then the page is reloaded, once, and only then
  await sleep(1200)
  if (!loading) await chrome.tabs.reload(tabId)
  if (!(await loaded)) return { ok: false, reason: 'The app did not finish loading.' }

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const ready = await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: appReadyInPage })
      .catch(() => [])
    if (ready.some((p) => p.result)) return { ok: true }
    await sleep(500)
  }
  return { ok: false, reason: 'The app did not start (UI5 is not there). Open it and try again.' }
}

/** Runs the steps of a wdi5 test plan in the app that is open (the frame that has UI5, like playTour). */
async function replayPlan(tabId, plan) {
  const probes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: probeUi5,
  })
  const frame = probes.find((p) => p.frameId === 0 && p.result) ?? probes.find((p) => p.result)
  if (!frame)
    return {
      ok: false,
      reason: 'This page does not use UI5, so there is nothing to run the tests in.',
    }
  const target = { tabId, frameIds: [frame.frameId] }
  await chrome.scripting.executeScript({ target, files: ['replay.js'], world: 'MAIN' })
  const [res] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: replayInPage,
    args: [plan],
  })
  return res.result ?? { ok: false, reason: 'The page did not answer.' }
}

async function stopReplay(tabId) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: stopReplayInPage })
    .catch(() => {})
  return { ok: true }
}

// ---- help: point at controls, show the help in the page as a preview ----------------------------------------------

const HELPKEY = (tabId) => `help:${tabId}`
const getHelp = async (tabId) =>
  (await chrome.storage.session.get(HELPKEY(tabId)))[HELPKEY(tabId)] ?? null
const setHelp = (tabId, value) =>
  value
    ? chrome.storage.session.set({ [HELPKEY(tabId)]: value })
    : chrome.storage.session.remove(HELPKEY(tabId))

function hasRecorderInPage() {
  return !!window.__tourdRecorder
}

/** Tells the page (through bridge.js) what was picked. No recording is needed for this. */
function helpPickInPage() {
  try {
    const r = window.__tourdRecorder
    if (!r || !r.pick) return
    r.pick(function (d) {
      window.postMessage(
        {
          tourd: 'recorder',
          type: 'helpPick',
          control: d || null,
          title: document.title || '',
          hash: String(window.location.hash || '').replace(/^#/, ''),
        },
        '*',
      )
    }, 'Click the control the help is about · Esc to cancel')
  } catch (e) {
    /* this frame has no recorder */
  }
}

function helpModulesInPage() {
  try {
    const r = window.sap && window.sap.ui && window.sap.ui.require
    return {
      ui5: !!r,
      player: !!(r && r('tourd/live/TourPlayer')),
      help: !!(r && r('tourd/live/HelpLayer')),
      helpVersion: (r && r('tourd/live/HelpLayer') && r('tourd/live/HelpLayer').version) || null,
    }
  } catch (e) {
    return { ui5: false, player: false, help: false, helpVersion: null }
  }
}

function helpShowInPage(help, open, topicId) {
  return new Promise((resolve) => {
    try {
      window.sap.ui.require(
        ['tourd/live/HelpLayer'],
        (H) => {
          H.update(help, { open })
            .then(
              () => (topicId ? H.openTopic(topicId) : null),
              (e) => resolve({ ok: false, reason: String((e && e.message) || e) }),
            )
            .then(
              () => resolve({ ok: true }),
              (e) => resolve({ ok: false, reason: String((e && e.message) || e) }),
            )
        },
        (e) => resolve({ ok: false, reason: String(e) }),
      )
    } catch (e) {
      resolve({ ok: false, reason: String((e && e.message) || e) })
    }
  })
}

function helpStopInPage() {
  try {
    window.sap.ui.require(['tourd/live/HelpLayer'], (H) => H.stop())
  } catch (e) {
    /* no help is shown */
  }
}

/** Gives the frames of the tab the picker (the recorder, which only points and describes here) and its bridge. */
async function injectPicker(target) {
  const probes = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: hasRecorderInPage,
  })
  const missing = probes.filter((p) => !p.result).map((p) => p.frameId)
  if (!missing.length) return
  const t = { tabId: target.tabId, frameIds: missing }
  await chrome.scripting.executeScript({ target: t, files: ['recorder.js'], world: 'MAIN' })
  await chrome.scripting.executeScript({ target: t, files: ['bridge.js'], world: 'ISOLATED' })
}

async function helpStart(tabId) {
  await setHelp(tabId, { active: true, frame: null })
  try {
    await injectPicker({ tabId, allFrames: true })
  } catch (e) {
    await setHelp(tabId, null)
    return { ok: false, reason: `This page cannot be used (${e.message}).` }
  }
  return { ok: true }
}

async function helpPick(tabId) {
  await injectPicker({ tabId, allFrames: true })
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: helpPickInPage })
    .catch(() => {})
  return { ok: true }
}

/** Shows the help in the frame the author works in (the one something was picked in, else the app's top UI5 frame). */
/** The version of the help layer this extension carries (read from its own file). */
let helpVersionCache = null
async function expectedHelpVersion() {
  if (helpVersionCache) return helpVersionCache
  try {
    const text = await (await fetch(chrome.runtime.getURL('live-help.js'))).text()
    helpVersionCache = /var VERSION = "([^"]+)"/.exec(text)?.[1] ?? null
  } catch (e) {
    /* not known: nothing is compared */
  }
  return helpVersionCache
}

/**
 * Shows help in the page. While help is being written (`state.active`) every preview comes from the author's panel; a
 * preview that was asked for before "Stop writing help" must not bring the help back after it. `view` is the other use:
 * showing the saved help of the project as it is, which needs no writing session.
 */
async function helpShow(tabId, help, open, topicId, view) {
  const state = (await getHelp(tabId)) ?? { active: false, frame: null }
  if (!view && !state.active)
    return { ok: false, reason: 'Writing help is not running in this tab.' }
  let frames = []
  for (const deadline = Date.now() + 8000; ;) {
    const probes = await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: helpModulesInPage })
      .catch(() => [])
    frames = probes.filter((p) => p.result && p.result.ui5)
    if (frames.length || Date.now() > deadline) break
    await sleep(300)
  }
  const frame =
    frames.find((p) => p.frameId === state.frame) ??
    frames.find((p) => p.frameId === 0) ??
    frames[0]
  if (!frame)
    return {
      ok: false,
      reason: 'This page does not use UI5, so there is nowhere to show the help.',
    }
  // A page keeps the help layer it was given until it is reloaded: after the extension was updated that is an old one.
  const expected = await expectedHelpVersion()
  if (frame.result.help && expected && frame.result.helpVersion !== expected)
    return {
      ok: false,
      reason:
        'This tab still has the help layer of an older version of the extension. Reload the tab (F5) and try again.',
    }
  const target = { tabId, frameIds: [frame.frameId] }
  if (!frame.result.player)
    await chrome.scripting.executeScript({ target, files: ['live-player.js'], world: 'MAIN' })
  if (!frame.result.help)
    await chrome.scripting.executeScript({ target, files: ['live-help.js'], world: 'MAIN' })
  const [res] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: helpShowInPage,
    args: [help, !!open, topicId || null],
  })
  return res.result ?? { ok: false, reason: 'The page did not answer.' }
}

// show and stop of one tab run one after the other, so the last word is always the user's
const helpQueues = new Map()
function inOrder(tabId, fn) {
  const run = (helpQueues.get(tabId) ?? Promise.resolve()).catch(() => {}).then(fn)
  helpQueues.set(tabId, run)
  return run
}

async function helpStop(tabId) {
  await setHelp(tabId, null) // from now on a late preview is refused
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: helpStopInPage })
    .catch(() => {})
  await cancelPick(tabId)
  return { ok: true }
}

async function onHelpPick(tabId, frameId, data) {
  const state = await getHelp(tabId)
  if (state) await setHelp(tabId, { ...state, frame: frameId })
  await cancelPick(tabId)
  chrome.runtime
    .sendMessage({
      type: 'helpPick',
      tabId,
      frameId,
      control: data.control,
      title: data.title,
      hash: data.hash,
    })
    .catch(() => {})
}

// ---- messages ------------------------------------------------------------------------------------------------

async function handle(msg, sender) {
  if (msg.cmd === 'frame-event') {
    if (!sender.tab) return { ok: true }
    if (msg.data && msg.data.type === 'helpPick')
      await onHelpPick(sender.tab.id, sender.frameId ?? 0, msg.data)
    else await onFrameEvent(sender.tab.id, sender.frameId ?? 0, msg.data)
    return { ok: true }
  }
  const tabId = msg.tabId
  switch (msg.cmd) {
    case 'status':
      return withTab(tabId, (s) => T.publicState(s))
    case 'start':
      await start(tabId, msg.purpose)
      return withTab(tabId, (s) => T.publicState(s))
    case 'stop':
      await stop(tabId)
      return withTab(tabId, (s) => T.publicState(s))
    case 'pause':
    case 'resume':
      await setPaused(tabId, msg.cmd === 'pause')
      return withTab(tabId, (s) => T.publicState(s))
    case 'removeStep':
      return withTab(tabId, (s) => (T.removeStep(s, msg.index), T.publicState(s)))
    case 'undo':
      return withTab(tabId, (s) => (T.removeStep(s, s.steps.length - 1), T.publicState(s)))
    case 'addNote':
      return withTab(tabId, (s) => (T.addNote(s, msg.text, Date.now()), T.publicState(s)))
    case 'setExplain':
      return withTab(tabId, (s) => (T.setExplain(s, msg.index, msg.text), T.publicState(s)))
    case 'clear':
      return withTab(tabId, (s) => (Object.assign(s, T.idleState()), T.publicState(s)))
    case 'recording':
      return withTab(tabId, (s) => T.buildRecording(s))
    case 'pickCheck':
      return pickCheck(tabId)
    case 'pickToast':
      return pickToast(tabId)
    case 'cancelPick':
      return cancelPick(tabId)
    case 'playTour':
      return playTour(tabId, msg.tour)
    case 'stopTour':
      return stopTour(tabId)
    case 'reopenStart':
      return reopenAtStart(tabId)
    case 'replayPlan':
      return replayPlan(tabId, msg.plan)
    case 'stopReplay':
      return stopReplay(tabId)
    case 'helpStart':
      return helpStart(tabId)
    case 'helpPick':
      return helpPick(tabId)
    case 'helpCancel':
      return cancelPick(tabId)
    case 'liveState':
      return liveState(tabId)
    case 'appIds':
      return appIds(tabId)
    case 'helpShow':
      return inOrder(tabId, () => helpShow(tabId, msg.help, msg.open, msg.topicId, msg.view))
    case 'helpStop':
      return inOrder(tabId, () => helpStop(tabId))
    default:
      return { error: `Unknown command ${msg.cmd}` }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.cmd !== 'string') return false
  handle(msg, sender).then(sendResponse, (e) =>
    sendResponse({ error: String((e && e.message) || e) }),
  )
  return true // the answer comes later
})

// ---- pages that reload or open frames while recording ------------------------------------------------------------

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // a page that reloads while help is being written: the picker comes back and the panel shows the preview again
  const help = await getHelp(details.tabId)
  if (help && help.active) {
    try {
      for (const deadline = Date.now() + 20000; ;) {
        const probes = await chrome.scripting.executeScript({
          target: { tabId: details.tabId, frameIds: [details.frameId] },
          world: 'MAIN',
          func: helpModulesInPage,
        })
        if (probes[0]?.result?.ui5 || Date.now() > deadline) break
        await sleep(250)
      }
      await injectPicker({ tabId: details.tabId, frameIds: [details.frameId] })
      chrome.runtime
        .sendMessage({ type: 'helpReload', tabId: details.tabId, frameId: details.frameId })
        .catch(() => {})
    } catch (e) {
      /* a page that cannot be scripted is simply not used */
    }
  }
  const stored = await chrome.storage.session.get(KEY(details.tabId))
  const s = stored[KEY(details.tabId)]
  if (!s || (s.status !== 'recording' && s.status !== 'paused')) return
  try {
    await inject({ tabId: details.tabId, frameIds: [details.frameId] }, OPTIONS, 20000)
    if (s.status === 'paused')
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        world: 'MAIN',
        func: setPausedInPage,
        args: [true],
      })
  } catch (e) {
    /* a page that cannot be scripted (error page, store) is simply not recorded */
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(KEY(tabId))
  chrome.storage.session.remove(HELPKEY(tabId))
  queues.delete(tabId)
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
