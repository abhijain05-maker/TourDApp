sap.ui.define(["quicktest/controller/BaseController"], function (BaseController) {
	"use strict";

	// The traceability matrix: requirements down, test cases across, a dot where a test case verifies a requirement.
	// A click on a cell links or unlinks. It is plain HTML on purpose: hundreds of rows and columns stay fast.
	const MAX_COLUMNS = 120;
	const COLOR = { passed: "var(--sapPositiveColor)", failed: "var(--sapNegativeColor)", blocked: "var(--sapCriticalColor)", skipped: "var(--sapInformativeColor)" };
	const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

	return BaseController.extend("quicktest.controller.tab.Matrix", {
		onInit() {
			this.initViewModel({ query: "", gapsOnly: false, info: "", busy: false, error: "" });
			this._projectId = (this.appModel().getProperty("/project") || {}).ID;
			this._links = new Set();
			// the table is plain HTML that is replaced whenever a filter changes: the click is caught on the view, which stays
			this.getView().addEventDelegate({
				onAfterRendering: () => {
					const dom = this.getView().getDomRef();
					if (dom && !dom._qtBound) {
						dom._qtBound = true;
						dom.addEventListener("click", (e) => this._click(e));
					}
				}
			});
			this._load();
			this.getBus().subscribe("qt", "changed", this._onChanged, this);
		},

		onExit() {
			this.getBus().unsubscribe("qt", "changed", this._onChanged, this);
		},

		_onChanged(channel, event, data) {
			if (!(data && data.source === "matrix")) this._load();
		},

		onReload() {
			this._load();
		},

		async _load() {
			const data = await this.attempt(() => this.getApi().matrix(this._projectId), "/busy");
			if (!data) return;
			this._data = data;
			this._links = new Set(data.links.map(([r, c]) => r + "|" + c));
			this._render();
		},

		onFilter() {
			this._render();
		},

		_render() {
			if (!this._data) return;
			const m = this.viewModel();
			const q = (m.getProperty("/query") || "").toLowerCase().trim();
			const gapsOnly = m.getProperty("/gapsOnly");
			const d = this._data;
			const hit = (x) => !q || (x.code + " " + x.title).toLowerCase().includes(q);
			const covered = new Set(d.links.map((l) => l[0]));
			let reqs = d.requirements.filter((r) => (!gapsOnly || !covered.has(r.ID)) && (hit(r) || d.links.some(([rid, cid]) => rid === r.ID && hit(d.cases.find((c) => c.ID === cid) || {}))));
			let cases = d.cases.filter((c) => c.status !== "deprecated");
			if (q) cases = cases.filter((c) => hit(c) || reqs.some((r) => hit(r) && this._links.has(r.ID + "|" + c.ID)));
			const cut = cases.length > MAX_COLUMNS;
			if (cut) cases = cases.slice(0, MAX_COLUMNS);
			m.setProperty("/info", this.text("matrixInfo", [reqs.length, cases.length]) + (cut ? " " + this.text("matrixCut", [MAX_COLUMNS]) : ""));
			this._html = this._table(reqs, cases, covered);
			const html = this.byId("matrixHtml");
			html.setContent("<div class='qtMatrixWrap'>" + this._html + "</div>");
		},

		_table(reqs, cases, covered) {
			if (!reqs.length || !cases.length) return "<div class='qtEmptyNote'>" + esc(this.text(this._data.requirements.length ? "matrixNothing" : "matrixEmpty")) + "</div>";
			const head = cases.map((c) => "<th data-case='" + c.ID + "' title='" + esc(c.code + " " + c.title) + "'><div>" + esc(c.code + "  " + c.title) + "</div></th>").join("");
			const rows = reqs
				.map((r) => {
					const cells = cases
						.map((c) => {
							const on = this._links.has(r.ID + "|" + c.ID);
							return "<td class='qtMatrixCell" + (on ? " qtLinked" : "") + "' data-r='" + r.ID + "' data-c='" + c.ID + "' style='--qtCellColor:" + (COLOR[c.lastResult] || "var(--sapHighlightColor)") + "' title='" + esc(r.code + " / " + c.code) + "'></td>";
						})
						.join("");
					return "<tr" + (covered.has(r.ID) ? "" : " class='qtGapRow'") + "><th class='qtMatrixRow' data-req='" + r.ID + "' title='" + esc(r.title) + "'>" + esc(r.code + "  " + r.title) + "</th>" + cells + "</tr>";
				})
				.join("");
			return "<table class='qtMatrix'><thead><tr><th class='qtMatrixRow'>" + esc(this.text("matrixCorner")) + "</th>" + head + "</tr></thead><tbody>" + rows + "</tbody></table>";
		},

		async _click(e) {
			const cell = e.target.closest("td[data-r]");
			if (cell) {
				const key = cell.dataset.r + "|" + cell.dataset.c;
				const on = !this._links.has(key);
				try {
					await this.getApi().setCoverage(cell.dataset.r, cell.dataset.c, on);
					if (on) this._links.add(key);
					else this._links.delete(key);
					cell.classList.toggle("qtLinked", on);
					// a row without any test case is marked as a gap
					const row = cell.parentElement;
					row.classList.toggle("qtGapRow", !row.querySelector(".qtLinked"));
					this.getBus().publish("qt", "changed", { what: "links", source: "matrix" });
				} catch (err) {
					this.fail(err);
				}
				return;
			}
			const req = e.target.closest("th[data-req]");
			if (req) return this.getRouter().navTo("requirement", { id: this._projectId, reqId: req.dataset.req });
			const tc = e.target.closest("th[data-case]");
			if (tc) this.getRouter().navTo("case", { id: this._projectId, caseId: tc.dataset.case });
		}
	});
});
