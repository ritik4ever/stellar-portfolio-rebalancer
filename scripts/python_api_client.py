import os
import requests
import time
from typing import Dict, Any, Optional

# Example Python client for the Stellar Portfolio Rebalancer API

class RebalancerClient:
    def __init__(self, base_url: str = "http://localhost:3001/api/v1", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        if api_key:
            self.session.headers.update({"Authorization": f"Bearer {api_key}"})

    def get_portfolio(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch portfolio details by ID."""
        response = self.session.get(f"{self.base_url}/portfolio/{portfolio_id}")
        response.raise_for_status()
        return response.json()

    def get_prices(self) -> Dict[str, Any]:
        """Fetch current price data for supported assets."""
        response = self.session.get(f"{self.base_url}/prices")
        response.raise_for_status()
        return response.json()

    def get_rebalance_plan(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch the current drift and planned trades if a rebalance were to occur."""
        response = self.session.get(f"{self.base_url}/portfolio/{portfolio_id}/rebalance-plan")
        response.raise_for_status()
        return response.json()

    def execute_rebalance(self, portfolio_id: str) -> Dict[str, Any]:
        """Trigger a manual rebalance for the given portfolio."""
        response = self.session.post(f"{self.base_url}/portfolio/{portfolio_id}/rebalance")
        response.raise_for_status()
        return response.json()

    def check_rebalance_status(self, portfolio_id: str) -> Dict[str, Any]:
        """Check the status of an ongoing or recent rebalance."""
        response = self.session.get(f"{self.base_url}/portfolio/{portfolio_id}/rebalance-status")
        response.raise_for_status()
        return response.json()

    def subscribe_notifications(self, user_address: str, email: str) -> Dict[str, Any]:
        """Subscribe to rebalance notifications."""
        payload = {
            "userId": user_address,
            "email": email,
            "events": ["rebalance", "circuit_breaker"]
        }
        response = self.session.post(f"{self.base_url}/notifications/subscribe", json=payload)
        response.raise_for_status()
        return response.json()

if __name__ == "__main__":
    # Example usage
    # 1. Setup virtual environment: python3 -m venv venv && source venv/bin/activate
    # 2. Install requirements: pip install requests
    
    API_URL = os.getenv("API_URL", "http://localhost:3001/api/v1")
    API_KEY = os.getenv("API_KEY") # Optional if auth is enabled
    
    print(f"Connecting to {API_URL}")
    client = RebalancerClient(base_url=API_URL, api_key=API_KEY)
    
    try:
        print("Fetching prices...")
        prices = client.get_prices()
        print(f"Prices fetched successfully. Found {len(prices)} assets.")
        
        # Replace with a real portfolio ID to test further
        PORTFOLIO_ID = "1"
        
        # print(f"Checking rebalance plan for portfolio {PORTFOLIO_ID}...")
        # plan = client.get_rebalance_plan(PORTFOLIO_ID)
        # print(f"Drift: {plan.get('maxDrift', 0)}%")
        
    except requests.exceptions.RequestException as e:
        print(f"API Request failed: {e}")
