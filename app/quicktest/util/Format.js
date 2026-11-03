sap.ui.define(["quicktest/util/Meta"], function (Meta) {
	"use strict";

	// Formatters for the XML views (declare them with core:require="{Format: 'quicktest/util/Format'}").
	const F = {
		date(iso) {
			return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
		},
		/** "5 minutes ago", "yesterday": how long ago, in the language of the browser */
		ago(iso) {
			if (!iso) return "";
			const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
			const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
			const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
			for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
			return rtf.format(0, "second");
		},
		initial: (s) => (s || "").trim().charAt(0).toUpperCase() || "?",
		orDash: (s) => s || "–",

		priorityText: (id) => Meta.label("priorities", id),
		priorityState: (id) => Meta.state("priorities", id),
		reqStatusText: (id) => Meta.label("requirementStatuses", id),
		reqStatusState: (id) => Meta.state("requirementStatuses", id),
		reqKindText: (id) => Meta.label("requirementKinds", id),
		caseStatusText: (id) => Meta.label("caseStatuses", id),
		caseStatusState: (id) => Meta.state("caseStatuses", id),
		caseKindText: (id) => Meta.label("caseKinds", id),
		automationText: (id) => Meta.label("automation", id),
		automationState: (id) => Meta.state("automation", id),
		resultText: (id) => Meta.label("results", id || "notrun"),
		resultState: (id) => Meta.state("results", id || "notrun"),
		resultIcon: (id) => Meta.resultIcon(id || "notrun"),
		verifyText: (id) => Meta.verification(id).label,
		verifyState: (id) => Meta.verification(id).state,
		verifyIcon: (id) => Meta.verification(id).icon,

		/** Seconds as "1 min 5 s". */
		duration(s) {
			if (!s) return "";
			return s >= 60 ? Math.floor(s / 60) + " min " + (s % 60 ? (s % 60) + " s" : "") : s + " s";
		},
		/** A share 0..100 as a ring value 0..1 */
		ring: (pct) => (Number(pct) || 0) / 100,
		/** Ring state from a share: green from 80, orange from 50, red below. */
		ringState(pct, none) {
			if (none) return "None";
			return pct >= 80 ? "Success" : pct >= 50 ? "Warning" : "Error";
		},
		/** The text of a code list for a MultiComboBox / chips: "REQ-001, REQ-002" */
		codes: (list) => (list || []).join(", ")
	};
	return F;
});
