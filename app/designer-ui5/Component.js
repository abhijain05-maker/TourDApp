sap.ui.define(
	["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel", "sap/ui/core/EventBus", "sap/ui/Device", "tourd/designer/util/Api", "tourd/designer/util/Theme"],
	function (UIComponent, JSONModel, EventBus, Device, Api, Theme) {
		"use strict";

		return UIComponent.extend("tourd.designer.Component", {
			metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },

			init() {
				UIComponent.prototype.init.apply(this, arguments);
				this.api = Api;
				// tabs tell each other (and the project page) that data changed: "tourd" / "changed" { what, projectId }
				this.bus = new EventBus();
				// "recent" feeds the side navigation, "project" is the project the open page shows
				this.setModel(
					new JSONModel({
						projects: [],
						recent: [],
						project: null,
						navKey: "projects",
						theme: Theme.choice(),
						themeText: Theme.label(Theme.choice()),
						navExpanded: Device.resize.width >= 1180
					}),
					"app"
				);
				Theme.init();
				this.refreshProjects();
				this.getRouter().initialize();
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
