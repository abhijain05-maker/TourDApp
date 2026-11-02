sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Format", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, JSONModel) {
		"use strict";

		const DEFAULT_SETTINGS = { framework: "mocha", auth: "none" };

		const settingsOf = (row) => {
			try {
				return JSON.parse(row.definition).settings || DEFAULT_SETTINGS;
			} catch (e) {
				return DEFAULT_SETTINGS;
			}
		};

		return BaseController.extend("tourd.designer.controller.tab.Tests", {
			onInit() {
				this.initViewModel({ plans: [], recordings: [], loading: false, noRecording: false, error: "" });
				this._load();
			},

			_project() {
				return this.appModel().getProperty("/project");
			},

			async _load() {
				const id = this._project().ID;
				const model = this.viewModel();
				const result = await this.attempt(() => Promise.all([this.getApi().testPlans(id), this.getApi().recordings(id)]), "/loading");
				if (!result) return;
				const [plans, recordings] = result;
				model.setProperty("/recordings", recordings);
				model.setProperty("/noRecording", recordings.length === 0);
				model.setProperty(
					"/plans",
					plans.map((t) => {
						const s = settingsOf(t);
						let steps = 0;
						try {
							steps = JSON.parse(t.definition).steps.filter((x) => !["open", "assert"].includes(x.kind)).length;
						} catch (e) {
							/* shown as 0 */
						}
						return Object.assign({}, t, { steps, frameworkText: Format.FRAMEWORK_LABEL[s.framework] || s.framework, authText: Format.AUTH_LABEL[s.auth] || s.auth, changedText: Format.date(t.modifiedAt) });
					})
				);
			},

			onNeedRecording() {
				this.getRouter().navTo("project", { id: this._project().ID, "?query": { tab: "recordings" } }, true);
			},

			onOpen(e) {
				this.getRouter().navTo("testplan", { id: e.getSource().getBindingContext("view").getObject().ID });
			},

			async onDelete(e) {
				const plan = e.getSource().getBindingContext("view").getObject();
				if (!(await this.confirm(this.text("testsDeleteText", [plan.name]), this.text("testsDelete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().deleteTestPlan(plan.ID);
					await this._load();
					this.getBus().publish("tourd", "changed", { what: "tests" });
				});
			},

			// ---- new tests from a recording ----

			async onNew() {
				const dialog = await this.dialog("NewTestDialog");
				const model = new JSONModel({ recordings: [], recordingID: "", name: "", framework: "mocha", auth: "none", auths: Object.entries(Format.AUTH_LABEL).map(([key, text]) => ({ key, text })), hidden: 0, hiddenText: "", noneFit: false, busy: false, error: "" });
				dialog.setModel(model, "nt");
				this._fill(model, false);
				dialog.open();
			},

			_fill(model, showAll) {
				const { shown, hidden, noneFit } = Format.recordingsFor(this.viewModel().getProperty("/recordings"), "test", showAll);
				model.setProperty("/hidden", showAll ? 0 : hidden);
				model.setProperty("/hiddenText", this.text("testsShowAll", [hidden]));
				model.setProperty("/noneFit", noneFit);
				model.setProperty(
					"/recordings",
					shown.map((r) => ({ ID: r.ID, text: showAll || noneFit ? r.name + " (" + Format.purposeLabel(Format.purposeOf(r)).toLowerCase() + ")" : r.name }))
				);
				if (!shown.some((r) => r.ID === model.getProperty("/recordingID"))) model.setProperty("/recordingID", shown[0] ? shown[0].ID : "");
			},

			onNewShowAll() {
				this._fill(this.byId("newTestDialog").getModel("nt"), true);
			},

			onNewClose() {
				this.byId("newTestDialog").close();
			},

			async onNewCreate() {
				const dialog = this.byId("newTestDialog");
				const m = dialog.getModel("nt");
				m.setProperty("/busy", true);
				try {
					const row = await this.getApi().createTestPlan({
						projectID: this._project().ID,
						recordingID: m.getProperty("/recordingID"),
						name: (m.getProperty("/name") || "").trim(),
						settings: { framework: m.getProperty("/framework"), auth: m.getProperty("/auth") }
					});
					dialog.close();
					await this._load();
					this.getBus().publish("tourd", "changed", { what: "tests" });
					this.getRouter().navTo("testplan", { id: row.ID });
				} catch (e) {
					m.setProperty("/error", this.errorMessage(e));
				} finally {
					m.setProperty("/busy", false);
				}
			}
		});
	}
);
