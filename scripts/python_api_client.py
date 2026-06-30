#!/usr/bin/env python3
"""
Stellar Portfolio Rebalancer - Python API Client.

A comprehensive Python client for interacting with the Stellar Portfolio
Rebalancer API. Covers portfolio management, prices, rebalancing, history,
auto-rebalancer status, notifications, and system health.

Setup:
    python3 -m venv venv && source venv/bin/activate
    pip install requests

Usage:
    python python_api_client.py --help
    python python_api_client.py prices
    python python_api_client.py create-portfolio --address GABC... --assets XLM:40,USDC:60
    python python_api_client.py rebalance --portfolio-id abc-123
    python python_api_client.py history

Environment variables:
    API_URL   - Base API URL (default: http://localhost:3001/api/v1)
    API_KEY   - Optional Bearer token for authenticated requests
"""

import os
import sys
import json
import argparse
from typing import Dict, Any, Optional, List


class RebalancerClient:
    """
    HTTP client for the Stellar Portfolio Rebalancer REST API.

    Args:
        base_url: Root URL of the API. Defaults to http://localhost:3001/api/v1.
        api_key: Optional Bearer token attached to every request.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3001/api/v1",
        api_key: Optional[str] = None,
    ):
        import requests

        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        if api_key:
            self.session.headers.update({"Authorization": f"Bearer {api_key}"})

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        import requests

        response = self.session.get(f"{self.base_url}{path}", params=params)
        response.raise_for_status()
        return response.json()

    def _post(
        self, path: str, payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        import requests

        response = self.session.post(
            f"{self.base_url}{path}", json=payload or {}
        )
        response.raise_for_status()
        return response.json()

    # --- Health & System ---------------------------------------------------

    def health(self) -> Dict[str, Any]:
        """Check whether the API server is reachable and healthy."""
        return self._get("/health")

    def system_status(self) -> Dict[str, Any]:
        """Fetch detailed system status including dependencies."""
        return self._get("/system/status")

    def readiness(self) -> Dict[str, Any]:
        """Fetch readiness report (database, queue, workers, etc.)."""
        return self._get("/system/readiness")

    # --- Prices & Markets --------------------------------------------------

    def get_prices(self) -> Dict[str, Any]:
        """Fetch current price data for all supported assets."""
        return self._get("/prices")

    def get_enhanced_prices(self) -> Dict[str, Any]:
        """Fetch enhanced price data with risk metadata."""
        return self._get("/prices/enhanced")

    def get_market_details(self, asset: str) -> Dict[str, Any]:
        """Fetch market details (depth, volume, spread) for an asset."""
        return self._get(f"/market/{asset}/details")

    def get_price_chart(self, asset: str) -> Dict[str, Any]:
        """Fetch historical price chart data for an asset."""
        return self._get(f"/market/{asset}/chart")

    # --- Portfolios --------------------------------------------------------

    def create_portfolio(
        self, address: str, allocations: List[Dict[str, Any]], name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new portfolio.

        Args:
            address: Stellar public key of the portfolio owner.
            allocations: List of dicts, each with ``asset`` and ``percentage`` keys.
            name: Optional display name for the portfolio.
        """
        payload: Dict[str, Any] = {
            "ownerAddress": address,
            "allocations": allocations,
        }
        if name:
            payload["name"] = name
        return self._post("/portfolio", payload)

    def get_portfolio(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch a single portfolio by ID."""
        return self._get(f"/portfolio/{portfolio_id}")

    def update_portfolio(
        self, portfolio_id: str, allocations: List[Dict[str, Any]], version: int
    ) -> Dict[str, Any]:
        """
        Update an existing portfolio with optimistic concurrency.

        Args:
            portfolio_id: ID of the portfolio to update.
            allocations: New allocation list.
            version: Current version (etag) of the portfolio for conflict detection.
        """
        payload = {"allocations": allocations, "version": version}
        return self.session.put(
            f"{self.base_url}/portfolio/{portfolio_id}",
            json=payload,
        ).json()

    def list_user_portfolios(self, address: str) -> Dict[str, Any]:
        """List all portfolios owned by a Stellar address."""
        return self._get(f"/user/{address}/portfolios")

    def search_portfolios(
        self, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Search across all portfolios with optional filters."""
        return self._get("/portfolios", params=params)

    def get_rebalance_plan(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch the current drift analysis and planned trades."""
        return self._get(f"/portfolio/{portfolio_id}/rebalance-plan")

    def get_rebalance_estimate(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch estimated gas fees and trade count for a rebalance."""
        return self._get(f"/portfolio/{portfolio_id}/rebalance-estimate")

    def execute_rebalance(self, portfolio_id: str) -> Dict[str, Any]:
        """Trigger a manual on-chain rebalance for a portfolio."""
        return self._post(f"/portfolio/{portfolio_id}/rebalance")

    def get_rebalance_summary(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch the rebalance readiness summary for a portfolio."""
        return self._get(f"/rebalance/summary/{portfolio_id}")

    def export_portfolio(
        self, portfolio_id: str, format: str = "json"
    ) -> Dict[str, Any]:
        """Export portfolio data in json, csv, or pdf format."""
        return self._get(f"/portfolio/{portfolio_id}/export", params={"format": format})

    def share_portfolio(self, portfolio_id: str) -> Dict[str, Any]:
        """Create a public share link for a portfolio."""
        return self._post(f"/portfolio/{portfolio_id}/share")

    def revoke_share(self, portfolio_id: str) -> Dict[str, Any]:
        """Revoke a portfolio's public share link."""
        return self.session.delete(
            f"{self.base_url}/portfolio/{portfolio_id}/share"
        ).json()

    # --- Rebalance History -------------------------------------------------

    def get_rebalance_history(
        self, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Fetch rebalance history with optional filters.

        Args:
            params: Optional dict with keys like ``portfolioId``, ``limit``, ``offset``.
        """
        return self._get("/rebalance/history", params=params)

    # --- Auto-Rebalancer ---------------------------------------------------

    def auto_rebalancer_status(self) -> Dict[str, Any]:
        """Check whether the auto-rebalancer is running."""
        return self._get("/auto-rebalancer/status")

    # --- Assets Registry ---------------------------------------------------

    def get_assets(self) -> Dict[str, Any]:
        """Fetch the full asset registry (supported assets)."""
        return self._get("/assets")

    # --- Strategies --------------------------------------------------------

    def get_strategies(self) -> Dict[str, Any]:
        """Fetch available rebalancing strategies."""
        return self._get("/strategies")

    # --- Risk --------------------------------------------------------------

    def get_risk_metrics(self, portfolio_id: str) -> Dict[str, Any]:
        """Fetch risk metrics (VaR, volatility, etc.) for a portfolio."""
        return self._get(f"/risk/metrics/{portfolio_id}")

    def check_risk(self, portfolio_id: str) -> Dict[str, Any]:
        """Run a risk check (circuit breakers, volatility) on a portfolio."""
        return self._get(f"/risk/check/{portfolio_id}")

    # --- Notifications -----------------------------------------------------

    def subscribe_notifications(
        self, user_address: str, email: str
    ) -> Dict[str, Any]:
        """
        Subscribe to rebalance and circuit-breaker notifications.

        Args:
            user_address: Stellar public key.
            email: Email address for delivery.
        """
        payload = {
            "userId": user_address,
            "email": email,
            "events": ["rebalance", "circuit_breaker"],
        }
        return self._post("/notifications/subscribe", payload)

    def get_notification_preferences(self, user_address: str) -> Dict[str, Any]:
        """Fetch notification preferences for a user."""
        return self._get("/notifications/preferences", params={"userId": user_address})


def _format_json(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=True)


def _require_client(base_url: str, api_key: Optional[str]) -> RebalancerClient:
    import requests

    try:
        return RebalancerClient(base_url=base_url, api_key=api_key)
    except Exception as exc:
        print(f"Failed to create API client: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_prices(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)
    try:
        prices = client.get_prices()
        print(_format_json(prices))
    except Exception as exc:
        print(f"Failed to fetch prices: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_create_portfolio(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)

    allocations = []
    for item in args.assets.split(","):
        asset, pct = item.strip().split(":")
        allocations.append({"asset": asset.strip(), "percentage": float(pct)})

    try:
        result = client.create_portfolio(args.address, allocations, name=args.name)
        print(_format_json(result))
    except Exception as exc:
        print(f"Failed to create portfolio: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_rebalance(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)
    try:
        result = client.execute_rebalance(args.portfolio_id)
        print(_format_json(result))
    except Exception as exc:
        print(f"Failed to execute rebalance: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_history(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)
    params: Dict[str, Any] = {}
    if args.portfolio_id:
        params["portfolioId"] = args.portfolio_id
    if args.limit:
        params["limit"] = args.limit
    try:
        result = client.get_rebalance_history(params=params or None)
        print(_format_json(result))
    except Exception as exc:
        print(f"Failed to fetch history: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_portfolio(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)
    try:
        result = client.get_portfolio(args.portfolio_id)
        print(_format_json(result))
    except Exception as exc:
        print(f"Failed to fetch portfolio: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_health(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)
    try:
        result = client.health()
        print(_format_json(result))
    except Exception as exc:
        print(f"Health check failed: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_plan(args: argparse.Namespace) -> None:
    client = _require_client(args.api_url, args.api_key)
    try:
        result = client.get_rebalance_plan(args.portfolio_id)
        print(_format_json(result))
    except Exception as exc:
        print(f"Failed to fetch rebalance plan: {exc}", file=sys.stderr)
        sys.exit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python_api_client.py",
        description="Stellar Portfolio Rebalancer API client.",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("API_URL", "http://localhost:3001/api/v1"),
        help="Base URL of the API (env: API_URL)",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("API_KEY"),
        help="Bearer token for authenticated requests (env: API_KEY)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("health", help="Check API health")
    p.set_defaults(func=cmd_health)

    p = sub.add_parser("prices", help="Fetch current prices")
    p.set_defaults(func=cmd_prices)

    p = sub.add_parser("create-portfolio", help="Create a new portfolio")
    p.add_argument("--address", required=True, help="Stellar public key")
    p.add_argument(
        "--assets", required=True, help="Allocations as ASSET:PCT, comma-separated (e.g. XLM:40,USDC:60)"
    )
    p.add_argument("--name", help="Optional portfolio name")
    p.set_defaults(func=cmd_create_portfolio)

    p = sub.add_parser("rebalance", help="Execute a rebalance")
    p.add_argument("--portfolio-id", required=True, help="Portfolio ID")
    p.set_defaults(func=cmd_rebalance)

    p = sub.add_parser("history", help="Fetch rebalance history")
    p.add_argument("--portfolio-id", help="Filter by portfolio ID")
    p.add_argument("--limit", type=int, help="Maximum entries to return")
    p.set_defaults(func=cmd_history)

    p = sub.add_parser("portfolio", help="Get a portfolio by ID")
    p.add_argument("--portfolio-id", required=True, help="Portfolio ID")
    p.set_defaults(func=cmd_portfolio)

    p = sub.add_parser("plan", help="Get rebalance plan for a portfolio")
    p.add_argument("--portfolio-id", required=True, help="Portfolio ID")
    p.set_defaults(func=cmd_plan)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
