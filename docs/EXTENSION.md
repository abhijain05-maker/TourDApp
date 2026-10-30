# TourD Recorder (browser extension)

The extension records what you do in a running SAPUI5 / Fiori app **as UI5 sees it**: the exact control (id, type, text, label, i18n key), the view and controller it belongs to, the route, and the value you chose. DevTools Recorder can only see the HTML; this sees the controls, so TourD matches every step with certainty and your tours and tests start with fewer guesses.

Works in Chrome and Edge (Chromium 116 or newer).

## Install

1. In the TourD folder run `npm run build:extension` (or `npm run package:extension` to get `extension-dist/tourd-recorder-<version>.zip` that you can hand to colleagues).
2. Open `chrome://extensions` (or `edge://extensions`), switch on **Developer mode**, choose **Load unpacked** and select the `extension/` folder (or the unzipped zip).
3. Pin the extension; clicking its icon opens the side panel.

For many users: a company can distribute the same folder or zip through its browser management policy (ExtensionInstallForcelist / "load from a folder or CRX"); the extension needs no store.

## Pair it with TourD (once)

TourD has no login, so the extension proves itself with a token.

1. In TourD click **Browser extension** (bottom of the left sidebar, or Ctrl+K and type "extension"), give this browser a name, **Create token** and copy it. It is shown once; TourD keeps only a hash.
2. In the extension open the settings (gear), enter the address of TourD (default `http://localhost:4044`) and paste the token, **Save and connect**.

UI5 itself is asked for a selector of every control (the one its Test Recorder would write); it is stored in the recording and used by the wdi5 tests for controls without an id.

A token lets the extension do a few things only: list projects, tours, tests and help, send a recording, add or delete help topics (and ask for AI help on them), fetch a tour or the help to play, fetch the player. It cannot read your files, change or delete anything else. **Revoke** a token in the same dialog.

## Record

1. Open your app in a tab and click the extension. Press **Start recording**.
2. Use the app the way a new user should learn it. Every press, entry, choice, search, toggle and page change is added to the list (remove a step with the cross, add a note with the field below).
3. **Stop**. Pick the TourD project, **Send to TourD**. The recording appears in the project's Recordings; generate a tour from it as usual. Or **Save file** / **Copy** and import it by hand.

**Add a check** (while recording): press it, then click a control in the app. Nothing is clicked; the recording gets a *check* of what that control shows now (the text in an input, the text of a label or button, or only that it is there). TourD turns it into a check in the wdi5 tests; tours ignore it. Escape gives up. A password or secret-looking field is checked for being there only, never for its value.

What is not recorded: passwords and fields that look like secrets (their step says "value left out"), scrolling, hovering, mouse movements. A click on something that fires no UI5 event is not a step.

Works with: apps in the Fiori launchpad (frames of other origins are recorded too, including frames that open while you record), page reloads while recording, pause/resume.

## Play a tour in your app

In the same panel: choose project and tour, **Play**. The tour runs in the open app with its real data, which is the best check of whether every step finds its control. **Stop tour** ends it.

## Replay wdi5 tests in your app

Also in the panel: choose the project and a test plan (made in TourD under **Tests**), **Replay**. The steps run in the open app, each control is outlined before it is used, and the panel lists every step as passed or failed (a failed step says why; the steps after it are not run). It uses UI5's own record/replay API, the one wdi5 is built on, so a selector means the same here as in the generated test. Replay is a quick way to see that a plan fits the running app; the generated tests are run by you or your pipeline.

## Write help for your app

Also in the panel: choose the project, **Start writing help**, **Point at a control**, click the control in the app, write the text. The app shows the help panel with a **?** badge on the control and the popover while you type, so you see what your users will see. **Write with AI** drafts or improves the text. **Save to TourD** keeps the topic in the project; from there TourD adds the help to your app's files. Pointing does not need a recording and presses nothing. Details: [HELP.md](HELP.md).

In a Fiori launchpad the preview is shown in the frame in which you pointed at a control. A page reload while you write brings the picker and the preview back.

## What the extension is allowed to do

- It runs only in tabs where you press Start, Play or Start writing help. It injects the recorder (for recording, and for pointing at controls) into the page and its frames, and reads nothing else.
- A token lets it add, change and delete help topics of a project and ask for AI help on a topic, nothing else beyond what it needed before.
- The permission "all sites" is needed so it can inject into whatever UI5 app you open (and its frames); it does not read pages you do not record.
- Recording data stays in the browser until you send it to the TourD address you entered.

## Troubleshooting

- **"This page does not use UI5"**: the tab has no SAPUI5 (or it is still loading). In the Fiori launchpad start the recording once the app is open.
- **"not paired" / "revoked"**: create a new token in TourD and paste it again.
- **"TourD does not answer"**: check the address and that TourD is running; behind your own login the address must be one TourD allows (`TOURD_ALLOWED_HOSTS`).
- Steps missing after a click: that control fires no UI5 event (a custom control or a plain HTML element). Add a note step or use a control with a `press`.

## Without the extension

If you cannot install it: in TourD open **Browser extension** and press **Copy console snippet**, paste it into the console (F12) of your running app, use the app, then run `__tourdRecorder.stop(); __tourdRecorder.download()` and import the saved file under Recordings. It is the same recorder; you only lose the panel, the pause button, recording across page reloads and across frames, and playing tours.
