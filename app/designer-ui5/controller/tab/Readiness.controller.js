sap.ui.define(["tourd/designer/controller/BaseController", "tourd/designer/util/Format"], function (BaseController, Format) {
	"use strict";

	// The overview of the Readiness feature: how far the checks are, per category, and what needs a look first.
	// The data is the component's "readiness" model (util/Readiness.js), shared with the checklist and the tiles.
	return BaseController.extend("tourd.designer.controller.tab.Readiness", {
		onInit() {
			this.initViewModel({});
			this.store = this.getOwnerComponent().readiness;
			this.store.open(this.appModel().getProperty("/project").ID);
		},

		/** "Last scan 5 minutes ago · 14 files read · 30 things found" */
		scanInfo(scan) {
			return scan ? this.text("rScanInfo", [Format.ago(scan.at), scan.files, scan.total]) : "";
		},

		reportText(report) {
			if (!report) return "";
			const parts = [];
			if (report.added && report.added.length) parts.push(this.text("rReportAdded", [report.added.length]));
			if (report.removed && report.removed.length) parts.push(this.text("rReportRemoved", [report.removed.length]));
			return parts.join(" · ");
		},

		async onScan() {
			const result = await this.store.scan();
			if (result) this.toast(this.text("rScanned", [result.total, result.files]));
		},

		_go(tab, intent) {
			this.store.model.setProperty("/intent", intent || null);
			this.getRouter().navTo("project", { id: this.appModel().getProperty("/project").ID, "?query": { tab } }, true);
			this.getBus().publish("tourd", "readinessIntent");
		},

		onWorkspace() {
			this._go("sources");
		},

		onCategory(e) {
			this._go("checklist", { category: e.getSource().getBindingContext("readiness").getObject().id });
		},

		onAttention() {
			this._go("checklist", { attention: true });
		},

		onAdd() {
			this._go("checklist", { add: true });
		}
	});
});
