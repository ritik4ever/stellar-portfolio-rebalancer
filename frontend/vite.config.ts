import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    test: {
        environment: 'node',
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