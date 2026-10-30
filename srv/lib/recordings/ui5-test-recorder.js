// UI5 Test Recorder snippets (OPA5 waitFor, wdi5 asControl, raw selector) -> normalised recording.
// The Test Recorder emits one snippet per control; users paste one or several. The code is only parsed,
// never executed. The reader is tolerant: it looks for waitFor(...) / asControl(...) calls and their actions.
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

export const FORMAT = 'ui5-test-recorder'

const PARSE = {
  ecmaVersion: 'latest',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
}

export function detect(raw) {
  if (typeof raw !== 'string') return false
  if (/^\s*[\[{]\s*"/.test(raw)) return false // JSON, e.g. a DevTools Recorder export
  return (
    /\bwaitFor\s*\(/.test(raw) ||
    /\basControl\s*\(/.test(raw) ||
    (/^\s*(\/\/.*\n\s*)*\{/.test(raw) && /\b(controlType|viewName|id)\s*:/.test(raw))
  )
}

function parseProgram(source) {
  try {
    return { ast: acorn.parse(source, { ...PARSE, sourceType: 'script' }), source }
  } catch {
    // a bare raw selector "{ controlType: ... }" is only valid as an expression
    const wrapped = `(${source.replace(/^(\s*(\/\/.*\n\s*)*)/, '')})`
    return { ast: acorn.parse(wrapped, { ...PARSE, sourceType: 'script' }), source: wrapped }
  }
}

const calleeName = (c) =>
  c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? c.property.name : '?'

function valueOf(node, source) {
  switch (node?.type) {
    case 'Literal':
      return node.regex ? { __regex: node.regex.pattern } : node.value
    case 'TemplateLiteral':
      return node.expressions.length === 0
        ? node.quasis.map((q) => q.value.cooked).join('')
        : { __expr: source.slice(node.start, node.end) }
    case 'ObjectExpression': {
      const o = {}
      for (const p of node.properties) {
        if (p.type !== 'Property') continue
        o[p.key.type === 'Identifier' ? p.key.name : String(p.key.value)] = valueOf(p.value, source)
      }
      return o
    }
    case 'ArrayExpression':
      return node.elements.map((e) => valueOf(e, source))
    case 'NewExpression':
      return { __new: calleeName(node.callee), args: node.arguments.map((a) => valueOf(a, source)) }
    case 'UnaryExpression':
      return node.operator === '-' && node.argument.type === 'Literal'
        ? -node.argument.value
        : { __expr: source.slice(node.start, node.end) }
    default:
      return node ? { __expr: source.slice(node.start, node.end) } : undefined
  }
}

function ui5Of(loc) {
  const props = loc.properties && typeof loc.properties === 'object' ? loc.properties : null
  const text = props
    ? (['text', 'title', 'label', 'placeholder']
        .map((k) => props[k])
        .find((v) => typeof v === 'string') ?? null)
    : null
  return {
    viewName: typeof loc.viewName === 'string' ? loc.viewName : null,
    controlId: typeof loc.id === 'string' ? loc.id : null,
    idPattern: loc.id && loc.id.__regex ? loc.id.__regex : null,
    controlType: typeof loc.controlType === 'string' ? loc.controlType : null,
    text,
    bindingPath: loc.bindingPath ?? null,
    via: 'test-recorder',
  }
}

// OPA5: actions: new Press() | new EnterText({ text }) | [ ... ]
function opa5Actions(actionsValue) {
  const list = Array.isArray(actionsValue) ? actionsValue : [actionsValue]
  const out = []
  for (const a of list) {
    if (a?.__new === 'Press') out.push({ action: 'click' })
    else if (a?.__new === 'EnterText')
      out.push({ action: 'input', value: String(a.args?.[0]?.text ?? '') })
  }
  return out
}

const WDI5_METHODS = {
  press: (args) => ({ action: 'click' }),
  enterText: (args) => ({ action: 'input', value: String(args[0] ?? '') }),
  setValue: (args) => ({ action: 'input', value: String(args[0] ?? '') }),
  typeText: (args) => ({ action: 'input', value: String(args[0] ?? '') }),
}

const locatorOf = (arg, source) => {
  const v = valueOf(arg, source)
  return v && typeof v === 'object'
    ? v.selector && typeof v.selector === 'object'
      ? v.selector
      : v
    : null
}

/** For an asControl(...) call: the method called on the result, e.g. .press() -> { method, args }. */
function wdi5Usage(ancestors, source) {
  let child = ancestors[ancestors.length - 1]
  let i = ancestors.length - 2
  while (ancestors[i]?.type === 'AwaitExpression') {
    child = ancestors[i--]
  }
  const p = ancestors[i]
  const gp = ancestors[i - 1]
  if (
    p?.type === 'MemberExpression' &&
    p.object === child &&
    gp?.type === 'CallExpression' &&
    gp.callee === p
  ) {
    return { method: p.property.name, args: gp.arguments.map((a) => valueOf(a, source)) }
  }
  if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') return { variable: p.id.name }
  return null
}

function extract(source) {
  const { ast, source: src } = parseProgram(source)
  const found = []
  const vars = new Map()
  let hadCalls = false

  walk.ancestor(ast, {
    CallExpression(node, _state, ancestors) {
      const name = calleeName(node.callee)
      const first = node.arguments[0]
      if (name === 'waitFor' && first?.type === 'ObjectExpression') {
        hadCalls = true
        const loc = valueOf(first, src)
        if (loc.actions === undefined) return // assertion / wait without a user action
        for (const a of opa5Actions(loc.actions))
          found.push({ pos: node.start, ...a, ui5: ui5Of(loc), dialect: 'opa5' })
      } else if (name === 'asControl' && first) {
        hadCalls = true
        const loc = locatorOf(first, src)
        if (!loc) return
        const use = wdi5Usage(ancestors, src)
        if (use?.variable) vars.set(use.variable, loc)
        else if (use?.method && WDI5_METHODS[use.method]) {
          found.push({
            pos: node.start,
            ...WDI5_METHODS[use.method](use.args),
            ui5: ui5Of(loc),
            dialect: 'wdi5',
          })
        }
      } else if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        vars.has(node.callee.object.name)
      ) {
        const m = WDI5_METHODS[node.callee.property.name]
        if (m)
          found.push({
            pos: node.start,
            ...m(node.arguments.map((a) => valueOf(a, src))),
            ui5: ui5Of(vars.get(node.callee.object.name)),
            dialect: 'wdi5',
          })
      }
    },
  })

  if (!hadCalls) {
    // a lone object literal is a raw selector: it identifies a control but not what to do with it
    const stmt =
      ast.body.length === 1 && ast.body[0].type === 'ExpressionStatement'
        ? ast.body[0].expression
        : null
    if (stmt?.type === 'ObjectExpression') {
      const loc = valueOf(stmt, src)
      found.push({
        pos: 0,
        action: 'click',
        ui5: ui5Of(loc.selector ?? loc),
        dialect: 'raw',
        note: 'raw selector: the action is assumed to be a press',
      })
    }
  }
  return found.sort((a, b) => a.pos - b.pos)
}

export function parse(raw) {
  if (typeof raw !== 'string' || !detect(raw))
    throw new Error(
      'Not a UI5 Test Recorder snippet (expected OPA5 waitFor, wdi5 asControl or a raw selector)',
    )
  const found = extract(raw)
  const steps = found.map(({ pos, ...s }, index) => ({ index, source: FORMAT, ...s }))
  return { format: FORMAT, title: null, startUrl: null, steps, skipped: 0 }
}
