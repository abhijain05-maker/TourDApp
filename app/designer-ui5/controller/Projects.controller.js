sap.ui.define(
	["tourd/designer/controller/BaseController", "sap/ui/model/json/JSONModel"],
	function (BaseController, JSONModel) {
		"use strict";

		return BaseController.extend("tourd.designer.controller.Projects", {
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
			},

			async _load() {
				const projects = await this.attempt(() => this.getOwnerComponent().refreshProjects(), "/busy");
				if (projects) this.viewModel().setProperty("/projects", projects);
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
