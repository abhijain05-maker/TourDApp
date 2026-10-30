# TourD v2 – UI5 recorder (Chrome/Edge extension), project workspace, tours **and** wdi5 tests

**Live tracker for v2.** v1 (guided tours, phases 0–9) is in [PLAN.md](PLAN.md) and keeps working. A task is ticked `[x]` **only after it is verified** (test passing / command run / behaviour seen in a browser). A phase is ticked in the table only when all its tasks and its gate are ticked. Deviations go in the *Change log* at the bottom.

## Progress overview
| # | Phase | Status |
|---|---|---|
| 0 | Plan & decisions | [x] |
| 1 | Recorder core + `tourd-recording` format + importer | [x] |
| 2 | Chrome/Edge extension (MV3): record, send, play tour | [x] |
| 3 | Workspace backend: project file tree, edits, changes, export | [x] |
| 4 | Modern UI: app shell + workspace (tree, tabs, editor, diff) | [x] |
| 5 | Tour → workspace (apply changes to the project, sandbox from the tree) | [x] |
| 6 | wdi5 generator – new project (config, journey, specs; Mocha default; auth none/basic/XSUAA) | [x] |
| 7 | wdi5 in an existing project (helper catalogue, reuse, config patch) | [x] |
| 8 | wdi5 preview: code/diff, step table, replay in the live app (extension) | [x] |
| 9 | Cloud Foundry readiness (database, XSUAA, pairing token, mta) | [ ] |
| 10 | Hardening, docs & full acceptance run | [ ] |
| 11 | Help for any app: write in the extension, AI, add to the project (built before 9 and 10) | [x] |

---

## 1. Context
TourD v1 generates guided tours from uploaded files plus a DevTools-Recorder recording. v2 changes three things the user asked for:

1. **Our own recorder** (a Chrome/Edge extension, written from scratch) that runs *inside* the UI5 app and reads the live UI5 runtime – exact control, type, view, controller, route, i18n key/binding path, stable-id flag – instead of guessing from DOM ids.
2. **Two outputs from one recording:** the **tour** (as today) and **wdi5 end-to-end tests** (config, journey, spec files; new projects or into an existing project, reusing existing helpers).
3. **A project workspace:** the user uploads a project (zip/folder; git later), sees it as a file tree in a code editor, edits files, reviews generated/changed files as diffs, previews, and downloads the result. The tool is deployed on **Cloud Foundry**.

