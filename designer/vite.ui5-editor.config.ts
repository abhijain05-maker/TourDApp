import { defineConfig } from 'vite'

// CodeMirror for the SAPUI5 designer: ui5-editor/entry.js becomes one ES module that the UI5 app loads on demand.
// The result is committed (app/designer-ui5/lib/codemirror.js) so that the SAPUI5 designer needs no build step.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: '../app/designer-ui5/lib',
    emptyOutDir: false,
    minify: true,
    lib: { entry: 'ui5-editor/entry.js', formats: ['es'], fileName: () => 'codemirror.js' },
  },
})
