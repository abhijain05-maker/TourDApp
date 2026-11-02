sap.ui.define(["sap/ui/core/Control", "tourd/designer/util/Theme"], function (Control, Theme) {
	"use strict";

	// The uploaded copy of a file next to its working copy, differences marked (CodeMirror merge view). Read only.
	let library;
	const load = () => (library = library || import(new URL(sap.ui.require.toUrl("tourd/designer/lib/codemirror.js"), document.baseURI).href));

	return Control.extend("tourd.designer.control.DiffEditor", {
		metadata: {
			properties: {
				before: { type: "string", defaultValue: "" },
				after: { type: "string", defaultValue: "" },
				path: { type: "string", defaultValue: "" },
				beforeLabel: { type: "string", defaultValue: "Uploaded" },
				afterLabel: { type: "string", defaultValue: "Now" },
				height: { type: "sap.ui.core.CSSSize", defaultValue: "32rem" }
			}
		},

		renderer: {
			apiVersion: 2,
			render(rm, control) {
				rm.openStart("div", control).class("tourdDiff").openEnd();
				rm.openStart("div").class("tourdDiffHeads").openEnd();
				rm.openStart("span").openEnd().text(control.getBeforeLabel()).close("span");
				rm.openStart("span").openEnd().text(control.getAfterLabel()).close("span");
				rm.close("div");
				rm.openStart("div", control.getId() + "-host").class("tourdDiffHost").style("height", control.getHeight()).openEnd().close("div");
				rm.close("div");
			}
		},

		init() {
			this._off = Theme.onChange(() => this._build());
		},

		async onAfterRendering() {
			await this._build();
		},

		async _build() {
			const host = this.getDomRef() && this.getDomRef().querySelector(".tourdDiffHost");
			if (!host) return;
			const run = (this._run = (this._run || 0) + 1);
			const cm = await load();
			// a newer rendering (or the control being destroyed) wins over this one
			if (run !== this._run || this.isDestroyed()) return;
			if (this._diff) this._diff.destroy();
			if (host.shadowRoot) host.shadowRoot.querySelector(".tourd-cm-mount")?.replaceChildren();
			this._diff = cm.createDiff(host, { before: this.getBefore(), after: this.getAfter(), path: this.getPath(), dark: Theme.isDark() });
		},

		exit() {
			if (this._off) this._off();
			if (this._diff) this._diff.destroy();
			this._diff = null;
		}
	});
});
