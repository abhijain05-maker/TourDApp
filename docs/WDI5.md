# wdi5 tests from a recording

TourD turns a recording into [wdi5](https://ui5-community.github.io/wdi5/) tests (WebdriverIO 9, JavaScript) and puts
the files into your project. The same recording can also become a tour.

## The flow

1. Upload the app (**Workspace**) and import a recording (**Recordings**). The recording made with the TourD browser
   extension is the best source: it knows each control's id, view and controller. DevTools Recorder and UI5 Test
   Recorder exports work too; TourD finds the controls in your files.
2. **Tests > New tests from a recording.** Choose the test framework (Mocha is wdi5's default, Jasmine works too)
   and the login of the app.
3. The **plan** is a table: one row per step (press, type, search, choose, check). Rename steps, switch them off, change
   what is typed, change the control a step uses, add checks, reorder. **Save** (Ctrl+S).
4. **Add to project** shows every file as a diff. Untick what you do not want, then add. The files are ordinary
   changes of the workspace: edit them further in the editor, then download the changes (zip or patch).

## What is generated

Next to your app folder (the parent of `webapp/`):

| File | What it is |
| --- | --- |
| `wdio.conf.js` | WebdriverIO and wdi5 configuration: `ui5` service, framework, address (`BASE_URL` overrides it), login |
| `package.json` | scripts `wdi5` and `wdi5:headless`, and the dev dependencies (added to yours, nothing is overwritten) |
| `.env.example` | what belongs in `.env`: address, `wdi5_username`, `wdi5_password` |
| `test/e2e/helpers/ui5.js` | small helpers (`typeInto`, `choose`); written once, then yours |
| `test/e2e/journeys/<name>.journey.js` | how each control is found, and one function per step |
| `test/e2e/specs/<name>.test.js` | the test: calls the steps and checks the result |
| `test/e2e/README.md` | how to run it |

Run: `npm install`, then `npm run wdi5` (or `npm run wdi5:headless`). Needs Node 20+ and Chrome.
`wdio-ui5-service` 3 needs WebdriverIO **9**; the generated `package.json` pins that.

## How controls are found

Best first: by **id** inside its view (`{ id, viewName }`), by **i18n key**, by **text**, by **label**
(`labelFor`), by **binding path**. A control without an id is found by its text, which breaks when the text changes:
give it an `id` in the view. The plan lists the other ways for every control; pick one in "How each control is found".

## Checks

A recording knows what was done, not what was expected. TourD adds the checks it can see (marked "added by TourD"):
the address after a press that navigated, the value typed into an input, the key chosen in a select. They are a
starting point: remove what is noise, add what matters (the table's **+** adds a check after a step).

## Trying a plan before running it

- **Checked against your files:** the plan page tells, for every control, whether it is in the app (found, not in the app, several match, or
  only known when the app runs). A selector that no longer fits shows up here before anything is run.
- **The generated files** are shown as code on the plan page, with the commands to run them. They are only written into the project when you add them.
- **Replay in the open app:** the browser extension runs the steps in the app you have open and reports each step (see
  [EXTENSION.md](EXTENSION.md)). The checks you point at while recording ("Add a check") come along as checks.

## Login

| Setting | wdi5 `wdi5:authentication` |
| --- | --- |
| No login | nothing |
| Basic authentication | `provider: "BasicAuth"` |
| SAP BTP / Cloud Foundry (XSUAA, IAS) | `provider: "BTP"` |
| Own login form | `provider: "custom"` with the CSS selectors you give |

User name and password are never written into a file: wdi5 reads `wdi5_username` and `wdi5_password` from the
environment (a `.env` file works; keep it out of version control).

## If the project already has wdi5

TourD reads the project (never runs it): its `wdio.conf.js`, its specs, and the helpers and page objects that drive controls
(which control each function uses and what it does with it). Then:

- **Where:** the new spec goes next to your specs, named like them (`.spec.js` or `.test.js`), the journey in a `journeys`
  folder beside them. The test framework (Mocha or Jasmine) and the module style (CommonJS or ES modules) are the ones the
  config and your files use, and the code is written the way yours is (tabs or spaces, quotes, semicolons).
- **Reuse:** a step that presses a control or types into one that a function of yours already handles calls that function
  (`await mainPage.startNewOrder()`); a selector you already define is used instead of a copy (`createBtn: mainPage.createButton`);
  a login helper and a start helper are called before the first step. The plan marks each such step ("uses searchFor() of
  your project") and **Do not use it** switches that off for the step. Only functions that do exactly one thing to one
  control are used; a search is only reused when your function also presses Enter.
- **Config:** `wdio.conf.js` is changed only as far as the new spec needs: the spec is added to `specs` when no glob reaches it, and the
  `ui5` service when it is missing. It is shown as a diff like every other file. A config TourD cannot read or a list it
  cannot extend is left alone and the dialog says what to add.
- **Everything else:** `package.json` only gets the dev dependencies that are missing; your helpers are not touched;
  if you have none for typing into a field or choosing in a select, a small `helpers/ui5.js` is added.
- Limits: page-object classes are used through the instance or the static methods the file exports (`module.exports = new Page()`,
  `export const page = new Page()`, `export default`); TypeScript tests are not rewritten (TourD writes JavaScript next to them).

## Troubleshooting

- *"This version of ChromeDriver only supports Chrome version N"*: set `BROWSER_VERSION=stable` in `.env`;
  WebdriverIO then downloads a matching Chrome.
- *"browser.asControl is not a function"*: the app was not reachable at the address, so wdi5 could not inject itself.
  Start the app and check `BASE_URL`.
- A step fails to find its control: open the plan, check the control's way of being found, or give the control an id.

## Verified how

`npm run test:wdi5` (opt-in, needs network and Chrome) generates the tests from the recorded demo flow, installs the real
packages, and runs them in Chrome against the demo app, once with Mocha and once with Jasmine (login type Basic set).
A third test adds the generated tests to a copy of a project that has wdi5 (`test/fixtures/wdi5-projects/cjs-pages`: page object, login helper, its own spec) and runs both specs. The unit tests check the generated code (it parses, runs against a fake `browser`, cannot be broken out of by a title).
