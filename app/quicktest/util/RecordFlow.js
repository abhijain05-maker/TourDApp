sap.ui.define(["sap/ui/core/Fragment", "sap/ui/model/json/JSONModel", "sap/m/MessageToast", "quicktest/util/Format"], function (Fragment, JSONModel, MessageToast, Format) {
	"use strict";

	// "From a recording": the recorder (browser extension) sends what a person did in the running app to the project.
	// Here that recording becomes a test case - its manual steps AND its wdi5 test, each step mapped to the code that does it -
	// or it is attached to a test case that was written by hand (the steps are matched by their text).

	class RecordFlow {
		constructor(component) {
			this.component = component;
			this.api = component.api;
		}

		text(key, args) {
			return this.component.getModel("i18n").getResourceBundle().getText(key, args);
		}

		async _dialog() {
			if (!this.dialog) {
				this.dialog = await this.component.runAsOwner(() =>
					Fragment.load({
						id: "qtRec",
						name: "quicktest.fragment.RecordingDialog",
						controller: {
							onCreate: () => this._submit(),
							onClose: () => this.dialog.close(),
							onRecorder: () => this.component.getRootControl().getController().onExtension()
						}
					})
				);
				this.dialog.setModel(this.component.getModel("i18n"), "i18n");
			}
			return this.dialog;
		}

		async _open(data) {
			await this._dialog();
			const model = new JSONModel(Object.assign({ recordings: [], key: "", name: "", requirements: [], picked: [], baseUrl: "", busy: false, error: "", loading: true }, data));
			model.setSizeLimit(2000);
			this.dialog.setModel(model, "rec");
			this.dialog.open();
			try {
				const [recordings, reqs] = await Promise.all([this.api.recordings(this._projectID), data.mode === "create" ? this.api.requirements(this._projectID) : Promise.resolve([])]);
				model.setProperty(
					"/recordings",
					recordings.map((r) => ({ ID: r.ID, text: (r.name || this.text("recUnnamed")) + " · " + Format.date(r.createdAt), name: r.name }))
				);
				model.setProperty("/requirements", reqs.map((r) => ({ ID: r.ID, text: r.code + "  " + r.title })));
				if (recordings.length) {
					const chosen = recordings.find((r) => r.ID === this._pre) || recordings[0];
					model.setProperty("/key", chosen.ID);
					if (!model.getProperty("/name")) model.setProperty("/name", chosen.name || "");
				}
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/loading", false);
			}
		}

		create({ projectID, recordingID, onDone }) {
			this._projectID = projectID;
			this._pre = recordingID;
			this._onDone = onDone;
			this._mode = "create";
			return this._open({ mode: "create", title: this.text("recCreateTitle"), action: this.text("recCreate"), hint: this.text("recCreateHint") });
		}

		attach({ projectID, caseID, caseTitle, onDone }) {
			this._projectID = projectID;
			this._pre = null;
			this._caseID = caseID;
			this._onDone = onDone;
			this._mode = "attach";
			return this._open({ mode: "attach", title: this.text("recAttachTitle"), action: this.text("recAttach"), hint: this.text("recAttachHint", [caseTitle]) });
		}

		async _submit() {
			const model = this.dialog.getModel("rec");
			model.setProperty("/busy", true);
			model.setProperty("/error", "");
			const settings = model.getProperty("/baseUrl").trim() ? { baseUrl: model.getProperty("/baseUrl").trim() } : undefined;
			try {
				let out;
				if (this._mode === "create") {
					out = await this.api.caseFromRecording({ projectID: this._projectID, recordingID: model.getProperty("/key"), name: model.getProperty("/name").trim() || undefined, requirementIDs: model.getProperty("/picked"), settings });
					MessageToast.show(this.text("recCreated", [out.code]));
				} else {
					const r = await this.api.attachRecording({ caseID: this._caseID, recordingID: model.getProperty("/key"), settings });
					out = r.case;
					MessageToast.show(this.text("recAttached", [r.mapped, r.steps]));
				}
				this.dialog.close();
				if (this._onDone) this._onDone(out);
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
			instance = instance || new RecordFlow(component);
			return instance;
		}
	};
});
