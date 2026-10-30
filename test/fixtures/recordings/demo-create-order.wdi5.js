await browser
  .asControl({
    selector: {
      controlType: 'sap.m.Button',
      viewName: 'demo.orders.view.Main',
      id: 'createBtn',
    },
  })
  .press()

const customer = await browser.asControl({
  selector: { viewName: 'demo.orders.view.Detail', id: 'customerInput' },
})
await customer.enterText('Acme Corp')

await browser
  .asControl({
    selector: { viewName: 'demo.orders.view.Detail', id: 'saveBtn' },
  })
  .press()

// reading a value is not a user action
const text = await browser
  .asControl({ selector: { viewName: 'demo.orders.view.Main', id: 'searchField' } })
  .getValue()
