# TourD – guided tours for SAPUI5 / Fiori freestyle apps

SAPUI5 has no standard "guided tour" control. TourD generates one for any freestyle UI5 app:

1. Upload the app's views, controllers, manifest and i18n.
2. Provide a recording of the flow (Chrome DevTools Recorder JSON, or a UI5 Test Recorder export).
3. An AI agent (Gemini 3.8 Flash or SAP Gen AI Hub, switchable – or a rule-based generator with no AI) produces a validated tour JSON.
4. Edit it in the visual designer (drag & drop, text, control IDs, placement) and preview it.
5. Export a drop-in bundle (player module + `tour.json` + integration snippets).

Stack: SAP CAP (Node.js) · SQLite · React + Vite + TypeScript.
Progress and the full plan: see [PLAN.md](PLAN.md).

More: [Browser extension](docs/EXTENSION.md) · [Help for your app](docs/HELP.md) · [Recording the flow](docs/RECORDING.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Architecture](docs/ARCHITECTURE.md)

## Requirements
- Node.js >= 22.12

## Run
```bash
npm install
npm --prefix designer install
npm run build:designer     # builds the React designer into app/designer
npm run dev                # CAP on http://localhost:4044  (designer at /designer/)
```
Designer with hot reload (proxies the API to CAP): `npm run dev:designer` → http://localhost:5173/designer/

