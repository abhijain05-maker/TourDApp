# QuickTest: test management for SAPUI5 and CAP apps

QuickTest is a fourth app of QuickDev, for testing only: **requirements, manual test cases, the links between them, test runs, and wdi5 automation**, with AI where it helps and a fully manual way for everything. Open `http://localhost:4044/quicktest/index.html` (SAPUI5, no build step, UI5 from `ui5.sap.com` like the SAPUI5 designer, so it needs internet).

It shares with the other QuickDev apps (and changes nothing of them): the **project** (the app under test and its uploaded files), the **recordings** of the unchanged browser extension, and the **wdi5 plan** (`TestPlans`) behind an automated test case. Everything else is its own: tables `qtest.*` (`db/qtest.cds`), the OData service `/odata/v4/qtest` (`srv/qtest-service.*`, libraries in `srv/lib/qtest/`), downloads under `/qtest/` (`srv/qtest-routes.js`).

## A first round in ten minutes

1. **Projects.** Create a project (or open one you have in QuickDev). *Setup* tab: upload the app folder or zip, so tests can find the controls of the app.
2. **Requirements.** *Requirements* tab: write them by hand, upload a sheet (*Upload*), or press *Requirements from a text*: paste a specification or user stories, review the draft, save the ticked ones.
3. **Test cases.** *Test cases* tab: *New test case* (a table of steps: action, test data, expected result), or *AI > Test cases for requirements*, or record a flow (step 5). Link each case to the requirements it verifies (case page > *Requirements*, requirement page > *Verified by*, or click a cell of the *Traceability* matrix).
4. **Run.** *Runs* tab > *New run*. In the run, choose a test case, give each step a result, press *Passed / Failed / Blocked / Skipped* (keys P F B S, J next, K previous). Close the run and download the report (HTML to mail or print, Excel, JUnit).
5. **Automate.** Install the QuickDev recorder (the *Recorder* button pairs it with a token), record the flow in your running app, then *Automation* tab > *Create test case* on the recording: you get the manual steps **and** the wdi5 test, each manual step mapped to the code that does it. Or write the case by hand and press *Automate > Build wdi5 test from the steps* (rules, or the AI of the header), or *attach a recording*.
6. **Run the wdi5 tests**, upload their result file (*Runs > Upload automated results*): tests are matched to cases by the code in their name (`TC-012 Create an order`; the generated tests are named so), the results land in a run next to the manual ones.

## What is in it

| Tab / page | What you do |
| --- | --- |
| **Dashboard** | coverage of the requirements, how many are verified by passing tests, automation share, last run, trend of the last runs, gaps (no test, failing, no requirement), the next useful step |
| **Requirements** | search and filter, bulk change, AI drafts, upload; a requirement has acceptance criteria (one per line), priority, type, status, tags, source, owner |
| **Test cases** | the same for test cases; automation state, mapped steps, last result; *Add to a run*, *Automate*, download wdi5 |
| **Test case page** | steps editor (add, insert, move, paste a list), details, requirements, automation (plan, settings, dry run against the app, generated code, add to project files), version history with restore, *Improve with AI* |
| **Requirement page** | edit, linked test cases, *Test cases with AI*, *Improve with AI* |
| **Traceability** | requirements x test cases; a dot is a link, coloured by the newest result; click to link / unlink; rows without a test are marked |
| **Runs / run page** | rounds of testing, step results, defect reference, report downloads, results of automated runs |
| **Automation** | how it works, recordings (and *Upload a recording*: DevTools Recorder or UI5 Test Recorder export), automated cases |
| **Setup** | upload the app, the AI providers, pairing the recorder |

`Ctrl+K` jumps to anything. Light and dark follow the QuickDev setting.

## AI, and what happens without it

Every provider is listed in the header; one that is not set up is greyed out. The **Setup** tab shows the state of each and has a **Test connection** button (it asks the model for `{"ok": true}`, a few tokens) and the exact `.env` lines to set. SAP Generative AI Hub *is* the AI Core orchestration service (`@sap-ai-sdk/orchestration`): set `AICORE_SERVICE_KEY` (one line of JSON) **or** `AICORE_SERVICE_KEY_FILE` (path of the downloaded key file), `AICORE_MODEL` (a model deployed in your resource group) and, if needed, `AICORE_RESOURCE_GROUP`; restart the server.

The provider is chosen in the header: **No AI (rules)**, Google Gemini or SAP Generative AI Hub (the same providers and keys as the rest of QuickDev: `GEMINI_API_KEY`, `AICORE_SERVICE_KEY` in `.env`). The AI only **proposes**: you review a list, correct titles, tick what to keep, and only then is it saved. Nothing a model returns goes in unchecked: it is cleaned with the same rules as a manual save. Project texts are data in the prompts, not instructions.

