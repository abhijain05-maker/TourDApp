sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Format", "tourd/designer/util/ApplyDialog", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, ApplyDialog, JSONModel) {
		"use strict";

		const KIND_LABEL = { open: "Open", press: "Press", enterText: "Type", search: "Search", select: "Choose", assert: "Check" };
		const ASSERT_LABEL = { url: "The address contains", value: "The value is", selectedKey: "The selected key is", visible: "Is visible", text: "The text is", toast: "A message shows" };
		const DRY_LABEL = { found: "found in the app", missing: "not in the app", ambiguous: "several match", unchecked: "checked when it runs" };
		const DRY_STATE = { found: "Success", missing: "Error", ambiguous: "Warning", unchecked: "Information" };
		const STRATEGY_LABEL = {
			id: "by its id",
			ui5: "UI5's own selector (as its Test Recorder writes it)",
			i18n: "by its i18n text",
			text: "by its text",
			label: "by its label",
			binding: "by its binding path"
		};
		const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

		return BaseController.extend("tourd.designer.controller.TestPlan", {
			onInit() {
				this.setPlanModel(new JSONModel({ name: "", settings: {}, steps: [], locators: {} }));
				this.initViewModel({
					ready: false,
					loading: false,
					loadError: "",
					version: 0,
					dirty: false,
					saving: false,
					conflict: false,
					error: "",
					stateText: "Saved",
					auths: Object.entries(Format.AUTH_LABEL).map(([key, text]) => ({ key, text })),
					authSel: {},
					needsCredentials: false,
					customAuth: false,
					settingsSummary: "",
					stepsSummary: "",
					locatorsSummary: "",
					enabledSteps: 0,
					existingText: "",
					dryText: "",
					dryType: "Success",
					rows: [],
					locatorItems: [],
					assertTypes: Object.entries(ASSERT_LABEL).map(([key, text]) => ({ key, text })),
					locators: [],
					files: { show: false, list: [], blocked: "", path: "", runHtml: "" }
				});
				this.getRouter().getRoute("testplan").attachPatternMatched(this._onMatched, this);
				// Ctrl+S saves the plan, not the page
				this._onKey = (e) => {
					if (this._row && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
						e.preventDefault();
						this.onSave();
					}
				};
				window.addEventListener("keydown", this._onKey);
				this._onUnload = (e) => {
					if (this._row && this.viewModel().getProperty("/dirty")) e.preventDefault();
				};
				window.addEventListener("beforeunload", this._onUnload);
				this.getRouter().attachRouteMatched((e) => {
					if (e.getParameter("name") !== "testplan") this._row = null;
				});
			},

			onExit() {
				window.removeEventListener("keydown", this._onKey);
				window.removeEventListener("beforeunload", this._onUnload);
			},

			setPlanModel(model) {
				this._plan = model;
				model.setSizeLimit(5000);
				this.getView().setModel(model, "plan");
				// edits made in the fields of the form (a two-way binding)
				model.attachPropertyChange(() => this._afterEdit());
			},

			async _onMatched(e) {
				const id = e.getParameter("arguments").id;
				if (this._row && this._row.ID === id) return;
				const model = this.viewModel();
				model.setProperty("/ready", false);
				model.setProperty("/loading", true);
				model.setProperty("/loadError", "");
				try {
					const row = await this.getApi().testPlan(id);
					this._row = row;
					this._take(row);
					model.setProperty("/ready", true);
				} catch (err) {
					model.setProperty("/loadError", this.errorMessage(err));
				} finally {
					model.setProperty("/loading", false);
				}
			},

			/** Takes a plan from the server as the working copy. */
			_take(row) {
				const plan = JSON.parse(row.definition);
				this._saved = JSON.stringify(plan);
				this._plan.setData(plan);
				const m = this.viewModel();
				m.setProperty("/version", row.version);
				m.setProperty("/conflict", false);
				m.setProperty("/error", "");
				m.setProperty("/authSel", Object.assign({ username: "input[id='username']", password: "input[id='password']", submit: "button[type='submit']" }, plan.settings.authSelectors));
				this._preview = null;
				this._dry = null;
				this._afterEdit();
				this.getBus().publish("tourd", "changed", { what: "tests" });
				this._loadAux(row);
			},

			/** What the project already has, the dry run against its files and the generated files. */
			async _loadAux(row) {
				const api = this.getApi();
				const [preview, dry] = await Promise.all([api.previewTestApply(row.ID).catch(() => null), api.dryRunTestPlan(row.ID).catch(() => null)]);
				if (!this._row || this._row.ID !== row.ID || this.viewModel().getProperty("/version") !== row.version) return;
				this._preview = preview;
				this._dry = dry;
				this._existing = preview && preview.existing ? JSON.parse(preview.existing) : null;
				this._afterEdit();
			},

			onHome() {
				this.getRouter().navTo("projects");
			},

			onToTests() {
				this.getRouter().navTo("project", { id: this._row.project_ID, "?query": { tab: "tests" } });
			},

			// ---- derived state ----

			_afterEdit() {
				if (!this._row) return;
				const plan = this._plan.getData();
				const m = this.viewModel();
				const dirty = JSON.stringify(plan) !== this._saved;
				const s = plan.settings;
				const steps = plan.steps;
				const enabled = steps.filter((x) => x.enabled && !["open", "assert"].includes(x.kind)).length;
				m.setProperty("/dirty", dirty);
				m.setProperty("/stateText", m.getProperty("/saving") ? "Saving…" : dirty ? "Unsaved changes" : "Saved");
				m.setProperty("/enabledSteps", enabled);
				m.setProperty("/needsCredentials", s.auth !== "none");
				m.setProperty("/customAuth", s.auth === "custom");
				m.setProperty("/settingsSummary", (s.framework === "jasmine" ? "Jasmine" : "Mocha") + " · " + (Format.AUTH_LABEL[s.auth] || s.auth) + " · " + s.baseUrl);
				m.setProperty("/stepsSummary", this.text("planStepsSummary", [enabled, steps.length]));
				const names = Object.keys(plan.locators);
				const dry = this._dry && !dirty ? this._dry : null;
				m.setProperty("/locatorsSummary", names.length + " control(s)" + (dry ? ": " + dry.summary.found + " found in the app" + (dry.summary.missing ? ", " + dry.summary.missing + " not in the app" : "") : ""));
				m.setProperty("/dryText", dry ? this.text("planDry", [dry.summary.found]) + (dry.summary.missing ? this.text("planDryMissing", [dry.summary.missing]) : "") + (dry.summary.ambiguous ? this.text("planDryAmbiguous", [dry.summary.ambiguous]) : "") + (dry.summary.unchecked ? this.text("planDryUnchecked", [dry.summary.unchecked]) : "") + "." : "");
				m.setProperty("/dryType", dry ? (dry.summary.missing ? "Error" : dry.summary.ambiguous ? "Warning" : "Success") : "Success");

				const ex = this._existing;
				m.setProperty(
					"/existingText",
					ex
						? this.text("planExisting", [ex.config, ex.framework === "jasmine" ? "Jasmine" : "Mocha", ex.esm ? "ES modules" : "CommonJS", ex.specFile, ex.journeyFile]) +
								" " +
								(ex.reuse.steps.length + ex.reuse.setup.length > 0 ? this.text("planCalls", [ex.reuse.steps.length + ex.reuse.setup.length]) : ex.helpers ? this.text("planNoHelperFits") : this.text("planNoHelpers")) +
								(ex.configReaches ? "" : " " + this.text("planConfigMissing"))
						: ""
				);
				this._syncRows(plan, dirty, dry);
				this._syncFiles(plan, dirty);
			},

			_syncRows(plan, dirty, dry) {
				const m = this.viewModel();
				const ex = this._existing;
				const names = Object.keys(plan.locators);
				m.setProperty("/locatorItems", [{ key: "", text: "(none)" }].concat(names.map((k) => ({ key: k, text: k }))));
				m.setProperty(
					"/rows",
					plan.steps.map((s, i) => {
						const reuse = ex && ex.reuse.steps.find((r) => r.stepID === s.id);
						const showReuse = !!reuse && !s.noReuse && !dirty;
						const d = dry && dry.steps[s.id];
						const a = s.assertion;
						const showHeuristic = !!s.heuristic && !s.edited;
						return {
							index: i,
							number: i + 1,
							enabled: s.enabled,
							canToggle: s.kind !== "open",
							kindLabel: KIND_LABEL[s.kind],
							isAssert: s.kind === "assert",
							title: s.title,
							showHeuristic,
							edited: !!s.edited,
							note: s.note || "",
							showReuse,
							reuseText: reuse ? "uses " + reuse.name + "() of your project" : "",
							reuseFile: reuse ? reuse.file : "",
							noReuse: !!s.noReuse,
							hasMeta: showHeuristic || !!s.edited || !!s.note || showReuse || !!s.noReuse,
							showControl: s.kind !== "open" && !(a && (a.type === "url" || a.type === "toast")),
							locator: s.locator || "",
							dryText: d ? DRY_LABEL[d] : "",
							dryState: d ? DRY_STATE[d] : "None",
							dryNote: d && s.locator && dry.locators[s.locator] ? dry.locators[s.locator].note : "",
							valueKind: s.kind === "enterText" || s.kind === "search" ? "text" : s.kind === "select" ? "choice" : s.kind === "assert" ? "assert" : s.kind === "open" ? "open" : "none",
							value: s.value || "",
							choice: s.choice || "",
							assertType: a ? a.type : "",
							expected: (a && a.expected) || "",
							showExpected: !!a && a.type !== "visible",
							openText: s.hash ? "starts at #" + s.hash : "wdi5 opens the app",
							canUp: i >= 2,
							canDown: i !== 0 && i !== plan.steps.length - 1,
							canAddCheck: s.kind !== "assert" && s.kind !== "open",
							canRemove: s.kind !== "open"
						};
					})
				);
				m.setProperty(
					"/locators",
					names.map((k) => {
						const l = plan.locators[k];
						const dl = dry && dry.locators[k];
						return {
							name: k,
							display: l.display || l.controlType,
							strategy: l.strategy,
							options: [l.strategy].concat(l.alternatives.map((x) => x.strategy)).map((x) => ({ key: x, text: STRATEGY_LABEL[x] || x })),
							code: JSON.stringify({ selector: l.selector }),
							dryText: dl ? DRY_LABEL[dl.status] : "",
							dryState: dl ? DRY_STATE[dl.status] : "None",
							note: (dl && dl.note) || (l.note && l.strategy !== "id" ? l.note : "")
						};
					})
				);
			},

			_syncFiles(plan, dirty) {
				const m = this.viewModel();
				const p = this._preview;
				if (dirty || !p) return m.setProperty("/files/show", false);
				const edits = p.edits;
				const first = edits.find((e) => /\.test\.js$|\.spec\.js$/.test(e.path)) || edits[0];
				const keep = edits.find((e) => e.path === this._shownFile) || first;
				this._shownFile = keep ? keep.path : null;
				const s = plan.settings;
				m.setProperty("/files/show", true);
				m.setProperty("/files/blocked", p.ok ? "" : (p.blocking[0] && p.blocking[0].message) || "");
				m.setProperty(
					"/files/list",
					edits.map((e) => ({ name: e.path.split("/").pop(), path: e.path, what: e.what, state: e.action === "add" ? "new" : "changed", stateType: e.action === "add" ? "Success" : "Warning", shown: keep && e.path === keep.path }))
				);
				m.setProperty("/files/path", keep ? keep.path : "");
				m.setProperty(
					"/files/runHtml",
					"<ol><li>" + this.text("planRun1", [esc(s.baseUrl)]) + (this._existing ? "" : " " + this.text("planRun1b")) + "</li><li><code>npm install</code></li><li><code>npx wdio run wdio.conf.js</code> " +
						(this._existing ? this.text("planRun3a") : this.text("planRun3b")) + "</li>" + (s.auth !== "none" ? "<li>" + this.text("planRun4") + "</li>" : "") + "</ol>"
				);
				const ed = this.byId("filesEditor");
				if (ed && keep) {
					ed.setPath(keep.path);
					ed.setValue(keep.after);
				}
			},

			onShowFile(e) {
				const f = e.getParameter("listItem").getBindingContext("view").getObject();
				this._shownFile = f.path;
				const edit = this._preview.edits.find((x) => x.path === f.path);
				const ed = this.byId("filesEditor");
				ed.setPath(f.path);
				ed.setValue(edit.after);
				this.viewModel().setProperty("/files/path", f.path);
			},

			// ---- editing the steps ----

			_rowOf(e) {
				return e.getSource().getBindingContext("view").getObject().index;
			},

			_setStep(i, patch) {
				Object.keys(patch).forEach((k) => this._plan.setProperty("/steps/" + i + "/" + k, patch[k]));
				this._plan.setProperty("/steps/" + i + "/edited", true);
				this._afterEdit();
			},

			onToggle(e) {
				this._setStep(this._rowOf(e), { enabled: e.getParameter("selected") });
			},

			onStepTitle(e) {
				this._setStep(this._rowOf(e), { title: e.getParameter("value") });
			},

			onStepValue(e) {
				this._setStep(this._rowOf(e), { value: e.getParameter("value") });
			},

			onStepChoice(e) {
				this._setStep(this._rowOf(e), { choice: e.getParameter("value") });
			},

			onLocator(e) {
				this._setStep(this._rowOf(e), { locator: e.getParameter("selectedItem").getKey() || null });
			},

			onAssertType(e) {
				const i = this._rowOf(e);
				const a = this._plan.getProperty("/steps/" + i + "/assertion");
				this._setStep(i, { assertion: Object.assign({}, a, { type: e.getParameter("selectedItem").getKey() }) });
			},

			onExpected(e) {
				const i = this._rowOf(e);
				const a = this._plan.getProperty("/steps/" + i + "/assertion");
				this._setStep(i, { assertion: Object.assign({}, a, { expected: e.getParameter("value") }) });
			},

			onNoReuse(e) {
				this._setStep(this._rowOf(e), { noReuse: true });
			},

			onUseReuse(e) {
				this._setStep(this._rowOf(e), { noReuse: false });
			},

			onMove(by, e) {
				const i = this._rowOf(e);
				const j = i + by;
				const steps = this._plan.getProperty("/steps").slice();
				if (j < 1 || j >= steps.length) return; // the first step opens the app
				[steps[i], steps[j]] = [steps[j], steps[i]];
				this._plan.setProperty("/steps", steps);
				this._afterEdit();
			},

			onRemoveStep(e) {
				const steps = this._plan.getProperty("/steps").slice();
				steps.splice(this._rowOf(e), 1);
				this._plan.setProperty("/steps", steps);
				this._afterEdit();
			},

			onAddCheck(e) {
				const i = this._rowOf(e);
				const plan = this._plan.getData();
				const after = plan.steps[i];
				const key = after.locator;
				const steps = plan.steps.slice();
				steps.splice(i + 1, 0, {
					id: "s" + Date.now().toString(36),
					kind: "assert",
					title: key ? "Check " + ((plan.locators[key] && plan.locators[key].display) || key) : "Check the address",
					enabled: true,
					locator: key,
					assertion: key ? { type: "visible" } : { type: "url", expected: "" },
					edited: true
				});
				this._plan.setProperty("/steps", steps);
				this._afterEdit();
			},

			onStrategy(e) {
				const name = e.getSource().getBindingContext("view").getObject().name;
				const strategy = e.getParameter("selectedItem").getKey();
				const l = this._plan.getProperty("/locators/" + name);
				if (strategy === l.strategy) return;
				const all = [{ strategy: l.strategy, selector: l.selector }].concat(l.alternatives);
				const chosen = all.find((a) => a.strategy === strategy);
				if (chosen) this._plan.setProperty("/locators/" + name, Object.assign({}, l, { strategy: chosen.strategy, selector: chosen.selector, alternatives: all.filter((a) => a !== chosen) }));
				this._afterEdit();
			},

			onAuthSelector(key, e) {
				const sel = this.viewModel().getProperty("/authSel");
				const next = Object.assign({}, sel, { [key]: e.getParameter("value") });
				this.viewModel().setProperty("/authSel", next);
				this._plan.setProperty("/settings/authSelectors", next);
				this._afterEdit();
			},

			// ---- save, start over, add to the project ----

			async onSave() {
				const m = this.viewModel();
				if (!m.getProperty("/dirty") || m.getProperty("/saving")) return;
				m.setProperty("/saving", true);
				m.setProperty("/error", "");
				try {
					const row = await this.getApi().saveTestPlan(this._row.ID, JSON.stringify(this._plan.getData()), m.getProperty("/version"));
					this._row = row;
					m.setProperty("/saving", false);
					this._take(row);
				} catch (e) {
					m.setProperty("/saving", false);
					if (e.status === 409) m.setProperty("/conflict", true);
					else m.setProperty("/error", this.errorMessage(e));
					this._afterEdit();
				}
			},

			async onDiscard() {
				try {
					const row = await this.getApi().testPlan(this._row.ID);
					this._row = row;
					this._take(row);
				} catch (e) {
					this.viewModel().setProperty("/error", this.errorMessage(e));
				}
			},

			async onRebuild() {
				if (!(await this.confirm(this.text("planRebuildText"), this.text("planRebuildTitle"), this.text("planRebuildTitle")))) return;
				try {
					const row = await this.getApi().rebuildTestPlan(this._row.ID);
					this._row = row;
					this._take(row);
				} catch (e) {
					this.viewModel().setProperty("/error", this.errorMessage(e));
				}
			},

			onApply() {
				this._apply = this._apply || new ApplyDialog(this);
				return this._apply.open({ kind: "tests", id: this._row.ID, projectID: this._row.project_ID });
			}
		});
	}
);
