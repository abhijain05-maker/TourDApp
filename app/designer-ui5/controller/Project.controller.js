sap.ui.define(
	["tourd/designer/controller/BaseController", "tourd/designer/util/Format", "sap/ui/core/mvc/View", "sap/m/MessageStrip", "sap/m/Link"],
	function (BaseController, Format, View, MessageStrip, Link) {
		"use strict";

		// tab key -> [view in view/tab/, pane in this view]. Tabs without a view yet point to the React designer.
		const TABS = {
			sources: { view: "Workspace", pane: "paneSources" },
			recordings: { view: "Recordings", pane: "paneRecordings" },
			tours: { view: "Tours", pane: "paneTours" },
			tests: { view: "Tests", pane: "paneTests" },
			help: { view: "Help", pane: "paneHelp" }
		};

		return BaseController.extend("tourd.designer.controller.Project", {
			onInit() {
				this.initViewModel({ tab: "sources", counts: {}, next: {}, extra: {}, loading: false, error: "", createdValue: "", createdAgo: "", updatedValue: "", updatedAgo: "" });
				this.getRouter().getRoute("project").attachPatternMatched(this._onMatched, this);
				// a tab changed data: the tiles show the new numbers
				this.getBus().subscribe("tourd", "changed", () => {
					if (this._id) this._loadCounts();
				});
				this.getBus().subscribe("tourd", "projectChanged", () => this._reloadProject());
			},

			async _onMatched(e) {
				const args = e.getParameter("arguments");
				const query = args["?query"] || {};
				const tab = Object.prototype.hasOwnProperty.call(TABS, query.tab) ? query.tab : "sources";
				if (this._id !== args.id) {
					this._id = args.id;
					this._tabViews = {};
					Object.values(TABS).forEach((t) => this.byId(t.pane).destroyItems());
					this.appModel().setProperty("/project", null);
					this.viewModel().setProperty("/counts", {});
					await this._reloadProject();
				}
				this.viewModel().setProperty("/tab", tab);
				if (this.appModel().getProperty("/project")) this._showTab(tab);
			},

			async _reloadProject() {
				const id = this._id;
				const project = await this.attempt(() => this.getApi().project(id), "/loading");
				if (id !== this._id) return;
				if (!project) return;
				this.appModel().setProperty("/project", project);
				const model = this.viewModel();
				model.setProperty("/createdValue", Format.date(project.createdAt));
				model.setProperty("/createdAgo", Format.ago(project.createdAt));
				model.setProperty("/updatedValue", Format.date(project.modifiedAt));
				model.setProperty("/updatedAgo", Format.ago(project.modifiedAt));
				this.getOwnerComponent().refreshProjects();
				this._loadCounts();
			},

			async _loadCounts() {
				const id = this._id;
				const api = this.getApi();
				const [files, changes, recordings, tours, plans] = await Promise.all([
					api.countFiles(id).catch(() => undefined),
					api.changes(id).catch(() => undefined),
					api.recordings(id).catch(() => undefined),
					api.tours(id).catch(() => undefined),
					api.testPlans(id).catch(() => undefined)
				]);
				if (id !== this._id) return;
				const n = { files, changes: changes && changes.length, recordings: recordings && recordings.length, tours: tours && tours.length, plans: plans && plans.length };
				const model = this.viewModel();
				model.setProperty("/counts", n);
				model.setProperty("/extra/sources", n.changes ? this.text("changedCount", [n.changes]) : n.files ? this.text("asUploaded") : this.text("uploadYourApp"));
				let next = {};
				if (Object.values(n).every((v) => v !== undefined)) {
					if (!n.files) next = { text: this.text("nextUpload"), tab: "sources" };
					else if (!n.recordings) next = { text: this.text("nextRecord"), tab: "recordings" };
					else if (!n.tours && !n.plans) next = { text: this.text("nextGenerate"), tab: "tours" };
					else if (n.changes) next = { text: this.text("nextReview", [n.changes]), tab: "sources" };
				}
				model.setProperty("/next", next);
			},

			async _showTab(key) {
				if (this._tabViews[key]) return;
				const def = TABS[key];
				const pane = this.byId(def.pane);
				this._tabViews[key] = true;
				if (!def.view) {
					const strip = new MessageStrip({
						type: "Information",
						showIcon: true,
						text: this.text("tabNotPorted"),
						link: new Link({ text: this.text("openReactDesigner"), target: "_blank", href: "/designer/#/projects/" + this._id + "?tab=" + key })
					});
					strip.addStyleClass("sapUiSmallMargin");
					pane.addItem(strip);
					return;
				}
				try {
					// created outside of the router: it needs the component as its owner to reach the models and the API
					const view = await this.getOwnerComponent().runAsOwner(() =>
						View.create({ type: "XML", viewName: "tourd.designer.view.tab." + def.view, id: this.createId("tab" + def.view + this._id) })
					);
					pane.addItem(view);
				} catch (e) {
					this._tabViews[key] = false;
					this.fail(e);
				}
			},

			onTabSelect(e) {
				this.getRouter().navTo("project", { id: this._id, "?query": { tab: e.getParameter("key") } }, true);
			},

			onTile(tab) {
				this.getRouter().navTo("project", { id: this._id, "?query": { tab } }, true);
			},

			onNext() {
				const tab = this.viewModel().getProperty("/next/tab");
				if (tab) this.onTile(tab);
			},

			onHome() {
				this.getRouter().navTo("projects");
			}
		});
	}
);
