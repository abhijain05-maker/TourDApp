// Plain-text steps, one action per line -> normalised recording. Anything not recognised becomes a
// free-text "note" the AI generator can use as context.
export const FORMAT = 'plain-text'

const CLICK = '(?:click(?:\\s+on)?|press|tap|open|choose|pick|select|check|toggle|expand)'
const INPUT = '(?:enter|type|fill(?:\\s+in)?|input|set|write)'
const LEAD = /^\s*(?:\d+[.)]|[-*•])\s*/
const QUOTED = '(?:"([^"]*)"|\'([^\']*)\'|“([^”]*)”)'

const CLICK_RE = new RegExp(`^${CLICK}\\s+(.+)$`, 'i')
const ENTER_IN_RE = new RegExp(`^${INPUT}\\s+${QUOTED}\\s+(?:in|into|on|for)\\s+(.+)$`, 'i')
const ENTER_FIELD_RE = new RegExp(`^${INPUT}\\s+(.+?)\\s*(?:=|:|with|to)\\s*${QUOTED}$`, 'i')
const SEARCH_RE = new RegExp(
  `^search\\s+(?:for\\s+)?(?:${QUOTED}|(\\S+))(?:\\s+(?:in|into|on)\\s+(.+))?$`,
  'i',
)
const NAV_RE = /^(?:navigate\s+to|go\s+to|open\s+the\s+page)\s+(\S+)$/i

const firstDefined = (...v) => v.find((x) => x !== undefined)
const clean = (t) =>
  t
    .replace(/[.!]+$/, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .trim()

export function detect(raw) {
  return typeof raw === 'string' && raw.trim().length > 0
}

export function parse(raw) {
  if (!detect(raw)) throw new Error('The recording is empty')
  const steps = []
  raw
    .split(/\r?\n/)
    .map((l) => l.replace(LEAD, '').trim())
    .filter(Boolean)
    .forEach((line) => {
      let m
      const base = { index: steps.length, source: FORMAT }
      if ((m = ENTER_IN_RE.exec(line))) {
        steps.push({
          ...base,
          action: 'input',
          value: firstDefined(m[1], m[2], m[3]),
          text: clean(m[4]),
        })
      } else if ((m = ENTER_FIELD_RE.exec(line))) {
        steps.push({
          ...base,
          action: 'input',
          value: firstDefined(m[2], m[3], m[4]),
          text: clean(m[1]),
        })
      } else if ((m = SEARCH_RE.exec(line))) {
        steps.push({
          ...base,
          action: 'input',
          value: firstDefined(m[1], m[2], m[3], m[4]),
          text: clean(m[5] ?? 'search field'),
          submit: true,
        })
      } else if ((m = NAV_RE.exec(line))) {
        steps.push({ ...base, action: 'navigate', hash: m[1].replace(/^#\/?/, '') })
      } else if ((m = CLICK_RE.exec(line))) {
        steps.push({ ...base, action: 'click', text: clean(m[1]) })
      } else {
        steps.push({ ...base, action: 'note', text: line })
      }
    })
  return { format: FORMAT, title: null, startUrl: null, steps, skipped: 0 }
}
