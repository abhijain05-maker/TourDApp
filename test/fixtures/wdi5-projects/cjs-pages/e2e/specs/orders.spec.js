const mainPage = require('../pages/main.page');
const { login } = require('../helpers/login');

describe('orders', () => {
  before(async () => {
    await login();
  });

  it('opens the form', async () => {
    await mainPage.startNewOrder();
    await expect(browser).toHaveUrl(expect.stringContaining('#/order/new'));
  });
});
