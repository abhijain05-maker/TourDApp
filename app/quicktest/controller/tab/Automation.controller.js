sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/RecordFlow", "quicktest/util/Files"],
	function (BaseController, RecordFlow, Files) {
		"use strict";

		return BaseController.extend("quicktest.controller.tab.Automation", {
			onInit() {
				this.initViewModel({ recordings: [], cases: [], hasApp: true, automatedCount: 0, busy: false, error: "", steps: [1, 2, 3, 4].map((n) => ({ n, html: this.text("autoStep" + n) })) });
				this._projectId = (this.appModel().getProperty("/project") || {}).ID;
				this._load();
				this.getBus().subscribe("qt", "changed", this._load, this);
			},

			onExit() {
				this.getBus().unsubscribe("qt", "changed", this._load, this);
			},

			async _load() {
				const api = this.getApi();
				const result = await this.attempt(() => Promise.all([api.recordings(this._projectId), api.cases(this._projectId), api.countFiles(this._projectId)]), "/busy");
				if (!result) return;
				const [recordings, cases, files] = result;
				const model = this.viewModel();
				model.setProperty("/recordings", recordings);
				model.setProperty("/hasApp", files > 0);
				const automated = cases.filter((c) => c.automation === "automated" || c.automation === "candidate");
				model.setProperty("/automatedCount", cases.filter((c) => c.automation === "automated").length);
				model.setProperty("/cases", automated.map((c) => Object.assign({}, c, { mappedText: c.mappedSteps + " / " + c.stepCount, lastResult: c.lastResult || "notrun" })));
			},

			onReload() {
				this._load();
			},

			onRecorder() {
				this.getOwnerComponent().getRootControl().getController().onExtension();
			},

			onSetup() {
				this.getRouter().navTo("project", { id: this._projectId, "?query": { tab: "setup" } });
			},

			onDownload() {
				Files.download(this.getApi().url.wdi5(this._projectId));
			},

			/** A recording that was exported from the Chrome DevTools Recorder or the UI5 Test Recorder (QuickDev recorder recordings arrive by themselves). */
			async onUploadRecording() {
				const file = await Files.pick(".json,.txt");
				if (!file) return;
				const rec = await this.attempt(async () => this.getApi().importRecording(this._projectId, file.name.replace(/\.[^.]+$/, ""), await Files.text(file)));
				if (!rec) return;
				this.toast(this.text("recUploaded", [rec.steps]));
				this._load();
			},

			onFromRecording(e) {
				const rec = e.getSource().getBindingContext("view").getObject();
				RecordFlow.get(this.getOwnerComponent()).create({ projectID: this._projectId, recordingID: rec.ID, onDone: (c) => this.getRouter().navTo("case", { id: this._projectId, caseId: c.ID }) });
			},

			onOpenCase(e) {
				const c = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("case", { id: this._projectId, caseId: c.ID, "?query": { section: "automation" } });
			}
		});
	}
);
