import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parse as replayParse } from '@puppeteer/replay'
import { detectFormat, parseRecording, FORMATS } from '../../srv/lib/recordings/index.js'
import { routerHashOf } from '../../srv/lib/recordings/devtools-recorder.js'

const fx = (n) => readFileSync(`test/fixtures/recordings/demo-create-order.${n}`, 'utf8')

describe('format detection', () => {
  it('detects every fixture', () => {
    expect(detectFormat(fx('devtools.json'))).toBe('devtools-recorder')
    expect(detectFormat(JSON.parse(fx('devtools.json')))).toBe('devtools-recorder')
    expect(detectFormat(fx('opa5.js'))).toBe('ui5-test-recorder')
    expect(detectFormat(fx('wdi5.js'))).toBe('ui5-test-recorder')
    expect(detectFormat(fx('raw.js'))).toBe('ui5-test-recorder')
    expect(detectFormat(fx('txt'))).toBe('plain-text')
  })

  it('returns null for empty input and lists the known formats', () => {
    expect(detectFormat('   ')).toBeNull()
    expect(detectFormat(42)).toBeNull()
    expect(FORMATS).toEqual([
      'tourd-recorder',
      'devtools-recorder',
      'ui5-test-recorder',
      'plain-text',
    ])
  })

  it('honours an explicit format and rejects unknown ones', () => {
    expect(parseRecording(fx('txt'), { format: 'plain-text' }).format).toBe('plain-text')
    expect(() => parseRecording('x', { format: 'nope' })).toThrow(/Unknown recording format/)
    expect(() => parseRecording('{"steps": []}', { format: 'devtools-recorder' })).toThrow(
      /DevTools Recorder/,
    )
    expect(() => parseRecording('')).toThrow(/recognise/)
  })
})

describe('devtools-recorder adapter', () => {
  it('the fixture is a valid flow according to the official @puppeteer/replay parser', () => {
    expect(replayParse(JSON.parse(fx('devtools.json'))).steps).toHaveLength(12)
  })

  const rec = parseRecording(fx('devtools.json'))

  it('keeps tour-relevant steps and counts the noise it skipped', () => {
    expect(rec.title).toBe('Create an order')
    expect(rec.startUrl).toBe('http://localhost:8081/index.html')
    expect(rec.steps.map((s) => s.action)).toEqual([
      'navigate',
      'click',
      'input',
      'key',
      'click',
      'click',
      'input',
      'click',
      'click',
      'click',
    ])
    expect(rec.skipped).toBe(2) // setViewport, keyUp
  })

  it('extracts selectors, aria labels and values', () => {
    const create = rec.steps[4]
    expect(create.dom.ariaLabel).toBe('Create')
    expect(create.dom.selectors).toContain('#container-demo---main--createBtn-BDI-content')
    expect(rec.steps[2]).toMatchObject({ action: 'input', value: 'Acme' })
  })

  it('records the router hash a click navigated to', () => {
    expect(rec.steps[4].navigatesTo).toBe('order/new')
    expect(rec.steps[8].navigatesTo).toBe('')
    expect(rec.steps[1]).not.toHaveProperty('navigatesTo')
  })

  it('keeps the original step index for traceability', () => {
    expect(rec.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11])
  })
})

describe('routerHashOf', () => {
  it('handles plain, launchpad and invalid urls', () => {
    expect(routerHashOf('http://h/index.html#/order/new')).toBe('order/new')
    expect(routerHashOf('http://h/index.html#/')).toBe('')
    expect(routerHashOf('http://h/index.html')).toBe('')
    expect(routerHashOf('https://h/shell#Shell-home&/order/42?x=1')).toBe('order/42')
    expect(routerHashOf('not a url #/a/b')).toBe('a/b')
  })
})
