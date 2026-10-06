import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    fileParallelism: false,
    forceRerunTriggers: [
      '**/package.json',
      '**/package-lock.json',
      '**/{vitest,vite}.config.*',
      '**/tsconfig*.json',
    ],
  },
})
