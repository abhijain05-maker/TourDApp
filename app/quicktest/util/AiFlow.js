sap.ui.define(["sap/ui/core/Fragment", "sap/ui/model/json/JSONModel", "sap/m/MessageToast", "quicktest/util/Meta"], function (Fragment, JSONModel, MessageToast, Meta) {
	"use strict";

	// The three AI dialogs: draft requirements from a text, draft test cases for requirements, improve one item.
	// Every one of them only PROPOSES: the person ticks what to keep, and only then is anything saved.
	// One instance per app; the dialogs are made on first use and reused. Models are set by hand because the dialogs
	// hang on no view (they are shared by several screens).

	const clone = (o) => JSON.parse(JSON.stringify(o));

	class AiFlow {
		constructor(component) {
			this.component = component;
			this.api = component.api;
			this.dialogs = {};
		}

		text(key, args) {
			return this.component.getModel("i18n").getResourceBundle().getText(key, args);
		}

		provider() {
			return this.component.getModel("app").getProperty("/provider") || "rules";
		}

		providerLabel() {
			const id = this.provider();
			const p = (this.component.getModel("app").getProperty("/providers") || []).find((x) => x.id === id);
			return p ? p.label : id;
		}

		async _dialog(name, handlers) {
			if (!this.dialogs[name]) {
				const dialog = await this.component.runAsOwner(() => Fragment.load({ id: "qtAi" + name, name: "quicktest.fragment.Ai" + name, controller: handlers }));
				dialog.setModel(this.component.getModel("i18n"), "i18n");
				dialog.setModel(this.component.getModel("app"), "app");
				this.dialogs[name] = dialog;
			}
			return this.dialogs[name];
		}

		_state(name, data) {
			const model = new JSONModel(data);
			model.setSizeLimit(2000);
			this.dialogs[name].setModel(model, "ai");
			return model;
		}

		_model(name) {
			return this.dialogs[name].getModel("ai");
		}

		_mode() {
			const ai = this.provider() !== "rules";
			return { ai, mode: ai ? this.text("aiModeAi", [this.providerLabel()]) : this.text("aiModeRules") };
		}

		// ---- requirements from a text ----

		async requirements({ projectID, text = "", onSaved }) {
			const handlers = {
				onDraft: () => this._draftRequirements(),
				onSave: () => this._saveRequirements(),
				onClose: () => this.dialogs.Requirements.close(),
				onAll: (e) => this._tickAll("Requirements", e.getParameter("selected")),
				onTick: () => this._count("Requirements")
			};
			await this._dialog("Requirements", handlers);
			this._projectID = projectID;
			this._onSaved = onSaved;
			this._state("Requirements", Object.assign({ text, instruction: "", busy: false, error: "", items: [], chosen: 0, note: "", generator: "", saved: "", all: true }, this._mode()));
			this.dialogs.Requirements.open();
		}

		async _draftRequirements() {
			const model = this._model("Requirements");
			model.setProperty("/busy", true);
			model.setProperty("/error", "");
			try {
				const out = await this.api.aiRequirements({ projectID: this._projectID, text: model.getProperty("/text"), instruction: model.getProperty("/instruction"), provider: this.provider() });
				model.setProperty("/items", out.items.map((r, i) => Object.assign({}, r, { key: "r" + i, selected: true, criteriaList: (r.acceptance || "").split("\n").filter(Boolean) })));
				model.setProperty("/note", out.note || "");
				model.setProperty("/generator", out.generator);
				model.setProperty("/all", true);
				this._count("Requirements");
				if (!out.items.length) model.setProperty("/error", this.text("aiNothing"));
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/busy", false);
			}
		}

		async _saveRequirements() {
			const model = this._model("Requirements");
			const chosen = model.getProperty("/items").filter((i) => i.selected);
			if (!chosen.length) return;
			model.setProperty("/busy", true);
			try {
				const requirements = chosen.map((i) => ({ title: i.title, description: i.description, acceptance: i.acceptance, priority: i.priority, kind: i.kind }));
				await this.api.saveBatch(this._projectID, { requirements, origin: "ai" });
				this.dialogs.Requirements.close();
				MessageToast.show(this.text("aiSavedRequirements", [chosen.length]));
				if (this._onSaved) this._onSaved();
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/busy", false);
			}
		}

		_tickAll(name, on) {
			const model = this._model(name);
			model.getProperty("/items").forEach((_, i) => model.setProperty("/items/" + i + "/selected", on));
			this._count(name);
		}

		/** How many proposals are ticked: the Save button follows it. */
		_count(name) {
			const model = this._model(name);
			model.setProperty("/chosen", model.getProperty("/items").filter((i) => i.selected).length);
		}

		// ---- test cases for requirements ----

		async cases({ projectID, requirementIDs = [], onSaved }) {
			const handlers = {
				onDraft: () => this._draftCases(),
				onSave: () => this._saveCases(),
				onClose: () => this.dialogs.Cases.close(),
				onAll: (e) => this._tickAll("Cases", e.getParameter("selected")),
				onTick: () => this._count("Cases")
			};
			await this._dialog("Cases", handlers);
			this._projectID = projectID;
			this._onSaved = onSaved;
			const model = this._state("Cases", Object.assign({ requirements: [], picked: requirementIDs.slice(), kinds: Meta.items("caseKinds").map((k) => ({ id: k.id, label: k.label })), kindKeys: ["functional", "negative"], count: 3, instruction: "", busy: false, error: "", items: [], chosen: 0, note: "", generator: "", all: true }, this._mode()));
			try {
				const reqs = await this.api.requirements(projectID);
				model.setProperty("/requirements", reqs.map((r) => ({ ID: r.ID, text: r.code + "  " + r.title, uncovered: r.verification === "uncovered" })));
				// nothing chosen yet: start with the requirements that have no test case
				if (!requirementIDs.length) model.setProperty("/picked", reqs.filter((r) => r.verification === "uncovered").slice(0, 10).map((r) => r.ID));
			} catch (e) {
				model.setProperty("/error", e.message);
			}
			this.dialogs.Cases.open();
		}

		async _draftCases() {
			const model = this._model("Cases");
			model.setProperty("/busy", true);
			model.setProperty("/error", "");
			try {
				const out = await this.api.aiCases({ projectID: this._projectID, requirementIDs: model.getProperty("/picked"), kinds: model.getProperty("/kindKeys"), count: model.getProperty("/count"), instruction: model.getProperty("/instruction"), provider: this.provider() });
				model.setProperty(
					"/items",
					out.items.map((c) => Object.assign({}, c, { selected: true, stepText: (c.steps || []).map((s, n) => n + 1 + ". " + s.action + (s.expected ? "  ->  " + s.expected : "")).join("\n"), kindText: Meta.label("caseKinds", c.kind), reqText: (c.requirementCodes || []).join(", ") }))
				);
				model.setProperty("/note", out.note || "");
				model.setProperty("/generator", out.generator);
				model.setProperty("/all", true);
				this._count("Cases");
				if (!out.items.length) model.setProperty("/error", this.text("aiNothing"));
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/busy", false);
			}
		}

		async _saveCases() {
			const model = this._model("Cases");
			const chosen = model.getProperty("/items").filter((i) => i.selected);
			if (!chosen.length) return;
			model.setProperty("/busy", true);
			try {
				const cases = chosen.map((c) => ({ title: c.title, objective: c.objective, preconditions: c.preconditions, priority: c.priority, kind: c.kind, steps: c.steps, requirementIDs: c.requirementIDs }));
				await this.api.saveBatch(this._projectID, { cases, origin: "ai" });
				this.dialogs.Cases.close();
				MessageToast.show(this.text("aiSavedCases", [chosen.length]));
				if (this._onSaved) this._onSaved();
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/busy", false);
			}
		}

		// ---- improve one item ----

		/** @param entity "requirement" | "testcase"; draft = what the editor holds; onApply(item) puts the proposal into the editor */
		async improve({ projectID, entity, draft, onApply }) {
			const handlers = {
				onRun: () => this._improve(),
				onApply: () => {
					const item = this._model("Improve").getProperty("/proposal");
					this.dialogs.Improve.close();
					if (item && this._onApply) this._onApply(item);
				},
				onClose: () => this.dialogs.Improve.close()
			};
			await this._dialog("Improve", handlers);
			this._projectID = projectID;
			this._entity = entity;
			this._draft = clone(draft);
			this._onApply = onApply;
			this._state("Improve", Object.assign({ entity, instruction: "", busy: false, error: "", proposal: null, current: this._describe(entity, draft), after: null, canRun: this._mode().ai }, this._mode()));
			this.dialogs.Improve.open();
			if (this._mode().ai) this._improve();
		}

		_describe(entity, d) {
			if (entity === "testcase") return [d.title, d.objective && "Objective: " + d.objective, d.preconditions && "Preconditions: " + d.preconditions].filter(Boolean).join("\n") + "\n\n" + (d.steps || []).map((s, n) => n + 1 + ". " + s.action + (s.data ? " [" + s.data + "]" : "") + (s.expected ? "  ->  " + s.expected : "")).join("\n");
			return [d.title, d.description, d.acceptance && "Acceptance criteria:\n" + d.acceptance.split("\n").map((l) => "- " + l).join("\n")].filter(Boolean).join("\n\n");
		}

		async _improve() {
			const model = this._model("Improve");
			model.setProperty("/busy", true);
			model.setProperty("/error", "");
			try {
				const out = await this.api.aiImprove({ projectID: this._projectID, entity: this._entity, draft: this._draft, instruction: model.getProperty("/instruction"), provider: this.provider() });
				model.setProperty("/proposal", out.item);
				model.setProperty("/after", this._describe(this._entity, out.item));
			} catch (e) {
				model.setProperty("/error", e.message);
			} finally {
				model.setProperty("/busy", false);
			}
		}
	}

	let instance;
	return {
		get(component) {
			instance = instance || new AiFlow(component);
			return instance;
		}
	};
});
