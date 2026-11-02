# TourD designer in SAPUI5 (`app/designer-ui5/`)

A second designer, written as a real SAPUI5 app (Component, manifest routing, XML views, i18n). The React designer
(`designer/`, built into `app/designer/`) and the player stay as they are; the server (`srv/`) is shared and unchanged.

Open it at `http://localhost:4044/designer-ui5/index.html` (`npm run dev`). UI5 comes from `ui5.sap.com`
(version 1.148, the newest release with long-term support; `?ui5=1.120|latest` to try others). No build step: the folder is served as it is.

Rule as in PLAN.md: tick `[x]` only after the task is verified (here: driven in a real browser with Playwright).

## Layout

| Path | What |
| --- | --- |
| `index.html`, `Component.js`, `manifest.json` | start, shared models (`app`, `i18n`), routing (`projects`, `projects/{id}?tab=`) |
| `util/Api.js` | all REST calls, a copy of `designer/src/api.ts` |
| `util/Format.js`, `util/Theme.js` | formatters; light / dark / automatic (remembered in `tourd.theme`, same key as the React designer) |
| `controller/BaseController.js` | helpers: `attempt` (error strip), `confirm`, `dialog` (fragments), `text` (i18n) |
| `view/`, `fragment/` | XML views, dialogs |
| `view/tab/`, `controller/tab/` | one view + controller per project tab, created on first use by `Project.controller.js` |
| `control/CodeEditor.js`, `control/DiffEditor.js` | CodeMirror 6 as UI5 controls (same look and languages as the React designer, follows light / dark) |
| `lib/tourd-logic.js` | validation, lint, snippets, Markdown parser: the repository's own modules bundled (`designer/ui5-editor/logic.js`) |
| `lib/codemirror.js` | the CodeMirror bundle (committed, ~1 MB). Source `designer/ui5-editor/entry.js`; rebuild with `npm run build:ui5-editor` |
| `util/Tree.js` | file list as a tree for `sap.m.Tree` |
| `i18n/i18n.properties` | all texts |

Tabs talk through the component's event bus: `bus.publish("tourd", "changed", {what})` makes the project page reload its tiles.

## Phases

- [x] 0 Foundation: component, routing, shell (tool header, side navigation, recent projects), theme switch, API module
- [x] 1 Projects list: create, delete, open
- [x] 2 Project page: banner, overview tiles, next-step hint, tabs (route keeps the tab: `?tab=recordings`)
- [x] 3 Browser extension dialog: create token (shown once), copy, list, revoke
- [x] 4 Recordings tab: paste / load file / import, purpose, filter, details dialog, delete
- [x] 5 Workspace tab: file tree, CodeMirror editor, diff, upload (folder / zip / files / paste), new / rename / remove / put back, changes list, accept, downloads, full screen
- [x] 6 Tours tab + generate dialog (job progress, checks per tour, delete)
- [x] 7 Tour page: step list (drag and drop, move, duplicate, delete), step form, target picker, placement, bubble preview, JSON (CodeMirror with schema marks), checks, history, named versions, export, AI refine, add to project, sandbox (pick a control, replay), live snippets; autosave, undo / redo
- [x] 8 Tests tab + test plan page (settings, steps table, locators, dry run, generated files, add to project)
- [x] 9 Help tab (topics, edit with AI improve, delete, add to project)
- [x] 10 Command palette (Ctrl+K: projects, actions, files of the open workspace)
- [x] 11 e2e spec `test/e2e/designer-ui5.spec.js` (7 tests), README / ARCHITECTURE section

Every feature of the React designer is ported. (Until phase 6 the unported tabs showed a link to the React designer; `tabNotPorted` in i18n is now unused by the tabs.)

## Open points

- UI5 is loaded from the CDN, so the SAPUI5 designer needs internet. The React designer works offline. Option: serve UI5 from `node_modules` (`@openui5/*`) later.
- Differences on purpose: the step list uses `sap.m.List` drag and drop plus move buttons; the sandbox and live panes stay mounted (hidden with CSS) so the sandbox keeps running; leaving the tour page with unsaved edits saves them first.
- Not ported: remembered width of the file tree (the splitter is UI5's own), `description` of the project in the page header is shown but not editable (as in the React designer).

## Not touched

The browser extension (`extension/`, `recorder/`), the player, the React designer and the server routes it uses. Only addition on the server: `GET /live/recorder.js` (recorder as a console snippet; test in `test/unit/preview-routes.test.js`), and `recorder/` is copied by `build:cf` so the route works on Cloud Foundry.

## Change log

- 2026-10-31 Phases 0-4 built and checked in Chrome (Playwright against a throwaway server on 4055): create / open / delete project, extension token, recording import (plain text, 5 of 5 matched), purpose change, filter, step details, delete, tiles update.
- 2026-10-31 UI5 version fixed to 1.148 (newest LTS in ui5.sap.com/version.json). `/live/recorder.js` added; "Copy console snippet" works and puts the recorder on the clipboard. CodeMirror bundle + `CodeEditor` / `DiffEditor` controls. Phase 5 (Workspace) checked in Chrome: upload folder (15 files, 19 controls), open file with highlighting, type + save (status modified in the db), compare, dark theme, accept all, new file.
- 2026-10-31 Phases 6-11 done and driven in Chrome (Playwright, throwaway server): tours (generate with rules, edit, autosave, undo, JSON, live, history, export, add to project, sandbox plays the tour), tests (create, edit, save, dry run, generated files, add to project), help, command palette, `test/e2e/designer-ui5.spec.js` 7 passed. Fixes on the way: fragments with their own controller need `Fragment.load` (not `Controller#loadFragment`); a 1280 px window put the right panel tabs into the overflow menu, so below 1650 px the right panel moves under the other two.
- 2026-10-31 Brand: the visible name TourD became QuickDev in the browser extension (manifest name, panel texts, messages, icon "Q"), the React designer and this designer. Code names stay (`tourd-*` ids and CSS classes, `tourd_` tokens, `X-TourD-Token`, `__tourdRecorder`, `tourd-recorder` format, files and folders), because the server, the player and the tests depend on them. Browser extension dialog rebuilt (install steps, address to copy, token, paired browsers with "ago" times, snippet). Full screen in the workspace folds the side menu away and gives it back afterwards.
