sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Format", "quicktest/util/Files", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, Files, JSONModel) {
		"use strict";

		const KEYS = ["passed", "failed", "blocked", "skipped", "notrun"];

		return BaseController.extend("quicktest.controller.tab.Runs", {
			onInit() {
				this.initViewModel({ runs: [], busy: false, error: "" });
				this._projectId = (this.appModel().getProperty("/project") || {}).ID;
				this._load();
				this.getBus().subscribe("qt", "changed", this._load, this);
				this.getBus().subscribe("qt", "intent", this._onIntent, this);
			},

			onExit() {
				this.getBus().unsubscribe("qt", "changed", this._load, this);
				this.getBus().unsubscribe("qt", "intent", this._onIntent, this);
			},

			_onIntent(channel, event, intent) {
				if (intent.tab === "runs" && intent.action === "new") this.onNew();
			},

			async _load() {
				const rows = await this.attempt(() => this.getApi().runs(this._projectId), "/busy");
				if (!rows) return;
				this.viewModel().setProperty(
					"/runs",
					rows.map((r) =>
						Object.assign({}, r, {
							bar: KEYS.map((k) => ({ value: r.counts[k], cls: "qtResult-" + k, label: Format.resultText(k) })),
							summary: this.text("runSummary", [r.counts.passed, r.counts.failed, r.counts.blocked + r.counts.skipped, r.counts.notrun])
						})
					)
				);
			},

			onOpen(e) {
				const r = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("run", { id: this._projectId, runId: r.ID });
			},

			onNew() {
				this.getBus().publish("qt", "newRun", { caseIDs: [] });
			},

			async onDelete(e) {
				const r = e.getSource().getBindingContext("view").getObject();
				if (!(await this.confirm(this.text("deleteRunText", [r.name]), this.text("delete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().deleteRun(r.ID);
					this.getBus().publish("qt", "changed", { what: "runs" });
				});
			},

			// ---- results of automated runs (wdi5) ----

			async onImportResults() {
				const dialog = await this.dialog("ImportResultsDialog");
				const open = this.viewModel().getProperty("/runs").filter((r) => r.status === "open");
				dialog.setModel(new JSONModel({ runs: [{ ID: "", name: this.text("resultsNewRun") }].concat(open.map((r) => ({ ID: r.ID, name: r.name }))), runID: "", name: "", fileName: "", content: "", result: null, busy: false, error: "" }), "res");
				dialog.open();
			},

			async onResultsPick() {
				const file = await Files.pick(".xml,.json,.txt");
				if (!file) return;
				const model = this.byId("importResultsDialog").getModel("res");
				model.setProperty("/fileName", file.name);
				model.setProperty("/content", await Files.text(file));
				model.setProperty("/result", null);
				model.setProperty("/error", "");
				if (!model.getProperty("/name")) model.setProperty("/name", file.name.replace(/\.[^.]+$/, ""));
			},

			onResultsGo() {
				if (this.byId("importResultsDialog").getModel("res").getProperty("/result")) this.onResultsOpen();
				else this.onResultsApply();
			},

			async onResultsApply() {
				const model = this.byId("importResultsDialog").getModel("res");
				model.setProperty("/busy", true);
				model.setProperty("/error", "");
				try {
					const d = model.getData();
					const r = await this.getApi().importResults({ projectID: this._projectId, runID: d.runID || undefined, name: d.name, content: d.content });
					r.text = this.text("resultsDone", [r.matched, r.total, r.counts.passed || 0, r.counts.failed || 0]);
					r.unmatchedText = r.unmatched.map((u) => u.name);
					model.setProperty("/result", r);
					this.getBus().publish("qt", "changed", { what: "runs" });
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				} finally {
					model.setProperty("/busy", false);
				}
			},

			onResultsOpen() {
				const r = this.byId("importResultsDialog").getModel("res").getProperty("/result");
				this.byId("importResultsDialog").close();
				if (r) this.getRouter().navTo("run", { id: this._projectId, runId: r.runID });
			},

			onResultsClose() {
				this.byId("importResultsDialog").close();
			}
		});
	}
);
