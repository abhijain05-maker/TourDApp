/* Logic shared by the service worker and the side panel. Plain script (no modules) so both can load it.
 * Everything here is pure: no chrome.* calls, which makes it testable in Node. */
;(function (root) {
  'use strict'

  var VERSION = '0.1.0'

  function idleState() {
    return {
      status: 'idle', // idle | recording | paused | stopped
      purpose: 'both', // what is being recorded: tour | test | both (the tab it was started in)
      startedAt: null,
      t0: 0,
      app: null,
      startUrl: null, // the full address of the tab when the recording started (to open the app there again)
      recorder: '',
      steps: [],
      error: null,
      notice: null,
    }
  }

  /** Adds a step that a page reported to the tab's recording; renumbers it and maps references to other steps. */
  function addStep(state, frameId, step, now) {
    var index = state.steps.length
    var copy = JSON.parse(JSON.stringify(step))
    copy._frame = frameId
    copy._local = step.index
    copy.index = index
    copy.t = Math.max(0, now - state.t0)
    if (step.causedBy !== undefined) {
      var cause = -1
      for (var i = state.steps.length - 1; i >= 0; i--) {
        if (state.steps[i]._frame === frameId && state.steps[i]._local === step.causedBy) {
          cause = i
          break
        }
      }
      if (cause >= 0) copy.causedBy = cause
      else delete copy.causedBy
    }
    state.steps.push(copy)
    return copy
  }

  function renumber(steps, removed) {
    steps.forEach(function (s, i) {
      s.index = i
      if (s.causedBy !== undefined) {
        if (s.causedBy === removed) delete s.causedBy
        else if (s.causedBy > removed) s.causedBy -= 1
      }
    })
  }

  function removeStep(state, index) {
    if (index < 0 || index >= state.steps.length) return false
    state.steps.splice(index, 1)
    renumber(state.steps, index)
    return true
  }

  function addNote(state, text, now) {
    var note = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    if (!note) return null
    var step = {
      index: state.steps.length,
      t: Math.max(0, now - state.t0),
      type: 'note',
      note: note,
      _frame: -1,
      _local: -1,
    }
    state.steps.push(step)
    return step
  }

  var PURPOSES = ['tour', 'test', 'both']
  var EXPLAINABLE = ['press', 'input', 'select', 'search', 'toggle']

  /** What the author says a step is for. It becomes the text of the tour step; tests ignore it. Empty text removes it. */
  function setExplain(state, index, text) {
    var step = state.steps[index]
    if (!step || EXPLAINABLE.indexOf(step.type) < 0) return false
    var value = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600)
    if (value) step.explain = value
    else delete step.explain
    return true
  }

  /** The finished recording document (shared/recording-schema.mjs); private fields are left out. */
  function buildRecording(state) {
    var app = state.app || {}
    return {
      format: 'tourd-recording',
      version: 1,
      recordedAt: new Date(state.startedAt || Date.now()).toISOString(),
      recorder: 'tourd-extension ' + VERSION + (state.recorder ? ' + ' + state.recorder : ''),
      purpose: PURPOSES.indexOf(state.purpose) >= 0 ? state.purpose : 'both',
      app: {
        url: app.url || '',
        startHash: app.startHash || '',
        title: app.title || '',
        ui5Version: app.ui5Version || null,
        appId: app.appId || null,
        locale: app.locale || null,
      },
      steps: state.steps.map(function (s) {
        var out = {}
        Object.keys(s).forEach(function (k) {
          if (k.charAt(0) !== '_') out[k] = s[k]
        })
        return out
      }),
    }
  }

  var ICONS = {
    press: '▶',
    input: '✎',
    select: '▾',
    search: '⌕',
    toggle: '☑',
    navigate: '→',
    note: '✍',
    check: '✔',
  }

  /** One line for the step list: what happened and to what. */
  function describeStep(step) {
    var c = step.control
    var name = c ? c.text || c.label || c.placeholder || c.localId || shortType(c.controlType) : ''
    var detail = ''
    if (step.type === 'input' || step.type === 'search')
      detail = step.redacted
        ? 'value left out (secret)'
        : step.value !== undefined
          ? '“' + step.value + '”'
          : ''
    else if (step.type === 'select')
      detail = step.valueText || (step.value !== undefined ? String(step.value) : '')
    else if (step.type === 'toggle') detail = step.value ? 'on' : 'off'
    else if (step.type === 'check' && step.check && step.check.kind === 'toast')
      detail = '“' + (step.check.expected || '') + '”'
    else if (step.type === 'check' && step.check)
      detail =
        step.check.kind === 'visible'
          ? 'is shown'
          : (step.check.kind === 'value' ? 'holds ' : 'shows ') +
            '“' +
            (step.check.expected || '') +
            '”'
    var VERB = {
      press: 'Press',
      input: 'Enter',
      select: 'Choose',
      search: 'Search',
      toggle: 'Switch',
      check: 'Check',
    }
    var title
    if (step.type === 'navigate')
      title = 'Opens ' + (step.hash ? '#' + step.hash : 'the start page')
    else if (step.type === 'note') title = step.note
    else if (step.type === 'check' && step.check && step.check.kind === 'toast')
      title = 'Check the message shown'
    else if (step.type === 'search' && /search/i.test(name))
      title = name // "Search customers", not "Search Search customers"
    else title = VERB[step.type] + ' ' + name
    var where = c ? [shortName(c.viewName), c.localId || 'no id'].filter(Boolean).join(' · ') : ''
    return {
      icon: ICONS[step.type] || '•',
      title: title.trim(),
      detail: detail,
      where: where,
      stable: c ? c.stableId : true,
    }
  }

  function shortName(n) {
    return n ? String(n).split('.').slice(-1)[0] : ''
  }
  function shortType(t) {
    return shortName(t)
  }

  /** The state the panel needs (no private fields, no big objects). */
  function publicState(state) {
    return {
      status: state.status,
      purpose: state.purpose,
      startUrl: state.startUrl,
      startedAt: state.startedAt,
      app: state.app,
      error: state.error,
      notice: state.notice,
      steps: state.steps.map(function (s) {
        var out = {}
        Object.keys(s).forEach(function (k) {
          if (k.charAt(0) !== '_') out[k] = s[k]
        })
        out.view = describeStep(s)
        return out
      }),
    }
  }

  // ---- help topics ---------------------------------------------------------------------------------------------

  /** What the recorder knows about a picked control -> a help target (the same shape as a tour step target). */
  function helpTarget(control) {
    var c = control || {}
    var target = { fallbacks: [] }
    if (c.viewName && c.localId) {
      target.viewName = c.viewName
      target.controlId = c.localId
      if (c.id && c.id !== c.localId) target.fallbacks.push({ by: 'id', value: c.id })
    } else if (c.id) {
      target.controlId = c.id
    }
    var text = c.text || c.label || c.placeholder
    if (text) target.fallbacks.push({ by: 'text', value: String(text).slice(0, 200) })
    return target
  }

  /** "Label | https://..." per line -> [{label, url}]; lines that are not a link are ignored. */
  function parseLinks(text) {
    var out = []
    String(text || '')
      .split(/\r?\n/)
      .forEach(function (line) {
        var at = line.lastIndexOf('|')
        var url = (at >= 0 ? line.slice(at + 1) : line).trim()
        if (!/^https?:\/\/\S+$/i.test(url)) return
        var label = (at >= 0 ? line.slice(0, at) : '').trim() || url
        out.push({ label: label.slice(0, 200), url: url })
      })
    return out.slice(0, 10)
  }

  function formatLinks(links) {
    return (links || [])
      .map(function (l) {
        return l.label + ' | ' + l.url
      })
      .join('\n')
  }

  /**
   * The topic the form describes. `control` is what was picked (null when only the text of a saved topic is edited:
   * the saved target is kept). `id` is kept when a saved topic is edited.
   */
  function draftTopic(form, control, existing) {
    var topic = {
      id: (existing && existing.id) || 'draft',
      title: String(form.title || '').trim(),
      summary: String(form.summary || '').trim(),
      text: String(form.text || '').trim(),
      note: String(form.note || '').trim(),
      links: parseLinks(form.links),
      target: control ? helpTarget(control) : existing && existing.target,
      meta: Object.assign({}, existing && existing.meta, { source: 'extension' }),
    }
    if (control) {
      topic.meta.controlType = control.controlType
      if (form.screen) topic.meta.screen = form.screen
      if (form.hash != null) topic.meta.hash = form.hash
    }
    return topic
  }

  /** The help with the draft shown as well (replacing a saved topic of the same id) - for the live preview. */
  function withDraft(help, topic) {
    var base = help || { schemaVersion: 1, id: 'draft', title: 'Help', options: {}, topics: [] }
    if (!topic || !topic.target) return base
    // a topic that has its control stays visible while the author edits the title (empty for a moment): the control
    // must not lose its highlight; the stand-in title is only shown in the preview, never saved
    if (!topic.title) topic = Object.assign({}, topic, { title: 'New topic' })
    var topics = base.topics.some(function (t) {
      return t.id === topic.id
    })
      ? base.topics.map(function (t) {
          return t.id === topic.id ? topic : t
        })
      : base.topics.concat([topic])
    return Object.assign({}, base, { topics: topics })
  }

  root.TourdExt = {
    VERSION: VERSION,
    helpTarget: helpTarget,
    parseLinks: parseLinks,
    formatLinks: formatLinks,
    draftTopic: draftTopic,
    withDraft: withDraft,
    idleState: idleState,
    addStep: addStep,
    removeStep: removeStep,
    addNote: addNote,
    setExplain: setExplain,
    PURPOSES: PURPOSES,
    buildRecording: buildRecording,
    describeStep: describeStep,
    publicState: publicState,
  }
})(typeof self !== 'undefined' ? self : globalThis)
