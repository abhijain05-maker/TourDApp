import { defineConfig } from 'vitest/config'

// Opt-in: installs the real wdi5 packages and runs the generated tests in Chrome (see test/real/wdi5-real.test.js).
export default defineConfig({
  test: {
    include: ['test/real/**/*.test.js'],
    testTimeout: 600000,
    hookTimeout: 600000,
    fileParallelism: false,
  },
})