## 2. Decisions (confirmed by the user)
| Topic | Decision |
|---|---|
| Recorder | Own MV3 extension from day 1; recorder core is one plain-JS module (also injectable as a console snippet fallback). Not based on `ui5-journey-recorder` code. |
| wdi5 style | **JavaScript**, **Mocha** default (Jasmine selectable), login **none** by default, **basic** and **BTP/XSUAA** as settings; credentials only from environment variables, never written into files. |
| Where code lives | In the **database** (virtual file tree) because the server runs on Cloud Foundry (no access to local disks, ephemeral disk). |
| Running tests | **Never on the server** (remote-code-execution risk, no Chrome, cannot reach the user's app). The user runs `npx wdio run …` locally/CI; TourD shows the exact commands. A local runner is a later option. |
| Hand-over | **Changes-only zip** (default), **full-project zip** (only when every file was uploaded), patch; optional write-back into a local folder through the browser's folder permission (Chrome/Edge). |
| Previews | Tour: sandbox in TourD, **Play tour** in the live app via the extension. wdi5: code + diff, step table, **replay in the live app** via the extension (no Node/webdriver). |
| Editing generated tests | Two ways, not synced: **step table** (regenerates code) or **edit the code** (file then counts as hand-edited; regenerate shows a new diff instead of overwriting). |
| Cloud | HANA or Postgres instead of SQLite, XSUAA login, extension pairs with a token (no interactive XSUAA login), `TOURD_ALLOWED_HOSTS` for the app's host. |

## 3. Architecture (three parts)
```
 ┌────────────── TourD on Cloud Foundry ──────────────┐     ┌─── user's browser ───┐     ┌─ user's machine / CI ─┐
 │ workspace (file tree in DB) · editor · diffs       │     │ Chrome/Edge extension │     │ npm i && npx wdio run │
 │ agent + templates → tour files / wdi5 files        │◄────│ record · replay ·     │     │ (commands shown by    │
 │ sandbox preview · export (zip/patch)               │     │ play tour in the app  │     │  TourD, never run by  │
 └────────────────────────────────────────────────────┘     └───────────────────────┘     │  the server)          │
                                                                                           └───────────────────────┘
```

## 4. Contracts
- **`tourd-recording` v1** (`shared/recording-schema.mjs`, Zod): `{format, version, recordedAt, app:{url,title,ui5Version,appId,locale,theme}, steps:[{index,t,type,control?,value?,redacted?,hash?,route?,note?}]}`; `control = {id, viewName, localId, controlType, controllerName, text, label, tooltip, i18n?, binding?, properties?, stableId, via?, fragment?}`; step types `press | input | select | search | toggle | key | navigate | open | close`. Passwords are never recorded (`redacted: true`, empty value).
- **Workspace**: `Workspaces(project)` → `Files(path, kind, content|blob, origin)` with `base` (as uploaded) and `working`; a file's status = `unchanged | added | modified | deleted`; `Changes` = proposals (agent/template) with `status: proposed | applied | rejected`, snapshot for undo.
- **Generation**: every generated file is `{path, content, generator, reason}`; verified (parses, referenced helpers/targets exist) before it is shown.

## 5. Reuse from v1 (do not rewrite)
`srv/lib/recordings/*` (adapter registry, `map.js`), `parsers/*` (acorn/xml), `context/inventory.js`, `llm/*` (generate/repair loop, redact, secrets), `validate/lint.js`, `export/bundle.js` + `fflate`, `shared/live-snippet.mjs`, `sandbox/*` (pick/describe), `srv/security.js`, player, designer (editor, history, JsonPanel/CodeMirror, ExportDialog), test helpers (`plain-app.js`, `e2e-tour.js`, `big-app.js`).

---

## Phase 0 – Plan & decisions
- [x] Questions settled with the user (extension from day 1, JS + Mocha, auth none/basic/XSUAA, workspace in the cloud, no server-side test runs, hand-over formats, previews)
- [x] This file written; v1 `PLAN.md` kept as history
- [x] **Phase 0 complete**

## Phase 1 – Recorder core + format + importer
- [x] `shared/recording-schema.mjs` (Zod, strict, versioned) + `.d.mts`; unit tests (valid/invalid, passwords redacted)
- [x] `recorder/recorder.js`: self-contained in-page module (no dependencies) — _deviation: it hooks the events UI5 controls **fire** (`fireEvent` of the first prototype of `Control` that defines it; undone on stop) instead of DOM click listeners, so keyboard presses, popups and list rows are exact and nothing is guessed from pixels; DOM listeners are used only for pick mode_ — control metadata (type, view, controller name, text/label/tooltip, i18n key & binding path where available, stable-id flag), semantic step types, value capture with password/redaction rules, hash/route tracking, de-duplication (click + change, key repeats), start/stop/get/clear/onStep API, pick mode for later assertions
- [x] Unit tests with a fake `sap`/DOM (the recorder file is run in a `vm` sandbox): metadata, i18n, clones, dialogs, redaction, dedupe, navigation, controls (36 tests; a mutation check proved the secrets tests can fail)
- [x] Browser test (Playwright, demo app): inject the recorder, click through the real demo app, assert recorded steps (ids, views, controller names, routes), password field never recorded
- [x] Importer `srv/lib/recordings/tourd-recorder.js` (detect + parse → normalised recording with `ui5` data, so `map.js` maps 1:1) + registered in `recordings/index.js`; handler names merged from the inventory (`control.handlers`) — _runtime handler names are not available for XML views, so the server adds them from the uploaded views_
- [x] Tour generation from a `tourd-recording` (rules) gives a valid tour with every target resolved; fixture `test/fixtures/recordings/demo-create-order.tourd.json` produced by the real recorder run
- [x] Designer: format selector shows "TourD recorder"; recording details show view · controller · handler per step, choices ("chooses Shipped"), toggles and left-out secrets
- **Gate 1:** a flow recorded by the real recorder in the demo app imports and generates a valid tour with zero unresolved steps.
- [x] **Phase 1 complete**

## Phase 2 – Chrome/Edge extension (MV3)
- [x] `extension/` (own code): manifest v3, service worker, bridge, injection of the recorder into the **main world** (`chrome.scripting.executeScript`, `world: "MAIN"`) in **all frames** — _deviation: injected on demand, not as a static content script, so nothing runs on a page that is not being recorded; frames that open or reload while recording are injected by `webNavigation.onCommitted`_ — side panel (Start, Pause, Resume, Stop, live step list with remove, notes, settings: TourD address + token)
- [x] Persistence across reloads (`chrome.storage.session`, one writer per tab), badge with the step count — _keyboard shortcut left out: clicking the icon opens the panel_
- [x] Transport: download `tourd-recording.json`, copy, **send to TourD** with a pairing token — entity `ExtensionTokens` (only the SHA-256 is stored, shown once, revocable), actions `createExtensionToken` / `revokeExtensionToken`, designer dialog "Browser extension"; `srv/security.js`: a request with the header `X-TourD-Token` or an extension origin must carry a valid token and may only list projects/tours, send a recording and fetch a tour or the player (found by the test: Chrome sends no Origin on some extension requests, so the token decides, not the origin)
- [x] "Play tour": the panel fetches the tour, the worker injects the bundled player (`live-player.js`) and starts it in the app's frame (the console snippet of v1 stays as fallback; a **recorder console snippet** was added for people who cannot install the extension)
- [x] Playwright tests with the extension loaded into headless Chromium (persistent context): record in the demo app → send → appears in TourD → generate → tour plays back through the panel; plus not paired / revoked, a page without UI5, pause/resume, reload while recording, an app in a cross-origin frame (launchpad-like), a frame opening while recording, save-as-file
- [x] Docs: `docs/EXTENSION.md` (install, pairing, recording, playing, permissions, troubleshooting, without the extension), `npm run package:extension` builds a zip to share
- **Gate 2:** record in the demo app with the extension, send to TourD, generate the tour, play it in the app via the extension – all in an automated test.
- [x] **Phase 2 complete**

## Phase 3 – Workspace backend
- [x] _deviation: the existing `Sources` table became the workspace (one row per file: working content + hash, `base` filled only once a file differs from the upload, status unchanged/added/modified/deleted, binary flag, soft delete for uploaded files) — no separate `Workspaces`/`Snapshots`; v1 projects are migrated by an additive SQLite migration instead of a reset_ Data model: `Workspaces`/`Files` (path, kind, size, binary flag, base/working content, origin, hand-edited flag), `Changes`, `Snapshots` – portable CDS (HANA/Postgres/SQLite)
- [x] Import: zip / folder / single files / (later git); ignores `node_modules`, `.git`, `.env`, build output; limits; binary files stored as blobs; path normalisation (reuse `sources.js` guards)
- [x] File API: list tree, read, write (base-hash conflict check like `baseVersion`), create, rename, delete, revert file, status per file
- [x] Inventory is rebuilt from the working files (existing `buildInventory`) after changes
- [x] Export: changes-only zip (+ `CHANGES.md` list), full-project zip (only if complete), unified patch
- [x] Migration: existing v1 projects keep working (their `Sources` appear as a read-only-compatible workspace)
- [x] Tests: service tests (import, edit, conflict, revert, export), size/zip-bomb/traversal tests
- **Gate 3:** upload a project, edit a file through the API, export changes-only zip that applied over the original gives the edited project.
- [x] **Phase 3 complete**

## Phase 4 – Modern UI: app shell + workspace
- [x] Design system pass: Horizon colour tokens through UI5 theme variables, light/dark/auto (remembered, follows the OS), empty states, slim navigation (starts slim below 1180 px); app shell with left navigation (Projects, recent projects, Browser extension, Appearance), top bar with search, breadcrumb, command palette (Ctrl/Cmd+K: projects, files, actions). _Deviation: Recordings/Tours/Tests stay tabs of the project page rather than global navigation entries (they belong to one project); toasts and skeleton loaders were not needed so far_
- [x] _the right-hand panel (problems, preview, agent) comes with Phases 5–8, the changes panel is there now_ Workspace screen: resizable split panes – **file tree** (status badges added/modified, filter, context menu) · **editor tabs** (CodeMirror 6: JS/XML/JSON/properties highlighting, search, dirty markers, save/revert) · right panel (problems, preview, agent)
- [x] **Diff view** (side-by-side, unchanged parts folded) between the uploaded and the working copy; per file: edit, put back (reject); "accept" arrives with proposed changes in Phase 5
- [x] Keyboard and accessibility pass (tree arrow keys, Ctrl+S, palette, resizable splitter by keys); 1024 px checked in a screenshot (no horizontal scroll); axe scans of the workspace, shell and palette — found and fixed: unnamed editor, splitter without value, tab list with buttons inside, scroller not focusable, brand label mismatch
- [x] Existing screens (projects, tours, editor) moved into the new shell without losing features (all v1 e2e tests still green; only the "Files" tab is now "Workspace")
- **Gate 4:** the v1 journey and the new workspace journey run in the new UI; screenshots reviewed.
- [x] **Phase 4 complete**

## Phase 5 – Tour → workspace
- [x] _deviation: the proposals are computed on request (`previewTourApply`) and not stored; the user ticks the files and `applyTourToProject` writes them as ordinary workspace changes — editing a proposal before accepting is done by accepting and then editing the file_ "Add tour to project" creates proposed changes: `tourd/*`, manifest `resourceRoots`, start button in the host view, handler in its controller (the v1 snippets, applied as real edits with diffs; idempotent)
- [x] Sandbox preview built from the **working** files (including edits); tour steps re-checked against them
- [x] Export from the workspace (changes-only / full zip); v1 bundle export stays
- [x] Tests: apply to the demo app, download, unzip over the original, the tour plays in a real page
- **Gate 5:** edit a view in the tree, regenerate/lint the tour, preview, download, play in the real app.
- [x] **Phase 5 complete**

## Phase 6 – wdi5 generator (new project)
- [x] _read the wdi5 docs (configuration, locators, authentication, recipes) and the `create-wdi5` 3.0 templates; found: `wdio-ui5-service` 3 needs WebdriverIO **9** while `npm` now offers 10, so the generated `package.json` pins `^9`; the control API must be used fluently (`browser.asControl(sel).press()`)_ Check the current wdi5 / WebdriverIO documentation and templates before writing any template (versions, config keys, auth options)
- [x] _browser is Chrome only (headless by flag); spec naming is from the recording name; `BROWSER_VERSION` env lets WebdriverIO fetch a matching Chrome_ Settings model: baseUrl, framework (Mocha default / Jasmine), browser, auth (none / basic / BTP-XSUAA via env variables), spec naming, TypeScript off (JS only)
- [x] Templates (own code): `package.json`, `wdio.conf.js`, `.env.example`, `README.md`, shared `helpers/` (navigation, waits, auth hooks), journey file, spec files
- [x] _deviation: rules only — the AI naming/extra checks idea moved to Phase 8 (assertions)_ Recording → test steps (selectors from the recorded runtime data: id+viewName / bindingPath / i18n / properties; actions press/enterText/…; assertions heuristics); agent adds names, descriptions, extra assertions – output verified (parses, selectors ⊂ inventory/recording)
- [x] Step table (action, selector, value, assertion) with regenerate ("Start over from the recording"); hand-edited marker ("changed")
- [x] Files appear as proposed changes in the workspace (the same review dialog as for tours); export zip with run commands (the README in the tests folder)
- [x] Tests: generated project passes `node --check`, selector resolution against the inventory, snapshot tests; **opt-in** real run (temp dir, `npm i`, `wdio run` against the demo app)
- **Gate 6:** record in the demo app → generate wdi5 project → files valid, selectors resolve; (opt-in) the real run passes.
- [x] **Phase 6 complete**

## Phase 7 – wdi5 in an existing project
- [x] _what is read: config (specs, framework, services, baseUrl), specs, helper/page-object files (functions and methods through CommonJS or ES exports, instances and statics, getters/fields that hold selectors), package.json; TypeScript is detected and not rewritten; TourD's own earlier journeys are not helpers_ Detect wdi5 files in the workspace (config, specs, helpers, page objects, package.json); parse with acorn into a **helper catalogue** (exports, signatures, JSDoc, existing selectors, style: ESM/CJS, framework)
- [x] _deviation: rules instead of an AI agent — a step reuses only a function that does exactly one thing to exactly that control (same action; a search only if it also presses Enter), so nothing can be called that does not exist; the "repair loop" is not needed. Setup helpers (login, open) are called before the first step. A step can opt out_ Generation reuses catalogue helpers (agent may only call what exists; verified like tour targets, repair loop); no catalogue → offers the base-helper template
- [x] Config handling: never rewritten; minimal patch (spec glob, baseUrl, missing service/framework entry) shown as a diff and applied only on approval
- [x] Style matching (done by running the generated code through prettier with the project's detected style) (indentation, quotes, import style); new spec placed next to existing ones
- [x] Tests: fixture projects (with/without helpers, ESM/CJS, Mocha/Jasmine), reuse and patch assertions
- **Gate 7:** an existing wdi5 project with helpers gets a new spec that calls its helpers and a minimal config patch.
- [x] **Phase 7 complete**

## Phase 8 – wdi5 preview
- [x] Code (read-only, per file) and diff (the add dialog) preview (Phase 4 diff view) with run instructions box (`npm i`, `npx wdio run …`, env variables)
- [x] **Dry run** (from the app's files, no browser: found / not in the app / several match / only known when it runs; per control and per step) against the sandbox/inventory: every selector resolved, flagged when missing or ambiguous
- [x] _deviation: results are shown in the extension panel, not sent back to TourD (that would need a write route for the token; the generated tests are what gets run for real)_ **Replay in the live app** via the extension (UI5's own record/replay API where available, else our resolver): highlights each control, performs the action, reports pass/fail per step back to TourD
- [x] _deviation: no AI suggestions; "Add a check" in the extension records a new step type `check` (value / text / visible, never a secret) that becomes a check in the plan, no write route needed_ Assertions: pick-mode "Add assertion" in the extension, heuristics, optional AI suggestions
- [x] Tests: replay in the demo app through the extension
- [x] _moved here from Phase 4_  (its quick actions need tours and tests to exist)_ Project home: recording status, generated artefacts, quick actions (Record, Generate tour, Generate tests, Export)
- **Gate 8:** generated steps replay in the demo app via the extension with a per-step result in TourD.
- [x] **Phase 8 complete**

## Phase 9 – Cloud Foundry readiness
- [ ] Database abstraction: HANA/Postgres profile, migrations, large content handling; SQLite stays for local
- [ ] XSUAA (xs-security.json, approuter or `@sap/xssec`), role for editing; `TOURD_ALLOWED_HOSTS`, security headers behind the router
- [ ] Pairing tokens for the extension (create/revoke in Settings), rate limits, size limits per request
- [ ] `mta.yaml` / `manifest.yml`, build of designer in the pipeline, health endpoint, logging without secrets
- [ ] Secrets only through bindings/environment; AI provider bindings (AI Core) verified
- [ ] Deployment guide; smoke test script against a deployed URL
- **Gate 9:** deployable bundle builds; locally simulated XSUAA/pairing flow passes tests.
- [ ] **Phase 9 complete**

## Phase 10 – Hardening, docs & full acceptance run
- [ ] Security review (extension permissions, file API, zip handling, token pairing, CSRF/origin rules, XSS in editor/diff, secrets in workspace files never sent to AI)
- [ ] Performance on a large project (thousands of files in the tree, big diffs)
- [ ] Docs: user guide (record → tour / tests → download), extension install, wdi5 settings, troubleshooting, architecture update
- [ ] **Acceptance run (Playwright):** extension records in the demo app → sent to TourD → workspace → tour + wdi5 files generated → edit in editor → previews → export → apply → tour plays and generated spec checks (opt-in real wdi5 run)
- [ ] Manual acceptance (needs the user): real apps, Launchpad iframes, XSUAA login, real AI providers
- **Gate 10:** acceptance green; docs complete.
- [ ] **Phase 10 complete**


## Phase 11 – Help for any app (added 2026-10-28, built before Phase 9/10)
Context help like the BTP cockpit's Help Topics panel: written live in the running app through the extension, improved with AI, added to the app's own files. See `docs/HELP.md`.
- [x] Contract `shared/help-schema.mjs` (topic = title, summary, text, note, links, `target` of a tour step), `validateHelp`, `upsertTopic`; tests `help-schema.test.js`
- [x] Server: entity `HelpSets`, actions `saveHelpTopic` / `deleteHelpTopic` / `saveHelpSet` (optimistic `baseVersion`) / `createHelpSet`, `GET /live/<id>/help.json` and `/live/help.js`; the paired extension may call exactly these (`EXTENSION_ROUTES`, role `Extension`); tests `service-help.test.js`
- [x] Runtime `player/HelpLayer.js` (help button, docked side panel with search, `?` badges on controls, connector line, popover with note and related links, per-screen topics, Escape/keyboard, `{i18n>key}`); uses `TourPlayer.resolveAll` / `resolveI18n` (new exports)
- [x] Extension: "Write help for this app" (pick without a recording, form, live preview in the app while typing, save, edit, delete, survives a page reload); worker commands `helpStart/helpPick/helpShow/helpStop`; e2e `extension-help.spec.js`
- [x] AI: `improveHelpTopic` (`srv/lib/llm/help.js`; writes or improves the words only, never the target; rule-based draft without a provider); the SAP AI Core schema name is now a parameter instead of the hardcoded `tour_draft`; tests `help-ai.test.js` (scripted provider)
- [x] Add to project: `planHelpApply` (HelpLayer, TourPlayer, help.json + schema, manifest resourceRoots, `patchComponent` for `Component.js` with or without `init`, i18n keys), `previewHelpApply` / `applyHelpToProject`; `AddToProjectDialog` kind `help`; tests `help-apply.test.js`
- [x] Designer: project tab **Help** (topics with control and screen, edit with preview and AI, delete, add to project); e2e `help-tab.spec.js` goes designer → apply → changes.zip → app → help shown to an end user; `help-apply.spec.js` does the same from the planner alone
- [x] Checked on the user's Fiori elements list report (cap-sflight, read-only): picked controls resolve, badges and panel show, the page lays out in the width that is left
- [ ] **Open, needs the user:** a real AI provider run (Gemini / AI Core; only a scripted provider is tested), the Component patch on a real Fiori elements project (only a typical generated `Component.js` is unit-tested), the Fiori launchpad with the app in an iframe, a real XSUAA login with the `Extension` role
- [ ] Later: sandbox preview of help in the designer, help per user role, help in several languages as i18n bundles
- **Gate 11:** a topic written in the extension is shown in the app while typing, reviewed in TourD, added to the files, and an end user sees it in the changed app (browser tests green).
- [x] **Phase 11 complete** (except the open items above)

---

## Risks
| Risk | Mitigation |
|---|---|
| Handler names are not visible at runtime (XML view handlers are wrapped) | take them from the uploaded views' inventory (`control.handlers`) at import |
| Extension cannot see `sap.ui` from a content script | inject into the main world; test with a real extension build in Playwright |
| wdi5/WebdriverIO versions change | read the current docs before templates; pin versions in generated `package.json`; template tests |
| Large workspaces in the DB | size limits, ignore rules, lazy content loading, blobs outside the main table |
| Agent edits user code | proposals only, diff + approval, snapshot/undo, protected paths (`.env`, secrets) |
| XSUAA-protected apps | recording happens in the user's logged-in browser; generated config reads credentials from env |
| Remote code execution temptation | no server-side commands, ever; documented |

## Change log
- 2026-10-27 – v2 plan created and approved (see decisions). v1 stays as `PLAN.md`.
- 2026-10-27 – **Phase 1 done.** Verified: `npm test` 473 passed (44 files; new: recording schema 8, adapter 13, recorder 36); `npm run e2e` 78 passed. The real recorder, injected into the demo app on **UI5 1.120 and 1.153**, records search → Create → navigation → customer → status → Save with exact ids, views, controllers, i18n keys and labels; passwords and secret-looking fields are recorded as `redacted` without a value; the import maps 5 of 5 steps with certainty (`via: recorder`, 100 %), adds the controller and handler from the uploaded views, and the rule generator gives a valid tour (6 steps, none unresolved, navigation `order/new`). Fixture `test/fixtures/recordings/demo-create-order.tourd.json` was written by that real run (`TOURD_WRITE_FIXTURES=1 npx playwright test test/e2e/recorder.spec.js`).
- Notes: a press on an input's value-help icon is not a step; `liveChange` is ignored; a plain DOM click on something that fires no UI5 event is not recorded (documented limitation, no false steps); the console-snippet delivery moves to Phase 2 together with the extension (the recorder file is the same).
- 2026-10-27 – **Phase 2 done.** Verified: `npm test` 498 passed (46 files; new: extension logic 11, pairing 13, recorder snippet 2); `npm run e2e` 89 tests (extension 9, pairing 2). The real extension, loaded into headless Chromium, records the demo flow through its panel, sends it to TourD with a token (5 of 5 steps matched), TourD generates the tour, and the panel plays it in the app. Found while building: (1) a stale `cds watch` dev server kept respawning on port 4044 with the old database and hid the new table — stop it before running the e2e suite; (2) Chrome sends no `Origin` on some extension requests; (3) in a panel page a state object that has an `error` field must not be mistaken for a failed answer; (4) Chrome blocks a frame from a page it treats as public to a local address, so frame tests serve their shell page from a real loopback server.
- Notes: the extension asks for the permission "all sites" (documented) because it must inject into whatever UI5 app and frames the user records; it never touches a tab the user did not start; a full page reload while recording is tolerated but not recorded as a step (the hash changes inside the app are).
- 2026-10-27 – **Phase 3 done.** Verified: unit tests for import, edit, conflict, revert, export (changes.zip applied over the original gives the edited project), zip-bomb/traversal limits; additive migration verified on a copy of a real v1 `db.sqlite`. The `Sources` table is the workspace (see the deviation in Phase 3).
- 2026-10-27 – **Phase 4 done.** Verified: `npm test` 546 passed (50 files; new: workspace tree 6, intake, manifest pick); `npm run e2e` 96 passed on a fresh server (new `workspace.spec.js` 7: edit + Ctrl+S + diff + patch download, add/rename/remove/put back, conflict ("Save mine anyway"), palette + theme, tree keyboard, two axe scans). Light and dark screenshots reviewed. Found while building: (1) the theme hook returned a snapshot that did not change for auto→light on a light system, so the label stayed "auto" — the snapshot is now the choice itself; (2) a newly created file inside a new folder was invisible in the tree — opening a file now reveals it; (3) axe: editor without a name, splitter without a value, buttons inside a tab list, non-focusable scroller; (4) removed files leave the tree and are listed under Changes (with "put back"); (5) the project home moved to Phase 8, see there.
- 2026-10-27 – **Phase 5 done.** Verified: `npm test` 563 passed (52 files; new: apply planner 12, service 5); `npm run e2e` 98 passed on a fresh server (new `tour-apply.spec.js`: the plan with diffs, leaving a file out, ordinary workspace changes, adding again offers only what was left out, a not-ready tour is blocked, and **the changes.zip unzipped over a plain copy of the demo app makes the whole tour play** in a real page). Design: the planner (`srv/lib/export/apply.js`) edits text surgically so the diff shows only the real change — manifest (the entry goes first into `resourceRoots`, keeping tabs/spaces; falls back to rewriting the file, with a note, if that does not give valid JSON), view (button into the Page's `headerContent`, prefix-aware; says so when there is no `sap.m` Page), controller (acorn finds `Controller.extend({...})` or a class; TypeScript is left alone with a note), i18n keys the tour uses and the app lacks. Idempotent: planning again after applying gives no edits. The sandbox was already built from the working files; a test proves the edited view/controller are in it and that it keeps its own player.
- Notes: the plan is recomputed when applying, so a file changed in between is never overwritten with an outdated plan; `tourd/tour.json` has a fixed name, so applying a second tour replaces the first (the dialog says so). Not done: the optional auto-start snippet (still in the export bundle).
- 2026-10-27 – **Phase 6 done.** Verified: `npm test` 601 passed (56 files; new: plan 10, render 13, apply 8, service 7); `npm run e2e` 101 passed (new `tests-wdi5.spec.js`: recording → plan table → edit → Ctrl+S → reload → review diffs → add → download, a blocked plan, axe scan); **`npm run test:wdi5` (opt-in) passed for Mocha and for Jasmine**: the tests generated from the recorded demo flow were installed with the real packages and ran in Chrome against the demo app (5 passing each); a mutation check showed that the generated checks fail when the expectation is wrong. Found while building: (1) `wdio-ui5-service` 3 + WebdriverIO 10 do not fit (peer 9); (2) with a Chrome that is a version ahead of the downloaded driver the session is refused — `browserVersion: "stable"` fixes it, the config reads `BROWSER_VERSION`; (3) a press that navigates must be checked with the retrying `toHaveUrl`, not by reading the hash once; (4) a select is opened and its `sap.ui.core.Item` pressed by text (`ancestor` = the select), `getSelectedKey` checks it; (5) texts of steps go into comments and strings of generated code: they are neutralised (a title with `*/` or a line break cannot reach the code); (6) a test that runs wdio from the same process that serves the app must not use `spawnSync`.
- Notes: an existing `wdio.conf.js` is left alone (Phase 7 will patch it); one plan = one journey/spec pair named after the plan; TypeScript output is not offered (JavaScript only, decided).
- 2026-10-27 – **Phase 7 done.** Verified: `npm test` 624 passed (58 files; new: catalogue 12, existing-project 10 incl. running the generated spec against a fake browser through the project's real page object, service 1); `npm run e2e` 102 passed (the plan says what it reuses, "Do not use it", the diff of the journey); **`npm run test:wdi5` 3 passed**, among them the generated tests added to a copy of a project that has wdi5 (page object, login helper, own spec) — both specs ran green in Chrome. Gate 7: a project with helpers gets a spec whose journey calls `mainPage.startNewOrder()`, `mainPage.searchFor('Acme')` and `login()`, with the project's quotes, semicolons and 2-space indent; a config that does not reach the new spec gets a minimal patch (glob and the missing `ui5` service) as a reviewable diff.
- Notes: `prettier` moved from dev dependencies to dependencies (it formats generated code at run time); a rewritten `package.json` is avoided unless something is added; a project in ES modules with Jasmine and tabs was checked by parsing the output (not by running it).
- 2026-10-28 – **Phase 8 done.** Verified: `npm test` 635 passed (60 files; new: dry run 5, checks 5, service +1); `npm run e2e` 109 passed in three of four fresh-server runs (new: `extension-replay.spec.js` 3, recorder checks 2, extension "Add a check" 1, overview 1, plan page dry run + files); **in the real extension, in headless Chromium, a plan made from the recorded demo flow replays all 11 steps against the real demo app (UI5 `RecordReplay`), the order really is in the list afterwards; a plan with a renamed control fails at that step with "Not found: the control customerInputRenamed…" and the later steps say "an earlier step failed"; a page without UI5 says so.** Gate 8 met, except that the per-step result is shown in the extension panel, not in TourD (deviation above). `npm run test:wdi5` still 3 passed.
- Found while building: (1) `RecordReplay.findDOMElementByControlSelector` wants the wdi5 locator `{ selector: {...} }`, `interactWithControl` the inner selector; (2) the panel picks the project that was created last, so e2e tests running in parallel must choose their project explicitly (a flaky replay test was this); (3) a token may now also list `TestPlans` (GET collection only), the single-plan route stays closed; (4) one run of four had a timeout in the older "records inside a frame" extension test (48 s, machine was busy with leftover processes); it passed in the next three — keep an eye on it in Phase 10.
- 2026-10-28 – **Fixes after first real use (Fiori elements app).** (1) Controls the uploaded files do not contain (Fiori elements) are taken from what the recorder saw (`srv/lib/recordings/map.js` `withLiveControls`, `srv/lib/service/live-inventory.js`): one inventory for generation, checks, export and the wdi5 dry run. (2) The recorder asks UI5 itself for a selector per control (`RecordReplay.findControlSelectorByDOMElement`, the algorithm of UI5's Test Recorder) and stores it as `control.selector`; the wdi5 plan uses it as strategy `ui5` (first for controls without an id, after the id otherwise). (3) Tour bubble smaller (17rem, compact). (4) A model call has a hard deadline; jobs left "running" by a restart are failed on start. Verified: `npm test` 655 passed (63 files); player + recorder browser specs passed; selectors checked by recording clicks in a running Fiori elements app. Not re-run: the rest of the browser suite.
- 2026-10-28 – **Merge options in the workspace.** `acceptChanges(projectID, fileIDs)` (all changed files, or only the given ones) makes the working copy the new "as uploaded" and drops removed files; `applyTestToProject` / `applyTourToProject` take `accept` to do it for the files they add. Designer: check-mark per change, **Accept all changes**, and a tick in the Add to project dialog. Verified: `npm test` 661 passed (63 files; new: accept all, accept one, accept on add, accept some; with `--maxWorkers=4` — a default-worker run sometimes fails whole files with "database is not open" while the machine is busy and passes alone); the designer flow was driven in Chrome against a throwaway server (add + accept leaves 0 changes, accepting one of two leaves 1, accept all leaves 0). Not run: the rest of the browser suite. Not built: merge on re-upload, writing into a local folder.
- 2026-10-28 – **Designer look (Fiori / Horizon).** New `components/PageHeader.tsx` (breadcrumbs, title, quiet chips, description), icon tiles on the project overview, a calmer Changes panel (empty state, count pill, download buttons, **Accept all changes**), tags as pills, tables with a quiet header, one-line editor bars for tours and tests, tab content in normal weight. Tour note without a control now sits at the top right (it covered the Save button at the bottom). Verified: `npm test` 661 (`--maxWorkers=4`); `npm run e2e` 114 tests passed in two runs on a throwaway database (first run had 5 failures: the e2e server picked up the Gemini key from `.env`, a test looked for `ui5-tag` where a chip is now, scripted edits had turned 39 files into CRLF which broke the live-snippet clipboard test, and the sandbox test caught the corner placement). `scripts/e2e-server.mjs` now blanks `GEMINI_API_KEY` / `AICORE_SERVICE_KEY`.
- 2026-10-29 – **Phase 11 done (help for any app).** Verified: `npm test` 710 passed (68 files, `--maxWorkers=4`; new: help schema 7, service 10, AI 14, apply 14, extension helpers 8); browser tests on a throwaway server (`TOURD_URL=http://localhost:4055`, fresh database): 115 of 117 passed in one full run with 2 workers; new `extension-help.spec.js` (author in the panel → preview in the app → save; passed 10 of 10 in parallel after the fixes below), `help-apply.spec.js` (planner output in a copy of the demo app: an end user gets panel, docked layout, badges, line, popovers, per-screen topics), `help-tab.spec.js` (designer edit → add to project → changes.zip → help in the changed app → delete). The one other failure, `editor.spec.js` "reorders steps…", is the mouse drag to the top: the 7 step cards are ~975 px tall (their subtitles wrap) and the test viewport is 720 px, so the last grip is off screen; with a 1200 px viewport the same drag works. Not caused by this phase (nothing in the tour editor changed); not fixed. Runs with 3 workers showed many 1.5-minute timeouts (UI5 comes from the CDN); the same tests pass alone or with 2 workers.
- Found while building: (1) the help panel covered the right 20 rem of the app including the control to point at: it now docks (the body gets less width; a margin alone does not shrink a UI5 body that says `width:100%`), except on windows under 760 px; (2) a preview still in flight when the author pressed Done brought the help layer back: the worker now refuses previews after stop and runs show/stop of a tab in order; (3) a click in the app before the picker was armed pressed the real button: the panel's message "Click the control in the app" is the signal that it is armed; (4) `build-player` copying `HelpLayer.js` into the demo app made it 18 files and broke the "17 files" upload tests: the demo app does not get it; (5) the SAP AI Core JSON schema name was hardcoded (`tour_draft`): now a parameter; (6) `patchController`'s parsing and insertion moved to shared helpers (`parseJs`, `findExtendTarget`, `addMember`) so `patchComponent` can reuse them (tour apply tests unchanged and green).
- Notes: the server of a running `npm run dev` needs one restart after this phase (its start-up step `db-deploy` adds the table `HelpSets`; a `cds watch` reload alone does not, and `HelpSets` answers 500 until then). `playwright.config.js` and the two extension specs take `TOURD_URL` so the browser tests can run against a throwaway server without touching the real database. Not verified: a real AI provider (scripted provider only), the Component patch on a real Fiori elements project (checked on a typical generated `Component.js`; controls resolving and the panel were checked on the cap-sflight list report), the Fiori launchpad with an app iframe, XSUAA with the `Extension` role.
- 2026-10-30 – **Help: the ? is a toggle at the top of the app.** The floating button (bottom right, hidden while the panel was open) became a **?** at the top right that switches the help on and off (`aria-pressed`), sits beside the docked panel, and steps left, button by button, for as long as it would cover something clickable in the app (found in the demo app: it hid the "Start tour" and info buttons). New option `buttonPosition` (`top` | `bottom`) in the help options. Verified: `npm test` 710 passed; `help-apply.spec.js` (toggle at the top, pressed state, beside the panel, never over a clickable control, second press closes, `bottom` option) passed 5 of 5; `extension-help.spec.js` and `help-tab.spec.js` green. Not verified: inside the Fiori launchpad shell bar (the **?** floats over it; adding it as a real shell-bar item through the launchpad's renderer API is a possible next step).
- 2026-10-30 - **Help: smoother pointing.** Found: after saving a topic, 'Point at a control' re-pointed that saved topic (saving would have replaced its control); nothing showed that the picker was waiting, Esc worked only with the app focused, a control without id or text ended the picking. Now: pointing after a saved topic starts a new one, a topic being written keeps its words, 'Point at another control' re-points a saved topic, the button becomes 'Cancel pointing' (Esc in the panel also cancels), the app shows a crosshair and a hint while it waits, a control that cannot be found again keeps waiting. Verified: npm test 710 passed; extension-help.spec.js (new: arm, hint, cancel by button and Esc, second topic leaves the first alone, re-point) 6 of 6 in parallel; recorder, extension and help-apply specs 20 passed.
- 2026-10-30 - **Help: the highlight stays while the title is retyped.** Reproduced: pointing, switching to the panel, scrolling and typing details all kept the control's outline, badge and popover in the app, but clearing the title field removed all of it (the preview only showed topics that had a title). Now a topic with a control is always shown (stand-in title 'New topic' in the preview only, never saved), and the pointing buttons plus the chosen control stay pinned at the top of the panel while the form is scrolled. Verified: npm test 710 passed; extension-help.spec.js (new step: empty title keeps popover, badge and outline) 8 of 8 in parallel; screenshot of the scrolled panel.
