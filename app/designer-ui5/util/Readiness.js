sap.ui.define(["sap/ui/model/json/JSONModel", "tourd/designer/util/Format"], function (JSONModel, Format) {
	"use strict";

	// The readiness data of the open project, shared by the Readiness tabs and the tiles of the project page.
	// It lives in the component as the model "readiness". The server decides what the categories and answers are
	// (readinessMeta), so a new kind of check shows up here without a change.

	const LEVEL_STATE = { error: "Error", warning: "Warning", info: "Information", ok: "Success" };
	const LEVEL_ICON = { error: "sap-icon://error", warning: "sap-icon://alert", info: "sap-icon://hint", ok: "sap-icon://sys-enter-2" };
	const REL_ICON = { uses: "sap-icon://arrow-right", usedBy: "sap-icon://arrow-left" };

	const humanize = (key) => {
		const s = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
		return s.charAt(0).toUpperCase() + s.slice(1);
	};

	const parse = (text, fallback) => {
		try {
			return text ? JSON.parse(text) : fallback;
		} catch (e) {
			return fallback;
		}
	};

	const percent = (value) => Math.round((value || 0) * 100);

	/** Colour of a progress number: green when everything is confirmed, otherwise the neutral brand colour. Problems have their own chips, so a low share is not shown as an error. */
	const stateOf = (b) => (b.total && b.progress === 1 ? "Success" : "None");

	class Readiness {
		/** @param {object} component the UI5 component (its api, bus and i18n are used) */
		constructor(component) {
			this.component = component;
			this.model = new JSONModel({
				projectId: "",
				loading: false,
				scanning: false,
				error: "",
				loaded: false,
				meta: { categories: [], statuses: [], levels: [] },
				summary: null,
				categories: [],
				tabs: [],
				items: [],
				report: null,
				percent: 0,
				state: "None"
			});
			this.model.setSizeLimit(5000);
		}

		get api() {
			return this.component.api;
		}

		text(key, args) {
			return this.component.getModel("i18n").getResourceBundle().getText(key, args);
		}

		/** Points the store at a project; the same project again keeps what is loaded. */
		setProject(projectId) {
			if (this.model.getProperty("/projectId") === projectId) return;
			this.model.setData(Object.assign({}, this.model.getData(), { projectId, loaded: false, summary: null, categories: [], tabs: [], items: [], report: null, error: "", percent: 0, state: "None", intent: null }));
		}

		/** Starts on a project and loads everything. */
		async open(projectId) {
			this.setProject(projectId);
			await this.refresh();
		}

		/** Numbers only: what the tiles of the project page show. */
		async refreshSummary() {
			const id = this.model.getProperty("/projectId");
			if (!id) return;
			try {
				const summary = await this.api.readinessSummary(id);
				if (id !== this.model.getProperty("/projectId")) return;
				this._applySummary(summary);
			} catch (e) {
				this.model.setProperty("/error", e.message);
			}
		}

		/** Everything: answers, numbers and the checks. */
		async refresh() {
			const id = this.model.getProperty("/projectId");
			if (!id) return;
			this.model.setProperty("/loading", true);
			this.model.setProperty("/error", "");
			try {
				if (!this.model.getProperty("/meta/categories").length) this.model.setProperty("/meta", await this.api.readinessMeta());
				const [summary, rows, report] = await Promise.all([this.api.readinessSummary(id), this.api.readinessItems(id), this.api.readinessScanReport(id)]);
				if (id !== this.model.getProperty("/projectId")) return;
				this.model.setProperty("/report", report);
				this._applySummary(summary);
				this._applyItems(rows);
				this.model.setProperty("/loaded", true);
			} catch (e) {
				this.model.setProperty("/error", e.message);
			} finally {
				this.model.setProperty("/loading", false);
			}
		}

		_applySummary(summary) {
			const meta = this.model.getProperty("/meta");
			const byId = new Map((summary.categories || []).map((c) => [c.id, c]));
			const categories = meta.categories.map((c) => {
				const n = byId.get(c.id) || { total: 0, open: 0, working: 0, broken: 0, na: 0, error: 0, warning: 0, attention: 0, progress: 0 };
				return Object.assign({}, c, n, {
					percent: percent(n.progress),
					state: stateOf(n),
					doneText: this.text("rCategoryDone", [n.working + n.na, n.total]),
					hasWarnings: n.error + n.warning > 0,
					findingsText: this.text("rFindings", [n.error + n.warning])
				});
			});
			const tabs = [{ id: "all", label: this.text("rAll"), total: summary.total, icon: "sap-icon://list" }].concat(categories.filter((c) => c.total > 0));
			this.model.setProperty("/summary", Object.assign({}, summary, { done: summary.working + summary.na, doneText: this.text("rCategoryDone", [summary.working + summary.na, summary.total]) }));
			this.model.setProperty("/categories", categories);
			this.model.setProperty("/tabs", tabs);
			this.model.setProperty("/percent", percent(summary.progress));
			this.model.setProperty("/state", stateOf(summary));
			this.model.setProperty("/scanAgo", summary.scan ? Format.ago(summary.scan.at) : "");
		}

		_applyItems(rows) {
			const meta = this.model.getProperty("/meta");
			const cats = new Map(meta.categories.map((c) => [c.id, c]));
			const statuses = new Map(meta.statuses.map((s) => [s.id, s]));
			const items = rows.map((r) => this._shape(r, cats, statuses));
			const byKey = new Map(items.map((i) => [i.itemKey, i]));
			for (const i of items) {
				i.links = i.links.map((l) => {
					const other = byKey.get(l.key);
					return other ? Object.assign({}, l, { ID: other.ID, title: other.title, icon: REL_ICON[l.rel], relText: this.text(l.rel === "uses" ? "rUses" : "rUsedBy") }) : null;
				}).filter(Boolean);
			}
			this.model.setProperty("/items", items);
		}

		_shape(row, cats, statuses) {
			const d = parse(row.data, {});
			const cat = cats.get(row.category) || { label: row.category, icon: "sap-icon://question-mark", order: 99 };
			const st = statuses.get(row.status) || statuses.get("open") || { label: row.status, state: "None", icon: "" };
			const inputs = parse(row.inputs, {});
			const signals = (d.signals || []).map((s) => ({ level: s.level, code: s.code, message: s.message, state: LEVEL_STATE[s.level] || "None", icon: LEVEL_ICON[s.level] }));
			const probe = parse(row.probe, null);
			if (probe && probe.message) signals.push({ level: probe.level || "info", code: "probe", message: probe.message, state: LEVEL_STATE[probe.level] || "Information", icon: LEVEL_ICON[probe.level || "info"], live: true });
			const errors = signals.filter((s) => s.level === "error").length;
			const warnings = signals.filter((s) => s.level === "warning").length;
			const attrs = Object.entries(d.attrs || {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ({ label: humanize(k), value: Array.isArray(v) ? v.join(", ") : String(v) }));
			const sources = (d.sources || []).map((s) => ({ text: s.path + (s.line ? ":" + s.line : ""), path: s.path, line: s.line }));
			const fields = (d.fields || []).map((f) => ({ id: f.id, label: f.label, hint: f.hint || "", value: inputs[f.id] || "" }));
			const attention = row.status === "broken" || (row.level === "error" && row.status !== "working" && row.status !== "na");
			return {
				ID: row.ID,
				itemKey: row.itemKey,
				category: row.category,
				categoryLabel: cat.label,
				categoryIcon: cat.icon,
				categoryOrder: cat.order,
				kind: row.kind,
				title: row.title,
				summary: d.summary || "",
				severity: row.severity || "normal",
				priorityText: row.severity === "high" ? this.text("rPriorityHigh") : row.severity === "low" ? this.text("rPriorityLow") : "",
				level: row.level || "",
				origin: row.origin,
				manual: row.origin === "manual",
				present: row.present !== false,
				absent: row.present === false,
				status: row.status || "open",
				statusText: st.label,
				statusState: st.state,
				statusIcon: st.icon,
				note: row.note || "",
				owner: row.owner || "",
				checkedText: row.checkedAt ? this.text("rCheckedAt", [Format.date(row.checkedAt)]) + (row.checkedBy && row.checkedBy !== "anonymous" ? " · " + row.checkedBy : "") : "",
				signals,
				errors,
				warnings,
				findingsText: [errors && this.text("rErrorsCount", [errors]), warnings && this.text("rWarningsCount", [warnings])].filter(Boolean).join(" · "),
				hasFindings: errors + warnings > 0,
				attention,
				attrs,
				sources,
				verify: (d.verify || []).map((text, i) => ({ n: i + 1, text })),
				fields,
				links: d.links || [],
				search: [row.title, d.summary, row.note, row.owner].concat(attrs.map((a) => a.value), sources.map((s) => s.path)).join(" ").toLowerCase()
			};
		}

		/** Reads the project's files and lists what it depends on; what people answered stays. */
		async scan() {
			const id = this.model.getProperty("/projectId");
			this.model.setProperty("/scanning", true);
			this.model.setProperty("/error", "");
			try {
				const result = await this.api.scanReadiness(id);
				await this.refresh();
				this.component.bus.publish("tourd", "changed", { what: "readiness" });
				return result;
			} catch (e) {
				this.model.setProperty("/error", e.message);
				return undefined;
			} finally {
				this.model.setProperty("/scanning", false);
			}
		}

		/** Saves an answer, a note, an owner or the fields of one check; returns the shaped check. */
		async check(itemID, patch) {
			const row = await this.api.checkReadiness(Object.assign({ itemID }, patch));
			const items = this.model.getProperty("/items");
			const at = items.findIndex((i) => i.ID === itemID);
			if (at >= 0) {
				const meta = this.model.getProperty("/meta");
				const shaped = this._shape(row, new Map(meta.categories.map((c) => [c.id, c])), new Map(meta.statuses.map((s) => [s.id, s])));
				shaped.links = items[at].links;
				this.model.setProperty("/items/" + at, shaped);
			}
			await this.refreshSummary();
			this.component.bus.publish("tourd", "changed", { what: "readiness" });
			return this.model.getProperty("/items").find((i) => i.ID === itemID);
		}

		async add(category, title, summary) {
			const id = this.model.getProperty("/projectId");
			const row = await this.api.addReadinessItem({ projectID: id, category, title, summary });
			await this.refresh();
			this.component.bus.publish("tourd", "changed", { what: "readiness" });
			return row;
		}

		async remove(itemID) {
			await this.api.removeReadinessItem(itemID);
			await this.refresh();
			this.component.bus.publish("tourd", "changed", { what: "readiness" });
		}
	}

	return Readiness;
});
