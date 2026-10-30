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

A token lets the extension do a few things only: list projects, tours, tests and help, send a recording, ask what a recording would become (nothing is saved), add or delete help topics (and ask for AI help on them), fetch a tour or the help to play, fetch the player. It cannot read your files, change or delete anything else. **Revoke** a token in the same dialog.

## The panel: choose the project once

The top of the panel always shows the **project**. Choose it once; everything below is done for that project: recordings are sent to it, and its tours, tests and help are the ones you play, replay and write. When a project belongs to the app that is open (its app id is the same), the panel chooses it for you and says so; a project you pick yourself stays picked. A project made in TourD while the panel is open shows up when you come back to the panel.

Below the project are three tabs, in the order of how often they are used: **Tests**, **Help** and **Tour**. Tests are what you come back to every time the app changes; help and tour are mostly written once. A small red dot on a tab means that its job is running (recording, a replay, a tour playing, help shown or being written), so you see it from any tab. The panel opens on the tab you used last (the first time: Tests).

A button that stops something is there only while there is something to stop: **Stop** while recording, **Stop tour** while a tour plays, **Stop** of a replay while it runs, **Hide** while the saved help is shown, **Stop writing help** while you write help.

## Recording: in the Tests tab or in the Tour tab

Recording is the same recorder in both tabs, and both send to the same place, the project's Recordings. The tab only decides what the panel offers while you record, and what the recording is *for* (the label TourD shows: **Tour**, **Tests** or **Tour and tests**).

1. Open your app in a tab and click the extension. Choose the tab: **Tests** to record a test, **Tour** to record a tour. Press **Start recording**.
2. Use the app the way a new user should learn it. Every press, entry, choice, search, toggle and page change is added to the list (remove a step with the cross).
3. **Stop**, then **Send to TourD** (it goes to the project at the top). The recording appears in the project's Recordings with its label. Or **Save file** / **Copy** and import it by hand (the file says what it is for).

Only one recording runs per app tab. The other recording tab then says where it is ("A recording is running in the Tests tab") with a button to go there; a stopped recording that was not sent can be discarded to record the other kind.

**In the Tests tab: Add a check** (while recording): press it, then click a control in the app. Nothing is clicked; the recording gets a *check* of what that control shows now (the text in an input, the text of a label or button, or only that it is there). TourD turns it into a check in the wdi5 tests; tours ignore it. Escape gives up. A password or secret-looking field is checked for being there only, never for its value.

**In the Tests tab: Add a message check.** A message toast ("Order saved") is not a control: it has no id and is gone after about three seconds, so it cannot be pointed at. Press **Add a message check**, then do what shows the message in the app (for example press Save): the next message toast the app shows becomes a check with its text, placed right after the step that showed it. It is armed for one toast (or two minutes); **Stop** cancels it. The generated test waits for it (`await expect($('.sapMMessageToast')).toHaveText(...)`, which retries until WebdriverIO's `waitforTimeout`, 10 s); a try or replay in the extension notes the toasts the page shows while it runs, so it does not depend on catching the toast on screen. It works for `sap.m.MessageToast` (also the one Fiori elements uses); a message in a dialog (`MessageBox`) is a control and can be checked with **Add a check**.

**In the Tour tab: say what each step is for.** Under every step there is a field. What you write there becomes the text of that tour step, as you wrote it (with AI, the model only fixes spelling and makes it short and clear; it keeps your meaning). Steps without words get the text TourD makes from the control. **Add step** adds an introduction step without a control (a welcome, a remark) at the place where you are; a tour that starts with one does not get a second, generated welcome. Tests ignore all of this.

In TourD, generating a tour offers the recordings made for tours (and for both), and making tests offers those made for tests (and for both). "Show all recordings" is always there, so a recording made for the other purpose can still be used. The label can be changed in the Recordings list.

**Try it before you send it.** After **Stop**, the card "Try it before you send it" lets you see what TourD would make of the recording, without saving anything. In the Tests tab, **Try it in the app** opens the app again where the recording started, runs the steps as the generated test will (the same plan builder as the real import), and lists every step as passed or failed. In the Tour tab, **Preview the tour** plays the tour TourD would make from the recording, with your words. If something is wrong, **Record again** (it also opens the app at the start again) or take out the step that fails; send it when you are happy. Careful: a try really does what you did, so an order is created again.

What is not recorded: passwords and fields that look like secrets (their step says "value left out"), scrolling, hovering, mouse movements. A click on something that fires no UI5 event is not a step.

Works with: apps in the Fiori launchpad (frames of other origins are recorded too, including frames that open while you record), page reloads while recording, pause/resume.

## Play a tour in your app (tab Tour)

Choose the tour of the project, **Play**. The tour runs in the open app with its real data, which is the best check of whether every step finds its control. **Stop tour** ends it.

## Replay wdi5 tests in your app (tab Tests)

Choose a test plan of the project (made in TourD under **Tests**), **Replay**. The steps run in the open app, each control is outlined before it is used, and the panel lists every step as passed or failed (a failed step says why; the steps after it are not run). It uses UI5's own record/replay API, the one wdi5 is built on, so a selector means the same here as in the generated test. Replay is a quick way to see that a plan fits the running app; the generated tests are run by you or your pipeline.

## Help for your app (tab Help)

**Show help in the app** shows the help that is saved in the project, as your users will see it; **Hide** takes it away again. To write help: **Start writing help**, **Point at a control**, click the control in the app, write the text. The app shows the help panel with a **?** badge on the control and the popover while you type, so you see what your users will see. **Write with AI** drafts or improves the text. **Save to TourD** keeps the topic in the project; from there TourD adds the help to your app's files. Pointing does not need a recording and presses nothing. Details: [HELP.md](HELP.md).

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
