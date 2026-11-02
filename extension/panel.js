/* QuickDev Recorder - side panel. Talks to the service worker (recording, playing) and to QuickDev (projects, tours). */
;(function () {
  'use strict'

  const T = self.TourdExt
  const $ = (id) => document.getElementById(id)
  const params = new URLSearchParams(location.search)
  const pinnedTab = params.has('tabId') // opened as a normal tab for one specific tab (tests, debugging)

  let tabId = pinnedTab ? Number(params.get('tabId')) : null
  let state = null
  let settings = { tourdUrl: 'http://localhost:4044', token: '' }
  let projects = []
  let finished = null // the recording that was built when recording stopped

  // ---- helpers -------------------------------------------------------------------------------------------------

  const call = (cmd, extra) => chrome.runtime.sendMessage({ cmd, tabId, ...extra })

  function show(el, text, kind) {
    el.hidden = !text
    el.textContent = text || ''
    el.className = 'message' + (kind ? ` ${kind}` : '')
  }

  async function tourd(path, options = {}) {
    const base = settings.tourdUrl.replace(/\/+$/, '')
    let res
    try {
      res = await fetch(base + path, {
        ...options,
        headers: {
          'X-TourD-Token': settings.token,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
      })
    } catch {
      throw new Error(`QuickDev does not answer at ${base}. Is it running?`)
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        const text = await res.text()
        try {
          message = JSON.parse(text)?.error?.message ?? text ?? message
        } catch {
          message = text || message
        }
      } catch {
        /* keep the status */
      }
      throw new Error(message)
    }
    return res.json()
  }

  // ---- settings ------------------------------------------------------------------------------------------------

  async function loadSettings() {
    const stored = await chrome.storage.local.get(['tourdUrl', 'token', 'lastProject', 'lastTab'])
    settings = {
      tourdUrl: stored.tourdUrl || settings.tourdUrl,
      token: stored.token || '',
      lastProject: stored.lastProject,
      lastTab: stored.lastTab,
    }
    $('tourd-url').value = settings.tourdUrl
    $('tourd-token').value = settings.token
    if (!settings.token) openSettings(true)
  }

  function openSettings(open) {
    $('settings').hidden = !open
    $('btn-settings').setAttribute('aria-expanded', String(open))
  }

  async function connect() {
    settings.tourdUrl = $('tourd-url').value.trim() || 'http://localhost:4044'
    settings.token = $('tourd-token').value.trim()
    await chrome.storage.local.set({ tourdUrl: settings.tourdUrl, token: settings.token })
    const out = $('connection')
    out.textContent = 'Connecting...'
    try {
      fillProviders((await tourd('/odata/v4/tour/providers()')).value)
      await loadProjects()
      out.textContent = `Connected (${projects.length} project${projects.length === 1 ? '' : 's'})`
      openSettings(false)
    } catch (e) {
      out.textContent = e.message
    }
  }

  async function loadProjects() {
    const data = await tourd(
      '/odata/v4/tour/Projects?$select=ID,name,appId&$orderby=createdAt desc',
    )
    projects = data.value
    const select = $('project')
    const chosen = select.value // what the person picked stays picked when the list is read again
    select.textContent = ''
    for (const p of projects) {
      const option = document.createElement('option')
      option.value = p.ID
      option.textContent = p.appId ? `${p.name} (${p.appId})` : p.name
      select.appendChild(option)
    }
    const keep = [chosen, settings.lastProject].find((v) => v && projects.some((p) => p.ID === v))
    if (keep) select.value = keep
    await matchProject()
    await projectChanged()
  }

  // ---- the project: chosen once at the top, used by everything below ---------------------------------------------

  const projectID = () => $('project').value
  let projectChosen = false // the person picked one for this tab: it is not changed behind their back

  function projectHint(text) {
    $('project-hint').textContent = text || ''
  }

  /** Preselects the project of the app that is open in the tab (its app id is the project's), unless one was picked. */
  async function matchProject() {
    if (!tabId || projectChosen || helpActive || !projects.length) return
    let ids = []
    try {
      ids = ((await call('appIds')) || {}).ids || []
    } catch {
      /* no UI5 in this tab: nothing to match */
    }
    const match = projects.find((p) => p.appId && ids.includes(p.appId))
    if (match) $('project').value = match.ID
    projectHint(
      match
        ? 'This project belongs to the app that is open.'
        : 'Everything below is done for this project.',
    )
  }

  /** The project is another one now: its tours, tests and (while help is written) its help are read. */
  async function projectChanged() {
    if (projectID()) await chrome.storage.local.set({ lastProject: projectID() })
    await loadTours()
    await loadPlans()
    if (helpActive) {
      try {
        await loadHelp()
        draft = null
        openForm(false)
        await preview()
      } catch (e) {
        helpMsg(e.message, 'error')
      }
    }
  }

  // Projects are made in QuickDev while this panel stays open: read the list again when the person comes back to the panel
  // or opens one of the lists, like tours and tests are, so nobody has to reload the extension to see a new project.
  let projectsSeen = 0
  const refreshProjects = () => {
    if (!settings.token || helpActive || picking) return // not while help is being written: the lists must not change under the author
    if (Date.now() - projectsSeen < 1500) return
    projectsSeen = Date.now()
    loadProjects().catch(() => {})
  }
  window.addEventListener('focus', refreshProjects)
  $('project').addEventListener('mousedown', refreshProjects)
  $('project').addEventListener('change', () => {
    projectChosen = true
    projectHint('Everything below is done for this project.')
    projectChanged().catch((e) => show($('play-message'), e.message, 'error'))
  })

  async function loadTours() {
    const select = $('play-tour')
    const chosen = select.value
    select.textContent = ''
    const project = projectID()
    if (!project) return
    const data = await tourd(
      `/odata/v4/tour/Tours?$filter=project_ID eq ${project}&$select=ID,name,version&$orderby=modifiedAt desc`,
    )
    for (const t of data.value) {
      const option = document.createElement('option')
      option.value = t.ID
      option.textContent = `${t.name} (v${t.version})`
      select.appendChild(option)
    }
    if (chosen && data.value.some((t) => t.ID === chosen)) select.value = chosen
  }

  async function loadPlans() {
    const select = $('replay-plan')
    const chosen = select.value
    select.textContent = ''
    const project = projectID()
    if (!project) return
    const data = await tourd(
      `/odata/v4/tour/TestPlans?$filter=project_ID eq ${project}&$select=ID,name,version&$orderby=modifiedAt desc`,
    )
    for (const t of data.value) {
      const option = document.createElement('option')
      option.value = t.ID
      option.textContent = `${t.name} (v${t.version})`
      select.appendChild(option)
    }
    if (chosen && data.value.some((t) => t.ID === chosen)) select.value = chosen
  }

  // ---- the recording block: one for the Tests tab and one for the Tour tab ------------------------------------------------

  // What is being recorded decides the tab that shows it: a test (with checks) or a tour (with words for every step).
  const REC_TABS = { tests: 'test', tour: 'tour' }
  const TAB_FOR = { test: 'tests', tour: 'tour', both: 'tests' }
  const EXPLAINABLE = ['press', 'input', 'select', 'search', 'toggle']
  let activeTab = 'tests'
  let recTab = 'tests' // the tab that holds the recording block now
  const recOwner = () =>
    state && state.status !== 'idle' ? TAB_FOR[state.purpose] || 'tests' : null
  const recMode = () => REC_TABS[recTab]

  function placeRecording() {
    const owner = recOwner()
    recTab = owner || (REC_TABS[activeTab] ? activeTab : recTab)
    const block = $('rec-block')
    const pane = $('pane-' + recTab)
    if (block.parentNode !== pane) pane.prepend(block)
    block.dataset.mode = recMode()
    const tour = recTab === 'tour'
    $('rec-title').textContent = tour ? 'Record a tour' : 'Record a test'
    $('try-hint').textContent = tour
      ? 'Plays the tour that QuickDev would make from this recording, with the words you wrote. Nothing is saved: if it is not right, record again.'
      : 'Runs the recording as a test in the app, the way the generated test will. It does what you did: an order is created again. Nothing is saved: if a step fails, record again.'
    $('btn-try').textContent = tour ? '▶ Preview the tour' : '▶ Try it in the app'
    $('rec-hint').textContent = tour
      ? 'Use the app the way a new user should learn it. Under each step, write what it is for: that becomes the text of the tour.'
      : 'Use the app the way the test should. Add checks of what the screen shows.'
    // in the other recording tab: say where the recording is instead of starting a second one
    const away = Boolean(owner && REC_TABS[activeTab] && activeTab !== owner)
    const note = $('rec-elsewhere')
    note.hidden = !away
    if (away) {
      $('pane-' + activeTab).prepend(note)
      const where = owner === 'tour' ? 'Tour' : 'Tests'
      const running = state.status === 'recording' || state.status === 'paused'
      $('rec-elsewhere-text').textContent = running
        ? `A recording is running in the ${where} tab.`
        : `A recording from the ${where} tab is waiting to be sent.`
      $('btn-rec-go').textContent = `Go to the ${where} tab`
      $('btn-rec-go').dataset.tab = owner
      $('btn-rec-fresh').hidden = running
    }
  }

  // the words under a step are saved while the author types (and when they leave the field)
  const explainTimers = new Map()
  async function saveExplain(i, text) {
    clearTimeout(explainTimers.get(i))
    explainTimers.delete(i)
    apply(await call('setExplain', { index: i, text }))
  }
  function explainSoon(i, input) {
    clearTimeout(explainTimers.get(i))
    explainTimers.set(
      i,
      setTimeout(() => saveExplain(i, input.value), 500),
    )
  }
  /** Saves what is typed but not saved yet: before a recording is stopped, sent, saved or copied. */
  async function flushExplain() {
    explainTimers.forEach(clearTimeout)
    explainTimers.clear()
    for (const input of document.querySelectorAll('#steps .explain')) {
      const i = Number(input.dataset.index)
      const saved = (state && state.steps[i] && state.steps[i].explain) || ''
      if (input.value.trim() !== saved) await call('setExplain', { index: i, text: input.value })
    }
    apply(await call('status'))
  }

  // ---- rendering -----------------------------------------------------------------------------------------------

  const STATUS = { idle: 'Ready', recording: 'Recording', paused: 'Paused', stopped: 'Stopped' }

  function render() {
    const s = state || { status: 'idle', steps: [], error: null }
    const pill = $('status-pill')
    pill.textContent = STATUS[s.status] ?? s.status
    pill.className = `pill ${s.status}`
    $('step-count').textContent = s.steps.length
      ? `${s.steps.length} step${s.steps.length === 1 ? '' : 's'}`
      : ''

    const active = s.status === 'recording' || s.status === 'paused'
    $('btn-start').hidden = active
    $('btn-start').textContent = s.status === 'stopped' ? '● Record again' : '● Start recording'
    $('btn-pause').hidden = s.status !== 'recording'
    $('btn-resume').hidden = s.status !== 'paused'
    $('btn-stop').hidden = !active
    $('btn-check').hidden = s.status !== 'recording'
    $('btn-check-toast').hidden = s.status !== 'recording'
    $('note-form').hidden = !active
    $('send-card').hidden = !(s.status === 'stopped' && s.steps.length)
    show($('rec-message'), s.error, 'error')
    markTabs()
    placeRecording()

    const list = $('steps')
    // a new step arrives while the author writes under another one: what they typed and the cursor stay
    const focused = document.activeElement
    const typing =
      focused && focused.classList && focused.classList.contains('explain')
        ? {
            index: focused.dataset.index,
            value: focused.value,
            start: focused.selectionStart,
            end: focused.selectionEnd,
          }
        : null
    list.textContent = ''
    s.steps.forEach((step, i) => {
      const v = step.view
      const li = document.createElement('li')
      li.dataset.testid = 'step'
      const icon = document.createElement('span')
      icon.className = 'icon'
      icon.textContent = v.icon
      const body = document.createElement('div')
      const title = document.createElement('div')
      title.className = 'title'
      title.textContent = v.title
      body.appendChild(title)
      if (v.detail) {
        const d = document.createElement('div')
        d.className = 'detail'
        d.textContent = v.detail
        body.appendChild(d)
      }
      if (v.where) {
        const w = document.createElement('div')
        w.className = 'where' + (v.stable ? '' : ' unstable')
        w.textContent = v.stable ? v.where : `${v.where} · id may change`
        body.appendChild(w)
      }
      const del = document.createElement('button')
      del.textContent = '✕'
      del.setAttribute('aria-label', `Remove step ${i + 1}`)
      del.dataset.testid = 'step-delete'
      del.addEventListener('click', async () => {
        // the steps after this one move up: a text not saved yet would land on the wrong step
        explainTimers.forEach(clearTimeout)
        explainTimers.clear()
        apply(await call('removeStep', { index: i }))
      })
      if (recTab === 'tour' && EXPLAINABLE.includes(step.type)) {
        const ex = document.createElement('input')
        ex.type = 'text'
        ex.className = 'explain'
        ex.maxLength = 600
        ex.placeholder = 'What is this step for? (the text of the tour step)'
        ex.setAttribute('aria-label', `What step ${i + 1} is for`)
        ex.dataset.testid = 'explain'
        ex.dataset.index = String(i)
        ex.value = step.explain || ''
        ex.addEventListener('input', () => explainSoon(i, ex))
        ex.addEventListener('change', () => saveExplain(i, ex.value))
        body.appendChild(ex)
      }
      li.append(icon, body, del)
      list.appendChild(li)
    })
    if (typing) {
      const again = list.querySelector(`.explain[data-index="${typing.index}"]`)
      if (again) {
        again.value = typing.value
        again.focus()
        again.setSelectionRange(typing.start, typing.end)
      }
    } else list.scrollTop = list.scrollHeight
    if (s.status === 'recording') $('send-card').hidden = true
    $('try-card').hidden = $('send-card').hidden
  }

  function apply(next) {
    if (next && typeof next.status === 'string') state = next // (an error answer has no status)
    render()
  }

  async function updateTarget() {
    if (!tabId) {
      $('target-info').textContent = 'No tab selected'
      return
    }
    try {
      const tab = await chrome.tabs.get(tabId)
      $('target-info').textContent = tab.title || tab.url || `Tab ${tabId}`
    } catch {
      $('target-info').textContent = `Tab ${tabId}`
    }
  }

  async function refresh() {
    const before = tabId
    if (!pinnedTab) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      tabId = tab ? tab.id : null
    }
    const otherTab = before !== tabId
    if (otherTab) projectChosen = false // the project of the app in this tab is looked for again
    await updateTarget()
    if (helpActive && helpTab !== tabId) leaveHelp() // the author went to another tab
    if (tabId) apply(await call('status'))
    finished = null
    show($('send-message'), '')
    show($('play-message'), '')
    if (otherTab && projects.length) {
      await matchProject()
      await projectChanged().catch(() => {})
    }
    syncLive().catch(() => {})
  }

  // ---- actions -------------------------------------------------------------------------------------------------

  $('btn-settings').addEventListener('click', () => openSettings($('settings').hidden))
  $('btn-save-settings').addEventListener('click', connect)

  $('btn-start').addEventListener('click', async () => {
    if (!tabId) return
    show($('send-message'), '')
    // "Record again" starts over where the last recording started (a try leaves the app in its end state)
    if (state && state.status === 'stopped' && state.startUrl) {
      $('btn-start').disabled = true
      show($('rec-message'), 'Opening the app where the last recording started...', 'ok')
      await call('reopenStart').catch(() => {})
      $('btn-start').disabled = false
      show($('rec-message'), '')
    }
    show($('try-message'), '')
    $('try-results').textContent = ''
    apply(await call('start', { purpose: recMode() }))
  })
  $('btn-check').addEventListener('click', async () => {
    await call('pickCheck')
    show(
      $('rec-message'),
      'Click the control in the app that the tests should check (Esc cancels).',
      'ok',
    )
  })
  $('btn-check-toast').addEventListener('click', async () => {
    await call('pickToast')
    show(
      $('rec-message'),
      'Now do what shows the message in the app (for example press Save). The next message toast becomes a check. Stop cancels it.',
      'ok',
    )
  })
  $('btn-pause').addEventListener('click', async () => apply(await call('pause')))
  $('btn-resume').addEventListener('click', async () => apply(await call('resume')))
  $('btn-stop').addEventListener('click', async () => {
    await flushExplain()
    apply(await call('stop'))
    finished = await call('recording')
    const app = finished.app
    $('send-name').value = `${app.title || 'Recording'} ${new Date().toLocaleDateString()}`
    $('send-card').hidden = !(state && state.steps.length)
    $('try-card').hidden = $('send-card').hidden
  })

  $('note-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = $('note').value
    $('note').value = ''
    apply(await call('addNote', { text }))
  })

  $('btn-send').addEventListener('click', async () => {
    const out = $('send-message')
    const project = projectID()
    if (!project)
      return show(
        out,
        'Choose a project at the top first (connect to QuickDev in the settings).',
        'error',
      )
    try {
      await flushExplain()
      finished = await call('recording')
      const result = await tourd('/odata/v4/tour/importRecording', {
        method: 'POST',
        body: JSON.stringify({
          projectID: project,
          name: $('send-name').value.trim() || 'Recording',
          raw: JSON.stringify(finished),
          purpose: finished.purpose || 'both',
        }),
      })
      show(
        out,
        `Sent. ${result.mapped} of ${result.actionable} steps matched to a control of the project. ` +
          (finished.purpose === 'tour'
            ? 'Next: in QuickDev open the project, then Tours, and generate a tour from this recording. ' +
              'It appears under "Play a tour" only after that.'
            : 'Next: in QuickDev open the project, then Tests, and make tests from this recording.'),
        'ok',
      )
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  $('btn-save').addEventListener('click', async () => {
    await flushExplain()
    const rec = await call('recording')
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'tourd-recording.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  $('btn-copy').addEventListener('click', async () => {
    await flushExplain()
    const rec = await call('recording')
    try {
      await navigator.clipboard.writeText(JSON.stringify(rec, null, 2))
      show($('send-message'), 'Copied. Paste it into QuickDev (Recordings).', 'ok')
    } catch {
      show($('send-message'), 'The browser did not allow copying. Use "Save file".', 'error')
    }
  })

  // tours and tests are made in QuickDev while this panel stays open: look again when the lists are opened
  const refreshLists = () => {
    if (!projectID()) return
    Promise.all([loadTours(), loadPlans()]).catch(() => {})
  }
  for (const id of ['play-tour', 'replay-plan']) $(id).addEventListener('mousedown', refreshLists)
  window.addEventListener('focus', refreshLists)

  $('btn-play').addEventListener('click', async () => {
    const out = $('play-message')
    const id = $('play-tour').value
    if (!id) return show(out, 'There is no tour to play yet. Generate one in QuickDev first.', 'error')
    try {
      const tour = await tourd(`/live/${id}/tour.json`)
      const result = await call('playTour', { tour })
      show(out, result.ok ? 'Playing in the page.' : result.reason, result.ok ? 'ok' : 'error')
      if (result.ok) {
        $('btn-stop-tour').hidden = false
        syncLive().catch(() => {})
      }
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  $('btn-stop-tour').addEventListener('click', async () => {
    await call('stopTour')
    show($('play-message'), '')
    $('btn-stop-tour').hidden = true
    syncLive().catch(() => {})
  })

  let replaying = false
  function setReplaying(on) {
    replaying = on
    $('btn-stop-replay').hidden = !on
    $('btn-replay').disabled = on
    markTabs()
  }

  const MARK = { passed: '✓', failed: '✗', skipped: '–', 'not-run': '–' }

  /** The steps of a replay as passed or failed, and the sentence under them. */
  function renderReplay(list, out, result, extra = '') {
    list.textContent = ''
    for (const r of result.results) {
      const li = document.createElement('li')
      li.dataset.testid = 'replay-step'
      li.dataset.status = r.status
      const icon = document.createElement('span')
      icon.className = 'icon'
      icon.textContent = MARK[r.status] ?? '?'
      const body = document.createElement('div')
      const title = document.createElement('div')
      title.className = 'title'
      title.textContent = r.title
      const detail = document.createElement('div')
      detail.className = 'detail'
      detail.textContent = r.message || ''
      body.append(title, detail)
      li.append(icon, body)
      list.appendChild(li)
    }
    show(
      out,
      (result.failed
        ? `${result.passed} passed, ${result.failed} failed.`
        : `All ${result.passed} steps passed.`) + extra,
      result.failed ? 'error' : 'ok',
    )
  }

  $('btn-replay').addEventListener('click', async () => {
    const out = $('replay-message')
    const list = $('replay-results')
    const id = $('replay-plan').value
    list.textContent = ''
    if (!id) return show(out, 'There are no tests yet. Make some in QuickDev (Tests) first.', 'error')
    try {
      const found = await tourd(`/odata/v4/tour/TestPlans?$filter=ID eq ${id}`)
      if (!found.value.length) return show(out, 'These tests are gone. Reload the list.', 'error')
      let result
      try {
        setReplaying(true)
        result = await call('replayPlan', { plan: JSON.parse(found.value[0].definition) })
      } finally {
        setReplaying(false)
      }
      if (!result.ok) return show(out, result.reason, 'error')
      renderReplay(list, out, result)
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  // Try a recording that is not sent yet: nothing is saved, so a bad one is simply recorded again.
  let trying = false
  function setTrying(on) {
    trying = on
    $('btn-try').disabled = on
    $('btn-try-stop').hidden = !on || recTab !== 'tests' // (a tour is stopped with "Stop tour")
    markTabs()
  }

  $('btn-try').addEventListener('click', async () => {
    const out = $('try-message')
    const list = $('try-results')
    list.textContent = ''
    const project = projectID()
    if (!project)
      return show(
        out,
        'Choose a project at the top first (connect to QuickDev in the settings).',
        'error',
      )
    const kind = recMode()
    setTrying(true)
    try {
      await flushExplain()
      show(out, 'Asking QuickDev what this recording would become...', '')
      const made = await tourd('/odata/v4/tour/previewRecording', {
        method: 'POST',
        body: JSON.stringify({
          projectID: project,
          raw: JSON.stringify(await call('recording')),
          kind,
        }),
      })
      const unmatched = made.unmapped
        ? ` ${made.unmapped} step${made.unmapped === 1 ? ' was' : 's were'} not found in the files of the project.`
        : ''
      show(out, 'Opening the app at the start...', '')
      const opened = await call('reopenStart')
      if (!opened.ok) return show(out, opened.reason, 'error')
      show(out, kind === 'tour' ? 'Playing the tour...' : 'Running the steps...', '')
      if (kind === 'tour') {
        const res = await call('playTour', { tour: JSON.parse(made.definition) })
        show(
          out,
          res.ok
            ? `Playing the tour that QuickDev would make. Nothing is saved.${unmatched}`
            : res.reason,
          res.ok ? 'ok' : 'error',
        )
        syncLive().catch(() => {})
        return
      }
      const result = await call('replayPlan', { plan: JSON.parse(made.definition) })
      if (!result.ok) return show(out, result.reason, 'error')
      renderReplay(
        list,
        out,
        result,
        result.failed
          ? ' Record again, or take out the step that fails.' + unmatched
          : ' Send it when you are happy.' + unmatched,
      )
    } catch (e) {
      show(out, e.message, 'error')
    } finally {
      setTrying(false)
    }
  })

  $('btn-try-stop').addEventListener('click', async () => {
    await call('stopReplay')
  })

  $('btn-stop-replay').addEventListener('click', async () => {
    await call('stopReplay')
    show($('replay-message'), 'Stopped.', '')
  })

  // ---- help: show the saved help --------------------------------------------------------------------------------

  $('btn-help-view').addEventListener('click', async () => {
    const out = $('help-view-message')
    if (!projectID()) return show(out, 'Choose a project at the top first.', 'error')
    try {
      const data = await tourd(
        `/odata/v4/tour/HelpSets?$filter=project_ID eq ${projectID()}&$orderby=modifiedAt desc&$top=1`,
      )
      const doc = data.value[0] ? JSON.parse(data.value[0].definition) : null
      if (!doc || !doc.topics.length)
        return show(out, 'This project has no help yet. Use "Start writing help" below.', 'error')
      const r = await call('helpShow', { help: doc, open: true, view: true })
      show(
        out,
        r.ok
          ? `Showing ${doc.topics.length} topic${doc.topics.length === 1 ? '' : 's'} in the app. The ? at the top of the app switches the panel on and off.`
          : r.reason,
        r.ok ? 'ok' : 'error',
      )
      syncLive().catch(() => {})
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  $('btn-help-hide').addEventListener('click', async () => {
    await call('helpStop')
    show($('help-view-message'), '')
    $('btn-help-hide').hidden = true
    syncLive().catch(() => {})
  })

  // ---- help: write topics for controls of the app, see them in the app ------------------------------------------

  let helpActive = false
  let helpTab = null
  let help = { id: null, version: null, doc: null } // the saved help of the chosen project
  let draft = null // { id, control, target, meta, screen, hash, saved }
  let previewTimer = null
  const FIELDS = ['title', 'summary', 'text', 'note', 'links']

  const newTopicId = () => `t-${Math.random().toString(36).slice(2, 10)}`
  const helpMsg = (text, kind) => show($('help-message'), text, kind)

  function formValues() {
    const v = {}
    for (const f of FIELDS) v[f] = $(`help-${f}`).value
    return { ...v, screen: draft && draft.screen, hash: draft && draft.hash }
  }

  function describeControl(control, saved) {
    if (!control) return saved ? 'The control of this topic is kept.' : ''
    const type = String(control.controlType || '')
      .split('.')
      .pop()
    const name = control.text || control.label || control.localId || control.id
    return `Control: ${type}${name ? ` “${name}”` : ''}${control.stableId ? '' : ' · its id may change, the text is used as a fallback'}`
  }

  function topicNow() {
    if (!draft) return null
    return T.draftTopic(formValues(), draft.control, {
      id: draft.id,
      target: draft.target,
      meta: draft.meta,
    })
  }

  async function preview() {
    if (!helpActive) return
    const topic = topicNow()
    const doc = T.withDraft(help.doc, topic)
    const showing = !!(topic && topic.target)
    const r = await call('helpShow', { help: doc, open: true, topicId: showing ? topic.id : null })
    if (r && r.ok === false) helpMsg(r.reason, 'error')
  }

  const previewSoon = () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => preview().catch(() => {}), 350)
  }

  function renderTopics() {
    const list = $('help-topics')
    list.textContent = ''
    const topics = (help.doc && help.doc.topics) || []
    for (const t of topics) {
      const li = document.createElement('li')
      li.className = 'clickable' + (draft && draft.id === t.id ? ' current' : '')
      li.dataset.testid = 'help-topic'
      const icon = document.createElement('span')
      icon.className = 'icon'
      icon.textContent = '?'
      const body = document.createElement('div')
      const title = document.createElement('div')
      title.className = 'title'
      title.textContent = t.title
      body.appendChild(title)
      if (t.summary) {
        const d = document.createElement('div')
        d.className = 'detail'
        d.textContent = t.summary
        body.appendChild(d)
      }
      li.append(icon, body)
      li.addEventListener('click', () => editTopic(t))
      list.appendChild(li)
    }
    $('help-topics').previousElementSibling.hidden = !topics.length
  }

  function openForm(show_) {
    $('help-form').hidden = !show_
    $('btn-help-repoint').hidden = !(draft && (draft.control || draft.saved))
    $('btn-help-delete').hidden = !(draft && draft.saved)
    $('help-control').textContent = draft ? describeControl(draft.control, draft.saved) : ''
    renderTopics()
  }

  function editTopic(topic) {
    draft = {
      id: topic.id,
      control: null,
      target: topic.target,
      meta: topic.meta,
      screen: topic.meta && topic.meta.screen,
      hash: topic.meta && topic.meta.hash,
      saved: true,
    }
    fillForm(topic)
    helpMsg('')
    openForm(true)
    preview().catch(() => {})
  }

  function newTopic() {
    draft = { id: newTopicId(), control: null, target: null, meta: null, saved: false }
    fillForm(null)
    openForm(false) // the form comes once a control is chosen: there is nothing to write about before that
  }

  // a different topic: the "undo" of the AI belonged to the old one
  function fillForm(topic) {
    $('help-title').value = topic ? topic.title : ''
    $('help-summary').value = topic ? topic.summary : ''
    $('help-text').value = topic ? topic.text : ''
    $('help-note').value = topic ? topic.note : ''
    $('help-links').value = topic ? T.formatLinks(topic.links) : ''
    $('help-instruction').value = ''
    $('btn-help-undo').hidden = true
    beforeAi = null
  }

  async function loadHelp() {
    const project = projectID()
    help = { id: null, version: null, doc: null }
    if (!project) return
    const data = await tourd(
      `/odata/v4/tour/HelpSets?$filter=project_ID eq ${project}&$orderby=modifiedAt desc&$top=1`,
    )
    const row = data.value[0]
    if (row) help = { id: row.ID, version: row.version, doc: JSON.parse(row.definition) }
  }

  function leaveHelp() {
    if (typeof setPicking === 'function') setPicking(false)
    helpActive = false
    helpTab = null
    draft = null
    clearTimeout(previewTimer)
    $('help-work').hidden = true
    $('btn-help-stop').hidden = true
    $('btn-help-start').hidden = false
    markTabs()
    syncLive().catch(() => {})
  }

  $('btn-help-start').addEventListener('click', async () => {
    if (!tabId) return
    if (!projectID())
      return helpMsg(
        'Choose a project at the top first (connect to QuickDev in the settings).',
        'error',
      )
    try {
      const r = await call('helpStart')
      if (!r.ok) return helpMsg(r.reason, 'error')
      await loadHelp()
      helpActive = true
      helpTab = tabId
      $('btn-help-start').hidden = true
      $('btn-help-stop').hidden = false
      $('help-work').hidden = false
      markTabs()
      syncLive().catch(() => {})
      draft = null
      openForm(false)
      helpMsg('Click “Point at a control”, then click the control in the app.', 'ok')
      await preview()
    } catch (e) {
      helpMsg(e.message, 'error')
    }
  })

  $('btn-help-stop').addEventListener('click', async () => {
    await call('helpStop')
    leaveHelp()
    helpMsg('')
  })

  // "Point at a control": the picker waits in the app until a control is clicked or this is pressed again
  let picking = false

  function setPicking(on) {
    picking = on
    const b = $('btn-help-pick')
    b.textContent = on ? '✕ Cancel pointing' : '☉ Point at a control'
    b.classList.toggle('primary', !on)
    $('btn-help-repoint').textContent = on ? 'Cancel pointing' : 'Point at another control'
  }

  async function startPicking() {
    const buttons = [$('btn-help-pick'), $('btn-help-repoint')]
    buttons.forEach((b) => (b.disabled = true)) // a click in the app before the picker waits there would press the app's button
    try {
      await call('helpPick')
      setPicking(true)
      helpMsg(
        'Click the control in the app that the help is about. Esc or the button gives up.',
        'ok',
      )
    } finally {
      buttons.forEach((b) => (b.disabled = false))
    }
  }

  async function stopPicking(message = '') {
    await call('helpCancel')
    setPicking(false)
    helpMsg(message, message ? 'ok' : '')
  }

  const hasWords = () => FIELDS.some((f) => $(`help-${f}`).value.trim())

  $('btn-help-pick').addEventListener('click', async () => {
    if (picking) return stopPicking()
    // A saved topic is finished: pointing at a control then starts the next topic (it must not move the saved one).
    // A topic that is being written keeps its words and gets the control.
    if (!(draft && !draft.saved && (draft.control || hasWords()))) newTopic()
    await startPicking()
  })
  $('btn-help-repoint').addEventListener('click', async () => {
    if (picking) return stopPicking()
    await startPicking()
  })
  // the focus is in this panel after a click here, so Esc has to be heard here too
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picking) stopPicking('Pointing cancelled.')
  })

  for (const f of FIELDS) $(`help-${f}`).addEventListener('input', previewSoon)

  $('btn-help-save').addEventListener('click', async () => {
    const topic = topicNow()
    if (!topic) return
    if (!topic.target || (!topic.target.controlId && !(topic.target.fallbacks || []).length))
      return helpMsg(
        'Point at a control first: a topic belongs to one control of the app.',
        'error',
      )
    if (!topic.title) return helpMsg('Give the topic a title.', 'error')
    try {
      const row = await tourd('/odata/v4/tour/saveHelpTopic', {
        method: 'POST',
        body: JSON.stringify({
          projectID: projectID(),
          ...(help.id ? { helpID: help.id } : {}),
          topic: JSON.stringify(topic),
        }),
      })
      help = { id: row.ID, version: row.version, doc: JSON.parse(row.definition) }
      const saved = help.doc.topics.find((t) => t.id === topic.id)
      draft = {
        id: topic.id,
        control: null,
        target: saved ? saved.target : topic.target,
        meta: saved ? saved.meta : topic.meta,
        screen: draft.screen,
        hash: draft.hash,
        saved: true,
      }
      openForm(true)
      helpMsg(
        `Saved (version ${row.version}). Check it in the app; add it to your code from QuickDev.`,
        'ok',
      )
      await preview()
    } catch (e) {
      helpMsg(e.message, 'error')
    }
  })

  $('btn-help-delete').addEventListener('click', async () => {
    if (!draft || !draft.saved || !help.id) return
    try {
      const row = await tourd('/odata/v4/tour/deleteHelpTopic', {
        method: 'POST',
        body: JSON.stringify({ helpID: help.id, topicID: draft.id }),
      })
      help = { id: row.ID, version: row.version, doc: JSON.parse(row.definition) }
      draft = null
      openForm(false)
      helpMsg('Topic deleted.', 'ok')
      await preview()
    } catch (e) {
      helpMsg(e.message, 'error')
    }
  })

  // The AI providers the server has: the configured ones, and the rule-based draft that needs none.
  function fillProviders(list) {
    const select = $('help-provider')
    const chosen = select.value
    select.textContent = ''
    for (const p of (list || []).filter((x) => x.configured && x.id !== 'rules')) {
      const option = document.createElement('option')
      option.value = p.id
      option.textContent = p.label
      select.appendChild(option)
    }
    const rules = document.createElement('option')
    rules.value = 'rules'
    rules.textContent = 'Simple draft (no AI)'
    select.appendChild(rules)
    if (chosen && [...select.options].some((o) => o.value === chosen)) select.value = chosen
  }

  let beforeAi = null

  $('btn-help-ai').addEventListener('click', async () => {
    if (!draft) return
    if (!draft.control && !draft.saved)
      return helpMsg('Point at a control first: the AI writes about that control.', 'error')
    const button = $('btn-help-ai')
    button.disabled = true
    helpMsg('The AI is writing...', '')
    try {
      const before = formValues()
      const r = await tourd('/odata/v4/tour/improveHelpTopic', {
        method: 'POST',
        body: JSON.stringify({
          projectID: projectID(),
          topic: JSON.stringify({
            title: before.title,
            summary: before.summary,
            text: before.text,
            note: before.note,
          }),
          ...(draft.control ? { control: JSON.stringify(draft.control) } : {}),
          screen: draft.screen || '',
          instruction: $('help-instruction').value.trim(),
          provider: $('help-provider').value,
        }),
      })
      const out = JSON.parse(r.value)
      beforeAi = before
      for (const f of ['title', 'summary', 'text', 'note']) $(`help-${f}`).value = out[f] ?? ''
      $('btn-help-undo').hidden = false
      helpMsg(
        out.generator === 'rules'
          ? 'A simple draft was written. Edit it, or choose an AI provider for something better.'
          : 'The AI wrote this. Read it, change what is not right, then save.',
        'ok',
      )
      await preview()
    } catch (e) {
      helpMsg(e.message, 'error')
    } finally {
      button.disabled = false
    }
  })

  $('btn-help-undo').addEventListener('click', () => {
    if (!beforeAi) return
    for (const f of ['title', 'summary', 'text', 'note']) $(`help-${f}`).value = beforeAi[f]
    beforeAi = null
    $('btn-help-undo').hidden = true
    helpMsg('Your own text is back.', 'ok')
    preview().catch(() => {})
  })

  function onHelpPick(msg) {
    if (!helpActive || msg.tabId !== helpTab) return
    setPicking(false)
    if (!msg.control) return helpMsg('Pointing cancelled.', '') // Esc in the app
    if (!draft) newTopic()
    const target = T.helpTarget(msg.control)
    if (!target.controlId && !target.fallbacks.length) {
      // not a control we can find again: wait for the next click instead of making the user press the button again
      helpMsg(
        'That control has no id and no text, so help could not find it again. Click another one.',
        'error',
      )
      startPicking().catch(() => {})
      return
    }
    draft = { ...draft, control: msg.control, target, screen: msg.title, hash: msg.hash }
    if (!$('help-title').value) {
      $('help-title').value = msg.control.label || msg.control.text || msg.control.localId || ''
    }
    openForm(true)
    $('help-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    helpMsg('Write what this control is for. The app shows your text as you type.', 'ok')
    preview().catch(() => {})
  }

  // ---- tabs: what do you want to do? -----------------------------------------------------------------------------

  const TABS = ['tests', 'help', 'tour']

  function showTab(name, remember = true) {
    if (!TABS.includes(name)) name = 'tests' // (also a tab remembered from before the tabs changed)
    activeTab = name
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name))
      $('pane-' + t).hidden = t !== name
    }
    placeRecording()
    if (remember) chrome.storage.local.set({ lastTab: name }).catch(() => {})
  }
  for (const t of TABS) $('tab-' + t).addEventListener('click', () => showTab(t))
  $('btn-rec-go').addEventListener('click', () => showTab($('btn-rec-go').dataset.tab))
  $('btn-rec-fresh').addEventListener('click', async () => {
    finished = null
    show($('send-message'), '')
    apply(await call('clear'))
  })

  /** A dot on the tab whose job is running (recording, writing help or showing help), so it is seen from any tab. */
  let helpShown = false
  function markTabs() {
    const recording = !!state && (state.status === 'recording' || state.status === 'paused')
    const owner = recOwner()
    $('tab-tests').toggleAttribute(
      'data-live',
      (recording && owner === 'tests') || replaying || (trying && recTab === 'tests'),
    )
    $('tab-help').toggleAttribute('data-live', helpActive || helpShown)
    $('tab-tour').toggleAttribute('data-live', tourPlaying || (recording && owner === 'tour'))
  }

  /**
   * Asks the page what is running and shows the buttons that stop it only then: "Stop tour" while a tour plays, "Hide"
   * while help is shown (writing help has its own "Stop writing help"), "Stop" of a replay while one runs.
   */
  let tourPlaying = false
  async function syncLive() {
    if (!tabId) return
    const live = (await call('liveState')) || {}
    tourPlaying = !!live.tour
    helpShown = !!live.help
    $('btn-stop-tour').hidden = !tourPlaying
    $('btn-help-hide').hidden = !(helpShown && !helpActive)
    $('btn-help-view').disabled = helpActive // writing help shows the help already
    markTabs()
  }
  setInterval(() => {
    if (!document.hidden) syncLive().catch(() => {})
  }, 1500)

  // the header, project and tabs stay in view: what scrolls under them starts below their height
  new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      '--chrome-h',
      document.querySelector('.chrome').offsetHeight + 'px',
    ),
  ).observe(document.querySelector('.chrome'))

  // ---- live updates --------------------------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return
    if (msg.type === 'state' && msg.tabId === tabId) apply(msg.state)
    else if (msg.type === 'helpPick') onHelpPick(msg)
    else if (msg.type === 'helpReload' && helpActive && msg.tabId === helpTab) previewSoon()
  })
  if (!pinnedTab) {
    chrome.tabs.onActivated.addListener(() => refresh())
    chrome.tabs.onUpdated.addListener((id, info) => {
      if (id === tabId && info.title) updateTarget()
    })
  }

  // ---- go ------------------------------------------------------------------------------------------------------

  ;(async () => {
    await loadSettings()
    showTab(settings.lastTab, false)
    await refresh()
    document.body.dataset.ready = 'true' // for tests: the panel knows its settings and its tab
    if (settings.token) {
      tourd('/odata/v4/tour/providers()')
        .then((r) => fillProviders(r.value))
        .catch(() => {})
      loadProjects().catch((e) => ($('connection').textContent = e.message))
    }
  })()

  void T
})()
