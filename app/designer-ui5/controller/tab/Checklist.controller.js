sap.ui.define(
	["tourd/designer/controller/BaseController", "sap/ui/model/json/JSONModel", "sap/ui/model/Sorter"],
	function (BaseController, JSONModel, Sorter) {
		"use strict";

		const RANK = { high: 0, normal: 1, low: 2 };
		// what a quick answer changes in a row and in the detail
		const ANSWER_FIELDS = ["status", "statusText", "statusState", "statusIcon", "attention", "checkedText"];

		// The checklist: every thing the project depends on, with filters, a detail panel and the answer of the person.
		// The checks come from the component's "readiness" model (util/Readiness.js); this controller only filters and shows them.
		return BaseController.extend("tourd.designer.controller.tab.Checklist", {
			onInit() {
				this.initViewModel({ category: "all", status: "all", query: "", attention: false, showAbsent: false, shown: [], statusChoices: [], countText: "", hasSel: false, selID: "", sel: null });
				this.store = this.getOwnerComponent().readiness;
				// the checks change as a whole (a scan, a reload); one answer is patched in place by _patch
				this._binding = this.store.model.bindProperty("/items");
				this._binding.attachChange(() => this._apply());
				this.getBus().subscribe("tourd", "readinessIntent", this._applyIntent, this);
				this.store.open(this.appModel().getProperty("/project").ID).then(() => {
					this._apply();
					this._applyIntent();
				});
			},

			onExit() {
				this._binding.destroy();
				this.getBus().unsubscribe("tourd", "readinessIntent", this._applyIntent, this);
			},

			// ---- filtering ----

			_apply() {
				const model = this.viewModel();
				const f = model.getData();
				const all = this.store.model.getProperty("/items") || [];
				const q = (f.query || "").trim().toLowerCase();
				const shown = all
					.filter((i) => (f.showAbsent || i.present) && (f.category === "all" || i.category === f.category) && (f.status === "all" || i.status === f.status) && (!f.attention || i.attention) && (!q || i.search.includes(q)))
					.sort((a, b) => a.categoryOrder - b.categoryOrder || RANK[a.severity] - RANK[b.severity] || a.title.localeCompare(b.title));
				const statuses = this.store.model.getProperty("/meta/statuses") || [];
				model.setProperty("/statusChoices", [{ key: "all", text: this.text("rAnyAnswer") }].concat(statuses.map((s) => ({ key: s.id, text: s.label }))));
				model.setProperty("/shown", shown);
				model.setProperty("/countText", this.text("rShowing", [shown.length, all.filter((i) => i.present).length]));
				const list = this.byId("rItems");
				const binding = list && list.getBinding("items");
				// one group per category while all are shown; the order inside a group is the one above
				if (binding) binding.sort(f.category === "all" ? [new Sorter("categoryOrder", false, (ctx) => ({ key: ctx.getProperty("categoryOrder"), text: ctx.getProperty("categoryLabel") }))] : []);
				// the open check follows a new load; when it is gone the panel closes
				if (f.selID) {
					const still = all.find((i) => i.ID === f.selID);
					if (still) this._showSel(still);
					else this.onCloseDetail();
				}
			},

			onFilter() {
				this._apply();
			},

			onCategoryTab() {
				this._apply();
			},

			_applyIntent() {
				const intent = this.store.model.getProperty("/intent");
				if (!intent) return;
				this.store.model.setProperty("/intent", null);
				const model = this.viewModel();
				if (intent.category || intent.attention || intent.status) {
					model.setProperty("/category", intent.category || "all");
					model.setProperty("/attention", !!intent.attention);
					model.setProperty("/status", intent.status || "all");
					model.setProperty("/query", "");
					this._apply();
				}
				if (intent.add) this.onAdd();
			},

			// ---- selecting and answering ----

			_showSel(item) {
				const model = this.viewModel();
				model.setProperty("/sel", Object.assign({}, item, { fields: item.fields.map((f) => Object.assign({}, f)) }));
				model.setProperty("/selID", item.ID);
				model.setProperty("/hasSel", true);
			},

			onSelect(e) {
				this._showSel(e.getSource().getBindingContext("view").getObject());
			},

			onCloseDetail() {
				const model = this.viewModel();
				model.setProperty("/hasSel", false);
				model.setProperty("/selID", "");
				model.setProperty("/sel", null);
			},

			/** Updates the row and the open detail with an answer that was just saved. */
			_patch(item) {
				const model = this.viewModel();
				// the store made a new object for the check: the row shows that one (it is not filtered again, so it stays in place)
				const at = model.getProperty("/shown").findIndex((i) => i.ID === item.ID);
				if (at >= 0) model.setProperty("/shown/" + at, item);
				// the open detail keeps its own copy (so a field being typed in is not rewritten); only the answer is brought up to date
				if (model.getProperty("/selID") === item.ID) for (const key of ANSWER_FIELDS) model.setProperty("/sel/" + key, item[key]);
			},

			async _save(itemID, patch) {
				const item = await this.attempt(() => this.store.check(itemID, patch));
				if (item) this._patch(item);
				return item;
			},

			async onAnswer(e) {
				const button = e.getSource();
				const answer = button.getBindingContext("readiness").getObject().id;
				const sel = this.viewModel().getProperty("/sel");
				// a pressed button stays pressed: the answer is one of the four, not a switch
				button.setPressed(true);
				if (sel && sel.status !== answer) await this._save(sel.ID, { status: answer });
			},

			async onQuick(e) {
				const item = e.getSource().getBindingContext("view").getObject();
				const answer = e.getSource().data("answer");
				await this._save(item.ID, { status: item.status === answer ? "open" : answer });
			},

			onSaveFields() {
				const sel = this.viewModel().getProperty("/sel");
				if (!sel) return;
				const inputs = Object.fromEntries(sel.fields.map((f) => [f.id, f.value || ""]));
				return this._save(sel.ID, { inputs: JSON.stringify(inputs) });
			},

			onSaveOwner() {
				const sel = this.viewModel().getProperty("/sel");
				if (sel) return this._save(sel.ID, { owner: sel.owner || "" });
			},

			onSaveNote() {
				const sel = this.viewModel().getProperty("/sel");
				if (sel) return this._save(sel.ID, { note: sel.note || "" });
			},

			// ---- links ----

			onOpenSource(e) {
				const link = e.getSource().getBindingContext("view").getObject();
				this.store.model.setProperty("/openFile", link.path);
				this.getBus().publish("tourd", "openFile");
				this.getRouter().navTo("project", { id: this.appModel().getProperty("/project").ID, "?query": { tab: "sources" } }, true);
			},

			onRelated(e) {
				const link = e.getSource().getBindingContext("view").getObject();
				const model = this.viewModel();
				const target = (this.store.model.getProperty("/items") || []).find((i) => i.ID === link.ID);
				if (!target) return;
				// a connected check may be hidden by the filters: show everything, then pick it
				if (!model.getProperty("/shown").some((i) => i.ID === target.ID)) {
					Object.entries({ category: "all", status: "all", query: "", attention: false, showAbsent: target.absent }).forEach(([k, v]) => model.setProperty("/" + k, v));
					this._apply();
				}
				this._showSel(target);
				setTimeout(() => {
					const row = this.byId("rItems").getItems().find((i) => i.getBindingContext("view") && i.getBindingContext("view").getObject().ID === target.ID);
					if (row && row.getDomRef()) row.getDomRef().scrollIntoView({ block: "nearest" });
				}, 0);
			},

			// ---- add, remove, scan ----

			async onAdd() {
				const dialog = await this.dialog("ReadinessAddDialog");
				const categories = this.store.model.getProperty("/meta/categories");
				const current = this.viewModel().getProperty("/category");
				dialog.setModel(new JSONModel({ categories, category: categories.some((c) => c.id === current) ? current : "other", title: "", summary: "", busy: false, error: "" }), "add");
				dialog.open();
			},

			onAddCancel() {
				this.byId("rAddDialog").close();
			},

			async onAddConfirm() {
				const dialog = this.byId("rAddDialog");
				const m = dialog.getModel("add");
				m.setProperty("/busy", true);
				try {
					const row = await this.store.add(m.getProperty("/category"), m.getProperty("/title").trim(), m.getProperty("/summary"));
					dialog.close();
					const item = this.store.model.getProperty("/items").find((i) => i.ID === row.ID);
					if (item) {
						this.viewModel().setProperty("/category", "all");
						this._apply();
						this._showSel(item);
					}
				} catch (e) {
					m.setProperty("/error", this.errorMessage(e));
				} finally {
					m.setProperty("/busy", false);
				}
			},

			async onRemove() {
				const sel = this.viewModel().getProperty("/sel");
				if (!sel || !(await this.confirm(this.text("rRemoveText", [sel.title]), this.text("rRemove"), this.text("delete")))) return;
				this.onCloseDetail();
				await this.attempt(() => this.store.remove(sel.ID));
			},

			async onScan() {
				const result = await this.store.scan();
				if (result) this.toast(this.text("rScanned", [result.total, result.files]));
			},

			onOverview() {
				this.getRouter().navTo("project", { id: this.appModel().getProperty("/project").ID, "?query": { tab: "readiness" } }, true);
			}
		});
	}
);
