import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        projects: ['backend/vitest.config.ts', 'frontend/vitest.config.ts']
    }
})
