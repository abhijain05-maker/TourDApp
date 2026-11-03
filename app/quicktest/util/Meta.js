sap.ui.define([], function () {
	"use strict";

	// The vocabulary (priorities, kinds, statuses, results) comes from the server (qtestMeta()): a new entry there
	// shows up in every list, filter and chip without a change here. FALLBACK keeps the screens usable if it cannot be read.
	const FALLBACK = {
		priorities: [{ id: "critical", label: "Critical", state: "Error" }, { id: "high", label: "High", state: "Warning" }, { id: "medium", label: "Medium", state: "None" }, { id: "low", label: "Low", state: "Information" }],
		requirementKinds: [{ id: "functional", label: "Functional", state: "None" }],
		requirementStatuses: [{ id: "draft", label: "Draft", state: "None" }],
		caseKinds: [{ id: "functional", label: "Functional", state: "None" }],
		caseStatuses: [{ id: "draft", label: "Draft", state: "None" }],
		automation: [{ id: "manual", label: "Manual", state: "None" }],
		results: [{ id: "notrun", label: "Not run", state: "None" }, { id: "passed", label: "Passed", state: "Success" }, { id: "failed", label: "Failed", state: "Error" }, { id: "blocked", label: "Blocked", state: "Warning" }, { id: "skipped", label: "Skipped", state: "Information" }],
		limits: { steps: 200 }
	};

	let data = FALLBACK;

	const rows = (kind) => data[kind] || FALLBACK[kind] || [];
	const find = (kind, id) => rows(kind).find((r) => r.id === id);

	/** What a derived requirement status (see srv/lib/qtest/metrics.js) looks like. */
	const VERIFICATION = {
		uncovered: { label: "No test", state: "Error", icon: "sap-icon://alert" },
		untested: { label: "Not run", state: "None", icon: "sap-icon://pending" },
		partial: { label: "Partly passed", state: "Warning", icon: "sap-icon://status-in-process" },
		passing: { label: "Passing", state: "Success", icon: "sap-icon://status-positive" },
		failing: { label: "Failing", state: "Error", icon: "sap-icon://status-negative" }
	};

	const RESULT_ICON = { notrun: "sap-icon://circle-task", passed: "sap-icon://sys-enter-2", failed: "sap-icon://error", blocked: "sap-icon://status-error", skipped: "sap-icon://journey-arrive" };

	return {
		async load(api) {
			try {
				data = Object.assign({}, FALLBACK, await api.meta());
			} catch (e) {
				data = FALLBACK;
			}
			return data;
		},
		items: rows,
		label: (kind, id) => (find(kind, id) || { label: id || "" }).label,
		state: (kind, id) => (find(kind, id) || { state: "None" }).state,
		verification: (id) => VERIFICATION[id] || VERIFICATION.untested,
		VERIFICATION,
		resultIcon: (id) => RESULT_ICON[id] || RESULT_ICON.notrun,
		limits: () => data.limits || FALLBACK.limits
	};
});
