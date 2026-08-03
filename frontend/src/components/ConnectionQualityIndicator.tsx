import React from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { useRealtimeConnection } from '../context/RealtimeConnectionContext'

const ConnectionQualityIndicator: React.FC = () => {
    const { state, quality, latency } = useRealtimeConnection()

    if (state === 'disconnected') {
        return (
            <div className="flex items-center space-x-2 text-gray-500" title="Disconnected">
                <WifiOff className="w-4 h-4" />
                <span className="text-xs">Offline</span>
            </div>
        )
    }

    const getColor = () => {
        switch (quality) {
            case 'good': return 'text-green-500'
            case 'degraded': return 'text-yellow-500'
            case 'poor': return 'text-red-500'
            default: return 'text-gray-400'
        }
    }

    const getLabel = () => {
        if (state === 'reconnecting') return 'Reconnecting...'
        if (quality === 'unknown') return 'Connecting...'
        if (latency !== null) return `${latency}ms`
        return quality
    }

    return (
        <div className={`flex items-center space-x-2 ${getColor()}`} title={`Quality: ${quality}`}>
            <Wifi className="w-4 h-4" />
            <span className="text-xs">{getLabel()}</span>
        </div>
    )
}

export default ConnectionQualityIndicator
