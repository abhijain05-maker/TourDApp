import { defineConfig } from 'vitest/config'

// Opt-in tests against the real model services (cost money, need credentials): npm run test:live
export default defineConfig({
  test: { include: ['test/live/**/*.live.test.js'], testTimeout: 300_000 },
})
