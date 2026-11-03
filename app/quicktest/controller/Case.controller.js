sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Meta", "quicktest/util/Format", "quicktest/util/Files", "quicktest/util/Code", "quicktest/util/AiFlow", "quicktest/util/RecordFlow", "quicktest/util/RunFlow", "sap/ui/model/json/JSONModel"],
	function (BaseController, Meta, Format, Files, Code, AiFlow, RecordFlow, RunFlow, JSONModel) {
		"use strict";

		const FIELDS = ["title", "objective", "preconditions", "priority", "kind", "status", "tags", "owner"];
		const BLANK = { title: "", objective: "", preconditions: "", priority: "medium", kind: "functional", status: "draft", tags: "", owner: "", automation: "manual" };
		const FOUND = { found: ["Success", "foundYes"], ambiguous: ["Warning", "foundAmbiguous"], missing: ["Error", "foundNo"], unchecked: ["None", "foundUnchecked"] };

		return BaseController.extend("quicktest.controller.Case", {
			onInit() {
				const model = this.initViewModel({
					item: Object.assign({}, BLANK),
					steps: [],
					linked: [],
					linkedRows: [],
					allReqs: [],
					versions: [],
					auto: null,
					code: { key: "", files: [], problem: "" },
					section: "steps",
					dirty: false,
					busy: false,
					autoBusy: false,
					error: "",
					info: "",
					metaText: "",
					priorities: Meta.items("priorities"),
					kinds: Meta.items("caseKinds"),
					statuses: Meta.items("caseStatuses")
				});
				model.attachPropertyChange((e) => {
					const path = String(e.getParameter("path"));
					if (path.startsWith("/item") || path.startsWith("/steps") || path.startsWith("/linked")) this._dirtyCheck();
				});
				this.getRouter().getRoute("case").attachPatternMatched(this._onMatched, this);
				this._onKey = (e) => {
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && this.getView().getDomRef() && this.getView().getDomRef().offsetParent) {
						e.preventDefault();
						if (this.viewModel().getProperty("/dirty")) this.onSave();
					}
				};
				window.addEventListener("keydown", this._onKey);
			},

			onExit() {
				window.removeEventListener("keydown", this._onKey);
			},

			async _onMatched(e) {
				const args = e.getParameter("arguments");
				const query = args["?query"] || {};
				this._projectId = args.id;
				this._caseId = args.caseId;
				this.appModel().setProperty("/navKey", args.id);
				const model = this.viewModel();
				model.setProperty("/section", ["steps", "details", "requirements", "automation", "history"].includes(query.section) ? query.section : "steps");
				model.setProperty("/info", "");
				model.setProperty("/error", "");
				model.setProperty("/auto", null);
				model.setProperty("/versions", []);
				await this._load(query.req);
				if (model.getProperty("/section") === "automation") this._loadAuto();
				if (model.getProperty("/section") === "history") this._loadVersions();
			},

			_snapshot() {
				const m = this.viewModel();
				const i = m.getProperty("/item");
				return JSON.stringify([FIELDS.map((f) => i[f] || ""), m.getProperty("/steps").map((s) => [s.action, s.data, s.expected]), m.getProperty("/linked").slice().sort()]);
			},

			_dirtyCheck() {
				this.viewModel().setProperty("/dirty", this._snapshot() !== this._saved);
			},

			_number(steps) {
				return steps.map((s, i) => Object.assign({}, s, { n: i + 1 }));
			},

			async _load(preLinkReq) {
				const model = this.viewModel();
				const api = this.getApi();
				const reqs = await api.requirements(this._projectId).catch(() => []);
				model.setProperty("/allReqs", reqs.map((r) => ({ ID: r.ID, code: r.code, title: r.title, priority: r.priority, text: r.code + "  " + r.title })));
				if (this._caseId === "new") {
					model.setProperty("/item", Object.assign({}, BLANK));
					model.setProperty("/steps", this._number([{ id: "", action: "", data: "", expected: "", auto: [] }]));
					model.setProperty("/linked", preLinkReq ? [preLinkReq] : []);
					this._linkedRows();
					model.setProperty("/metaText", "");
					this._saved = JSON.stringify([FIELDS.map(() => ""), [["", "", ""]], preLinkReq ? [preLinkReq] : []]);
					model.setProperty("/dirty", !!preLinkReq);
					return;
				}
				const item = await this.attempt(() => api.testCase(this._caseId), "/busy");
				if (!item) return;
				this._apply(item);
			},

			/** Puts a case from the server into the editor and makes it the saved state. */
			_apply(item) {
				const model = this.viewModel();
				model.setProperty("/item", item);
				model.setProperty("/steps", this._number(item.steps.length ? item.steps : []));
				model.setProperty("/linked", item.requirementIDs.slice());
				this._linkedRows();
				model.setProperty("/metaText", this.text("caseMeta", [item.version, Format.date(item.modifiedAt), item.modifiedBy || "–", item.origin]));
				this._saved = this._snapshot();
				model.setProperty("/dirty", false);
			},

			_linkedRows() {
				const model = this.viewModel();
				const keys = new Set(model.getProperty("/linked"));
				model.setProperty("/linkedRows", model.getProperty("/allReqs").filter((r) => keys.has(r.ID)));
			},

			onBack() {
				this.toProject("cases");
			},

			autoText(n) {
				return this.text("stepAutomated", [n]);
			},

			// ---- saving ----

			_payload() {
				const m = this.viewModel();
				const i = m.getProperty("/item");
				const data = {};
				FIELDS.forEach((f) => (data[f] = i[f] || ""));
				data.steps = m.getProperty("/steps").map((s) => ({ id: s.id || undefined, action: s.action, data: s.data, expected: s.expected, auto: s.auto || [] }));
				data.requirementIDs = m.getProperty("/linked").slice();
				return data;
			},

			async onSave() {
				const model = this.viewModel();
				const item = model.getProperty("/item");
				const saved = await this.attempt(() => this.getApi().saveCase(this._projectId, item.ID, this._payload()), "/busy");
				if (!saved) return false;
				this.toast(this.text("saved"));
				this.getBus().publish("qt", "changed", { what: "cases" });
				if (!item.ID) this.getRouter().navTo("case", { id: this._projectId, caseId: saved.ID }, true);
				else {
					this._apply(saved);
					this._loadVersions();
				}
				return true;
			},

			// ---- steps ----

			_stepIndex(e) {
				return Number(e.getSource().getBindingContext("view").getPath().split("/").pop());
			},

			_setSteps(steps) {
				this.viewModel().setProperty("/steps", this._number(steps));
				this._dirtyCheck();
			},

			onAddStep() {
				this._setSteps(this.viewModel().getProperty("/steps").concat([{ id: "", action: "", data: "", expected: "", auto: [] }]));
			},

			onStepInsert(e) {
				const steps = this.viewModel().getProperty("/steps").slice();
				steps.splice(this._stepIndex(e) + 1, 0, { id: "", action: "", data: "", expected: "", auto: [] });
				this._setSteps(steps);
			},

			onStepRemove(e) {
				const steps = this.viewModel().getProperty("/steps").slice();
				steps.splice(this._stepIndex(e), 1);
				this._setSteps(steps);
			},

			_move(e, by) {
				const steps = this.viewModel().getProperty("/steps").slice();
				const i = this._stepIndex(e);
				const j = i + by;
				if (j < 0 || j >= steps.length) return;
				[steps[i], steps[j]] = [steps[j], steps[i]];
				this._setSteps(steps);
			},

			onStepUp(e) {
				this._move(e, -1);
			},

			onStepDown(e) {
				this._move(e, 1);
			},

			async onPasteSteps() {
				const dialog = await this.dialog("PasteStepsDialog");
				dialog.setModel(new JSONModel({ text: "", replace: false }), "paste");
				dialog.open();
			},

			onPasteStepsClose() {
				this.byId("pasteStepsDialog").close();
			},

			/** One step per line; "action -> expected", "action => expected" or "action | expected" also gives the expected result. */
			onPasteStepsAdd() {
				const d = this.byId("pasteStepsDialog").getModel("paste").getData();
				const added = d.text
					.split(/\r?\n/)
					.map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
					.filter(Boolean)
					.map((l) => {
						const [action, ...rest] = l.split(/\s*(?:->|=>|\|)\s*/);
						return { id: "", action: action.trim(), data: "", expected: rest.join(" ").trim(), auto: [] };
					});
				const current = d.replace ? [] : this.viewModel().getProperty("/steps").filter((s) => s.action || s.data || s.expected);
				this._setSteps(current.concat(added));
				this.byId("pasteStepsDialog").close();
			},

			// ---- requirements ----

			onLinksChanged() {
				this._linkedRows();
				this._dirtyCheck();
			},

			onOpenRequirement(e) {
				const r = e.getSource().getBindingContext("view").getObject();
				this.getRouter().navTo("requirement", { id: this._projectId, reqId: r.ID });
			},

			// ---- sections ----

			onSection(e) {
				const key = e.getParameter("key");
				this.viewModel().setProperty("/section", key);
				if (key === "automation" && this.viewModel().getProperty("/item/ID")) this._loadAuto();
				if (key === "history" && this.viewModel().getProperty("/item/ID")) this._loadVersions();
			},

			async _loadVersions() {
				const id = this.viewModel().getProperty("/item/ID");
				if (!id) return;
				const rows = await this.getApi().caseVersions(id).catch(() => []);
				this.viewModel().setProperty("/versions", rows);
			},

			async onRestore(e) {
				const v = e.getSource().getBindingContext("view").getObject();
				if (!(await this.confirm(this.text("restoreText", [v.version]), this.text("restore"), this.text("restore")))) return;
				const item = await this.attempt(() => this.getApi().restoreCaseVersion(this._caseId, v.version), "/busy");
				if (!item) return;
				this._apply(item);
				this._loadVersions();
				this.getBus().publish("qt", "changed", { what: "cases" });
			},

			// ---- more ----

			async onMore(e) {
				const key = e.getParameter("item").getKey();
				const item = this.viewModel().getProperty("/item");
				if (key === "run") return RunFlow.get(this.getOwnerComponent()).open({ projectID: this._projectId, caseIDs: [item.ID] });
				if (key === "duplicate") {
					const copy = await this.attempt(() => this.getApi().duplicateCase(item.ID), "/busy");
					if (copy) {
						this.getBus().publish("qt", "changed", { what: "cases" });
						this.getRouter().navTo("case", { id: this._projectId, caseId: copy.ID });
					}
					return;
				}
				if (!(await this.confirm(this.text("deleteCaseText", [item.code, item.title]), this.text("delete"), this.text("delete")))) return;
				await this.attempt(async () => {
					await this.getApi().deleteCase(item.ID);
					this.getBus().publish("qt", "changed", { what: "cases" });
					this.toProject("cases");
				});
			},

			// ---- AI ----

			onImprove() {
				const m = this.viewModel();
				const i = m.getProperty("/item");
				AiFlow.get(this.getOwnerComponent()).improve({
					projectID: this._projectId,
					entity: "testcase",
					draft: { title: i.title, objective: i.objective, preconditions: i.preconditions, priority: i.priority, kind: i.kind, steps: m.getProperty("/steps").map((s) => ({ action: s.action, data: s.data, expected: s.expected })) },
					onApply: (item) => {
						["title", "objective", "preconditions", "priority", "kind"].forEach((f) => item[f] !== undefined && m.setProperty("/item/" + f, item[f]));
						const old = m.getProperty("/steps");
						// the steps keep their link to the automation only while their number is the same
						this._setSteps((item.stepList || []).map((s, n) => ({ id: old.length === item.stepList.length ? old[n].id : "", action: s.action, data: s.data, expected: s.expected, auto: old.length === item.stepList.length ? old[n].auto || [] : [] })));
						this._dirtyCheck();
					}
				});
			},

			// ---- automation ----

			async _ensureSaved() {
				if (this.viewModel().getProperty("/dirty") || !this.viewModel().getProperty("/item/ID")) return this.onSave();
				return true;
			},

			async _automate(provider) {
				if (!(await this._ensureSaved())) return;
				const id = this._caseId === "new" ? this.viewModel().getProperty("/item/ID") : this._caseId;
				if (!id) return;
				const out = await this.attempt(() => this.getApi().automateCase({ caseID: id, provider }), "/autoBusy");
				if (!out) return;
				this._apply(out.case);
				const r = out.report;
				this.viewModel().setProperty("/info", this.text("automatedInfo", [r.automated, r.steps, r.unresolved, r.manualOnly.length]));
				this.getBus().publish("qt", "changed", { what: "cases" });
				await this._loadAuto();
			},

			onAutomateRules() {
				this._automate("rules");
			},

			onAutomateAi() {
				this._automate(this.provider() === "rules" ? "" : this.provider());
			},

			async onAutomateMenu(e) {
				const key = e.getParameter("item").getKey();
				if (key === "rules") return this._automate("rules");
				if (key === "ai") return this.onAutomateAi();
				if (key === "recording") return this.onAttachRecording();
				const item = this.viewModel().getProperty("/item");
				if (!(await this.confirm(this.text("detachText", [item.code]), this.text("automateRemove"), this.text("automateRemove")))) return;
				const out = await this.attempt(() => this.getApi().detachAutomation(item.ID), "/busy");
				if (out) {
					this._apply(out);
					this.viewModel().setProperty("/auto", null);
					this.getBus().publish("qt", "changed", { what: "cases" });
				}
			},

			async onAttachRecording() {
				if (!(await this._ensureSaved())) return;
				const item = this.viewModel().getProperty("/item");
				const id = item.ID || this._caseId;
				RecordFlow.get(this.getOwnerComponent()).attach({
					projectID: this._projectId,
					caseID: id,
					caseTitle: item.title,
					onDone: async (c) => {
						this._apply(await this.getApi().testCase(c.ID));
						this.getBus().publish("qt", "changed", { what: "cases" });
						this.viewModel().setProperty("/section", "automation");
						this._loadAuto();
					}
				});
			},

			async _loadAuto() {
				const model = this.viewModel();
				const item = model.getProperty("/item");
				if (!item.ID || !item.plan) {
					model.setProperty("/auto", null);
					return;
				}
				const api = this.getApi();
				const a = await this.attempt(() => api.automation(item.ID), "/autoBusy");
				if (!a) return;
				const dry = a.dryRun;
				const rows = a.plan.steps.map((s) => {
					const locator = s.locator ? a.plan.locators[s.locator] : null;
					const found = dry && dry.steps[s.id] ? dry.steps[s.id] : "";
					const f = FOUND[found];
					return { id: s.id, kind: s.kind, title: s.title, enabled: s.enabled !== false, note: s.note || "", target: locator ? (locator.display || locator.name) + " · " + locator.strategy : "", foundText: f ? this.text(f[1]) : "", foundState: f ? f[0] : "None" };
				});
				const d = dry ? dry.summary : null;
				model.setProperty("/auto", {
					planID: a.planID,
					generatorText: a.generator === "rules" ? this.text("genRules") : a.generator === "manual" ? this.text("genManual") : a.generator,
					coverageText: this.text("autoCoverage", [a.coverage.mapped, a.coverage.steps, rows.filter((r) => r.enabled).length, rows.filter((r) => !r.enabled).length]),
					dryText: d ? this.text("autoDry", [d.found, d.missing + d.ambiguous, d.unchecked]) : this.text("autoDryNone"),
					settings: { baseUrl: a.plan.settings.baseUrl, framework: a.plan.settings.framework, auth: a.plan.settings.auth },
					rows,
					designerUrl: "/designer-ui5/index.html#/tests/" + a.planID
				});
				// the generated code, as it would be added to the project
				const code = await api.automationCode(item.ID).catch((e) => ({ ok: false, blocking: [{ message: e.message }], files: [] }));
				this._files = code.files || [];
				model.setProperty("/code", { key: this._files[0] ? this._files[0].path : "", files: this._files.map((f) => ({ path: f.path })), problem: code.ok ? "" : (code.blocking[0] || {}).message || "" });
				this._showCode();
			},

			_showCode() {
				const key = this.viewModel().getProperty("/code/key");
				const f = this._files.find((x) => x.path === key);
				const html = this.byId("autoCodeHtml");
				if (html) html.setContent("<pre class='qtCodeBox'>" + (f ? Code.highlight(f.content) : "") + "</pre>");
			},

			onCodeFile() {
				this._showCode();
			},

			async onCopyCode() {
				const f = this._files.find((x) => x.path === this.viewModel().getProperty("/code/key"));
				if (f) this.toast((await Files.copy(f.content)) ? this.text("copied") : this.text("copyFailed"));
			},

			async onSettingsChange() {
				const s = this.viewModel().getProperty("/auto/settings");
				const out = await this.attempt(() => this.getApi().automationSettings(this.viewModel().getProperty("/item/ID"), s), "/autoBusy");
				if (out) {
					this.toast(this.text("saved"));
					this._loadAuto();
				}
			},

			async onAddToProject() {
				const a = this.viewModel().getProperty("/auto");
				if (!(await this.confirm(this.text("addToProjectText"), this.text("autoAddToProject"), this.text("add")))) return;
				const out = await this.attempt(() => this.getApi().applyTestToProject(a.planID, true), "/autoBusy");
				if (out) this.viewModel().setProperty("/info", this.text("addedToProject", [out.applied]));
			},

			onDownloadCase() {
				Files.download(this.getApi().url.wdi5(this._projectId, [this.viewModel().getProperty("/item/ID")]));
			}
		});
	}
);
