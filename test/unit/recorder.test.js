import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateRecording } from '../../shared/recording-schema.mjs'

// The recorder's logic, run in a sandbox with a small fake of UI5 (the real thing is tested in a browser in
// test/e2e/recorder.spec.js). The fake is just enough to have controls, views, bindings and events.

const source = readFileSync('recorder/recorder.js', 'utf8')
const plain = (x) => JSON.parse(JSON.stringify(x))

function makeWorld({ withUi5 = true } = {}) {
  const posted = []
  const handlers = {}
  const all = []

  class Control {
    constructor(id, type, { types = [], parent = null, props = {}, aggregation = null } = {}) {
      this.id = id
      this.type = type
      this.types = [type, ...types]
      this.parent = parent
      this.props = props
      this.sParentAggregationName = aggregation
      this.bindings = {}
      this.models = {}
      this.dom = null
      this.context = null
      this.labels = []
      all.push(this)
    }
    fireEvent(eventId) {
      return eventId // the "real" implementation
    }
    getId() {
      return this.id
    }
    getParent() {
      return this.parent
    }
    getMetadata() {
      return { getName: () => this.type }
    }
    isA(t) {
      return this.types.includes(t)
    }
    getBindingInfo(p) {
      return this.bindings[p]
    }
    getModel(n) {
      return this.models[n]
    }
    getBindingContext() {
      return this.context
    }
    getDomRef() {
      return this.dom
    }
    getTooltip_AsString() {
      return this.props.tooltip
    }
    getText() {
      return this.props.text
    }
    getTitle() {
      return this.props.title
    }
    getPlaceholder() {
      return this.props.placeholder
    }
    getValue() {
      return this.props.value
    }
    getType() {
      return this.props.type
    }
    getSelectedItem() {
      return this.props.selectedItem
    }
    getKey() {
      return this.props.key
    }
  }

  const win = {
    location: { origin: 'http://app', pathname: '/index.html', hash: '' },
    document: { title: 'Demo Orders', body: {}, addEventListener() {}, removeEventListener() {} },
    navigator: { language: 'en-US' },
    postMessage: (m) => posted.push(m),
    addEventListener: (n, fn) => (handlers[n] ??= []).push(fn),
    removeEventListener: (n, fn) => (handlers[n] = (handlers[n] ?? []).filter((f) => f !== fn)),
    setTimeout,
  }
  win.window = win

  const modules = {
    'sap/ui/core/Control': Control,
    'sap/ui/core/Element': {
      registry: { filter: (fn) => all.filter(fn) },
      getElementById: (id) => all.find((c) => c.id === id) ?? null,
    },
    'sap/ui/core/LabelEnablement': {
      getReferencingLabels: (c) => c.labels.map((l) => l.id),
    },
    'sap/ui/core/Component': {
      registry: { filter: () => [{ getManifestEntry: () => 'demo.orders' }] },
    },
  }
  if (withUi5) win.sap = { ui: { version: '1.120.5', require: (name) => modules[name] } }

  vm.createContext(win)
  const load = () => vm.runInContext(source, win)
  load()

  // builders
  const view = (id, name, controller = 'demo.orders.controller.Main') => {
    const v = new Control(id, 'sap.ui.core.mvc.XMLView', { types: ['sap.ui.core.mvc.View'] })
    v.getViewName = () => name
    v.getController = () => ({ getMetadata: () => ({ getName: () => controller }) })
    return v
  }
  const ctl = (v, local, type, options = {}) =>
    new Control(`${v.id}--${local}`, type, { parent: v, ...options })

  return {
    win,
    load,
    posted,
    handlers,
    Control,
    view,
    ctl,
    rec: () => win.__tourdRecorder,
    fire: (control, eventId, params) => control.fireEvent(eventId, params),
  }
}

const brief = (rec) => plain(rec.steps).map((s) => [s.type, s.control?.localId ?? s.hash, s.value])

