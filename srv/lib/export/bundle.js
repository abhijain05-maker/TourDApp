// The export bundle: everything an app needs to show a tour - the player, the tour, and the few lines
// that connect them to the app (manifest, view, controller), with a README that says where each goes.
import { strToU8, zipSync } from 'fflate'
import { validateTour } from '../../../shared/tour-schema.mjs'
import { lintTour } from '../validate/lint.js'

const I18N_REF = /\{([\w.-]+)>([^}]+)\}/g

/** "Create an order!" -> "create-an-order" (safe in a file name) */
export function slugOf(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents of decomposed letters
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return slug || 'tour'
}

/** {i18n>key} references in titles and texts: Map(key -> step ids that use it) */
export function i18nKeysOf(tour) {
  const keys = new Map()
  for (const step of tour.steps ?? [])
    for (const text of [step.title, step.text])
      for (const m of String(text ?? '').matchAll(I18N_REF)) {
        if (!keys.has(m[2])) keys.set(m[2], new Set())
        keys.get(m[2]).add(step.id)
      }
  return keys
}

/**
 * Is the tour fit to ship? Blocking: not valid, a control that does not exist, a step still marked
 * "needs a control". Warnings: things that may misbehave in some situations.
 * @returns {{ok: boolean, blocking: object[], warnings: object[], checkedTargets: boolean}}
 */
export function checkExport(tour, inventory) {
  const blocking = []
  const warnings = []
  const issues = inventory ? lintTour(tour, inventory).issues : validateTour(tour).issues
  for (const i of issues) {
    const entry = { code: i.code, message: i.message, ...(i.stepId ? { stepId: i.stepId } : {}) }
    if (i.severity === 'error') blocking.push(entry)
    else if (i.severity === 'warning') warnings.push(entry)
  }
  for (const s of Array.isArray(tour?.steps) ? tour.steps : [])
    if (s?.meta?.unresolved)
      blocking.push({
        code: 'export.unresolved',
        stepId: s.id,
        message: `Step "${s.title}" still needs a control${s.meta.note ? ` (${s.meta.note})` : ''}`,
      })
  if (!inventory)
    warnings.push({
      code: 'export.unchecked',
      message: 'The project has no files, so the controls of the steps could not be checked',
    })
  return { ok: blocking.length === 0, blocking, warnings, checkedTargets: !!inventory }
}

/** The view the "Start tour" button goes into: the one of the default route, else the root view. */
export function hostView(inventory) {
  if (!inventory) return null
  const name =
    inventory.routes?.find((r) => r.pattern === '')?.viewNames?.[0] ??
    inventory.rootViewName ??
    inventory.views?.[0]?.viewName
  return inventory.views?.find((v) => v.viewName === name) ?? null
}

const TAB = '\t'
const manifestSnippet = () =>
  JSON.stringify({ 'sap.ui5': { resourceRoots: { tourd: './tourd/' } } }, null, TAB) + '\n'

const buttonSnippet = () =>
  [
    '<!-- A button that starts the tour. Put it where users will look for help, for example in the',
    '     <headerContent> of your <Page> or in its toolbar (the default namespace is sap.m). -->',
    '<Button id="startTourBtn" icon="sap-icon://hint" tooltip="Start the tour" press=".onStartTour" />',
    '',
  ].join('\n')

const startSnippet = () =>
  [
    '// Add this method to the controller of the view that has the button.',
    'onStartTour: function () {',
    '\tvar oComponent = this.getOwnerComponent();',
    '\tsap.ui.require(["tourd/TourPlayer"], function (TourPlayer) {',
    '\t\tTourPlayer.start(sap.ui.require.toUrl("tourd/tour.json"), { component: oComponent });',
    '\t});',
    '}',
    '',
  ].join('\n')

const autoStartSnippet = (tour) =>
  [
    '// Optional: show the tour by itself the first time this browser opens the app.',
    '// Add the body to the onInit of the controller of your start page.',
    'onInit: function () {',
    '\tvar oComponent = this.getOwnerComponent();',
    `\tvar sKey = ${JSON.stringify(`tourd.${tour.id}.seen`)};`,
    '\tvar bSeen = false;',
    '\ttry {',
    '\t\tbSeen = !!window.localStorage.getItem(sKey);',
    '\t} catch (e) {',
    '\t\t/* storage is blocked: the tour is shown every time */',
    '\t}',
    '\tif (bSeen) {',
    '\t\treturn;',
    '\t}',
    '\tsetTimeout(function () {',
    '\t\tsap.ui.require(["tourd/TourPlayer"], function (TourPlayer) {',
    '\t\t\tTourPlayer.start(sap.ui.require.toUrl("tourd/tour.json"), {',
    '\t\t\t\tcomponent: oComponent,',
    '\t\t\t\tonEvent: function (sType) {',
    '\t\t\t\t\tif (sType === "completed" || sType === "skipped") {',
    '\t\t\t\t\t\ttry {',
    '\t\t\t\t\t\t\twindow.localStorage.setItem(sKey, "1");',
    '\t\t\t\t\t\t} catch (e) {',
    '\t\t\t\t\t\t\t/* ignore */',
    '\t\t\t\t\t\t}',
    '\t\t\t\t\t}',
    '\t\t\t\t}',
    '\t\t\t});',
    '\t\t});',
    '\t}, 800);',
    '}',
    '',
  ].join('\n')

