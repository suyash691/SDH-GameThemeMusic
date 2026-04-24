import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/actions/**', 'src/cache/**'],
      exclude: ['src/__tests__/**']
    }
  },
  resolve: {
    alias: {
      '@decky/api': path.resolve(__dirname, 'src/__tests__/mocks/decky-api.ts'),
      '@decky/manifest': path.resolve(__dirname, 'src/__tests__/mocks/decky-manifest.ts'),
      '@decky/ui': path.resolve(__dirname, 'src/__tests__/mocks/decky-ui.ts'),
      'react': path.resolve(__dirname, 'node_modules/react')
    }
  }
})
