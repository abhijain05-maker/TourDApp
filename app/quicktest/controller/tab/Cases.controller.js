sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Meta", "quicktest/util/AiFlow", "quicktest/util/RecordFlow", "quicktest/util/Files"],
	function (BaseController, Meta, AiFlow, RecordFlow, Files) {
		"use strict";

		const ALL = "";

		return BaseController.extend("quicktest.controller.tab.Cases", {
			onInit() {
				const t = this.text.bind(this);
				const withAll = (rows, all) => [{ id: ALL, label: all }].concat(rows.map((r) => ({ id: r.id, label: r.label })));
				this.initViewModel({
					all: [],
					shown: [],
					query: "",
					status: ALL,
					priority: ALL,
					kind: ALL,
					automation: ALL,
					result: ALL,
					statuses: withAll(Meta.items("caseStatuses"), t("allStatuses")),
					priorities: withAll(Meta.items("priorities"), t("allPriorities")),
					kinds: withAll(Meta.items("caseKinds"), t("allTypes")),
					automations: withAll(Meta.items("automation"), t("allAutomation")),
					resultsList: withAll(Meta.items("results"), t("allResults")),
					bulkStatuses: withAll(Meta.items("caseStatuses"), t("bulkStatus")),
					bulkPriorities: withAll(Meta.items("priorities"), t("bulkPriority")),
					bulkKinds: withAll(Meta.items("caseKinds"), t("bulkKind")),
					bulkAutomations: withAll(Meta.items("automation"), t("bulkAutomation")),
					selected: 0,
					selectedText: "",
					countText: "",
					emptyText: t("noCases"),
					busy: false,
					error: ""
				});
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
				if (intent.tab !== "cases") return;
				if (intent.filter) {
					this.viewModel().setProperty("/result", intent.filter);
					this._apply();
				}
			},

			async _load() {
				const rows = await this.attempt(() => this.getApi().cases(this._projectId), "/busy");
				if (!rows) return;
				this.viewModel().setProperty(
					"/all",
					rows.map((c) =>
						Object.assign({}, c, {
							stepsText: c.automation === "automated" ? c.mappedSteps + "/" + c.stepCount : String(c.stepCount),
							reqText: c.requirementCodes.length ? c.requirementCodes.slice(0, 2).join(", ") + (c.requirementCodes.length > 2 ? " +" + (c.requirementCodes.length - 2) : "") : "–",
							lastResult: c.lastResult || "notrun"
						})
					)
				);
				this._apply();
			},

			_apply() {
				const m = this.viewModel();
				const q = (m.getProperty("/query") || "").toLowerCase().trim();
				const f = ["status", "priority", "kind", "automation"].map((k) => [k, m.getProperty("/" + k)]);
				const result = m.getProperty("/result");
				const all = m.getProperty("/all");
				const shown = all.filter((c) => f.every(([k, v]) => !v || c[k] === v) && (!result || c.lastResult === result) && (!q || (c.code + " " + c.title + " " + (c.tags || "") + " " + (c.objective || "")).toLowerCase().includes(q)));
				m.setProperty("/shown", shown);
				m.setProperty("/countText", shown.length === all.length ? this.text("nItems", [all.length]) : this.text("nOfItems", [shown.length, all.length]));
				m.setProperty("/emptyText", all.length ? this.text("noMatch") : this.text("noCases"));
				this._clearSelection();
			},

			onFilter() {
				this._apply();
			},

			_selected() {
				return this.byId("caseTable").getSelectedItems().map((i) => i.getBindingContext("view").getObject());
			},

			_ids() {
				return this._selected().map((c) => c.ID);
			},

			_clearSelection() {
				const table = this.byId("caseTable");
				if (table) table.removeSelections(true);
				this.onSelect();
			},

			onSelect() {
				const n = this._ids().length;
				this.viewModel().setProperty("/selected", n);
				this.viewModel().setProperty("/selectedText", this.text("nSelected", [n]));
			},

			onOpen(e) {
				const c = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("case", { id: this._projectId, caseId: c.ID });
			},

			onNew() {
				this.getRouter().navTo("case", { id: this._projectId, caseId: "new" });
			},

			// ---- AI and recordings ----

			onAiMenu(e) {
				const key = e.getParameter("item").getKey();
				if (key === "cases") AiFlow.get(this.getOwnerComponent()).cases({ projectID: this._projectId, onSaved: () => this.getBus().publish("qt", "changed", { what: "ai" }) });
				else RecordFlow.get(this.getOwnerComponent()).create({ projectID: this._projectId, onDone: (c) => this.getRouter().navTo("case", { id: this._projectId, caseId: c.ID }) });
			},

			// ---- several at once ----

			async onBulk(field, e) {
				const select = e.getSource();
				const key = select.getSelectedKey();
				select.setSelectedKey("");
				const ids = this._ids();
				if (!key || !ids.length) return;
				await this.attempt(async () => {
					await this.getApi().bulk(this._projectId, "cases", ids, { [field]: key });
					this.toast(this.text("bulkDone", [ids.length]));
					this.getBus().publish("qt", "changed", { what: "cases" });
				});
			},

			onAddToRun() {
				this.getBus().publish("qt", "newRun", { caseIDs: this._ids() });
			},

			/** The rules read the steps of each selected case and build its wdi5 test; the AI of the header does it when one is chosen. */
			async onAutomate() {
				const chosen = this._selected();
				if (!chosen.length) return;
				const api = this.getApi();
				let ok = 0;
				let failed = 0;
				let first = "";
				await this.attempt(async () => {
					for (const c of chosen) {
						try {
							await api.automateCase({ caseID: c.ID, provider: this.provider() });
							ok++;
						} catch (e) {
							failed++;
							first = first || c.code + ": " + e.message;
						}
					}
					this.getBus().publish("qt", "changed", { what: "cases" });
				}, "/busy");
				if (failed) this.fail(new Error(this.text("automateSome", [ok, failed, first])));
				else this.toast(this.text("automateDone", [ok]));
			},

			onDownloadWdi5() {
				Files.download(this.getApi().url.wdi5(this._projectId, this._ids()));
			},

			async onBulkDelete() {
				const ids = this._ids();
				if (!ids.length) return;
				if (!(await this.confirm(this.text("deleteManyCasesText", [ids.length]), this.text("delete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().bulkDelete(this._projectId, "cases", ids);
					this.getBus().publish("qt", "changed", { what: "cases" });
				});
			}
		});
	}
);
