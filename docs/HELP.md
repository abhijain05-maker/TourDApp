# Help for your app

TourD can write the **context help** of an app, like the Help Topics panel of the SAP BTP cockpit: a help button opens a side panel that lists the topics of the screen the user is on. Every topic is bound to a control of the app. A **?** badge sits on that control, a line connects the topic in the list with its badge, and a popover shows the text, a note and related links. The panel can be searched.

There are three steps, and you do the first one in the running app, not in a file:

1. **Write it in the browser extension.** Point at a control, say what it is for, see the help in the app at once.
2. **Improve it with AI** (optional), in the extension or in TourD.
3. **Add it to your project.** TourD edits your files, and your users get the help without TourD or the extension.

## 1. Write help in the running app

Set up the extension once ([EXTENSION.md](EXTENSION.md)). Then:

1. Open your app in a tab and the extension's side panel. The project is chosen at the top (it is the one of the open app, if there is one). On the **Help** tab press **Start writing help**. The help panel of the app opens (empty at first); the app moves aside, so nothing is covered.
2. Press **Point at a control** and click the control in the app. Nothing is pressed. The panel asks for a title, a short description (shown in the list), the text, an optional note and related links (`Label | https://...`, one per line).
3. Type. The app shows your help as you write: the badge, the list entry and the popover, exactly as your users will see them. **Stop writing help** (next to **Point at a control**) ends it and takes the preview out of the app.
4. **Save to TourD.** Topics are kept in the project. To see all of them in the app as your users will, press **Show help in the app** (and **Hide** to take it away). Click a topic in the list to edit it, point at another control to move it, or delete it.

Text understands `**bold**`, `*italic*`, `` `code` ``, `- lists` and `[links](https://...)`. A text may also be `{i18n>key}`; the key is then added to your i18n file when the help is added to the project.

A control is found by its id in its view, then by its global id, then by its text. For a control with a generated id (`__button3`) TourD says so, because that id may change between runs and the text is then the only way back to the control. A topic appears on a screen when its control is there, so one help set serves all screens of the app.

## 2. Write and improve with AI

In the form, **Write with AI** writes a topic for the control you picked (from its type, label, text and tooltip), or improves what you wrote. Say what you want in the field above the button (*shorter*, *in German*, *mention the Sales role*). **Undo** brings your own text back.

- Providers are the ones of the generator: Gemini and SAP Generative AI Hub (see the README). **Simple draft (no AI)** needs no provider and writes a plain first version from the control type.
- The AI only writes words. Which control a topic belongs to is never part of its answer, so it cannot attach help to the wrong control. It is told not to invent facts (roles, limits, behaviour); read what it wrote before you save.
- In TourD, the **Help** tab of the project has the same for each topic (**Edit**, then **Improve with AI**), next to a preview of the text.

## 3. Add the help to your project

In TourD, open the project, **Help**, **Add the help to the project**. You see every file as a diff first and untick what you do not want; nothing is written until you press the button. It adds:

| File | What |
| --- | --- |
| `webapp/tourd/HelpLayer.js` | the help layer (panel, badges, popovers); a normal UI5 module |
| `webapp/tourd/TourPlayer.js` | the player; the help layer uses it to find controls and to render text |
| `webapp/tourd/help.json`, `help.schema.json` | the topics, and their schema for editors and CI |
| `webapp/manifest.json` | `resourceRoots.tourd = "./tourd/"` (the same entry tours use) |
| `webapp/Component.js` | a few lines in `init()` that start the layer |

The start goes into the **Component**, because every app has one, freestyle and Fiori elements alike (a Fiori elements app has no view of its own to put a button in). If the Component has no `init`, one is added that calls the parent's `init` first. The edits can be added again at any time and only change what is missing or new. The result is an ordinary change of the workspace: edit it further, **Accept** it, or download it (changes zip, patch, whole project).

What it does not do: it cannot patch a Component written in TypeScript or a project without `Component.js`; it then tells you the lines to add yourself. An app that loads its Component from elsewhere (a library) needs the same lines in that Component.

## What your users see

A round **?** at the top right of the app, like the help icon in a shell bar. It appears as soon as the help is in the app (and, while you write, in the running app) and **switches the help on and off**: pressed means the help is on. It opens the panel (about 20 rem wide), the app is laid out in the rest of the width, and the **?** moves to the left of the panel so it can be pressed again.

The **?** never lies over a button of your app: if something clickable is in its corner (a toolbar icon, a "Start tour" button), it moves left past it. If you would rather have it out of the header altogether, set `"buttonPosition": "bottom"` in the `options` of `tourd/help.json` (bottom right corner; default `"top"`). On a window narrower than 760 px the panel lies over the app instead. Escape closes the popover, then the panel. Hovering or focusing a topic outlines its control and draws the line to its badge. Searching also finds topics of other screens (they have no badge).

The layer needs UI5 1.108 or newer, like the player. Everything it shows comes from `help.json`; no request leaves the app.

## For developers

- Contract: `shared/help-schema.mjs` (Zod; `validateHelp`, `upsertTopic`). A topic's `target` is the same shape as a tour step's, so one resolver finds the control for both.
- Runtime: `player/HelpLayer.js` (`HelpLayer.start(helpOrUrl, { component })`, `update`, `openTopic`, `stop`).
- Server: entity `HelpSets`; actions `saveHelpTopic`, `deleteHelpTopic`, `saveHelpSet`, `improveHelpTopic`, `previewHelpApply`, `applyHelpToProject`; `GET /live/<id>/help.json` and `/live/help.js` for the extension's preview. A paired extension may call only the ones it needs (`srv/security.js`).
- Planner: `srv/lib/export/help-apply.js`. AI: `srv/lib/llm/help.js`.
