sap.ui.define(
  ['sap/ui/core/mvc/Controller', 'sap/ui/core/Fragment'],
  function (Controller, Fragment) {
    'use strict'
    // helper outside the controller class
    function format(v) {
      return String(v)
    }

    return Controller.extend('messy.app.controller.Overview', {
      onInit: function () {
        this.getOwnerComponent()
          .getRouter()
          .getRoute('item')
          .attachPatternMatched(this._onItem, this)
      },
      onLive: function (e) {
        this.byId('nameInput').setValueState('None')
      },
      onItem: function (e) {
        var sRoute = 'item'
        this.getOwnerComponent()
          .getRouter()
          .navTo(sRoute, { id: format(1), tab: 'info' })
        this.getRouter().navTo('overview')
      },
      onSave: async function () {
        const dlg = await this.loadFragment({ name: 'messy.app.fragment.Popup' })
        dlg.open()
        Fragment.load({ id: 'customPrefix', name: 'messy.app.fragment.Inline', controller: this })
        sap.ui.xmlfragment(this.getView().getId(), 'messy.app.fragment.Inline', this)
      },
      _onItem: function () {},
    })
  },
)
