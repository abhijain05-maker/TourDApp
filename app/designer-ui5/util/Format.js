sap.ui.define([], function () {
	"use strict";

	const STATUS = {
		empty: { text: "No sources yet", state: "None" },
		ok: { text: "Ready", state: "Success" },
		warnings: { text: "Ready, with warnings", state: "Warning" }
	};

	const FORMAT = {
		"tourd-recorder": "QuickDev recorder",
		"devtools-recorder": "DevTools Recorder",
		"ui5-test-recorder": "UI5 Test Recorder",
		"plain-text": "Plain text"
	};

	const PURPOSE = { tour: "Tour", test: "Tests", both: "Tour and tests" };

	return {
		date(iso) {
			return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
		},
		/** "5 minutes ago", "yesterday", "3 days ago": how long ago, in the language of the browser */
		ago(iso) {
			if (!iso) return "";
			const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
			const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
			const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
			for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
			return rtf.format(0, "second");
		},
		statusText: (s) => (STATUS[s] || STATUS.empty).text,
		statusState: (s) => (STATUS[s] || STATUS.empty).state,
		initial: (s) => (s || "").trim().charAt(0).toUpperCase() || "?",
		orDash: (s) => s || "–",
		formatLabel: (f) => FORMAT[f] || f,
		purposeLabel: (p) => PURPOSE[p] || PURPOSE.both,
		/** recordings from before the label existed count as both */
		purposeOf: (r) => (r && (r.purpose === "tour" || r.purpose === "test") ? r.purpose : "both"),
		/**
		 * The recordings that fit what is being made (a tour or tests). Recordings made for the other purpose are left out
		 * unless asked for; when none fits, all are shown so the list is never empty by surprise.
		 */
		recordingsFor(all, purpose, showAll) {
			const of = (r) => (r && (r.purpose === "tour" || r.purpose === "test") ? r.purpose : "both");
			const fits = all.filter((r) => of(r) === "both" || of(r) === purpose);
			const shown = showAll || !fits.length ? all : fits;
			return { shown, hidden: all.length - shown.length, noneFit: !fits.length && all.length > 0 };
		},
		FRAMEWORK_LABEL: { mocha: "Mocha", jasmine: "Jasmine" },
		AUTH_LABEL: { none: "No login", basic: "Basic authentication", btp: "SAP BTP / Cloud Foundry login", custom: "Own login form" },
		GENERATOR_STATE: { rules: "None", gemini: "Success", "sap-ai-core": "Information", manual: "None" },
		PURPOSE,
		FORMAT
	};
});
