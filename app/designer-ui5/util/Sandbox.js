sap.ui.define(["sap/ui/base/Object", "tourd/designer/util/Logic"], function (BaseObject, Logic) {
	"use strict";

	// The tour playing in a sandboxed copy of the app: an iframe without same-origin access (see sandbox/sandbox.js for the
	// messages). The step selected in the editor and the step shown in the frame stay in step in both directions; a change of
	// the tour restarts it at the selected step. Same behaviour as designer/src/components/editor/SandboxPreview.tsx.
	//
	// options: { projectID, state(): { doc, index, valid }, onSelectStep(id), onPick(pick), onState(patch) }

	return BaseObject.extend("tourd.designer.util.Sandbox", {
		constructor: function (options) {
			BaseObject.call(this);
			this.o = options;
			this.ui5 = "1.120";
			this.real = false;
			this.status = "loading";
			this.ended = false;
			this.picking = false;
			this.shown = -1; // the step the frame reports as visible
			this.sent = ""; // the tour (as JSON) the frame was last started with
			this.messages = [];
			this._onMessage = (e) => this._message(e);
			window.addEventListener("message", this._onMessage);
		},

		_src() {
			const q = new URLSearchParams({ ui5: this.ui5, parentOrigin: window.location.origin });
			if (this.real) q.set("controllers", "real");
			return "/preview/" + this.o.projectID + "/sandbox.html?" + q;
		},

		attach(host) {
			this.host = host;
			this.load();
		},

		/** (Re)starts the frame: a new iframe, so nothing of the last run is left. */
		load() {
			if (!this.host) return;
			if (this.frame) this.frame.remove();
			this.status = "loading";
			this.ended = false;
			this.picking = false;
			this.shown = -1;
			this.sent = "";
			this.messages = [];
			this.o.onState({ status: "loading", ended: false, picking: false, messages: [], version: "" });
			const frame = document.createElement("iframe");
			frame.title = "Sandbox preview of the app";
			frame.setAttribute("sandbox", "allow-scripts");
			frame.src = this._src();
			this.host.appendChild(frame);
			this.frame = frame;
		},

		post(message) {
			if (this.frame && this.frame.contentWindow) this.frame.contentWindow.postMessage(Object.assign({ tourd: "designer" }, message), "*");
		},

		play() {
			const { doc, index, valid } = this.o.state();
			if (!valid) return;
			this.ended = false;
			this.shown = -1;
			this.o.onState({ ended: false });
			this.post({ type: "loadTour", tour: doc, index });
		},

		/** The tour or the selected step changed in the editor. */
		sync() {
			if (this.status !== "ready") return;
			const { doc, index, valid } = this.o.state();
			if (!valid) return;
			const key = JSON.stringify(doc);
			if (this.sent !== key) {
				// restart where the user is working (not on every keystroke)
				clearTimeout(this._timer);
				this._timer = setTimeout(() => {
					const now = this.o.state();
					const k = JSON.stringify(now.doc);
					if (this.sent === k || !now.valid) return;
					this.sent = k;
					this.play();
				}, 500);
			} else if (!this.ended && index !== this.shown) {
				this.post({ type: "goToStep", index });
			}
		},

		navigate(hash) {
			this.post({ type: "navigate", hash });
		},

		setPicking(on) {
			this.picking = on;
			this.post({ type: "pick", on });
			this.o.onState({ picking: on });
		},

		_message(e) {
			const m = e.data;
			if (!this.frame || e.source !== this.frame.contentWindow || !m || m.tourd !== "sandbox") return;
			if (m.type === "ready") {
				this.status = "ready";
				this.sent = JSON.stringify(this.o.state().doc); // the first load carries this version
				this.o.onState({ status: "ready", version: String(m.version || "") });
				this.play();
			} else if (m.type === "stepChanged") {
				this.shown = m.index;
				const { doc, index } = this.o.state();
				const step = doc.steps[m.index];
				if (step && m.index !== index) this.o.onSelectStep(step.id);
			} else if (m.type === "tourEnded") {
				this.ended = true;
				this.o.onState({ ended: true });
			} else if (m.type === "pickResult") {
				this.picking = false;
				this.o.onState({
					picking: false,
					pickNote: m.controlId
						? m.viaParent
							? "You clicked inside a " + String(m.clicked).split(".").pop() + "; the " + String(m.controlType).split(".").pop() + ' "' + m.controlId + "\" around it is now this step's target."
							: '"' + m.controlId + "\" is now this step's target."
						: "That part of the app has no fixed id, so the step finds it by its text."
				});
				this.o.onPick(m);
			} else if (m.type === "pickCancelled") {
				this.picking = false;
				this.o.onState({ picking: false });
			} else if (m.type === "error") {
				if (m.message) {
					this.messages = this.messages.filter((x) => x !== m.message).concat([String(m.message)]).slice(-3);
					this.o.onState({ messages: this.messages });
				}
				if (this.status === "loading") {
					this.status = "failed";
					this.o.onState({ status: "failed" });
				}
			}
		},

		destroy() {
			window.removeEventListener("message", this._onMessage);
			clearTimeout(this._timer);
			if (this.frame) this.frame.remove();
			this.frame = null;
		}
	});
});
