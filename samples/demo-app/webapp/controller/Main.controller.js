sap.ui.define(
	[
		"sap/ui/core/mvc/Controller",
		"sap/ui/model/Filter",
		"sap/ui/model/FilterOperator",
		"sap/m/MessageToast"
	],
	function (Controller, Filter, FilterOperator, MessageToast) {
		"use strict";

		return Controller.extend("demo.orders.controller.Main", {
			onSearch: function (oEvent) {
				var sQuery = oEvent.getParameter("query");
				var aFilters = sQuery ? [new Filter("customer", FilterOperator.Contains, sQuery)] : [];
				this.byId("ordersTable").getBinding("items").filter(aFilters);
			},

			onCreate: function () {
				this.getOwnerComponent().getRouter().navTo("detail", { orderId: "new" });
			},

			onItemPress: function (oEvent) {
				var sId = oEvent.getSource().getBindingContext().getProperty("id");
				this.getOwnerComponent().getRouter().navTo("detail", { orderId: sId });
			},

			onExport: function () {
				MessageToast.show("Export is not implemented in this demo");
			},

			// Same shape as the snippet TourD generates for the export bundle.
			onStartTour: function () {
				var oComponent = this.getOwnerComponent();
				sap.ui.require(["tourd/TourPlayer"], function (TourPlayer) {
					TourPlayer.start(sap.ui.require.toUrl("tourd/tour.json"), { component: oComponent });
				});
			}
		});
	}
);