describe('recorder: start and stop', () => {
  it('refuses politely on a page that does not use UI5', () => {
    const w = makeWorld({ withUi5: false })
    expect(() => w.rec().start()).toThrow(/does not use UI5/)
  })

  it('hooks UI5 events while recording and puts everything back when it stops', () => {
    const w = makeWorld()
    const original = w.Control.prototype.fireEvent
    w.rec().start()
    expect(w.Control.prototype.fireEvent).not.toBe(original)
    expect(w.rec().isRecording()).toBe(true)
    w.rec().stop()
    expect(w.Control.prototype.fireEvent).toBe(original)
    expect(w.rec().isRecording()).toBe(false)
  })

  it('never changes what the app sees: the real event still fires and returns its value', () => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    const b = w.ctl(v, 'createBtn', 'sap.m.Button', { props: { text: 'Create' } })
    w.rec().start()
    expect(w.fire(b, 'press', {})).toBe('press')
    expect(w.fire(b, 'somethingElse', {})).toBe('somethingElse')
  })

  it('writes a recording that the contract accepts', () => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    const b = w.ctl(v, 'createBtn', 'sap.m.Button', { props: { text: 'Create' } })
    w.rec().start()
    w.fire(b, 'press', {})
    const rec = plain(w.rec().stop())
    expect(validateRecording(rec).issues).toEqual([])
    expect(rec.app).toMatchObject({
      url: 'http://app/index.html',
      title: 'Demo Orders',
      ui5Version: '1.120.5',
      appId: 'demo.orders',
      locale: 'en-US',
    })
    expect(rec.recorder).toMatch(/^tourd-recorder /)
  })

  it('installing it twice gives the same recorder; destroy removes it', () => {
    const w = makeWorld()
    const first = w.rec()
    w.load()
    expect(w.rec()).toBe(first)
    first.destroy()
    expect(w.rec()).toBeUndefined()
    w.load()
    expect(w.rec()).not.toBe(first)
  })
})

describe('recorder: what it knows about a control', () => {
  const setup = () => {
    const w = makeWorld()
    const v = w.view('container---main', 'demo.orders.view.Main')
    return { w, v }
  }

  it('names the view, the controller, the type and the id as written in the view', () => {
    const { w, v } = setup()
    const b = w.ctl(v, 'createBtn', 'sap.m.Button', {
      props: { text: '  Create   order ', tooltip: 'Make one' },
    })
    expect(plain(w.rec().describe(b))).toEqual({
      id: 'container---main--createBtn',
      localId: 'createBtn',
      viewName: 'demo.orders.view.Main',
      controllerName: 'demo.orders.controller.Main',
      controlType: 'sap.m.Button',
      stableId: true,
      text: 'Create order',
      tooltip: 'Make one',
    })
  })

  it('reads the i18n key behind a text, and the label of an input', () => {
    const { w, v } = setup()
    const b = w.ctl(v, 'createBtn', 'sap.m.Button', { props: { text: 'Create' } })
    b.models.i18n = { isA: (t) => t === 'sap.ui.model.resource.ResourceModel' }
    b.bindings.text = { parts: [{ model: 'i18n', path: 'create' }] }
    expect(plain(w.rec().describe(b)).i18n).toEqual({
      property: 'text',
      model: 'i18n',
      key: 'create',
    })

    const input = w.ctl(v, 'customer', 'sap.m.Input', { props: { placeholder: 'Name' } })
    input.labels = [w.ctl(v, 'customerLabel', 'sap.m.Label', { props: { text: 'Customer' } })]
    expect(plain(w.rec().describe(input))).toMatchObject({ label: 'Customer', placeholder: 'Name' })
  })

  it('does not take a plain model binding for i18n', () => {
    const { w, v } = setup()
    const t = w.ctl(v, 'name', 'sap.m.Text', { props: { text: 'Anna' } })
    t.models.data = { isA: () => false }
    t.bindings.text = { parts: [{ model: 'data', path: 'name' }] }
    expect(plain(w.rec().describe(t)).i18n).toBeUndefined()
  })

  it('says an id is not stable when UI5 generated it', () => {
    const { w, v } = setup()
    const auto = w.ctl(v, '__button3', 'sap.m.Button')
    expect(plain(w.rec().describe(auto))).toMatchObject({ localId: '__button3', stableId: false })
    const nested = w.ctl(v, 'x-__item1', 'sap.m.Text')
    expect(w.rec().describe(nested).stableId).toBe(false)
    const outside = new w.Control('__xmlview0', 'sap.m.Page')
    expect(plain(w.rec().describe(outside))).toMatchObject({
      localId: null,
      viewName: null,
      stableId: false,
    })
  })

  it('recognises a clone made by a list binding, with its binding path', () => {
    const { w, v } = setup()
    const table = w.ctl(v, 'ordersTable', 'sap.m.Table')
    table.bindings.items = { path: '/Orders' }
    const row = w.ctl(v, 'row-2', 'sap.m.ColumnListItem', { parent: table, aggregation: 'items' })
    row.context = { getPath: () => '/Orders/2' }
    expect(plain(w.rec().describe(row))).toMatchObject({
      stableId: false,
      inList: true,
      bindingPath: '/Orders/2',
    })
    const header = w.ctl(v, 'header', 'sap.m.Title', {
      parent: table,
      aggregation: 'headerToolbar',
    })
    expect(w.rec().describe(header).inList).toBeUndefined()
  })

  it('knows when a control is inside a dialog', () => {
    const { w, v } = setup()
    const dialog = w.ctl(v, 'confirm', 'sap.m.Dialog')
    const yes = w.ctl(v, 'yesBtn', 'sap.m.Button', { parent: dialog })
    expect(w.rec().describe(yes).inDialog).toBe(true)
  })

  it('finds the view of a dialog that is not attached to one by the prefix of its ids', () => {
    const { w, v } = setup()
    const orphan = new w.Control('container---main--confirmBtn', 'sap.m.Button')
    expect(plain(w.rec().describe(orphan))).toMatchObject({
      localId: 'confirmBtn',
      viewName: 'demo.orders.view.Main',
      stableId: true,
    })
    void v
  })

  it('survives controls that miss methods', () => {
    const w = makeWorld()
    const odd = { getId: () => 'odd', getMetadata: () => ({ getName: () => 'x.Odd' }) }
    expect(plain(w.rec().describe(odd))).toMatchObject({
      id: 'odd',
      controlType: 'x.Odd',
      stableId: false,
    })
  })
})

