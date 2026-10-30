exports.config = {
  specs: ['./e2e/**/*.spec.js'],
  maxInstances: 1,
  capabilities: [{ browserName: 'chrome', ...(process.env.BROWSER_VERSION ? { browserVersion: process.env.BROWSER_VERSION } : {}), 'goog:chromeOptions': { args: process.argv.includes('--headless') ? ['--headless=new'] : [] } }],
  logLevel: 'error',
  baseUrl: process.env.BASE_URL || 'http://localhost:8080/index.html',
  services: ['ui5'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60000 }
};
