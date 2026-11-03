sap.ui.define(["sap/ui/core/Control"], function (Control) {
	"use strict";

	/**
	 * A bar made of shares, with an optional legend: the results of a run, the verification of the requirements.
	 * segments: [{ value: 3, cls: "qtResult-passed", label: "Passed" }]. Colours come from the CSS classes (theme variables).
	 */
	return Control.extend("quicktest.control.StackBar", {
		metadata: {
			properties: {
				segments: { type: "object[]", defaultValue: [] },
				legend: { type: "boolean", defaultValue: true },
				height: { type: "sap.ui.core.CSSSize", defaultValue: "0.75rem" }
			}
		},

		renderer: {
			apiVersion: 2,
			render(rm, control) {
				const segments = (control.getSegments() || []).filter((s) => s.value > 0);
				const total = segments.reduce((n, s) => n + s.value, 0);
				rm.openStart("div", control).openEnd();
				rm.openStart("div").class("qtBar").style("height", control.getHeight()).attr("role", "img")
					.attr("aria-label", segments.map((s) => s.value + " " + s.label).join(", "))
					.openEnd();
				for (const s of segments)
					rm.openStart("span").class(s.cls).style("width", (s.value / total) * 100 + "%").attr("title", s.value + " " + s.label).openEnd().close("span");
				rm.close("div");
				if (control.getLegend()) {
					rm.openStart("div").class("qtLegend").openEnd();
					for (const s of control.getSegments() || []) {
						rm.openStart("span").openEnd();
						rm.openStart("i").class("qtDot").class(s.cls).openEnd().close("i");
						rm.text(s.value + " " + s.label);
						rm.close("span");
					}
					rm.close("div");
				}
				rm.close("div");
			}
		}
	});
});
