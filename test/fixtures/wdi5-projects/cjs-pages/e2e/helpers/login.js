/** Logs in with the test user (the app has none in this fixture: it only waits for the shell). */
async function login() {
  await browser.pause(1);
}

module.exports = { login };
