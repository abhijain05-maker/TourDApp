sap.ui.define(
	["sap/ui/core/mvc/Controller", "sap/ui/core/routing/History", "sap/ui/model/json/JSONModel", "sap/m/MessageBox", "sap/m/MessageToast"],
	function (Controller, History, JSONModel, MessageBox, MessageToast) {
		"use strict";

		return Controller.extend("quicktest.controller.BaseController", {
			/** The calls of the QuickTest service (util/Api.js). */
			getApi() {
				return this.getOwnerComponent().api;
			},

			/** The event bus the screens use to say that data changed. */
			getBus() {
				return this.getOwnerComponent().bus;
			},

			getRouter() {
				return this.getOwnerComponent().getRouter();
			},

			/** The model every page shares: projects, the open project, the navigation state, the AI choice. */
			appModel() {
				return this.getOwnerComponent().getModel("app");
			},

			text(key, args) {
				return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
			},

			/** A model of the view's own state, available as {view>/...}. */
			initViewModel(data) {
				const model = new JSONModel(data);
				model.setSizeLimit(5000);
				this.getView().setModel(model, "view");
				return model;
			},

			viewModel() {
				return this.getView().getModel("view");
			},

			errorMessage(error) {
				return error instanceof Error ? error.message : String(error);
			},

			/** Shows the message of a failed request in the strip bound to {view>/error}. */
			fail(error) {
				const model = this.viewModel();
				if (model) model.setProperty("/error", error ? this.errorMessage(error) : "");
				else MessageBox.error(this.errorMessage(error));
			},

			/** Runs an async step; a failure ends up in the error strip. Resolves to the value, or undefined after a failure. */
			async attempt(work, busyPath) {
				const model = this.viewModel();
				if (model) model.setProperty("/error", "");
				if (busyPath && model) model.setProperty(busyPath, true);
				try {
					return await work();
				} catch (e) {
					this.fail(e);
					return undefined;
				} finally {
					if (busyPath && model) model.setProperty(busyPath, false);
				}
			},

			toast(text) {
				MessageToast.show(text);
			},

			/** Asks before something that cannot be undone; resolves to true when the person confirms. */
			confirm(text, title, actionText) {
				return new Promise((resolve) => {
					MessageBox.confirm(text, {
						title,
						actions: [actionText, MessageBox.Action.CANCEL],
						emphasizedAction: actionText,
						onClose: (action) => resolve(action === actionText)
					});
				});
			},

			/** Loads fragment/<name>.fragment.xml once and reuses it; its controls are found with this.byId(<id in the fragment>). */
			async dialog(name) {
				this._dialogs = this._dialogs || {};
				if (!this._dialogs[name]) this._dialogs[name] = await this.loadFragment({ name: "quicktest.fragment." + name });
				return this._dialogs[name];
			},

			/** The AI provider the person chose in the header ("rules" = no AI). */
			provider() {
				return this.appModel().getProperty("/provider") || "rules";
			},

			aiReady() {
				return this.provider() !== "rules";
			},

			/** The project the page shows (set by the project page, or loaded for a detail page). */
			projectId() {
				return this._projectId;
			},

			onNavBack() {
				if (History.getInstance().getPreviousHash() !== undefined) history.go(-1);
				else this.getRouter().navTo("projects", {}, true);
			},

			toProject(tab) {
				this.getRouter().navTo("project", { id: this._projectId, "?query": tab ? { tab } : undefined });
			}
		});
	}
);
