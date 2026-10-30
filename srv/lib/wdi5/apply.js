// "Add the tests to the project": the files of a test plan as edits of the workspace, in the same shape as
// srv/lib/export/apply.js (path, add|modify|unchanged, before, after, what) so one dialog reviews both.
//
// Two cases. A project without wdi5 gets a whole setup (config, helpers, journey, spec, scripts). A project that
// already has wdi5 keeps its config (changed only as far as the new spec needs, and shown as a diff), gets the new
// files next to its own specs, written in its own style, and the journey calls the helpers and page objects it already
// has instead of doing the same again.
import { classifySource, pickManifest } from '../context/inventory.js'
import { buildCatalogue, detectStyle, specGlobMatches } from './catalogue.js'
import { patchConfig } from './config-patch.js'
import { DEFAULT_STYLE, formatCode } from './format.js'
import { slug } from './plan.js'
import { describeReuse, resolveReuse } from './reuse.js'
import {
  patchPackageJson,
  renderHelpers,
  renderJourney,
  renderProject,
  renderSpec,
  relativeSpecifier,
} from './render.js'

const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/')))
const join = (...parts) => parts.filter(Boolean).join('/')

/** The folder that holds the tests: next to the app folder (the parent of "webapp/"), or where manifest.json is. */
export function projectRoot(manifestPath, override = '') {
  if (override) return override.replace(/^\/+|\/+$/g, '').concat('/')
  const dir = manifestPath.slice(0, Math.max(0, manifestPath.lastIndexOf('/') + 1))
  const m = /^(.*?)webapp\/$/.exec(dir)
  return m ? m[1] : dir
}

