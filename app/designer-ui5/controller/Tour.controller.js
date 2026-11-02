sap.ui.define(
	[
		"tourd/designer/controller/BaseController",
		"tourd/designer/util/Logic",
		"tourd/designer/util/TourModel",
		"tourd/designer/util/Markdown",
		"tourd/designer/util/Format",
		"tourd/designer/util/Sandbox",
		"tourd/designer/util/ApplyDialog",
		"sap/ui/model/json/JSONModel"
	],
	function (BaseController, Logic, TM, Markdown, Format, Sandbox, ApplyDialog, JSONModel) {
		"use strict";

		const AUTOSAVE_DELAY_MS = 1200;
		const TITLE_HINT = 60;
		const STATE_TEXT = {
			saved: "All changes saved",
			saving: "Saving…",
			unsaved: "Unsaved changes",
			invalid: "Not saved: fix the problems first",
			conflict: "Changed elsewhere",
			error: "Could not save"
		};
		const STATE_TYPE = { saved: "Success", saving: "None", unsaved: "Warning", invalid: "Error", conflict: "Error", error: "Error" };
		const SIDE_TEXT = { Top: "above", Bottom: "below", Left: "to the left of", Right: "to the right of", Vertical: "above or below", Horizontal: "to the left or right of" };
		const PANES = { preview: "paneRightPreview", sandbox: "paneRightSandbox", live: "paneRightLive", json: "paneRightJson", checks: "paneRightChecks" };
		const PRESETS = ["Make it shorter", "Make it friendlier", "Explain why the user needs this", "Translate to German", "Translate to French"];

		const short = (viewName) => (viewName || "").split(".").slice(-1)[0];
		const pretty = (doc) => JSON.stringify(doc, null, 2);

		function findControl(inv, t) {
			if (!inv || !t) return undefined;
			if (t.controlId) return inv.controls.find((c) => (c.localId === t.controlId && (!t.viewName || c.viewName === t.viewName)) || c.globalId === t.controlId);
			const fb = t.fallbacks.find((f) => f.by === "text");
			const wanted = fb && fb.value.trim().toLowerCase();
			return wanted ? inv.controls.find((c) => (!t.viewName || c.viewName === t.viewName) && c.display && c.display.trim().toLowerCase() === wanted) : undefined;
		}

		function whereText(step, control) {
			if (!step.target) return "Shown in the middle of the screen.";
			const name = (control && control.display) || step.target.controlId || (step.target.fallbacks[0] && step.target.fallbacks[0].value) || "the control";
			const side = step.placement.replace(/^Preferred/, "").replace(/OrFlip$/, "");
			return "Shown " + (SIDE_TEXT[side] || "next to") + " “" + name + "”" + (step.placement.startsWith("Preferred") ? ", on the other side if there is no room" : "") + ".";
		}

		return BaseController.extend("tourd.designer.controller.Tour", {
			onInit() {
				this.initViewModel({
					ready: false,
					loading: false,
					loadError: "",
					doc: { title: "" },
					version: 0,
					generator: "",
					generatorState: "None",
					state: "saved",
					stateText: STATE_TEXT.saved,
					stateType: "Success",
					error: "",
					canUndo: false,
					canRedo: false,
					valid: true,
					noInventory: false,
					steps: [],
					sel: {},
					routes: [],
					issues: [],
					checksTitle: "Checks (0)",
					preview: {},
					rightTab: "preview",
					sandbox: { ui5: "1.120", real: false, status: "loading", ended: false, picking: false, pickNote: "", messages: [], routes: [], page: "", unavailable: "", footer: "", notes: "" },
					live: { inline: "", loader: "", size: "", loaderHelp: "", bookmarkTitle: "", copied: "", copiedLoader: "" }
				});
				this.getRouter().getRoute("tour").attachPatternMatched(this._onMatched, this);
				// leaving the page with edits not saved yet: save them first
				this.getRouter().attachRouteMatched((e) => {
					if (e.getParameter("name") !== "tour" && this._tour) this._leave();
				});
				this._onKey = (e) => this._key(e);
				this._onUnload = (e) => {
					if (["unsaved", "saving", "invalid"].includes(this._stateName)) e.preventDefault();
				};
				window.addEventListener("keydown", this._onKey);
				window.addEventListener("beforeunload", this._onUnload);
			},

			onExit() {
				window.removeEventListener("keydown", this._onKey);
				window.removeEventListener("beforeunload", this._onUnload);
				clearTimeout(this._timer);
				if (this._sandbox) this._sandbox.destroy();
			},

			// ---- loading ----

			async _onMatched(e) {
				const id = e.getParameter("arguments").id;
				if (this._tour && this._tour.ID === id && this.viewModel().getProperty("/ready")) return;
				this._reset();
				const model = this.viewModel();
				model.setProperty("/loading", true);
				model.setProperty("/loadError", "");
				try {
					this._L = await Logic.load();
					const tour = await this.getApi().tour(id);
					let inventory;
					try {
						inventory = await this.getApi().inventory(tour.project_ID);
					} catch (err) {
						inventory = undefined;
					}
					if (id !== e.getParameter("arguments").id) return;
					this._tour = tour;
					this._inventory = inventory;
					const doc = JSON.parse(tour.definition);
					this._hist = TM.History.create(doc);
					this._saved = { json: tour.definition, version: tour.version };
					this._selectedId = doc.steps[0] ? doc.steps[0].id : "";
					this._stateName = "saved";
					model.setProperty("/version", tour.version);
					model.setProperty("/generator", tour.generator || "");
					model.setProperty("/generatorState", Format.GENERATOR_STATE[tour.generator] || "None");
					model.setProperty("/noInventory", !inventory);
					model.setProperty("/routes", inventory ? inventory.routes.map((r) => ({ pattern: r.pattern, views: r.viewNames.map(short).join(" + ") })) : []);
					model.setProperty("/ready", true);
					this._recompute();
				} catch (err) {
					model.setProperty("/loadError", this.errorMessage(err));
				} finally {
					model.setProperty("/loading", false);
				}
			},

			_reset() {
				clearTimeout(this._timer);
				if (this._sandbox) this._sandbox.destroy();
				this._sandbox = null;
				this._tour = null;
				this._liveToken = null;
				this.viewModel().setProperty("/ready", false);
				this.viewModel().setProperty("/rightTab", "preview");
				this._showPane("preview");
			},

			onHome() {
				this.getRouter().navTo("projects");
			},

			onToTours() {
				this.getRouter().navTo("project", { id: this._tour.project_ID, "?query": { tab: "tours" } });
			},

			onReload() {
				window.location.reload();
			},

			async _leave() {
				if (this._tour && this._stateName === "unsaved") await this.flush();
				if (this._sandbox) {
					this._sandbox.destroy();
					this._sandbox = null;
				}
				this._tour = null;
				this.viewModel().setProperty("/ready", false);
			},

			// ---- the working copy ----

			_doc() {
				return this._hist.present;
			},

			_selected() {
				const doc = this._doc();
				return doc.steps.find((s) => s.id === this._selectedId) || doc.steps[0];
			},

			/** Takes a new version of the working copy (undoable); `key` merges quick edits of one field into one undo step. */
			commit(next, key, source) {
				this._hist = TM.History.push(this._hist, next, key);
				this._changed(source);
			},

			_changed(source) {
				const doc = this._doc();
				if (doc.steps.length && !doc.steps.some((s) => s.id === this._selectedId)) this._selectedId = doc.steps[0].id;
				this._recompute(source);
				this._autosave();
			},

			onUndo() {
				this._hist = TM.History.undo(this._hist);
				this._changed();
			},

			onRedo() {
				this._hist = TM.History.redo(this._hist);
				this._changed();
			},

			_key(e) {
				if (!this._tour || !(e.ctrlKey || e.metaKey)) return;
				const path = e.composedPath ? e.composedPath() : [];
				if (path.some((el) => el.matches && el.matches("input, textarea, [contenteditable], .tourdCode, .sapMDialog"))) return;
				const k = e.key.toLowerCase();
				if (k === "z" && !e.shiftKey) {
					e.preventDefault();
					this.onUndo();
				} else if (k === "y" || (k === "z" && e.shiftKey)) {
					e.preventDefault();
					this.onRedo();
				}
			},

			// ---- everything derived from the working copy ----

			_recompute(source) {
				const L = this._L;
				const model = this.viewModel();
				const doc = this._doc();
				const inventory = this._inventory;
				const validation = L.validateTour(doc);
				this._valid = validation.ok;
				const issues = validation.ok
					? L.lintTour(doc, inventory || { controls: [], routes: [], views: [] }).issues
					: validation.issues.map((i) => L.describeIssue(i, doc));
				const byStep = new Map();
				for (const i of issues) {
					if (!i.stepId || i.severity === "info") continue;
					const entry = byStep.get(i.stepId) || { errors: 0, warnings: 0 };
					if (i.severity === "error") entry.errors++;
					else entry.warnings++;
					byStep.set(i.stepId, entry);
				}
				const shown = issues.filter((i) => i.severity !== "info");
				const selected = this._selected();
				const index = Math.max(0, doc.steps.findIndex((s) => s.id === (selected && selected.id)));

				model.setProperty("/valid", validation.ok);
				model.setProperty("/canUndo", TM.History.canUndo(this._hist));
				model.setProperty("/canRedo", TM.History.canRedo(this._hist));
				if (source !== "tourTitle") model.setProperty("/doc/title", doc.title);
				model.setProperty("/issues", shown);
				model.setProperty("/checksTitle", "Checks (" + shown.length + ")");

				model.setProperty(
					"/steps",
					doc.steps.map((s, i) => {
						const e = byStep.get(s.id) || { errors: 0, warnings: 0 };
						const low = ((s.meta && s.meta.confidence) === undefined ? 1 : s.meta.confidence) < 0.7 && !(s.meta && s.meta.unresolved);
						const unresolved = !!(s.meta && s.meta.unresolved);
						const t = s.target;
						return {
							id: s.id,
							index: i,
							number: i + 1,
							title: s.title || "(no title)",
							targetLabel: !t ? "no control (centered)" : short(t.viewName) + (t.viewName ? " / " : "") + (t.controlId || '"' + ((t.fallbacks[0] && t.fallbacks[0].value) || "?") + '"'),
							unresolved,
							lowConfidence: low,
							errors: e.errors,
							warnings: e.warnings,
							errorsText: e.errors + " error(s)",
							warningsText: e.warnings + " warning(s)",
							hasTags: unresolved || low || e.errors > 0 || e.warnings > 0,
							canDown: i < doc.steps.length - 1,
							canDelete: doc.steps.length > 1,
							selected: !!selected && s.id === selected.id
						};
					})
				);

				if (selected) {
					const control = findControl(inventory, selected.target);
					this._syncSel(this._buildSel(selected, index, control, issues.filter((i) => i.stepId === selected.id)), source);
					this._syncPreview(doc, selected, index, control);
				}
				this._setState();
				if (source !== "json") this._syncJson();
				if (this.viewModel().getProperty("/rightTab") === "live") this._syncLive();
				if (this._sandbox) this._sandbox.sync();
			},

			_buildSel(step, index, control, stepIssues) {
				const L = this._L;
				const inv = this._inventory;
				const t = step.target;
				const hash = (step.before[0] && step.before[0].hash) || "";
				const opensPage = step.before.length > 0;
				const route = inv && opensPage ? L.matchRoute(inv.routes, L.normalizeHash(hash)) : null;
				const place = TM.parsePlacement(step.placement);
				const m = step.meta;
				return {
					id: step.id,
					number: index + 1,
					title: step.title,
					titleLabel: "Title (" + step.title.length + "/" + TITLE_HINT + ")",
					titleState: step.title.length > TITLE_HINT ? "Warning" : "None",
					text: step.text,
					hasTarget: !!t,
					targetName: t ? (control && control.display) || t.controlId || (t.fallbacks[0] && t.fallbacks[0].value) || "" : "",
					targetType: control ? control.type.split(".").slice(-1)[0] : "",
					targetPath: t ? short(t.viewName) + (t.viewName ? " / " : "") + (t.controlId || "(by text)") : "",
					found: inv && t ? !!control : null,
					unstable: !!control && !control.hasStableId,
					viewName: (t && t.viewName) || "",
					controlId: (t && t.controlId) || "",
					idState: inv && t && t.controlId && !control ? "Error" : "None",
					fallbacks: t ? t.fallbacks.map((f) => ({ by: f.by, value: f.value })) : [],
					placement: step.placement,
					side: place.side,
					flip: place.flip,
					placementText: step.placement + (place.side === null ? " (chosen automatically; pick a side to fix it)" : ""),
					opensPage,
					hash,
					hashState: inv && inv.routes.length && opensPage && !route ? "Warning" : "None",
					routeText: route ? "Shows " + route.route.viewNames.map(short).join(" + ") + "." : "",
					unresolved: !!(m && m.unresolved),
					unresolvedText: "This step needs review: " + ((m && m.note) || "its control could not be verified") + ". Choose the right control below.",
					metaText: m ? "Source: " + (m.source || "unknown") + (m.confidence !== undefined ? " · confidence " + Math.round(m.confidence * 100) + "%" : "") : "",
					issues: stepIssues.map((i) => ({ type: i.severity === "error" ? "Error" : i.severity === "warning" ? "Warning" : "Information", text: i.message }))
				};
			},

			/** Puts the selected step into the form without touching the field the person is typing in. */
			_syncSel(sel, source) {
				const model = this.viewModel();
				const old = model.getProperty("/sel") || {};
				if (old.id !== sel.id) return model.setProperty("/sel", sel);
				const skip = { title: "title", text: "text", viewName: "viewName", controlId: "controlId", fallbacks: "fallbacks", hash: "hash" };
				Object.keys(sel).forEach((k) => {
					if (skip[k] && source === skip[k]) return;
					if (JSON.stringify(old[k]) !== JSON.stringify(sel[k])) model.setProperty("/sel/" + k, sel[k]);
				});
			},

			_syncPreview(doc, step, index, control) {
				const last = index === doc.steps.length - 1;
				this.viewModel().setProperty("/preview", {
					title: step.title,
					html: Markdown.toHtml(step.text),
					allowSkip: doc.options.allowSkip,
					progress: doc.options.showProgress ? "Step " + (index + 1) + " of " + doc.steps.length : "",
					first: index === 0,
					nextText: last ? "Done" : "Next",
					where: whereText(step, control)
				});
			},

			_syncJson() {
				const ed = this.byId("jsonEditor");
				if (ed) ed.setValue(pretty(this._doc()));
			},

			_setState() {
				const doc = this._doc();
				const model = this.viewModel();
				let state = this._stateName;
				if (state !== "conflict" && state !== "error" && state !== "saving") {
					if (JSON.stringify(doc) === this._saved.json) state = "saved";
					else state = this._valid ? "unsaved" : "invalid";
				}
				this._stateName = state;
				model.setProperty("/state", state);
				model.setProperty("/stateText", STATE_TEXT[state]);
				model.setProperty("/stateType", STATE_TYPE[state]);
			},

			// ---- saving ----

			_autosave() {
				clearTimeout(this._timer);
				if (JSON.stringify(this._doc()) === this._saved.json || !this._valid || this._stateName === "conflict") return;
				this._timer = setTimeout(() => this._save({ autosave: true }), AUTOSAVE_DELAY_MS);
			},

			async _settled() {
				while (this._inflight) await this._inflight;
			},

			/** One save at a time: a second request on the same base version would be rejected as a conflict with the person's own work. */
			async _save(options) {
				await this._settled();
				const json = JSON.stringify(this._doc());
				if (options.autosave && json === this._saved.json) return true;
				this._stateName = "saving";
				this._setState();
				const run = (async () => {
					try {
						const row = await this.getApi().saveTour({ tourID: this._tour.ID, definition: json, note: options.note, autosave: options.autosave, baseVersion: this._saved.version });
						this._saved = { json, version: row.version };
						this.viewModel().setProperty("/version", row.version);
						this.viewModel().setProperty("/error", "");
						this._stateName = JSON.stringify(this._doc()) === json ? "saved" : "unsaved";
						this._setState();
						this.getBus().publish("tourd", "changed", { what: "tours" });
						return true;
					} catch (e) {
						this._stateName = e.status === 409 ? "conflict" : "error";
						this.viewModel().setProperty("/error", this.errorMessage(e));
						this._setState();
						return false;
					}
				})();
				this._inflight = run;
				try {
					return await run;
				} finally {
					if (this._inflight === run) this._inflight = null;
				}
			},

			/** Saves now (used before actions that work on the stored tour). */
			async flush() {
				await this._settled();
				if (JSON.stringify(this._doc()) === this._saved.json) return true;
				if (!this._L.validateTour(this._doc()).ok) return false;
				return this._save({ autosave: true });
			},

			/** Takes over a tour the server changed (AI edit, restored version); the edit stays undoable. */
			adopt(row) {
				this._saved = { json: row.definition, version: row.version };
				this.viewModel().setProperty("/version", row.version);
				this._hist = TM.History.push(this._hist, JSON.parse(row.definition));
				this._stateName = "saved";
				this.viewModel().setProperty("/error", "");
				this._changed();
				this.getBus().publish("tourd", "changed", { what: "tours" });
			},

			// ---- title and steps ----

			onTourTitle(e) {
				this.commit(Object.assign({}, this._doc(), { title: e.getParameter("value") }), "tour-title", "tourTitle");
			},

			_patch(patch, key, source) {
				const sel = this._selected();
				this.commit(TM.updateStep(this._doc(), sel.id, patch), key && key + ":" + sel.id, source);
			},

			_stepOf(e) {
				return e.getSource().getBindingContext("view").getObject();
			},

			onSelectStep(e) {
				const item = e.getParameter("listItem");
				if (!item) return;
				this._select(item.getBindingContext("view").getObject().id);
			},

			_select(id) {
				if (id === this._selectedId) return;
				this._selectedId = id;
				this._recompute();
			},

			onAddStep() {
				const r = TM.addStep(this._doc(), this._selectedId);
				this._selectedId = r.id;
				this.commit(r.doc);
			},

			onDuplicateStep(e) {
				const r = TM.duplicateStep(this._doc(), this._stepOf(e).id);
				this._selectedId = r.id;
				this.commit(r.doc);
			},

			onDeleteStep(e) {
				const r = TM.deleteStep(this._doc(), this._stepOf(e).id);
				this._selectedId = r.selectId;
				this.commit(r.doc);
			},

			onMoveUp(e) {
				const i = this._stepOf(e).index;
				this.commit(TM.moveStep(this._doc(), i, i - 1));
			},

			onMoveDown(e) {
				const i = this._stepOf(e).index;
				this.commit(TM.moveStep(this._doc(), i, i + 1));
			},

			onDropStep(e) {
				const from = e.getParameter("draggedControl").getBindingContext("view").getObject().index;
				let to = e.getParameter("droppedControl").getBindingContext("view").getObject().index;
				if (e.getParameter("dropPosition") === "After") to += 1;
				if (from < to) to -= 1;
				this.commit(TM.moveStep(this._doc(), from, to));
			},

			// ---- the form of the selected step ----

			onStepTitle(e) {
				this._patch({ title: e.getParameter("value") }, "title", "title");
			},

			onStepText(e) {
				this._patch({ text: e.getParameter("value") }, "text", "text");
			},

			_setTarget(patch, source) {
				const sel = this._selected();
				this.commit(TM.setTarget(this._doc(), sel.id, Object.assign({ fallbacks: [] }, sel.target, patch)), undefined, source);
			},

			onRemoveTarget() {
				this.commit(TM.setTarget(this._doc(), this._selected().id, undefined));
			},

			onTargetView(e) {
				this._setTarget({ viewName: e.getParameter("value").trim() || undefined }, "viewName");
			},

			onTargetId(e) {
				this._setTarget({ controlId: e.getParameter("value").trim() || undefined }, "controlId");
			},

			_fallbacks() {
				const t = this._selected().target;
				return t ? t.fallbacks.slice() : [];
			},

			_fallbackIndex(e) {
				return Number(e.getSource().getBindingContext("view").getPath().split("/").pop());
			},

			onFallbackBy(e) {
				const list = this._fallbacks();
				const i = this._fallbackIndex(e);
				list[i] = Object.assign({}, list[i], { by: e.getParameter("selectedItem").getKey() });
				this._setTarget({ fallbacks: list });
			},

			onFallbackValue(e) {
				const list = this._fallbacks();
				const i = this._fallbackIndex(e);
				list[i] = Object.assign({}, list[i], { value: e.getParameter("value") });
				this._setTarget({ fallbacks: list }, "fallbacks");
			},

			onFallbackRemove(e) {
				const i = this._fallbackIndex(e);
				this._setTarget({ fallbacks: this._fallbacks().filter((_, j) => j !== i) });
			},

			onFallbackAdd() {
				const sel = this.viewModel().getProperty("/sel");
				this._setTarget({ fallbacks: this._fallbacks().concat([{ by: "text", value: sel.targetName || "" }]) });
			},

			onPlacement(side) {
				const sel = this.viewModel().getProperty("/sel");
				this._patch({ placement: TM.buildPlacement(side, sel.flip || sel.side === null) }, "placement");
			},

			onFlip(e) {
				const sel = this.viewModel().getProperty("/sel");
				if (sel.side) this._patch({ placement: TM.buildPlacement(sel.side, e.getParameter("selected")) }, "placement");
			},

			onOpensPage(e) {
				this._patch({ before: e.getParameter("selected") ? [{ type: "navigate", hash: "" }] : [] });
			},

			onHash(e) {
				this._patch({ before: [{ type: "navigate", hash: e.getParameter("value") }] }, "hash", "hash");
			},

			onIssue(e) {
				const item = e.getSource().getBindingContext("view").getObject();
				if (item.stepId) this._select(item.stepId);
			},

			// ---- the right-hand panel ----

			_showPane(tab) {
				Object.keys(PANES).forEach((k) => {
					const pane = this.byId(PANES[k]);
					if (pane) pane.toggleStyleClass("tourdHidden", k !== tab);
				});
			},

			onRightTab(e) {
				const tab = e.getParameter("key");
				this.viewModel().setProperty("/rightTab", tab);
				this._showPane(tab);
				if (tab === "sandbox") this._openSandbox();
				if (tab === "live") this._syncLive();
				if (tab === "json") {
					this._syncJson();
					this.byId("jsonEditor").focus();
				}
			},

			// ---- the sandbox ----

			_sandboxState(patch) {
				const model = this.viewModel();
				Object.keys(patch).forEach((k) => {
					if (k === "messages") model.setProperty("/sandbox/messages", patch.messages.map((text) => ({ text })));
					else if (k === "version") model.setProperty("/sandbox/footer", (patch.version ? "UI5 " + patch.version + " · " : "") + this.text("tourSandboxFooter"));
					else model.setProperty("/sandbox/" + k, patch[k]);
				});
			},

			async _loadSandboxInfo() {
				const model = this.viewModel();
				try {
					const info = await this.getApi().previewInfo(this._tour.project_ID, model.getProperty("/sandbox/real") ? "real" : "stub");
					model.setProperty("/sandbox/unavailable", "");
					model.setProperty("/sandbox/routes", [{ name: "", hash: undefined, label: "" }].slice(1).concat(info.routes.map((r) => ({ name: r.name, hash: this._L.hashFor(r.pattern) }))));
					model.setProperty("/sandbox/notes", info.notes.join(" "));
					return true;
				} catch (e) {
					model.setProperty("/sandbox/unavailable", this.errorMessage(e) + " " + this.text("tourSandboxNeeds"));
					return false;
				}
			},

			async _openSandbox() {
				if (this._sandbox) return;
				const model = this.viewModel();
				const sandbox = new Sandbox({
					projectID: this._tour.project_ID,
					state: () => ({ doc: this._doc(), index: Math.max(0, this._doc().steps.findIndex((s) => s.id === this._selectedId)), valid: this._valid }),
					onSelectStep: (id) => this._select(id),
					onPick: (p) => this._onPick(p),
					onState: (patch) => this._sandboxState(patch)
				});
				sandbox.ui5 = model.getProperty("/sandbox/ui5");
				this._sandbox = sandbox;
				if (!(await this._loadSandboxInfo())) {
					sandbox.destroy();
					this._sandbox = null;
					return;
				}
				const html = this.byId("sandboxHost");
				const host = html.getDomRef();
				if (host) sandbox.attach(host.classList.contains("tourdSandboxFrame") ? host : host.querySelector(".tourdSandboxFrame"));
			},

			onSandboxUi5(e) {
				const v = e.getParameter("selectedItem").getKey();
				try {
					localStorage.setItem("tourd.sandbox.ui5", v);
				} catch (err) {
					/* a remembered choice is only a convenience */
				}
				if (this._sandbox) {
					this._sandbox.ui5 = v;
					this._sandbox.load();
				}
			},

			onSandboxPage(e) {
				const route = this.viewModel().getProperty("/sandbox/routes").find((r) => r.name === e.getParameter("selectedItem").getKey());
				if (route && this._sandbox) this._sandbox.navigate(route.hash);
			},

			onSandboxPick() {
				const sb = this._sandbox;
				if (!sb) return;
				this.viewModel().setProperty("/sandbox/pickNote", "");
				sb.setPicking(!sb.picking);
			},

			onSandboxReplay() {
				if (this._sandbox) this._sandbox.play();
			},

			async onSandboxReload() {
				if (!this._sandbox) return;
				await this._loadSandboxInfo();
				this._sandbox.load();
			},

			async onSandboxReal(e) {
				if (!this._sandbox) return;
				this._sandbox.real = e.getParameter("selected");
				await this._loadSandboxInfo();
				this._sandbox.load();
			},

			/** The person clicked a control in the sandbox: it becomes the target of the selected step. */
			_onPick(p) {
				const sel = this._selected();
				if (!sel) return;
				const fallbacks = p.text ? [{ by: "text", value: p.text }] : [];
				if (!p.controlId && !fallbacks.length) return;
				this.commit(TM.setTarget(this._doc(), sel.id, Object.assign({}, p.viewName ? { viewName: p.viewName } : {}, p.controlId ? { controlId: p.controlId } : {}, { fallbacks })));
			},

			// ---- live: the tour in the real, running app ----

			async _syncLive() {
				const L = this._L;
				const doc = this._doc();
				const model = this.viewModel();
				const inline = this._valid ? L.buildInlineSnippet({ playerSource: L.playerSource, tour: doc }) : "";
				model.setProperty("/live/inline", inline);
				model.setProperty("/live/size", inline ? this.text("tourLiveSize", [Math.round(inline.length / 1024)]) : "");
				model.setProperty("/live/bookmarkTitle", "QuickDev: " + doc.title);
				const link = this.byId("liveBookmarklet");
				// a bookmarklet is a javascript: link: set on the element itself, clicking it here does nothing
				setTimeout(() => link.getDomRef() && link.getDomRef().setAttribute("href", inline ? L.toBookmarklet(inline) : "#"), 0);
				if (this._liveToken === null || this._liveToken === undefined) {
					try {
						this._liveToken = await this.getApi().capability("live", this._tour.ID);
					} catch (e) {
						this._liveToken = "";
					}
				}
				model.setProperty("/live/loader", L.buildLoaderSnippet({ origin: window.location.origin, tourId: this._tour.ID, token: this._liveToken }));
				model.setProperty("/live/loaderHelp", this.text("tourLoaderHelp", [window.location.origin]) + (this._stateName === "saved" ? "" : " " + this.text("tourLoaderUnsaved")));
			},

			onBookmarkClick(e) {
				e.preventDefault();
			},

			async _copy(text, path) {
				const model = this.viewModel();
				try {
					await navigator.clipboard.writeText(text);
					model.setProperty(path, this.text("copied"));
				} catch (e) {
					model.setProperty(path, this.text("tourCopyFailed"));
				}
				setTimeout(() => model.setProperty(path, ""), 3000);
			},

			onCopySnippet() {
				return this._copy(this.viewModel().getProperty("/live/inline"), "/live/copied");
			},

			onCopyLoader() {
				return this._copy(this.viewModel().getProperty("/live/loader"), "/live/copiedLoader");
			},

			// ---- JSON ----

			onJson(e) {
				let parsed;
				try {
					parsed = JSON.parse(e.getParameter("value"));
				} catch (err) {
					return; // syntax errors are marked in the editor; the working copy stays as it was
				}
				const result = this._L.validateTour(parsed);
				if (result.ok && JSON.stringify(result.tour) !== JSON.stringify(this._doc())) this.commit(result.tour, "json", "json");
			},

			// ---- choose the control of a step ----

			async onChooseControl() {
				const dialog = await this.dialog("TargetPickerDialog");
				dialog.setModel(new JSONModel({ query: "", items: [], truncated: "", noInventory: !this._inventory }), "tp");
				this._pickerFill("");
				dialog.open();
			},

			_pickerFill(query) {
				const model = this.byId("targetPicker").getModel("tp");
				const q = query.trim().toLowerCase();
				const items = [];
				let matches = 0;
				((this._inventory && this._inventory.controls) || []).forEach((control, index) => {
					const hay = [control.display, control.localId, control.type, control.viewName].filter(Boolean).join(" ").toLowerCase();
					if (q && !hay.includes(q)) return;
					matches++;
					if (matches > 150) return; // a big app has thousands of controls: the first ones, the search narrows it down
					items.push({
						index,
						group: control.viewName ? short(control.viewName) + "  (" + control.viewName + ")" : "(global)",
						title: control.display || control.localId || control.type.split(".").slice(-1)[0],
						description: control.type.split(".").slice(-1)[0] + " · " + (control.localId || "no id") + (control.scope === "fragment" ? " · dialog" : ""),
						info: control.hasStableId ? "" : "unstable",
						infoState: control.hasStableId ? "None" : "Warning"
					});
				});
				model.setProperty("/items", items);
				model.setProperty("/truncated", matches > 150 ? this.text("tourPickerTruncated", [150, matches]) : "");
			},

			onPickerSearch(e) {
				this._pickerFill(e.getParameter("newValue") !== undefined ? e.getParameter("newValue") : e.getParameter("value"));
			},

			onPickerPick(e) {
				const item = e.getSource().getBindingContext("tp").getObject();
				this.byId("targetPicker").close();
				this.commit(TM.setTarget(this._doc(), this._selected().id, this._L.targetFor(this._inventory.controls[item.index])));
			},

			onPickerClose() {
				this.byId("targetPicker").close();
			},

			// ---- version history ----

			async onHistory() {
				const dialog = await this.dialog("HistoryDialog");
				const model = new JSONModel({ versions: [], loading: true, busy: false, error: "" });
				dialog.setModel(model, "hist");
				dialog.open();
				try {
					const rows = await this.getApi().versions(this._tour.ID);
					const current = this.viewModel().getProperty("/version");
					model.setProperty(
						"/versions",
						rows.map((v) => Object.assign({}, v, { current: v.version === current, noteText: v.note || "Edited", whenText: Format.date(v.createdAt) }))
					);
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				} finally {
					model.setProperty("/loading", false);
				}
			},

			async onRestore(e) {
				const v = e.getSource().getBindingContext("hist").getObject();
				const model = this.byId("historyDialog").getModel("hist");
				model.setProperty("/busy", true);
				try {
					await this.flush(); // never restore over unsaved work
					this.adopt(await this.getApi().restoreVersion(this._tour.ID, v.version));
					this.byId("historyDialog").close();
				} catch (err) {
					model.setProperty("/error", this.errorMessage(err));
				} finally {
					model.setProperty("/busy", false);
				}
			},

			onHistoryClose() {
				this.byId("historyDialog").close();
			},

			// ---- named version ----

			async onSaveVersion() {
				const dialog = await this.dialog("VersionDialog");
				dialog.setModel(new JSONModel({ note: "" }), "ver");
				dialog.open();
			},

			async onVersionSave() {
				const dialog = this.byId("versionDialog");
				const note = (dialog.getModel("ver").getProperty("/note") || "").trim();
				if (!note) return;
				if (await this._save({ note, autosave: false })) dialog.close();
			},

			onVersionClose() {
				this.byId("versionDialog").close();
			},

			// ---- export ----

			async onExport() {
				const dialog = await this.dialog("ExportDialog");
				const model = new JSONModel({ loading: true, error: "", unsaved: !this._valid, ok: false, blockedShown: false, readyText: "", blockedText: "", blocking: [], warnings: [], filesIntro: "", filesText: "", copied: "" });
				dialog.setModel(model, "exp");
				dialog.open();
				try {
					await this.flush(); // the check looks at the saved tour
					const data = await this.getApi().exportCheck(this._tour.ID);
					model.setData({
						loading: false,
						error: "",
						unsaved: !this._valid,
						ok: data.ok,
						blockedShown: !data.ok,
						readyText: data.ok ? this.text("tourExportReady", [data.version]) : "",
						blockedText: data.ok ? "" : this.text("tourExportBlocked", [data.blocking.length]),
						blocking: data.blocking,
						warnings: data.warnings,
						filesIntro: this.text("tourExportFiles", [data.filename]),
						filesText: data.files.join(" · "),
						copied: ""
					});
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
					model.setProperty("/loading", false);
				}
			},

			_download(url) {
				const a = document.createElement("a");
				a.href = url;
				a.download = "";
				document.body.appendChild(a);
				a.click();
				a.remove();
			},

			onExportDownload() {
				this._download("/export/" + this._tour.ID + ".zip");
			},

			onExportForce() {
				this._download("/export/" + this._tour.ID + ".zip?force=1");
			},

			async onExportCopy() {
				const model = this.byId("exportDialog").getModel("exp");
				try {
					await navigator.clipboard.writeText(JSON.stringify(this._doc(), null, 2));
					model.setProperty("/copied", this.text("tourJsonCopied"));
				} catch (e) {
					model.setProperty("/copied", this.text("tourCopyFailedJson"));
				}
			},

			onExportJump(e) {
				const p = e.getSource().getBindingContext("exp").getObject();
				if (p.stepId) {
					this._select(p.stepId);
					this.byId("exportDialog").close();
				}
			},

			onExportClose() {
				this.byId("exportDialog").close();
			},

			// ---- ask the AI to edit a step ----

			async onAskAi() {
				const step = this._selected();
				const dialog = await this.dialog("AiDialog");
				const model = new JSONModel({ title: this.text("tourAiTitle", [step.title]), providers: [], provider: "", unavailable: false, instruction: "", presets: PRESETS.map((text) => ({ text })), busy: false, error: "" });
				dialog.setModel(model, "ai");
				dialog.open();
				try {
					const ai = (await this.getApi().providers()).filter((p) => p.id !== "rules" && p.configured);
					model.setProperty("/providers", ai);
					model.setProperty("/provider", ai[0] ? ai[0].id : "");
					model.setProperty("/unavailable", ai.length === 0);
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				}
			},

			onAiPreset(e) {
				this.byId("aiDialog").getModel("ai").setProperty("/instruction", e.getSource().getText());
			},

			async onAiRun() {
				const model = this.byId("aiDialog").getModel("ai");
				model.setProperty("/busy", true);
				model.setProperty("/error", "");
				try {
					if (!(await this.flush())) throw new Error(this.text("tourAiFix"));
					const row = await this.getApi().refineStep({
						tourID: this._tour.ID,
						stepID: this._selected().id,
						instruction: model.getProperty("/instruction").trim(),
						provider: model.getProperty("/provider"),
						model: ""
					});
					this.byId("aiDialog").close();
					this.adopt(row);
				} catch (e) {
					model.setProperty("/error", this.errorMessage(e));
				} finally {
					model.setProperty("/busy", false);
				}
			},

			onAiClose() {
				this.byId("aiDialog").close();
			},

			// ---- add to the project's files ----

			onApply() {
				this._apply = this._apply || new ApplyDialog(this);
				return this._apply.open({ kind: "tour", id: this._tour.ID, projectID: this._tour.project_ID, flush: () => this.flush() });
			}
		});
	}
);
