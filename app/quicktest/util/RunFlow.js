sap.ui.define(["sap/ui/core/Fragment", "sap/ui/model/json/JSONModel"], function (Fragment, JSONModel) {
	"use strict";

	// "New run": a name, which test cases (the ones chosen, the ready ones, all, the automated ones), and the run is made.
	// One dialog for the whole app: the project page, the test case page and the lists all open it here.

	// the choices of the radio group, in the order of the dialog; null = the cases that were passed in
	const FILTERS = [null, { status: ["ready"] }, {}, { automation: ["automated"] }];

	class RunFlow {
		constructor(component) {
			this.component = component;
			this.api = component.api;
		}

		text(key, args) {
			return this.component.getModel("i18n").getResourceBundle().getText(key, args);
		}

		async open({ projectID, caseIDs = [] }) {
			if (!this.dialog) {
				this.dialog = await this.component.runAsOwner(() =>
					Fragment.load({ id: "qtRun", name: "quicktest.fragment.NewRunDialog", controller: { onRunCreate: () => this._create(), onRunCancel: () => this.dialog.close() } })
				);
				this.dialog.setModel(this.component.getModel("i18n"), "i18n");
			}
			this._projectID = projectID;
			this.dialog.setModel(
				new JSONModel({ name: "", build: "", environment: "", note: "", which: caseIDs.length ? 0 : 2, caseIDs, selectedText: this.text("runSelected", [caseIDs.length]), busy: false, error: "" }),
				"run"
			);
			this.dialog.open();
		}

		async _create() {
			const model = this.dialog.getModel("run");
			const d = model.getData();
			model.setProperty("/busy", true);
			model.setProperty("/error", "");
			try {
				const run = await this.api.createRun({
					projectID: this._projectID,
					name: d.name.trim(),
					build: d.build.trim(),
					environment: d.environment.trim(),
					note: d.note.trim(),
					caseIDs: d.which === 0 ? d.caseIDs : [],
					filter: d.which === 0 ? undefined : FILTERS[d.which]
				});
				this.dialog.close();
				this.component.bus.publish("qt", "changed", { what: "runs" });
				this.component.getRouter().navTo("run", { id: this._projectID, runId: run.ID });
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/busy", false);
			}
		}
	}

	let instance;
	return {
		get(component) {
			instance = instance || new RunFlow(component);
			return instance;
		}
	};
});
