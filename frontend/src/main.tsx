import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { RealtimeConnectionProvider } from './context/RealtimeConnectionContext'
import { QueryProvider } from './providers/QueryProvider'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <QueryProvider>
            <ThemeProvider>
                <RealtimeConnectionProvider>
                    <App />
                </RealtimeConnectionProvider>
            </ThemeProvider>
        </QueryProvider>
    </React.StrictMode>,
)