const { wdi5 } = require('wdio-ui5-service');

/** The start page of the orders app. */
class MainPage {
  get createButton() {
    return { selector: { id: 'createBtn', viewName: 'demo.orders.view.Main' } };
  }

  get searchField() {
    return { selector: { id: 'searchField', viewName: 'demo.orders.view.Main' } };
  }

  /** Starts the "new order" form. */
  async startNewOrder() {
    await browser.asControl(this.createButton).press();
  }

  /** Looks for customers. */
  async searchFor(text) {
    await browser.asControl(this.searchField).enterText(text);
    await browser.keys('Enter');
  }
}

module.exports = new MainPage();
