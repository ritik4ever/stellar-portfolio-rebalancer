import React, { useEffect } from 'react'

const PriceTracker: React.FC = () => {
    useEffect(() => {
        // Load CoinGecko widget script
        const script = document.createElement('script')
        script.src = 'https://widgets.coingecko.com/gecko-coin-price-static-headline-widget.js'
        script.async = true
        document.body.appendChild(script)
        
        return () => {
            // Cleanup
            if (document.body.contains(script)) {
                document.body.removeChild(script)
            }
        }
    }, [])

    return (
        <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Real-time Prices</h2>
                <span className="text-sm text-green-600">● Connected</span>
            </div>
            
            {/* CoinGecko Widget */}
            <gecko-coin-price-static-headline-widget 
                locale="en" 
                outlined="true" 
                coin-ids="stellar,ethereum,usd-coin,bitcoin" 
                initial-currency="usd">
            </gecko-coin-price-static-headline-widget>
        </div>
    )
}

export default PriceTracker
