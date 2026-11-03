sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Files", "quicktest/util/RunFlow", "sap/ui/core/mvc/View", "sap/ui/model/json/JSONModel"],
	function (BaseController, Files, RunFlow, View, JSONModel) {
		"use strict";

		// tab key -> [view in view/tab/, pane in this view]. A tab is created the first time it is opened and kept while the project is open.
		// A new tab is one entry here, a filter in Project.view.xml and a view + controller in view/tab and controller/tab.
		const TABS = {
			dashboard: { view: "Dashboard", pane: "paneDashboard" },
			requirements: { view: "Requirements", pane: "paneRequirements" },
			cases: { view: "Cases", pane: "paneCases" },
			matrix: { view: "Matrix", pane: "paneMatrix" },
			runs: { view: "Runs", pane: "paneRuns" },
			automation: { view: "Automation", pane: "paneAutomation" },
			setup: { view: "Setup", pane: "paneSetup" }
		};

		return BaseController.extend("quicktest.controller.Project", {
			onInit() {
				this.initViewModel({ tab: "dashboard", loading: false, error: "" });
				this.getRouter().getRoute("project").attachPatternMatched(this._onMatched, this);
				// a tab (or a detail page) changed data: the numbers in the header and on the dashboard follow
				this.getBus().subscribe("qt", "changed", () => this._refreshDash());
				this.getBus().subscribe("qt", "projectChanged", () => this._reloadProject());
				// any tab (or the dashboard) can ask for a new run, optionally with some test cases already chosen
				this.getBus().subscribe("qt", "newRun", (channel, event, data) => {
					if (this._projectId) RunFlow.get(this.getOwnerComponent()).open({ projectID: this._projectId, caseIDs: (data && data.caseIDs) || [] });
				});
			},

			async _onMatched(e) {
				const args = e.getParameter("arguments");
				const query = args["?query"] || {};
				const tab = Object.prototype.hasOwnProperty.call(TABS, query.tab) ? query.tab : "dashboard";
				if (this._projectId !== args.id) {
					this._projectId = args.id;
					this._tabViews = {};
					Object.values(TABS).forEach((t) => this.byId(t.pane).destroyItems());
					this.appModel().setProperty("/project", null);
					this.appModel().setProperty("/dash", null);
					await this._reloadProject();
				}
				this.viewModel().setProperty("/tab", tab);
				// a link from the dashboard can ask the tab to start with a filter or an action (?filter=uncovered&do=ai)
				this._intent = query.filter || query.do ? { tab, filter: query.filter || "", action: query.do || "" } : null;
				if (this.appModel().getProperty("/project")) await this._showTab(tab);
				this.getOwnerComponent().registerCommands("project", this._commands());
			},

			_commands() {
				const go = (tab) => () => this.getRouter().navTo("project", { id: this._projectId, "?query": { tab } });
				const g = this.text("paletteThisProject");
				return [
					{ id: "t-dash", group: g, title: this.text("tabDashboard"), run: go("dashboard"), keywords: "overview numbers coverage" },
					{ id: "t-req", group: g, title: this.text("tabRequirements"), run: go("requirements"), keywords: "requirement story" },
					{ id: "t-cases", group: g, title: this.text("tabCases"), run: go("cases"), keywords: "test case manual" },
					{ id: "t-matrix", group: g, title: this.text("tabMatrix"), run: go("matrix"), keywords: "traceability coverage links" },
					{ id: "t-runs", group: g, title: this.text("tabRuns"), run: go("runs"), keywords: "execute cycle results" },
					{ id: "t-auto", group: g, title: this.text("tabAutomation"), run: go("automation"), keywords: "wdi5 record recording automated" },
					{ id: "t-setup", group: g, title: this.text("tabSetup"), run: go("setup"), keywords: "upload app files" },
					{ id: "new-req", group: this.text("paletteActions"), title: this.text("paletteNewRequirement"), run: () => this.getRouter().navTo("requirement", { id: this._projectId, reqId: "new" }), keywords: "add create" },
					{ id: "new-case", group: this.text("paletteActions"), title: this.text("paletteNewCase"), run: () => this.getRouter().navTo("case", { id: this._projectId, caseId: "new" }), keywords: "add create manual" },
					{ id: "import", group: this.text("paletteActions"), title: this.text("importBook"), run: () => this.onImport(), keywords: "upload excel csv json" }
				];
			},

			async _reloadProject() {
				const id = this._projectId;
				const project = await this.attempt(() => this.getApi().project(id), "/loading");
				if (id !== this._projectId || !project) return;
				this.appModel().setProperty("/project", project);
				await this._refreshDash();
				this._showTab(this.viewModel().getProperty("/tab"));
			},

			async _refreshDash() {
				const id = this._projectId;
				if (!id) return;
				try {
					const dash = await this.getApi().dashboard(id);
					if (id === this._projectId) this.appModel().setProperty("/dash", dash);
				} catch (e) {
					this.fail(e);
				}
			},

			/** Tells the tab that was opened with a filter or an action ("qt" / "intent"), once it exists. */
			_deliverIntent(key) {
				if (this._intent && this._intent.tab === key) {
					const intent = this._intent;
					this._intent = null;
					this.getBus().publish("qt", "intent", intent);
				}
			},

			async _showTab(key) {
				if (this._tabViews[key]) return this._deliverIntent(key);
				const def = TABS[key];
				this._tabViews[key] = true;
				try {
					// created outside of the router: it needs the component as its owner to reach the models and the API
					const view = await this.getOwnerComponent().runAsOwner(() => View.create({ type: "XML", viewName: "quicktest.view.tab." + def.view, id: this.createId("tab" + def.view + this._projectId) }));
					this.byId(def.pane).addItem(view);
					this._deliverIntent(key);
				} catch (e) {
					this._tabViews[key] = false;
					this.fail(e);
				}
			},

			onTabSelect(e) {
				this.getRouter().navTo("project", { id: this._projectId, "?query": { tab: e.getParameter("key") } }, true);
			},

			onHome() {
				this.getRouter().navTo("projects");
			},

			// ---- upload and download of the test book ----

			onExport(e) {
				const key = e.getParameter("item").getKey();
				if (key === "template.xlsx") Files.download(this.getApi().url.template);
				else if (key === "wdi5.zip") Files.download(this.getApi().url.wdi5(this._projectId));
				else Files.download(this.getApi().url.book(this._projectId, key));
			},

			async onImport() {
				const dialog = await this.dialog("ImportDialog");
				dialog.setModel(new JSONModel({ file: null, name: "", content: "", encoding: "text", as: "auto", strategy: "update", preview: null, busy: false, error: "", done: "" }), "imp");
				dialog.open();
			},

			async onImportPick() {
				const file = await Files.pick(".xlsx,.csv,.json,.txt,.tsv");
				if (!file) return;
				const model = this.byId("importDialog").getModel("imp");
				const xlsx = /\.xlsx$/i.test(file.name);
				model.setProperty("/name", file.name);
				model.setProperty("/encoding", xlsx ? "base64" : "text");
				model.setProperty("/content", xlsx ? await Files.base64(file) : await Files.text(file));
				model.setProperty("/done", "");
				await this._importRun("preview");
			},

			onImportChange() {
				if (this.byId("importDialog").getModel("imp").getProperty("/content")) this._importRun("preview");
			},

			async _importRun(mode) {
				const model = this.byId("importDialog").getModel("imp");
				model.setProperty("/busy", true);
				model.setProperty("/error", "");
				try {
					const d = model.getData();
					const result = await this.getApi().importBook({ projectID: this._projectId, filename: d.name, content: d.content, encoding: d.encoding, as: d.as, strategy: d.strategy, mode });
					const c = result.counts;
					result.rowsReq = result.requirements.filter((r) => r.action !== "unchanged");
					result.rowsCase = result.cases.filter((r) => r.action !== "unchanged");
					result.summary = this.text("importSummary", [c.requirements.create, c.requirements.update, c.cases.create, c.cases.update, c.requirements.unchanged + c.cases.unchanged]);
					model.setProperty("/preview", mode === "preview" ? result : null);
					if (mode === "apply") {
						model.setProperty("/done", result.summary);
						this.getBus().publish("qt", "changed", { what: "import" });
					}
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
					model.setProperty("/preview", null);
				} finally {
					model.setProperty("/busy", false);
				}
			},

			onImportApply() {
				this._importRun("apply");
			},

			onImportClose() {
				this.byId("importDialog").close();
			}
		});
	}
);
