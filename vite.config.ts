/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The perf tests are slow, so they only run with `npm run test:perf`.
const perf = process.env.PERF === '1'

// https://vite.dev/config/
export default defineConfig({
  // Relative URLs, so the build also works under a GitHub Pages project path
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // Minifying drops the license comments of bundled libraries, so collect them in a file. It sits at the top level
  // because GitHub Pages may not serve dot directories such as .vite/.
  build: { license: { fileName: 'third-party-licenses.md' } },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: perf ? ['src/**/*.perf.test.ts'] : ['src/**/*.test.{ts,tsx}'],
    exclude: perf ? [] : ['src/**/*.perf.test.ts', 'node_modules/**'],
  },
})
