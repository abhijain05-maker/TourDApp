sap.ui.define(["sap/ui/core/Control"], function (Control) {
	"use strict";

	/** A ring that fills with a share (0 to 1): the big number of the readiness overview. Colours come from the theme (see readiness.css). */
	return Control.extend("tourd.designer.control.ProgressRing", {
		metadata: {
			properties: {
				value: { type: "float", defaultValue: 0 },
				/** the text under the number, e.g. "verified" */
				caption: { type: "string", defaultValue: "" },
				size: { type: "sap.ui.core.CSSSize", defaultValue: "8rem" },
				/** None | Success | Warning | Error */
				state: { type: "string", defaultValue: "None" },
				/** what a screen reader says */
				label: { type: "string", defaultValue: "" }
			}
		},

		renderer: {
			apiVersion: 2,
			render(rm, control) {
				const pct = Math.max(0, Math.min(100, Math.round(control.getValue() * 100)));
				rm.openStart("div", control)
					.class("tourdRing")
					.class("tourdRing" + control.getState())
					.style("width", control.getSize())
					.style("height", control.getSize())
					.attr("role", "img")
					.attr("aria-label", (control.getLabel() || control.getCaption()) + " " + pct + " %")
					.openEnd();
				rm.openStart("svg").attr("viewBox", "0 0 36 36").attr("aria-hidden", "true").openEnd();
				rm.openStart("circle").class("tourdRingTrack").attr("cx", "18").attr("cy", "18").attr("r", "15.9155").openEnd().close("circle");
				if (pct > 0)
					rm.openStart("circle")
						.class("tourdRingValue")
						.attr("cx", "18")
						.attr("cy", "18")
						.attr("r", "15.9155")
						.attr("stroke-dasharray", pct + " " + (100 - pct))
						.attr("stroke-dashoffset", "25")
						.openEnd()
						.close("circle");
				rm.close("svg");
				rm.openStart("div").class("tourdRingText").openEnd();
				rm.openStart("span").class("tourdRingNumber").openEnd().text(pct + "%").close("span");
				if (control.getCaption()) rm.openStart("span").class("tourdRingCaption").openEnd().text(control.getCaption()).close("span");
				rm.close("div");
				rm.close("div");
			}
		}
	});
});
