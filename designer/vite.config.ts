import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const CAP = 'http://localhost:4044'

// The designer is built into ../app/designer, which CAP serves statically at /designer/.
export default defineConfig({
  base: '/designer/',
  plugins: [react()],
  build: {
    outDir: '../app/designer',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: ['..'] }, // the editor imports shared modules from the repository root
    port: 5173,
    proxy: {
      '/odata': CAP,
      '/api': CAP,
      '/preview': CAP,
      '/live': CAP,
      '/export': CAP,
    },
  },
})
