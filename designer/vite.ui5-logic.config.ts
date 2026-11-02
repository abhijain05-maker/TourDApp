import { defineConfig } from 'vite'

// The tour logic for the SAPUI5 designer: ui5-editor/logic.js becomes one ES module (see vite.ui5-editor.config.ts).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: '../app/designer-ui5/lib',
    emptyOutDir: false,
    minify: true,
    lib: { entry: 'ui5-editor/logic.js', formats: ['es'], fileName: () => 'tourd-logic.js' },
  },
})
