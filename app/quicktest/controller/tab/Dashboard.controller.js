sap.ui.define(["quicktest/controller/BaseController", "quicktest/util/Format"], function (BaseController, Format) {
	"use strict";

	const RESULT_KEYS = ["passed", "failed", "blocked", "skipped", "notrun"];
	const VERIFY_KEYS = ["passing", "partial", "untested", "failing", "uncovered"];

	return BaseController.extend("quicktest.controller.tab.Dashboard", {
		onInit() {
			this.initViewModel({ tiles: {}, verification: [], results: [], recent: [], gaps: { uncovered: [], failing: [], untraced: [] }, next: {} });
			// the project page loads the numbers once; this tab draws them whenever they change
			this._binding = this.appModel().bindProperty("/dash");
			this._binding.attachChange(() => this._draw());
			this._projectId = (this.appModel().getProperty("/project") || {}).ID;
			this._draw();
		},

		onExit() {
			this._binding.destroy();
		},

		_draw() {
			const d = this.appModel().getProperty("/dash");
			this._projectId = (this.appModel().getProperty("/project") || {}).ID;
			if (!d) return;
			const t = this.text.bind(this);
			const r = d.requirements;
			const c = d.cases;
			const run = d.runs.last;
			const model = this.viewModel();
			model.setProperty("/tiles", {
				coverage: { value: r.coveragePct / 100, state: r.total ? Format.ringState(r.coveragePct) : "None", sub: t("dashCoverageSub", [r.covered, r.total]) },
				passing: { value: r.passingPct / 100, state: r.total ? Format.ringState(r.passingPct) : "None", sub: t("dashPassingSub", [r.verification.passing, r.total]) },
				automation: { value: c.automationPct / 100, sub: t("dashAutomationSub", [c.automation.automated, c.total]) },
				run: { value: run ? run.passRate / 100 : 0, state: run ? Format.ringState(run.passRate) : "None", sub: run ? run.name : t("dashNoRuns") }
			});
			model.setProperty("/verification", VERIFY_KEYS.map((k) => ({ value: r.verification[k], cls: "qtVer-" + k, label: t("verify_" + k) })));
			model.setProperty("/results", RESULT_KEYS.map((k) => ({ value: c.results[k], cls: "qtResult-" + k, label: Format.resultText(k) })));
			model.setProperty("/recent", d.runs.recent);
			const label = (x) => Object.assign({}, x, { label: x.code + "  " + x.title });
			model.setProperty("/gaps", { uncovered: d.gaps.uncovered.map(label), failing: d.gaps.failing.map(label), untraced: d.gaps.untraced.map(label) });
			model.setProperty("/next", this._next(d));
		},

		/** The one thing worth doing next, from the numbers. */
		_next(d) {
			const t = this.text.bind(this);
			const r = d.requirements;
			const c = d.cases;
			if (!r.total && !c.total) return { text: t("nextStart"), button: t("aiFromText"), tab: "requirements", intent: "ai" };
			if (r.total && !c.total) return { text: t("nextCases", [r.total]), button: t("aiTestsForGaps"), tab: "requirements", filter: "uncovered", intent: "tests" };
			if (r.verification.uncovered) return { text: t("nextUncovered", [r.verification.uncovered]), button: t("nextShow"), tab: "requirements", filter: "uncovered" };
			if (c.total && !d.runs.total) return { text: t("nextRun", [c.total]), button: t("newRun"), tab: "runs", intent: "new" };
			if (c.results.failed) return { text: t("nextFailing", [c.results.failed]), button: t("nextShow"), tab: "cases", filter: "failed" };
			if (c.withoutRequirement) return { text: t("nextUntraced", [c.withoutRequirement]), button: t("tabMatrix"), tab: "matrix" };
			return {};
		},

		_go(tab, filter, intent) {
			this.getRouter().navTo("project", { id: this._projectId, "?query": Object.assign({ tab }, filter ? { filter } : {}, intent ? { do: intent } : {}) });
		},

		onNext() {
			const n = this.viewModel().getProperty("/next");
			if (n.tab) this._go(n.tab, n.filter, n.intent);
		},

		onTile(tab, filter, intent) {
			this._go(tab, filter, intent);
		},

		onTrend(e) {
			this.getRouter().navTo("run", { id: this._projectId, runId: e.getParameter("run").ID });
		},

		onGapRequirement(e) {
			const g = e.getSource().getBindingContext("view").getObject();
			this.getRouter().navTo("requirement", { id: this._projectId, reqId: g.ID });
		},

		onGapCase(e) {
			const g = e.getSource().getBindingContext("view").getObject();
			this.getRouter().navTo("case", { id: this._projectId, caseId: g.ID });
		},

		onNewCase() {
			this.getRouter().navTo("case", { id: this._projectId, caseId: "new" });
		},

		onNewRequirement() {
			this.getRouter().navTo("requirement", { id: this._projectId, reqId: "new" });
		}
	});
});
