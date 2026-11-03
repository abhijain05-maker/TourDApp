sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Meta", "quicktest/util/AiFlow"],
	function (BaseController, Meta, AiFlow) {
		"use strict";

		const FIELDS = ["title", "description", "acceptance", "priority", "kind", "status", "tags", "source", "owner"];
		const BLANK = { title: "", description: "", acceptance: "", priority: "medium", kind: "functional", status: "draft", tags: "", source: "", owner: "" };

		return BaseController.extend("quicktest.controller.Requirement", {
			onInit() {
				const model = this.initViewModel({
					item: Object.assign({}, BLANK),
					linked: [],
					allCases: [],
					dirty: false,
					busy: false,
					error: "",
					priorities: Meta.items("priorities"),
					kinds: Meta.items("requirementKinds"),
					statuses: Meta.items("requirementStatuses")
				});
				model.attachPropertyChange((e) => {
					if (String(e.getParameter("path")).startsWith("/item")) this._dirtyCheck();
				});
				this.getRouter().getRoute("requirement").attachPatternMatched(this._onMatched, this);
				// Ctrl+S saves
				this._onKey = (e) => {
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && this.getView().getDomRef() && this.getView().getDomRef().offsetParent) {
						e.preventDefault();
						if (this.viewModel().getProperty("/dirty")) this.onSave();
					}
				};
				window.addEventListener("keydown", this._onKey);
			},

			onExit() {
				window.removeEventListener("keydown", this._onKey);
			},

			async _onMatched(e) {
				const args = e.getParameter("arguments");
				this._projectId = args.id;
				this._reqId = args.reqId;
				this.appModel().setProperty("/navKey", args.id);
				await this._load();
			},

			_snapshot() {
				const i = this.viewModel().getProperty("/item");
				return JSON.stringify(FIELDS.map((f) => i[f] || ""));
			},

			_dirtyCheck() {
				this.viewModel().setProperty("/dirty", this._snapshot() !== this._saved);
			},

			async _load() {
				const model = this.viewModel();
				model.setProperty("/error", "");
				if (this._reqId === "new") {
					model.setProperty("/item", Object.assign({}, BLANK));
					model.setProperty("/linked", []);
					this._saved = JSON.stringify(FIELDS.map(() => ""));
					model.setProperty("/dirty", false);
					return;
				}
				const item = await this.attempt(() => this.getApi().requirement(this._reqId), "/busy");
				if (!item) return;
				model.setProperty("/item", item);
				model.setProperty("/linked", item.caseIDs);
				this._saved = this._snapshot();
				model.setProperty("/dirty", false);
				const cases = await this.getApi().cases(this._projectId).catch(() => []);
				model.setProperty("/allCases", cases.map((c) => ({ ID: c.ID, text: c.code + "  " + c.title })));
			},

			onBack() {
				this.toProject("requirements");
			},

			async onSave() {
				const model = this.viewModel();
				const i = model.getProperty("/item");
				const data = {};
				FIELDS.forEach((f) => (data[f] = i[f] || ""));
				const saved = await this.attempt(() => this.getApi().saveRequirement(this._projectId, i.ID, data), "/busy");
				if (!saved) return;
				this.toast(this.text("saved"));
				this.getBus().publish("qt", "changed", { what: "requirements" });
				if (!i.ID) this.getRouter().navTo("requirement", { id: this._projectId, reqId: saved.ID }, true);
				else {
					model.setProperty("/item", saved);
					this._saved = this._snapshot();
					model.setProperty("/dirty", false);
				}
			},

			async onDelete() {
				const i = this.viewModel().getProperty("/item");
				if (!(await this.confirm(this.text("deleteRequirementText", [i.code, i.title]), this.text("delete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().deleteRequirement(i.ID);
					this.getBus().publish("qt", "changed", { what: "requirements" });
					this.toProject("requirements");
				});
			},

			async onLinksChanged() {
				const i = this.viewModel().getProperty("/item");
				const ids = this.byId("reqLinks").getSelectedKeys();
				await this.attempt(async () => {
					await this.getApi().linkCases(i.ID, ids);
					this.getBus().publish("qt", "changed", { what: "links", source: "requirement" });
					const fresh = await this.getApi().requirement(i.ID);
					this.viewModel().setProperty("/item/cases", fresh.cases);
					this.viewModel().setProperty("/item/verification", fresh.verification);
				});
			},

			onOpenCase(e) {
				const c = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("case", { id: this._projectId, caseId: c.ID });
			},

			onNewCase() {
				this.getRouter().navTo("case", { id: this._projectId, caseId: "new", "?query": { req: this.viewModel().getProperty("/item/ID") } });
			},

			// ---- AI ----

			onImprove() {
				const i = this.viewModel().getProperty("/item");
				AiFlow.get(this.getOwnerComponent()).improve({
					projectID: this._projectId,
					entity: "requirement",
					draft: { title: i.title, description: i.description, acceptance: i.acceptance, priority: i.priority, kind: i.kind },
					onApply: (item) => {
						const model = this.viewModel();
						["title", "description", "acceptance", "priority", "kind"].forEach((f) => item[f] !== undefined && model.setProperty("/item/" + f, item[f]));
						this._dirtyCheck();
					}
				});
			},

			onGenerate() {
				const i = this.viewModel().getProperty("/item");
				AiFlow.get(this.getOwnerComponent()).cases({
					projectID: this._projectId,
					requirementIDs: [i.ID],
					onSaved: async () => {
						this.getBus().publish("qt", "changed", { what: "ai" });
						await this._load();
					}
				});
			}
		});
	}
);
