// Press on button "Create"
When.waitFor({
  controlType: 'sap.m.Button',
  viewName: 'demo.orders.view.Main',
  id: 'createBtn',
  actions: new Press(),
})

// Enter text in input "Customer"
When.waitFor({
  controlType: 'sap.m.Input',
  viewName: 'demo.orders.view.Detail',
  id: 'customerInput',
  actions: new EnterText({ text: 'Acme Corp' }),
})

When.waitFor({
  controlType: 'sap.m.Button',
  viewName: 'demo.orders.view.Detail',
  id: 'saveBtn',
  actions: new Press(),
})

// control without an id: located by its text
When.waitFor({
  controlType: 'sap.m.Button',
  viewName: 'demo.orders.view.Main',
  properties: { text: 'Export' },
  actions: new Press(),
})

// an assertion is not a user action and must be ignored
Then.waitFor({
  controlType: 'sap.m.Input',
  viewName: 'demo.orders.view.Detail',
  id: 'customerInput',
  success: function () {
    Opa5.assert.ok(true)
  },
})
