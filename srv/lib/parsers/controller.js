// Static analysis of a UI5 controller (sap.ui.define / Controller.extend or an ES class).
// Never executes the code - it is only parsed.
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

const MAX_SOURCE = 4000

function parse(source) {
  const base = {
    ecmaVersion: 'latest',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  }
  try {
    return acorn.parse(source, { ...base, sourceType: 'script' })
  } catch {
    return acorn.parse(source, { ...base, sourceType: 'module' })
  }
}

const keyName = (k) =>
  k.type === 'Identifier' ? k.name : k.type === 'Literal' ? String(k.value) : null
const str = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null)
const isFn = (n) => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')
const calleeProp = (n) =>
  n.callee.type === 'MemberExpression' && !n.callee.computed ? n.callee.property.name : null

function describeMethod(name, fn, source) {
  const text = source.slice(fn.start, fn.end)
  return {
    name,
    async: !!fn.async,
    params: fn.params.map((p) => (p.type === 'Identifier' ? p.name : '…')),
    start: fn.start,
    end: fn.end,
    source: text.length > MAX_SOURCE ? text.slice(0, MAX_SOURCE) + '\n/* … truncated … */' : text,
  }
}

function collectMethods(ast, source) {
  const out = { controllerName: null, methods: [] }
  const fromObject = (obj) => {
    for (const p of obj.properties) {
      const name = p.type === 'Property' ? keyName(p.key) : null
      if (name && isFn(p.value)) out.methods.push(describeMethod(name, p.value, source))
    }
  }
  walk.full(ast, (node) => {
    // Controller.extend("my.app.controller.Main", { ... })
    if (node.type === 'CallExpression' && calleeProp(node) === 'extend') {
      const [nameArg, body] = node.arguments
      if (str(nameArg) && body?.type === 'ObjectExpression' && !out.methods.length) {
        out.controllerName = str(nameArg)
        fromObject(body)
      }
    }
    // class Main extends Controller { onPress() {} }
    if (
      (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') &&
      node.superClass &&
      !out.methods.length
    ) {
      for (const m of node.body.body) {
        const name = m.type === 'MethodDefinition' && m.kind === 'method' ? keyName(m.key) : null
        if (name && name !== 'constructor') out.methods.push(describeMethod(name, m.value, source))
      }
    }
  })
  return out
}

// How a fragment's control ids are prefixed: 'view' (view id), 'custom' (a literal), 'none', or 'unknown'.
function idInfo(arg) {
  if (!arg) return { idMode: 'none', idPrefix: null }
  if (str(arg)) return { idMode: 'custom', idPrefix: str(arg) }
  // this.getView().getId() / oView.getId()
  if (arg.type === 'CallExpression' && calleeProp(arg) === 'getId')
    return { idMode: 'view', idPrefix: null }
  return { idMode: 'unknown', idPrefix: null }
}

function fragmentCall(node) {
  const prop = calleeProp(node)
  const first = node.arguments[0]
  const optionsOf = () => {
    const get = (k) =>
      first.properties.find((p) => p.type === 'Property' && keyName(p.key) === k)?.value
    return { name: str(get('name')), id: get('id') }
  }
  if (prop === 'load' && first?.type === 'ObjectExpression') {
    const { name, id } = optionsOf()
    return name ? { name, ...idInfo(id) } : null
  }
  if (prop === 'loadFragment' && first?.type === 'ObjectExpression') {
    const { name, id } = optionsOf()
    // Controller#loadFragment prefixes with the view id unless an id is given
    return name ? { name, ...(id ? idInfo(id) : { idMode: 'view', idPrefix: null }) } : null
  }
  if (prop === 'xmlfragment') {
    const [a, b] = node.arguments
    if (str(a) && str(b)) return { name: str(b), ...idInfo(a) }
    if (str(a) && !str(b) && a.value.includes('.'))
      return { name: str(a), idMode: 'none', idPrefix: null }
    if (!str(a) && str(b)) return { name: str(b), ...idInfo(a) }
  }
  return null
}

/**
 * @returns {{controllerName: string|null, methods: object[], navigations: object[], fragments: object[],
 *   byIds: string[], routes: string[], parseError?: string}}
 */
export function parseController(source) {
  let ast
  try {
    ast = parse(source)
  } catch (e) {
    return {
      controllerName: null,
      methods: [],
      navigations: [],
      fragments: [],
      byIds: [],
      routes: [],
      parseError: e.message,
    }
  }
  const { controllerName, methods } = collectMethods(ast, source)
  const owner = (pos) => methods.find((m) => pos >= m.start && pos < m.end)?.name ?? null
  const navigations = []
  const fragments = []
  const byIds = new Set()
  const routes = new Set()

  walk.full(ast, (node) => {
    if (node.type !== 'CallExpression') return
    const prop = calleeProp(node)
    const first = node.arguments[0]
    if (prop === 'navTo') {
      const props =
        node.arguments[1]?.type === 'ObjectExpression'
          ? node.arguments[1].properties.filter((p) => p.type === 'Property')
          : []
      const args = props.map((p) => keyName(p.key)).filter(Boolean)
      // literal values (e.g. { orderId: "new" }) let the generator work out the target hash
      const argValues = {}
      for (const p of props) {
        const k = keyName(p.key)
        if (k && p.value.type === 'Literal' && ['string', 'number'].includes(typeof p.value.value))
          argValues[k] = String(p.value.value)
      }
      navigations.push({
        route: str(first),
        dynamic: !str(first),
        args,
        argValues,
        method: owner(node.start),
      })
    } else if (prop === 'byId' && str(first)) {
      byIds.add(str(first))
    } else if (prop === 'getRoute' && str(first)) {
      routes.add(str(first))
    }
    const frag = fragmentCall(node)
    if (frag) fragments.push({ ...frag, method: owner(node.start) })
  })

  return { controllerName, methods, navigations, fragments, byIds: [...byIds], routes: [...routes] }
}