describe('recorder: steps from UI5 events', () => {
  const setup = () => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    w.rec().start()
    return { w, v }
  }

  it('press', () => {
    const { w, v } = setup()
    w.fire(w.ctl(v, 'createBtn', 'sap.m.Button'), 'press', {})
    expect(brief(w.rec().getRecording())).toEqual([['press', 'createBtn', undefined]])
  })

  it('typing in an input, a date picker or a text area is one input step with the value', () => {
    const { w, v } = setup()
    const input = w.ctl(v, 'name', 'sap.m.Input', {
      types: ['sap.m.InputBase'],
      props: { value: 'Anna' },
    })
    w.fire(input, 'liveChange', { value: 'Ann' }) // not a step
    w.fire(input, 'change', { value: 'Anna' })
    expect(brief(w.rec().getRecording())).toEqual([['input', 'name', 'Anna']])
  })

  it('the field around an input keeps its value as the model does ([12, "USD"], true): not a step, the input inside is', () => {
    const { w, v } = setup()
    const inner = w.ctl(v, 'fee-edit-inner', 'sap.ui.mdc.field.FieldInput', {
      types: ['sap.m.InputBase'],
      props: { value: '12.00' },
    })
    const field = w.ctl(v, 'fee-edit', 'sap.ui.mdc.Field', {
      props: { value: [12, 'USD', undefined] },
    })
    const macro = w.ctl(v, 'fee', 'sap.fe.macros.Field', { props: { value: true } })
    w.fire(inner, 'change', { value: '12.00' })
    w.fire(field, 'change', { value: [12, 'USD'] })
    w.fire(macro, 'change', {})
    expect(brief(w.rec().getRecording())).toEqual([['input', 'fee-edit-inner', '12.00']])
  })

  it('a button in a dialog that is gone before UI5 has answered is found again by its own id', async () => {
    const { w } = setup()
    const dialog = new w.Control('myFragment--dlg', 'sap.m.Dialog', { types: ['sap.m.Dialog'] })
    const save = new w.Control('myFragment--Save', 'sap.m.Button', {
      parent: dialog,
      props: { text: 'Save' },
    })
    save.dom = {} // there when it is pressed; the dialog destroys itself in the handler
    w.fire(save, 'press', {})
    await new Promise((r) => setTimeout(r, 20))
    const [step] = plain(w.rec().getRecording().steps)
    expect(step.control).toMatchObject({ inDialog: true })
    expect(step.control.selector).toEqual({ id: 'myFragment--Save', searchOpenDialogs: true })
    // a generated id is no selector: it is made up again every time
    const gen = new w.Control('__button7', 'sap.m.Button', { parent: dialog })
    gen.dom = {}
    w.fire(gen, 'press', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(plain(w.rec().getRecording().steps)[1].control.selector).toBeUndefined()
  })

  it('a number in a StepInput is still typed text', () => {
    const { w, v } = setup()
    const step = w.ctl(v, 'qty', 'sap.m.StepInput', { props: { value: 3 } })
    w.fire(step, 'change', {})
    expect(brief(w.rec().getRecording())).toEqual([['input', 'qty', '3']])
  })

  it("a search is a search step; the field's own change and the refresh button are not steps", () => {
    const { w, v } = setup()
    const s = w.ctl(v, 'search', 'sap.m.SearchField', { props: { value: 'Acme' } })
    w.fire(s, 'change', {})
    w.fire(s, 'search', { query: 'Acme' })
    w.fire(s, 'search', { refreshButtonPressed: true })
    expect(brief(w.rec().getRecording())).toEqual([['search', 'search', 'Acme']])
  })

  it('choosing in a select gives the key and the text once, even if two events fire', () => {
    const { w, v } = setup()
    const item = { getKey: () => 'shipped', getText: () => 'Shipped' }
    const sel = w.ctl(v, 'status', 'sap.m.Select', { types: ['sap.m.Select'] })
    w.fire(sel, 'change', { selectedItem: item })
    w.fire(sel, 'selectionChange', { selectedItem: item })
    const rec = plain(w.rec().getRecording())
    expect(rec.steps).toHaveLength(1)
    expect(rec.steps[0]).toMatchObject({ type: 'select', value: 'shipped', valueText: 'Shipped' })
  })

  it('check boxes and switches are toggles with the new state', () => {
    const { w, v } = setup()
    w.fire(w.ctl(v, 'agree', 'sap.m.CheckBox'), 'select', { selected: true })
    w.fire(w.ctl(v, 'mode', 'sap.m.Switch'), 'change', { state: false })
    expect(brief(w.rec().getRecording())).toEqual([
      ['toggle', 'agree', true],
      ['toggle', 'mode', false],
    ])
  })

  it('a tab is a press on the tab; a row of a list is a press (once, though two events fire)', () => {
    const { w, v } = setup()
    const tab = w.ctl(v, 'tabDetails', 'sap.m.IconTabFilter')
    w.fire(w.ctl(v, 'tabs', 'sap.m.IconTabBar'), 'select', { item: tab })
    const row = w.ctl(v, 'row', 'sap.m.ColumnListItem')
    w.fire(row, 'press', {})
    w.fire(w.ctl(v, 'tbl', 'sap.m.Table'), 'itemPress', { listItem: row })
    expect(brief(w.rec().getRecording())).toEqual([
      ['press', 'tabDetails', undefined],
      ['press', 'row', undefined],
    ])
  })

  it('selecting a row of a list is a select step on the row', () => {
    const { w, v } = setup()
    const list = w.ctl(v, 'list', 'sap.m.List', { types: ['sap.m.ListBase'] })
    const item = w.ctl(v, 'item', 'sap.m.StandardListItem', { props: { title: 'Order 7' } })
    w.fire(list, 'selectionChange', { listItem: item })
    expect(plain(w.rec().getRecording()).steps[0]).toMatchObject({
      type: 'select',
      valueText: 'Order 7',
      control: { localId: 'item' },
    })
  })

  it('two identical presses a moment apart are one step; later ones are two', () => {
    const { w, v } = setup()
    const b = w.ctl(v, 'btn', 'sap.m.Button')
    w.fire(b, 'press', {})
    w.fire(b, 'press', {})
    expect(w.rec().steps()).toHaveLength(1)
    w.rec().steps()[0].t = -1000 // as if it was long ago
    w.fire(b, 'press', {})
    expect(w.rec().steps()).toHaveLength(2)
  })

  it("ignores controls of the recorder's own panel, and things it cannot name", () => {
    const { w, v } = setup()
    const mine = w.ctl(v, 'mine', 'sap.m.Button')
    mine.dom = { closest: (sel) => (sel === '[data-tourd-ui]' ? {} : null) }
    w.fire(mine, 'press', {})
    w.fire(
      {
        getId: () => '',
        getMetadata: () => ({ getName: () => 'x' }),
        isA: () => false,
        fireEvent() {},
      },
      'press',
      {},
    )
    expect(w.rec().steps()).toEqual([])
  })

  it('a broken control does not break the app', () => {
    const { w } = setup()
    const broken = new w.Control('b', 'sap.m.Button')
    broken.getMetadata = () => {
      throw new Error('boom')
    }
    expect(() => w.fire(broken, 'press', {})).not.toThrow()
  })
})

