# Troubleshooting

## A step shows in the middle of the screen instead of next to its control

The player could not find the control. It looks, in this order: the id inside the view (`viewName` + `controlId`), the
global id, the id as a suffix (`--controlId`), a CSS selector fallback, a text fallback; and it waits up to
`waitTimeoutMs` (5 s by default) for views that render late.

- The control has no id in the view, or the id changed. Fix the target in TourD and export again.
- The control is only on screen after something happened (a dialog, a tab, a page). Add **Open another page before showing this step**
  for pages, and let the previous step lead the user to the dialog.
- The control lives in a table row or other bound list. Row controls get a new id per row and per run. Point the
  step at the table (which has an id), or use a text fallback.

## "Controls without a stable id"

UI5 generates ids like `__button3` for controls without an `id`. They change when the page is built in a different
order, so a tour cannot rely on them. Give the controls you want to explain an id:

```xml
<Button id="createBtn" text="Create" press=".onCreate" />
```

TourD lists them in the **Workspace** tab ("N without a stable id") and in the editor's **Checks**. A control without an id can still be
found by its text if the step has a *text* fallback; that breaks when the text is translated or changes.

## The tour does not start in my app

1. `resourceRoots` is missing or points to the wrong folder: the browser console says `failed to load JavaScript resource: tourd/TourPlayer.js`.
   The entry must be `"tourd": "./tourd/"` under `"sap.ui5"` in `manifest.json`, and the folder `tourd/` must sit next to it.
2. The button handler is not in the controller of the view that has the button.
3. UI5 older than 1.108 is not supported.
4. A Content-Security-Policy that forbids `style-src` inline styles blocks the one `<style>` element the player adds.

## The sandbox preview

- *"UI5 … could not be loaded from ui5.sap.com"*: the browser cannot reach the UI5 CDN (offline, proxy). Reload when it can.
- *"The app could not be started"*: UI5 could not load a file of your app. The message names it. Typical causes: a
  custom control from a library that is not on the CDN, a view that is not valid XML (TourD lists these in the **Workspace** tab), or the
  uploaded files are not the whole app.
- Lists show invented rows and buttons do nothing on purpose. Tick **Run the app's own controllers** to run your code
  (it still has no back end).
- No sandbox button, or "needs the manifest.json": upload the app's `manifest.json` with the other files.

## Live (console snippet)

- *"This page does not look like a UI5 app"*: run it in the tab of your running app, not in another tab or in the designer.
- The **loader** snippet is blocked by the page's Content-Security-Policy, by mixed content (https page, http TourD) or by
  the browser's local-network permission. Use the self-contained snippet instead; it needs no network.

## Export is refused

The export lists what is wrong: a control that does not exist in your files, a step still marked "needs a control", or a
tour that is not valid. Click a problem to jump to its step. **Download anyway** exports with a `PROBLEMS.txt` for the
cases where you know better.

## The designer says "TourD only answers requests for localhost"

TourD has no login, so it answers only for `localhost`, `127.0.0.1` and `[::1]`. To reach it by another name, for
example on a server behind your own login, start it with `TOURD_ALLOWED_HOSTS=name1,name2` (`*` allows every name; only do this
behind authentication).

## AI generation fails

- *"rejected the API key"* / *"rejected the credentials"*: check `GEMINI_API_KEY`, or `AICORE_SERVICE_KEY` / the service binding.
- *"no deployment for this model"* (SAP): `AICORE_MODEL` must be a model deployed in your resource group (`AICORE_RESOURCE_GROUP`).
- *"rate limit or quota"*: try again later; TourD retries transient errors itself.
- Without any key the **Rule-based** generator still works.

## Data

Everything is in `db.sqlite` in the project folder. `TOURD_DB_RESET=1 npm run dev` starts with an empty database (the old
file is kept as `db.sqlite.<timestamp>.bak`).
