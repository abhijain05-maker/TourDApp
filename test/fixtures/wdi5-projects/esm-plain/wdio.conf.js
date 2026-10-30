export const config = {
	specs: ['./test/**/*.test.js'],
	capabilities: [{ browserName: 'chrome' }],
	baseUrl: 'http://localhost:8080/index.html',
	services: ['ui5'],
	framework: 'jasmine',
	reporters: ['spec'],
	jasmineOpts: { defaultTimeoutInterval: 60000 }
}
