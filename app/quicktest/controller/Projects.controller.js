sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Format", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, JSONModel) {
		"use strict";

		return BaseController.extend("quicktest.controller.Projects", {
			onInit() {
				this.initViewModel({ projects: [], busy: false, error: "" });
				this.getRouter().getRoute("projects").attachPatternMatched((e) => {
					this._load();
					// the command palette opens this page with ?new=1
					const query = e.getParameter("arguments")["?query"] || {};
					if (query.new === "1") {
						this.getRouter().navTo("projects", {}, true);
						this.onNew();
					}
				});
				this.getBus().subscribe("qt", "changed", () => this._load());
			},

			async _load() {
				const rows = await this.attempt(() => this.getApi().overview(), "/busy");
				if (!rows) return;
				this.viewModel().setProperty(
					"/projects",
					rows.map((p) =>
						Object.assign({}, p, {
							coverageValue: p.coveragePct / 100,
							coverageState: p.requirements ? Format.ringState(p.coveragePct) : "None",
							automationValue: p.automationPct / 100,
							passValue: p.passRate / 100,
							passState: p.runs ? Format.ringState(p.passRate) : "None",
							failingText: this.text("cardFailing", [p.failing])
						})
					)
				);
				this.getOwnerComponent().refreshProjects();
			},

			onOpen(e) {
				const project = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("project", { id: project.ID });
			},

			// ---- new project ----

			async onNew() {
				const dialog = await this.dialog("NewProjectDialog");
				dialog.setModel(new JSONModel({ name: "", description: "", busy: false, error: "" }), "new");
				dialog.open();
			},

			onNewClose() {
				this.byId("newProjectDialog").close();
			},

			async onNewCreate() {
				const dialog = this.byId("newProjectDialog");
				const model = dialog.getModel("new");
				if (!model.getProperty("/name").trim()) return;
				model.setProperty("/busy", true);
				try {
					const project = await this.getApi().createProject(model.getProperty("/name").trim(), (model.getProperty("/description") || "").trim());
					dialog.close();
					await this.getOwnerComponent().refreshProjects();
					this.getRouter().navTo("project", { id: project.ID });
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				} finally {
					model.setProperty("/busy", false);
				}
			},

			// ---- delete ----

			async onDelete(e) {
				const project = e.getSource().getBindingContext("view").getObject();
				const ok = await this.confirm(this.text("deleteProjectText", [project.name]), this.text("deleteProject"), this.text("delete"));
				if (!ok) return;
				await this.attempt(async () => {
					await this.getApi().deleteProject(project.ID);
					await this._load();
				});
			}
		});
	}
);
