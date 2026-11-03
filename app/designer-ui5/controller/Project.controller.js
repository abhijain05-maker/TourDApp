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
			help: { view: "Help", pane: "paneHelp" },
			readiness: { view: "Readiness", pane: "paneReadiness" },
			checklist: { view: "Checklist", pane: "paneChecklist" }
		};

		// A project page has two features that share the project and its files (the Workspace tab): the guided experience
		// (recordings, tours, tests, help) and the readiness checklist. A tab belongs to one feature; Workspace to both.
		// A new feature is a new entry here, its tabs in TABS above, and its tab filters in Project.view.xml.
		const FEATURES = {
			guided: { tabs: ["recordings", "tours", "tests", "help"], start: "recordings" },
			readiness: { tabs: ["readiness", "checklist"], start: "readiness" }
		};
		const featureOf = (tab) => Object.keys(FEATURES).find((f) => FEATURES[f].tabs.includes(tab));
		const FEATURE_KEY = "tourd.feature";
		const rememberedFeature = () => {
			try {
				const v = window.localStorage.getItem(FEATURE_KEY);
				return FEATURES[v] ? v : "guided";
			} catch (e) {
				return "guided";
			}
		};

		return BaseController.extend("tourd.designer.controller.Project", {
			onInit() {
				this.initViewModel({ feature: rememberedFeature(), tab: "sources", counts: {}, next: {}, extra: {}, loading: false, error: "", createdValue: "", createdAgo: "", updatedValue: "", updatedAgo: "" });
				this.getRouter().getRoute("project").attachPatternMatched(this._onMatched, this);
				this.store = this.getOwnerComponent().readiness;
				// the readiness numbers follow the store; the hint under the tiles follows them
				this._summary = this.store.model.bindProperty("/summary");
				this._summary.attachChange(() => this._computeNext());
				// a tab changed data: the tiles show the new numbers
				this.getBus().subscribe("tourd", "changed", (channel, event, data) => {
					if (this._id && !(data && data.what === "readiness")) this._loadCounts();
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
					this.store.setProject(args.id);
					await this._reloadProject();
				}
				this.viewModel().setProperty("/tab", tab);
				// opening a tab of a feature switches to that feature; Workspace keeps the one that was on
				const feature = featureOf(tab);
				if (feature) {
					this.viewModel().setProperty("/feature", feature);
					try {
						window.localStorage.setItem(FEATURE_KEY, feature);
					} catch (e) {
						/* the choice is just not remembered */
					}
				}
				this._computeNext();
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
				this.store.refreshSummary();
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
				this._computeNext();
			},

			/** The hint under the tiles: the next useful step of the feature that is on. */
			_computeNext() {
				const model = this.viewModel();
				const n = model.getProperty("/counts") || {};
				let next = {};
				if (model.getProperty("/feature") === "readiness") {
					const s = this.store.model.getProperty("/summary");
					if (s) {
						if (!s.hasFiles) next = { text: this.text("nextRUpload"), tab: "sources" };
						else if (!s.scan) next = { text: this.text("nextRScan"), tab: "readiness" };
						else if (s.outdated) next = { text: this.text("nextRRescan"), tab: "readiness" };
						else if (s.attention) next = { text: this.text("nextRAttention", [s.attention]), tab: "checklist", intent: { attention: true } };
						else if (s.open) next = { text: this.text("nextROpen", [s.open]), tab: "checklist", intent: { status: "open" } };
					}
				} else if (Object.keys(n).length && Object.values(n).every((v) => v !== undefined)) {
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
				const next = this.viewModel().getProperty("/next");
				if (!next.tab) return;
				if (next.intent) this._openChecklist(next.intent, next.tab);
				else this.onTile(next.tab);
			},

			/** Switching feature opens its first tab. */
			onFeature(e) {
				const feature = e.getParameter("item").getKey();
				this.getRouter().navTo("project", { id: this._id, "?query": { tab: FEATURES[feature].start } }, true);
			},

			/** A readiness tile opens the checklist with the filter it stands for ("attention" or "open"). */
			onReadinessTile(kind) {
				this._openChecklist(kind === "attention" ? { attention: true } : { status: kind });
			},

			_openChecklist(intent, tab = "checklist") {
				this.store.model.setProperty("/intent", intent);
				this.onTile(tab);
				this.getBus().publish("tourd", "readinessIntent");
			},

			onHome() {
				this.getRouter().navTo("projects");
			}
		});
	}
);
