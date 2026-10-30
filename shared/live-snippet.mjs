// Builds the code a user runs inside their own, already running UI5 app to see a tour there ("Live" preview).
// Shared by the designer (builds the snippet from the working copy) and the server (/live/player.js).

const NAME = 'tourd/live/TourPlayer'

/** JSON that is safe inside any JavaScript: no "<" (script-end) and escaped line/paragraph separators. */
export function jsonForScript(value) {
  const bs = String.fromCharCode(92)
  return JSON.stringify(value)
    .split('<')
    .join(bs + 'u003c')
    .split(String.fromCharCode(0x2028))
    .join(bs + 'u2028')
    .split(String.fromCharCode(0x2029))
    .join(bs + 'u2029')
}

/**
 * The player module registered under an explicit name, so it can be loaded from a plain <script>
 * or the console. (`sap.ui.define(` -> `sap.ui.predefine("name", `)
 */
export function playerAsPredefine(source) {
  return asPredefine(source, NAME, 'TourPlayer.js')
}

const HELP_NAME = 'tourd/live/HelpLayer'

/** The help layer registered as tourd/live/HelpLayer (it loads ./TourPlayer, so the player is predefined next to it). */
export function helpAsPredefine(source) {
  return asPredefine(source, HELP_NAME, 'HelpLayer.js')
}

function asPredefine(source, name, file) {
  const at = source.indexOf('sap.ui.define(')
  if (at < 0) throw new Error(`${file} does not start with sap.ui.define(...)`)
  return (
    source.slice(0, at) +
    `sap.ui.predefine(${JSON.stringify(name)}, ` +
    source.slice(at + 'sap.ui.define('.length)
  )
}

const GUARD = `if (!window.sap || !window.sap.ui || !sap.ui.require || !sap.ui.predefine) {
		alert("This page does not look like a UI5 app (sap.ui is missing). Open your app first, then run the tour.");
		return;
	}`

/** Everything inlined: works without any network access from the app. Paste into the browser console. */
export function buildInlineSnippet({ playerSource, tour }) {
  return `/* TourD - preview this tour in the running app. Paste into the browser console (F12) of your app. */
(function () {
	"use strict";
	${GUARD}
	var TOUR = ${jsonForScript(tour)};
${playerAsPredefine(playerSource)}
	sap.ui.require([${JSON.stringify(NAME)}], function (TourPlayer) {
		TourPlayer.start(TOUR, { debug: true });
	});
})();
`
}

/**
 * Small snippet that loads player and the saved tour from the TourD server.
 * Needs the app to be allowed to load scripts from / fetch from that server (CSP, mixed content,
 * and Chrome's local-network prompt apply) - the inline snippet has none of these limits.
 */
export function buildLoaderSnippet({ origin, tourId, token = '' }) {
  return `/* TourD - loads the saved tour from ${origin}. Paste into the browser console (F12) of your app. */
(function () {
	"use strict";
	${GUARD}
	var BASE = ${JSON.stringify(origin)};
	function run() {
		sap.ui.require([${JSON.stringify(NAME)}], function (TourPlayer) {
			fetch(BASE + "/live/" + ${JSON.stringify(tourId)} + "/tour.json"${token ? ` + ${JSON.stringify('?t=' + token)}` : ''})
				.then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
				.then(function (tour) { TourPlayer.start(tour, { debug: true }); })
				.catch(function (e) { alert("TourD: could not load the tour (" + e.message + ")"); });
		});
	}
	var s = document.createElement("script");
	s.src = BASE + "/live/player.js";
	s.onload = run;
	s.onerror = function () { alert("TourD: could not load the player from " + BASE + " (blocked by the page's security policy?)"); };
	document.head.appendChild(s);
})();
`
}

/**
 * The recorder as a console snippet, for people who cannot install the extension: paste it into the console of the
 * running app, do the flow, then run __tourdRecorder.download() to save the recording.
 */
export function buildRecorderSnippet({ recorderSource }) {
  return `/* TourD recorder - paste into the browser console (F12) of your running UI5 app. */
(function () {
	"use strict";
${recorderSource}
	var recorder = window.__tourdRecorder;
	recorder.start({ bridge: false });
	console.log("TourD recorder is recording. Use the app now. When you are done run:  __tourdRecorder.stop();  __tourdRecorder.download();");
})();
`
}

/** A javascript: URL for a bookmark. */
export function toBookmarklet(snippet) {
  return 'javascript:' + encodeURIComponent(snippet)
}
