sap.ui.define(
	["sap/ui/core/mvc/Controller", "sap/ui/core/Fragment", "sap/m/MessageToast"],
	function (Controller, Fragment, MessageToast) {
		"use strict";

		return Controller.extend("demo.orders.controller.Detail", {
			onInit: function () {
				this.getOwnerComponent()
					.getRouter()
					.getRoute("detail")
					.attachPatternMatched(this._onMatched, this);
			},

			_onMatched: function (oEvent) {
				var sOrderId = oEvent.getParameter("arguments").orderId;
				var oModel = this.getView().getModel();
				if (sOrderId === "new") {
					this.getView().bindElement("/NewOrder");
					return;
				}
				var iIndex = (oModel.getProperty("/Orders") || []).findIndex(function (o) {
					return o.id === sOrderId;
				});
				this.getView().bindElement(iIndex >= 0 ? "/Orders/" + iIndex : "/NewOrder");
			},

			onNavBack: function () {
				this.getOwnerComponent().getRouter().navTo("main");
			},

			onSave: function () {
				MessageToast.show(this.getView().getModel("i18n").getResourceBundle().getText("saved"));
				this.getOwnerComponent().getRouter().navTo("main");
			},

			onOpenDialog: function () {
				if (!this._pDialog) {
					this._pDialog = Fragment.load({
						id: this.getView().getId(),
						name: "demo.orders.fragment.ConfirmDialog",
						controller: this
					}).then(
						function (oDialog) {
							this.getView().addDependent(oDialog);
							return oDialog;
						}.bind(this)
					);
				}
				this._pDialog.then(function (oDialog) {
					oDialog.open();
				});
			},

			onConfirmDelete: function () {
				this.byId("confirmDialog").close();
				this.getOwnerComponent().getRouter().navTo("main");
			},

			onCancelDelete: function () {
				this.byId("confirmDialog").close();
			}
		});
	}
);
