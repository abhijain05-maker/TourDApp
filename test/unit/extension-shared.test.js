import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateRecording } from '../../shared/recording-schema.mjs'

// extension/shared.js is a plain script (the service worker and the panel both load it); run it like they do.
const context = vm.createContext({})
vm.runInContext(readFileSync('extension/shared.js', 'utf8'), context)
const T = context.TourdExt
const plain = (x) => JSON.parse(JSON.stringify(x))

const control = (localId, extra = {}) => ({
  id: `v--${localId}`,
  localId,
  viewName: 'demo.orders.view.Main',
  controllerName: 'demo.orders.controller.Main',
  controlType: 'sap.m.Button',
  stableId: true,
  ...extra,
})
const press = (index, localId, extra = {}) => ({
  index,
  t: 5,
  type: 'press',
  control: control(localId),
  ...extra,
})

const recordingState = () => {
  const s = T.idleState()
  Object.assign(s, {
    status: 'recording',
    startedAt: Date.parse('2026-10-27T10:00:00Z'),
    t0: 1000,
    app: {
      url: 'http://app/index.html',
      startHash: '',
      title: 'Demo',
      ui5Version: '1.120.0',
      appId: 'demo.orders',
      locale: 'en',
    },
    recorder: 'tourd-recorder 0.1.0',
  })
  return s
}

describe('extension: collecting steps', () => {
  it('numbers the steps in the order they arrive and times them from the start of the recording', () => {
    const s = recordingState()
    T.addStep(s, 0, press(0, 'a'), 1500)
    T.addStep(s, 0, press(1, 'b'), 2500)
    expect(plain(s.steps).map((x) => [x.index, x.t, x.control.localId])).toEqual([
      [0, 500, 'a'],
      [1, 1500, 'b'],
    ])
  })

  it('merges steps from several frames and points a navigation at the step of its own frame', () => {
    const s = recordingState()
    T.addStep(s, 0, press(0, 'shellTile'), 1100) // the shell frame
    T.addStep(s, 2, press(0, 'createBtn'), 1200) // the app frame (its own numbering starts at 0)
    T.addStep(s, 2, { index: 1, t: 9, type: 'navigate', hash: '/order/new', causedBy: 0 }, 1300)
    const nav = s.steps[2]
    expect(nav.index).toBe(2)
    expect(nav.causedBy).toBe(1) // the createBtn step, not the shell's step 0
  })

  it('drops a reference to a step that is not there', () => {
    const s = recordingState()
    T.addStep(s, 3, { index: 5, t: 1, type: 'navigate', hash: 'x', causedBy: 4 }, 2000)
    expect(s.steps[0].causedBy).toBeUndefined()
  })

  it('does not change the object the page reported', () => {
    const s = recordingState()
    const reported = press(0, 'a')
    T.addStep(s, 0, reported, 2000)
    expect(reported).toEqual(press(0, 'a'))
  })

  it('removing a step renumbers the rest and fixes or drops what pointed at it', () => {
    const s = recordingState()
    T.addStep(s, 0, press(0, 'a'), 1100)
    T.addStep(s, 0, press(1, 'b'), 1200)
    T.addStep(s, 0, { index: 2, t: 1, type: 'navigate', hash: 'x', causedBy: 1 }, 1300)
    T.addStep(s, 0, { index: 3, t: 1, type: 'navigate', hash: 'y', causedBy: 0 }, 1400)
    expect(T.removeStep(s, 0)).toBe(true)
    expect(plain(s.steps).map((x) => [x.index, x.type, x.causedBy])).toEqual([
      [0, 'press', undefined],
      [1, 'navigate', 0], // was pointing at b, which is now step 0
      [2, 'navigate', undefined], // was pointing at the removed step
    ])
    expect(T.removeStep(s, 9)).toBe(false)
    expect(T.removeStep(s, -1)).toBe(false)
  })

  it('adds notes as steps, tidied up, and ignores empty ones', () => {
    const s = recordingState()
    expect(T.addNote(s, '   ', 2000)).toBeNull()
    T.addNote(s, '  explain \n this  ', 2000)
    expect(plain(s.steps[0])).toMatchObject({
      type: 'note',
      note: 'explain this',
      index: 0,
      t: 1000,
    })
    expect(T.addNote(s, 'x'.repeat(500), 2000).note).toHaveLength(300)
  })
})

describe('extension: the finished recording', () => {
  it('is what TourD accepts, without the private bookkeeping', () => {
    const s = recordingState()
    T.addStep(s, 0, press(0, 'a'), 1100)
    T.addStep(s, 0, { index: 1, t: 1, type: 'navigate', hash: '/x', causedBy: 0 }, 1200)
    T.addNote(s, 'a note', 1300)
    const rec = plain(T.buildRecording(s))
    expect(validateRecording(rec).issues).toEqual([])
    expect(JSON.stringify(rec)).not.toContain('_frame')
    expect(rec).toMatchObject({
      format: 'tourd-recording',
      version: 1,
      recordedAt: '2026-10-27T10:00:00.000Z',
      recorder: 'tourd-extension 0.1.0 + tourd-recorder 0.1.0',
      app: { appId: 'demo.orders' },
    })
  })

  it('is valid even when no page ever said what the app is', () => {
    const s = T.idleState()
    s.startedAt = Date.now()
    expect(validateRecording(plain(T.buildRecording(s))).issues).toEqual([])
  })
})

describe('extension: what the panel shows', () => {
  it('describes each kind of step in a line a person understands', () => {
    const d = (step) => plain(T.describeStep(step))
    expect(
      d({ ...press(0, 'createBtn'), control: control('createBtn', { text: 'Create' }) }),
    ).toMatchObject({
      title: 'Press Create',
      where: 'Main · createBtn',
      stable: true,
    })
    expect(
      d({ type: 'input', control: control('name', { label: 'Customer' }), value: 'Acme' }),
    ).toMatchObject({
      title: 'Enter Customer',
      detail: '“Acme”',
    })
    expect(
      d({ type: 'input', control: control('pw', { label: 'Password' }), redacted: true }).detail,
    ).toBe('value left out (secret)')
    expect(
      d({
        type: 'select',
        control: control('s', { label: 'Status' }),
        value: 'sh',
        valueText: 'Shipped',
      }),
    ).toMatchObject({
      title: 'Choose Status',
      detail: 'Shipped',
    })
    expect(
      d({ type: 'toggle', control: control('t', { text: 'Agree' }), value: true }),
    ).toMatchObject({
      title: 'Switch Agree',
      detail: 'on',
    })
    expect(d({ type: 'navigate', hash: '/order/new' }).title).toBe('Opens #/order/new')
    expect(d({ type: 'navigate', hash: '' }).title).toBe('Opens the start page')
    expect(d({ type: 'note', note: 'hello' }).title).toBe('hello')
  })

  it('warns about ids that may change, and names a control without text by its id or type', () => {
    const d = plain(
      T.describeStep({ type: 'press', control: control('x', { stableId: false, localId: null }) }),
    )
    expect(d.stable).toBe(false)
    expect(d.title).toBe('Press Button')
  })

  it('publishes the state without private fields and with the line for every step', () => {
    const s = recordingState()
    T.addStep(s, 4, press(0, 'a'), 1100)
    const pub = plain(T.publicState(s))
    expect(pub.status).toBe('recording')
    expect(pub.steps[0].view.title).toBe('Press a')
    expect(pub.steps[0]._frame).toBeUndefined()
  })
})