Port 4044 is used (not CAP's default 4004) so TourD can run beside other CAP projects.

## Test
```bash
npm test      # vitest (unit/integration)
npm run e2e   # Playwright: builds player and designer, starts the server and the demo app itself
npm run acceptance   # the end-to-end journey only: files -> recording -> tour -> edit -> sandbox -> export -> plays in the app
```

## Configuration
Copy `.env.example` to `.env` and set the provider keys. Keys stay on the server. Everything that can be set is explained in `.env.example`.

## Data
Projects, the project's files (the workspace), recordings, tours (with their version history) and generation jobs live in `db.sqlite`
(local store). The file survives restarts: `scripts/db-deploy.mjs` deploys the schema only when the file
is missing or the data model changed - in that case the old file is first copied to
`db.sqlite.<timestamp>.bak`. A model change that only adds tables or columns is applied to the existing file
without losing data (`scripts/lib/db-migrate.mjs`). `TOURD_DB_RESET=1 npm run dev` starts from an empty (backed-up) database.

## API (OData V4, `/odata/v4/tour`)
Entities `Projects`, `Sources`, `Recordings`, `Tours`, `TourVersions`, `GenerationJobs`; actions `importSources`,
`importRecording` (optional `purpose`: tour, test or both), `setRecordingPurpose`, `generateTour`, `createTour`, `saveTour`, `restoreVersion`; functions `getInventory`,
`getRecording`, `getTourVersion`, `lintTour`, `providers`. Generation runs as a job: poll `GenerationJobs(<id>)`
until `status` is `done` or `failed`. Help: entity `HelpSets`; actions `saveHelpTopic`, `deleteHelpTopic`,
`saveHelpSet`, `improveHelpTopic`, `previewHelpApply`, `applyHelpToProject` (see [docs/HELP.md](docs/HELP.md)).

## AI providers
`rules` (no AI, always available), `gemini` (default model `gemini-3.8-flash`) and `sap-ai-core` (SAP Generative AI Hub,
orchestration service). Copy `.env.example` to `.env` and set the keys; `providers()` shows what is configured and the
generate dialog switches per run. How it works: the model only sees the control inventory, the mapped recording and
(within `TOURD_TOKEN_BUDGET`, comments and secrets removed) the sources; it must answer in a small JSON schema, every
target is checked against the inventory, and concrete problems are sent back for up to two repair rounds. Targets that
still cannot be verified are kept but flagged `unresolved` - never silently accepted. Source code leaves your server
only for the provider you choose; `TOURD_DISABLE_AI=1` switches all AI off.

**Gemini**: create an API key in Google AI Studio, set `GEMINI_API_KEY` (and `GEMINI_MODEL` if you do not want `gemini-3.8-flash`).

**SAP Generative AI Hub**: on BTP, bind an AI Core service instance to the app (the SAP Cloud SDK reads the binding). Locally, put the AI Core service key as one line of JSON into `AICORE_SERVICE_KEY`, set `AICORE_MODEL` to a model that is deployed in your resource group (there is no useful default) and `AICORE_RESOURCE_GROUP` if it is not `default`. Check **Generate** in the designer: the provider list shows what is configured.

Real-service check (costs money): `npm run test:live` runs against every provider that has credentials.

**Setting it up on another machine, using SAP AI Core, deploying to BTP with SAP HANA: see [docs/SETUP-AND-DEPLOY.md](docs/SETUP-AND-DEPLOY.md).**

## Designer
There are two designers with the same features, on the same server and data: the React designer at `/designer/` and the SAPUI5 designer at `/designer-ui5/` (see below). Open http://localhost:4044/designer/ (after `npm run build:designer`). Create a project, add your app (folder, zip, files or pasted file), import a recording, generate a tour. For hot reload while developing the UI run `npm run dev:designer` (http://localhost:5173/designer/, proxied to the server).

### The SAPUI5 designer
http://localhost:4044/designer-ui5/ is the same designer written as a SAPUI5 app (Component, routing, XML views, i18n) in `app/designer-ui5/`. It has no build step: the folder is served as it is, and it needs no `npm run build:designer`. SAPUI5 comes from `ui5.sap.com` (1.148, the newest long-term-support release; `?ui5=1.120` or `?ui5=latest` to try others), so this designer needs an internet connection. The code editor and diff are CodeMirror, as in the React designer, from `app/designer-ui5/lib/codemirror.js`; the tour logic (validation, checks, snippets) is `lib/tourd-logic.js`. Both are built from the repository's own modules and committed: after changing `designer/ui5-editor/` or the modules they re-export, run `npm run build:ui5-editor`. The browser extension, the player and the React designer do not depend on it. Tracker: `PLAN-UI5.md`; tests: `test/e2e/designer-ui5.spec.js`.

### Recording with the browser extension
The **TourD Recorder** extension (Chrome/Edge) records in your running app as UI5 sees it - exact controls, views and controllers - and sends it to a project. Build it with `npm run build:extension`, load the `extension/` folder, pair it with a token from **Browser extension** in the top bar. It can also play a tour in the open app, and **write help for the app**: point at a control, write the text (with AI if you like), see the help panel with `?` badges in the running app, then add the help to your project's files - see [docs/HELP.md](docs/HELP.md) and [docs/EXTENSION.md](docs/EXTENSION.md).

### Workspace
The **Workspace** tab is the project's files: upload the app (folder, zip, single files or a pasted file), browse it as a tree (filter, keyboard arrows), open any file in the code editor (JavaScript, XML, JSON, properties, Markdown; **Ctrl+S** saves), and see what differs from the upload (**A**dded, **M**odified, **D**eleted) in the **Changes** list and as a side-by-side diff. Files can be created, renamed, removed and put back. Download only the changes (zip or patch) or the whole project. **Accept** (the check mark beside a change, or **Accept all changes**) makes a file part of the project as it is now, so it leaves the list of changes; "Put back" then returns to that state, not to the first upload. The **Add to project** dialog (tours and tests) can do this for the files it adds with one tick. Dependencies (`node_modules`), build output and files that may hold secrets (`.env`) are left out on upload. **Ctrl+K** opens the command palette to jump to any project, file or action; **Appearance** switches light/dark.

### Editor
Open a tour to change it: reorder the steps by dragging (or with the keyboard), edit title and text (a small Markdown subset), choose where the bubble appears, pick the control from the list of the app's controls, or edit the JSON directly. Changes are saved automatically; **History** keeps every version and can restore one.

## Add the tour to the project
In the tour editor, **Add to project** puts the tour into the project's own files: the player and the tour in `tourd/`, the `resourceRoots` entry in `manifest.json`, a **Start tour** button in the start page's view and its `onStartTour` handler in the controller (the same four steps the export README describes). Every file is shown as a diff first; untick the ones you do not want. The result is an ordinary change of the workspace: edit it further, then download the changes (zip or patch) and unzip them over your project. Adding the same tour again changes nothing; a view without a `sap.m` Page or a TypeScript controller is left alone and the dialog says what to add by hand.

## wdi5 tests
The **Tests** tab turns a recording into [wdi5](https://ui5-community.github.io/wdi5/) tests (JavaScript, Mocha or Jasmine, login none / basic / BTP / own form): a plan you edit as a table, then `wdio.conf.js`, a journey, a spec and the scripts are added to the project as diffs you accept. See [docs/WDI5.md](docs/WDI5.md). `npm run test:wdi5` is the opt-in check that runs the generated tests with the real packages in Chrome.

## Preview
Two ways to see a tour work, both from the tour page:

**Sandbox** – the tour plays in a copy of your app inside the designer. TourD builds the copy from the project's files: your views, fragments and i18n as uploaded; a generated `Component.js`; a manifest without data sources; sample data made up from the data bindings in the views; and *stub controllers* in which handlers do nothing except move to the page or open the dialog the real handler would. Uploaded controller code is not run unless you tick "Run the app's own controllers", and then only inside the sandbox. The frame is `<iframe sandbox="allow-scripts">`: it cannot reach the designer, TourD's cookies or storage. UI5 is loaded from `ui5.sap.com`, the version can be chosen (1.120, 1.148, latest).
- The step selected in the editor and the step in the frame follow each other; edits restart the tour on the selected step.
- **Pick control** then click a control in the app to make it the step's target (a click inside a control picks the control around it that has an id).
- **Go to page** opens any route of the manifest.
- Limits: no real back end, so lists show invented rows; the app's own `Component.js` is not used; custom controls from libraries that are not on the CDN fail to load (the frame then shows the error).

**Live** – the same tour inside your own running app, with its real data. Open the app, press F12, paste the snippet into the console. It carries the player and the tour (no network needed), so it works anywhere the console does. The same code is offered as a bookmarklet, and as a short *loader* snippet that fetches the player and the *saved* tour from TourD – that one needs the app to be allowed to load scripts from TourD (a strict Content-Security-Policy, an https page talking to an http server, or Chrome's local-network permission prompt can block it).

## Export
**Export** on the tour page checks the saved tour and downloads a zip:

| In the zip | |
| --- | --- |
| `tourd/TourPlayer.js`, `tourd/tour.json`, `tourd/tour.schema.json` | copy the `tourd/` folder into your app (next to `manifest.json`) |
| `snippets/` | the few lines that connect the player to the app: the `resourceRoots` entry for the manifest, a "Start tour" button for a view, its controller handler, an optional auto-start-once handler, and the missing `i18n` keys if the tour uses `{i18n>...}` texts the app does not have |
| `README.md` | the same steps with the names of your app (start view, controller, namespace) |

The export is **refused** while the tour has problems that would show to users: it is not valid, a step points at a control that does not exist in the uploaded files, or a step is still marked "needs a control". The dialog lists them and jumps to the step. "Download anyway" exports it with a `PROBLEMS.txt` in the zip and a notice in the README. Over HTTP: `GET /export/<tourId>.zip` (409 with the problems, `?force=1` to override) and `GET /export/<tourId>/check.json`. To change the tour later, export again and replace only `tourd/tour.json`.

## Security and privacy
- TourD is a **local, single-user** tool without a login. It answers only for `localhost`, `127.0.0.1` and `[::1]` and refuses requests that change data unless they come from its own pages (`TOURD_ALLOWED_HOSTS` changes the first rule; only do that behind your own authentication).
- API keys are read from the server's environment. They are never stored, returned by the API, logged, or shown in error messages (`scrub`).
- Source files go to an AI provider only when you pick one, with comments and secret-looking values removed first (`TOURD_REDACT=0` turns that off; the generate dialog says which applies). `TOURD_DISABLE_AI=1` removes all AI; the rule-based generator needs no key.
- Tour texts are rendered as a small Markdown subset, never as HTML. The sandbox frame cannot reach TourD, its cookies or storage; uploaded controller code does not run unless you ask for it.
- Uploads are limited in count and size, paths are normalised, zips are checked for size and path traversal.

## Known limitations
- Freestyle UI5 apps only (Fiori elements and `fe::` ids are not supported).
- A tour step is `navigate` + "wait for the control"; it does not press or type for the user.
- The sandbox is a rebuilt copy of the app with sample data; it is not the app. Use **Live** to see a tour in the real one.
- Controls in tables and other bound lists have no stable ids; point the step at the list or use a text fallback.
- No login and no multi-user editing: one person, one machine (a second browser tab is detected and never overwrites newer work).
- The Chrome DevTools Recorder and UI5 Test Recorder adapters are tested with exports that follow the documented formats; if a real export from your version does not import, please report it with the file.

## Backlog (ideas for later)
Fiori elements (V2/V4) support · steps that act for the user (press, type) · tour analytics (who finished) · XSUAA/multi-user and access control · HANA deployment · a recorder bookmarklet that works without DevTools · translations of tours.
