sap.ui.define(
	["quicktest/controller/BaseController", "quicktest/util/Format", "quicktest/util/Files", "sap/ui/model/json/JSONModel"],
	function (BaseController, Format, Files, JSONModel) {
		"use strict";

		const KEYS = ["passed", "failed", "blocked", "skipped", "notrun"];

		return BaseController.extend("quicktest.controller.Run", {
			onInit() {
				const t = this.text.bind(this);
				this.initViewModel({
					run: {},
					runMeta: "",
					items: [],
					shown: [],
					filter: "",
					filters: [{ id: "", label: t("runAllItems") }, { id: "open", label: t("runToDo") }].concat(["failed", "passed", "blocked", "skipped"].map((k) => ({ id: k, label: Format.resultText(k) }))),
					cur: null,
					bar: [],
					passValue: 0,
					passState: "None",
					progressText: "",
					busy: false,
					itemBusy: false,
					error: ""
				});
				this.getRouter().getRoute("run").attachPatternMatched(this._onMatched, this);
				// keys: P pass, F fail, B blocked, S skip, J / K next / previous (not while typing)
				this._onKey = (e) => {
					const dom = this.getView().getDomRef();
					if (!dom || !dom.offsetParent || e.ctrlKey || e.metaKey || e.altKey) return;
					const tag = (e.target.tagName || "").toLowerCase();
					if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
					const k = e.key.toLowerCase();
					const verdict = { p: "passed", f: "failed", b: "blocked", s: "skipped" }[k];
					if (verdict) this.onVerdict(verdict);
					else if (k === "j") this.onNext();
					else if (k === "k") this.onPrev();
				};
				window.addEventListener("keydown", this._onKey);
			},

			onExit() {
				window.removeEventListener("keydown", this._onKey);
			},

			async _onMatched(e) {
				const args = e.getParameter("arguments");
				this._projectId = args.id;
				this._runId = args.runId;
				this.appModel().setProperty("/navKey", args.id);
				this.viewModel().setProperty("/cur", null);
				this._selected = null;
				await this._load(true);
			},

			async _load(pickFirst) {
				const run = await this.attempt(() => this.getApi().run(this._runId), "/busy");
				if (!run) return;
				const m = this.viewModel();
				m.setProperty("/run", run);
				m.setProperty("/runMeta", [run.build && this.text("runBuildOf", [run.build]), run.environment, run.note].filter(Boolean).join(" · "));
				m.setProperty("/items", run.items);
				this._summary();
				this._applyFilter();
				if (pickFirst && run.items.length) {
					const first = run.items.find((i) => i.status === "notrun") || run.items[0];
					await this._select(first.ID);
				}
			},

			/** The ring, the bar and the text above the list, from the items. */
			_summary() {
				const m = this.viewModel();
				const items = m.getProperty("/items");
				const counts = Object.fromEntries(KEYS.map((k) => [k, items.filter((i) => i.status === k).length]));
				const done = items.length - counts.notrun;
				const rate = done ? Math.round((counts.passed / done) * 100) : 0;
				m.setProperty("/bar", KEYS.map((k) => ({ value: counts[k], cls: "qtResult-" + k, label: Format.resultText(k) })));
				m.setProperty("/passValue", rate / 100);
				m.setProperty("/passState", done ? Format.ringState(rate) : "None");
				m.setProperty("/progressText", this.text("runProgress", [done, items.length, counts.failed]));
			},

			_applyFilter() {
				const m = this.viewModel();
				const f = m.getProperty("/filter");
				const items = m.getProperty("/items").map((i) => Object.assign({}, i, { picked: i.ID === this._selected }));
				m.setProperty("/shown", items.filter((i) => !f || (f === "open" ? i.status === "notrun" : i.status === f)));
			},

			onFilter() {
				this._applyFilter();
			},

			onBack() {
				this.toProject("runs");
			},

			onExport(e) {
				Files.download(this.getApi().url.report(this._runId, e.getParameter("item").getKey()));
			},

			async onToggleClose() {
				const closed = this.viewModel().getProperty("/run/status") === "closed";
				const run = await this.attempt(() => this.getApi().closeRun(this._runId, closed), "/busy");
				if (run) {
					this.viewModel().setProperty("/run/status", run.status);
					this.getBus().publish("qt", "changed", { what: "runs" });
				}
			},

			// ---- one test case ----

			onPick(e) {
				const item = e.getParameter("listItem").getBindingContext("view").getObject();
				this._select(item.ID);
			},

			async _select(itemID) {
				this._selected = itemID;
				const m = this.viewModel();
				const full = await this.attempt(() => this.getApi().runItem(itemID), "/itemBusy");
				if (!full || this._selected !== itemID) return;
				const done = new Map(full.steps.map((s) => [s.id, s]));
				const steps = (full.snapshot.steps || []).map((s, i) => {
					const r = done.get(s.id) || {};
					const status = r.status || "notrun";
					return { id: s.id, n: i + 1, action: s.action, data: s.data, expected: s.expected, status: status === "notrun" ? "none" : status, actual: r.actual || "" };
				});
				m.setProperty("/cur", {
					ID: full.ID,
					testCaseID: full.testCase_ID,
					caseCode: full.caseCode,
					caseTitle: full.caseTitle,
					preconditions: full.snapshot.preconditions || "",
					status: full.status,
					actual: full.actual || "",
					defect: full.defect || "",
					source: full.source,
					executedText: this._executed(full),
					steps
				});
				this._applyFilter();
			},

			_executed(i) {
				if (!i.executedAt) return "";
				return i.executedBy ? this.text("runExecuted", [i.executedBy, Format.date(i.executedAt)]) : this.text("runExecutedAt", [Format.date(i.executedAt)]);
			},

			_neighbour(by) {
				const shown = this.viewModel().getProperty("/shown");
				const i = shown.findIndex((x) => x.ID === this._selected);
				const next = shown[Math.min(shown.length - 1, Math.max(0, i + by))];
				if (next && next.ID !== this._selected) this._select(next.ID);
			},

			onNext() {
				this._neighbour(1);
			},

			onPrev() {
				this._neighbour(-1);
			},

			onOpenCase() {
				const id = this.viewModel().getProperty("/cur/testCaseID");
				if (id) this.getRouter().navTo("case", { id: this._projectId, caseId: id });
			},

			// ---- results ----

			_stepsPayload() {
				return this.viewModel().getProperty("/cur/steps").map((s) => ({ id: s.id, status: !s.status || s.status === "none" ? "notrun" : s.status, actual: s.actual }));
			},

			/** Saves what is on the screen. `status` only when a verdict was chosen; otherwise the server derives it from the steps. */
			async _save(status) {
				const m = this.viewModel();
				const cur = m.getProperty("/cur");
				if (!cur || m.getProperty("/run/status") !== "open") return;
				const out = await this.attempt(() => this.getApi().recordResult({ itemID: cur.ID, status, steps: this._stepsPayload(), actual: cur.actual, defect: cur.defect }), "/itemBusy");
				if (!out) return;
				m.setProperty("/cur/status", out.status);
				m.setProperty("/cur/executedText", this._executed(out));
				const items = m.getProperty("/items");
				const i = items.findIndex((x) => x.ID === cur.ID);
				if (i >= 0) m.setProperty("/items/" + i + "/status", out.status);
				this._summary();
				this._applyFilter();
				this.getBus().publish("qt", "changed", { what: "results" });
			},

			onStepResult(e) {
				const step = e.getSource().getBindingContext("view");
				const key = e.getParameter("item").getKey();
				this.viewModel().setProperty(step.getPath() + "/status", key);
				this._save();
			},

			onStepNote() {
				this._save(this._explicitStatus());
			},

			onNotesChange() {
				this._save(this._explicitStatus());
			},

			/** A text changed: keep the result as it is. */
			_explicitStatus() {
				const s = this.viewModel().getProperty("/cur/status");
				return s === "notrun" ? undefined : s;
			},

			onVerdict(status) {
				const m = this.viewModel();
				if (!m.getProperty("/cur") || m.getProperty("/run/status") !== "open") return;
				const steps = m.getProperty("/cur/steps");
				// Pass: the steps nobody judged are passed too; Reset clears the steps
				steps.forEach((s, i) => {
					if (status === "notrun") m.setProperty("/cur/steps/" + i + "/status", "none");
					else if (status === "passed" && (!s.status || s.status === "none")) m.setProperty("/cur/steps/" + i + "/status", "passed");
				});
				this._save(status).then(() => {
					// after a verdict the next case waits: this is how a long run goes fast
					if (status !== "notrun") this._neighbourTodo();
				});
			},

			_neighbourTodo() {
				const shown = this.viewModel().getProperty("/shown");
				const i = shown.findIndex((x) => x.ID === this._selected);
				const next = shown.slice(i + 1).find((x) => x.status === "notrun");
				if (next) this._select(next.ID);
			},

			// ---- more test cases ----

			async onAddCases() {
				const dialog = await this.dialog("AddRunCasesDialog");
				const model = new JSONModel({ cases: [], picked: [], none: "" });
				model.setSizeLimit(5000);
				dialog.setModel(model, "add");
				dialog.open();
				const cases = await this.getApi().cases(this._projectId).catch(() => []);
				const have = new Set(this.viewModel().getProperty("/items").map((i) => i.testCase_ID));
				const rest = cases.filter((c) => c.status !== "deprecated" && !have.has(c.ID));
				model.setProperty("/cases", rest.map((c) => ({ ID: c.ID, text: c.code + "  " + c.title })));
				model.setProperty("/none", rest.length ? "" : this.text("runAddNone"));
			},

			async onAddCasesDo() {
				const dialog = this.byId("addRunCasesDialog");
				const ids = dialog.getModel("add").getProperty("/picked");
				dialog.close();
				if (!ids.length) return;
				await this.attempt(async () => {
					await this.getApi().addRunCases(this._runId, ids);
					await this._load(false);
					this.getBus().publish("qt", "changed", { what: "runs" });
				});
			},

			onAddCasesClose() {
				this.byId("addRunCasesDialog").close();
			}
		});
	}
);
