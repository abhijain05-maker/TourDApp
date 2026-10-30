/* TourD Recorder - side panel. Talks to the service worker (recording, playing) and to TourD (projects, tours). */
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
      throw new Error(`TourD does not answer at ${base}. Is it running?`)
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
    const stored = await chrome.storage.local.get(['tourdUrl', 'token', 'lastProject'])
    settings = {
      tourdUrl: stored.tourdUrl || settings.tourdUrl,
      token: stored.token || '',
      lastProject: stored.lastProject,
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
    for (const id of ['send-project', 'play-project', 'help-project']) {
      const select = $(id)
      select.textContent = ''
      for (const p of projects) {
        const option = document.createElement('option')
        option.value = p.ID
        option.textContent = p.appId ? `${p.name} (${p.appId})` : p.name
        select.appendChild(option)
      }
      if (settings.lastProject && projects.some((p) => p.ID === settings.lastProject))
        select.value = settings.lastProject
    }
    await loadTours()
    await loadPlans()
  }

  async function loadTours() {
    const select = $('play-tour')
    const chosen = select.value
    select.textContent = ''
    const project = $('play-project').value
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
    const project = $('play-project').value
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
    $('note-form').hidden = !active
    $('send-card').hidden = !(s.status === 'stopped' && s.steps.length)
    show($('rec-message'), s.error, 'error')

    const list = $('steps')
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
      del.addEventListener('click', async () => apply(await call('removeStep', { index: i })))
      li.append(icon, body, del)
      list.appendChild(li)
    })
    list.scrollTop = list.scrollHeight
    if (s.status === 'recording') $('send-card').hidden = true
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
    if (!pinnedTab) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      tabId = tab ? tab.id : null
    }
    await updateTarget()
    if (helpActive && helpTab !== tabId) leaveHelp() // the author went to another tab
    if (tabId) apply(await call('status'))
    finished = null
    show($('send-message'), '')
    show($('play-message'), '')
  }

  // ---- actions -------------------------------------------------------------------------------------------------

  $('btn-settings').addEventListener('click', () => openSettings($('settings').hidden))
  $('btn-save-settings').addEventListener('click', connect)

  $('btn-start').addEventListener('click', async () => {
    if (!tabId) return
    show($('send-message'), '')
    apply(await call('start'))
  })
  $('btn-check').addEventListener('click', async () => {
    await call('pickCheck')
    show(
      $('rec-message'),
      'Click the control in the app that the tests should check (Esc cancels).',
      'ok',
    )
  })
  $('btn-pause').addEventListener('click', async () => apply(await call('pause')))
  $('btn-resume').addEventListener('click', async () => apply(await call('resume')))
  $('btn-stop').addEventListener('click', async () => {
    apply(await call('stop'))
    finished = await call('recording')
    const app = finished.app
    $('send-name').value = `${app.title || 'Recording'} ${new Date().toLocaleDateString()}`
    $('send-card').hidden = !(state && state.steps.length)
  })

  $('note-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = $('note').value
    $('note').value = ''
    apply(await call('addNote', { text }))
  })

  $('btn-send').addEventListener('click', async () => {
    const out = $('send-message')
    const projectID = $('send-project').value
    if (!projectID)
      return show(out, 'Choose a project first (connect to TourD in the settings).', 'error')
    try {
      finished = await call('recording')
      const result = await tourd('/odata/v4/tour/importRecording', {
        method: 'POST',
        body: JSON.stringify({
          projectID,
          name: $('send-name').value.trim() || 'Recording',
          raw: JSON.stringify(finished),
        }),
      })
      await chrome.storage.local.set({ lastProject: projectID })
      show(
        out,
        `Sent. ${result.mapped} of ${result.actionable} steps matched to a control of the project. ` +
          'Next: in TourD open the project, then Recordings, and generate a tour or tests from it. ' +
          'A tour appears under "Play a tour" only after that.',
        'ok',
      )
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  $('btn-save').addEventListener('click', async () => {
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
    const rec = await call('recording')
    try {
      await navigator.clipboard.writeText(JSON.stringify(rec, null, 2))
      show($('send-message'), 'Copied. Paste it into TourD (Recordings).', 'ok')
    } catch {
      show($('send-message'), 'The browser did not allow copying. Use "Save file".', 'error')
    }
  })

  $('play-project').addEventListener('change', () =>
    Promise.all([loadTours(), loadPlans()]).catch((e) =>
      show($('play-message'), e.message, 'error'),
    ),
  )

  // tours and tests are made in TourD while this panel stays open: look again when the lists are opened
  const refreshLists = () => {
    if (!$('play-project').value) return
    Promise.all([loadTours(), loadPlans()]).catch(() => {})
  }
  for (const id of ['play-tour', 'replay-plan']) $(id).addEventListener('mousedown', refreshLists)
  window.addEventListener('focus', refreshLists)

  $('btn-play').addEventListener('click', async () => {
    const out = $('play-message')
    const id = $('play-tour').value
    if (!id) return show(out, 'There is no tour to play yet. Generate one in TourD first.', 'error')
    try {
      const tour = await tourd(`/live/${id}/tour.json`)
      const result = await call('playTour', { tour })
      show(out, result.ok ? 'Playing in the page.' : result.reason, result.ok ? 'ok' : 'error')
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  $('btn-stop-tour').addEventListener('click', async () => {
    await call('stopTour')
    show($('play-message'), '')
  })

  const MARK = { passed: '✓', failed: '✗', skipped: '–', 'not-run': '–' }

  $('btn-replay').addEventListener('click', async () => {
    const out = $('replay-message')
    const list = $('replay-results')
    const id = $('replay-plan').value
    list.textContent = ''
    if (!id) return show(out, 'There are no tests yet. Make some in TourD (Tests) first.', 'error')
    try {
      const found = await tourd(`/odata/v4/tour/TestPlans?$filter=ID eq ${id}`)
      if (!found.value.length) return show(out, 'These tests are gone. Reload the list.', 'error')
      const result = await call('replayPlan', { plan: JSON.parse(found.value[0].definition) })
      if (!result.ok) return show(out, result.reason, 'error')
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
        result.failed
          ? `${result.passed} passed, ${result.failed} failed.`
          : `All ${result.passed} steps passed.`,
        result.failed ? 'error' : 'ok',
      )
    } catch (e) {
      show(out, e.message, 'error')
    }
  })

  $('btn-stop-replay').addEventListener('click', async () => {
    await call('stopReplay')
    show($('replay-message'), 'Stopped.', '')
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
    const project = $('help-project').value
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
  }

  $('btn-help-start').addEventListener('click', async () => {
    if (!tabId) return
    if (!$('help-project').value)
      return helpMsg('Choose a project first (connect to TourD in the settings).', 'error')
    try {
      const r = await call('helpStart')
      if (!r.ok) return helpMsg(r.reason, 'error')
      await loadHelp()
      await chrome.storage.local.set({ lastProject: $('help-project').value })
      helpActive = true
      helpTab = tabId
      $('btn-help-start').hidden = true
      $('btn-help-stop').hidden = false
      $('help-work').hidden = false
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

  $('help-project').addEventListener('change', async () => {
    if (!helpActive) return
    try {
      await loadHelp()
      draft = null
      openForm(false)
      await preview()
    } catch (e) {
      helpMsg(e.message, 'error')
    }
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
  $('btn-help-new').addEventListener('click', async () => {
    if (picking) await stopPicking()
    newTopic()
    await startPicking()
  })
  $('btn-help-panel').addEventListener('click', () => preview().catch(() => {}))

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
          projectID: $('help-project').value,
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
        `Saved (version ${row.version}). Check it in the app; add it to your code from TourD.`,
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
          projectID: $('help-project').value,
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
