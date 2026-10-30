/*!
 * TourD recorder - records what a person does in a running SAPUI5 / OpenUI5 app, as UI5 sees it.
 *
 * One file, no dependencies. It runs in the page's own JavaScript world (the Chrome/Edge extension injects it
 * there; it can also be pasted into the console). It listens to the events UI5 controls fire (press, change,
 * selectionChange, search, ...), so every step names the exact control: id, view, controller, type, text,
 * i18n key, binding path, and whether the id is stable. The result is a "tourd-recording" document
 * (shared/recording-schema.mjs).
 *
 *   __tourdRecorder.start();            // begin
 *   __tourdRecorder.stop();             // end, returns the recording
 *   __tourdRecorder.download();         // saves tourd-recording.json
 *
 * Passwords and other sensitive fields are never recorded (the step says `redacted: true`).
 */
;(function () {
  'use strict'

  var VERSION = '0.1.0'
  var FORMAT = 'tourd-recording'
  var root = typeof window !== 'undefined' ? window : globalThis

  if (root.__tourdRecorder && root.__tourdRecorder.version === VERSION) return // already installed
  if (root.__tourdRecorder && root.__tourdRecorder.destroy) root.__tourdRecorder.destroy()

  // ------------------------------------------------------------------ small helpers

  var SENSITIVE =
    /pass(word|wd|code)?\b|pwd|secret|token|api[-_ ]?key|credential|\bpin\b|cvv|iban|ssn/i
  var MAX_TEXT = 300

  var state = {
    recording: false,
    paused: false,
    steps: [],
    t0: 0,
    startedAt: null,
    app: null,
    listeners: [],
    options: {},
    patch: null,
    hashHandler: null,
    pick: null,
  }

  function sapUi() {
    return root.sap && root.sap.ui ? root.sap.ui : null
  }

  /** The module if UI5 has already loaded it (synchronous require), else null. */
  function mod(name) {
    try {
      var ui = sapUi()
      return ui && ui.require ? ui.require(name) || null : null
    } catch (e) {
      return null
    }
  }

  function clean(value) {
    if (typeof value !== 'string') return undefined
    var t = value.replace(/\s+/g, ' ').trim()
    if (!t) return undefined
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t
  }

  function call(obj, method) {
    try {
      return obj && typeof obj[method] === 'function' ? obj[method]() : undefined
    } catch (e) {
      return undefined
    }
  }

  function isA(obj, type) {
    try {
      return !!obj && typeof obj.isA === 'function' && obj.isA(type)
    } catch (e) {
      return false
    }
  }

  function getElement(id) {
    var Element = mod('sap/ui/core/Element')
    try {
      if (Element && Element.getElementById) return Element.getElementById(id)
      if (Element && Element.registry) return Element.registry.get(id)
      var core = root.sap.ui.getCore && root.sap.ui.getCore()
      return core && core.byId ? core.byId(id) : null
    } catch (e) {
      return null
    }
  }

  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k)
  }

  // ------------------------------------------------------------------ control description

  function nearestView(control) {
    for (var p = call(control, 'getParent'); p; p = call(p, 'getParent')) {
      if (isA(p, 'sap.ui.core.mvc.View')) return p
    }
    return null
  }

  /** A view that owns the id by prefix, for controls that are not (yet) attached to a view, e.g. dialogs. */
  function viewByIdPrefix(id) {
    var Element = mod('sap/ui/core/Element')
    if (!Element || !Element.registry || !Element.registry.filter) return null
    var best = null
    try {
      Element.registry.filter(function (e) {
        if (isA(e, 'sap.ui.core.mvc.View') && id.indexOf(e.getId() + '--') === 0) {
          if (!best || e.getId().length > best.getId().length) best = e
        }
        return false
      })
    } catch (e) {
      return null
    }
    return best
  }

  function controllerNameOf(view) {
    if (!view) return null
    try {
      var c = view.getController && view.getController()
      var n = c && c.getMetadata && c.getMetadata().getName()
      if (n && n !== 'sap.ui.core.mvc.Controller') return n
    } catch (e) {
      /* fall through */
    }
    return call(view, 'getControllerName') || null
  }

  function isGeneratedId(localId) {
    return !localId || /^__/.test(localId) || /-__/.test(localId)
  }

  /** True when the control (or an ancestor up to its view) was created from a binding template. */
  function isClone(control, view) {
    for (var n = control; n && n !== view; n = call(n, 'getParent')) {
      var parent = call(n, 'getParent')
      var agg = n.sParentAggregationName
      if (parent && agg && typeof parent.getBindingInfo === 'function') {
        try {
          if (parent.getBindingInfo(agg)) return true
        } catch (e) {
          /* ignore */
        }
      }
    }
    return false
  }

  function insideOverlay(control) {
    for (var p = control; p; p = call(p, 'getParent')) {
      if (isA(p, 'sap.m.Dialog') || isA(p, 'sap.m.Popover')) return true
    }
    return false
  }

  function textOf(control) {
    var methods = ['getText', 'getTitle', 'getHeaderText', 'getLabel']
    for (var i = 0; i < methods.length; i++) {
      var v = call(control, methods[i])
      if (typeof v === 'string' && clean(v)) return clean(v)
    }
    return undefined
  }

  function labelOf(control) {
    var LabelEnablement = mod('sap/ui/core/LabelEnablement')
    if (!LabelEnablement || !LabelEnablement.getReferencingLabels) return undefined
    try {
      var ids = LabelEnablement.getReferencingLabels(control) || []
      for (var i = 0; i < ids.length; i++) {
        var label = getElement(ids[i])
        var t = label && clean(call(label, 'getText'))
        if (t) return t
      }
    } catch (e) {
      /* ignore */
    }
    return undefined
  }

  /** text="{i18n>create}" -> { property: 'text', model: 'i18n', key: 'create' } */
  function i18nOf(control) {
    var props = ['text', 'title', 'tooltip', 'placeholder', 'label', 'headerText']
    for (var i = 0; i < props.length; i++) {
      try {
        var info = control.getBindingInfo && control.getBindingInfo(props[i])
        var part = info && info.parts && info.parts.length === 1 ? info.parts[0] : null
        if (!part || !part.model || !part.path) continue
        var model = control.getModel(part.model)
        if (isA(model, 'sap.ui.model.resource.ResourceModel'))
          return { property: props[i], model: part.model, key: part.path }
      } catch (e) {
        /* try the next property */
      }
    }
    return undefined
  }

  /** Everything the recording says about one control. Never throws. */
  function describe(control) {
    var id = call(control, 'getId') || ''
    var view = nearestView(control) || viewByIdPrefix(id)
    var localId = null
    if (view && id.indexOf(view.getId() + '--') === 0) localId = id.slice(view.getId().length + 2)
    var clone = view ? isClone(control, view) : false
    var d = {
      id: id,
      localId: localId,
      viewName: view ? call(view, 'getViewName') || null : null,
      controllerName: controllerNameOf(view),
      controlType: (control.getMetadata && control.getMetadata().getName()) || 'unknown',
      stableId: !!localId && !isGeneratedId(localId) && !clone,
    }
    var text = textOf(control)
    if (text) d.text = text
    var label = labelOf(control)
    if (label) d.label = label
    var tooltip = clean(call(control, 'getTooltip_AsString'))
    if (tooltip) d.tooltip = tooltip
    var placeholder = clean(call(control, 'getPlaceholder'))
    if (placeholder) d.placeholder = placeholder
    var i18n = i18nOf(control)
    if (i18n) d.i18n = i18n
    if (clone) {
      d.inList = true
      try {
        var ctx = control.getBindingContext && control.getBindingContext()
        var path = ctx && ctx.getPath()
        if (path) d.bindingPath = path
      } catch (e) {
        /* ignore */
      }
    }
    if (insideOverlay(control)) d.inDialog = true
    return d
  }

  function isSensitive(control, d) {
    if (call(control, 'getType') === 'Password') return true
    if (state.options.redactSensitive === false) return false
    return SENSITIVE.test([d.localId, d.label, d.placeholder, d.tooltip, d.text].join(' '))
  }

  // ------------------------------------------------------------------ steps

  function now() {
    return Math.max(0, Date.now() - state.t0)
  }

  var RECENT_MS = 300

  function duplicate(step) {
    var last = state.steps[state.steps.length - 1]
    if (!last || step.t - last.t > RECENT_MS) return false
    return (
      last.type === step.type &&
      (last.control && step.control
        ? last.control.id === step.control.id
        : !last.control && !step.control) &&
      last.value === step.value
    )
  }

  /** Tells whoever listens on this page (the extension's bridge) what is going on. */
  function bridge(message) {
    if (state.options.bridge === false) return
    message.tourd = 'recorder'
    try {
      root.postMessage(message, '*')
    } catch (e) {
      /* not serialisable: ignore */
    }
  }

  function emit(step) {
    if (!state.recording || state.paused) return null
    step.t = now()
    if (step.type !== 'navigate' && duplicate(step)) return null
    if (step.type === 'navigate') {
      // a navigation right after an action belongs to that action
      for (var i = state.steps.length - 1; i >= 0; i--) {
        if (state.steps[i].type !== 'navigate' && state.steps[i].type !== 'note') {
          if (step.t - state.steps[i].t < 1500) step.causedBy = state.steps[i].index
          break
        }
      }
    }
    step.index = state.steps.length
    state.steps.push(step)
    state.listeners.slice().forEach(function (fn) {
      try {
        fn(step, state.steps.length)
      } catch (e) {
        /* a broken listener must not break recording */
      }
    })
    bridge({ type: 'step', step: step, count: state.steps.length })
    return step
  }

  /**
   * Asks UI5 itself for a selector that finds this control again (the algorithm of UI5's own Test Recorder: an id when
   * it is stable, else properties, bindings, texts or a parent, checked to match one control). It arrives a moment
   * after the step, so it is added to the step and announced to the extension separately.
   */
  function attachSelector(step, control) {
    try {
      var ui = sapUi()
      var dom = call(control, 'getDomRef')
      if (!ui || !ui.require || !dom || !step || !step.control) return
      var local = step.index
      var done = function (found) {
        var selector
        try {
          selector = JSON.parse(JSON.stringify(found)) // a RegExp or a function does not survive: that is fine
        } catch (e) {
          return
        }
        if (!selector || typeof selector !== 'object' || !Object.keys(selector).length) return
        step.control.selector = selector
        bridge({ type: 'selector', local: local, selector: selector })
      }
      ui.require(
        ['sap/ui/test/RecordReplay'],
        function (RR) {
          if (!RR || !RR.findControlSelectorByDOMElement) return
          // UI5 found no selector for some controls: such a step keeps what the recorder knows itself
          RR.findControlSelectorByDOMElement({ domElement: dom }).then(done, function () {})
        },
        function () {},
      )
    } catch (e) {
      /* never break recording */
    }
  }

  /** Loads UI5's record/replay module in the background, so that the first step can ask it. */
  function preloadSelectors() {
    try {
      var ui = sapUi()
      if (ui && ui.require && !mod('sap/ui/test/RecordReplay'))
        ui.require(
          ['sap/ui/test/RecordReplay'],
          function () {},
          function () {},
        )
    } catch (e) {
      /* not available in this UI5 version */
    }
  }

  function controlStep(type, event, control, extra) {
    var d = describe(control)
    if (!d.id) return null // not a real control: nothing to point at
    var step = { type: type, event: event, control: d }
    if (extra)
      Object.keys(extra).forEach(function (k) {
        if (extra[k] !== undefined) step[k] = extra[k]
      })
    if (
      (type === 'input' || type === 'search') &&
      step.value !== undefined &&
      isSensitive(control, d)
    ) {
      delete step.value
      step.redacted = true
    }
    var emitted = emit(step)
    if (emitted) attachSelector(emitted, control)
    return emitted
  }

  /** A chosen item: key and visible text. */
  function itemInfo(item, source) {
    var key = call(item, 'getKey')
    var text = clean(call(item, 'getText') || call(item, 'getTitle'))
    var value = key !== undefined && key !== '' ? String(key) : text
    if (value === undefined) value = clean(call(source, 'getValue'))
    return { value: value, valueText: text }
  }

  var HANDLERS = {
    press: function (source) {
      if (isA(source, 'sap.m.InputBase')) return // value help icon etc. is not a step of its own
      controlStep('press', 'press', source)
    },
    tap: function (source) {
      HANDLERS.press(source)
    },
    itemPress: function (source, params) {
      var item = params && params.listItem
      if (item) controlStep('press', 'itemPress', item)
    },
    search: function (source, params) {
      if (params && params.refreshButtonPressed) return
      var q = params && typeof params.query === 'string' ? params.query : call(source, 'getValue')
      controlStep('search', 'search', source, { value: q === undefined ? '' : String(q) })
    },
    change: function (source, params) {
      if (isA(source, 'sap.m.SearchField')) return // its search event is the step
      if (isA(source, 'sap.m.Switch')) {
        controlStep('toggle', 'change', source, { value: !!(params && params.state) })
      } else if (isA(source, 'sap.m.Select') || isA(source, 'sap.m.ComboBoxBase')) {
        var item = (params && params.selectedItem) || call(source, 'getSelectedItem')
        var info = itemInfo(item, source)
        controlStep('select', 'change', source, { value: info.value, valueText: info.valueText })
      } else if (isA(source, 'sap.m.InputBase') || typeof source.getValue === 'function') {
        var v = call(source, 'getValue')
        controlStep('input', 'change', source, { value: v === undefined ? '' : String(v) })
      }
    },
    selectionChange: function (source, params) {
      if (
        isA(source, 'sap.m.Select') ||
        isA(source, 'sap.m.ComboBoxBase') ||
        isA(source, 'sap.m.MultiComboBox')
      ) {
        var item = (params && params.selectedItem) || call(source, 'getSelectedItem')
        var i = itemInfo(item, source)
        controlStep('select', 'selectionChange', source, { value: i.value, valueText: i.valueText })
      } else if (isA(source, 'sap.m.SegmentedButton')) {
        var seg = (params && params.item) || null
        var s = itemInfo(seg, source)
        controlStep('select', 'selectionChange', source, { value: s.value, valueText: s.valueText })
      } else if (isA(source, 'sap.m.ListBase')) {
        var row = (params && (params.listItem || (params.listItems && params.listItems[0]))) || null
        if (row) {
          var r = itemInfo(row, source)
          controlStep('select', 'selectionChange', row, {
            value: r.value,
            valueText: r.valueText || textOf(row),
          })
        }
      }
    },
    select: function (source, params) {
      if (isA(source, 'sap.m.CheckBox')) {
        controlStep('toggle', 'select', source, { value: !!(params && params.selected) })
      } else if (isA(source, 'sap.m.RadioButton')) {
        if (params && params.selected)
          controlStep('select', 'select', source, { value: true, valueText: textOf(source) })
      } else if (isA(source, 'sap.m.IconTabBar')) {
        var tab = (params && params.item) || null
        if (tab) controlStep('press', 'select', tab)
      }
    },
  }

  function onUi5Event(source, eventId, params) {
    if (!state.recording || state.paused || !HANDLERS[eventId]) return
    var dom = call(source, 'getDomRef')
    if (dom && dom.closest && dom.closest('[data-tourd-ui]')) return
    HANDLERS[eventId](source, params || {})
  }

  // ------------------------------------------------------------------ hooking into UI5

  /** Patches fireEvent on the first prototype of Control that defines it; returns a function that undoes it. */
  function installEventHook() {
    var Control = mod('sap/ui/core/Control') || mod('sap/ui/base/EventProvider')
    if (!Control) return null
    var proto = Control.prototype
    while (proto && !hasOwn(proto, 'fireEvent')) proto = Object.getPrototypeOf(proto)
    if (!proto) return null
    var original = proto.fireEvent
    var wrapper = function (eventId) {
      try {
        onUi5Event(this, eventId, arguments[1])
      } catch (e) {
        /* recording must never break the app */
      }
      return original.apply(this, arguments)
    }
    wrapper.__tourdOriginal = original
    proto.fireEvent = wrapper
    return function undo() {
      if (proto.fireEvent === wrapper) proto.fireEvent = original
    }
  }

  function rawHash() {
    return String(root.location.hash || '').replace(/^#/, '')
  }

  function installHashHook() {
    var last = rawHash()
    var handler = function () {
      var h = rawHash()
      if (h === last) return
      last = h
      emit({
        type: 'navigate',
        hash: h,
        url: root.location.origin + root.location.pathname + '#' + h,
      })
    }
    root.addEventListener('hashchange', handler)
    return function undo() {
      root.removeEventListener('hashchange', handler)
    }
  }

  function appInfo() {
    var ui = sapUi()
    var appId = null
    try {
      var Component = mod('sap/ui/core/Component')
      var comps =
        Component && Component.registry
          ? Component.registry.filter(function () {
              return true
            })
          : []
      for (var i = 0; i < comps.length && !appId; i++)
        appId = (comps[i].getManifestEntry && comps[i].getManifestEntry('/sap.app/id')) || null
    } catch (e) {
      /* ignore */
    }
    var locale = null
    try {
      var Localization = mod('sap/base/i18n/Localization')
      locale = (Localization && Localization.getLanguage && Localization.getLanguage()) || null
    } catch (e) {
      /* ignore */
    }
    return {
      url: root.location.origin + root.location.pathname,
      startHash: rawHash(),
      title: root.document ? root.document.title || '' : '',
      ui5Version: (ui && root.sap.ui.version) || null,
      appId: appId,
      locale: locale || (root.navigator && root.navigator.language) || null,
    }
  }

  // ------------------------------------------------------------------ pick mode (point at a control)

  function controlAtDom(el) {
    var node = el && el.closest ? el.closest('[data-sap-ui]') : null
    return node ? getElement(node.getAttribute('data-sap-ui')) : null
  }

  /** The hit control, or the nearest parent that has an id of its own in a view. */
  function pickTarget(control) {
    var view
    for (var c = control; c; c = call(c, 'getParent')) {
      view = nearestView(c)
      var id = call(c, 'getId') || ''
      if (
        view &&
        id.indexOf(view.getId() + '--') === 0 &&
        !isGeneratedId(id.slice(view.getId().length + 2))
      )
        return c
    }
    return control
  }

  function stopPick() {
    var p = state.pick
    if (!p) return
    state.pick = null
    p.undo()
  }

  function startPick(callback, hint) {
    stopPick()
    var doc = root.document
    // while it waits: a crosshair, and (when asked) a line that says what to do and how to give up
    var cursor = doc.createElement('style')
    cursor.setAttribute('data-tourd-ui', '')
    cursor.textContent = 'html,html *{cursor:crosshair!important}'
    doc.head.appendChild(cursor)
    var note = null
    if (hint) {
      note = doc.createElement('div')
      note.setAttribute('data-tourd-ui', '')
      note.setAttribute('role', 'status')
      note.textContent = hint
      note.style.cssText =
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483001;pointer-events:none;background:#0b1f3a;color:#fff;font:600 13px/1.3 system-ui,Segoe UI,sans-serif;padding:8px 16px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.3)'
      doc.body.appendChild(note)
    }
    var box = doc.createElement('div')
    box.setAttribute('data-tourd-ui', '')
    box.style.cssText =
      'position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #0a6ed1;background:rgba(10,110,209,.12);border-radius:3px;display:none;'
    doc.body.appendChild(box)
    var swallow = function (e) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    var onMove = function (e) {
      var control = controlAtDom(e.target)
      var dom = control && call(control, 'getDomRef')
      if (!dom) {
        box.style.display = 'none'
        return
      }
      var r = dom.getBoundingClientRect()
      box.style.display = 'block'
      box.style.left = r.left + 'px'
      box.style.top = r.top + 'px'
      box.style.width = r.width + 'px'
      box.style.height = r.height + 'px'
    }
    var onClick = function (e) {
      swallow(e)
      var hit = controlAtDom(e.target)
      if (!hit) return
      stopPick()
      var target = pickTarget(hit)
      var d = describe(target)
      if (target !== hit) d.clicked = (hit.getMetadata && hit.getMetadata().getName()) || undefined
      callback(d, target)
    }
    var onKey = function (e) {
      if (e.key === 'Escape') {
        swallow(e)
        stopPick()
        callback(null)
      }
    }
    var swallowed = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']
    doc.addEventListener('mousemove', onMove, true)
    doc.addEventListener('click', onClick, true)
    doc.addEventListener('keydown', onKey, true)
    swallowed.forEach(function (n) {
      doc.addEventListener(n, swallow, true)
    })
    state.pick = {
      undo: function () {
        doc.removeEventListener('mousemove', onMove, true)
        doc.removeEventListener('click', onClick, true)
        doc.removeEventListener('keydown', onKey, true)
        swallowed.forEach(function (n) {
          doc.removeEventListener(n, swallow, true)
        })
        if (box.parentNode) box.parentNode.removeChild(box)
        if (note && note.parentNode) note.parentNode.removeChild(note)
        if (cursor.parentNode) cursor.parentNode.removeChild(cursor)
      },
    }
  }

  /** What a check on this control says: its value, its text, or only that it is there. A secret is never read. */
  function checkOf(control, d) {
    if (isSensitive(control, d)) return { kind: 'visible' }
    var value = call(control, 'getValue')
    if (typeof value === 'string') return { kind: 'value', expected: clean(value) }
    var text = call(control, 'getText')
    if (typeof text === 'string' && text) return { kind: 'text', expected: clean(text) }
    return { kind: 'visible' }
  }

  // ------------------------------------------------------------------ public API

  function recording() {
    return {
      format: FORMAT,
      version: 1,
      recordedAt: state.startedAt || new Date().toISOString(),
      recorder: 'tourd-recorder ' + VERSION,
      app: state.app || appInfo(),
      steps: state.steps.map(function (s) {
        return JSON.parse(JSON.stringify(s))
      }),
    }
  }

  function unhook() {
    if (state.patch) state.patch()
    if (state.hashHandler) state.hashHandler()
    state.patch = null
    state.hashHandler = null
  }

  var api = {
    version: VERSION,

    /** Begins recording. Options: { keep: continue the steps already recorded, redactSensitive: false, bridge: false } */
    start: function (options) {
      if (!sapUi())
        throw new Error(
          'This page does not use UI5 (sap.ui is missing), so there is nothing to record.',
        )
      options = options || {}
      if (state.recording) return api
      state.options = options
      if (!options.keep || !state.steps.length) {
        state.steps = []
        state.startedAt = new Date().toISOString()
        state.t0 = Date.now()
        state.app = appInfo()
      } else {
        state.t0 = Date.now() - (state.steps[state.steps.length - 1].t || 0)
      }
      state.patch = installEventHook()
      if (!state.patch)
        throw new Error(
          'UI5 is not ready yet (sap/ui/core/Control is not loaded). Try again in a moment.',
        )
      state.hashHandler = installHashHook()
      preloadSelectors()
      state.recording = true
      state.paused = false
      bridge({ type: 'started', app: state.app, recorder: 'tourd-recorder ' + VERSION })
      return api
    },

    /** Ends recording and returns the recording document. */
    stop: function () {
      var wasRecording = state.recording
      state.recording = false
      state.paused = false
      stopPick()
      unhook()
      if (wasRecording) bridge({ type: 'stopped', count: state.steps.length })
      return recording()
    },

    pause: function () {
      state.paused = true
    },
    resume: function () {
      if (state.recording) state.paused = false
    },
    isRecording: function () {
      return state.recording
    },
    isPaused: function () {
      return state.paused
    },

    getRecording: recording,
    steps: function () {
      return state.steps.slice()
    },
    clear: function () {
      state.steps = []
    },

    /** Removes one step (and renumbers the rest). */
    removeStep: function (index) {
      state.steps.splice(index, 1)
      state.steps.forEach(function (s, i) {
        s.index = i
      })
    },
    undo: function () {
      state.steps.pop()
    },

    addNote: function (note) {
      return emit({ type: 'note', note: clean(String(note)) || 'note' })
    },

    /** Calls fn(step, count) for each new step; returns a function that stops listening. */
    onStep: function (fn) {
      state.listeners.push(fn)
      return function () {
        state.listeners = state.listeners.filter(function (f) {
          return f !== fn
        })
      }
    },

    /** Point at a control: the recording gets a "check" step with what the control shows now (Escape cancels). */
    pickCheck: function () {
      startPick(function (d, control) {
        if (!d || !control) return
        var checked = emit({
          type: 'check',
          event: 'check',
          control: d,
          check: checkOf(control, d),
        })
        if (checked) attachSelector(checked, control)
      })
    },

    /** Highlights controls under the pointer; the next click calls callback(description) (null on Escape). */
    pick: startPick,
    cancelPick: stopPick,

    /** The description of a control (or of the control a DOM element belongs to). */
    describe: function (target) {
      var control = target && target.nodeType === 1 ? controlAtDom(target) : target
      return control ? describe(control) : null
    },

    /** Saves the recording as tourd-recording.json (for use from the console). */
    download: function (filename) {
      var rec = recording()
      var blob = new root.Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' })
      var url = root.URL.createObjectURL(blob)
      var a = root.document.createElement('a')
      a.href = url
      a.download = filename || 'tourd-recording.json'
      root.document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(function () {
        root.URL.revokeObjectURL(url)
      }, 1000)
      return rec
    },

    destroy: function () {
      state.recording = false
      stopPick()
      unhook()
      state.listeners = []
      if (root.__tourdRecorder === api) delete root.__tourdRecorder
    },

    /** Exposed for tests. */
    internals: {
      describe: describe,
      isGeneratedId: isGeneratedId,
      isSensitive: isSensitive,
      emit: emit,
      handle: onUi5Event,
      clean: clean,
    },
  }

  root.__tourdRecorder = api
})()
