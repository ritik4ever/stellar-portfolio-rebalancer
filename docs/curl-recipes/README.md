# cURL Recipe Examples

This directory contains copy-paste cURL recipes for common API workflows in the Stellar Portfolio Rebalancer.

## Usage

1. Set your API base URL (default: `http://localhost:3001`)
2. Copy the desired recipe
3. Replace placeholder values (e.g., `YOUR_ADDRESS`, `PORTFOLIO_ID`)
4. Run in your terminal

## Available Recipes

- **[Health & System Status](./01-health-system-status.md)** - Health checks, readiness probes, and system status
- **[Portfolio Operations](./02-portfolio-operations.md)** - Create, read, update, and delete portfolios
- **[Asset Operations](./03-asset-operations.md)** - Browse assets, get asset details
- **[Rebalancing Operations](./04-rebalancing-operations.md)** - Trigger rebalances, check history
- **[Notification Operations](./05-notification-operations.md)** - Subscribe to notifications, manage preferences
- **[Admin Operations](./06-admin-operations.md)** - Asset management, rate limit metrics (requires admin access)

## Environment Variables

Set these once to avoid repeating them in each command:

```bash
export API_BASE="http://localhost:3001"
export API_VERSION="v1"  # or empty for legacy routes
```

## Authentication

If JWT auth is enabled, include your token:

```bash
export JWT_TOKEN="your-jwt-token-here"
```

Then add to each request:
```bash
-H "Authorization: Bearer $JWT_TOKEN"
```

## Notes

- All examples use the v1 API prefix by default. Remove `/v1` for legacy routes.
- Demo mode uses placeholder addresses and may not reflect mainnet behavior.
- Admin routes require the `ADMIN_PUBLIC_KEYS` environment variable to include your address.
