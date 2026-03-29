import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { RealtimeConnectionProvider } from './context/RealtimeConnectionContext'
import { QueryProvider } from './providers/QueryProvider'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { initializeObservability } from './observability'
import './styles/globals.css'

initializeObservability()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <AppErrorBoundary>
            <QueryProvider>
                <ThemeProvider>
                    <RealtimeConnectionProvider>
                        <App />
                    </RealtimeConnectionProvider>
                </ThemeProvider>
            </QueryProvider>
        </AppErrorBoundary>
    </React.StrictMode>,
)
