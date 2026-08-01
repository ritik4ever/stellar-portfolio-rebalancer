import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider, bootstrapThemeBeforeHydration } from './context/ThemeContext'
import { RealtimeConnectionProvider } from './context/RealtimeConnectionContext'
import { ToastProvider } from './context/ToastContext'
import { QueryProvider } from './providers/QueryProvider'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { initializeObservability } from './observability'
import { initAnalytics } from './analytics'
import './styles/globals.css'
import './i18n'

initializeObservability()
initAnalytics()
bootstrapThemeBeforeHydration()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <AppErrorBoundary>
            <QueryProvider>
                <ThemeProvider>
                    <RealtimeConnectionProvider>
                        <ToastProvider>
                            <App />
                        </ToastProvider>
                    </RealtimeConnectionProvider>
                </ThemeProvider>
            </QueryProvider>
        </AppErrorBoundary>
    </React.StrictMode>,
)