describe('recorder: secrets', () => {
  const type = (w, v, local, props, extra = {}) =>
    w.ctl(v, local, 'sap.m.Input', { types: ['sap.m.InputBase'], props, ...extra })
  const setup = (options) => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    w.rec().start(options)
    return { w, v }
  }

  it('leaves out the value of a password field and says so', () => {
    const { w, v } = setup()
    w.fire(type(w, v, 'pw', { type: 'Password', value: 'hunter2' }), 'change', {})
    const step = plain(w.rec().getRecording()).steps[0]
    expect(step).toMatchObject({ type: 'input', redacted: true })
    expect(step.value).toBeUndefined()
    expect(JSON.stringify(w.rec().getRecording())).not.toContain('hunter2')
  })

  it('also when the name, label or placeholder says it is a secret', () => {
    const { w, v } = setup()
    w.fire(type(w, v, 'apiKey', { value: 'sk-1' }), 'change', {})
    w.fire(type(w, v, 'x', { value: 'sk-2', placeholder: 'Your PIN' }), 'change', {})
    w.fire(type(w, v, 'y', { value: 'sk-3', tooltip: 'Secret token' }), 'change', {})
    w.fire(type(w, v, 'nickname', { value: 'Anna' }), 'change', {})
    const steps = plain(w.rec().getRecording()).steps
    expect(steps.map((s) => s.redacted === true)).toEqual([true, true, true, false])
    expect(JSON.stringify(steps)).not.toMatch(/sk-\d/)
    expect(steps[3].value).toBe('Anna')
  })

  it('a search for a secret-looking field is redacted too', () => {
    const { w, v } = setup()
    const s = w.ctl(v, 'tokenSearch', 'sap.m.SearchField')
    w.fire(s, 'search', { query: 'abc' })
    expect(plain(w.rec().getRecording()).steps[0]).toMatchObject({ redacted: true })
  })

  it('the name check can be switched off, a password type never', () => {
    const { w, v } = setup({ redactSensitive: false })
    w.fire(type(w, v, 'apiKey', { value: 'sk-1' }), 'change', {})
    w.fire(type(w, v, 'pw', { type: 'Password', value: 'hunter2' }), 'change', {})
    const steps = plain(w.rec().getRecording()).steps
    expect(steps[0].value).toBe('sk-1')
    expect(steps[1].redacted).toBe(true)
  })
})

