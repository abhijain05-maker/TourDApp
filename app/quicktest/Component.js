sap.ui.define(
	["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel", "sap/ui/core/EventBus", "sap/ui/Device", "quicktest/util/Api", "quicktest/util/Meta", "quicktest/util/Theme"],
	function (UIComponent, JSONModel, EventBus, Device, Api, Meta, Theme) {
		"use strict";

		return UIComponent.extend("quicktest.Component", {
			metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },

			init() {
				UIComponent.prototype.init.apply(this, arguments);
				this.api = Api;
				// screens tell each other that data changed: "qt" / "changed" { what }, and "qt" / "projectChanged"
				this.bus = new EventBus();
				// "recent" feeds the side navigation, "project" is the project the open page shows, "ai" what the server can do
				this.setModel(
					new JSONModel({
						projects: [],
						recent: [],
						project: null,
						navKey: "projects",
						theme: Theme.choice(),
						themeText: Theme.label(Theme.choice()),
						navExpanded: Device.resize.width >= 1180,
						providers: [],
						provider: "rules",
						aiReady: false
					}),
					"app"
				);
				Theme.init();
				this.refreshProjects();
				this.loadProviders();
				// the screens draw their chips and filters from the vocabulary: wait for it (it is fast, and has a fallback)
				Meta.load(Api).then(() => this.getRouter().initialize());
			},

			/** The side navigation and the command palette list the newest projects. */
			async refreshProjects() {
				const model = this.getModel("app");
				try {
					const projects = await Api.projects();
					model.setProperty("/projects", projects);
					model.setProperty("/recent", projects.slice(0, 8));
					return projects;
				} catch (e) {
					model.setProperty("/projects", []);
					model.setProperty("/recent", []);
					return [];
				}
			},

			/** Which AI providers the server has. The choice is remembered per browser; "rules" always works (and always means: no AI). */
			async loadProviders() {
				const model = this.getModel("app");
				let providers = [];
				try {
					providers = await Api.providers();
				} catch (e) {
					/* the server is not reachable: the screens show their own error */
				}
				const usable = providers.filter((p) => p.configured && p.id !== "rules");
				let saved = "rules";
				try {
					saved = window.localStorage.getItem("quicktest.provider") || "";
				} catch (e) {
					/* not remembered */
				}
				// first visit with an AI configured: use it; otherwise what was chosen last
				const choice = usable.some((p) => p.id === saved) ? saved : saved === "rules" ? "rules" : usable.length ? usable[0].id : "rules";
				// every provider is listed: one that is not set up yet is shown, but cannot be chosen (the Setup tab says how)
				model.setProperty("/providers", providers.map((p) => Object.assign({}, p, { usable: p.id === "rules" || p.configured, text: p.id === "rules" || p.configured ? p.label : p.label + " (" + this.getModel("i18n").getResourceBundle().getText("notSetUp") + ")" })));
				model.setProperty("/aiReady", usable.length > 0);
				model.setProperty("/provider", choice);
			},

			setProvider(id) {
				this.getModel("app").setProperty("/provider", id);
				try {
					window.localStorage.setItem("quicktest.provider", id);
				} catch (e) {
					/* not remembered */
				}
			},

			/** What the command palette (Ctrl+K) offers. Screens register their own commands while they are shown. */
			registerCommands(owner, commands) {
				this._commands = this._commands || {};
				this._commands[owner] = commands;
			},

			unregisterCommands(owner) {
				if (this._commands) delete this._commands[owner];
			},

			getCommands() {
				return Object.values(this._commands || {}).flat();
			},

			getContentDensityClass() {
				return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
			}
		});
	}
);