| Action | With an AI | Without (rules) |
| --- | --- | --- |
| Requirements from a text | reads the text, merges, splits, writes acceptance criteria, priority, type | one requirement per paragraph or list item; "As a ... I want ... so that ..." and `must / should / could` understood |
| Test cases for requirements | writes cases per kind (functional, negative, boundary, security ...) using the names of the screens and the existing cases | skeletons from the acceptance criteria (`Given / When / Then` understood), plus a negative / boundary / security skeleton if asked |
| Improve a requirement or a case | rewrites it, you see before and after | needs an AI (said so) |
| Build wdi5 from the steps | picks the controls from the inventory of the app (by number, never invented) | finds controls by the names in quotes in the steps ("Click the "Create" button") |

Steps whose control cannot be found stay in the wdi5 plan **switched off with the reason**, a check that cannot be turned into an assertion stays a manual check: nothing is guessed silently.

## Upload and download

* **Download** (project page): test book as Excel (sheets Requirements, Test cases, Steps, Traceability), as JSON, test cases as CSV (one row per step), an empty Excel template that explains the columns, the wdi5 tests as a zip. A run: report as HTML, Excel, JUnit XML.
* **Upload**: `.xlsx`, `.csv`, `.tsv`, `.json`. Your own sheets work: headers are recognised by their usual names (`Test Case ID`, `Summary`, `Step`, `Expected Result`, `P1`, `Blocker` ...), and a sheet with one row per step is understood. An item with an ID that exists is updated, otherwise matched by title; new ones get the next ID. **You see what would change before anything is stored** (new / changed / unchanged, warnings), and links are only ever added.
* **Results of automated runs**: JUnit XML (also from wdio-junit-reporter), mocha json, mochawesome, wdio json.

## wdi5

The automation is the existing wdi5 plan of QuickDev (`shared/wdi5-plan.mjs`, rendered by `srv/lib/wdi5/`), so a tester can refine it in the SAPUI5 designer (`#/tests/<id>`, linked from the case page), and *Add to project files* uses the same review and workspace as there. `srv/lib/qtest/steps.js` is the bridge: plan to manual steps, manual steps to plan (the same `buildPlan` the recorder uses, from the controls of the inventory), and the alignment of hand-written steps with a recording.

## How the code is organised

```
db/qtest.cds                         Requirements, TestCases, CaseVersions, Coverage, Runs, RunItems
srv/qtest-service.cds / .js          the service (read-only entities, everything else through actions; functions return JSON)
srv/qtest-routes.js                  GET /qtest/...: test book, template, wdi5.zip, run reports
srv/lib/qtest/
  meta.js                            priorities, kinds, statuses, results: ONE list the server and the UI use (qtestMeta())
  validate.js codes.js               cleaning of input, REQ-001 / TC-001 codes
  metrics.js                         dashboard numbers, verification status of a requirement
  bundle.js xlsx.js csv.js           upload and download of the test book
  results.js                         JUnit / mocha / mochawesome / wdio results, matched by code
  steps.js ai.js                     manual steps <-> wdi5 plan; prompts, schemas and the rules fallbacks
  service/*.js                       handlers: items, import, runs, automation, ai, cleanup
app/quicktest/                       the SAPUI5 app: Component, util/ (Api, Meta, AiFlow, RecordFlow, RunFlow ...),
                                     view/ + controller/ (pages), view/tab/ + controller/tab/ (project tabs), fragment/
```

Add a new priority, kind, status or result: one entry in `srv/lib/qtest/meta.js`. Add a new upload format: a branch in `parseBook` (`bundle.js`). Add a column to the test book: one line in `REQUIREMENT_COLUMNS` / `CASE_COLUMNS`. Add a project tab: an entry in `TABS` of `app/quicktest/controller/Project.controller.js`, a filter in `Project.view.xml`, a view and a controller.

## Good to know

* QuickTest's tables hold no foreign key to the project; deleting a project in any QuickDev app removes them (`srv/lib/qtest/service/cleanup.js`, called by the tour service).
* The Setup tab reads a folder or zip with the intake rules of the SAPUI5 designer (`/designer-ui5/lib/codemirror.js`, loaded only when you upload), so both upload the same way.
* Roles (where a deployment enforces them): reading needs *Viewer*, everything that changes data *Editor*. A paired browser extension may still only send recordings.
* The server in development needs a restart once to create the new tables (`npm run dev` does it; data stays, a `.bak` copy is written).
* Tests: `test/unit/qtest-bundle.test.js`, `qtest-steps.test.js`, `qtest-ai.test.js`, `service-qtest.test.js`, `test/e2e/quicktest.spec.js` (needs a server; run it against a throwaway one, see `docs/TROUBLESHOOTING.md`).
* Not built (ideas): attachments / screenshots on run results, a defect tracker link, Word / PDF as an upload source, scheduled runs, sharing one test book between projects.
