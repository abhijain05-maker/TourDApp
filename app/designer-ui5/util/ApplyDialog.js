sap.ui.define(["sap/ui/base/Object", "sap/ui/core/Fragment", "sap/ui/model/json/JSONModel"], function (BaseObject, Fragment, JSONModel) {
	"use strict";

	// "Add to project": the files a tour, the wdi5 tests of a plan or the help of a help set would add or change, each as a diff,
	// written only for the ones that stay ticked. One dialog for all three (designer/src/components/editor/AddToProjectDialog.tsx).
	// Use: new ApplyDialog(controller).open({ kind: "tour" | "tests" | "help", id, projectID, flush })

	const NOUN = { tour: "tour", tests: "tests", help: "help" };

	return BaseObject.extend("tourd.designer.util.ApplyDialog", {
		constructor: function (controller) {
			BaseObject.call(this);
			this.controller = controller;
		},

		async open({ kind = "tour", id, projectID, flush }) {
			const c = this.controller;
			this.kind = kind;
			this.id = id;
			this.projectID = projectID;
			const noun = NOUN[kind];
			const api = c.getApi();
			if (!this.dialog) {
				// this object is the controller of the fragment (Controller#loadFragment would use the page's controller)
				this.fragmentId = c.getView().createId("apply");
				this.dialog = await Fragment.load({ id: this.fragmentId, name: "tourd.designer.fragment.ApplyDialog", controller: this });
				c.getView().addDependent(this.dialog);
			}
			this.model = new JSONModel({
				title: c.text("applyTitle", [noun]),
				loading: true,
				busy: false,
				error: "",
				done: false,
				doneText: "",
				ok: false,
				blockedText: "",
				blocking: [],
				notes: [],
				nothingText: "",
				edits: [],
				hasEdits: false,
				chosen: 0,
				accept: false,
				confirmText: c.text("add")
			});
			this.dialog.setModel(this.model, "apply");
			this.dialog.open();
			try {
				if (flush) await flush(); // the plan is made from the saved version: save the working copy first
				const plan = await (kind === "tests" ? api.previewTestApply(id) : kind === "help" ? api.previewHelpApply(id) : api.previewTourApply(id));
				const edits = plan.edits.map((e, i) => ({ path: e.path, what: e.what, action: e.action, before: e.before || "", after: e.after, badge: e.action === "add" ? "A" : "M", include: true, shown: i === 0 }));
				const m = this.model;
				m.setProperty("/ok", plan.ok);
				m.setProperty("/edits", edits);
				m.setProperty("/hasEdits", plan.ok && edits.length > 0);
				m.setProperty("/notes", plan.notes);
				if (!plan.ok) {
					m.setProperty("/blockedText", c.text("applyBlocked", [noun]));
					m.setProperty("/blocking", plan.blocking);
				}
				if (plan.ok && edits.length === 0) m.setProperty("/nothingText", kind === "tests" ? c.text("applyNothingTests") : c.text("applyNothing", [noun]));
				this._count();
				if (edits.length) this._show(0);
			} catch (e) {
				this.model.setProperty("/error", c.errorMessage(e));
			} finally {
				this.model.setProperty("/loading", false);
			}
		},

		_count() {
			const edits = this.model.getProperty("/edits");
			const chosen = edits.filter((e) => e.include).length;
			this.model.setProperty("/chosen", chosen);
			this.model.setProperty("/confirmText", chosen ? this.controller.text(chosen === 1 ? "applyAddOne" : "applyAddMany", [chosen]) : this.controller.text("add"));
		},

		_show(index) {
			const edits = this.model.getProperty("/edits");
			edits.forEach((e, i) => this.model.setProperty("/edits/" + i + "/shown", i === index));
			const e = edits[index];
			const noun = NOUN[this.kind];
			const diff = Fragment.byId(this.fragmentId, "applyDiff");
			diff.setPath(e.path);
			diff.setBefore(e.before);
			diff.setAfter(e.after);
			diff.setBeforeLabel(e.action === "add" ? this.controller.text("applyNotThere") : this.controller.text("wsNow"));
			diff.setAfterLabel(this.controller.text("applyWith", [noun]));
		},

		onApplyShow(e) {
			const item = e.getSource();
			this._show(this.model.getProperty("/edits").indexOf(item.getBindingContext("apply").getObject()));
		},

		onApplyToggle() {
			this._count();
		},

		async onApplyConfirm() {
			const c = this.controller;
			const m = this.model;
			const paths = m.getProperty("/edits").filter((e) => e.include).map((e) => e.path);
			const accept = !!m.getProperty("/accept");
			const api = c.getApi();
			m.setProperty("/busy", true);
			m.setProperty("/error", "");
			try {
				const r = await (this.kind === "tests" ? api.applyTestToProject(this.id, paths, accept) : this.kind === "help" ? api.applyHelpToProject(this.id, paths, accept) : api.applyTourToProject(this.id, paths, accept));
				m.setProperty("/done", true);
				m.setProperty("/doneText", (r.applied ? c.text("applyDone", [r.applied, accept ? c.text("applyAndAccepted") : ""]) : c.text("applyNothing", [NOUN[this.kind]])) + " " + c.text("applyReview"));
				c.getBus().publish("tourd", "changed", { what: "files" });
				c.getBus().publish("tourd", "projectChanged");
			} catch (e) {
				m.setProperty("/error", c.errorMessage(e));
			} finally {
				m.setProperty("/busy", false);
			}
		},

		onApplyWorkspace() {
			this.dialog.close();
			this.controller.getRouter().navTo("project", { id: this.projectID, "?query": { tab: "sources" } });
		},

		onApplyClose() {
			this.dialog.close();
		}
	});
});