describe('recorder: navigation', () => {
  it('records a changed hash and attaches it to the action that caused it', () => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    w.rec().start()
    w.fire(w.ctl(v, 'createBtn', 'sap.m.Button'), 'press', {})
    w.win.location.hash = '#/order/new'
    w.handlers.hashchange.forEach((fn) => fn())
    w.handlers.hashchange.forEach((fn) => fn()) // the same hash again: nothing new
    const steps = plain(w.rec().getRecording()).steps
    expect(steps).toHaveLength(2)
    expect(steps[1]).toMatchObject({
      type: 'navigate',
      hash: '/order/new',
      causedBy: 0,
      url: 'http://app/index.html#/order/new',
    })
  })

  it("a navigation long after the last action is nobody's consequence", () => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    w.rec().start()
    w.fire(w.ctl(v, 'btn', 'sap.m.Button'), 'press', {})
    w.rec().steps()[0].t = -5000
    w.win.location.hash = '#/x'
    w.handlers.hashchange.forEach((fn) => fn())
    expect(w.rec().steps()[1].causedBy).toBeUndefined()
  })

  it('remembers the hash the recording started on, and stops listening when it stops', () => {
    const w = makeWorld()
    w.win.location.hash = '#/start'
    w.rec().start()
    expect(plain(w.rec().getRecording()).app.startHash).toBe('/start')
    w.rec().stop()
    expect((w.handlers.hashchange ?? []).length).toBe(0)
  })
})

