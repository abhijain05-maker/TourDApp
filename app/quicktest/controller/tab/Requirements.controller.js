sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Meta", "quicktest/util/AiFlow"],
	function (BaseController, Meta, AiFlow) {
		"use strict";

		const ALL = "";

		return BaseController.extend("quicktest.controller.tab.Requirements", {
			onInit() {
				const t = this.text.bind(this);
				const withAll = (rows, all) => [{ id: ALL, label: all }].concat(rows.map((r) => ({ id: r.id, label: r.label })));
				this.initViewModel({
					all: [],
					shown: [],
					query: "",
					priority: ALL,
					status: ALL,
					verify: ALL,
					priorities: withAll(Meta.items("priorities"), t("allPriorities")),
					statuses: withAll(Meta.items("requirementStatuses"), t("allStatuses")),
					verifies: withAll(Object.keys(Meta.VERIFICATION).map((id) => ({ id, label: Meta.VERIFICATION[id].label })), t("allCoverage")),
					bulkPriorities: withAll(Meta.items("priorities"), t("bulkPriority")),
					bulkStatuses: withAll(Meta.items("requirementStatuses"), t("bulkStatus")),
					selected: 0,
					selectedText: "",
					countText: "",
					emptyText: t("noRequirements"),
					busy: false,
					error: ""
				});
				this._projectId = (this.appModel().getProperty("/project") || {}).ID;
				this._load();
				this.getBus().subscribe("qt", "changed", this._onChanged, this);
				this.getBus().subscribe("qt", "intent", this._onIntent, this);
			},

			onExit() {
				this.getBus().unsubscribe("qt", "changed", this._onChanged, this);
				this.getBus().unsubscribe("qt", "intent", this._onIntent, this);
			},

			_onChanged(channel, event, data) {
				if (!(data && data.source === "requirements")) this._load();
			},

			/** A link from the dashboard: start with a filter and/or open the AI dialog. */
			_onIntent(channel, event, intent) {
				if (intent.tab !== "requirements") return;
				if (intent.filter) {
					this.viewModel().setProperty("/verify", intent.filter);
					this._apply();
				}
				if (intent.action === "ai") this.onAiRequirements();
				else if (intent.action === "tests") this._aiCasesFor(null);
			},

			async _load() {
				const rows = await this.attempt(() => this.getApi().requirements(this._projectId), "/busy");
				if (!rows) return;
				const model = this.viewModel();
				model.setProperty(
					"/all",
					rows.map((r) => Object.assign({}, r, { testsText: r.caseCount ? r.caseCount + " · " + r.caseCodes.slice(0, 3).join(", ") + (r.caseCount > 3 ? " …" : "") : "–" }))
				);
				this._apply();
			},

			_apply() {
				const m = this.viewModel();
				const q = (m.getProperty("/query") || "").toLowerCase().trim();
				const p = m.getProperty("/priority");
				const s = m.getProperty("/status");
				const v = m.getProperty("/verify");
				const all = m.getProperty("/all");
				const shown = all.filter((r) => (!p || r.priority === p) && (!s || r.status === s) && (!v || r.verification === v) && (!q || (r.code + " " + r.title + " " + (r.description || "") + " " + (r.tags || "") + " " + (r.acceptance || "")).toLowerCase().includes(q)));
				m.setProperty("/shown", shown);
				m.setProperty("/countText", shown.length === all.length ? this.text("nItems", [all.length]) : this.text("nOfItems", [shown.length, all.length]));
				m.setProperty("/emptyText", all.length ? this.text("noMatch") : this.text("noRequirements"));
				this._clearSelection();
			},

			onFilter() {
				this._apply();
			},

			_selectedIds() {
				return this.byId("reqTable").getSelectedItems().map((i) => i.getBindingContext("view").getObject().ID);
			},

			_clearSelection() {
				const table = this.byId("reqTable");
				if (table) table.removeSelections(true);
				this.onSelect();
			},

			onSelect() {
				const n = this._selectedIds().length;
				this.viewModel().setProperty("/selected", n);
				this.viewModel().setProperty("/selectedText", this.text("nSelected", [n]));
			},

			onOpen(e) {
				const r = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("requirement", { id: this._projectId, reqId: r.ID });
			},

			onNew() {
				this.getRouter().navTo("requirement", { id: this._projectId, reqId: "new" });
			},

			// ---- AI ----

			onAiRequirements() {
				AiFlow.get(this.getOwnerComponent()).requirements({ projectID: this._projectId, onSaved: () => this._saved() });
			},

			onAiCases() {
				this._aiCasesFor(this._selectedIds());
			},

			_aiCasesFor(ids) {
				AiFlow.get(this.getOwnerComponent()).cases({ projectID: this._projectId, requirementIDs: ids || [], onSaved: () => this._saved() });
			},

			_saved() {
				this.getBus().publish("qt", "changed", { what: "ai" });
			},

			// ---- several at once ----

			async _bulk(patch) {
				const ids = this._selectedIds();
				if (!ids.length) return;
				await this.attempt(async () => {
					await this.getApi().bulk(this._projectId, "requirements", ids, patch);
					this.toast(this.text("bulkDone", [ids.length]));
					this.getBus().publish("qt", "changed", { what: "requirements" });
				});
			},

			onBulkPriority(e) {
				const key = e.getSource().getSelectedKey();
				e.getSource().setSelectedKey("");
				if (key) this._bulk({ priority: key });
			},

			onBulkStatus(e) {
				const key = e.getSource().getSelectedKey();
				e.getSource().setSelectedKey("");
				if (key) this._bulk({ status: key });
			},

			async onBulkDelete() {
				const ids = this._selectedIds();
				if (!ids.length) return;
				if (!(await this.confirm(this.text("deleteManyText", [ids.length]), this.text("delete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().bulkDelete(this._projectId, "requirements", ids);
					this.getBus().publish("qt", "changed", { what: "requirements" });
				});
			}
		});
	}
);
