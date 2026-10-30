import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true, // cds.test registers its own before/after hooks on the global test API
    include: ['test/unit/**/*.test.{js,mjs,ts}'],
    testTimeout: 20000,
    // service tests must never touch the development database file
    env: { CDS_REQUIRES_DB_CREDENTIALS_URL: ':memory:' },
  },
})
