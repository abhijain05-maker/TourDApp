# Architecture

TourD turns *"what the app is made of"* plus *"what a user does"* into a **tour** (a JSON document) and gives you what
you need to ship it. One rule shapes everything: **the model never invents controls**. Targets always come from a
deterministic inventory of the uploaded files, and are checked again before a tour is saved or exported.

```
 files (views, fragments, controllers,        recording (DevTools Recorder /
 manifest, i18n)                              UI5 Test Recorder / text)
        │                                              │
        ▼                                              ▼
  parsers ──► control inventory ◄── recording adapters ──► mapped recording
                    │                                              │
                    └────────────┬─────────────────────────────────┘
                                 ▼
              generators:  rules (no AI) │ Gemini │ SAP Generative AI Hub
                                 │   (prompt = inventory + recording + budgeted sources, redacted)
                                 ▼
                      validate + repair loop (≤ 2 rounds)  ──►  tour JSON (versioned in SQLite)
                                 │
          ┌──────────────────────┼───────────────────────────┐
          ▼                      ▼                           ▼
   designer (React):      sandbox preview:             export bundle:
   edit, reorder, retarget  copy of the app in a        player + tour.json + snippets
   JSON, history, AI edits  sandboxed iframe             + README   (gate: no broken targets)
                            live snippet for the real app
```

## Pieces

| Part | Where | Notes |
| --- | --- | --- |
| Tour contract | `shared/tour-schema.mjs` (Zod) → `shared/tour.schema.json` | one source for the API, the designer, the player, the LLM response schema and the exported schema |
| Parsers | `srv/lib/parsers/` | XML views/fragments (`fast-xml-parser`), controllers (`acorn`, never executed), manifest (routes → views), i18n |
| Inventory | `srv/lib/context/inventory.js` | every control with view, local id, type, resolved text, whether its id is stable; skips a file that cannot be parsed and says so |
| Prompt budget | `srv/lib/context/budget.js`, `llm/prompt.js` | inventory is always sent; source files only while they fit `TOURD_TOKEN_BUDGET`; big apps are focused on the pages of the recording |
| Recording adapters | `srv/lib/recordings/` | detect + parse each format; `map.js` links DOM ids to inventory controls |
| Generators | `srv/lib/llm/` | `rules.js` (also the offline test oracle), `gemini.js`, `sap-ai-core.js`; `generate.js` is the shared repair loop; keys only in the server environment, `secrets.js` scrubs messages |
| Lint | `srv/lib/validate/lint.js` | also runs in the designer on the working copy (same file) |
| Service | `srv/tour-service.cds/js` | OData V4 at `/odata/v4/tour`; generation is an asynchronous job; no database transaction is held while a model is called |
| Designer | `designer/` (Vite, React 19, UI5 Web Components) → `app/designer/` | autosave with version coalescing, conflict detection, undo/redo, history |
| Player | `player/TourPlayer.js` | one UI5 AMD module (≥ 1.108): bubble, spotlight, resolver chain, router navigation, a11y |
| Sandbox | `sandbox/`, `srv/preview.js`, `srv/lib/preview/` | built copy of the app: generated component, stub controllers, sample data; iframe without same-origin |
| Live | `shared/live-snippet.mjs`, `srv/preview.js` (`/live`) | console snippet / bookmarklet / loader |
| Export | `srv/lib/export/bundle.js`, `srv/export.js` | zip with `fflate`; gate = `checkExport` |
| Guards | `srv/security.js` | host and origin checks, headers |

## Contracts worth knowing

- **Tour**: `{schemaVersion, id, title, options, steps[]}`; a step has `title`, `text` (Markdown subset or `{i18n>key}`), `placement`
  (a `sap.m.PlacementType` value), optional `target` `{viewName, controlId, fallbacks[]}`, `before: [{type: "navigate", hash}]` and `meta`.
  Targets are **view-local**; the player resolves them at run time.
- **Inventory**: `{appId, views[], fragments[], routes[], controllers[], controls[], i18nKeys[], warnings[]}`; stored per project, rebuilt when files change.
- **Sandbox messages** (`postMessage`, documented at the top of `sandbox/sandbox.js`): designer → `loadTour`, `goToStep`, `navigate`, `pick`, `stop`;
  sandbox → `ready`, `tourStarted`, `stepChanged`, `tourEnded`, `pickResult`, `pickCancelled`, `error`.
- **Export bundle**: `tourd/{TourPlayer.js,tour.json,tour.schema.json}`, `snippets/*`, `README.md`, optional `PROBLEMS.txt`.

## Decisions and why

- **Inventory first.** UI5 ids are view-prefixed and generated ones change per run; letting a model "recognise" a control from code
  produces plausible, wrong ids. The model picks from a list, and the answer is verified against it.
- **Everything works without AI.** The rule-based generator is the fallback, the degraded mode without keys, and the oracle in tests.
- **Targets by view + local id** with fallbacks (text, css), resolved late and waited for, because navigation renders late.
- **The sandbox runs a rebuilt copy, not the app.** Real controllers need real back ends; stubs make navigation and dialogs work
  and nothing else happen. Uploaded code runs only if asked, only in a frame that cannot reach TourD.
- **The player draws its own bubble** (not `ResponsivePopover`): it needs a spotlight, exact placement, and to work the same
  from 1.108 to current without depending on UI5's popup stack.
- **Short transactions.** SQLite serialises writes; generation jobs write between model calls, never across them.

## Security model (v1)

TourD is a **local, single-user** tool: no login, answers only for localhost (`TOURD_ALLOWED_HOSTS` to change), refuses changes that
do not come from its own pages. Keys are read from the environment, never stored, returned or logged (`scrub`). Source files are
redacted before they leave for a provider. Markdown is rendered without raw HTML; the sandbox frame has no same-origin access;
paths in `/preview` and uploads are normalised and limited; zips are checked for size and traversal.
`/preview/<projectId>/…`, `/live/<tourId>/tour.json` and `/export/<tourId>.zip` are readable by anyone who knows the id (a random UUID);
multi-user access control is on the backlog.