describe('recorder: controlling a recording', () => {
  const setup = () => {
    const w = makeWorld()
    const v = w.view('v1', 'demo.orders.view.Main')
    w.rec().start()
    const press = (id) => {
      const b = w.ctl(v, id, 'sap.m.Button')
      w.fire(b, 'press', {})
      w.rec().steps().at(-1).t = -10_000 // keep presses apart for the duplicate check
    }
    return { w, v, press }
  }

  it('pause stops recording, resume continues', () => {
    const { w, v } = setup()
    w.rec().pause()
    expect(w.rec().isPaused()).toBe(true)
    w.fire(w.ctl(v, 'a', 'sap.m.Button'), 'press', {})
    expect(w.rec().steps()).toHaveLength(0)
    w.rec().resume()
    w.fire(w.ctl(v, 'b', 'sap.m.Button'), 'press', {})
    expect(w.rec().steps()).toHaveLength(1)
  })

  it('removeStep renumbers; undo removes the last; clear empties; notes are steps', () => {
    const { w, press } = setup()
    ;['a', 'b', 'c'].forEach(press)
    w.rec().removeStep(0)
    expect(plain(w.rec().steps()).map((s) => [s.index, s.control.localId])).toEqual([
      [0, 'b'],
      [1, 'c'],
    ])
    w.rec().undo()
    expect(w.rec().steps()).toHaveLength(1)
    w.rec().addNote('  explain   this ')
    expect(plain(w.rec().steps()[1])).toMatchObject({
      type: 'note',
      note: 'explain this',
      index: 1,
    })
    w.rec().clear()
    expect(w.rec().steps()).toEqual([])
  })

  it('tells listeners about every step until they unsubscribe', () => {
    const { w, v } = setup()
    const seen = []
    const off = w.rec().onStep((step, count) => seen.push([step.control.localId, count]))
    w.rec().onStep(() => {
      throw new Error('a broken listener')
    })
    w.fire(w.ctl(v, 'a', 'sap.m.Button'), 'press', {})
    off()
    w.rec().steps()[0].t = -10_000
    w.fire(w.ctl(v, 'b', 'sap.m.Button'), 'press', {})
    expect(seen).toEqual([['a', 1]])
    expect(w.rec().steps()).toHaveLength(2)
  })

  it('tells the page for the extension when it starts, what it records and when it stops, unless told not to', () => {
    const { w, v } = setup()
    w.fire(w.ctl(v, 'a', 'sap.m.Button'), 'press', {})
    w.rec().stop()
    expect(plain(w.posted)).toMatchObject([
      { tourd: 'recorder', type: 'started', app: { appId: 'demo.orders' } },
      { tourd: 'recorder', type: 'step', count: 1, step: { type: 'press' } },
      { tourd: 'recorder', type: 'stopped', count: 1 },
    ])

    const quiet = makeWorld()
    const qv = quiet.view('v1', 'demo.orders.view.Main')
    quiet.rec().start({ bridge: false })
    quiet.fire(quiet.ctl(qv, 'a', 'sap.m.Button'), 'press', {})
    expect(quiet.posted).toEqual([])
  })

  it('start with keep continues a recording; without it starts over', () => {
    const { w, press } = setup()
    press('a')
    w.rec().stop()
    w.rec().start({ keep: true })
    expect(w.rec().steps()).toHaveLength(1)
    w.rec().stop()
    w.rec().start()
    expect(w.rec().steps()).toHaveLength(0)
  })

  it('the recording is a copy: changing it does not change the recorder', () => {
    const { w, press } = setup()
    press('a')
    const rec = w.rec().getRecording()
    rec.steps[0].type = 'input'
    expect(w.rec().steps()[0].type).toBe('press')
  })
})