/** The folder a glob such as "./e2e/**\/*.spec.js" starts in, and the file ending it asks for. */
function globParts(glob) {
  const clean = glob.replace(/^\.\//, '')
  const stop = clean.search(/[*?{[]/)
  const dir =
    stop < 0
      ? dirOf(clean)
      : clean
          .slice(0, stop)
          .replace(/\/[^/]*$/, '')
          .replace(/\/$/, '')
  const ending = /\*(\.[\w.]*\.(c|m)?js)$/.exec(clean)?.[1] ?? null
  return { dir, ending }
}

const suffixOf = (path) => /\.(test|spec|e2e)\.(c|m)?js$/.exec(path)?.[0] ?? null

/** Where the new files go in a project that has wdi5 already. */
function layoutFor(catalogue, plan, root) {
  const name = slug(plan.name)
  const configDir = catalogue.configDir ?? ''
  const fromGlob = catalogue.config?.specs.map(globParts).find((g) => g.dir || g.ending)
  const specDir =
    catalogue.specDir ??
    (fromGlob?.dir ? join(configDir, fromGlob.dir) : join(root, plan.settings.testDir, 'specs'))
  const counts = new Map()
  for (const s of catalogue.specs)
    counts.set(suffixOf(s.path), (counts.get(suffixOf(s.path)) ?? 0) + 1)
  const suffix = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fromGlob?.ending ?? '.test.js'
  const base = /\/specs?$/.test(specDir) ? dirOf(specDir) : specDir
  return {
    specFile: join(specDir, `${name}${suffix}`),
    journeyFile: join(base, 'journeys', `${name}.journey.js`),
    helpersFile: join(base, 'helpers', 'ui5.js'),
    specDir,
    suffix,
  }
}

/**
 * @param {{plan: object, files: {path: string, content: string, edited?: boolean}[]}} args
 * @returns {Promise<{ok: boolean, blocking: object[], notes: object[], edits: object[], existing: object|null}>}
 *   existing: what was found in a project that has wdi5 already (null for a new setup)
 */
export async function planTestApply({ plan, files }) {
  const blocking = []
  const notes = []
  const edits = []
  const byPath = new Map(files.map((f) => [f.path, f]))
  const manifest = pickManifest(files.filter((f) => classifySource(f.path) === 'manifest'))
  if (!manifest && !plan.settings.root)
    blocking.push({
      code: 'tests.manifest',
      message:
        'The project has no manifest.json: upload the whole app first, so the tests can be placed next to it.',
    })
  const enabled = plan.steps.filter((s) => s.enabled && s.kind !== 'open' && s.kind !== 'assert')
  if (!enabled.length)
    blocking.push({
      code: 'tests.empty',
      message: 'No step is switched on: there is nothing to test.',
    })
  const unknown = plan.steps.filter(
    (s) => s.enabled && s.kind !== 'open' && s.kind !== 'assert' && !plan.locators[s.locator ?? ''],
  )
  for (const s of unknown)
    blocking.push({
      code: 'tests.locator',
      message: `"${s.title}" has no control: choose one or switch the step off.`,
    })
  if (blocking.length) return { ok: false, blocking, notes, edits, existing: null }

  const put = (path, after, what) => {
    const current = byPath.get(path)
    if (!current) return edits.push({ path, action: 'add', before: null, after, what })
    edits.push({
      path,
      action: current.content === after ? 'unchanged' : 'modify',
      before: current.content,
      after,
      what,
    })
    if (current.content !== after && current.edited)
      notes.push({
        code: 'tests.edited',
        message: `${path} was changed by hand; the new version replaces those changes (see the diff).`,
      })
  }

  const root = projectRoot(manifest?.path ?? '', plan.settings.root)
  const catalogue = buildCatalogue(files)
  if (catalogue.wdi5 && catalogue.config)
    return planExisting({ plan, catalogue, root, byPath, put, notes, edits })
  if (catalogue.typescript)
    notes.push({
      code: 'tests.typescript',
      message:
        'The project has TypeScript tests; TourD writes JavaScript. The files are added next to them: change the extension and add types if you want.',
    })

  const { files: rendered, pkg } = renderProject({
    plan,
    root,
    packageJson: byPath.get(`${root}package.json`)?.content ?? null,
    appId: plan.app.id,
  })
  for (const f of rendered) {
    const current = byPath.get(f.path)
    if (f.kind === 'config' && current) {
      if (current.content === f.content) continue
      notes.push({
        code: 'tests.config',
        message: `${f.path} exists already and was left as it is. Make sure its "specs" reach ${plan.settings.testDir}/specs and that the "ui5" service and framework "${plan.settings.framework}" are set.`,
      })
      continue
    }
    if (f.path.endsWith('helpers/ui5.js') && current) {
      const missing = ['typeInto', 'choose'].filter((n) => !current.content.includes(n))
      if (missing.length)
        notes.push({
          code: 'tests.helpers',
          message: `${f.path} exists but has no ${missing.join(' / ')}: the journey needs them (see the README of the tests).`,
        })
      continue
    }
    put(f.path, f.content, f.what)
  }
  if (pkg.error)
    notes.push({
      code: 'tests.package',
      message: `package.json was not changed: ${pkg.error}. Add the scripts and dev dependencies yourself (see README).`,
    })
  else if (pkg.text !== null) put(pkg.path, pkg.text, 'The wdi5 scripts and dev dependencies')
  return { ok: true, blocking: [], notes, edits, existing: null }
}

async function planExisting({ plan, catalogue, root, byPath, put, notes, edits }) {
  const config = catalogue.config
  const framework =
    config.framework === 'jasmine' || config.framework === 'mocha'
      ? config.framework
      : plan.settings.framework
  if (framework !== plan.settings.framework)
    notes.push({
      code: 'tests.framework',
      message: `The project uses ${framework} (see ${config.path}): the tests are written for it, not for ${plan.settings.framework}.`,
    })
  const effective = { ...plan, settings: { ...plan.settings, framework } }
  const configDir = catalogue.configDir ?? ''
  const layout = layoutFor(catalogue, effective, configDir ? `${configDir}/` : root)
  const reuse = resolveReuse(effective, catalogue)
  const esm = catalogue.esm
  const style = catalogue.style ?? DEFAULT_STYLE

  const journey = await formatCode(
    renderJourney(effective, {
      esm,
      journeyFile: layout.journeyFile,
      helpersFile: layout.helpersFile,
      reuse,
    }),
    style,
  )
  const spec = await formatCode(
    renderSpec(effective, relativeSpecifier(layout.specFile, layout.journeyFile, { esm }), { esm }),
    style,
  )
  const helpersSpecifier = relativeSpecifier(layout.journeyFile, layout.helpersFile, { esm })
  const usesOwnHelpers = journey.includes(helpersSpecifier)

  put(layout.specFile, spec, 'The test with its checks')
  put(
    layout.journeyFile,
    journey,
    `The controls and the steps of the journey${reuse.steps.size ? `, calling ${reuse.steps.size} helper(s) of the project` : ''}`,
  )
  if (usesOwnHelpers) {
    const current = byPath.get(layout.helpersFile)
    if (!current)
      put(
        layout.helpersFile,
        await formatCode(renderHelpers(esm), style),
        'Helpers the journey needs (type into a field, choose in a select)',
      )
    else {
      const missing = ['typeInto', 'choose'].filter(
        (n) => journey.includes(n) && !current.content.includes(n),
      )
      if (missing.length)
        notes.push({
          code: 'tests.helpers',
          message: `${layout.helpersFile} exists but has no ${missing.join(' / ')}: the journey needs them.`,
        })
    }
  }

  // the config: only as far as the new spec needs it
  if (config.readable) {
    const quote = detectStyle([config.text]).singleQuote ? "'" : '"' // the config's own quotes
    const specDirRel = layout.specFile.slice(
      configDir ? configDir.length + 1 : 0,
      layout.specFile.lastIndexOf('/'),
    )
    const glob = `./${specDirRel ? `${specDirRel}/` : ''}**/*${layout.suffix}`
    const patched = patchConfig(config.text, config, { specPath: layout.specFile, glob, quote })
    if (patched.text !== config.text)
      put(config.path, patched.text, `The config: ${patched.changes.join('; ')}`)
    for (const message of patched.notes) notes.push({ code: 'tests.config', message })
  } else
    notes.push({
      code: 'tests.config',
      message: `${config.path} could not be read, so it was not changed. Make sure its "specs" reach ${layout.specFile}.`,
    })
  if (plan.settings.auth !== 'none' && !config.hasAuth)
    notes.push({
      code: 'tests.auth',
      message: `The plan says the app needs a login (${plan.settings.auth}) but ${config.path} has no "wdi5:authentication" in its capabilities: add it (see docs/WDI5.md).`,
    })

  // the dependencies the project is missing (nothing it has is changed)
  const pkgPath = join(configDir, 'package.json')
  if (byPath.has(pkgPath)) {
    const pkg = patchPackageJson(byPath.get(pkgPath).content, {
      appId: plan.app.id,
      framework,
      scripts: false,
    })
    if (pkg.error)
      notes.push({ code: 'tests.package', message: `package.json was not changed: ${pkg.error}.` })
    else if (pkg.text !== null)
      put(pkgPath, pkg.text, 'Dev dependencies wdi5 needs and the project lacks')
  }
  if (catalogue.typescript)
    notes.push({
      code: 'tests.typescript',
      message: 'The project also has TypeScript tests; TourD wrote JavaScript.',
    })

  return {
    ok: true,
    blocking: [],
    notes,
    edits,
    existing: {
      config: config.path,
      framework,
      esm,
      style,
      specFile: layout.specFile,
      journeyFile: layout.journeyFile,
      configReaches: specGlobMatches(config.specs, configDir, layout.specFile),
      reuse: describeReuse(reuse),
      helpers: catalogue.helpers.length,
    },
  }
}
