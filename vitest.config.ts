import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    forceRerunTriggers: [
      '**/package.json',
      '**/package-lock.json',
      '**/{vitest,vite}.config.*',
      '**/tsconfig*.json',
    ],
  },
})