function readme({ tour, inventory, host, missingKeys, problems }) {
  const steps = tour.steps.length
  const appId = inventory?.appId ?? 'your app'
  const where = host
    ? `the view \`${host.viewName}\` (\`${host.path}\`)${host.controllerName ? ` and its controller \`${host.controllerName}\`` : ''}`
    : 'the view of your start page and its controller'
  const lines = [
    `# Tour "${tour.title}" for ${appId}`,
    '',
    `${steps} step${steps === 1 ? '' : 's'}. Generated by TourD. Needs SAPUI5 / OpenUI5 1.108 or newer.`,
    '',
  ]
  if (problems.length) {
    lines.push(
      '> **Exported with open problems** - see PROBLEMS.txt. Fix them in TourD and export again.',
      '',
    )
  }
  lines.push(
    '## What is in this zip',
    '',
    '| File | What it is |',
    '| --- | --- |',
    '| `tourd/TourPlayer.js` | The player (a normal UI5 module, no dependencies) |',
    '| `tourd/tour.json` | The tour: texts, targets, order |',
    '| `tourd/tour.schema.json` | JSON schema of `tour.json`, for editors and CI |',
    '| `snippets/manifest.resourceRoots.json` | Lets UI5 find the `tourd` folder |',
    '| `snippets/Start.view.xml` | A "Start tour" button |',
    '| `snippets/Start.controller.js` | The handler of that button |',
    '| `snippets/AutoStart.controller.js` | Optional: show the tour once, automatically |',
    ...(missingKeys.length
      ? [
          '| `snippets/i18n.properties` | Texts the tour refers to that your app does not have yet |',
        ]
      : []),
    '',
    '## Add it to your app (4 steps)',
    '',
    `1. **Copy the folder \`tourd/\`** into the root of your app (the folder that contains \`manifest.json\`, usually \`webapp/\`).`,
    '2. **Tell UI5 where it is.** In `manifest.json`, under `"sap.ui5"`, add the `resourceRoots` entry from `snippets/manifest.resourceRoots.json` (merge it if you already have `resourceRoots`).',
    `3. **Add the button** from \`snippets/Start.view.xml\` to ${where}.`,
    '4. **Add the handler** from `snippets/Start.controller.js` to the same controller.',
    '',
    'Reload the app and press the button.',
    '',
    '### Optional: start by itself the first time',
    '',
    'Use `snippets/AutoStart.controller.js` in the `onInit` of your start page controller. The tour is shown once per browser and not again after it was completed or closed. To see it again, clear the entry `tourd.' +
      tour.id +
      ".seen` from the browser's local storage.",
    '',
  )
  if (missingKeys.length) {
    lines.push(
      '### Texts for your i18n file',
      '',
      'The tour uses `{i18n>...}` texts that your app does not have. Add the lines of `snippets/i18n.properties` to your `i18n.properties` (and your translations) and fill in the texts:',
      '',
      ...missingKeys.map((k) => `- \`${k}\``),
      '',
    )
  }
  lines.push(
    '## Changing the tour later',
    '',
    'Change it in TourD and export again, then replace **only** `tourd/tour.json` (the player and the snippets do not change).',
    '',
    '## When a step does not show',
    '',
    '- The player looks for the control by its id inside the view, then by its text. If you renamed or removed the control, the step appears in the middle of the screen. Update the target in TourD.',
    '- Controls without an id of their own get a different generated id in every run; give them an `id` in the view.',
    '- The player adds one `<style>` element to the page (and no inline scripts). If your Content-Security-Policy restricts `style-src`, allow it there.',
    '',
  )
  return lines.join('\n')
}

function problemsText(problems) {
  return [
    'This tour was exported although TourD found problems. Fix them in TourD and export again.',
    '',
    ...problems.map((p) => `- ${p.message}`),
    '',
  ].join('\n')
}

/**
 * @param {{tour: object, inventory?: object|null, playerSource: string, schemaJson: string, force?: boolean}} args
 * @returns {{filename: string, files: Record<string, string>, zip: Uint8Array, check: object}}
 */
export function buildBundle({ tour, inventory = null, playerSource, schemaJson, force = false }) {
  const check = checkExport(tour, inventory)
  if (!check.ok && !force) {
    const e = new Error('The tour has problems that must be fixed before it can be exported')
    e.check = check
    throw e
  }
  const problems = check.ok ? [] : check.blocking
  const known = new Set(inventory?.i18nKeys ?? [])
  const missingKeys = [...i18nKeysOf(tour).keys()].filter((k) => inventory && !known.has(k))
  const host = hostView(inventory)

  const files = {
    'README.md': readme({ tour, inventory, host, missingKeys, problems }),
    'tourd/TourPlayer.js': playerSource,
    'tourd/tour.json': JSON.stringify(tour, null, 2) + '\n',
    'tourd/tour.schema.json': schemaJson,
    'snippets/manifest.resourceRoots.json': manifestSnippet(),
    'snippets/Start.view.xml': buttonSnippet(),
    'snippets/Start.controller.js': startSnippet(),
    'snippets/AutoStart.controller.js': autoStartSnippet(tour),
  }
  if (missingKeys.length)
    files['snippets/i18n.properties'] = missingKeys.map((k) => `${k}=`).join('\n') + '\n'
  if (problems.length) files['PROBLEMS.txt'] = problemsText(problems)

  const zip = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])),
    { level: 6, mtime: new Date('2026-01-01T00:00:00Z') },
  )
  return { filename: `${slugOf(tour.title)}-tourd.zip`, files, zip, check }
}
