import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('react') || id.includes('react-dom')) return 'vendor'
                        if (id.includes('@stellar/stellar-sdk')) return 'stellar'
                        if (id.includes('recharts')) return 'charts'
                        if (id.includes('framer-motion') || id.includes('lucide-react')) return 'ui'
                    }
                }
            }
        }
    }
})
