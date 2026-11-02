sap.ui.define(["sap/ui/core/Control", "tourd/designer/util/Theme"], function (Control, Theme) {
	"use strict";

	// CodeMirror 6 (lib/codemirror.js, built from designer/ui5-editor/entry.js) as a UI5 control. It is loaded when the first
	// editor appears. The editor lives in its own DOM node that is moved into the control's element after each rendering,
	// so a re-render of the page does not throw the text, the cursor or the undo history away.
	let library;
	const load = () => (library = library || import(new URL(sap.ui.require.toUrl("tourd/designer/lib/codemirror.js"), document.baseURI).href));

	const CodeEditor = Control.extend("tourd.designer.control.CodeEditor", {
		metadata: {
			properties: {
				value: { type: "string", defaultValue: "" },
				/** the file name decides the language (highlighting) */
				path: { type: "string", defaultValue: "" },
				readOnly: { type: "boolean", defaultValue: false },
				/** the text is a tour: lines that break the tour schema are marked */
				tour: { type: "boolean", defaultValue: false },
				height: { type: "sap.ui.core.CSSSize", defaultValue: "30rem" }
			},
			events: {
				/** the person typed: { value } */
				change: { parameters: { value: { type: "string" } } },
				/** Ctrl+S */
				save: {}
			}
		},

		renderer: {
			apiVersion: 2,
			render(rm, control) {
				rm.openStart("div", control).class("tourdCode").style("height", control.getHeight());
				rm.attr("data-path", control.getPath());
				rm.openEnd().close("div");
			}
		},

		init() {
			this._host = document.createElement("div");
			this._host.style.height = "100%";
			this._off = Theme.onChange((dark) => this._editor && this._editor.setDark(dark));
		},

		// properties that change the editor in place do not need a new rendering
		setValue(value) {
			this.setProperty("value", value, true);
			if (this._editor) this._editor.setValue(value);
			return this;
		},

		setPath(path) {
			this.setProperty("path", path, true);
			if (this._editor) this._editor.setPath(path);
			if (this.getDomRef()) this.getDomRef().setAttribute("data-path", path);
			return this;
		},

		setReadOnly(readOnly) {
			this.setProperty("readOnly", readOnly, true);
			if (this._editor) this._editor.setReadOnly(readOnly);
			return this;
		},

		/** The text as it is now (the value property follows every change too). */
		getText() {
			return this._editor ? this._editor.getValue() : this.getValue();
		},

		focus() {
			if (this._editor) this._editor.focus();
		},

		async onAfterRendering() {
			this.getDomRef().appendChild(this._host);
			if (this._editor || this._starting) return;
			this._starting = true;
			try {
				const cm = await load();
				if (this.isDestroyed()) return;
				this._editor = cm.createEditor(this._host, {
					doc: this.getValue(),
					path: this.getPath(),
					readOnly: this.getReadOnly(),
					tour: this.getTour(),
					dark: Theme.isDark(),
					onChange: (text) => {
						this.setProperty("value", text, true);
						this.fireChange({ value: text });
					},
					onSave: () => this.fireSave()
				});
			} finally {
				this._starting = false;
			}
		},

		exit() {
			if (this._off) this._off();
			if (this._editor) this._editor.destroy();
			this._editor = null;
		}
	});

	return CodeEditor;
});
