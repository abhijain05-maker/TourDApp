// Static analysis of a UI5 XML view or fragment: control tree, ids, texts, event handlers, references.
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
})

// Event names that are handlers even when written without the leading dot (press="onPress").
const KNOWN_EVENTS = new Set([
  'press',
  'tap',
  'change',
  'liveChange',
  'search',
  'select',
  'selectionChange',
  'selectionFinish',
  'itemPress',
  'navButtonPress',
  'submit',
  'valueHelpRequest',
  'suggest',
  'suggestionItemSelected',
  'beforeOpen',
  'afterOpen',
  'beforeClose',
  'afterClose',
  'close',
  'open',
  'updateFinished',
  'delete',
  'toggle',
  'expand',
  'collapse',
  'navigate',
  'afterNavigate',
  'dateChange',
  'selectionUpdate',
])

const HANDLER = /^(\.?)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(.*\))?$/

function handlerOf(attr, value) {
  const m = typeof value === 'string' ? HANDLER.exec(value.trim()) : null
  if (!m) return null
  return m[1] === '.' || KNOWN_EVENTS.has(attr) ? m[2] : null
}

function toTree(nodes) {
  const out = []
  for (const node of nodes) {
    const name = Object.keys(node).find((k) => k !== ':@')
    if (!name || name === '#text' || name === '#comment' || name.startsWith('?')) continue
    const attrs = {}
    for (const [k, v] of Object.entries(node[':@'] || {})) attrs[k.replace(/^@_/, '')] = v
    out.push({ name, attrs, children: toTree(node[name]) })
  }
  return out
}

function scopeOf(attrs, parent) {
  const scope = { ...parent }
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'xmlns') scope[''] = v
    else if (k.startsWith('xmlns:')) scope[k.slice(6)] = v
  }
  return scope
}

/** "core:Item" + scope -> "sap.ui.core.Item"; null for non-UI5 namespaces (html, svg, unknown prefix). */
function resolveType(name, scope) {
  const i = name.indexOf(':')
  const ns = scope[i < 0 ? '' : name.slice(0, i)]
  const local = i < 0 ? name : name.slice(i + 1)
  if (ns === undefined || /^https?:/.test(ns)) return null
  return ns ? `${ns}.${local}` : local
}

const localName = (name) => name.slice(name.indexOf(':') + 1)

function visit(node, parentScope, state, out) {
  const scope = scopeOf(node.attrs, parentScope)
  const type = resolveType(node.name, scope)
  if (type === null) return
  const local = localName(node.name)

  // lower-case tags are aggregations (<content>, <items>, ...); a bound parent attribute makes them templates
  if (/^[a-z]/.test(local)) {
    const binding = state.parentAttrs?.[local]
    const template =
      state.template || (typeof binding === 'string' && binding.trim().startsWith('{'))
    for (const child of node.children) {
      visit(child, scope, { ...state, aggregation: local, template, parentAttrs: undefined }, out)
    }
    return
  }

  const props = {}
  const handlers = {}
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'id' || k === 'xmlns' || k.startsWith('xmlns:')) continue
    const h = handlerOf(k, v)
    if (h) handlers[k] = h
    else props[k] = v
  }

  if (type === 'sap.ui.core.Fragment') {
    if (props.fragmentName)
      out.fragmentRefs.push({ name: props.fragmentName, aggregation: state.aggregation })
    return
  }
  if (/^sap\.ui\.core\.mvc\.(XML)?View$/.test(type) && state.path.length > 0) {
    if (props.viewName) out.viewRefs.push({ name: props.viewName, localId: node.attrs.id ?? null })
    return
  }

  const id = node.attrs.id ?? null
  out.controls.push({
    type,
    localId: id,
    aggregation: state.aggregation,
    template: state.template,
    path: state.path,
    props,
    handlers,
  })
  if (type.endsWith('.Label') && props.labelFor) out.labelFor[props.labelFor] = props.text ?? null

  const here = id ? `${local}#${id}` : local
  for (const child of node.children) {
    visit(
      child,
      scope,
      { ...state, path: [...state.path, here], aggregation: null, parentAttrs: node.attrs },
      out,
    )
  }
}

/**
 * @param {string} xml content of a *.view.xml or *.fragment.xml
 * @returns {{kind: 'view'|'fragment', rootType: string, controllerName: string|null,
 *   controls: object[], fragmentRefs: object[], viewRefs: object[], labelFor: Record<string, string|null>}}
 */
export function parseXmlView(xml) {
  const [root] = toTree(parser.parse(xml))
  if (!root) throw new Error('XML view has no root element')
  const scope = scopeOf(root.attrs, {})
  const rootType = resolveType(root.name, scope) ?? root.name
  const out = {
    kind: rootType.endsWith('.FragmentDefinition') ? 'fragment' : 'view',
    rootType,
    controllerName: root.attrs.controllerName ?? null,
    controls: [],
    fragmentRefs: [],
    viewRefs: [],
    labelFor: {},
  }
  for (const child of root.children) {
    visit(
      child,
      scope,
      { aggregation: null, template: false, path: [], parentAttrs: root.attrs },
      out,
    )
  }
  return out
}
