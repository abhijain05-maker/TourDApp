sap.ui.define(["sap/ui/core/Control"], function (Control) {
	"use strict";

	/**
	 * The last runs as columns, oldest on the left; each column is split by result and as high as the run is big
	 * compared with the biggest one. A click on a column fires `select` with the run.
	 */
	return Control.extend("quicktest.control.RunTrend", {
		metadata: {
			properties: { runs: { type: "object[]", defaultValue: [] } },
			events: { select: { parameters: { run: { type: "object" } } } }
		},

		onclick(e) {
			const col = e.target.closest("[data-run]");
			if (!col) return;
			const run = (this.getRuns() || []).find((r) => r.ID === col.getAttribute("data-run"));
			if (run) this.fireSelect({ run });
		},

		renderer: {
			apiVersion: 2,
			render(rm, control) {
				const runs = (control.getRuns() || []).slice().reverse();
				const biggest = Math.max(1, ...runs.map((r) => r.total));
				rm.openStart("div", control).class("qtTrend").openEnd();
				for (const r of runs) {
					rm.openStart("div").class("qtTrendItem").openEnd();
					rm.openStart("div").class("qtTrendBars").openEnd();
					rm.openStart("div").class("qtTrendCol").attr("data-run", r.ID).attr("tabindex", "0")
						.attr("title", r.name + ": " + r.counts.passed + "/" + r.total)
						.style("height", Math.max(12, (r.total / biggest) * 100) + "%")
						.openEnd();
					for (const k of ["passed", "failed", "blocked", "skipped", "notrun"]) {
						const n = r.counts[k] || 0;
						if (n) rm.openStart("span").class("qtResult-" + k).style("height", (n / r.total) * 100 + "%").openEnd().close("span");
					}
					rm.close("div");
					rm.close("div");
					rm.openStart("div").class("qtTrendLabel").openEnd().text(r.passRate + "%").close("div");
					rm.close("div");
				}
				rm.close("div");
			}
		}
	});
});
