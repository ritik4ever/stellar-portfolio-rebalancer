import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['tests/e2e/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'lcov', 'html'],
            include: [
                'src/config/api.ts',
                'src/components/RebalanceHistory.tsx',
                'src/components/NotificationPreferences.tsx',
                'src/hooks/usePortfolio.ts',
                'src/hooks/useReflector.ts',
                'src/utils/calculations.ts'
            ],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70
            }
        }
    },
    plugins: [react()],
    server: {
        port: 3000,
        host: true,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
                secure: false
            }
        }
    },
    preview: {
        port: 3000,
        host: true
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom'],
                    stellar: ['@stellar/stellar-sdk'],
                    charts: ['recharts'],
                    ui: ['framer-motion', 'lucide-react']
                }
            }
        }
    }
})
